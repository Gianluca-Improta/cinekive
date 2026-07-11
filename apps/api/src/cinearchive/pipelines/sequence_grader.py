"""Sequence / hero grading for cinematic curation.

Scores each detected scene on motion, sharpness, color interest, duration,
and audio energy (dialogue / impact proxy). Keeps the top N hero sequences
(default 5–10), or all scenes when keep_all=True (work / film archives).
Moving sequences always sample start / mid / end frames; static ones keep a
single mid hero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

from cinearchive.pipelines.audio_analysis import scene_audio_energy
from cinearchive.pipelines.scene_detection import SceneBoundary
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


@dataclass
class GradedSequence:
    scene: SceneBoundary
    score: float
    motion_score: float
    sharpness_score: float
    color_score: float
    audio_score: float = 0.0
    speechiness: float = 0.0
    is_moving: bool = False
    sample_times: list[float] = field(default_factory=list)
    frame_roles: list[str] = field(default_factory=list)  # start|mid|end
    reason: str = ""
    preview_duration_sec: float = 2.5
    signals: dict = field(default_factory=dict)


def _read_frame(cap: cv2.VideoCapture, t_sec: float) -> np.ndarray | None:
    fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
    frame_idx = max(0, int(t_sec * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
    ok, frame = cap.read()
    if not ok or frame is None:
        return None
    return frame


def _sharpness(gray: np.ndarray) -> float:
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def _color_interest(bgr: np.ndarray) -> float:
    """Higher when palette is varied (not flat gray / black)."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1].astype(np.float32)
    val = hsv[:, :, 2].astype(np.float32)
    sat_mean = float(sat.mean()) / 255.0
    val_std = float(val.std()) / 255.0
    return min(1.0, sat_mean * 0.6 + val_std * 0.8)


def _motion_between(a: np.ndarray, b: np.ndarray) -> float:
    ga = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)
    gb = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY)
    ga = cv2.resize(ga, (160, 90))
    gb = cv2.resize(gb, (160, 90))
    # Light blur reduces sensor noise false-positives
    ga = cv2.GaussianBlur(ga, (3, 3), 0)
    gb = cv2.GaussianBlur(gb, (3, 3), 0)
    diff = cv2.absdiff(ga, gb)
    # Emphasize larger structural changes over tiny noise
    _, thresh = cv2.threshold(diff, 18, 255, cv2.THRESH_BINARY)
    mean_diff = float(diff.mean()) / 255.0
    changed = float(np.count_nonzero(thresh)) / float(thresh.size)
    return 0.55 * mean_diff + 0.45 * changed


def _safe_inset(duration_sec: float) -> float:
    """Keep samples clear of cut boundaries / dissolves (avoids previous-shot bleed)."""
    # At least ~8–12 frames at 24fps into the scene; scale with duration.
    return min(0.55, max(0.28, duration_sec * 0.12))


def _sample_times_for(scene: SceneBoundary, is_moving: bool) -> tuple[list[float], list[str]]:
    inset = _safe_inset(scene.duration_sec)
    # Start sits further in than end — cut bleed is almost always from the prior scene
    start_inset = min(inset + 0.12, scene.duration_sec * 0.35)
    end_inset = inset
    start = scene.start_sec + start_inset
    mid = scene.mid_sec
    # Prefer mid slightly past true center so mid heroes aren't transition frames
    if scene.duration_sec >= 1.2:
        mid = scene.start_sec + scene.duration_sec * 0.52
    end = max(start + 0.05, scene.end_sec - end_inset)
    # Clamp inside scene
    start = min(start, scene.end_sec - 0.05)
    mid = min(max(mid, scene.start_sec + start_inset * 0.5), scene.end_sec - 0.05)
    end = min(max(end, start), scene.end_sec - 0.02)
    if is_moving and scene.duration_sec >= 0.7:
        return [start, mid, end], ["start", "mid", "end"]
    return [mid], ["mid"]


def _preview_duration(scene: SceneBoundary, is_moving: bool, motion: float) -> float:
    """Longer loops for clearly moving sequences."""
    if not is_moving:
        return min(1.8, max(0.8, scene.duration_sec * 0.4))
    base = 2.8 + min(1.4, motion * 8.0)
    return float(min(4.5, max(2.0, min(base, scene.duration_sec))))


