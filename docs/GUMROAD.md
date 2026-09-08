# Cinekive Pro on Gumroad

One-time license for the **desktop** app. Source stays MIT, but Free is now the
default everywhere: installers, Docker, and source builds all start Free, and Pro
requires a real `license.json` (Gumroad key or signed trial key).

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
- Board export (PNG / PDF lookbooks) + lookbook layout templates
- Pro moodboard canvas (pan, zoom, minimap, stickies, concepts)
- Folder watcher (auto-ingest)
- Share tunnel (public browse link)
- Global dedupe + inspiration seek / Agent API
- **MCP server** for Cursor / Claude / OpenClaw agents (`cinekive-mcp`)
- Generate stills from a reference (BYO OpenAI / OpenRouter image key)
- Unlimited projects
- No upgrade / promo nags
- Email support (best-effort, ~48h)

License seats: **3 machines** per key (tracked via Gumroad `uses`). Lifetime / Annual updates within major v1.x. Offline grace: **14 days** after last successful online verify.

Source stays open (MIT). Buying Pro supports the project and unlocks packaged entitlements.

**FAQ on listing:**

- Free vs Pro: see table in README.
- Mac Gatekeeper / Windows SmartScreen: unsigned builds — Open / Run anyway.
- Building from source gives you Free, same as the installer; Pro needs a license key.
- Want to try first? Ask for a signed 14-day trial key (cinekive@agentmail.to).

## App / API env (packaged desktop)

| Variable | Purpose |
|----------|---------|
| `GUMROAD_PRODUCT_ID` | Product id(s) for `licenses/verify` (comma-separated if Annual + Lifetime) |
| `GUMROAD_PRODUCT_PERMALINK` | Alternate: product permalink slug(s), e.g. `cinekive-pro,cinekive-pro-annual` |
| `GUMROAD_ACCESS_TOKEN` | Optional; only if your Gumroad setup requires it |
| `CINEKIVE_PRO_URL` | Buy URL shown in UI |
| `CINEKIVE_LICENSE_ENFORCE=true` | Set by the packaged launcher. Free is now the default even when this is unset, so leaving it off no longer unlocks Pro |
| `CINEKIVE_LICENSE_PATH` | Path to `license.json` |
| `CINEKIVE_LICENSE_DEVICE_LIMIT` | Max Gumroad `uses` / devices (default **3**) |
| `CINEKIVE_LICENSE_REVERIFY_SEC` | Online re-check interval (default 14 days) |
| `CINEKIVE_LICENSE_GRACE_SEC` | Offline Pro grace after last verify (default 14 days) |
| `CINEKIVE_SUPPORT_EMAIL` | Default `cinekive@agentmail.to` |
| `CINEKIVE_ALLOW_DEV_LICENSE` | Local dev only: accept `CINEKIVE-DEV-PRO` and honour `CINEKIVE_TIER=pro`. Packaged builds hard-set this to `false` |
| `CINEKIVE_TRIAL_SECRET` | HMAC secret for minting/verifying `CK-TRIAL-…` keys (mint machine + packaged env must match) |

## 14-day trial keys (testers)

Mint on a machine that holds `CINEKIVE_TRIAL_SECRET` (never commit the secret):

```bash
export CINEKIVE_TRIAL_SECRET="$(python -m cinearchive.scripts.mint_trials --generate-secret)"
# save that secret into release/desktop env as CINEKIVE_TRIAL_SECRET=
python -m cinearchive.scripts.mint_trials \
  --email alice@example.com \
  --email bob@example.com \
  --out secrets/trial-mint.json
```

Behavior:

- Absolute `exp` timestamp (not “14 days from install”).
- Expiry checked against trusted network time when online; clock rollback vs last trusted sample is rejected.
- Each key’s `jti` is burned on first activate — deactivate does **not** free the key; ask for a regenerate.
- Residual risk: open-source clients can be patched; trials are for trusted testers. Paid seats stay on Gumroad.

**Release builds must share the mint secret**, or every trial key is rejected as
forged. Store it as the `CINEKIVE_TRIAL_SECRET` repo secret in GitHub Actions; the
Windows / macOS / Linux jobs in `.github/workflows/desktop.yml` pass it through to
electron-builder. Rotating the secret invalidates all outstanding keys.

## Activation + verification flow

1. Buyer gets a Gumroad license key.
2. Settings → **Cinekive Pro** → paste key → `POST /license/activate`.
3. API calls Gumroad `POST /v2/licenses/verify`:
   - Probe with `increment_uses_count=false` to read `uses`.
   - Reject if `uses >= device_limit` (default 3) and this machine is new — clear error naming the limit.
   - Activate with `increment_uses_count=true` to register the seat; write signed `license.json`.
4. While online, `GET /license/entitlements` / `POST /license/reverify` re-checks with `increment_uses_count=false` about every **14 days**.
5. Offline: Pro stays active for **14 days** after last successful verify; then Pro tools lock until re-check. **Free Desktop always keeps working.**
6. What leaves the machine for licensing: **license key + product id/permalink** to Gumroad only — not media, not a Cinekive account.

## Dev unlock

For local development, set `CINEKIVE_ALLOW_DEV_LICENSE=true` and either activate with
key `CINEKIVE-DEV-PRO` or set `CINEKIVE_TIER=pro`. Without that opt-in, a source
checkout resolves to Free — same as a released installer.

## After publish

1. Set `GUMROAD_PRODUCT_ID` and/or `GUMROAD_PRODUCT_PERMALINK` in desktop/native env templates used by CI/release.
2. Confirm verify works with a test purchase / Gumroad test license.
3. Update README buy link if the slug changed.
