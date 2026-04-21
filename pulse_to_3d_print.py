#!/usr/bin/env python3
"""
Pulso Neurofuncional → Modelos 3D para Impresión
================================================

Lee el JSON de geometría exportado desde la app web y genera:
  • GLB con colores embebidos (listo para impresoras multicolor / Bambu / Prusa)
  • 3MF con colores embebidos (formato nativo multicolor, mejor soporte slicer)
  • STL por banda + STL completo + manifiesto de colores

Uso:
    python pulse_to_3d_print.py                       # busca el JSON más reciente
    python pulse_to_3d_print.py flor_120mm.json       # archivo específico
    python pulse_to_3d_print.py pulso.json --format glb 3mf stl
    python pulse_to_3d_print.py pulso.json --format all

Requisitos:
    pip install trimesh numpy
    pip install pyglet     # para visualización (opcional)
"""

import sys
import os
import json
import glob
import argparse
import colorsys
import numpy as np

try:
    import trimesh
except ImportError:
    print("❌ Se requiere 'trimesh'. Instálalo con:")
    print("   pip install trimesh numpy")
    sys.exit(1)


# ═══════════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def hex_to_rgba(hex_str, alpha=255):
    """Convierte '#RRGGBB' a (R, G, B, A) enteros 0-255."""
    hex_str = hex_str.lstrip('#')
    r = int(hex_str[0:2], 16)
    g = int(hex_str[2:4], 16)
    b = int(hex_str[4:6], 16)
    return (r, g, b, alpha)


def soften_rgb(rgb):
    """Baja saturación/luz para evitar colores quemados en viewers GLB."""
    r = max(0, min(255, int(rgb[0]))) / 255.0
    g = max(0, min(255, int(rgb[1]))) / 255.0
    b = max(0, min(255, int(rgb[2]))) / 255.0

    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    s = max(0.0, min(1.0, s * 0.78))
    v = max(0.0, min(1.0, v * 0.84))
    rr, gg, bb = colorsys.hsv_to_rgb(h, s, v)

    return [int(rr * 255), int(gg * 255), int(bb * 255)]


def get_mesh_color_hex(mesh):
    """Obtiene color hex de un mesh sin romperse con distintos formatos de vertex_colors."""
    try:
        if mesh.visual and hasattr(mesh.visual, 'vertex_colors'):
            vc = np.asarray(mesh.visual.vertex_colors)
            if vc.size >= 3:
                if vc.ndim == 1:
                    r, g, b = int(vc[0]), int(vc[1]), int(vc[2])
                else:
                    r, g, b = int(vc[0, 0]), int(vc[0, 1]), int(vc[0, 2])
                return f'#{r:02X}{g:02X}{b:02X}'
    except Exception:
        pass
    return '#CCCCCC'


def build_mesh_from_entry(entry):
    """
    Construye un trimesh.Trimesh a partir de un dict con vertices, faces y color.
    Le asigna vertex colors uniformes usando printColorRGB.
    """
    verts = np.array(entry['vertices'], dtype=np.float64)
    faces = np.array(entry['faces'], dtype=np.int64)

    if verts.ndim == 1:
        if verts.size % 3 != 0:
            return None
        verts = verts.reshape((-1, 3))
    elif verts.ndim == 2 and verts.shape[1] >= 3:
        verts = verts[:, :3]
    else:
        return None

    if faces.ndim == 1:
        if faces.size % 3 != 0:
            return None
        faces = faces.reshape((-1, 3))
    elif faces.ndim == 2 and faces.shape[1] >= 3:
        faces = faces[:, :3]
    else:
        return None

    if len(verts) == 0 or len(faces) == 0:
        return None

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mesh.remove_unreferenced_vertices()
    try:
        mesh.fix_normals()
    except Exception:
        pass

    # Asignar color suavizado para impresión/render estable
    rgb_raw = entry.get('printColorRGB', [200, 200, 200])
    rgb = soften_rgb(rgb_raw)
    color = np.array([rgb[0], rgb[1], rgb[2], 255], dtype=np.uint8)

    # Colores por cara/vertice para compatibilidad amplia
    mesh.visual = trimesh.visual.ColorVisuals(
        mesh=mesh,
        vertex_colors=np.tile(color, (len(mesh.vertices), 1)),
        face_colors=np.tile(color, (len(mesh.faces), 1))
    )

    # Material PBR doble cara para evitar pérdida de color desde vista superior
    mesh.visual.material = trimesh.visual.material.PBRMaterial(
        name=entry.get('name', 'pulse_part'),
        baseColorFactor=[rgb[0], rgb[1], rgb[2], 255],
        metallicFactor=0.0,
        roughnessFactor=0.88,
        emissiveFactor=[0.0, 0.0, 0.0],
        doubleSided=True,
    )

    return mesh


