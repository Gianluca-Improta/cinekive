"""Real-ESRGAN upscale for export — optional local binary.

Looks for realesrgan-ncnn-vulkan on PATH or LIBRARY_RUNTIME.realesrgan_bin.
If missing, returns the source path unchanged (no crash).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from cinearchive.config import Settings
from cinearchive.services import library_config as lc
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def find_realesrgan(settings: Settings) -> Path | None:
    cfg = lc.load_library(settings)
    if not cfg.realesrgan_enabled:
        return None
    if cfg.realesrgan_bin:
        p = Path(cfg.realesrgan_bin)
        if p.is_file():
            return p
    for name in ("realesrgan-ncnn-vulkan", "realesrgan-ncnn-vulkan.exe", "realesrgan"):
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def upscale_image(
    settings: Settings,
    source: Path,
    dest: Path,
    *,
    scale: int = 2,
) -> Path:
    """Upscale source → dest with Real-ESRGAN. Falls back to copy if unavailable."""
    if scale <= 1 or not source.is_file():
        return source

    bin_path = find_realesrgan(settings)
    if not bin_path:
        logger.info("Real-ESRGAN not found — exporting stored resolution")
        return source

    dest.parent.mkdir(parents=True, exist_ok=True)
    # ncnn-vulkan: -i in -o out -s scale -n model
    model = "realesrgan-x4plus" if scale >= 4 else "realesrgan-x2plus"
    cmd = [
        str(bin_path),
        "-i",
        str(source),
        "-o",
        str(dest),
        "-s",
        str(scale if scale in (2, 3, 4) else 2),
        "-n",
        model,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=180)
        if dest.is_file() and dest.stat().st_size > 0:
            return dest
    except Exception as exc:
        logger.warning("Real-ESRGAN failed (%s) — using stored frame", exc)
    return source
