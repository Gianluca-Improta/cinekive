"""CineArchive FastAPI application."""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cinearchive.api.auth import SecurityMiddleware
from qdrant_client import QdrantClient
from sqlalchemy import text

from cinearchive.api.routes import (
    board,
    collections,
    enrich,
    health,
    ingest,
    jobs,
    language,
    license,
    modes,
    projects,
    search,
    seek,
    shots,
    sources,
    system,
    taxonomy,
)
from cinearchive.config import get_settings
from cinearchive.db.base import Base
from cinearchive.db.session import engine
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.utils.logging import get_logger, setup_logging

logger = get_logger(__name__)


async def _sqlite_add_columns() -> None:
    """Apply numbered column adds and record cinekive_schema.version."""
    from cinearchive.db.schema_migrate import ensure_schema

    async with engine.begin() as conn:
        added = await ensure_schema(conn)
        if added:
            logger.info("Schema migration added %d column(s)", added)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level)

    from cinearchive.utils.paths import library_root

    for d in (settings.videos_dir, settings.artifacts_dir, settings.models_dir):
        Path(d).mkdir(parents=True, exist_ok=True)
    library_root(settings)
    db_path = settings.database_url.split("///")[-1]
    if db_path and not db_path.startswith("http"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)

    from cinearchive.db import models  # noqa: F401

    # A license signed by the pre-0.6 shared secret is re-signed once with this
    # install's secret, so upgrading never costs a paid user their Pro tier.
    try:
        from cinearchive.services.entitlements import migrate_license_signature

        migrate_license_signature(settings)
    except Exception as exc:
        logger.warning("License signature migration skipped: %s", exc)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if "sqlite" in settings.database_url:
        await _sqlite_add_columns()
        # Legacy shots predate hero grading — keep them visible under Heroes filter
        async with engine.begin() as conn:
            try:
                await conn.execute(
                    text(
                        "UPDATE shots SET is_hero = 1 "
                        "WHERE (is_hero = 0 OR is_hero IS NULL) "
                        "AND sequence_id IS NULL"
                    )
                )
            except Exception:
                pass

    qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
    vector_repo = VectorRepository(qdrant, settings)
    try:
        vector_repo.ensure_collection()
    except Exception:
        pass

    app.state.qdrant = qdrant
    app.state.settings = settings

    from cinearchive.services import library_config as lib_cfg
    from cinearchive.services.watcher import get_watcher

    try:
        await lib_cfg.bootstrap_dedupe_prefs(settings)
    except Exception as exc:
        logger.warning("Dedupe prefs bootstrap skipped: %s", exc)

    # Poller always runs; it only ingests when a project has watch_enabled (Pro).
    watcher = get_watcher(settings)
    watcher.start()
    app.state.watcher = watcher

    from cinearchive.jobs.dedupe_scheduler import start_dedupe_scheduler, stop_dedupe_scheduler
    from cinearchive.jobs.enrich_scheduler import start_enrich_scheduler, stop_enrich_scheduler

    _, dedupe_global = lib_cfg.resolve_dedupe(settings)

    async def _start_background_jobs() -> None:
        # Let /health and the desktop splash succeed before heavy library sweeps.
        await asyncio.sleep(45)
        if dedupe_global:
            start_dedupe_scheduler(settings)
        start_enrich_scheduler(settings)
        logger.info("Background enrich/dedupe schedulers started (delayed)")

    app.state.bg_jobs_task = asyncio.create_task(_start_background_jobs())

    # Purge soft-deleted shots past retention on startup
    try:
        from cinearchive.db.session import SessionLocal
        from cinearchive.services.shot_management import ShotManagementService

        async with SessionLocal() as session:
            svc = ShotManagementService(session, settings, vector_repo)
            purged = await svc.purge_expired()
            if purged:
                logger.info("Startup bin purge: %d shots", purged)
    except Exception as exc:
        logger.warning("Startup bin purge skipped: %s", exc)

    yield

    bg = getattr(app.state, "bg_jobs_task", None)
    if bg and not bg.done():
        bg.cancel()
        try:
            await bg
        except asyncio.CancelledError:
            pass
    await stop_enrich_scheduler()
    await stop_dedupe_scheduler()
    await watcher.stop()
    qdrant.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Cinekive",
        description=(
            "Local-first cinematic visual library. Ingest films, stills, GIFs, and YouTube clips; "
            "search by craft, color, and meaning. 100% offline after model download."
        ),
        version="0.6.0",
        lifespan=lifespan,
    )
    app.add_middleware(SecurityMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(system.router)
    app.include_router(license.router)
    app.include_router(projects.router)
    app.include_router(ingest.router)
    app.include_router(jobs.router)
    app.include_router(shots.router)
    app.include_router(search.router)
    app.include_router(enrich.router)
    app.include_router(collections.router)
    app.include_router(seek.router)
    app.include_router(sources.router)
    app.include_router(taxonomy.router)
    app.include_router(language.router)
    app.include_router(board.router)
    app.include_router(modes.router)
    return app


app = create_app()
