"""Keyframe and thumbnail extraction."""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from cinearchive.utils.ffmpeg import extract_frame
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def extract_keyframe(video: Path, timecode_sec: float, output: Path) -> Path:
    return extract_frame(video, timecode_sec, output)


def make_thumbnails(
    source_image: Path,
    *,
    thumb_sm: Path,
    thumb_md: Path,
    sm_size: int = 256,
    md_size: int = 512,
) -> tuple[Path, Path, int, int]:
    """Generate WebP thumbnails; returns (sm, md, width, height)."""
    with Image.open(source_image) as img:
        img = img.convert("RGB")
        width, height = img.size

        for out, size in ((thumb_sm, sm_size), (thumb_md, md_size)):
            out.parent.mkdir(parents=True, exist_ok=True)
            copy = img.copy()
            copy.thumbnail((size, size), Image.Resampling.LANCZOS)
            copy.save(out, "WEBP", quality=85, method=4)

    return thumb_sm, thumb_md, width, height


def copy_image_as_keyframe(source: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as img:
        # Animated GIF/WebP: use first frame as the still keyframe
        try:
            img.seek(0)
        except EOFError:
            pass
        img.convert("RGB").save(dest, "JPEG", quality=92)
    return dest
