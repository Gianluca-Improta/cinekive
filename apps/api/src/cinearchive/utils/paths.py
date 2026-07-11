"""Volume path helpers with traversal protection and browsable library layout.

On-disk layout (survives Docker restarts — all under ./data):

  data/
    library/
      {project-slug}/
        videos/          # original uploads
        shots/
          {shot-id}/
            keyframe.jpg
            thumb_sm.webp
            thumb_md.webp
            preview.webp
    db/
      cinearchive.db
    qdrant/
    models/
"""

from __future__ import annotations

import re
from pathlib import Path
from uuid import UUID

from cinearchive.config import Settings


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", name.strip().lower()).strip("-")
    return slug or "project"


def library_root(settings: Settings) -> Path:
    custom = (getattr(settings, "library_dir", None) or "").strip()
    if custom:
        return ensure_dir(Path(custom))
    return ensure_dir(Path(settings.videos_dir).parent / "library")


def project_library_dir(settings: Settings, slug: str) -> Path:
    return ensure_dir(library_root(settings) / slug)


def project_video_dir(settings: Settings, slug: str) -> Path:
    """Browsable source media: data/library/{slug}/videos."""
    return ensure_dir(project_library_dir(settings, slug) / "videos")


def project_shots_dir(settings: Settings, slug: str) -> Path:
    """Browsable shot artifacts: data/library/{slug}/shots."""
    return ensure_dir(project_library_dir(settings, slug) / "shots")


def shot_artifact_dir(settings: Settings, slug: str, shot_id: UUID | str) -> Path:
    return ensure_dir(project_shots_dir(settings, slug) / str(shot_id))


def artifacts_base(settings: Settings) -> Path:
    """Root used for relative artifact paths stored in DB (= library root)."""
    return library_root(settings)


def resolve_under(base: Path, relative: str | Path) -> Path:
    """Resolve relative path and ensure it stays under base (no traversal)."""
    base_resolved = base.resolve()
    candidate = (base_resolved / relative).resolve()
    if not str(candidate).startswith(str(base_resolved)):
        raise ValueError(f"Path escapes base directory: {relative}")
    return candidate


def artifact_url(relative_path: str | None) -> str | None:
    if not relative_path:
        return None
    clean = relative_path.replace("\\", "/").lstrip("/")
    return f"/artifacts/{clean}"


def to_relative(base: Path, absolute: Path) -> str:
    return str(absolute.resolve().relative_to(base.resolve())).replace("\\", "/")


# --- Legacy helpers (UUID-based) kept for migration ---

def legacy_project_video_dir(settings: Settings, project_id: UUID) -> Path:
    return Path(settings.videos_dir) / str(project_id)


def legacy_project_artifact_dir(settings: Settings, project_id: UUID) -> Path:
    return Path(settings.artifacts_dir) / str(project_id)
