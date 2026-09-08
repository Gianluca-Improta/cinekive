"""Always-on dedupe scheduler — debounced global pass after ingests + periodic sweep."""

from __future__ import annotations

import asyncio
import time

from cinearchive.config import Settings
from cinearchive.jobs.dedupe_global_runner import last_completed_at, run_global_dedupe_pass
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

_wake_at = 0.0
_task: asyncio.Task | None = None


def schedule_global_dedupe(*, delay_sec: float = 60.0) -> None:
    """Request a global dedupe pass after delay_sec (debounced)."""
    global _wake_at
    _wake_at = max(_wake_at, time.time() + delay_sec)


async def dedupe_scheduler_loop(settings: Settings) -> None:
    """Run in API lifespan — periodic + debounced ingest-triggered dedupe."""
    global _wake_at
    from cinearchive.services import library_config as lib_cfg

    on_ingest, global_on = lib_cfg.resolve_dedupe(settings)
    logger.info(
        "Dedupe scheduler started (interval=%ss, on_ingest=%s, global=%s)",
        settings.dedupe_interval_sec,
        on_ingest,
        global_on,
    )
    while True:
        await asyncio.sleep(10)
        _, global_on = lib_cfg.resolve_dedupe(settings)
        if not global_on:
            continue
        from cinearchive.services.entitlements import has_feature

        if not has_feature("global_dedupe", settings):
            continue
        now = time.time()
        due_debounce = _wake_at > 0 and now >= _wake_at
        due_interval = (now - last_completed_at()) >= settings.dedupe_interval_sec
        if due_debounce or (due_interval and last_completed_at() > 0):
            if due_debounce:
                _wake_at = 0.0
            await run_global_dedupe_pass(settings=settings)
        elif due_interval and last_completed_at() == 0:
            await run_global_dedupe_pass(settings=settings)


def start_dedupe_scheduler(settings: Settings) -> asyncio.Task:
    global _task
    if _task and not _task.done():
        return _task
    _task = asyncio.create_task(dedupe_scheduler_loop(settings))
    return _task


async def stop_dedupe_scheduler() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
        try:
            await _task
        except asyncio.CancelledError:
            pass
    _task = None
