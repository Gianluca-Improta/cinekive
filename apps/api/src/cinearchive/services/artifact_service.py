"""Artifact serving helpers."""

from __future__ import annotations

from pathlib import Path

from cinearchive.config import Settings
from cinearchive.utils.paths import library_root, resolve_under


def resolve_artifact(settings: Settings, relative_path: str) -> Path:
    """Resolve artifact under library/ (new) or artifacts/ (legacy UUID layout)."""
    rel = relative_path.replace("\\", "/").lstrip("/")

    # New layout: library/{slug}/shots/...
    lib = library_root(settings)
    try:
        candidate = resolve_under(lib, rel)
        if candidate.is_file():
            return candidate
    except ValueError:
        pass

    # Also try if path already includes "library/"
    if rel.startswith("library/"):
        parent = Path(settings.videos_dir).parent
        try:
            candidate = resolve_under(parent, rel)
            if candidate.is_file():
                return candidate
        except ValueError:
            pass

    # Legacy: artifacts/{project_id}/{shot_id}/...
    legacy = Path(settings.artifacts_dir)
    try:
        return resolve_under(legacy, rel)
    except ValueError as exc:
        raise ValueError(str(exc)) from exc
