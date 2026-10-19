# Cinekive Archive (`app.cinekive`)

Static, installable PWA — public, read-only inspiration archive companion to the Cinekive desktop app.

## What it is

- Browse real photographed / licensed stills from `frames.json` (edited via PR)
- AI **tags** (craft analysis) — not image generation
- Every frame requires non-empty `source` + `license` or it is skipped (`console.warn`)
- **Lists** (Favorites + custom) live in the visitor's IndexedDB only — no accounts, no sync
- Export/import JSON is the entire cross-device story
- Real `manifest.json`, `sw.js`, and multi-size PNG icons for install / future TWA (Bubblewrap)

Clearly branded **Cinekive Archive** so it is never mistaken for the desktop product.

## Run locally

```bash
cd app.cinekive
npx --yes serve .
```

Open the printed URL (service worker needs `http(s)`, not `file://`).

## frames.json shape

```json
{
  "id": "frame-001",
  "src": "https://…",
  "ratio": "2.39:1",
  "title": "Optional title",
  "tags": ["anamorphic", "neon", "night exterior"],
  "source": "Unsplash — Photographer Name",
  "license": "Unsplash License (…)"
}
```

## Lists export format

```json
{
  "version": 1,
  "exportedAt": "…",
  "app": "cinekive-archive",
  "lists": [{ "id": "favorites", "name": "Favorites", "frameIds": ["frame-001"] }]
}
```

## Deploy

Point `app.cinekive.ai` (or `app.cinekive.com`) at this folder as a static host (Netlify, Cloudflare Pages, S3, nginx). Serve over HTTPS for installability.

## Android / Play (later)

Wrap with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) TWA using this origin + icons — no app rebuild required beyond the static PWA assets already here.
