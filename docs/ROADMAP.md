# Cinekive roadmap

Living document. Prefer [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) for debate; open an Issue when something is actionable.

## v0.5.3 (current)

Shipped: local search and ingest, moodboard canvas, Free-by-default licensing, 14-day trial keys, public archive sources (FilmGrab, EyeCandy, MovieStillsDB), desktop installers.

Not in this release until the next tagged build: a macOS engine zip produced by the fixed pack script, and signed installers (the workflow signs when `CSC_LINK` / `WIN_CSC_LINK` secrets exist; they are not in the repo). Still open: a search eval harness in CI, and Lemon Squeezy annual ($19/year). Lifetime is the live checkout.

## Already shipped (was listed as v0.4)

- **Windows: Docker optional** — native engine pack on first start
- GHCR pre-built Docker images (faster Docker launches)
- First-run wizard: engine mode (auto / docker / native), health panel, engine logs
- Local ingest (files + yt-dlp URLs)
- Public archive sources + Discover catalog. No authenticated scrapers for paid still libraries
- SigLIP search + craft / director / color filters
- Inspector + full-stage detail
- Moodboard canvas: clip rail, text, sticky, audio/media, concepts, stacks
- Desktop (Electron) + Docker web
- Optional share tunnel (Pro, with a rights confirmation)

## v1.x hardening

- [ ] Windows / Mac / Linux signed installers + update channel
- [ ] First-run health checks (Docker, GPU, disk paths)
- [ ] Search quality eval set + regression harness
- [ ] Archive mirror resume / selective title ingest polish
- [ ] Docs: short video walkthrough (GIF or MP4 in `docs/showcase/`)

## v2 — product bets

| Theme | Ideas |
|-------|--------|
| **Canvas** | Resize, video loops on board, PDF/ref cards | **Board PNG/PDF export (Pro)** shipped |
| **Brief → board** | Pitch / logline → ranked shots auto-layout |
| **Craft graph** | Stronger shape / lighting / genre connections across library |
| **Team box** | Multi-seat on one self-hosted GPU machine |
| **NLE bridge** | Resolve / Premiere panels; EDL/XML round-trip polish |
| **Framechain** | Optional “send concept to Framechain” for cheap AI video drafts |
| **Gallery export** | Static HTML zip for clients (no server) |

## Explicit non-goals (for now)

- Required cloud account or SaaS lock-in
- Shipping copyrighted still libraries in the git repo
- Replacing your NLE

## How to influence this list

1. Open a Discussion with the label idea  
2. React / comment on others’ threads  
3. Ship a small PR that proves the idea  

Donations via [GitHub Sponsors](https://github.com/sponsors/Gianluca-Improta) help prioritize.
