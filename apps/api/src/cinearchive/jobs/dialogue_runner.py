"""Dialogue / ASR background job — map spoken words onto shots."""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import select

from cinearchive.config import Settings, get_settings
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.dialogue import asr_available, segments_for_shot, transcribe_video
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from qdrant_client import QdrantClient

logger = get_logger(__name__)


async def run_dialogue_job(
    job_id: str,
    project_id: str,
    *,
    shot_ids: list[str] | None = None,
    force: bool = False,
    model: str | None = None,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    status = asr_available()
    if not status.get("available"):
        await update_job(
            job_id,
            status="failed",
            current_step="ASR unavailable",
            error_message="Install faster-whisper or openai-whisper to enable dialogue mapping",
            progress_pct=100.0,
        )
        return

    model_name = model or settings.asr_model
    await update_job(job_id, status="running", current_step="Loading shots", progress_pct=2.0)

    async with SessionLocal() as session:
        q = select(Shot).where(Shot.project_id == project_id, Shot.source_type == "video")
        if shot_ids:
            q = q.where(Shot.id.in_(shot_ids))
        shots = list((await session.execute(q)).scalars().all())

    if not shots:
        await update_job(
            job_id,
            status="completed",
            current_step="No video shots",
            progress_pct=100.0,
            total_items=0,
            processed_items=0,
        )
        return

    # Group by source file — one transcription per video
    by_source: dict[str, list[Shot]] = {}
    for s in shots:
        if not force and getattr(s, "dialogue_text", None):
            continue
        by_source.setdefault(s.source_path, []).append(s)

    sources = list(by_source.keys())
    await update_job(job_id, total_items=len(sources), current_step=f"0/{len(sources)} sources")

    qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
    vector_repo = VectorRepository(qdrant, settings)

    processed = 0
    for src in sources:
        path = Path(src)
        await update_job(
            job_id,
            current_step=f"Transcribing {path.name}",
            progress_pct=round(5 + (processed / max(len(sources), 1)) * 90, 1),
            processed_items=processed,
        )
        if not path.exists():
            logger.warning("Source missing for dialogue: %s", path)
            processed += 1
            continue
        try:
            dialogue = transcribe_video(path, model_name=model_name)
        except Exception as exc:
            logger.exception("ASR failed for %s: %s", path, exc)
            processed += 1
            continue

        async with SessionLocal() as session:
            for s in by_source[src]:
                shot = await session.get(Shot, s.id)
                if not shot:
                    continue
                segs = segments_for_shot(
                    dialogue,
                    shot.start_timecode_ms,
                    shot.end_timecode_ms,
                )
                shot.dialogue_json = {
                    "language": dialogue.language,
                    "model": dialogue.model,
                    "segments": segs,
                }
                shot.dialogue_text = " ".join(seg["text"] for seg in segs).strip() or None
                try:
                    vector_repo.set_payload(shot.id, shot_payload(shot))
                except Exception:
                    pass
            await session.commit()

        processed += 1

    await update_job(
        job_id,
        status="completed",
        current_step="Dialogue mapped",
        progress_pct=100.0,
        processed_items=processed,
    )
