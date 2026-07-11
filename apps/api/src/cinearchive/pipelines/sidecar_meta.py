"""Write portable shot metadata next to source media.

Each still/video gets a sibling ``*.cinekive.json`` so the archive stays useful
outside this app (Bridge, Finder tags, custom scripts, etc.).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

SCHEMA = "cinekive.shot/v1"


def aspect_label(width: int | None, height: int | None) -> str | None:
    if not width or not height or height <= 0:
        return None
    r = width / height
    buckets = [
        (0.56, "9:16"),
        (0.8, "4:5"),
        (1.05, "1:1"),
        (1.4, "4:3"),
        (1.85, "16:9"),
        (2.2, "1.85:1"),
        (2.5, "2.39:1"),
    ]
    for limit, label in buckets:
        if r <= limit:
            return label
    return "ultrawide"


def shot_to_sidecar(shot: Any) -> dict[str, Any]:
    w = getattr(shot, "width", None)
    h = getattr(shot, "height", None)
    return {
        "schema": SCHEMA,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "id": str(getattr(shot, "id", "")),
        "source": {
            "type": getattr(shot, "source_type", None),
            "path": getattr(shot, "source_path", None),
            "filename": getattr(shot, "source_filename", None),
            "title": getattr(shot, "source_title", None),
            "meta": dict(getattr(shot, "source_meta_json", None) or {}),
        },
        "geometry": {
            "width": w,
            "height": h,
            "aspect_ratio": aspect_label(w, h),
        },
        "craft": {
            "shot_type": getattr(shot, "shot_type", None),
            "camera_movement": getattr(shot, "camera_movement", None),
            "camera_angle": getattr(shot, "camera_angle", None),
            "lighting_style": getattr(shot, "lighting_style", None),
            "composition": getattr(shot, "composition", None),
            "subject": getattr(shot, "subject", None),
            "lens_look": getattr(shot, "lens_look", None),
            "color_grade": getattr(shot, "color_grade", None),
            "techniques": list(getattr(shot, "techniques_json", None) or []),
            "shapes": list(getattr(shot, "shapes_json", None) or []),
        },
        "story": {
            "mood_vibe": getattr(shot, "mood_vibe", None),
            "emotion": getattr(shot, "emotion", None),
            "creative_intent": getattr(shot, "creative_intent", None),
            "theme": getattr(shot, "theme", None),
            "genre": getattr(shot, "genre", None),
            "era": getattr(shot, "era", None),
            "visual_style": getattr(shot, "visual_style", None),
            "content_format": getattr(shot, "content_format", None),
        },
        "tags": list(getattr(shot, "tags_json", None) or []),
        "flags": {
            "is_hero": bool(getattr(shot, "is_hero", False)),
            "is_favorite": bool(getattr(shot, "is_favorite", False)),
            "is_moving": bool(getattr(shot, "is_moving", False)),
            "hero_score": getattr(shot, "hero_score", None),
        },
        "timing": {
            "start_ms": getattr(shot, "start_timecode_ms", None),
            "end_ms": getattr(shot, "end_timecode_ms", None),
            "keyframe_ms": getattr(shot, "keyframe_ms", None),
            "duration_ms": getattr(shot, "duration_ms", None),
        },
        "enrichment_version": getattr(shot, "enrichment_version", 0),
    }


def sidecar_path_for(source_path: str | Path) -> Path:
    p = Path(source_path)
    return p.with_name(f"{p.stem}.cinekive.json")


def write_shot_sidecar(shot: Any) -> Path | None:
    """Write/update sidecar beside the source file. Returns path or None on skip/fail."""
    source = getattr(shot, "source_path", None)
    if not source:
        return None
    path = Path(source)
    if not path.exists():
        # Still write next to the declared path so offline archives stay consistent
        pass
    out = sidecar_path_for(path)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        payload = shot_to_sidecar(shot)
        out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return out
    except Exception as exc:
        logger.warning("Sidecar write failed for %s: %s", source, exc)
        return None