def find_latest_geometry_json(search_dir=None):
    """Busca el JSON de geometría más reciente en la carpeta de Descargas o CWD."""
    search_dirs = []
    if search_dir:
        search_dirs.append(search_dir)

    # Agregar carpeta de descargas del usuario
    home = os.path.expanduser('~')
    downloads = os.path.join(home, 'Downloads')
    if os.path.isdir(downloads):
        search_dirs.append(downloads)

    # Carpeta actual
    search_dirs.append(os.getcwd())

    # Buscar archivos que coincidan
    candidates = []
    for d in search_dirs:
        pattern = os.path.join(d, 'pulso_neurofuncional_*mm.json')
        candidates.extend(glob.glob(pattern))

    if not candidates:
        return None

    # Ordenar por fecha de modificación (más reciente primero)
    candidates.sort(key=os.path.getmtime, reverse=True)
    return candidates[0]


def validate_geometry_json(data):
    """Valida que el JSON tenga el formato esperado."""
    if data.get('format') != 'pulse-geometry-v1':
        raise ValueError(
            f"Formato no reconocido: '{data.get('format')}'. "
            f"Se esperaba 'pulse-geometry-v1'.\n"
            f"¿Exportaste el JSON desde la pestaña 3D de la app web?"
        )
    if 'meshes' not in data or len(data['meshes']) == 0:
        raise ValueError("El JSON no contiene meshes. Exporta de nuevo desde la app web.")
    return True


# ═══════════════════════════════════════════════════════════════════════════════
# Exporters
# ═══════════════════════════════════════════════════════════════════════════════

def export_glb(meshes_by_part, output_path, data):
    """Exporta un GLB con colores embebidos - listo para impresión multicolor."""
    scene = trimesh.Scene()

    for part_name, mesh in meshes_by_part.items():
        if mesh is not None:
            scene.add_geometry(mesh, node_name=part_name)

    scene.export(output_path, file_type='glb')
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  ✅ GLB: {output_path} ({size_mb:.2f} MB)")
    print(f"     → Abre en Bambu Studio, PrusaSlicer u OrcaSlicer")
    print(f"     → Los colores ya están integrados en el modelo")


def export_3mf(meshes_by_part, output_path, data):
    """Exporta un 3MF con colores embebidos - formato nativo multicolor."""
    scene = trimesh.Scene()

    for part_name, mesh in meshes_by_part.items():
        if mesh is not None:
            scene.add_geometry(mesh, node_name=part_name)

    try:
        scene.export(output_path, file_type='3mf')
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"  ✅ 3MF: {output_path} ({size_mb:.2f} MB)")
        print(f"     → Formato nativo para Bambu Studio y PrusaSlicer")
        print(f"     → Colores y materiales integrados")
    except Exception as e:
        print(f"  ⚠️  3MF falló ({e}), intentando alternativa...")
        # Fallback: exportar como GLB si 3MF no está disponible
        alt_path = output_path.replace('.3mf', '.glb')
        scene.export(alt_path, file_type='glb')
        print(f"  ✅ GLB alternativo: {alt_path}")


