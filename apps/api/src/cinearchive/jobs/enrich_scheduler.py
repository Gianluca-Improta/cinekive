"""Always-on enrichment scheduler — drip-feeds VLM tagging + QA re-enrich."""

from __future__ import annotations

import asyncio
import time
from typing import Any
from uuid import uuid4

from sqlalchemy import func, or_, select

from cinearchive.config import Settings
from cinearchive.db.models.job import Job
from cinearchive.db.models.project import Project
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.enrich_runner import ENRICHMENT_VERSION, enrich_shot_batch, resolve_enrich_model
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.tag_quality import score_enrichment
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

_task: asyncio.Task | None = None
_last_pass_at = 0.0
_busy = False
_wake_at = 0.0
_status: dict[str, Any] = {
    "current_step": "Starting…",
    "busy": False,
    "last_processed": 0,
    "last_model": None,
    "last_error": None,
}


def last_enrich_pass_at() -> float:
    return _last_pass_at


def schedule_enrich_pass(*, delay_sec: float = 30.0) -> None:
    """Debounced wake — used after ingest and when VLM comes back."""
    global _wake_at
    _wake_at = max(_wake_at, time.time() + delay_sec)


async def count_pending_enrich(settings: Settings) -> int:
    """Shots still needing craft enrichment."""
    async with SessionLocal() as session:
        q = (
            select(func.count())
            .select_from(Shot)
            .where(Shot.is_duplicate == False)  # noqa: E712
            .where(Shot.deleted_at.is_(None))
            .where(
                or_(
                    Shot.enrichment_version == 0,
                    Shot.enrichment_version.is_(None),
                    Shot.enrichment_version < ENRICHMENT_VERSION,
                )
            )
        )
        return int((await session.execute(q)).scalar() or 0)


def enrich_activity_snapshot(settings: Settings) -> dict[str, Any]:
    """Live scheduler state for Activity panel + health."""
    from cinearchive.services import vlm_config as vc

    rt = vc.load_runtime(settings)
    interval = float(rt.enrich_interval_sec or settings.enrich_interval_sec)
    return {
        "enabled": vc.effective_enabled(settings),
        "continuous": vc.effective_continuous(settings),
        "busy": _busy,
        "interval_sec": interval,
        "batch_size": int(rt.enrich_batch_size or settings.enrich_batch_size),
        "last_pass_at": _last_pass_at or None,
        "last_processed": int(_status.get("last_processed") or 0),
        "last_model": _status.get("last_model"),
        "last_error": _status.get("last_error"),
        "current_step": _status.get("current_step"),
        "wake_scheduled": _wake_at > time.time(),
    }


async def _pick_candidates(settings: Settings, limit: int) -> list[tuple[str, str | None]]:
    """Return [(shot_id, project_id)] needing enrich or QA polish."""
    async with SessionLocal() as session:
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
        now = time.time()
        # Don't thrash the same QA-fail shots every pass (12h cooldown)
        reenrich_cooldown_sec = 12 * 3600
        for s in candidates:
            meta = s.source_meta_json or {}
            eq = meta.get("enrichment_quality") or {}
            if eq.get("pass") is True and float(eq.get("score") or 0) >= settings.enrich_quality_min:
                continue
            checked_at = float(eq.get("checked_at") or 0)
            score = float(eq.get("score") or 0)
            # Hard fails (unenriched fallback) can retry sooner
            cooldown = 1800 if score < 20 else reenrich_cooldown_sec
            if checked_at and (now - checked_at) < cooldown:
                continue
            qa = score_enrichment(s)
            if qa["needs_reenrich"] or float(qa["score"]) < settings.enrich_quality_min:
                out.append((s.id, s.project_id))
            if len(out) >= limit:
                break
        return out


async def _create_drip_job(*, total: int, model_name: str) -> str:
    job_id = str(uuid4())
    async with SessionLocal() as session:
        from cinearchive.repositories.job_repo import JobRepository

        job = Job(
            id=job_id,
            project_id=None,
            type="enrich_drip",
            status="running",
            progress_pct=0.0,
            current_step=f"Craft AI · {model_name}",
            total_items=total,
            processed_items=0,
            payload_json={"model": model_name, "continuous": True},
        )
        await JobRepository(session).create(job)
        await session.commit()
    return job_id


async def _finish_drip_job(
    job_id: str,
    *,
    ok: int,
    fail: int,
    model_name: str,
    failed: bool = False,
    error: str | None = None,
) -> None:
    total = ok + fail
    if failed:
        await update_job(
            job_id,
            status="failed",
            current_step=error or "Craft enrich failed",
            error_message=(error or "")[:2000] or None,
            progress_pct=100.0,
            processed_items=total,
        )
        return
    step = (
        f"Tagged {ok} shot{'s' if ok != 1 else ''}"
        + (f" · {fail} need polish" if fail else "")
        + f" · {model_name}"
    )
    await update_job(
        job_id,
        status="completed",
        current_step=step,
        progress_pct=100.0,
        processed_items=total,
        total_items=max(total, 1),
    )


