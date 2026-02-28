#!/usr/bin/env python3
"""
Servidor local para Visualización EEG (viz) conectada con muse_capture.py.

Expone:
- App web en /viz/
- API para captura en tiempo real, captura con duración personalizada,
  descarga JSON y conversión JSON -> MIDI.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
import time
import traceback
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlparse

import numpy as np

from muse_capture import MuseOSCToMidi


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

                keep = 12000
                if len(converter.timestamps) > keep:
                    converter.timestamps = converter.timestamps[-keep:]
                    for channel in range(4):
                        converter.eeg_data[channel] = converter.eeg_data[channel][-keep:]

        return handler

    def start_capture(self, duration_seconds: float | None = None):
        with self.lock:
            if self.running:
                raise RuntimeError('Ya hay una captura en curso')

            previous_converter = self.converter
            self.converter = None

        self._close_converter_resources(previous_converter)

        last_error = None
        for attempt in range(2):
            converter = MuseOSCToMidi(osc_ip=self.osc_ip, osc_port=self.osc_port)
            converter.debug_handler = lambda *args, **kwargs: None
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

    def _build_capture_payload_locked(self) -> dict:
        converter = self.converter
        if not converter:
            return {
                'metadata': {
                    'duration_seconds': 0.0,
                    'total_samples': 0,
                    'sample_rate_hz': 0.0,
                    'channels': 4,
                    'capture_timestamp': '',
                    'start_time': None,
                    'end_time': None,
                },
                'eeg_channels': {
                    'channel_1': [],
                    'channel_2': [],
                    'channel_3': [],
                    'channel_4': [],
                },
                'timestamps': [],
                'statistics': {},
            }

        synced_len = min(
            len(converter.timestamps),
            len(converter.eeg_data[0]),
            len(converter.eeg_data[1]),
            len(converter.eeg_data[2]),
            len(converter.eeg_data[3]),
        )

        timestamps = converter.timestamps[:synced_len]
        eeg_channels = {
            'channel_1': converter.eeg_data[0][:synced_len],
            'channel_2': converter.eeg_data[1][:synced_len],
            'channel_3': converter.eeg_data[2][:synced_len],
            'channel_4': converter.eeg_data[3][:synced_len],
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
                    'min': float(arr.min()),
                    'max': float(arr.max()),
                    'mean': float(arr.mean()),
                    'std': float(arr.std()),
                    'samples_count': int(arr.size),
                    'last': float(arr[-1]),
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
            },
            'eeg_channels': eeg_channels,
            'timestamps': timestamps,
            'statistics': stats,
        }

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
                'channel_1': eeg_channels['channel_1'][start_index:end_index],
                'channel_2': eeg_channels['channel_2'][start_index:end_index],
                'channel_3': eeg_channels['channel_3'][start_index:end_index],
                'channel_4': eeg_channels['channel_4'][start_index:end_index],
            }

            latest = {
                key: (vals[-1] if vals else 0.0)
                for key, vals in eeg_channels.items()
            }

            return {
                'startIndex': start_index,
                'endIndex': end_index,
                'totalSamples': total,
                'running': self.running,
                'finished': (not self.running and total > 0),
                'timestamps': payload['timestamps'][start_index:end_index],
                'eeg_channels': stream_channels,
                'latest': latest,
                'metadata': payload['metadata'],
                'statistics': payload['statistics'],
            }


CAPTURE = WebCaptureController()


class VizHandler(SimpleHTTPRequestHandler):
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

    def do_POST(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/capture/start':
            try:
                body = self._read_json_body()
                duration = body.get('durationSeconds')
                duration_value = float(duration) if duration not in (None, '', 0) else None
                CAPTURE.start_capture(duration_value)
                self._send_json(200, {
                    'ok': True,
                    'message': 'Captura iniciada',
                    'durationSeconds': duration_value,
                })
            except RuntimeError as exc:
                self._send_json(409, {'ok': False, 'error': str(exc)})
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': f'No se pudo iniciar captura: {exc}'})
            return

        if parsed.path == '/api/capture/stop':
            try:
                CAPTURE.stop_capture()
                self._send_json(200, {'ok': True, 'message': 'Captura detenida'})
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': f'No se pudo detener captura: {exc}'})
            return

        if parsed.path == '/api/json-to-midi':
            try:
                body = self._read_json_body()
                json_data = body.get('jsonData')
                if not json_data or 'eeg_channels' not in json_data or 'metadata' not in json_data:
                    self._send_json(400, {'ok': False, 'error': 'JSON EEG inválido'})
                    return

                with tempfile.TemporaryDirectory(prefix='viz_json_to_midi_') as tmpdir:
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
                    filename = f"eeg_{int(time.time())}.mid"

                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/midi')
                    self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                    self.send_header('Content-Length', str(len(midi_bytes)))
                    self.end_headers()
                    self.wfile.write(midi_bytes)

            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': f'Error en conversión JSON a MIDI: {exc}'})
            return

        self._send_json(404, {'ok': False, 'error': 'Endpoint no encontrado'})

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == '/api/capture/status':
            try:
                self._send_json(200, CAPTURE.get_status())
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        if parsed.path == '/api/capture/stream':
            try:
                query = parse_qs(parsed.query)
                from_index = int(query.get('from', ['0'])[0])
                self._send_json(200, CAPTURE.get_stream(from_index))
            except Exception as exc:
                traceback.print_exc()
                self._send_json(500, {'ok': False, 'error': str(exc)})
            return

        if parsed.path == '/api/capture/download-json':
            try:
                payload = CAPTURE.get_status()
                body = json.dumps(payload, ensure_ascii=False, indent=2).encode('utf-8')
                filename = f"eeg_capture_{int(time.time())}.json"

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

        super().do_GET()


def main():
    parser = argparse.ArgumentParser(description='Servidor local para viz + Muse OSC')
    parser.add_argument('--host', default='127.0.0.1', help='Host (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=8010, help='Puerto HTTP (default: 8010)')
    parser.add_argument('--osc-ip', default='0.0.0.0', help='IP OSC para Muse (default: 0.0.0.0 para escuchar en toda la red local)')
    parser.add_argument('--osc-port', type=int, default=5000, help='Puerto OSC para Muse (default: 5000)')
    args = parser.parse_args()

    workspace = Path(__file__).resolve().parent
    os.chdir(workspace)

    global CAPTURE
    CAPTURE = WebCaptureController(osc_ip=args.osc_ip, osc_port=args.osc_port)

    server = ThreadingHTTPServer((args.host, args.port), VizHandler)
    print('=' * 72)
    print('🧠 Viz Local Server iniciado')
    print(f'UI:   http://{args.host}:{args.port}/viz/')
    print(f'API:  http://{args.host}:{args.port}/api/capture/status')
    print(f'OSC:  escucha Muse en {args.osc_ip}:{args.osc_port}')
    print('=' * 72)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹️ Servidor detenido.')
    finally:
        CAPTURE.stop_capture()
        server.server_close()


if __name__ == '__main__':
    main()
