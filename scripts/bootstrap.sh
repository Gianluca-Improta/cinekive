#!/usr/bin/env bash
# One-command bootstrap for Cinekive (Docker engine).
set -euo pipefail
cd "$(dirname "$0")/.."

echo ""
echo "  Cinekive bootstrap"
echo "  ------------------"

if ! docker info >/dev/null 2>&1; then
  echo ""
  echo "  Docker is required for this install path."
  echo "  Install Docker Desktop / Engine, start it, then re-run ./scripts/bootstrap.sh"
  echo "  Native (no Docker) engine is experimental — see docs/PACKAGING.md"
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "  Created .env from .env.example"
fi

mkdir -p data/videos data/artifacts data/qdrant data/db data/models data/library

# Host yt-dlp (URL paste uses the API container; host CLI helps scripts)
if command -v python3 >/dev/null 2>&1 || command -v python >/dev/null 2>&1; then
  PY=$(command -v python3 || command -v python)
  echo "  Ensuring yt-dlp on this machine…"
  "$PY" -m pip install -U "yt-dlp>=2024.8.0" >/dev/null 2>&1 || true
  if command -v yt-dlp >/dev/null 2>&1; then
    echo "  yt-dlp $(yt-dlp --version 2>/dev/null || true)"
  fi
fi

echo "  Starting stack (first run may take several minutes)…"
docker compose up -d --build

echo ""
echo "  Open  http://localhost:3000"
echo "  API   http://localhost:8000/docs"
echo "  First search may download SigLIP (~800 MB) into ./data/models"
echo ""
echo "  Downloads: https://github.com/Gianluca-Improta/cinekive/releases"
echo ""
