"""Library storage + export quality + install prefs (dedupe).

Persisted at {models_dir}/library_runtime.json so Settings can change max edge,
JPEG quality, Real-ESRGAN export upscale, and dedupe without restarting the API.

Dedupe is version-gated:
  - First boot on an empty library → dedupe on (new-install default).
  - First boot when SQLite already has content → freeze whatever env/compose
    currently resolves to (never silently flip an existing library).
  - After that, Settings → Advanced owns the toggle.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import text

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

MaxEdge = Literal[960, 1280, 1600, 2048, 0]  # 0 = keep original
UpscaleScale = Literal[1, 2, 4]
# Bump when changing new-install defaults (does not rewrite existing prefs).
DEFAULTS_SCHEMA_VERSION = 1


class ArchiveStorageOverride(BaseModel):
    """Optional per-archive overrides (project id keyed)."""

    max_edge: int | None = None
    jpeg_quality: int | None = Field(default=None, ge=40, le=98)
    export_upscale: int | None = Field(default=None, ge=1, le=4)


class LibraryRuntimeConfig(BaseModel):
    """Store lean keyframes in the library; upscale on export when needed."""

    # Longest edge for stored keyframes (0 = original). Default 1600 keeps libraries small.
    max_edge: int = 1600
    jpeg_quality: int = Field(default=85, ge=40, le=98)
    # Export: 1 = as stored, 2/4 = Real-ESRGAN when binary available
    export_upscale: UpscaleScale = 1
    realesrgan_enabled: bool = True
    # Optional path to realesrgan-ncnn-vulkan (or realesrgan-ncnn-vulkan.exe)
    realesrgan_bin: str | None = None
    archives: dict[str, ArchiveStorageOverride] = Field(default_factory=dict)

    # --- Install prefs (version-gated; see bootstrap_dedupe_prefs) ---
    defaults_schema_version: int = DEFAULTS_SCHEMA_VERSION
    dedupe_prefs_initialized: bool = False
    dedupe_on_ingest: bool = True
    dedupe_global: bool = True


def _path(settings: Settings) -> Path:
    return Path(settings.models_dir) / "library_runtime.json"


def load_library(settings: Settings) -> LibraryRuntimeConfig:
    path = _path(settings)
    if not path.is_file():
        return LibraryRuntimeConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return LibraryRuntimeConfig.model_validate(data)
    except Exception as exc:
        logger.warning("library_runtime load failed: %s", exc)
        return LibraryRuntimeConfig()


def save_library(settings: Settings, cfg: LibraryRuntimeConfig) -> LibraryRuntimeConfig:
    path = _path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
    return cfg


def merge_library(settings: Settings, patch: dict[str, Any]) -> LibraryRuntimeConfig:
    current = load_library(settings)
    data = current.model_dump()
    for key, val in patch.items():
        if key == "archives" and isinstance(val, dict):
            archives = dict(data.get("archives") or {})
            for aid, ov in val.items():
                if ov is None:
                    archives.pop(str(aid), None)
                    continue
                prev = dict(archives.get(str(aid)) or {})
                if isinstance(ov, dict):
                    prev.update({k: v for k, v in ov.items() if v is not None})
                archives[str(aid)] = prev
            data["archives"] = archives
        elif val is not None:
            data[key] = val
    # Explicit toggle from Settings always marks prefs initialized
    if "dedupe_on_ingest" in patch or "dedupe_global" in patch:
        data["dedupe_prefs_initialized"] = True
    cfg = LibraryRuntimeConfig.model_validate(data)
    return save_library(settings, cfg)


def resolve_for_archive(
    settings: Settings, project_id: str | None = None
) -> tuple[int, int, int]:
    """Return (max_edge, jpeg_quality, export_upscale) for ingest/export."""
    cfg = load_library(settings)
    max_edge = int(cfg.max_edge or 0)
    quality = int(cfg.jpeg_quality or 85)
    upscale = int(cfg.export_upscale or 1)
    if project_id and project_id in cfg.archives:
        ov = cfg.archives[project_id]
        if ov.max_edge is not None:
            max_edge = int(ov.max_edge)
        if ov.jpeg_quality is not None:
            quality = int(ov.jpeg_quality)
        if ov.export_upscale is not None:
            upscale = int(ov.export_upscale)
    return max_edge, quality, upscale


def resolve_dedupe(settings: Settings) -> tuple[bool, bool]:
    """Effective (dedupe_on_ingest, dedupe_global) after prefs bootstrap."""
    cfg = load_library(settings)
    if cfg.dedupe_prefs_initialized:
        return bool(cfg.dedupe_on_ingest), bool(cfg.dedupe_global)
    return bool(settings.dedupe_on_ingest), bool(settings.dedupe_global)


async def _sqlite_has_content(settings: Settings) -> bool:
    """True when this machine already has projects or shots (existing install)."""
    try:
        from cinearchive.db.session import SessionLocal

        async with SessionLocal() as session:
            projects = await session.execute(text("SELECT COUNT(*) FROM projects"))
            if int(projects.scalar() or 0) > 0:
                return True
            shots = await session.execute(
                text("SELECT COUNT(*) FROM shots WHERE deleted_at IS NULL")
            )
            return int(shots.scalar() or 0) > 0
    except Exception as exc:
        logger.debug("library content probe failed: %s", exc)
        # If DB is unreadable but file exists and is non-trivial, treat as existing.
        try:
            db_path = settings.database_url.split("///")[-1]
            if db_path and not db_path.startswith("http"):
                p = Path(db_path)
                if p.is_file() and p.stat().st_size > 4096:
                    return True
        except Exception:
            pass
        return False


async def bootstrap_dedupe_prefs(settings: Settings) -> LibraryRuntimeConfig:
    """Freeze dedupe once per library. Safe to call on every startup."""
    cfg = load_library(settings)
    if cfg.dedupe_prefs_initialized:
        return cfg

    existing = await _sqlite_has_content(settings)
    if existing:
        on_ingest = bool(settings.dedupe_on_ingest)
        global_ = bool(settings.dedupe_global)
        source = "preserved_existing_library"
    else:
        on_ingest = True
        global_ = True
        source = "new_install_default"

    cfg.dedupe_on_ingest = on_ingest
    cfg.dedupe_global = global_
    cfg.dedupe_prefs_initialized = True
    cfg.defaults_schema_version = DEFAULTS_SCHEMA_VERSION
    save_library(settings, cfg)
    logger.info(
        "Dedupe prefs initialized (%s): on_ingest=%s global=%s",
        source,
        on_ingest,
        global_,
    )
    return cfg
