#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

mkdir -p data/videos data/artifacts data/qdrant data/db data/models data/library

echo "Starting Cinekive…"
docker compose up -d --build

echo ""
echo "  Web  http://localhost:3000"
echo "  API  http://localhost:8000/docs"
echo "  First run may download SigLIP (~800MB) into ./data/models"
echo ""
