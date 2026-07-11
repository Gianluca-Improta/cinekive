"""ffmpeg / ffprobe helpers."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


class FFmpegError(RuntimeError):
    pass


def require_ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        raise FFmpegError("ffmpeg not found on PATH")
    return path


def require_ffprobe() -> str:
    path = shutil.which("ffprobe")
    if not path:
        raise FFmpegError("ffprobe not found on PATH")
    return path


def run_cmd(args: list[str], timeout: int = 600) -> subprocess.CompletedProcess[str]:
    logger.debug("Running: %s", " ".join(args))
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise FFmpegError(f"Command timed out: {' '.join(args)}") from exc
    if result.returncode != 0:
        raise FFmpegError(result.stderr.strip() or f"Command failed: {' '.join(args)}")
    return result


def probe_video(path: Path) -> dict:
    ffprobe = require_ffprobe()
    result = run_cmd(
        [
            ffprobe,
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    data = json.loads(result.stdout)
    video_stream = next(
        (s for s in data.get("streams", []) if s.get("codec_type") == "video"),
        None,
    )
    if not video_stream:
        raise FFmpegError(f"No video stream in {path}")
    width = int(video_stream.get("width") or 0)
    height = int(video_stream.get("height") or 0)
    duration = float(data.get("format", {}).get("duration") or video_stream.get("duration") or 0)
    fps = 0.0
    rate = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/1"
    try:
        if isinstance(rate, str) and "/" in rate:
            num, den = rate.split("/", 1)
            den_f = float(den) or 1.0
            fps = float(num) / den_f
        else:
            fps = float(rate)
    except Exception:
        fps = 0.0
    has_audio = any(s.get("codec_type") == "audio" for s in data.get("streams", []))
    return {
        "width": width,
        "height": height,
        "duration_sec": duration,
        "fps": fps,
        "has_audio": has_audio,
        "codec": video_stream.get("codec_name"),
    }


def extract_source_clip(
    video: Path,
    start_sec: float,
    end_sec: float,
    output: Path,
    *,
    handles_sec: float = 0.0,
    copy_streams: bool = False,
) -> Path:
    """Export a clip from the original source for NLE / editorial use.

    Default re-encodes H.264+AAC at source resolution (reliable cuts).
    copy_streams=True attempts stream copy (faster, keyframe-aligned only).
    """
    ffmpeg = require_ffmpeg()
    output.parent.mkdir(parents=True, exist_ok=True)
    start = max(0.0, float(start_sec) - float(handles_sec))
    end = max(start + 0.05, float(end_sec) + float(handles_sec))
    dur = end - start
    args = [
        ffmpeg,
        "-y",
        "-ss",
        f"{start:.3f}",
        "-i",
        str(video),
        "-t",
        f"{dur:.3f}",
    ]
    if copy_streams:
        args += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
    else:
        args += [
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
        ]
    args.append(str(output))
    run_cmd(args, timeout=900)
    return output


def extract_frame(video: Path, timecode_sec: float, output: Path) -> Path:
    """Extract a single frame with accurate seeking (avoids previous-cut bleed)."""
    ffmpeg = require_ffmpeg()
    output.parent.mkdir(parents=True, exist_ok=True)
    # Accurate seek: -ss AFTER -i. Slightly slower, but lands inside the intended scene
    # instead of the nearest prior keyframe (which often belongs to the previous cut).
    t = max(0.0, float(timecode_sec))
    run_cmd(
        [
            ffmpeg,
            "-y",
            "-i",
            str(video),
            "-ss",
            f"{t:.3f}",
            "-frames:v",
            "1",
            "-q:v",
            "2",
            "-update",
            "1",
            str(output),
        ]
    )
    if not output.exists():
        raise FFmpegError(f"Failed to extract frame to {output}")
    return output


def generate_preview_clip(
    video: Path,
    start_sec: float,
    duration_sec: float,
    output: Path,
    fmt: str = "webp",
) -> Path:
    ffmpeg = require_ffmpeg()
    output.parent.mkdir(parents=True, exist_ok=True)

    if fmt == "webp":
        run_cmd(
            [
                ffmpeg,
                "-y",
                "-ss",
                f"{start_sec:.3f}",
                "-t",
                f"{duration_sec:.3f}",
                "-i",
                str(video),
                "-vf",
                "scale=640:-2:flags=lanczos,fps=12",
                "-loop",
                "0",
                "-an",
                "-c:v",
                "libwebp",
                "-quality",
                "80",
                str(output),
            ]
        )
    elif fmt == "webm":
        run_cmd(
            [
                ffmpeg,
                "-y",
                "-ss",
                f"{start_sec:.3f}",
                "-t",
                f"{duration_sec:.3f}",
                "-i",
                str(video),
                "-vf",
                "scale=640:-2:flags=lanczos",
                "-an",
                "-c:v",
                "libvpx-vp9",
                "-b:v",
                "0",
                "-crf",
                "32",
                str(output),
            ]
        )
    else:  # mp4
        run_cmd(
            [
                ffmpeg,
                "-y",
                "-ss",
                f"{start_sec:.3f}",
                "-t",
                f"{duration_sec:.3f}",
                "-i",
                str(video),
                "-vf",
                "scale=640:-2:flags=lanczos",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "23",
                "-movflags",
                "+faststart",
                "-pix_fmt",
                "yuv420p",
                str(output),
            ]
        )

    if not output.exists():
        raise FFmpegError(f"Failed to generate preview at {output}")
    return output
