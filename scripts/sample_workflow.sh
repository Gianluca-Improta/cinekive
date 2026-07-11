#!/usr/bin/env bash
# Sample end-to-end workflow against a running CineArchive stack.
# Prerequisites: docker compose up -d  (API on :8000)
set -euo pipefail

API="${API_URL:-http://localhost:8000}"
SAMPLE="${1:-}"

echo "==> Health"
curl -sf "$API/health" | tee /tmp/cinearchive-health.json
echo

echo "==> Create project"
PROJECT=$(curl -sf -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sample Commercial","description":"E2E sample","sampling_mode":"fast","generate_previews":true}')
echo "$PROJECT"
PROJECT_ID=$(python -c "import json,sys; print(json.load(sys.stdin)['id'])" <<<"$PROJECT")
echo "Project ID: $PROJECT_ID"

if [[ -n "$SAMPLE" && -f "$SAMPLE" ]]; then
  echo "==> Upload video: $SAMPLE"
  JOB=$(curl -sf -X POST "$API/projects/$PROJECT_ID/ingest/videos/upload" \
    -F "files=@${SAMPLE}")
  echo "$JOB"
  JOB_ID=$(python -c "import json,sys; print(json.load(sys.stdin)['job']['id'])" <<<"$JOB")

  echo "==> Poll job $JOB_ID"
  for i in $(seq 1 120); do
    STATUS=$(curl -sf "$API/jobs/$JOB_ID")
    STEP=$(python -c "import json,sys; d=json.load(sys.stdin); print(d['status'], d['progress_pct'], d['current_step'])" <<<"$STATUS")
    echo "  [$i] $STEP"
    STATE=$(python -c "import json,sys; print(json.load(sys.stdin)['status'])" <<<"$STATUS")
    if [[ "$STATE" == "completed" || "$STATE" == "failed" ]]; then
      break
    fi
    sleep 2
  done
else
  echo "==> No sample video provided. Usage: $0 /path/to/clip.mp4"
  echo "    Skipping ingest; listing empty shots."
fi

echo "==> List shots"
curl -sf "$API/shots?project_id=$PROJECT_ID&limit=12" | tee /tmp/cinearchive-shots.json
echo

echo "==> Semantic search"
curl -sf -X POST "$API/search" \
  -H "Content-Type: application/json" \
  -d "{\"query\":\"cinematic close-up\",\"project_id\":\"$PROJECT_ID\",\"limit\":8}"
echo
echo "Done. Open http://localhost:3000/projects/$PROJECT_ID"
