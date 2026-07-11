"""Enrichment, dedupe, and reindex routes."""

from __future__ import annotations

from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings
from cinearchive.config import Settings
from cinearchive.db.models.job import Job
from cinearchive.jobs.dedupe_runner import run_dedupe_job
from cinearchive.jobs.dialogue_runner import run_dialogue_job
from cinearchive.jobs.enrich_runner import resolve_enrich_model, run_enrich_job
from cinearchive.jobs.enrich_scheduler import last_enrich_pass_at, run_enrich_pass
from cinearchive.jobs.reindex_runner import run_reindex_job
from cinearchive.pipelines.dialogue import asr_available
from cinearchive.pipelines.tag_quality import score_enrichment
from cinearchive.pipelines.vlm_tiers import detect_vram_gb, list_ollama_models, tiers_payload
from cinearchive.repositories.job_repo import JobRepository
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.schemas.collection import DialogueRequest, EnrichRequest
from cinearchive.schemas.ingest import IngestResponse
from cinearchive.schemas.job import JobRead

router = APIRouter(tags=["enrichment"])


@router.get("/asr/status")
async def asr_status(settings: Settings = Depends(get_settings)) -> dict:
    info = asr_available()
    return {
        **info,
        "enabled": settings.asr_enabled,
        "model": settings.asr_model,
    }


@router.post("/projects/{project_id}/dialogue", response_model=IngestResponse)
async def dialogue_project(
    project_id: UUID,
    body: DialogueRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Map spoken dialogue onto shots via Whisper ASR (opt-in dependency)."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job = Job(
        id=str(uuid4()),
        project_id=str(project_id),
        type="dialogue",
        status="pending",
        progress_pct=0.0,
        current_step="queued",
        total_items=0,
        processed_items=0,
        payload_json={
            "shot_ids": [str(s) for s in body.shot_ids] if body.shot_ids else None,
            "force": body.force,
            "model": body.model,
        },
    )
    await JobRepository(session).create(job)
    await session.commit()

    background.add_task(
        run_dialogue_job,
        job.id,
        str(project_id),
        shot_ids=[str(s) for s in body.shot_ids] if body.shot_ids else None,
        force=body.force,
        model=body.model,
        settings=settings,
    )
    return IngestResponse(
        job=JobRead.model_validate(job),
        message="Dialogue mapping job queued (requires Whisper)",
    )


@router.get("/enrich/tiers")
async def enrich_tiers(settings: Settings = Depends(get_settings)) -> dict:
    """GPU-aware VLM tiers (fast / balanced / quality) for the local card."""
    vram = detect_vram_gb()
    if vram is None and settings.enrich_vram_gb is not None:
        vram = float(settings.enrich_vram_gb)
    installed = await list_ollama_models(settings.ollama_url)
    model, tier, _ = await resolve_enrich_model(settings)
    payload = tiers_payload(
        installed=installed,
        vram_gb=vram,
        active_tier=tier,
        active_model=model,
    )
    payload["continuous"] = {
        "enabled": settings.enrich_continuous and settings.vlm_enabled,
        "interval_sec": settings.enrich_interval_sec,
        "batch_size": settings.enrich_batch_size,
        "quality_min": settings.enrich_quality_min,
        "last_pass_at": last_enrich_pass_at() or None,
    }
    payload["vlm_enabled"] = settings.vlm_enabled
    return payload


@router.post("/enrich/tick")
async def enrich_tick(
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Run one continuous-enrich drip batch now (non-blocking)."""
    if not settings.vlm_enabled:
        raise HTTPException(status_code=400, detail="VLM_ENABLED is false")
    background.add_task(run_enrich_pass, settings)
    return {"queued": True, "message": "Enrich drip queued"}


@router.get("/shots/{shot_id}/quality")
async def shot_quality(
    shot_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    """Tag / enrichment quality score for a shot (pass gate for re-enrich)."""
    shot = await ShotRepository(session).get(shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    qa = score_enrichment(shot)
    stored = (shot.source_meta_json or {}).get("enrichment_quality")
    return {
        "shot_id": str(shot_id),
        "enrichment_version": shot.enrichment_version or 0,
        "live": qa,
        "stored": stored,
        "link_hints": (shot.source_meta_json or {}).get("link_hints"),
    }


@router.post("/projects/{project_id}/enrich", response_model=IngestResponse)
async def enrich_project(
    project_id: UUID,
    body: EnrichRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    tier = body.tier if body.tier in ("auto", "fast", "balanced", "quality") else None
    model_name, resolved_tier, _vram = await resolve_enrich_model(
        settings, tier=tier, model_override=body.model  # type: ignore[arg-type]
    )

    job = Job(
        id=str(uuid4()),
        project_id=str(project_id),
        type="enrich",
        status="pending",
        progress_pct=0.0,
        current_step="queued",
        total_items=0,
        processed_items=0,
        payload_json={
            "shot_ids": [str(s) for s in body.shot_ids] if body.shot_ids else None,
            "force": body.force,
            "tier": resolved_tier,
            "model": model_name,
        },
    )
    await JobRepository(session).create(job)
    await session.commit()

    background.add_task(
        run_enrich_job,
        job.id,
        str(project_id),
        shot_ids=[str(s) for s in body.shot_ids] if body.shot_ids else None,
        force=body.force,
        tier=resolved_tier,
        model=model_name,
        settings=settings,
    )
    return IngestResponse(
        job=JobRead.model_validate(job),
        message=f"Enrichment queued · {resolved_tier} · {model_name}",
    )


@router.post("/projects/{project_id}/dedupe", response_model=IngestResponse)
async def dedupe_project(
    project_id: UUID,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Compute phashes, collapse near-dupes within sequences, and mark project-wide duplicates."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job = Job(
        id=str(uuid4()),
        project_id=str(project_id),
        type="dedupe",
        status="pending",
        progress_pct=0.0,
        current_step="queued",
        total_items=0,
        processed_items=0,
        payload_json={},
    )
    await JobRepository(session).create(job)
    await session.commit()

    background.add_task(run_dedupe_job, job.id, str(project_id), settings=settings)
    return IngestResponse(
        job=JobRead.model_validate(job),
        message="Dedupe job queued — hashes, sequence collapse, project-wide near-dupes",
    )


@router.post("/projects/{project_id}/reindex", response_model=IngestResponse)
async def reindex_project(
    project_id: UUID,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Re-embed all project shots into Qdrant without re-extracting frames."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job = Job(
        id=str(uuid4()),
        project_id=str(project_id),
        type="reindex",
        status="pending",
        progress_pct=0.0,
        current_step="queued",
        total_items=0,
        processed_items=0,
        payload_json={},
    )
    await JobRepository(session).create(job)
    await session.commit()

    background.add_task(run_reindex_job, job.id, str(project_id), settings=settings)
    return IngestResponse(job=JobRead.model_validate(job), message="Reindex job queued")
