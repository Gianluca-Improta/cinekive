"""System info — library paths, packaging, share hints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends

from cinearchive.api.deps import get_settings
from cinearchive.config import Settings
from cinearchive.utils.paths import library_root

router = APIRouter(prefix="/system", tags=["system"])


@router.get("")
async def system_info(settings: Settings = Depends(get_settings)) -> dict:
    lib = library_root(settings)
    return {
        "app": "Cinekive",
        "version": "0.3.0",
        "library_dir": str(lib.resolve()),
        "videos_dir": str(Path(settings.videos_dir).resolve()),
        "artifacts_dir": str(Path(settings.artifacts_dir).resolve()),
        "models_dir": str(Path(settings.models_dir).resolve()),
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
                    "id": "export-zip",
                    "label": "Export ZIP",
                    "summary": "Select shots → Export. Share the zip privately.",
                },
                {
                    "id": "tunnel",
                    "label": "Temporary public link",
                    "summary": "Run Cloudflare Tunnel or ngrok against localhost:3000 to let someone browse your library live (read-only if you keep ingest closed).",
                    "commands": [
                        "cloudflared tunnel --url http://localhost:3000",
                        "npx localtunnel --port 3000",
                    ],
                },
                {
                    "id": "static-gallery",
                    "label": "Static gallery (roadmap)",
                    "summary": "One-click export of a browsable HTML gallery you can drop on any host.",
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
