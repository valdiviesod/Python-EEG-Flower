#!/usr/bin/env python3
"""Helpers para guardar JSON en una ruta siempre escribible."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Iterable


def _is_writable_dir(path: Path) -> bool:
    """Retorna True si se puede escribir en la carpeta dada."""
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def first_writable_dir(candidates: Iterable[Path]) -> Path:
    """Retorna la primera carpeta escribible de una lista de candidatas."""
    for candidate in candidates:
        if _is_writable_dir(candidate):
            return candidate
    raise PermissionError("No se encontró ninguna carpeta escribible para guardar JSON.")


def default_json_dirs(app_name: str = "captura_eeg", subdir: str = "captures") -> list[Path]:
    """Rutas de respaldo para guardar JSON en Windows/Linux/macOS."""
    home_dir = Path.home() / app_name / subdir
    local_appdata = os.getenv("LOCALAPPDATA")
    local_dir = (
        Path(local_appdata) / app_name / subdir
        if local_appdata
        else Path.home() / "AppData" / "Local" / app_name / subdir
    )
    temp_dir = Path(tempfile.gettempdir()) / app_name / subdir
    return [home_dir, local_dir, temp_dir]


def write_json_with_fallback(
    payload: dict,
    target_file: str | Path | None = None,
    *,
    filename: str = "capture.json",
    extra_dirs: Iterable[Path] | None = None,
    indent: int = 2,
) -> Path:
    """
    Guarda un JSON en la ruta preferida si se puede, y si no, usa fallbacks.

    Retorna la ruta final en la que se guardó.
    """
    candidates: list[Path] = []

    if target_file:
        target = Path(target_file)
        candidates.append(target)

    if extra_dirs:
        for d in extra_dirs:
            candidates.append(Path(d) / filename)

    for d in default_json_dirs():
        candidates.append(d / filename)

    serialized = json.dumps(payload, ensure_ascii=False, indent=indent)
    last_error: Exception | None = None

    for path in candidates:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(serialized, encoding="utf-8")
            return path
        except OSError as exc:
            last_error = exc
            continue

    if last_error:
        raise last_error
    raise PermissionError("No se pudo guardar el JSON en ninguna ruta candidata.")
