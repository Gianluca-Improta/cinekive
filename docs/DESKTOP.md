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

Engine data: `%APPDATA%\Cinekive\data` (Windows) / `~/Library/Application Support/Cinekive` (Mac) / `~/.config/Cinekive` (Linux). Stills stay in the folder you chose.

### Free vs Pro

The installer is the same binary. **Free** includes search, ingest, canvas, single-shot export, and LAN phone URL. **Pro** ($19 one-time on [Gumroad](https://gianlucaimprota.gumroad.com/l/cinekive-pro)) unlocks archive mirrors, continuous enrich, batch export, share tunnel, Agent API, and unlimited projects.

Activate: in-app **Settings → Cinekive Pro** (or paste your license key). License file: `%APPDATA%\Cinekive\license.json` (Mac/Linux under Application Support / `.config`).

Pro support: hello@gianlucaimprota.com. Seller / env setup: [GUMROAD.md](GUMROAD.md).

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
