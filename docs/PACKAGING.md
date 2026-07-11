# Packaging & distribution

Cinekive is **local-first**. You can run it as a desktop app, in the browser, or on a server.

## Downloads (Windows / Mac / Linux)

| Platform | Artifact | Engine |
|----------|----------|--------|
| **Windows** | `Cinekive-*-win-x64.exe` · `*-portable.exe` | **Docker optional** — auto downloads `engine-win-x64.zip` if Docker missing |
| **macOS** | `Cinekive-*-mac-*.dmg` | **Docker optional** — auto downloads `engine-mac-arm64.zip` or `engine-mac-x64.zip` |
| **Linux** | AppImage / `.deb` | Docker Desktop required (native pack coming) |

Also on each release: **`engine-win-x64.zip`**, **`engine-mac-arm64.zip`**, **`engine-mac-x64.zip`** — native sidecars (Qdrant, Python API, Next.js, ffmpeg, Node).

## Engine modes (desktop)

| Mode | Behavior |
|------|----------|
| **auto** (default) | Docker if available; else native on Windows / Mac |
| **docker** | Requires Docker Desktop; pulls `ghcr.io/gianluca-improta/cinekive-*` when possible |
| **native** | Spawns Qdrant + API + web locally; no Docker |

Config: `%APPDATA%\Cinekive\config.json` → `"engineMode": "auto" | "docker" | "native"`

Logs: `%APPDATA%\Cinekive\data\engine\logs\` or **Cinekive menu → Open engine logs**

## Native engine layout

```
{dataDir}/engine/
  qdrant/qdrant.exe
  python/          # venv with cinearchive + torch CPU
  web/server.js
  node/node.exe
  ffmpeg/bin/ffmpeg.exe
  logs/
  version.txt
```

Build locally:

```powershell
.\scripts\build-engine-pack.ps1
# → dist/engine-win-x64.zip
```

```bash
chmod +x ./scripts/build-engine-pack-mac.sh
./scripts/build-engine-pack-mac.sh arm64   # or x64
# → dist/engine-mac-arm64.zip
```

Dev setup (all platforms):

```powershell
.\scripts\native-setup.ps1   # Windows
./scripts/native-setup.sh      # macOS / Linux
```

## Ways to run it

| Mode | Who | What you get |
|------|-----|----------------|
| **Desktop app** | Everyone | Installer — wizard, engine auto-select, tray |
| **Bootstrap (browser)** | Devs | `.\scripts\bootstrap.ps1` |
| **Docker / compose** | Servers | `docker compose up` |
| **GHCR images** | Docker users | Pre-built API + web (no local build) |

## GHCR images

On each release tag, CI publishes:

- `ghcr.io/gianluca-improta/cinekive-api:latest`
- `ghcr.io/gianluca-improta/cinekive-web:latest`

Desktop compose pulls these before falling back to `docker compose build`.

## Build the desktop installer (developers)

```powershell
.\scripts\desktop.ps1 -Dist
```

```bash
cd apps/desktop && npm run dist:mac
cd apps/desktop && npm run dist:linux
```

## Phone on same WiFi

When `lanAccess` is enabled (default), the native engine and Docker stack bind to `0.0.0.0`. Open **Settings → Share** for the LAN URL, or **Share → Copy phone URL** in the desktop menu. The web UI routes API calls to port 8000 on the same host automatically.

## Roadmap

1. **Now** — Windows + Mac native engine packs, GHCR, LAN phone access  
2. **Next** — Linux engine pack, signed builds, auto-update  
3. **Later** — Single offline installer, ONNX embedding (smaller download)

Track progress in [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) and [ROADMAP.md](ROADMAP.md).
