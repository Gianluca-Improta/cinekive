"""Audio analysis helpers for moment grading and dialogue prep."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import numpy as np

from cinearchive.utils.ffmpeg import require_ffmpeg, run_cmd
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def scene_audio_energy(
    video_path: Path,
    start_sec: float,
    end_sec: float,
    *,
    sample_rate: int = 8000,
) -> dict[str, float]:
    """Measure RMS / peak energy for a scene window (dialogue & impact proxy).

    Returns normalized scores in 0–1 plus raw peak.
    """
    dur = max(0.15, float(end_sec) - float(start_sec))
    ffmpeg = require_ffmpeg()
    with tempfile.TemporaryDirectory(prefix="cine_audio_") as tmp:
        wav = Path(tmp) / "scene.wav"
        try:
            run_cmd(
                [
                    ffmpeg,
                    "-y",
                    "-ss",
                    f"{max(0.0, start_sec):.3f}",
                    "-i",
                    str(video_path),
                    "-t",
                    f"{dur:.3f}",
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    str(sample_rate),
                    "-f",
                    "wav",
                    str(wav),
                ],
                timeout=120,
            )
        except Exception as exc:
            logger.debug("Audio extract failed for %s: %s", video_path.name, exc)
            return {"rms": 0.0, "peak": 0.0, "energy": 0.0, "speechiness": 0.0}

        try:
            import wave

            with wave.open(str(wav), "rb") as wf:
                n = wf.getnframes()
                raw = wf.readframes(n)
                width = wf.getsampwidth()
            if width == 2:
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            elif width == 1:
                samples = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
            else:
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        except Exception as exc:
            logger.debug("WAV read failed: %s", exc)
            return {"rms": 0.0, "peak": 0.0, "energy": 0.0, "speechiness": 0.0}

    if samples.size == 0:
        return {"rms": 0.0, "peak": 0.0, "energy": 0.0, "speechiness": 0.0}

    rms = float(np.sqrt(np.mean(samples**2)))
    peak = float(np.max(np.abs(samples)))
    # Zero-crossing rate — higher often correlates with speech vs sustained music/silence
    signs = np.sign(samples)
    zcr = float(np.mean(signs[:-1] != signs[1:])) if samples.size > 1 else 0.0
    # Mid-band energy proxy via simple frame variance of abs signal
    frame = max(1, sample_rate // 20)
    if samples.size >= frame * 2:
        chunks = samples[: samples.size - (samples.size % frame)].reshape(-1, frame)
        chunk_rms = np.sqrt(np.mean(chunks**2, axis=1))
        dynamism = float(np.std(chunk_rms))
    else:
        dynamism = 0.0

    energy = min(1.0, rms * 4.5 + peak * 0.35)
    speechiness = min(1.0, zcr * 2.2 + dynamism * 3.0 + (0.15 if 0.02 < rms < 0.25 else 0.0))
    return {
        "rms": round(rms, 5),
        "peak": round(peak, 5),
        "energy": round(energy, 4),
        "speechiness": round(speechiness, 4),
    }


def probe_has_audio(video_path: Path) -> bool:
    from cinearchive.utils.ffmpeg import require_ffprobe

    ffprobe = require_ffprobe()
    try:
        result = run_cmd(
            [
                ffprobe,
                "-v",
                "quiet",
                "-print_format",
                "json",
                "-show_streams",
                "-select_streams",
                "a",
                str(video_path),
            ],
            timeout=60,
        )
        data = json.loads(result.stdout or "{}")
        return bool(data.get("streams"))
    except Exception:
        return False
