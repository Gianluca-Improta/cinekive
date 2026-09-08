# Changelog

Notable changes per release. Dates are UTC.

## v0.5.3 — 2026-09-08

### Fixed

- **Semantic search was silently disabled for every query.** The search service had
  gained two filter dials (`camera_angle`, `lens_look`) that the Qdrant repository
  did not accept, so each vector call raised `TypeError` and a broad `except`
  quietly downgraded the query to keyword-only matching. Visual searches were
  matching filenames, which is why moodboards pulled unrelated frames. The
  repository now accepts those dials and tolerates future ones, and the failure is
  logged with a traceback instead of swallowed.
- **Vector scores are calibrated against keyword scores.** Raw SigLIP cosines top
  out near 0.25 while keyword hits score up to 1.0, so a perfect visual match could
  never outrank an incidental title substring. Scores are now mapped onto a shared
  scale using in-query rank and best-match confidence.
- **Re-embedded 13,736 stills** whose stored vectors were all zeros, left behind by
  an earlier ingest that substituted zero vectors when the embedding model failed to
  load. Ingest and reindex now report unsearchable and degenerate vectors instead of
  finishing silently.
- Empty projects can be deleted from the sidebar.

### Changed

- **Free is the default everywhere, including source builds.** Previously the tier
  resolver returned Pro whenever `CINEKIVE_LICENSE_ENFORCE` was unset, so a plain
  clone-and-build unlocked every Pro feature, and `CINEKIVE_TIER=pro` was honoured
  unconditionally. Pro now requires a real `license.json` — a Gumroad activation or
  a signed trial key. `CINEKIVE_TIER=pro` applies only alongside
  `CINEKIVE_ALLOW_DEV_LICENSE=true`, which packaged builds hard-set to `false`.
  Gating remains client-side by nature; this makes Pro a deliberate choice rather
  than the default.

### Added

- **14-day trial keys** (`CK-TRIAL-…`) for testers. Expiry is an absolute timestamp
  checked against trusted network time, so clock rollback does not extend a trial,
  and each key burns on first activation. Mint with
  `python -m cinearchive.scripts.mint_trials`; see [docs/GUMROAD.md](docs/GUMROAD.md).
- **Offline archive previews** — 12 public-domain film stills ship with the app so
  Seed cards render without network access. Archive cards fall back to them when a
  remote preview fails to load. Third-party mirror frames (FilmGrab, ShotDeck,
  EyeCandy, MovieStillsDB) are deliberately not redistributed.
- Press **Space** to play a selected still; hovering for one second starts playback.

### Build

- CI passes `CINEKIVE_TRIAL_SECRET` and `CINEKIVE_LICENSE_SECRET` to the Windows,
  macOS, and Linux installer jobs, so minted trial keys verify in released binaries.
- Tracked 39 source files that were referenced by committed code but had never been
  committed, including the Gemi chat service, the trial licensing module, and the
  desktop web-UI build script. A clean clone could not build before this.
- electron-builder runs with `--publish never`; the release workflow uploads
  artifacts itself.

### Known issues

- The macOS engine-pack jobs fail on a relocatable-Python assertion, so mac users do
  not get a prebuilt native engine pack. Installers are unaffected.

## Earlier releases

See the [GitHub releases page](https://github.com/Gianluca-Improta/cinekive/releases)
for v0.5.1 and earlier notes.
