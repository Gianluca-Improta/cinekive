"""Health endpoint."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_embedder, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.pipelines.embedding import EmbeddingPipeline
from cinearchive.pipelines.vlm_enrichment import VLMEnricher
from cinearchive.repositories.vector_repo import VectorRepository

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(
    session: AsyncSession = Depends(get_db_session),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
    settings: Settings = Depends(get_settings),
) -> dict:
    db_ok = False
    try:
        await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False

    qdrant_ok = vector_repo.health()
    from cinearchive.services import vlm_config as vc

    vlm_enabled = vc.effective_enabled(settings)
    vlm_ok = False
    if vlm_enabled:
        vlm_ok = await VLMEnricher(settings).health()

    enrich_info: dict = {}
    try:
        from cinearchive.jobs.enrich_runner import resolve_enrich_model
        from cinearchive.jobs.enrich_scheduler import last_enrich_pass_at

        model, tier, vram = await resolve_enrich_model(settings)
        enrich_info = {
            "tier": tier,
            "model": model,
            "provider": vc.effective_provider(settings),
            "vram_gb": round(vram, 1) if vram is not None else None,
            "continuous": vc.effective_continuous(settings),
            "last_pass_at": last_enrich_pass_at() or None,
            "gpu": "RTX 5060 Ti 16GB → balanced (qwen3-vl:8b)"
            if vram and 14 <= vram <= 18
            else None,
        }
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
        "version": "0.3.0",
    }
