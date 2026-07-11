# Contributing to Cinekive

Thanks for helping build a local-first cinematic archive.

**Not sure where to start?** Open a [Discussion](https://github.com/Gianluca-Improta/cinekive/discussions) —
ideas, UX rants, and “has anyone tried…” posts are as valuable as code.

## Dev loop

```bash
./scripts/start.sh   # or start.ps1
# API code is bind-mounted; web may need rebuild depending on compose setup
```

- API: `apps/api/src/cinearchive/`
- Web: `apps/web/src/`
- Desktop: `apps/desktop/`
- Scripts: `scripts/` (mirrors, start helpers)
- Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md)

## Guidelines

- Keep the product **local-first** — no required cloud APIs
- Prefer small, focused PRs
- Don’t commit `data/`, `.env`, or model weights
- Don’t add scrapers that encourage redistributing copyrighted archives as part of the default install
- Match existing tone: concise UI copy, no emoji spam

## Checks

```bash
cd apps/api && ruff check src
cd apps/web && npm run lint
```

## Community

- Discussions → product direction and v2 ideas  
- Issues → bugs and concrete tasks  
- PRs → fixes and features that match the roadmap  

## License

MIT — by contributing you agree your work is licensed under the same terms.
