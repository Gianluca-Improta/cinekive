"""Background global dedupe — all projects, cross-archive near-duplicates."""

from __future__ import annotations

import traceback
import time

from sqlalchemy import select

from cinearchive.config import Settings, get_settings
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.pipelines.sequence_grader import perceptual_hash
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.dedupe_service import dedupe_all_projects
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import library_root
from pathlib import Path
from qdrant_client import QdrantClient

logger = get_logger(__name__)

_last_completed_at = 0.0
_running = False


async def run_global_dedupe_pass(*, settings: Settings | None = None) -> dict:
    """Full library dedupe: every project, then cross-archive collapse."""
    global _last_completed_at, _running
    settings = settings or get_settings()
    if _running:
        return {"skipped": True, "reason": "already_running"}
    _running = True
    lib = library_root(settings)
    legacy = Path(settings.artifacts_dir)
    try:
        async with SessionLocal() as session:
            projects = await ProjectRepository(session).list()
            project_ids = [str(p.id) for p in projects]

            # Backfill missing phashes library-wide
            result = await session.execute(
                select(Shot).where(
                    (Shot.phash.is_(None)) | (Shot.phash == ""),
                )
            )
            hashed = 0
            for s in result.scalars().all():
                keyframe = lib / (s.keyframe_path or "")
                if not keyframe.is_file():
                    keyframe = legacy / (s.keyframe_path or "")
                if not keyframe.is_file():
                    continue
                try:
                    s.phash = perceptual_hash(keyframe) or None
                    if s.phash:
                        hashed += 1
                except Exception as exc:
                    logger.warning("phash failed for %s: %s", s.id, exc)
            await session.commit()

            stats = await dedupe_all_projects(
                session,
                project_ids,
                threshold=settings.dedupe_hamming_threshold,
                sequence_threshold=settings.sequence_dedupe_threshold,
            )
            stats["hashed"] = hashed

            # Sync Qdrant duplicate flags
            result = await session.execute(select(Shot))
            shots = list(result.scalars().all())
            payloads = [(s.id, shot_payload(s)) for s in shots]

        qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
        vector_repo = VectorRepository(qdrant, settings)
        synced = 0
        for sid, payload in payloads:
            try:
                vector_repo.set_payload(sid, payload)
                synced += 1
            except Exception:
                pass
        qdrant.close()

        stats["payloads_synced"] = synced
        _last_completed_at = time.time()
        logger.info("Global dedupe pass done: %s", stats)
        return stats
    except Exception as exc:
        logger.error("Global dedupe failed: %s\n%s", exc, traceback.format_exc())
        return {"error": str(exc)}
    finally:
        _running = False


def last_completed_at() -> float:
    return _last_completed_at
