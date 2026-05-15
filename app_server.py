#!/usr/bin/env python3
"""
Servidor unificado: Pulso Neurofuncional + Captura EEG

Integra pulse_local_server.py en un solo proceso.
- Sirve la SPA en http://127.0.0.1:8090/
- Pulse API:  POST /api/convert-pulse
- Capture API: POST /api/capture/start | /api/capture/stop
               GET  /api/capture/status | /api/capture/stream | /api/capture/download-json
- Garden API:  GET  /api/garden/list | /api/garden/file?name=...
               POST /api/garden/upload
- Profiles API: GET  /api/profiles/list | /api/profiles/captures | /api/profiles/representative
                POST /api/profiles/rename | /api/profiles/delete | /api/profiles/capture/delete
- MIDI API:    POST /api/json-to-midi
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import tempfile
import time
import traceback
import unicodedata
import zipfile
from collections import defaultdict
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlparse

import numpy as np

from muse_capture import MuseOSCToMidi
from pulse_to_3d_print import convert
from safe_json_storage import default_json_dirs, first_writable_dir, write_json_with_fallback


# ══════════════════════════════════════════════════════════════════════════════
# Pulse helpers
# ══════════════════════════════════════════════════════════════════════════════

def map_formats(format_value: str) -> list[str]:
    mapping = {
        'glb+3mf': ['glb', '3mf'],
        'glb': ['glb'],
        '3mf': ['3mf'],
        'stl': ['stl'],
        'all': ['all'],
    }
    return mapping.get(format_value, ['glb', '3mf'])


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

def get_captures_dir() -> Path:
    """Devuelve la carpeta de capturas escribible (con fallback a ~/captura_eeg/captures)."""
    primary = Path(__file__).resolve().parent / 'captures'
    candidates = [primary, *default_json_dirs()]
    chosen = first_writable_dir(candidates)
    if chosen != primary:
        print(f'⚠️  Sin permisos en captures/ junto al script. Guardando en: {chosen}')
    return chosen


# ══════════════════════════════════════════════════════════════════════════════
# Profile helpers
# ══════════════════════════════════════════════════════════════════════════════

def normalize_profile_name(name: str) -> str:
    """Lowercase, strip, collapse spaces, remove accents for comparison."""
    if not name:
        return ''
    # Normalize unicode: decompose accented chars then drop combining marks
    nfkd = unicodedata.normalize('NFKD', name)
    ascii_str = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', ascii_str).strip().lower()


def get_capture_profile_name(data: dict) -> str:
    """Return canonical profile name from a capture JSON."""
    meta = data.get('metadata', {})
    name = meta.get('profile_name') or meta.get('user_name') or ''
    return name.strip() or 'Sin nombre'


def get_profile_name_from_meta(meta: dict) -> str:
    name = meta.get('profile_name') or meta.get('user_name') or ''
    return name.strip() or 'Sin nombre'


def read_capture_metadata_fast(path: Path) -> dict:
    """Read only the leading metadata object; fallback to full JSON for odd files."""
    try:
        with path.open('r', encoding='utf-8') as fh:
            head = fh.read(65536)
        key_idx = head.find('"metadata"')
        if key_idx < 0:
            raise ValueError('metadata key not found')
        colon_idx = head.find(':', key_idx)
        if colon_idx < 0:
            raise ValueError('metadata colon not found')
        decoder = json.JSONDecoder()
        meta, _ = decoder.raw_decode(head[colon_idx + 1:].lstrip())
        if isinstance(meta, dict):
            return meta
    except Exception:
        pass

    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data.get('metadata', {})
    except Exception:
        return {}


def load_capture_index() -> dict:
    """
    Scan captures/*.json and return:
      {
        'captures': [...],    # list of {filename, meta, data_ref}
        'profiles': {...},    # norm_name -> {profile_name, captures: [...]}
      }
    """
    captures_dir = get_captures_dir()
    captures = []
    profiles: dict[str, dict] = {}

    if not captures_dir.exists():
        return {'captures': captures, 'profiles': profiles}

    for f in sorted(captures_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = read_capture_metadata_fast(f)
            profile_name = get_profile_name_from_meta(meta)
            norm = normalize_profile_name(profile_name)

            capture_info = {
                'filename': f.name,
                'profile_name': profile_name,
                'user_name': meta.get('user_name', ''),
                'user_state': meta.get('user_state', ''),
                'duration_seconds': meta.get('duration_seconds', 0),
                'total_samples': meta.get('total_samples', 0),
                'sample_rate_hz': meta.get('sample_rate_hz', 0),
                'capture_timestamp': meta.get('capture_timestamp', ''),
            }
            captures.append(capture_info)

            if norm not in profiles:
                profiles[norm] = {
                    'profile_name': profile_name,
                    'norm': norm,
                    'captures': [],
                }
            profiles[norm]['captures'].append(capture_info)
        except Exception:
            continue

    return {'captures': captures, 'profiles': profiles}


# ══════════════════════════════════════════════════════════════════════════════
# EEG capture controller
# ══════════════════════════════════════════════════════════════════════════════

class WebCaptureController:
    def __init__(self, osc_ip: str = '127.0.0.1', osc_port: int = 5000):
        self.osc_ip = osc_ip
        self.osc_port = osc_port
        self.lock = Lock()
        self.converter: MuseOSCToMidi | None = None
        self.running = False
        self.start_time: float | None = None
        self.end_time: float | None = None
        self.target_duration: float | None = None
        self.user_name: str = ''
        self.user_state: str = ''
        self.profile_name: str = ''

    def _close_converter_resources(self, converter: MuseOSCToMidi | None):
        if not converter:
            return
        server = getattr(converter, 'server', None)
        if server:
            try:
                server.shutdown()
            except Exception:
                pass
            try:
                server.server_close()
            except Exception:
                pass
        thread = getattr(converter, 'server_thread', None)
        if thread and thread.is_alive():
            try:
                thread.join(timeout=0.8)
            except Exception:
                pass
        converter.server = None
        converter.server_thread = None

    def _build_light_eeg_handler(self, converter: MuseOSCToMidi):
        def handler(address, *args):
            if not converter.running:
                return
            if '/muse/eeg' not in address and '/eeg' not in address:
                return
            if len(args) < 4:
                return
            with self.lock:
                converter.sample_count += 1
                current_time = time.time()
                for channel in range(4):
                    val = args[channel]
                    if np.isnan(val):
                        val = 0.0
                    converter.eeg_data[channel].append(float(val))
                converter.timestamps.append(current_time)
        return handler

    def start_capture(self, duration_seconds: float | None = None,
                      user_name: str = '', user_state: str = '',
                      profile_name: str = ''):
        with self.lock:
            already_running = self.running
            previous_converter = self.converter
            self.converter = None
            self.running = False

        # If a capture was already in progress, stop it cleanly before starting a new one
        if already_running and previous_converter:
            try:
                previous_converter.stop_capture()
            except Exception:
                pass
            self._close_converter_resources(previous_converter)
            previous_converter = None

        self._close_converter_resources(previous_converter)

        last_error = None
        for attempt in range(2):
            converter = MuseOSCToMidi(osc_ip=self.osc_ip, osc_port=self.osc_port)
            converter.debug_handler = lambda *a, **kw: None
            converter.eeg_handler = self._build_light_eeg_handler(converter)
            converter.eeg_data = {i: [] for i in range(4)}
            converter.timestamps = []
            converter.sample_count = 0
            converter.running = True

            try:
                converter.setup_osc_server()
                converter.start_osc_server()
            except OSError as exc:
                last_error = exc
                converter.running = False
                self._close_converter_resources(converter)
                if getattr(exc, 'winerror', None) == 10048 and attempt == 0:
                    time.sleep(0.45)
                    continue
                raise
            except Exception as exc:
                last_error = exc
                converter.running = False
                self._close_converter_resources(converter)
                raise

            with self.lock:
                self.converter = converter
                self.running = True
                self.start_time = time.time()
                self.end_time = None
                self.target_duration = duration_seconds if duration_seconds and duration_seconds > 0 else None
                self.user_name = user_name
                self.user_state = user_state
                self.profile_name = profile_name or user_name
            return

        if last_error:
            raise last_error

    def _auto_stop_if_needed(self):
        should_stop = False
        with self.lock:
            if self.running and self.target_duration and self.start_time:
                should_stop = (time.time() - self.start_time) >= self.target_duration
        if should_stop:
            self.stop_capture()

    def stop_capture(self):
        with self.lock:
            converter = self.converter
            if not self.running and not converter:
                return
            self.running = False
            self.end_time = time.time()
        if converter:
            converter.stop_capture()
            self._close_converter_resources(converter)
        with self.lock:
            self.target_duration = None
        # Auto-save capture to captures/ folder
        self._auto_save_capture()

    def _build_capture_payload_locked(self) -> dict:
        converter = self.converter
        if not converter:
            return {
                'metadata': {
                    'duration_seconds': 0.0, 'total_samples': 0,
                    'sample_rate_hz': 0.0, 'channels': 4,
                    'capture_timestamp': '', 'start_time': None, 'end_time': None,
                    'user_name': self.user_name, 'user_state': self.user_state,
                    'profile_name': self.profile_name or self.user_name,
                },
                'eeg_channels': {f'channel_{i}': [] for i in range(1, 5)},
                'timestamps': [], 'statistics': {},
            }

        synced_len = min(
            len(converter.timestamps),
            *(len(converter.eeg_data[i]) for i in range(4))
        )
        timestamps = converter.timestamps[:synced_len]
        eeg_channels = {
            f'channel_{i+1}': converter.eeg_data[i][:synced_len]
            for i in range(4)
        }

        if self.start_time:
            stop_at = time.time() if self.running else (self.end_time or time.time())
            duration_seconds = max(0.0, stop_at - self.start_time)
        else:
            duration_seconds = 0.0

        sample_rate_hz = (synced_len / duration_seconds) if duration_seconds > 0 else 0.0

        stats = {}
        for i in range(1, 5):
            arr = np.array(eeg_channels[f'channel_{i}'], dtype=float)
            if arr.size:
                stats[f'channel_{i}'] = {
                    'min': float(arr.min()), 'max': float(arr.max()),
                    'mean': float(arr.mean()), 'std': float(arr.std()),
                    'samples_count': int(arr.size), 'last': float(arr[-1]),
                }

        return {
            'metadata': {
                'duration_seconds': duration_seconds,
                'total_samples': synced_len,
                'sample_rate_hz': sample_rate_hz,
                'channels': 4,
                'capture_timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
                'start_time': self.start_time,
                'end_time': self.end_time,
                'target_duration_seconds': self.target_duration,
                'running': self.running,
                'user_name': self.user_name,
                'user_state': self.user_state,
                'profile_name': self.profile_name or self.user_name,
            },
            'eeg_channels': eeg_channels,
            'timestamps': timestamps,
            'statistics': stats,
        }

    def _auto_save_capture(self):
        """Save completed capture JSON to captures/ folder automatically."""
        try:
            with self.lock:
                payload = self._build_capture_payload_locked()
            total_samples = payload.get('metadata', {}).get('total_samples', 0)
            if total_samples == 0:
                print('⚠️ 0 muestras capturadas (Muse puede no estar transmitiendo), pero se guarda el archivo de todas formas.')

            captures_dir = get_captures_dir()

            name = payload['metadata'].get('user_name', '') or 'captura'
            state = payload['metadata'].get('user_state', '')
            safe_name = ''.join(c if c.isalnum() or c in '-_ ' else '' for c in name).strip().replace(' ', '_')
            state_str = f"_{state}" if state not in (None, '', 0) else ''
            timestamp_str = time.strftime('%Y%m%d_%H%M%S')
            filename = f"eeg_{safe_name}{state_str}_{timestamp_str}.json"

            filepath = write_json_with_fallback(
                payload,
                target_file=captures_dir / filename,
                filename=filename,
                indent=2,
            )
            print(f'💾 Captura guardada automáticamente: {filepath}')
        except Exception as exc:
            print(f'⚠️ No se pudo guardar la captura automáticamente: {exc}')
            traceback.print_exc()

    def get_status(self) -> dict:
        self._auto_stop_if_needed()
        with self.lock:
            payload = self._build_capture_payload_locked()
            payload['capture_running'] = self.running
            return payload

    def get_stream(self, from_index: int) -> dict:
        self._auto_stop_if_needed()
        with self.lock:
            payload = self._build_capture_payload_locked()
            total = payload['metadata']['total_samples']
            start_index = max(0, min(from_index, total))
            end_index = total
            eeg_channels = payload['eeg_channels']
            stream_channels = {
                f'channel_{i}': eeg_channels[f'channel_{i}'][start_index:end_index]
                for i in range(1, 5)
            }
            latest = {
                key: (vals[-1] if vals else 0.0)
                for key, vals in eeg_channels.items()
            }
            return {
                'startIndex': start_index, 'endIndex': end_index,
                'totalSamples': total, 'running': self.running,
                'finished': (not self.running and total > 0),
                'timestamps': payload['timestamps'][start_index:end_index],
                'eeg_channels': stream_channels, 'latest': latest,
                'metadata': payload['metadata'], 'statistics': payload['statistics'],
            }


# ══════════════════════════════════════════════════════════════════════════════
# Unified HTTP Handler
# ══════════════════════════════════════════════════════════════════════════════

CAPTURE = WebCaptureController()


class AppHandler(SimpleHTTPRequestHandler):
    """Serves static files from app/ and handles all APIs."""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        content_length = int(self.headers.get('Content-Length', '0'))
        if content_length <= 0:
            return {}
        raw = self.rfile.read(content_length)
        return json.loads(raw.decode('utf-8'))

    # ── POST ──────────────────────────────────────────────────────────────

    def do_POST(self):
        parsed = urlparse(self.path)

        # ── Pulse: 3D conversion ──
        if parsed.path == '/api/convert-pulse':
            self._handle_convert_pulse()
            return

        # ── Capture: start ──
        if parsed.path == '/api/capture/start':
            try:
                body = self._read_json_body()
                duration = body.get('durationSeconds')
                duration_value = float(duration) if duration not in (None, '', 0) else None
                user_name = body.get('userName', '')
                user_state = body.get('userState', '')
                profile_name = body.get('profileName', '') or user_name
                CAPTURE.start_capture(duration_value, user_name=user_name, user_state=user_state,
                                      profile_name=profile_name)
                self._send_json(200, {
                    'ok': True, 'message': 'Captura iniciada',
                    'durationSeconds': duration_value,
                    'userName': user_name, 'userState': user_state,
                    'profileName': profile_name,
                })
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': f'No se pudo iniciar captura: {exc}'})
            return

        # ── Capture: stop ──
        if parsed.path == '/api/capture/stop':
            try:
                CAPTURE.stop_capture()
                self._send_json(200, {'ok': True, 'message': 'Captura detenida'})
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': f'No se pudo detener captura: {exc}'})
            return

        # ── JSON to MIDI ──
        if parsed.path == '/api/json-to-midi':
            self._handle_json_to_midi()
            return

        # ── Garden: manual JSON upload ──
        if parsed.path == '/api/garden/upload':
            try:
                body = self._read_json_body()
                self._handle_garden_upload(
                    body.get('jsonData'),
                    body.get('sourceFilename', ''),
                    body.get('profileName', ''),
                )
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Garden: delete a capture ──
        if parsed.path == '/api/garden/delete':
            try:
                body = self._read_json_body()
                filename = body.get('filename', '')
                self._handle_garden_delete(filename)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Garden: rename (update user_name) ──
        if parsed.path == '/api/garden/rename':
            try:
                body = self._read_json_body()
                filename = body.get('filename', '')
                new_name = body.get('newName', '').strip()
                self._handle_garden_rename(filename, new_name)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: rename all captures of a profile ──
        if parsed.path == '/api/profiles/rename':
            try:
                body = self._read_json_body()
                self._handle_profiles_rename(body.get('oldName', ''), body.get('newName', ''))
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: delete entire profile ──
        if parsed.path == '/api/profiles/delete':
            try:
                body = self._read_json_body()
                self._handle_profiles_delete(body.get('name', ''))
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: delete single capture ──
        if parsed.path == '/api/profiles/capture/delete':
            try:
                body = self._read_json_body()
                self._handle_garden_delete(body.get('filename', ''))
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        self._send_json(404, {'ok': False, 'error': 'Endpoint no encontrado'})

    # ── GET ───────────────────────────────────────────────────────────────

    def do_GET(self):
        parsed = urlparse(self.path)

        # Redirect root to app/
        if parsed.path == '/':
            self.send_response(301)
            self.send_header('Location', '/app/')
            self.end_headers()
            return

        # ── Capture status ──
        if parsed.path == '/api/capture/status':
            try:
                self._send_json(200, CAPTURE.get_status())
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Capture stream ──
        if parsed.path == '/api/capture/stream':
            try:
                query = parse_qs(parsed.query)
                from_index = int(query.get('from', ['0'])[0])
                self._send_json(200, CAPTURE.get_stream(from_index))
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Download JSON ──
        if parsed.path == '/api/capture/download-json':
            try:
                payload = CAPTURE.get_status()
                body = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
                name = payload['metadata'].get('user_name', '') or 'captura'
                safe_name = ''.join(c if c.isalnum() or c in '-_ ' else '' for c in name).strip().replace(' ', '_')
                filename = f"eeg_{safe_name}_{int(time.time())}.json"
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Garden: list saved captures ──
        if parsed.path == '/api/garden/list':
            try:
                self._handle_garden_list()
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Garden: get a specific capture file ──
        if parsed.path == '/api/garden/file':
            try:
                query = parse_qs(parsed.query)
                filename = query.get('name', [''])[0]
                self._handle_garden_file(filename)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Garden: get latest capture ──
        if parsed.path == '/api/garden/latest':
            try:
                self._handle_garden_latest()
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: list profiles ──
        if parsed.path == '/api/profiles/list':
            try:
                self._handle_profiles_list()
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: list captures of a profile ──
        if parsed.path == '/api/profiles/captures':
            try:
                query = parse_qs(parsed.query)
                name = query.get('name', [''])[0]
                self._handle_profiles_captures(name)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Profiles: representative capture JSON ──
        if parsed.path == '/api/profiles/representative':
            try:
                query = parse_qs(parsed.query)
                name = query.get('name', [''])[0]
                self._handle_profiles_representative(name)
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        # ── Serve static files (pulse/ and app/) ──
        super().do_GET()

    # ── Pulse API handler ────────────────────────────────────────────────

    def _handle_convert_pulse(self):
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
            if content_length <= 0:
                self._send_json(400, {'error': 'Body vacío'})
                return

            raw = self.rfile.read(content_length)
            payload = json.loads(raw.decode('utf-8'))

            geometry = payload.get('geometry')
            format_value = payload.get('format', 'glb+3mf')
            target_height = payload.get('targetHeightMm', 120)

            if not geometry or geometry.get('format') != 'pulse-geometry-v1':
                self._send_json(400, {'error': 'Geometría inválida o faltante'})
                return

            formats = map_formats(str(format_value))

            with tempfile.TemporaryDirectory(prefix='pulse_convert_') as tmpdir:
                tmp_path = Path(tmpdir)
                json_file = tmp_path / f'pulso_neurofuncional_{target_height}mm.json'
                json_file.write_text(json.dumps(geometry, ensure_ascii=False), encoding='utf-8')

                convert(str(json_file), formats=formats, output_dir=str(tmp_path))

                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                    for out_file in tmp_path.rglob('*'):
                        if out_file.is_file() and out_file != json_file:
                            zf.write(out_file, arcname=out_file.relative_to(tmp_path))

                zip_bytes = zip_buffer.getvalue()
                filename = f"pulso_neurofuncional_{target_height}mm_{str(format_value).replace('+', '_')}.zip"

                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(zip_bytes)))
                self.end_headers()
                self.wfile.write(zip_bytes)

        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {'error': f'Error en conversión Python: {exc}'})

    # ── MIDI conversion handler ───────────────────────────────────────────

    def _handle_json_to_midi(self):
        try:
            body = self._read_json_body()
            json_data = body.get('jsonData')
            if not json_data or 'eeg_channels' not in json_data or 'metadata' not in json_data:
                self._send_json(400, {'ok': False, 'error': 'JSON EEG inválido'})
                return

            with tempfile.TemporaryDirectory(prefix='app_json_to_midi_') as tmpdir:
                tmp_path = Path(tmpdir)
                json_file = tmp_path / 'input_eeg.json'
                midi_file = tmp_path / 'output.mid'

                json_file.write_text(json.dumps(json_data, ensure_ascii=False), encoding='utf-8')

                converter = MuseOSCToMidi(output_file=str(midi_file))
                converter.json_to_midi(str(json_file), str(midi_file))

                if not midi_file.exists():
                    self._send_json(500, {'ok': False, 'error': 'No se pudo generar el MIDI'})
                    return

                midi_bytes = midi_file.read_bytes()
                name = json_data.get('metadata', {}).get('user_name', '') or 'eeg'
                safe_name = ''.join(c if c.isalnum() or c in '-_ ' else '' for c in name).strip().replace(' ', '_')
                filename = f"{safe_name}_{int(time.time())}.mid"

                self.send_response(200)
                self.send_header('Content-Type', 'audio/midi')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(midi_bytes)))
                self.end_headers()
                self.wfile.write(midi_bytes)

        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {'ok': False, 'error': f'Error en conversión JSON a MIDI: {exc}'})

    # ── Garden API handlers ────────────────────────────────────────────────

    def _handle_garden_list(self):
        captures_dir = get_captures_dir()
        if not captures_dir.exists():
            self._send_json(200, {'ok': True, 'captures': []})
            return

        captures = []
        for f in sorted(captures_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                data = json.loads(f.read_text(encoding='utf-8'))
                meta = data.get('metadata', {})
                captures.append({
                    'filename': f.name,
                    'user_name': meta.get('user_name', ''),
                    'user_state': meta.get('user_state', ''),
                    'duration_seconds': meta.get('duration_seconds', 0),
                    'total_samples': meta.get('total_samples', 0),
                    'capture_timestamp': meta.get('capture_timestamp', ''),
                    'sample_rate_hz': meta.get('sample_rate_hz', 0),
                })
            except Exception:
                continue

        self._send_json(200, {'ok': True, 'captures': captures})

    def _handle_garden_file(self, filename: str):
        if not filename or '..' in filename or '/' in filename or '\\' in filename:
            self._send_json(400, {'ok': False, 'error': 'Nombre de archivo inválido'})
            return

        captures_dir = get_captures_dir()
        filepath = captures_dir / filename

        if not filepath.exists() or not filepath.is_file():
            self._send_json(404, {'ok': False, 'error': 'Archivo no encontrado'})
            return

        body = filepath.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle_garden_upload(self, payload: dict | None, source_filename: str = '',
                              profile_name_override: str = ''):
        if not isinstance(payload, dict):
            self._send_json(400, {'ok': False, 'error': 'JSON inválido'})
            return
        if not isinstance(payload.get('metadata'), dict) or not isinstance(payload.get('eeg_channels'), dict):
            self._send_json(400, {'ok': False, 'error': 'El JSON requiere metadata y eeg_channels'})
            return

        metadata = payload['metadata']
        channels = payload['eeg_channels']
        source_stem = Path(source_filename or '').stem or 'captura'
        fallback_name = re.sub(r'[^A-Za-z0-9_-]+', '_', source_stem).strip('_') or 'captura'
        override = str(profile_name_override or '').strip()
        if override:
            metadata['profile_name'] = override
            metadata['user_name'] = override
        else:
            user_name = str(metadata.get('profile_name') or metadata.get('user_name') or fallback_name).strip()
            metadata['user_name'] = str(metadata.get('user_name') or user_name).strip()
            metadata['profile_name'] = str(metadata.get('profile_name') or metadata['user_name']).strip()
        user_name = str(metadata.get('profile_name') or metadata.get('user_name') or fallback_name).strip()
        metadata['capture_timestamp'] = metadata.get('capture_timestamp') or time.strftime('%Y-%m-%d %H:%M:%S')

        if not metadata.get('total_samples'):
            lengths = [len(v) for v in channels.values() if isinstance(v, list)]
            metadata['total_samples'] = max(lengths) if lengths else 0

        safe_name = ''.join(c if c.isalnum() or c in '-_ ' else '' for c in user_name).strip().replace(' ', '_')
        if not safe_name:
            safe_name = fallback_name
        timestamp_str = time.strftime('%Y%m%d_%H%M%S')
        filename = f'eeg_{safe_name}_manual_{timestamp_str}.json'
        captures_dir = get_captures_dir()
        filepath = captures_dir / filename
        suffix = 1
        while filepath.exists():
            filename = f'eeg_{safe_name}_manual_{timestamp_str}_{suffix}.json'
            filepath = captures_dir / filename
            suffix += 1

        saved_path = write_json_with_fallback(
            payload,
            target_file=filepath,
            filename=filename,
            indent=2,
        )
        print(f'📂 Captura JSON subida manualmente: {saved_path}')
        response_payload = dict(payload)
        response_payload['filename'] = saved_path.name
        self._send_json(200, {'ok': True, 'filename': saved_path.name, 'capture': response_payload})

    def _handle_garden_latest(self):
        captures_dir = get_captures_dir()
        if not captures_dir.exists():
            self._send_json(200, {'ok': True, 'capture': None})
            return

        files = sorted(captures_dir.glob('*.json'), key=lambda p: p.stat().st_mtime, reverse=True)
        if not files:
            self._send_json(200, {'ok': True, 'capture': None})
            return

        latest_file = files[0]
        try:
            data = json.loads(latest_file.read_text(encoding='utf-8'))
            meta = data.get('metadata', {})
            capture_info = {
                'filename': latest_file.name,
                'user_name': meta.get('user_name', ''),
                'user_state': meta.get('user_state', ''),
                'duration_seconds': meta.get('duration_seconds', 0),
                'total_samples': meta.get('total_samples', 0),
                'capture_timestamp': meta.get('capture_timestamp', ''),
                'sample_rate_hz': meta.get('sample_rate_hz', 0),
            }
            self._send_json(200, {'ok': True, 'capture': capture_info})
        except Exception as exc:
            self._send_json(500, {'ok': False, 'error': str(exc)})

    def _handle_garden_delete(self, filename: str):
        if not filename or '..' in filename or '/' in filename or '\\' in filename:
            self._send_json(400, {'ok': False, 'error': 'Nombre de archivo inválido'})
            return

        captures_dir = get_captures_dir()
        filepath = captures_dir / filename

        if not filepath.exists() or not filepath.is_file():
            self._send_json(404, {'ok': False, 'error': 'Archivo no encontrado'})
            return

        filepath.unlink()
        print(f'🗑️ Captura eliminada: {filename}')
        self._send_json(200, {'ok': True, 'message': f'Captura "{filename}" eliminada.'})

    # ── Profiles API handlers ──────────────────────────────────────────────

    def _handle_profiles_list(self):
        index = load_capture_index()
        profiles_map = index['profiles']
        result = []
        for norm, prof in profiles_map.items():
            caps = prof['captures']
            # Sort captures by timestamp desc
            caps_sorted = sorted(caps, key=lambda c: c.get('capture_timestamp', ''), reverse=True)
            latest = caps_sorted[0] if caps_sorted else {}
            states = list({c.get('user_state', '') for c in caps if c.get('user_state')})
            total_samples = sum(c.get('total_samples', 0) for c in caps)
            # Choose representative: prefer capture with total_samples > 0
            rep = next((c for c in caps_sorted if (c.get('total_samples') or 0) > 0), caps_sorted[0] if caps_sorted else {})
            slug = re.sub(r'[^a-z0-9]+', '-', normalize_profile_name(prof['profile_name'])).strip('-')
            result.append({
                'profile_name': prof['profile_name'],
                'slug': slug,
                'capture_count': len(caps),
                'latest_capture_filename': latest.get('filename', ''),
                'latest_capture_timestamp': latest.get('capture_timestamp', ''),
                'states': states,
                'total_samples': total_samples,
                'captures': caps_sorted,
                'representative': {
                    'filename': rep.get('filename', ''),
                    'duration_seconds': rep.get('duration_seconds', 0),
                    'sample_rate_hz': rep.get('sample_rate_hz', 0),
                },
            })
        # Sort by latest timestamp desc
        result.sort(key=lambda p: p.get('latest_capture_timestamp', ''), reverse=True)
        self._send_json(200, {'ok': True, 'profiles': result})

    def _handle_profiles_captures(self, name: str):
        if not name:
            self._send_json(400, {'ok': False, 'error': 'Falta parámetro name'})
            return
        norm_target = normalize_profile_name(name)
        index = load_capture_index()
        prof = index['profiles'].get(norm_target)
        if not prof:
            self._send_json(200, {'ok': True, 'profile_name': name, 'captures': []})
            return
        caps = sorted(prof['captures'], key=lambda c: c.get('capture_timestamp', ''), reverse=True)
        self._send_json(200, {'ok': True, 'profile_name': prof['profile_name'], 'captures': caps})

    def _handle_profiles_representative(self, name: str):
        if not name:
            self._send_json(400, {'ok': False, 'error': 'Falta parámetro name'})
            return
        norm_target = normalize_profile_name(name)
        index = load_capture_index()
        prof = index['profiles'].get(norm_target)
        if not prof or not prof['captures']:
            self._send_json(404, {'ok': False, 'error': 'Perfil no encontrado'})
            return
        caps = sorted(prof['captures'], key=lambda c: c.get('capture_timestamp', ''), reverse=True)
        rep = next((c for c in caps if (c.get('total_samples') or 0) > 0), caps[0])
        self._handle_garden_file(rep['filename'])

    def _handle_profiles_rename(self, old_name: str, new_name: str):
        old_name = old_name.strip()
        new_name = new_name.strip()
        if not old_name or not new_name:
            self._send_json(400, {'ok': False, 'error': 'oldName y newName son requeridos'})
            return
        norm_target = normalize_profile_name(old_name)
        captures_dir = get_captures_dir()
        updated = 0
        for f in captures_dir.glob('*.json'):
            try:
                data = json.loads(f.read_text(encoding='utf-8'))
                name_in_file = get_capture_profile_name(data)
                if normalize_profile_name(name_in_file) == norm_target:
                    if 'metadata' not in data:
                        data['metadata'] = {}
                    data['metadata']['profile_name'] = new_name
                    data['metadata']['user_name'] = new_name
                    f.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
                    updated += 1
            except Exception:
                continue
        print(f'✏️ Perfil renombrado: "{old_name}" → "{new_name}" ({updated} capturas)')
        self._send_json(200, {'ok': True, 'updated': updated, 'newName': new_name})

    def _handle_profiles_delete(self, name: str):
        name = name.strip()
        if not name:
            self._send_json(400, {'ok': False, 'error': 'Falta name'})
            return
        norm_target = normalize_profile_name(name)
        captures_dir = get_captures_dir()
        deleted = 0
        for f in list(captures_dir.glob('*.json')):
            try:
                data = json.loads(f.read_text(encoding='utf-8'))
                name_in_file = get_capture_profile_name(data)
                if normalize_profile_name(name_in_file) == norm_target:
                    f.unlink()
                    deleted += 1
            except Exception:
                continue
        print(f'🗑️ Perfil eliminado: "{name}" ({deleted} capturas)')
        self._send_json(200, {'ok': True, 'deleted': deleted})

    def _handle_garden_rename(self, filename: str, new_name: str):
        if not filename or '..' in filename or '/' in filename or '\\' in filename:
            self._send_json(400, {'ok': False, 'error': 'Nombre de archivo inválido'})
            return

        if not new_name:
            self._send_json(400, {'ok': False, 'error': 'El nuevo nombre no puede estar vacío'})
            return

        captures_dir = get_captures_dir()
        filepath = captures_dir / filename

        if not filepath.exists() or not filepath.is_file():
            self._send_json(404, {'ok': False, 'error': 'Archivo no encontrado'})
            return

        try:
            data = json.loads(filepath.read_text(encoding='utf-8'))
            if 'metadata' not in data:
                data['metadata'] = {}
            data['metadata']['user_name'] = new_name
            filepath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            print(f'✏️ Captura renombrada: {filename} → "{new_name}"')
            self._send_json(200, {'ok': True, 'message': f'Nombre actualizado a "{new_name}".'})
        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {'ok': False, 'error': f'Error al renombrar: {exc}'})


# ══════════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='💫🧠 Servidor unificado: Pulso Neurofuncional + Captura EEG'
    )
    parser.add_argument('--host', default='127.0.0.1', help='Host (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=8090, help='Puerto HTTP (default: 8090)')
    parser.add_argument('--osc-ip', default='0.0.0.0', help='IP OSC para Muse (default: 0.0.0.0 para escuchar en toda la red local)')
    parser.add_argument('--osc-port', type=int, default=5000, help='Puerto OSC para Muse (default: 5000)')
    args = parser.parse_args()

    workspace = Path(__file__).resolve().parent
    os.chdir(workspace)

    global CAPTURE
    CAPTURE = WebCaptureController(osc_ip=args.osc_ip, osc_port=args.osc_port)

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    url = f'http://{args.host}:{args.port}'
    print('═' * 72)
    print('💫🧠 Servidor Unificado — Pulso Neurofuncional + Captura EEG')
    print('═' * 72)
    print(f'  App:     {url}/app/')
    print(f'  Pulse:  {url}/pulse/     (legacy)')
    print(f'  API:     {url}/api/...')
    print(f'  OSC:     Muse en {args.osc_ip}:{args.osc_port}')
    print('═' * 72)
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹️ Servidor detenido.')
    finally:
        CAPTURE.stop_capture()
        server.server_close()


if __name__ == '__main__':
    main()
