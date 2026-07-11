# Sample End-to-End Workflow

This validates the MVP loop: create project → ingest → poll job → browse/search.

## 1. Start the stack

```bash
cp .env.example .env
mkdir -p data/videos data/artifacts data/qdrant data/db data/models
docker compose up -d --build
```

Wait until healthy:

```bash
curl -s http://localhost:8000/health
# {"status":"ok","sqlite":true,"qdrant":true,...}
```

First API start may take several minutes while SigLIP weights download into `./data/models`.

## 2. UI path (recommended)

1. Open http://localhost:3000
2. Click **+** in the sidebar → name the project (e.g. `Commercial Refs`)
3. Drop a short `.mp4` / `.mov` / `.mkv` (30–90s is ideal for first run)
4. Watch the progress banner: Collecting → scene detect → thumbs/previews → embedding
5. Hover cards for preview loops; click for the detail sheet + palette
6. Search `neon city night rain` (or any phrase matching your footage)

## 3. API / script path

```bash
# Linux/macOS / Git Bash
chmod +x scripts/sample_workflow.sh
./scripts/sample_workflow.sh /path/to/your_clip.mp4
```

PowerShell equivalent:

```powershell
$API = "http://localhost:8000"
$project = Invoke-RestMethod -Method Post -Uri "$API/projects" -ContentType "application/json" -Body '{"name":"Sample","sampling_mode":"fast","generate_previews":true}'
$form = @{ files = Get-Item "C:\path\to\clip.mp4" }
$job = Invoke-RestMethod -Method Post -Uri "$API/projects/$($project.id)/ingest/videos/upload" -Form $form
# Poll: Invoke-RestMethod "$API/jobs/$($job.job.id)"
```

## 4. Expected artifacts

After a successful ingest you should see:

| Location | Contents |
|----------|----------|
| `./data/videos/{project_id}/` | Uploaded source files |
| `./data/artifacts/{project_id}/{shot_id}/` | `keyframe.jpg`, `thumb_sm.webp`, `thumb_md.webp`, optional `preview.webp` |
| `./data/db/cinearchive.db` | Projects, shots, jobs |
| Qdrant collection `cinearchive_shots_v1` | 1152-d SigLIP vectors + payload |

## 5. Performance tips

- Use **fast** sampling for first runs (default).
- On CPU-only hosts, expect embedding to dominate runtime; prefer short clips.
- GPU: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build`
- Lower `EMBEDDING_BATCH_SIZE=8` in `.env` if you hit VRAM limits on 8 GB cards.

## 6. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `/health` shows `qdrant: false` | Wait for Qdrant; `docker compose logs qdrant` |
| Ingest fails on ffmpeg | Ensure API image includes ffmpeg (default Dockerfile does) |
| Empty search results | Wait for job `completed`; confirm shots exist via `GET /shots` |
| Model download blocked | Pre-cache on a networked machine, copy `./data/models` |
