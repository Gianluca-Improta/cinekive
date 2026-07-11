# Publishing Cinekive to GitHub

Public repo: **https://github.com/Gianluca-Improta/cinekive**

## What ships vs what stays private

| Include | Exclude (gitignored) |
|---------|----------------------|
| `apps/`, `scripts/`, `docs/`, compose files | `./data/` (your library, DB, models, Qdrant) |
| `LICENSE`, `README`, `.env.example` | `.env` and any passwords |
| FilmGrab / EyeCandy **mirror scripts** | Mirrored JPGs/GIFs under `data/library/` |
| `docs/showcase/` UI screenshots + sample frames | Private client boards |

Clone → `start` → empty archive. Users build their own library.

## Release checklist

- [ ] `git status` shows no files under `data/`
- [ ] No `.env` staged
- [ ] Version bumped in `apps/desktop/package.json` / API if needed
- [ ] Tag `vX.Y.Z` and push — `.github/workflows/release.yml` opens a Release
- [ ] Optionally attach desktop installers from `apps/desktop/release/`
- [ ] Post in Discussions: what’s new + ask for feedback

## Naming note

Product name in UI/docs: **Cinekive**. Internal Python package remains `cinearchive` for stability.
