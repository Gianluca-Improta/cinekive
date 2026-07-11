"""Always-on enrichment scheduler — drip-feeds VLM tagging + QA re-enrich."""

from __future__ import annotations

import asyncio
import time

from sqlalchemy import or_, select

from cinearchive.config import Settings
from cinearchive.db.models.project import Project
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.enrich_runner import ENRICHMENT_VERSION, enrich_shot_batch, resolve_enrich_model
from cinearchive.pipelines.tag_quality import score_enrichment
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

_task: asyncio.Task | None = None
_last_pass_at = 0.0
_busy = False


def last_enrich_pass_at() -> float:
    return _last_pass_at


async def _pick_candidates(settings: Settings, limit: int) -> list[tuple[str, str | None]]:
    """Return [(shot_id, project_id)] needing enrich or QA polish."""
    async with SessionLocal() as session:
        # Prefer never / stale version
        q = (
            select(Shot)
            .where(Shot.is_duplicate == False)  # noqa: E712
            .where(Shot.deleted_at.is_(None))
            .where(
                or_(
                    Shot.enrichment_version == 0,
                    Shot.enrichment_version.is_(None),
                    Shot.enrichment_version < ENRICHMENT_VERSION,
                )
            )
            .order_by(Shot.hero_score.desc(), Shot.created_at.asc())
            .limit(limit)
        )
        rows = list((await session.execute(q)).scalars().all())
        if rows:
            return [(s.id, s.project_id) for s in rows]

        if not settings.enrich_reenrich_fails:
            return []

        # Scan a window of enriched shots for QA fails
        q2 = (
            select(Shot)
            .where(Shot.is_duplicate == False)  # noqa: E712
            .where(Shot.deleted_at.is_(None))
            .where(Shot.enrichment_version >= ENRICHMENT_VERSION)
            .order_by(Shot.created_at.asc())
            .limit(min(80, limit * 20))
        )
        candidates = list((await session.execute(q2)).scalars().all())

        out: list[tuple[str, str | None]] = []
        for s in candidates:
            meta = s.source_meta_json or {}
            eq = meta.get("enrichment_quality") or {}
            # Skip recently checked passes
            if eq.get("pass") is True and float(eq.get("score") or 0) >= settings.enrich_quality_min:
                continue
            qa = score_enrichment(s)
            if qa["needs_reenrich"] or float(qa["score"]) < settings.enrich_quality_min:
                out.append((s.id, s.project_id))
            if len(out) >= limit:
                break
        return out


async def run_enrich_pass(settings: Settings) -> dict:
    """One drip batch. Safe to call from scheduler or API."""
    global _last_pass_at, _busy
    if _busy:
        return {"skipped": True, "reason": "busy"}
    from cinearchive.services import vlm_config as vc

    if not vc.effective_enabled(settings):
        return {"skipped": True, "reason": "vlm_disabled"}

    _busy = True
    try:
        model_name, tier, vram = await resolve_enrich_model(settings)
        batch_size = vc.load_runtime(settings).enrich_batch_size or settings.enrich_batch_size
        batch = await _pick_candidates(settings, int(batch_size))
        if not batch:
            _last_pass_at = time.time()
            return {
                "skipped": False,
                "processed": 0,
                "model": model_name,
                "tier": tier,
                "vram_gb": vram,
            }

        # Group by project for brief context
        by_project: dict[str | None, list[str]] = {}
        for sid, pid in batch:
            by_project.setdefault(pid, []).append(sid)

        total_ok = 0
        total_fail = 0
        for pid, ids in by_project.items():
            ctx: dict = {}
            if pid:
                async with SessionLocal() as session:
                    project = await session.get(Project, pid)
                    if project:
                        ctx = {
                            "project_name": project.name,
                            "project_brief": getattr(project, "brief", None),
                            "project_feeling": getattr(project, "feeling", None),
                            "project_references": getattr(project, "references_text", None),
                        }
            counts = await enrich_shot_batch(
                ids, settings=settings, model_name=model_name, project_ctx=ctx
            )
            total_ok += counts.get("ok", 0)
            total_fail += counts.get("fail", 0)

        _last_pass_at = time.time()
        logger.info(
            "Continuous enrich: %d ok / %d fail · model=%s tier=%s",
            total_ok,
            total_fail,
            model_name,
            tier,
        )
        return {
            "skipped": False,
            "processed": total_ok + total_fail,
            "ok": total_ok,
            "fail": total_fail,
            "model": model_name,
            "tier": tier,
            "vram_gb": vram,
        }
    finally:
        _busy = False


async def enrich_scheduler_loop(settings: Settings) -> None:
    from cinearchive.services import vlm_config as vc

    logger.info(
        "Enrich scheduler started (interval=%ss, batch=%s)",
        settings.enrich_interval_sec,
        settings.enrich_batch_size,
    )
    # Small delay so API finishes boot / Ollama is reachable
    await asyncio.sleep(15)
    while True:
        interval = float(settings.enrich_interval_sec)
        try:
            rt = vc.load_runtime(settings)
            if rt.enrich_interval_sec is not None:
                interval = float(rt.enrich_interval_sec)
            if vc.effective_continuous(settings):
                await run_enrich_pass(settings)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Enrich scheduler pass failed: %s", exc)
        await asyncio.sleep(max(30.0, interval))


def start_enrich_scheduler(settings: Settings) -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _task = asyncio.create_task(enrich_scheduler_loop(settings))
    return _task


async def stop_enrich_scheduler() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