def export_stl(meshes_by_part, output_dir, base_name, data):
    """
    Exporta STLs separados por parte + un STL completo + manifiesto JSON.
    """
    os.makedirs(output_dir, exist_ok=True)

    # STL completo (todas las partes combinadas)
    all_meshes = [m for m in meshes_by_part.values() if m is not None]
    if all_meshes:
        combined = trimesh.util.concatenate(all_meshes)
        full_path = os.path.join(output_dir, f"{base_name}_full.stl")
        combined.export(full_path, file_type='stl')
        size_mb = os.path.getsize(full_path) / (1024 * 1024)
        print(f"  ✅ STL completo: {full_path} ({size_mb:.2f} MB)")

    # STLs individuales por parte
    stl_files = []
    for part_name, mesh in meshes_by_part.items():
        if mesh is None:
            continue
        filename = f"{base_name}_{part_name}.stl"
        filepath = os.path.join(output_dir, filename)
        mesh.export(filepath, file_type='stl')
        size_kb = os.path.getsize(filepath) / 1024

        # Determinar color de esta parte
        color_hex = get_mesh_color_hex(mesh)

        stl_files.append({
            'part': part_name,
            'file': filename,
            'color': color_hex,
            'sizeKB': round(size_kb, 1),
        })
        print(f"     📄 {filename} ({size_kb:.1f} KB) → color {color_hex}")

    # Manifiesto
    manifest = {
        'format': 'stl-multicolor-print-v1',
        'note': 'Carga cada STL como pieza separada en el slicer y asigna el color indicado.',
        'units': 'mm',
        'targetHeightMm': data.get('targetHeightMm', 120),
        'files': stl_files,
        'bands': data.get('bands', []),
    }
    manifest_path = os.path.join(output_dir, f"{base_name}_manifest.json")
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    print(f"  📋 Manifiesto: {manifest_path}")


# ═══════════════════════════════════════════════════════════════════════════════
# Main Pipeline
# ═══════════════════════════════════════════════════════════════════════════════

def build_meshes_from_json(data):
    """
    Construye los meshes agrupados por parte (estructura vs bandas EEG).
    Retorna un dict: { 'structure': mesh, 'delta': mesh, 'theta': mesh, ... }
    """
    meshes_by_part = {}
    part_meshes = {}  # part_key → list of trimesh

    for entry in data['meshes']:
        mesh = build_mesh_from_entry(entry)
        if mesh is None:
            continue

        ud = entry.get('userData', {})
        if ud.get('type') == 'petal' and ud.get('bandKey'):
            key = ud['bandKey']
        else:
            key = 'structure'

        if key not in part_meshes:
            part_meshes[key] = []
        part_meshes[key].append(mesh)

    # Concatenar meshes del mismo grupo
    for key, mesh_list in part_meshes.items():
        if len(mesh_list) == 1:
            meshes_by_part[key] = mesh_list[0]
        else:
            meshes_by_part[key] = trimesh.util.concatenate(mesh_list)

    return meshes_by_part


