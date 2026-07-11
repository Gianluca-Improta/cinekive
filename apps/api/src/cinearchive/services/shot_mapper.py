"""Shot DTO helpers."""

from __future__ import annotations

from pathlib import Path

from cinearchive.db.models.shot import Shot
from cinearchive.pipelines.tag_quality import link_hints, score_enrichment
from cinearchive.pipelines.vlm_enrichment import source_title_from_path
from cinearchive.schemas.shot import DominantColor, ShotRead
from cinearchive.utils.paths import artifact_url


def _filename(shot: Shot) -> str:
    if getattr(shot, "source_filename", None):
        return shot.source_filename or ""
    return Path(shot.source_path).name


def shot_payload(shot: Shot, source_filename: str | None = None) -> dict:
    colors = shot.dominant_colors_json or []
    fname = source_filename or _filename(shot)
    return {
        "shot_id": shot.id,
        "project_id": shot.project_id,
        "source_type": shot.source_type,
        "source_filename": fname,
        "source_title": getattr(shot, "source_title", None) or source_title_from_path(fname),
        "film_title": (shot.source_meta_json or {}).get("film_title")
        or (shot.source_meta_json or {}).get("movie_title")
        or None,
        "scene_index": shot.scene_index,
        "start_timecode_ms": shot.start_timecode_ms,
        "end_timecode_ms": shot.end_timecode_ms,
        "keyframe_ms": getattr(shot, "keyframe_ms", None),
        "source_fps": getattr(shot, "source_fps", None),
        "collection_id": getattr(shot, "collection_id", None),
        "dialogue_text": getattr(shot, "dialogue_text", None),
        "width": shot.width,
        "height": shot.height,
        "has_preview": shot.has_preview,
        "dominant_colors": colors,
        "dominant_color_hex": [c.get("hex") for c in colors if c.get("hex")],
        "created_at": shot.created_at.isoformat() if shot.created_at else None,
        "shot_type": shot.shot_type,
        "camera_movement": shot.camera_movement,
        "camera_angle": getattr(shot, "camera_angle", None),
        "lighting_style": shot.lighting_style,
        "composition": getattr(shot, "composition", None),
        "subject": getattr(shot, "subject", None),
        "lens_look": getattr(shot, "lens_look", None),
        "color_grade": getattr(shot, "color_grade", None),
        "mood_vibe": shot.mood_vibe,
        "content_format": getattr(shot, "content_format", None),
        "emotion": getattr(shot, "emotion", None),
        "era": getattr(shot, "era", None),
        "origin": getattr(shot, "origin", None),
        "ism": getattr(shot, "ism", None),
        "director": (shot.source_meta_json or {}).get("director"),
        "visual_style": getattr(shot, "visual_style", None),
        "theme": getattr(shot, "theme", None),
        "genre": getattr(shot, "genre", None),
        "shapes": list(getattr(shot, "shapes_json", None) or []),
        "tags": list(shot.tags_json or []),
        "techniques": list(getattr(shot, "techniques_json", None) or []),
        "enrichment_version": shot.enrichment_version or 0,
        "enrichment_quality": (shot.source_meta_json or {}).get("enrichment_quality")
        or score_enrichment(shot),
        "link_hints": (shot.source_meta_json or {}).get("link_hints") or link_hints(shot),
        "is_favorite": bool(shot.is_favorite),
        "is_hero": bool(getattr(shot, "is_hero", False)),
        "is_moving": bool(getattr(shot, "is_moving", False)),
        "is_duplicate": bool(getattr(shot, "is_duplicate", False)),
        "sequence_id": getattr(shot, "sequence_id", None),
        "frame_role": getattr(shot, "frame_role", None),
        "hero_score": float(getattr(shot, "hero_score", 0) or 0),
        "creative_intent": shot.creative_intent,
    }


def shot_to_read(shot: Shot) -> ShotRead:
    colors = []
    for c in shot.dominant_colors_json or []:
        try:
            colors.append(DominantColor(**c))
        except Exception:
            continue
    fname = _filename(shot)
    return ShotRead(
        id=shot.id,  # type: ignore[arg-type]
        project_id=shot.project_id,  # type: ignore[arg-type]
        source_type=shot.source_type,  # type: ignore[arg-type]
        source_path=shot.source_path,
        source_filename=fname or None,
        source_title=getattr(shot, "source_title", None) or source_title_from_path(fname),
        source_meta=dict(getattr(shot, "source_meta_json", None) or {}),
        scene_index=shot.scene_index,
        start_timecode_ms=shot.start_timecode_ms,
        end_timecode_ms=shot.end_timecode_ms,
        duration_ms=shot.duration_ms,
        keyframe_ms=getattr(shot, "keyframe_ms", None),
        source_fps=getattr(shot, "source_fps", None),
        collection_id=getattr(shot, "collection_id", None),  # type: ignore[arg-type]
        dialogue=getattr(shot, "dialogue_json", None),
        dialogue_text=getattr(shot, "dialogue_text", None),
        width=shot.width,
        height=shot.height,
        dominant_colors=colors,
        has_preview=shot.has_preview,
        thumb_url=artifact_url(shot.thumb_sm_path) or "",
        thumb_md_url=artifact_url(shot.thumb_md_path) or "",
        preview_url=artifact_url(shot.preview_path),
        keyframe_url=artifact_url(shot.keyframe_path) or "",
        shot_type=getattr(shot, "shot_type", None),
        camera_movement=getattr(shot, "camera_movement", None),
        camera_angle=getattr(shot, "camera_angle", None),
        lighting_style=getattr(shot, "lighting_style", None),
        composition=getattr(shot, "composition", None),
        subject=getattr(shot, "subject", None),
        lens_look=getattr(shot, "lens_look", None),
        color_grade=getattr(shot, "color_grade", None),
        mood_vibe=getattr(shot, "mood_vibe", None),
        creative_intent=getattr(shot, "creative_intent", None),
        content_format=getattr(shot, "content_format", None),
        emotion=getattr(shot, "emotion", None),
        era=getattr(shot, "era", None),
        origin=getattr(shot, "origin", None),
        ism=getattr(shot, "ism", None),
        director=(getattr(shot, "source_meta_json", None) or {}).get("director"),
        visual_style=getattr(shot, "visual_style", None),
        theme=getattr(shot, "theme", None),
        genre=getattr(shot, "genre", None),
        shapes=list(getattr(shot, "shapes_json", None) or []),
        tags=list(getattr(shot, "tags_json", None) or []),
        techniques=list(getattr(shot, "techniques_json", None) or []),
        enrichment_version=int(getattr(shot, "enrichment_version", 0) or 0),
        enrichment_quality=(getattr(shot, "source_meta_json", None) or {}).get("enrichment_quality")
        or score_enrichment(shot),
        link_hints=(getattr(shot, "source_meta_json", None) or {}).get("link_hints")
        or link_hints(shot),
        sequence_id=getattr(shot, "sequence_id", None),
        frame_role=getattr(shot, "frame_role", None),
        hero_score=float(getattr(shot, "hero_score", 0) or 0),
        is_hero=bool(getattr(shot, "is_hero", False)),
        is_moving=bool(getattr(shot, "is_moving", False)),
        grade_reason=getattr(shot, "grade_reason", None),
        is_duplicate=bool(getattr(shot, "is_duplicate", False)),
        notes=getattr(shot, "notes", None),
        is_favorite=bool(getattr(shot, "is_favorite", False)),
        deleted_at=getattr(shot, "deleted_at", None),
        created_at=shot.created_at,
    )
