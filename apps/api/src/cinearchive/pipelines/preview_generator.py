"""Preview loop generation."""

from __future__ import annotations

from pathlib import Path

from cinearchive.utils.ffmpeg import generate_preview_clip
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def generate_preview(
    video: Path,
    *,
    start_sec: float,
    end_sec: float,
    output: Path,
    duration_sec: float = 2.5,
    fmt: str = "webp",
) -> Path | None:
    scene_dur = max(0.1, end_sec - start_sec)
    # Keep preview clear of cut boundaries so loops don't flash the previous shot
    edge = min(0.35, scene_dur * 0.12)
    safe_start = start_sec + edge
    safe_end = max(safe_start + 0.2, end_sec - edge)
    safe_dur = max(0.2, safe_end - safe_start)
    clip_dur = min(duration_sec, safe_dur)
    mid = (safe_start + safe_end) / 2.0
    clip_start = max(safe_start, mid - clip_dur / 2.0)
    if clip_start + clip_dur > safe_end:
        clip_start = max(safe_start, safe_end - clip_dur)

    try:
        return generate_preview_clip(video, clip_start, clip_dur, output, fmt=fmt)
    except Exception as exc:
        logger.warning("Preview generation failed: %s", exc)
        return None
