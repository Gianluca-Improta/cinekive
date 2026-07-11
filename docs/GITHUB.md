# Publishing & discoverability (GitHub)

Public repo: **https://github.com/Gianluca-Improta/cinekive**

## What ships vs what stays private

| Include | Exclude (gitignored) |
|---------|----------------------|
| `apps/`, `scripts/`, `docs/`, compose files | `./data/` (your library, DB, models, Qdrant) |
| `LICENSE`, READMEs, community files | `.env` and any passwords |
| FilmGrab / EyeCandy **mirror scripts** | Mirrored JPGs/GIFs under `data/library/` |
| `docs/showcase/` UI screenshots + sample frames | Private client boards |

Clone → `start` → empty archive. Users build their own library.

## SEO / Explore checklist

Keep these green so GitHub and search engines surface the project:

- [x] Clear **description** + **homepage** (Releases) + **topics** (filmmaking, moodboard, local-first, …)
- [x] `README.md` + `README.zh-CN.md` with downloads, screenshots, keywords in prose
- [x] [FAQ](FAQ.md) · [Compare](COMPARE.md) for “FilmGrab alternative” style queries
- [x] Discussions enabled (Ideas / Q&A / Show and tell)
- [x] Issue + PR templates · `SECURITY.md` · `CODE_OF_CONDUCT.md` · `SUPPORT.md`
- [ ] **Social preview image** (Settings → General → Social preview) — use `docs/showcase/ui-library.png` or a 1280×640 crop
- [ ] **Pin Discussions** in the GitHub UI (Welcome #2, Vote #4, Getting started #5) — API pin is limited
- [ ] Optional: star the repo yourself + short demo clip in README later

## Release checklist

- [ ] `git status` shows no files under `data/`
- [ ] No `.env` staged
- [ ] Version bumped in `apps/desktop/package.json`
- [ ] Tag `vX.Y.Z` and push — desktop workflow attaches Win/Mac/Linux assets
- [ ] Post in **Announcements**: what’s new + link Discussions for feedback
- [ ] Bump FAQ / Compare if UX changed

## Getting the word out (lightweight)

1. Share the [latest release](https://github.com/Gianluca-Improta/cinekive/releases/latest) with one GIF from `docs/showcase/`
2. Post in editor / filmmaker Discords and Reddit (`r/editors`, `r/Filmmakers`) — lead with *local* and *own your frames*, link FAQ for Docker
3. Product Hunt / indie hacker launch when no-Docker ships (bigger unlock)
4. Short vertical demo: drop URL → heroes → moodboard (30–45s)
5. Chinese audience: point to `README.zh-CN.md` + zh UI

## Naming note

Product name in UI/docs: **Cinekive**. Internal Python package remains `cinearchive` for stability.
