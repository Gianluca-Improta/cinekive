# Cinekive Desktop

Double-click app. No terminal required. **Docker is optional** on Windows and Mac.

## For users

1. Download the installer for your OS from [Releases](https://github.com/Gianluca-Improta/cinekive/releases/latest)
2. **Windows:** run `Cinekive-*-win-x64.exe` (one-click install) or `*-portable.exe` (no install)
3. **Mac:** open `Cinekive-*-mac-*.dmg`, drag Cinekive to Applications
4. Open **Cinekive** → wizard → click **Start Cinekive** (native engine downloads once, ~550 MB)

| OS | Artifact |
|----|----------|
| Windows | `Cinekive-*-win-x64.exe` (installer) or `*-portable.exe` |
| macOS | `Cinekive-*-mac-*.dmg` (build on a Mac) |
| Linux | `Cinekive-*-linux-*.AppImage` / `.deb` |

### Everyday use

| Action | Where |
|--------|--------|
| Browse / search / ingest | Main window |
| Change archive folder | Menu → **Cinekive → Choose library folder…** |
| Share a live view link | Menu → **Share → Create view link…** |
| Settings | Menu or in-app sidebar |
| Check for app updates | Menu → **Help → Check for updates…** (also nudges on launch) |
| Update the engine pack | Menu → **Help → Update engine pack…** |

Engine data: `%APPDATA%\Cinekive\data` (Windows) / `~/Library/Application Support/Cinekive` (Mac) / `~/.config/Cinekive` (Linux). Stills stay in the folder you chose.

A public view link is browse-only.

### Network access and the access token

The API listens on this machine only (`127.0.0.1`) by default, so nothing else
on your network can reach the library.

To browse from a phone or tablet on the same WiFi, turn on **LAN access** in
Settings → Share. When it is on:

- the API binds to `0.0.0.0` and **asks every non-local device for an access
  token**;
- the token is generated per install and stored in
  `%APPDATA%\Cinekive\access.json`;
- **Share → Copy phone URL (WiFi)…** copies a link that carries the token, so
  the phone pairs in one tap — the web app keeps it and sends it with every
  request;
- a device arriving without the token gets a "Connect to Cinekive" prompt
  instead of the library.

Turning LAN access off binds the API back to localhost and stops the token
from being accepted.

### Using it on a phone

The web app is responsive down to a 360 px screen. Below the `md` breakpoint
the sidebar becomes a drawer (the menu button in the top bar opens it), the
top bar collapses to icons, and touch targets stay large enough to hit with a
thumb.

### macOS: Apple Silicon only for the native engine

The macOS DMG installs on both Intel and Apple Silicon Macs, but the **native
engine pack is Apple Silicon only**. PyTorch stopped publishing x86_64 macOS
wheels (the last is 2.2.x, the engine needs 2.5+), so an Intel Mac cannot run
the native engine.

- **Apple Silicon (M1/M2/M3/M4)** — the native engine, no extra software.
- **Intel Mac** — Cinekive asks for Docker Desktop and runs the engine in
  Docker mode. The app says so instead of failing on a download.

### Engine pack and shell updates

The desktop shell and the engine ship separately. A shell update no longer
re-downloads the ~550 MB engine pack; the pack is refreshed only when the
engine payload itself changes, or when you run **Help → Update engine pack…**.

### Signing a release

Installers are unsigned until GitHub Actions secrets are set. Unsigned builds still ship. With the secrets, the same workflow signs them:

| Secret | Used for |
|--------|----------|
| `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` | Windows Authenticode (base64 `.pfx` and its password) |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | macOS Developer ID Application (base64 `.p12`) |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | macOS notarization, only when `CSC_LINK` is also set |

There is no certificate in this repository. SmartScreen and Gatekeeper warnings stay until those secrets exist on the repo.

### Free vs Pro

The installer is the same binary, and building from source gives you the same Free tier. **Free** includes search, ingest, single-shot export, LAN phone URL, and **local Ollama** (+ Craft chat in the sidebar). **Pro** (paid license) unlocks the **moodboard canvas**, automated archive pull, continuous enrich, **cloud VLM** (OpenRouter / ChatGPT / Claude / Kimi), batch export, **board PNG/PDF**, **folder watcher**, share tunnel, Agent API, **MCP server** (`cinekive-mcp`), global dedupe, and unlimited projects.

Activate: in-app **Settings → Cinekive Pro** (or paste your license key). License file: `%APPDATA%\Cinekive\license.json` (Mac/Linux under Application Support / `.config`).

**Trials:** a signed `CK-TRIAL-…` key activates the same way and unlocks Pro for 14
days, then the app returns to Free. Building from source also gives you Free, so
there is no difference to work around.

**Folder watcher (Pro):** Project brief panel → enable watch on the project inbox (or any absolute path). New stills/clips dropped there auto-ingest.

**Board export (Pro):** Moodboard toolbar → PNG or PDF.

Pro support: cinekive@agentmail.to. Seller / env setup: [GUMROAD.md](GUMROAD.md).

## For developers

```powershell
.\scripts\desktop.ps1              # run (Windows)
.\scripts\desktop.ps1 -Dist        # Windows installer + portable

cd apps/desktop
npm run dist:mac                   # macOS (run on Mac)
npm run dist:linux                 # Linux AppImage + deb
```

## Web app (same UI)

```powershell
.\scripts\start.ps1   # or docker compose up -d
# → http://localhost:3000
```

Optional: browser → Install Cinekive (PWA). Theme chrome is black/neutral, not cyan.

## Requirements

- ~2 GB free for the native engine pack (first launch)  
- Optional: [Docker Desktop](https://www.docker.com/products/docker-desktop/) if you prefer Docker mode  
- Optional: GPU + Ollama for VLM craft tags (`VLM_ENABLED=true`)