def grade_sequences(
    video_path: Path,
    scenes: list[SceneBoundary],
    *,
    max_heroes: int = 8,
    motion_threshold: float = 0.035,
    keep_all: bool = False,
    use_audio: bool = True,
) -> list[GradedSequence]:
    """Grade all scenes and return top hero sequences (sorted by score desc).

    keep_all=True grades every scene (work/film archive mode) but still ranks
    by score so heroes float to the top of browse.
    """
    if not scenes:
        return []

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        logger.warning("Cannot open video for grading: %s", video_path)
        limit = len(scenes) if keep_all else max_heroes
        out: list[GradedSequence] = []
        for sc in scenes[:limit]:
            times, roles = _sample_times_for(sc, is_moving=False)
            out.append(
                GradedSequence(
                    scene=sc,
                    score=0.5,
                    motion_score=0.0,
                    sharpness_score=0.5,
                    color_score=0.5,
                    is_moving=False,
                    sample_times=times,
                    frame_roles=roles,
                    reason="fallback (unreadable video)",
                    preview_duration_sec=2.0,
                )
            )
        return out

    graded: list[GradedSequence] = []
    try:
        for sc in scenes:
            # Denser probes for motion — inset from cuts so we don't score previous-shot frames
            inset = min(0.35, max(0.2, sc.duration_sec * 0.1))
            if sc.duration_sec < 0.4:
                probes = [sc.mid_sec]
            else:
                probes = [
                    sc.start_sec + inset + 0.1,
                    sc.start_sec + sc.duration_sec * 0.3,
                    sc.start_sec + sc.duration_sec * 0.52,
                    sc.start_sec + sc.duration_sec * 0.72,
                    max(sc.start_sec + inset, sc.end_sec - inset),
                ]
            frames = [f for t in probes if (f := _read_frame(cap, t)) is not None]
            if not frames:
                continue

            grays = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
            sharp = float(np.mean([_sharpness(g) for g in grays]))
            sharp_n = min(1.0, sharp / 800.0)
            color_n = float(np.mean([_color_interest(f) for f in frames]))

            motion = 0.0
            if len(frames) >= 2:
                pairwise = [
                    _motion_between(frames[i], frames[i + 1]) for i in range(len(frames) - 1)
                ]
                # Also compare first vs last for slow pans
                pairwise.append(_motion_between(frames[0], frames[-1]))
                motion = float(np.mean(pairwise))

            is_moving = motion >= motion_threshold

            dur = sc.duration_sec
            if dur < 0.35:
                dur_n = 0.15
            elif dur < 0.8:
                dur_n = 0.5
            elif dur <= 8.0:
                dur_n = 1.0
            elif dur <= 20.0:
                dur_n = 0.7
            else:
                dur_n = 0.4

            audio_n = 0.0
            speech_n = 0.0
            audio_raw: dict = {}
            if use_audio:
                try:
                    audio_raw = scene_audio_energy(video_path, sc.start_sec, sc.end_sec)
                    audio_n = float(audio_raw.get("energy") or 0.0)
                    speech_n = float(audio_raw.get("speechiness") or 0.0)
                except Exception:
                    audio_raw = {}

            # Visual craft + audio presence (dialogue / impact moments rise)
            score = (
                sharp_n * 0.28
                + color_n * 0.18
                + min(1.0, motion * 4.0) * 0.18
                + dur_n * 0.14
                + audio_n * 0.14
                + speech_n * 0.08
            )

            times, roles = _sample_times_for(sc, is_moving)
            reasons = []
            if sharp_n > 0.55:
                reasons.append("sharp")
            if color_n > 0.45:
                reasons.append("colorful")
            if is_moving:
                reasons.append("moving")
            if 0.8 <= dur <= 8.0:
                reasons.append("good-duration")
            if audio_n > 0.45:
                reasons.append("impact-audio")
            if speech_n > 0.4:
                reasons.append("dialogue-likely")

            graded.append(
                GradedSequence(
                    scene=sc,
                    score=round(score, 4),
                    motion_score=round(motion, 4),
                    sharpness_score=round(sharp_n, 4),
                    color_score=round(color_n, 4),
                    audio_score=round(audio_n, 4),
                    speechiness=round(speech_n, 4),
                    is_moving=is_moving,
                    sample_times=times,
                    frame_roles=roles,
                    reason=",".join(reasons) or "baseline",
                    preview_duration_sec=_preview_duration(sc, is_moving, motion),
                    signals={
                        "motion": round(motion, 4),
                        "sharpness": round(sharp_n, 4),
                        "color": round(color_n, 4),
                        "duration": round(dur_n, 4),
                        "audio": round(audio_n, 4),
                        "speechiness": round(speech_n, 4),
                        **{f"audio_{k}": v for k, v in audio_raw.items()},
                    },
                )
            )
    finally:
        cap.release()

    graded.sort(key=lambda g: g.score, reverse=True)
    heroes = graded if keep_all else graded[: max(1, max_heroes)]
    # Mark top tier as heroes even in keep_all — top max_heroes get is_hero later
    logger.info(
        "Graded %d scenes → %d kept (top score=%.3f, moving=%d, audio_top=%.2f) in %s",
        len(graded),
        len(heroes),
        heroes[0].score if heroes else 0,
        sum(1 for h in heroes if h.is_moving),
        heroes[0].audio_score if heroes else 0,
        video_path.name,
    )
    return heroes


def perceptual_hash(image_path: Path, hash_size: int = 16) -> str:
    """Average hash (aHash) as hex string for near-dupe detection."""
    img = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return ""
    resized = cv2.resize(img, (hash_size, hash_size), interpolation=cv2.INTER_AREA)
    avg = float(resized.mean())
    bits = (resized > avg).flatten()
    value = 0
    for b in bits:
        value = (value << 1) | int(b)
    width = (hash_size * hash_size + 3) // 4
    return f"{value:0{width}x}"


def hamming_distance(h1: str, h2: str) -> int:
    if not h1 or not h2 or len(h1) != len(h2):
        return 999
    x = int(h1, 16) ^ int(h2, 16)
    return x.bit_count()


def is_near_duplicate(h1: str, h2: str, threshold: int = 10) -> bool:
    return hamming_distance(h1, h2) <= threshold


def find_near_duplicate(
    phash: str,
    known: list[tuple[str, str]],
    *,
    threshold: int = 10,
) -> str | None:
    """Return shot_id of first near-duplicate in known (phash, shot_id) list."""
    if not phash:
        return None
    for prev_hash, prev_id in known:
        if is_near_duplicate(phash, prev_hash, threshold=threshold):
            return prev_id
    return None