def convert(json_path, formats=None, output_dir=None):
    """Pipeline principal de conversión."""
    if formats is None:
        formats = ['glb', '3mf']

    print(f"\n{'═' * 60}")
    print(f"  💫 Pulso Neurofuncional → Impresión 3D")
    print(f"{'═' * 60}")
    print(f"  📂 Archivo: {json_path}")

    # Leer JSON
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    validate_geometry_json(data)

    height_mm = data.get('targetHeightMm', 120)
    mesh_count = data.get('meshCount', 0)
    bands = data.get('bands', [])

    print(f"  📐 Altura: {height_mm} mm")
    print(f"  🔷 Meshes: {mesh_count}")
    print(f"  🎨 Bandas: {', '.join(b['name'] for b in bands)}")
    print()

    # Construir meshes
    print("  🔨 Construyendo geometría 3D...")
    meshes_by_part = build_meshes_from_json(data)
    total_faces = sum(len(m.faces) for m in meshes_by_part.values() if m is not None)
    total_verts = sum(len(m.vertices) for m in meshes_by_part.values() if m is not None)
    print(f"     {len(meshes_by_part)} partes | {total_verts:,} vértices | {total_faces:,} caras")

    # Mostrar partes y colores
    print("\n  🎨 Partes del modelo:")
    for name, mesh in meshes_by_part.items():
        if mesh is None:
            continue
        color_str = f' → {get_mesh_color_hex(mesh)}'
        print(f"     • {name}: {len(mesh.faces)} caras{color_str}")

    # Directorio de salida
    if output_dir is None:
        output_dir = os.path.dirname(json_path) or os.getcwd()

    base_name = f"pulso_neurofuncional_{height_mm}mm"

    print(f"\n  📦 Exportando formatos: {', '.join(f.upper() for f in formats)}")
    print()

    # Exportar según formatos solicitados
    if 'glb' in formats or 'all' in formats:
        glb_path = os.path.join(output_dir, f"{base_name}.glb")
        export_glb(meshes_by_part, glb_path, data)

    if '3mf' in formats or 'all' in formats:
        mf_path = os.path.join(output_dir, f"{base_name}.3mf")
        export_3mf(meshes_by_part, mf_path, data)

    if 'stl' in formats or 'all' in formats:
        stl_dir = os.path.join(output_dir, f"{base_name}_stl")
        export_stl(meshes_by_part, stl_dir, base_name, data)

    print(f"\n{'─' * 60}")
    print(f"  ✅ ¡Listo! Archivos guardados en:")
    print(f"     {output_dir}")
    print()
    print(f"  📖 Instrucciones:")
    print(f"     1. Abre Bambu Studio / PrusaSlicer / OrcaSlicer")
    print(f"     2. Importa el archivo .GLB o .3MF")
    print(f"     3. Los colores de cada banda EEG ya están asignados")
    print(f"     4. Ajusta los filamentos/colores en tu impresora")
    print(f"     5. ¡Imprime tu pulso neurofuncional!")
    print(f"{'═' * 60}\n")


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='💫 Convierte la geometría de la Pulso Neurofuncional a modelos 3D imprimibles',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python pulse_to_3d_print.py                          # Auto-busca el JSON más reciente
  python pulse_to_3d_print.py flor_120mm.json          # Archivo específico
  python pulse_to_3d_print.py pulso.json --format glb   # Solo GLB
  python pulse_to_3d_print.py pulso.json --format all   # Todos los formatos
        """
    )
    parser.add_argument(
        'json_file', nargs='?', default=None,
        help='Archivo JSON de geometría (exportado desde la app web). Si no se indica, busca el más reciente.'
    )
    parser.add_argument(
        '--format', '-f', nargs='+',
        choices=['glb', '3mf', 'stl', 'all'],
        default=['glb', '3mf'],
        help='Formatos de salida (default: glb 3mf)'
    )
    parser.add_argument(
        '--output', '-o', default=None,
        help='Directorio de salida (default: misma carpeta del JSON)'
    )

    args = parser.parse_args()

    # Buscar archivo JSON
    json_path = args.json_file
    if json_path is None:
        json_path = find_latest_geometry_json()
        if json_path is None:
            print("\n❌ No se encontró un archivo de geometría JSON.")
            print("   Primero exporta desde la app web (pestaña 3D → botón de exportar)")
            print("   El archivo se descargará como 'pulso_neurofuncional_XXXmm.json'")
            sys.exit(1)
        print(f"\n🔍 Encontrado automáticamente: {json_path}")

    if not os.path.isfile(json_path):
        print(f"\n❌ Archivo no encontrado: {json_path}")
        sys.exit(1)

    convert(json_path, formats=args.format, output_dir=args.output)


if __name__ == '__main__':
    main()
