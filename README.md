# Cinekive

**Your cinematic archive. Local. Searchable. Yours.**

Drop a film, a stills folder, or a URL. Cinekive finds the heroes, tags the craft,
and lets you pull the frame you meant — by look, director, technique, or mood —
without scrubbing a timeline or renting someone else's library.

Inspired by FilmGrab, EyeCandy, Flim & Kive. Built to live on **your** machine.

<p align="center">
  <img src="docs/showcase/frame-6.jpg" width="32%" alt="Cinematic still" />
  <img src="docs/showcase/frame-3.jpg" width="32%" alt="Archive still" />
  <img src="docs/showcase/frame-1.jpg" width="32%" alt="Archive still" />
</p>

<p align="center">
  <a href="https://github.com/Gianluca-Improta/cinekive/releases"><img src="https://img.shields.io/github/v/release/Gianluca-Improta/cinekive?label=release" alt="Release" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
  <img src="https://img.shields.io/badge/stack-Next.js%20%2B%20FastAPI%20%2B%20Qdrant-informational" alt="Stack" />
  <img src="https://img.shields.io/badge/data-stays%20on%20your%20disk-success" alt="Local" />
  <a href="https://github.com/Gianluca-Improta/cinekive/discussions"><img src="https://img.shields.io/badge/discussions-join%20in-purple" alt="Discussions" /></a>
</p>

<p align="center">
  <a href="#downloads">Downloads</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#tour">Tour</a> ·
  <a href="#roadmap--v2">Roadmap / v2</a> ·
  <a href="#join-in">Join in</a> ·
  <a href="#creator--support">Creator & support</a>
</p>

---

## Downloads

