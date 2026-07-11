# FAQ

Short answers for people finding Cinekive via search or GitHub Explore.

## What is Cinekive?

A **local-first cinematic visual archive**. You keep stills and footage on your disk, search by look / mood / technique / director, build moodboards, and never rent a cloud library account for your own frames.

Think FilmGrab + moodboard + ingest — running on **your** machine.

## Who is it for?

- Editors and directors building lookbooks and reference boards
- Commercial / social teams who want client-safe libraries on a studio drive
- Students and cinephiles collecting stills legally from sites they have access to
- Anyone tired of scrubbing a timeline for “that neon hallway”

## Is this FilmGrab / Flim / Kive / ShotDeck?

Those are great references. Cinekive is **software you run yourself**:

| | Cloud still sites / apps | Cinekive |
|--|--------------------------|----------|
| Where frames live | Their servers (or subscription) | Your disk |
| Search | Site UX | SigLIP visual search + craft filters |
| Your footage | Usually separate | First-class ingest (files + yt-dlp URLs) |
| Moodboard | Often another tool | Per-project canvas |
| Cost model | Subscription / ads | Free MIT + optional Sponsors |

See also [COMPARE.md](COMPARE.md).

## Do I need Docker?

**Yes today** for the search engine (API + Qdrant). Install [Docker Desktop](https://www.docker.com/products/docker-desktop/), start it, then open the desktop app or run bootstrap. A no-Docker path is on the [roadmap](ROADMAP.md).

## Windows / Mac / Linux?

Desktop installers ship on [Releases](https://github.com/Gianluca-Improta/cinekive/releases/latest):

- Windows: `.exe` installer + portable
- macOS: Apple Silicon (`arm64`) and Intel (`x64`) DMGs
- Linux: AppImage + `.deb`

macOS builds are **unsigned** — right-click → Open the first time. Windows SmartScreen may warn for the same reason.

## Why is first search slow?

SigLIP (the visual embedding model) downloads once (~800 MB). Later searches are local.

## Can I paste YouTube / Vimeo / TikTok links?

Yes — ingest uses **yt-dlp** in the API. Paste a URL in the project drop zone. Respect site ToS and copyright.

## Does my library leave my computer?

By default, **no**. Optional features that can send data off-machine:

- Temporary share tunnel (when you turn it on)
- OpenAI-compatible VLM providers (when you configure an API key)

Ollama stays local if you use it that way.

## Multiple languages?

UI packs: English, Chinese, Spanish, French, German, Japanese. Shot/craft taxonomy has full Chinese labels. More locales welcome via PR.

## How do I ask a question or share a board?

[GitHub Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) — prefer that over Issues for soft ideas and screenshots (no private client work).

## Where do donations go?

[GitHub Sponsors](https://github.com/sponsors/Gianluca-Improta) — keeps Cinekive local-first and moving.
