# Agent API (OpenClaw / multi-agent)

CineArchive exposes local REST endpoints designed for orchestration agents.
No cloud calls — all inference stays on your machine.

Base URL: `http://localhost:8000`

## Quick agent query

Natural language → interpreted filters + SigLIP search.

```http
POST /agent/query
Content-Type: application/json

{
  "prompt": "return 5 low-angle tracking shots with melancholic teal-dominant palette matching a rainy neon city logline",
  "project_id": null,
  "limit": 5
}
```

Response:

```json
{
  "interpretation": {
    "raw": "...",
    "filters": {
      "camera_movement": "tracking",
      "color_hex": "#008080",
      "mood_vibe": "melancholic",
      "tags": ["low-angle"]
    },
    "semantic": "..."
  },
  "results": [{ "shot": { "...": "..." }, "score": 0.82 }],
  "message": "Interpreted as semantic search with filters ..."
}
```

## Moodboard from pitch / logline

```http
POST /moodboard
Content-Type: application/json

{
  "text": "A lonely courier drifts through rain-slick neon alleys. Teal practicals, melancholic silence, slow tracking.",
  "project_id": "<optional-uuid>",
  "limit": 24
}
```

Returns extracted `concepts` plus ranked shots.

## Semantic + hybrid search

```http
POST /search
{
  "query": "neon city night rain",
  "project_id": null,
  "shot_type": "wide",
  "tags": ["neon"],
  "color_hex": "#00E5FF",
  "has_preview": true,
  "limit": 48
}
```

## Palette similarity

```http
POST /search/palette
{ "shot_id": "<uuid>", "limit": 24 }
```

or

```http
POST /search/palette
{ "colors": ["#1A2B3C", "#E8D5C4"], "project_id": "<uuid>" }
```

## Enrichment (VLM)

Requires Ollama profile:

```bash
docker compose --profile vlm up -d
# pull model once:
docker exec -it cinearchive-ollama ollama pull qwen2.5vl:7b
# enable in .env: VLM_ENABLED=true
```

```http
POST /projects/{project_id}/enrich
{ "force": false }
```

## Export for FrameChain

```http
POST /export
{
  "shot_ids": ["...", "..."],
  "format": "framechain"
}
```

Formats: `zip` (images + manifest), `json` (CineArchive moodboard), `framechain` (reference import JSON).

## Collections

```http
POST /collections
{ "name": "Pitch board A", "project_id": "..." }

POST /collections/{id}/shots
{ "shot_ids": ["..."] }
```

## Watcher auto-ingest

```bash
# .env
WATCHER_ENABLED=true
```

```http
PATCH /projects/{id}
{
  "watch_folder": "/data/videos/<project_id>/inbox",
  "watch_enabled": true
}
```

Poll status: `GET /watcher/status`

## OpenClaw tip

Point your agent tool at `POST /agent/query` with a short system instruction:

> Always call CineArchive locally. Prefer structured filters when the user names shot type, movement, lighting, mood, or color. Return shot IDs, thumb URLs, timecodes, and palette hexes.
