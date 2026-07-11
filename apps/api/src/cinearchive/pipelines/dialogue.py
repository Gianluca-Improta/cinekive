"""Dialogue / ASR mapping — Whisper-based word & segment alignment to shots.

Opt-in: requires `openai-whisper` or `faster-whisper` installed in the API env.
Segments are stored on shots as dialogue_json and searchable later.
"""

from __future__ import annotations

import json
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cinearchive.utils.ffmpeg import require_ffmpeg, run_cmd
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


@dataclass
class DialogueWord:
    word: str
    start_ms: int
    end_ms: int


@dataclass
class DialogueSegment:
    text: str
    start_ms: int
    end_ms: int
    words: list[DialogueWord] = field(default_factory=list)


@dataclass
class DialogueResult:
    segments: list[DialogueSegment]
    language: str | None = None
    model: str | None = None
    full_text: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "model": self.model,
            "full_text": self.full_text,
            "segments": [
                {
                    "text": s.text,
                    "start_ms": s.start_ms,
                    "end_ms": s.end_ms,
                    "words": [
                        {"word": w.word, "start_ms": w.start_ms, "end_ms": w.end_ms}
                        for w in s.words
                    ],
                }
                for s in self.segments
            ],
        }


def extract_audio_wav(video_path: Path, output: Path, *, sample_rate: int = 16000) -> Path:
    ffmpeg = require_ffmpeg()
    output.parent.mkdir(parents=True, exist_ok=True)
    run_cmd(
        [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-f",
            "wav",
            str(output),
        ],
        timeout=600,
    )
    return output


def _transcribe_faster_whisper(wav: Path, model_name: str) -> DialogueResult:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    segments_iter, info = model.transcribe(str(wav), word_timestamps=True, vad_filter=True)
    segments: list[DialogueSegment] = []
    texts: list[str] = []
    for seg in segments_iter:
        words = []
        for w in seg.words or []:
            words.append(
                DialogueWord(
                    word=str(w.word).strip(),
                    start_ms=int(float(w.start) * 1000),
                    end_ms=int(float(w.end) * 1000),
                )
            )
        text = (seg.text or "").strip()
        if not text:
            continue
        texts.append(text)
        segments.append(
            DialogueSegment(
                text=text,
                start_ms=int(float(seg.start) * 1000),
                end_ms=int(float(seg.end) * 1000),
                words=words,
            )
        )
    return DialogueResult(
        segments=segments,
        language=getattr(info, "language", None),
        model=f"faster-whisper:{model_name}",
        full_text=" ".join(texts),
    )


def _transcribe_openai_whisper(wav: Path, model_name: str) -> DialogueResult:
    import whisper

    model = whisper.load_model(model_name)
    result = model.transcribe(str(wav), word_timestamps=True, verbose=False)
    segments: list[DialogueSegment] = []
    for seg in result.get("segments") or []:
        words = []
        for w in seg.get("words") or []:
            words.append(
                DialogueWord(
                    word=str(w.get("word", "")).strip(),
                    start_ms=int(float(w.get("start", 0)) * 1000),
                    end_ms=int(float(w.get("end", 0)) * 1000),
                )
            )
        text = str(seg.get("text") or "").strip()
        if not text:
            continue
        segments.append(
            DialogueSegment(
                text=text,
                start_ms=int(float(seg.get("start", 0)) * 1000),
                end_ms=int(float(seg.get("end", 0)) * 1000),
                words=words,
            )
        )
    return DialogueResult(
        segments=segments,
        language=result.get("language"),
        model=f"whisper:{model_name}",
        full_text=str(result.get("text") or "").strip(),
    )


def transcribe_video(
    video_path: Path,
    *,
    model_name: str = "base",
) -> DialogueResult:
    """Transcribe full video audio. Raises RuntimeError if no Whisper backend."""
    with tempfile.TemporaryDirectory(prefix="cine_asr_") as tmp:
        wav = Path(tmp) / "audio.wav"
        extract_audio_wav(video_path, wav)
        try:
            return _transcribe_faster_whisper(wav, model_name)
        except ImportError:
            pass
        try:
            return _transcribe_openai_whisper(wav, model_name)
        except ImportError as exc:
            raise RuntimeError(
                "No ASR backend installed. Install faster-whisper or openai-whisper."
            ) from exc


def segments_for_shot(
    dialogue: DialogueResult,
    start_ms: int | None,
    end_ms: int | None,
    *,
    pad_ms: int = 200,
) -> list[dict[str, Any]]:
    """Slice dialogue segments that overlap a shot's scene window."""
    if start_ms is None or end_ms is None:
        return []
    lo = max(0, start_ms - pad_ms)
    hi = end_ms + pad_ms
    out: list[dict[str, Any]] = []
    for seg in dialogue.segments:
        if seg.end_ms < lo or seg.start_ms > hi:
            continue
        words = [
            {"word": w.word, "start_ms": w.start_ms, "end_ms": w.end_ms}
            for w in seg.words
            if w.end_ms >= lo and w.start_ms <= hi
        ]
        out.append(
            {
                "text": seg.text,
                "start_ms": seg.start_ms,
                "end_ms": seg.end_ms,
                "words": words,
            }
        )
    return out


def asr_available() -> dict[str, Any]:
    backends: list[str] = []
    try:
        import faster_whisper  # noqa: F401

        backends.append("faster-whisper")
    except ImportError:
        pass
    try:
        import whisper  # noqa: F401

        backends.append("openai-whisper")
    except ImportError:
        pass
    return {"available": bool(backends), "backends": backends}
