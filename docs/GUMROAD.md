# Cinekive Pro on Gumroad

One-time license for the **desktop** app. Source stays MIT; self-built / Docker without `CINEKIVE_LICENSE_ENFORCE` stays unlocked (honor system).

## Product checklist (seller)

1. Create product **Cinekive Pro** on [Gumroad](https://gumroad.com).
2. Enable **License Keys**.
3. Price: **$19** (early-bird **$12** for first 100 — use Gumroad quantity discount or a second product).
4. Deliverable: license key + link to [latest GitHub release](https://github.com/Gianluca-Improta/cinekive/releases/latest).
5. Permalink (default in app): `https://gianlucaimprota.gumroad.com/l/cinekive-pro`  
   Override with `CINEKIVE_PRO_URL` / `NEXT_PUBLIC_PRO_URL` if the slug differs.

## Listing copy (paste)

**Title:** Cinekive Pro — local cinematic archive, studio tools unlocked

**Subtitle:** One-time $19. No subscription. Works offline after activate.

**Body:**

Cinekive Free is your local FilmGrab-style archive: search, ingest, canvas, single-shot export.

Pro unlocks studio workflow on the same installer:

- Archive mirror sync tools
- Continuous craft enrich + cloud VLM settings
- Bring-your-own cloud VLM: OpenRouter, ChatGPT/OpenAI, Claude (via OpenRouter), Kimi
- Batch export (multi-shot ZIP / EDL)
- Board export (PNG / PDF lookbooks)
- Folder watcher (auto-ingest)
- Share tunnel (public browse link)
- Global dedupe + inspiration seek / Agent API
- Unlimited projects
- No upgrade / promo nags
- Email support (best-effort, ~48h)

License seats: **2 machines** (home + laptop). Lifetime updates within major v1.x.

Source stays open (MIT). Buying Pro supports the project and unlocks packaged entitlements.

**FAQ on listing:**

- Free vs Pro: see table in README.
- Mac Gatekeeper / Windows SmartScreen: unsigned builds — Open / Run anyway.
- Self-built from source: no license checks; Pro is for the packaged desktop + support.

## App / API env (packaged desktop)

| Variable | Purpose |
|----------|---------|
| `GUMROAD_PRODUCT_ID` | Product permalink ID for `licenses/verify` |
| `GUMROAD_ACCESS_TOKEN` | Optional; only if your Gumroad setup requires it |
| `CINEKIVE_PRO_URL` | Buy URL shown in UI |
| `CINEKIVE_LICENSE_ENFORCE=true` | Free until activated (set by packaged launcher) |
| `CINEKIVE_LICENSE_PATH` | Path to `license.json` |
| `CINEKIVE_SUPPORT_EMAIL` | Default `hello@gianlucaimprota.com` |
| `CINEKIVE_ALLOW_DEV_LICENSE` | Accept `CINEKIVE-DEV-PRO` (default on in non-prod) |

## Activation flow

1. Buyer gets a Gumroad license key.
2. Settings → **Cinekive Pro** → paste key → `POST /license/activate`.
3. API verifies via Gumroad (when `GUMROAD_PRODUCT_ID` is set), writes signed `license.json`.
4. Offline: valid signed Pro license stays Pro; after 30 days since last verify, UI may show `needs_reverify` but does not lock out immediately.

## Dev unlock

With `CINEKIVE_ALLOW_DEV_LICENSE=true` (default for local), activate with key `CINEKIVE-DEV-PRO`.

## After publish

1. Set `GUMROAD_PRODUCT_ID` in desktop/native env templates used by CI/release.
2. Confirm verify works with a test purchase / Gumroad test license.
3. Update README buy link if the slug changed.
