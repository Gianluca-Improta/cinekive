# Cinekive guide

## Mental model

- **Project** = a job or look library (e.g. “NSS heroes”, “Neon night refs”)
- **Brief** = feeling + write-up + references on that project (AI reads it)
- **Shot** = a still or hero frame with craft tags
- **Work / collection** = optional film-level grouping
- **Bin** = soft-deleted shots (30 days, then gone)

## First hour

1. Start the stack (`scripts/start.sh` or `start.ps1`).
2. Create a project in the sidebar.
3. Open it → expand **Project brief & management**:
   - Feeling: one line vibe
   - Brief: what you’re hunting for
   - References: films / DPs / eras
4. Ingest:
   - Drop a short `.mp4`, or
   - Paste a YouTube URL and hit **Import URL**, or
   - Drop a folder of stills / GIFs
5. Wait for the job banner. Then search: `rain neon close-up`
6. Click **Enrich** if Ollama vision is running — tags get much richer.

## Ingest tips

| Source | Tip |
|--------|-----|
| Your own edits | Best signal — motion + dialogue possible |
| YouTube one clip | Paste URL in the project drop zone (needs `yt-dlp` in API image) |
| EyeCandy / FilmGrab | Project → Inspiration archives → **Start mirror** → **Ingest** |
| Whole channels | Usually worse — curate clip-by-clip, then let Cinekive tag |

**Take on Downr:** keep using a simple downloader for one-off YouTube grabs if you like —
or paste the URL into Cinekive. We don’t embed proprietary Downr; we use `yt-dlp` locally
so the path is: link → file → ingest → AI. Same muscle memory, one less app hop.

## Brief → AI

When you Enrich or run Moodboard inside a project, Cinekive injects:

- project feeling
- brief text
- references

So the model knows “humid neon, quiet dread” instead of guessing from the frame alone.

## Filters & craft

- Filter dial: techniques, eras, themes, genres, shapes
- Click a technique chip or color swatch on a card to hunt similar
- Heroes / moving / favorites chips for quick cuts

## Bin

- **X** on a card → Bin (not permanent)
- Sidebar → **Bin** → restore or delete forever
- Auto-purge after 30 days on API restart

## Hardware

| Profile | Notes |
|---------|-------|
| CPU 16 GB | Works; keep sampling on `heroes` / `fast` |
| NVIDIA 8 GB+ | Faster embeddings + previews |
| Ollama vision 8B+ | Enrichment quality jump |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Empty search | Wait for ingest job; embeddings load on first use |
| YouTube import fails | Ensure API has `yt-dlp` (`pip` dep / rebuild image) |
| Enrich does nothing | `VLM_ENABLED=true`, Ollama reachable, vision model pulled |
| Drop folders ignored | Use Chromium-based browser; or **Choose folder** |

## Open source etiquette

- Don’t redistribute mirrored FilmGrab / EyeCandy assets
- Don’t commit `.env`, `data/`, or model weights
- PRs welcome for taxonomy, ingest, and UX — keep the local-first promise
