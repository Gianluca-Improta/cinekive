"""Health endpoint."""

from __future__ import annotations

import asyncio
import os

from fastapi import APIRouter, Depends
from sqlalchemy import text

from cinearchive.api.deps import get_embedder, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.db.session import SessionLocal
from cinearchive.pipelines.embedding import EmbeddingPipeline
from cinearchive.repositories.vector_repo import VectorRepository

router = APIRouter(tags=["health"])


async def _sqlite_ping(*, timeout_sec: float = 1.5) -> bool:
    """Liveness DB check that must not wait forever on a saturated pool."""

    async def _run() -> bool:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True

    try:
        return bool(await asyncio.wait_for(_run(), timeout=timeout_sec))
    except Exception:
        return False


@router.get("/health")
async def health(
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> dict:
    # Do not Depends(get_db_session) — pool exhaustion from startup dedupe/enrich
    # was hanging /health and making the desktop splash think the API was dead.
    db_ok = await _sqlite_ping()

    qdrant_ok = False
    try:
        qdrant_ok = bool(vector_repo.health())
    except Exception:
        qdrant_ok = False

    from cinearchive.services import vlm_config as vc

    vlm_enabled = vc.effective_enabled(settings)
    # Skip live VLM probe on /health — Ollama timeouts blocked splash readiness.
    vlm_ok = False

    enrich_info: dict = {}
    try:
        from cinearchive.jobs.enrich_scheduler import last_enrich_pass_at

        enrich_info = {
            "tier": None,
            "model": vc.effective_model(settings) if hasattr(vc, "effective_model") else None,
            "provider": vc.effective_provider(settings),
            "vram_gb": None,
            "continuous": vc.effective_continuous(settings),
            "last_pass_at": last_enrich_pass_at() or None,
            "pending_shots": None,
            "gpu": None,
        }
        # Best-effort extras; never block liveness on these.
        async def _enrich_extras() -> None:
            from cinearchive.jobs.enrich_runner import resolve_enrich_model
            from cinearchive.jobs.enrich_scheduler import count_pending_enrich

            model, tier, vram = await resolve_enrich_model(settings)
            pending = await count_pending_enrich(settings)
            enrich_info.update(
                {
                    "tier": tier,
                    "model": model,
                    "vram_gb": round(vram, 1) if vram is not None else None,
                    "pending_shots": pending,
                    "gpu": (
                        "RTX 5060 Ti 16GB → balanced (qwen3-vl:8b)"
                        if vram and 14 <= vram <= 18
                        else None
                    ),
                }
            )

        try:
            await asyncio.wait_for(_enrich_extras(), timeout=1.0)
        except Exception:
            pass
    except Exception:
        enrich_info = {}

    return {
        "status": "ok" if db_ok and qdrant_ok else "degraded",
        "sqlite": db_ok,
        "qdrant": qdrant_ok,
        "embedding_model_loaded": embedder.is_ready,
        "vlm_enabled": vlm_enabled,
        "vlm_reachable": vlm_ok,
        "enrich": enrich_info,
        "watcher_enabled": settings.watcher_enabled,
        "version": "0.5.1",
        "lan_web_url": os.environ.get("CINEKIVE_LAN_WEB_URL") or None,
    }
