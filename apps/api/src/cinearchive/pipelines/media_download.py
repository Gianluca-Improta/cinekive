"""Media URL download helpers — YouTube / Vimeo / direct via yt-dlp when available."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urlparse

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

# Sites yt-dlp handles well for single-clip archive pulls.
# Prefer one URL at a time — not whole channels/playlists (--no-playlist).
_STREAM_HOST_RE = re.compile(
    r"("
    r"youtube\.com|youtu\.be|"
    r"vimeo\.com|"
    r"dailymotion\.com|"
    r"tiktok\.com|"
    r"instagram\.com|"
    r"twitter\.com|x\.com|"
    r"facebook\.com|fb\.watch|"
    r"twitch\.tv|"
    r"reddit\.com|"
    r"streamable\.com|"
    r"bilibili\.com"
    r")",
    re.I,
)

_DIRECT_MEDIA_EXT = {
    ".mp4",
    ".webm",
    ".mkv",
    ".mov",
    ".m4v",
    ".avi",
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
    ".gif",
}


def yt_dlp_available() -> bool:
    if shutil.which("yt-dlp") or shutil.which("youtube-dl"):
        return True
    try:
        import yt_dlp  # noqa: F401

        return True
    except ImportError:
        return False


def is_stream_url(url: str) -> bool:
    """True when yt-dlp should fetch the URL (page or known host)."""
    parsed = urlparse(url)
    host = (parsed.netloc or "").lower()
    path = (parsed.path or "").lower()
    if _STREAM_HOST_RE.search(host):
        return True
    # Direct file links go through InspirationSeek / httpx, not yt-dlp
    if any(path.endswith(ext) for ext in _DIRECT_MEDIA_EXT):
        return False
    # Unknown http(s) page — try yt-dlp first when available (covers many sites)
    if parsed.scheme in {"http", "https"} and host and yt_dlp_available():
        return True
    return False


def download_stream(
    url: str,
    dest_dir: Path,
    *,
    title_hint: str | None = None,
) -> Path:
    """Download a YouTube/Vimeo/etc URL into dest_dir. Raises RuntimeError on failure."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    bin_name = shutil.which("yt-dlp") or shutil.which("youtube-dl")
    out_tmpl = str(dest_dir / "%(title).180B [%(id)s].%(ext)s")
    if bin_name:
        args = [
            bin_name,
            "--no-playlist",
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]/b",
            "--merge-output-format",
            "mp4",
            "-o",
            out_tmpl,
            "--restrict-filenames",
            url,
        ]
        logger.info("yt-dlp download: %s", url)
        result = subprocess.run(args, capture_output=True, text=True, timeout=1800, check=False)
        if result.returncode != 0:
            raise RuntimeError((result.stderr or result.stdout or "yt-dlp failed")[:800])
    else:
        try:
            import yt_dlp
        except ImportError as exc:
            raise RuntimeError("yt-dlp not installed. Run: pip install yt-dlp") from exc
        opts = {
            "noplaylist": True,
            "format": "bv*[height<=1080]+ba/b[height<=1080]/b",
            "merge_output_format": "mp4",
            "outtmpl": out_tmpl,
            "restrictfilenames": True,
        }
        logger.info("yt-dlp module download: %s", url)
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

    candidates = sorted(
        [
            p
            for p in dest_dir.iterdir()
            if p.is_file() and p.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov"}
        ],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("yt-dlp finished but no media file found")
    return candidates[0]
