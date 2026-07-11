"""Re-embed existing shots into Qdrant (no re-extraction)."""

from __future__ import annotations

import traceback
from pathlib import Path

from cinearchive.config import Settings, get_settings
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.embedding import get_embedding_pipeline, reset_embedding_pipeline
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import library_root
from qdrant_client import QdrantClient

logger = get_logger(__name__)


async def run_reindex_job(
    job_id: str,
    project_id: str,
    *,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    lib = library_root(settings)
    legacy = Path(settings.artifacts_dir)

    try:
        await update_job(job_id, status="running", current_step="Loading shots", progress_pct=1.0)

        async with SessionLocal() as session:
            repo = ShotRepository(session)
            shots, total = await repo.list(
                project_id=project_id, hide_duplicates=False, limit=100_000
            )
            work = [
                {
                    "id": s.id,
                    "keyframe_path": s.keyframe_path,
                    "source_path": s.source_path,
                }
                for s in shots
            ]

        if not work:
            await update_job(
                job_id,
                status="completed",
                current_step="No shots to reindex",
                progress_pct=100.0,
                total_items=0,
            )
            return

        await update_job(job_id, total_items=len(work), current_step="Loading embedding model")
        reset_embedding_pipeline()
        embedder = get_embedding_pipeline(settings)
        embedder.load()

        qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
        vector_repo = VectorRepository(qdrant, settings)
        vector_repo.ensure_collection()

        batch_size = max(1, settings.embedding_batch_size)
        processed = 0

        for i in range(0, len(work), batch_size):
            batch = work[i : i + batch_size]
            paths: list[Path] = []
            valid: list[dict] = []
            for item in batch:
                kf = lib / item["keyframe_path"]
                if not kf.is_file():
                    kf = legacy / item["keyframe_path"]
                if not kf.is_file():
                    logger.warning("Missing keyframe %s", item["id"])
                    continue
                paths.append(kf)
                valid.append(item)

            if not paths:
                processed += len(batch)
                continue

            await update_job(
                job_id,
                current_step=f"Embedding {processed}/{len(work)}",
                progress_pct=round((processed / len(work)) * 100, 1),
                processed_items=processed,
            )

            vectors = embedder.embed_images(paths)

            async with SessionLocal() as session:
                repo = ShotRepository(session)
                shots = await repo.get_many([v["id"] for v in valid])
                by_id = {s.id: s for s in shots}
                payloads = []
                ids = []
                vecs = []
                for item, vec in zip(valid, vectors, strict=True):
                    shot = by_id.get(item["id"])
                    if not shot:
                        continue
                    ids.append(shot.id)
                    vecs.append(vec)
                    payloads.append(shot_payload(shot))

            if ids:
                vector_repo.upsert_points(ids=ids, vectors=vecs, payloads=payloads)

            processed += len(batch)

        await update_job(
            job_id,
            status="completed",
            current_step="Reindex done",
            progress_pct=100.0,
            processed_items=processed,
        )
        logger.info("Reindex job %s completed (%d shots)", job_id, processed)

    except Exception as exc:
        logger.error("Reindex job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        await update_job(
            job_id,
            status="failed",
            current_step="Failed",
            error_message=str(exc)[:2000],
            progress_pct=100.0,
        )