async def run_enrich_pass(settings: Settings) -> dict:
    """One drip batch. Safe to call from scheduler or API."""
    global _last_pass_at, _busy, _status
    if _busy:
        return {"skipped": True, "reason": "busy"}

    from cinearchive.services import vlm_config as vc

    if not vc.effective_enabled(settings):
        _status.update(
            {
                "busy": False,
                "current_step": "VLM off — enable in Settings",
                "last_error": None,
            }
        )
        return {"skipped": True, "reason": "vlm_disabled"}

    _busy = True
    _status["busy"] = True
    job_id: str | None = None
    try:
        model_name, tier, vram = await resolve_enrich_model(settings)
        _status["last_model"] = model_name

        from cinearchive.pipelines.vlm_enrichment import VLMEnricher

        if not await VLMEnricher(settings, model=model_name).health():
            pending = await count_pending_enrich(settings)
            _status.update(
                {
                    "current_step": f"Waiting for VLM ({model_name})… {pending} shots queued",
                    "last_error": "provider_unreachable",
                    "last_processed": 0,
                }
            )
            schedule_enrich_pass(delay_sec=30.0)
            return {
                "skipped": True,
                "reason": "vlm_unreachable",
                "pending": pending,
                "model": model_name,
            }

        batch_size = int(vc.load_runtime(settings).enrich_batch_size or settings.enrich_batch_size)
        batch = await _pick_candidates(settings, batch_size)
        pending = await count_pending_enrich(settings)

        if not batch:
            _last_pass_at = time.time()
            _status.update(
                {
                    "current_step": "Idle — craft tags up to date",
                    "last_processed": 0,
                    "last_error": None,
                }
            )
            return {
                "skipped": False,
                "processed": 0,
                "pending": pending,
                "model": model_name,
                "tier": tier,
                "vram_gb": vram,
            }

        job_id = await _create_drip_job(total=len(batch), model_name=model_name)
        _status["current_step"] = f"Enriching {len(batch)} shots · {model_name}"

        by_project: dict[str | None, list[str]] = {}
        for sid, pid in batch:
            by_project.setdefault(pid, []).append(sid)

        total_ok = 0
        total_fail = 0
        done = 0
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
                ids,
                settings=settings,
                model_name=model_name,
                project_ctx=ctx,
                job_id=job_id,
                progress_offset=done,
                progress_total=len(batch),
            )
            done += len(ids)
            total_ok += counts.get("ok", 0)
            total_fail += counts.get("fail", 0)

        _last_pass_at = time.time()
        _status.update(
            {
                "last_processed": total_ok + total_fail,
                "current_step": f"Last pass: {total_ok} tagged · {pending - (total_ok + total_fail)} still queued",
                "last_error": None,
            }
        )
        if job_id:
            await _finish_drip_job(job_id, ok=total_ok, fail=total_fail, model_name=model_name)

        logger.info(
            "Continuous enrich: %d ok / %d fail · model=%s tier=%s · %d pending",
            total_ok,
            total_fail,
            model_name,
            tier,
            max(0, pending - (total_ok + total_fail)),
        )
        return {
            "skipped": False,
            "processed": total_ok + total_fail,
            "ok": total_ok,
            "fail": total_fail,
            "pending": pending,
            "model": model_name,
            "tier": tier,
            "vram_gb": vram,
        }
    except Exception as exc:
        _status.update(
            {
                "last_error": str(exc)[:500],
                "current_step": f"Enrich error — retrying soon",
            }
        )
        if job_id:
            await _finish_drip_job(job_id, ok=0, fail=0, model_name=_status.get("last_model") or "?", failed=True, error=str(exc))
        schedule_enrich_pass(delay_sec=45.0)
        raise
    finally:
        _busy = False
        _status["busy"] = False


async def enrich_scheduler_loop(settings: Settings) -> None:
    global _wake_at
    from cinearchive.services import vlm_config as vc

    logger.info(
        "Enrich scheduler started (interval=%ss, batch=%s)",
        settings.enrich_interval_sec,
        settings.enrich_batch_size,
    )
    _status["current_step"] = "Scheduler started"
    await asyncio.sleep(15)
    while True:
        try:
            rt = vc.load_runtime(settings)
            interval = float(rt.enrich_interval_sec or settings.enrich_interval_sec)

            if not vc.effective_continuous(settings):
                _status["current_step"] = "Continuous enrich off"
                await asyncio.sleep(10)
                continue

            if not vc.effective_enabled(settings):
                _status["current_step"] = "VLM off — enable in Settings"
                await asyncio.sleep(10)
                continue

            now = time.time()
            if _wake_at > 0 and now < _wake_at:
                await asyncio.sleep(min(5.0, _wake_at - now))
                continue
            if _wake_at > 0:
                _wake_at = 0.0

            result = await run_enrich_pass(settings)
            reason = result.get("reason")
            processed = int(result.get("processed") or 0)
            pending = int(result.get("pending") or 0)

            if reason == "vlm_unreachable":
                await asyncio.sleep(20)
            elif processed > 0 and pending > 50:
                # Backlog mode — drip as fast as the GPU can take
                await asyncio.sleep(max(2.0, min(interval, 8.0)))
            elif processed > 0:
                await asyncio.sleep(max(5.0, min(interval, 20.0)))
            elif pending > 0:
                _status["current_step"] = f"{pending} shots waiting for craft tags"
                await asyncio.sleep(max(10.0, min(interval, 30.0)))
            else:
                await asyncio.sleep(max(45.0, interval))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Enrich scheduler pass failed: %s", exc)
            schedule_enrich_pass(delay_sec=60.0)
            await asyncio.sleep(45)


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