**[→ Get Cinekive for Windows, Mac, or Linux](https://github.com/Gianluca-Improta/cinekive/releases/latest)**

| Platform | What to download |
|----------|------------------|
| **Windows** | `Cinekive-*-win-x64.exe` (installer) or `*-portable.exe` |
| **macOS** | `Cinekive-*-mac-arm64.dmg` (Apple Silicon) or `*-mac-x64.dmg` (Intel) |
| **Linux** | `Cinekive-*.AppImage` (run directly) or `.deb` |

### Install in 3 steps

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** and start it (needed for the search engine — one-time)  
2. Download the app for your OS from the release page  
3. Open Cinekive → pick your library folder → **Start**

That’s it. No terminal required for normal use.

> **macOS:** first open may need right-click → Open (unsigned build).  
> **Linux AppImage:** `chmod +x Cinekive-*.AppImage && ./Cinekive-*.AppImage`

A fully Docker-free engine is in progress ([PACKAGING.md](docs/PACKAGING.md)). Until then Docker Desktop is the only extra dependency.

### Prefer the browser?

```powershell
.\scripts\bootstrap.ps1   # Windows
```

```bash
./scripts/bootstrap.sh    # macOS / Linux
```

Then open http://localhost:3000

---

## Screenshots

<p align="center">
  <img src="docs/showcase/ui-library.png" width="90%" alt="FilmGrab archive grid" />
</p>
<p align="center"><em>Browse your archive — heroes, craft filters, FilmGrab / ShotDeck / your own ingest</em></p>

<p align="center">
  <img src="docs/showcase/ui-discovery.png" width="90%" alt="Discovery grid" />
</p>
<p align="center"><em>Discovery — find frames by look, technique, mood</em></p>

<p align="center">
  <img src="docs/showcase/ui-moodboard.png" width="90%" alt="Moodboard canvas" />
</p>
<p align="center"><em>Moodboard — drag project clips, stickies, text, stacks, named concepts</em></p>

<p align="center">
  <img src="docs/showcase/ui-commercials.png" width="90%" alt="Commercials project" />
</p>
<p align="center"><em>Own footage — commercials / narrative / social shelves</em></p>

<p align="center">
  <img src="docs/showcase/ui-archives.png" width="90%" alt="Archives UI" />
</p>
<p align="center"><em>Archives — mirrors, logins, more sources</em></p>

<p align="center">
  <img src="docs/showcase/library-reel.gif" width="80%" alt="Sample archive frames reel" />
</p>
<p align="center"><em>Sample frames (your library stays private — nothing under <code>data/</code> is in git)</em></p>

---

## Why it exists

| The old way | With Cinekive |
|-------------|---------------|
| Bookmark FilmGrab forever | Own the frames on disk |
| Scrub Resolve for “that neon night” | Type it. SigLIP + craft filters. |
| Brief in a Google Doc the AI never sees | Brief lives on the project |
| yt-dlp in one terminal, ingest in another | Paste URL → download → ingest |
| Moodboards scattered across tools | Per-project canvas: stacks, concepts, notes, audio |

---

## What you get (v0.3)

- **Narrative / Commercial / Social** — ingest your own footage (drop files or any yt-dlp URL)
- **Archives** — FilmGrab, EyeCandy, ShotDeck, MovieStillsDB, StillsLab mirrors + Discover list
- **Search** — film titles, directors, techniques, eras, visual look (SigLIP + metadata routing)
- **Inspector + full panel** — side inspector by default; click the image for a large stage
- **Moodboards** — infinite canvas, project clip rail (drag in), text, stickies, audio/media URLs, named concepts, stacks
- **Desktop or browser** — Windows / Mac / Linux app, or web at `:3000`
- **Local-first** — no cloud account; optional temporary share link via tunnel
- **Agent API** — clean local HTTP API for multi-agent / automation workflows

---

## Quick start

### Easiest: bootstrap (browser)

```powershell
git clone https://github.com/Gianluca-Improta/cinekive.git
cd cinekive
.\scripts\bootstrap.ps1
```

```bash
git clone https://github.com/Gianluca-Improta/cinekive.git
cd cinekive
./scripts/bootstrap.sh
```

Open **http://localhost:3000** — needs Docker Desktop running. First search may download SigLIP (~800 MB).

### Desktop app

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it  
2. Download from [Releases](https://github.com/Gianluca-Improta/cinekive/releases) **or** build:

```powershell
.\scripts\desktop.ps1 -Dist        # → apps/desktop/release/
```

```bash
cd apps/desktop && npm run dist:mac     # macOS
cd apps/desktop && npm run dist:linux   # Linux
```

First launch: wizard → pick archive folder → Start. Guide: [docs/DESKTOP.md](docs/DESKTOP.md).

> Your media is never in the repo. `data/` is gitignored. Point `LIBRARY_HOST_PATH` at any drive.

Packaging / no-Docker plans: [docs/PACKAGING.md](docs/PACKAGING.md) · Full guide: [docs/GUIDE.md](docs/GUIDE.md) · Agent API: [docs/AGENT_API.md](docs/AGENT_API.md)

---

## Tour

First open shows a short onboarding. Re-run anytime from the top bar **Tour**.

| Step | What |
|------|------|
| Shelves | Narrative / Commercial / Social vs Archives |
| Ingest | Full-screen drop zone + URL paste |
| Archives | Mirrors (with logins) + More sources |
| Moodboard | Project → Moodboard → drag from clip rail or Send to board |
| Inspector | Default side panel; click image / double-click for full stage |

---

## Stack

| Layer | Tech |
|-------|------|
| UI | Next.js 15 |
| API | FastAPI (`cinearchive` package) |
| Vectors | Qdrant + SigLIP |
| Enrichment | Optional local VLM (Ollama) |
| Desktop | Electron + Docker Compose |
| Data | SQLite + files on disk |

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│  Web / App  │────▶│  FastAPI     │────▶│  Qdrant │
│  :3000      │     │  :8000       │     │  :6333  │
└─────────────┘     └──────┬───────┘     └─────────┘
                           │
                    data/library · artifacts · db
```

---

## Roadmap / v2

Ideas on the table — **comment, upvote, and PR**. Nothing here is locked.

### Likely v2

- [ ] **No-Docker desktop** — bundled Qdrant + Python API + Next (see `engine-native.js`)
- [ ] Pre-built GHCR images (faster first Docker launch)
- [ ] Richer canvas: resize frames, video preview loops on the board, PDF/ref cards
- [ ] Brief → board: pitch text → ranked shots auto-laid on a moodboard
- [ ] Better archive sync UX (resume, progress, selective film ingest)
- [ ] One-click shareable static HTML gallery export
- [ ] Signed desktop builds + auto-update
- [ ] Deeper craft graph (shape / genre / lighting links across the library)
- [ ] Multi-user / team library on a shared GPU box (still self-hosted)

### Wildcards (tell us if you want these)

- Resolve / Premiere panel plugins
- Mobile companion for on-set stills
- Federated “public shelf” of *your* cleared stills (opt-in only)
- Framechain bridge: send a board concept → [framechain.ai](https://framechain.ai) AI video draft

Full living list: [docs/ROADMAP.md](docs/ROADMAP.md) · discuss in [GitHub Discussions](https://github.com/Gianluca-Improta/cinekive/discussions).

---

## Join in

This is an open, local-first tool for filmmakers and editors. **You are invited.**

- **Ideas & feedback** → [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) (preferred for “what if…”)
- **Bugs** → [Issues](https://github.com/Gianluca-Improta/cinekive/issues)
- **Code** → [Contributing](CONTRIBUTING.md) — small focused PRs welcome
- **Show your board** → post a screenshot (no private client work) in Discussions

Respect copyright: mirror scripts are for *your* licensed access; we do not ship anyone else’s stills in the repo.

---

## Creator & support

Built by **[Gianluca Improta](https://gianlucaimprota.com)**.

| Link | For |
|------|-----|
| [framechain.ai](https://framechain.ai) | Cheap canvas AI video generation |
| [gianlucaimprota.com](https://gianlucaimprota.com) | Director / maker portfolio |
| [gemimedia.cn](https://gemimedia.cn) | Video production |
| [GitHub Sponsors](https://github.com/sponsors/Gianluca-Improta) | **Donations welcome** — keeps Cinekive local-first and moving |

Same links live in the app under **Settings → Creator & support** and in the sidebar.

---

## License

MIT — use it, fork it, keep your library private.

```
Copyright (c) 2026 Cinekive contributors
```
