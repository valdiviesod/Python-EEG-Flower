#!/usr/bin/env python3
"""
Servidor local para Flor Neurofuncional.

- Sirve la app web en http://127.0.0.1:8000/flower/
- Endpoint POST /api/convert-flower:
    recibe geometría JSON desde el navegador,
    ejecuta la conversión Python 3D,
    devuelve un ZIP con GLB/3MF/STL.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import tempfile
import traceback
import zipfile
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from flower_to_3d_print import convert


def map_formats(format_value: str) -> list[str]:
    mapping = {
        'glb+3mf': ['glb', '3mf'],
        'glb': ['glb'],
        '3mf': ['3mf'],
        'stl': ['stl'],
        'all': ['all'],
    }
    return mapping.get(format_value, ['glb', '3mf'])


class FlowerHandler(SimpleHTTPRequestHandler):
    """HTTP handler: static files + conversion API."""

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/api/convert-flower':
            self._send_json(404, {'error': 'Endpoint no encontrado'})
            return

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

            if not geometry or geometry.get('format') != 'flower-geometry-v1':
                self._send_json(400, {'error': 'Geometría inválida o faltante'})
                return

            formats = map_formats(str(format_value))

            with tempfile.TemporaryDirectory(prefix='flower_convert_') as tmpdir:
                tmp_path = Path(tmpdir)
                json_file = tmp_path / f'flor_neurofuncional_{target_height}mm.json'
                json_file.write_text(json.dumps(geometry, ensure_ascii=False), encoding='utf-8')

                convert(str(json_file), formats=formats, output_dir=str(tmp_path))

                zip_buffer = io.BytesIO()
                with zipfile.ZipFile(zip_buffer, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
                    for out_file in tmp_path.rglob('*'):
                        if out_file.is_file() and out_file != json_file:
                            zf.write(out_file, arcname=out_file.relative_to(tmp_path))

                zip_bytes = zip_buffer.getvalue()
                filename = f"flor_neurofuncional_{target_height}mm_{str(format_value).replace('+', '_')}.zip"

                self.send_response(200)
                self.send_header('Content-Type', 'application/zip')
                self.send_header('Content-Disposition', f'attachment; filename="{filename}"')
                self.send_header('Content-Length', str(len(zip_bytes)))
                self.end_headers()
                self.wfile.write(zip_bytes)

        except Exception as exc:
            traceback.print_exc()
            self._send_json(500, {'error': f'Error en conversión Python: {exc}'})


def main():
    parser = argparse.ArgumentParser(description='Servidor local con conversión Python para Flor 3D')
    parser.add_argument('--host', default='127.0.0.1', help='Host (default: 127.0.0.1)')
    parser.add_argument('--port', type=int, default=8000, help='Puerto (default: 8000)')
    args = parser.parse_args()

    workspace = Path(__file__).resolve().parent
    os.chdir(workspace)

    server = ThreadingHTTPServer((args.host, args.port), FlowerHandler)
    print('=' * 70)
    print('🌸 Flower Local Server iniciado')
    print(f'Web app:   http://{args.host}:{args.port}/flower/')
    print(f'API:       http://{args.host}:{args.port}/api/convert-flower')
    print('Botón 3D:  convierte con Python y descarga ZIP automáticamente')
    print('=' * 70)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹️ Servidor detenido.')
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
