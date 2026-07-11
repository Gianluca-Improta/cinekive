# Packaging & distribution

Cinekive is **local-first**. You can run it as a desktop app, in the browser, or on a server.

## Downloads (Windows / Mac / Linux)

| Platform | Artifact | Engine |
|----------|----------|--------|
| **Windows** | `Cinekive-*-win-x64.exe` · `*-portable.exe` | **Docker optional** — auto downloads `engine-win-x64.zip` if Docker missing |
| **macOS** | `Cinekive-*-mac-*.dmg` | Docker Desktop required (native pack coming) |
| **Linux** | AppImage / `.deb` | Docker Desktop required (native pack coming) |

Also on each release: **`engine-win-x64.zip`** — native sidecars (Qdrant, Python API, Next.js, ffmpeg, Node).

## Engine modes (desktop)

| Mode | Behavior |
|------|----------|
| **auto** (default) | Docker if available; else native on Windows |
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

Build locally (Windows):

```powershell
.\scripts\build-engine-pack.ps1
# → dist/engine-win-x64.zip
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

## Roadmap

1. **Now** — Windows native engine pack + GHCR + auto engine mode  
2. **Next** — Mac/Linux engine packs, signed builds, auto-update  
3. **Later** — Single offline installer, ONNX embedding (smaller download)

Track progress in [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) and [ROADMAP.md](ROADMAP.md).
