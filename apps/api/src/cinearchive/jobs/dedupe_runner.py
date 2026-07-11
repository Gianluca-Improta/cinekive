"""Background job: project-wide near-dupe pass + Qdrant payload sync."""

from __future__ import annotations

import traceback
from pathlib import Path

from cinearchive.config import Settings, get_settings
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.sequence_grader import perceptual_hash
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.dedupe_service import dedupe_project_shots
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import library_root
from qdrant_client import QdrantClient

logger = get_logger(__name__)


async def run_dedupe_job(
    job_id: str,
    project_id: str,
    *,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    lib = library_root(settings)
    legacy = Path(settings.artifacts_dir)

    try:
        await update_job(
            job_id,
            status="running",
            current_step="Computing missing perceptual hashes",
            progress_pct=5.0,
        )

        # Backfill phash for legacy shots
        hashed = 0
        async with SessionLocal() as session:
            repo = ShotRepository(session)
            shots, total = await repo.list(
                project_id=project_id,
                hide_duplicates=False,
                limit=100_000,
            )
            await update_job(job_id, total_items=total, progress_pct=10.0)
            for s in shots:
                if s.phash:
                    continue
                keyframe = lib / s.keyframe_path
                if not keyframe.is_file():
                    keyframe = legacy / s.keyframe_path
                if not keyframe.is_file():
                    continue
                try:
                    s.phash = perceptual_hash(keyframe) or None
                    if s.phash:
                        hashed += 1
                except Exception as exc:
                    logger.warning("phash failed for %s: %s", s.id, exc)
            await session.commit()

        await update_job(
            job_id,
            current_step=f"Hashed {hashed} · scanning near-duplicates",
            progress_pct=40.0,
            processed_items=hashed,
        )

        async with SessionLocal() as session:
            stats = await dedupe_project_shots(
                session,
                project_id,
                threshold=settings.dedupe_hamming_threshold,
                sequence_threshold=settings.sequence_dedupe_threshold,
            )
            repo = ShotRepository(session)
            shots, _ = await repo.list(
                project_id=project_id,
                hide_duplicates=False,
                limit=100_000,
            )
            payloads = [(s.id, shot_payload(s)) for s in shots]

        await update_job(
            job_id,
            current_step="Syncing vector payloads",
            progress_pct=75.0,
            total_items=stats.get("scanned", 0),
            processed_items=stats.get("marked_duplicate", 0),
        )

        qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
        vector_repo = VectorRepository(qdrant, settings)
        for sid, payload in payloads:
            try:
                vector_repo.set_payload(sid, payload)
            except Exception as exc:
                logger.warning("Payload sync failed for %s: %s", sid, exc)

        msg = (
            f"Hashed {hashed} · scanned {stats.get('scanned', 0)} · "
            f"marked {stats.get('marked_duplicate', 0)} dups · "
            f"collapsed {stats.get('sequences_collapsed', 0)} sequences"
        )
        await update_job(
            job_id,
            status="completed",
            current_step=msg,
            progress_pct=100.0,
            processed_items=stats.get("marked_duplicate", 0),
            total_items=stats.get("scanned", 0),
        )
        logger.info("Dedupe job %s done: %s", job_id, msg)

    except Exception as exc:
        logger.error("Dedupe job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        await update_job(
            job_id,
            status="failed",
            current_step="Failed",
            error_message=str(exc)[:2000],
            progress_pct=100.0,
        )
