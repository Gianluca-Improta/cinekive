"""Scene detection via PySceneDetect."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


@dataclass
class SceneBoundary:
    index: int
    start_sec: float
    end_sec: float

    @property
    def mid_sec(self) -> float:
        return (self.start_sec + self.end_sec) / 2.0

    @property
    def duration_sec(self) -> float:
        return max(0.0, self.end_sec - self.start_sec)


def detect_scenes(
    video_path: Path,
    *,
    threshold: float = 27.0,
    min_scene_len: int = 15,
) -> list[SceneBoundary]:
    """Detect scene boundaries. Falls back to a single full-video scene on failure."""
    try:
        from scenedetect import ContentDetector, SceneManager, open_video

        video = open_video(str(video_path))
        manager = SceneManager()
        manager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_scene_len))
        manager.detect_scenes(video)
        scene_list = manager.get_scene_list()

        if not scene_list:
            duration = float(video.duration.get_seconds()) if video.duration else 0.0
            return [SceneBoundary(index=0, start_sec=0.0, end_sec=max(duration, 0.1))]

        boundaries: list[SceneBoundary] = []
        for i, (start, end) in enumerate(scene_list):
            boundaries.append(
                SceneBoundary(
                    index=i,
                    start_sec=float(start.get_seconds()),
                    end_sec=float(end.get_seconds()),
                )
            )
        logger.info("Detected %d scenes in %s", len(boundaries), video_path.name)
        return boundaries
    except Exception as exc:
        logger.warning("Scene detection failed for %s: %s — using single scene", video_path, exc)
        try:
            from cinearchive.utils.ffmpeg import probe_video

            meta = probe_video(video_path)
            duration = float(meta.get("duration_sec") or 1.0)
        except Exception:
            duration = 1.0
        return [SceneBoundary(index=0, start_sec=0.0, end_sec=max(duration, 0.1))]


def keyframe_times(scene: SceneBoundary, sampling_mode: str) -> list[float]:
    """Return keyframe timestamps for a scene based on sampling mode."""
    if sampling_mode in ("full", "heroes", "curated") and scene.duration_sec > 3.0:
        # Inset enough to clear cut / dissolve bleed from the previous shot
        inset = min(0.5, max(0.28, scene.duration_sec * 0.1))
        start_inset = min(inset + 0.12, scene.duration_sec * 0.35)
        start = scene.start_sec + start_inset
        mid = scene.start_sec + scene.duration_sec * 0.52
        end = max(start + 0.05, scene.end_sec - inset)
        return [start, mid, end]
    # Single mid — also inset from edges on short scenes
    inset = min(0.35, scene.duration_sec * 0.2)
    return [min(scene.end_sec - 0.05, max(scene.start_sec + inset, scene.mid_sec))]
