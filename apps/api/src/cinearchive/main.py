"""CineArchive FastAPI application."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from qdrant_client import QdrantClient
from sqlalchemy import text

from cinearchive.api.routes import (
    collections,
    enrich,
    health,
    ingest,
    jobs,
    language,
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
    """Best-effort ALTER TABLE for Phase 1/2 columns on existing SQLite DBs."""
    alters = [
        ("projects", "vlm_enrichment", "BOOLEAN DEFAULT 0"),
        ("projects", "watch_folder", "VARCHAR(1024)"),
        ("projects", "watch_enabled", "BOOLEAN DEFAULT 0"),
        ("projects", "brief", "TEXT"),
        ("projects", "feeling", "VARCHAR(512)"),
        ("projects", "references_text", "TEXT"),
        ("projects", "kind", "VARCHAR(32) DEFAULT 'commercial'"),
        ("projects", "form_factor", "VARCHAR(32)"),
        ("projects", "aspect_ratio", "VARCHAR(16)"),
        ("shots", "shot_type", "VARCHAR(64)"),
        ("shots", "camera_movement", "VARCHAR(64)"),
        ("shots", "lighting_style", "VARCHAR(64)"),
        ("shots", "mood_vibe", "VARCHAR(128)"),
        ("shots", "creative_intent", "TEXT"),
        ("shots", "tags_json", "JSON DEFAULT '[]'"),
        ("shots", "enrichment_version", "INTEGER DEFAULT 0"),
        ("shots", "notes", "TEXT"),
        ("shots", "is_favorite", "BOOLEAN DEFAULT 0"),
        ("shots", "content_format", "VARCHAR(64)"),
        ("shots", "emotion", "VARCHAR(64)"),
        ("shots", "sequence_id", "VARCHAR(36)"),
        ("shots", "frame_role", "VARCHAR(16)"),
        ("shots", "hero_score", "FLOAT DEFAULT 0"),
        ("shots", "is_hero", "BOOLEAN DEFAULT 0"),
        ("shots", "is_moving", "BOOLEAN DEFAULT 0"),
        ("shots", "grade_reason", "VARCHAR(255)"),
        ("shots", "phash", "VARCHAR(64)"),
        ("shots", "is_duplicate", "BOOLEAN DEFAULT 0"),
        ("shots", "duplicate_of", "VARCHAR(36)"),
        ("shots", "source_filename", "VARCHAR(512)"),
        ("shots", "source_title", "VARCHAR(512)"),
        ("shots", "source_meta_json", "JSON DEFAULT '{}'"),
        ("shots", "camera_angle", "VARCHAR(64)"),
        ("shots", "composition", "VARCHAR(128)"),
        ("shots", "subject", "VARCHAR(255)"),
        ("shots", "lens_look", "VARCHAR(64)"),
        ("shots", "color_grade", "VARCHAR(64)"),
        ("shots", "techniques_json", "JSON DEFAULT '[]'"),
        ("shots", "keyframe_ms", "INTEGER"),
        ("shots", "source_fps", "FLOAT"),
        ("shots", "collection_id", "VARCHAR(36)"),
        ("shots", "dialogue_json", "JSON"),
        ("shots", "dialogue_text", "TEXT"),
        ("shots", "era", "VARCHAR(64)"),
        ("shots", "origin", "VARCHAR(64)"),
        ("shots", "ism", "VARCHAR(64)"),
        ("shots", "visual_style", "VARCHAR(64)"),
        ("shots", "theme", "VARCHAR(64)"),
        ("shots", "genre", "VARCHAR(64)"),
        ("shots", "shapes_json", "JSON DEFAULT '[]'"),
        ("shots", "deleted_at", "DATETIME"),
        ("collections", "kind", "VARCHAR(32) DEFAULT 'moodboard'"),
        ("collections", "year", "INTEGER"),
        ("collections", "content_format", "VARCHAR(64)"),
        ("collections", "sampling_mode", "VARCHAR(16) DEFAULT 'moments'"),
        ("collections", "cover_shot_id", "VARCHAR(36)"),
        ("collections", "meta_json", "JSON DEFAULT '{}'"),
    ]
    async with engine.begin() as conn:
        for table, column, coltype in alters:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))
                logger.info("Added column %s.%s", table, column)
            except Exception:
                pass
        # Title search index (hybrid keyword channel)
        try:
            await conn.execute(
                text("CREATE INDEX IF NOT EXISTS ix_shots_source_title ON shots (source_title)")
            )
        except Exception:
            pass


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

    from cinearchive.services.watcher import get_watcher

    watcher = get_watcher(settings)
    if settings.watcher_enabled:
        watcher.start()
    app.state.watcher = watcher

    from cinearchive.jobs.dedupe_scheduler import start_dedupe_scheduler, stop_dedupe_scheduler
    from cinearchive.jobs.enrich_scheduler import start_enrich_scheduler, stop_enrich_scheduler

    if settings.dedupe_global:
        start_dedupe_scheduler(settings)
    if settings.enrich_continuous and settings.vlm_enabled:
        start_enrich_scheduler(settings)

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
        version="0.3.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(system.router)
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
    return app


app = create_app()
