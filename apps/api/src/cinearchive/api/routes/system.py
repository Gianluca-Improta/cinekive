"""System info — library paths, packaging, share hints, storage quality."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Request
from pydantic import BaseModel, Field

from cinearchive.api.deps import get_settings
from cinearchive.config import Settings
from cinearchive.pipelines.realesrgan import find_realesrgan
from cinearchive.services import library_config as lib_cfg
from cinearchive.utils.paths import library_root

router = APIRouter(prefix="/system", tags=["system"])


class LibraryConfigPatch(BaseModel):
    max_edge: int | None = Field(default=None, ge=0, le=8192)
    jpeg_quality: int | None = Field(default=None, ge=40, le=98)
    export_upscale: int | None = Field(default=None, ge=1, le=4)
    realesrgan_enabled: bool | None = None
    realesrgan_bin: str | None = None
    dedupe_on_ingest: bool | None = None
    dedupe_global: bool | None = None
    # { project_id: { max_edge?, jpeg_quality?, export_upscale? } | null to clear }
    archives: dict[str, dict[str, Any] | None] | None = None


@router.get("")
async def system_info(settings: Settings = Depends(get_settings)) -> dict:
    from cinearchive.services import entitlements as ent

    lib = library_root(settings)
    on_ingest, global_dedupe = lib_cfg.resolve_dedupe(settings)
    return {
        "app": "Cinekive",
        "version": "0.5.3",
        "entitlements": ent.entitlements_payload(settings),
        "library_dir": str(lib.resolve()),
        "videos_dir": str(Path(settings.videos_dir).resolve()),
        "artifacts_dir": str(Path(settings.artifacts_dir).resolve()),
        "models_dir": str(Path(settings.models_dir).resolve()),
        "dedupe": {
            "on_ingest": on_ingest,
            "global": global_dedupe,
        },
        "database_url": settings.database_url.split("///")[-1] if "sqlite" in settings.database_url else "remote",
        "packaging": {
            "modes": [
                {
                    "id": "docker",
                    "label": "Docker (current)",
                    "summary": "Full stack: web + API + Qdrant. Set LIBRARY_HOST_PATH in .env to put the archive on any drive.",
                },
                {
                    "id": "pwa",
                    "label": "Install as app (PWA)",
                    "summary": "Install the UI from the browser (Add to Home Screen / Install). The local API still runs on your machine.",
                },
                {
                    "id": "desktop",
                    "label": "Desktop app",
                    "summary": "Windows / Mac / Linux Electron shell — first-run wizard, starts Docker, Share menu. Build with scripts/desktop.ps1 -Dist (or dist:mac / dist:linux).",
                },
                {
                    "id": "web",
                    "label": "Web app",
                    "summary": "Browser at localhost:3000 — same UI. Use Docker compose or the desktop launcher to run the engine.",
                },
            ],
        },
        "share": {
            "options": [
                {
                    "id": "lan",
                    "label": "Phone on same WiFi",
                    "summary": "Open the LAN URL on your phone while Cinekive runs on your computer. Same WiFi only — nothing leaves your network.",
                },
                {
                    "id": "export-zip",
                    "label": "Share package / ZIP / PPTX",
                    "summary": "Project → Share / export. Gallery ZIP (index.html + stills/), PowerPoint, or lookbook PDF. Drag stills straight into PPT.",
                    "pro": True,
                },
                {
                    "id": "tunnel",
                    "label": "Temporary public link",
                    "summary": "Run Cloudflare Tunnel or ngrok against localhost:3000 to let someone browse your library live (read-only if you keep ingest closed).",
                    "commands": [
                        "cloudflared tunnel --url http://localhost:3000",
                        "npx localtunnel --port 3000",
                    ],
                    "pro": True,
                },
                {
                    "id": "static-gallery",
                    "label": "Static gallery package",
                    "summary": "Share / export → Share package. Unzip and open index.html — no server needed.",
                },
            ],
        },
        "how_to_move_library": [
            "Stop Cinekive (docker compose down).",
            "Set LIBRARY_HOST_PATH in .env to your folder (e.g. D:/CinekiveLibrary).",
            "Copy existing data/library contents into that folder if migrating.",
            "Start again (docker compose up -d). Archives open from the new drive.",
        ],
    }


@router.get("/library")
async def get_library_config(settings: Settings = Depends(get_settings)) -> dict:
    cfg = lib_cfg.load_library(settings)
    on_ingest, global_dedupe = lib_cfg.resolve_dedupe(settings)
    bin_path = find_realesrgan(settings)
    return {
        "config": {
            **cfg.model_dump(),
            # Effective values (post-bootstrap) for the Settings UI
            "dedupe_on_ingest": on_ingest,
            "dedupe_global": global_dedupe,
        },
        "realesrgan_available": bin_path is not None,
        "realesrgan_path": str(bin_path) if bin_path else None,
        "presets": {
            "max_edge": [
                {"value": 960, "label": "960px — compact"},
                {"value": 1280, "label": "1280px — lean"},
                {"value": 1600, "label": "1600px — default"},
                {"value": 2048, "label": "2048px — roomy"},
                {"value": 0, "label": "Original — largest disk"},
            ],
            "export_upscale": [
                {"value": 1, "label": "As stored"},
                {"value": 2, "label": "2× Real-ESRGAN"},
                {"value": 4, "label": "4× Real-ESRGAN"},
            ],
        },
    }


@router.put("/library")
async def put_library_config(
    body: LibraryConfigPatch,
    settings: Settings = Depends(get_settings),
) -> dict:
    patch = body.model_dump(exclude_unset=True)
    cfg = lib_cfg.merge_library(settings, patch)
    # Hot-apply global dedupe scheduler when the toggle changes
    if "dedupe_global" in patch:
        from cinearchive.jobs.dedupe_scheduler import start_dedupe_scheduler, stop_dedupe_scheduler

        await stop_dedupe_scheduler()
        if cfg.dedupe_global:
            start_dedupe_scheduler(settings)
    bin_path = find_realesrgan(settings)
    return {
        "ok": True,
        "config": cfg.model_dump(),
        "realesrgan_available": bin_path is not None,
        "realesrgan_path": str(bin_path) if bin_path else None,
    }


@router.get("/verify-library")
async def verify_library_endpoint(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Doctor: SQLite ↔ Qdrant consistency report."""
    from cinearchive.scripts.doctor import verify_library

    qdrant = getattr(request.app.state, "qdrant", None)
    return await verify_library(settings, qdrant=qdrant)


@router.post("/rebuild-index")
async def rebuild_index_endpoint(
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Queue reindex for all projects (SQLite is source of truth)."""
    from cinearchive.scripts.doctor import rebuild_all_indexes

    return await rebuild_all_indexes(settings, background_add_task=background.add_task)

