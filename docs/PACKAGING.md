# Packaging & distribution

Cinekive is **local-first**. You can run it as a desktop app, in the browser, or on a server.

## Downloads (Windows / Mac / Linux)

| Platform | Artifact | Notes |
|----------|----------|--------|
| **Windows** | `Cinekive-*-win-x64.exe` (installer) · `Cinekive-*-portable.exe` | [Releases](https://github.com/Gianluca-Improta/cinekive/releases) |
| **macOS** | `Cinekive-*-mac-*.dmg` | Build on a Mac: `cd apps/desktop && npm run dist:mac` |
| **Linux** | AppImage / `.deb` | `cd apps/desktop && npm run dist:linux` |

**Today’s desktop builds still need [Docker Desktop](https://www.docker.com/products/docker-desktop/)** for the search engine (API + Qdrant + web). The `.exe` / DMG / AppImage is the real app window + tray — Docker runs quietly in the background.

### No-Docker native engine (experimental)

We are building a path where the app spawns **Qdrant + Python API + Next.js** as host processes — no Docker.

| Piece | Status |
|-------|--------|
| `apps/desktop/engine-native.js` | Scaffold — start/stop native processes |
| `scripts/native-setup.ps1` | Downloads Qdrant, venv, builds Next standalone |
| Config `engineMode: "native"` | Wired in `launcher.js` when setup is complete |

```powershell
# Experimental — large download (PyTorch). Docker remains the supported path.
.\scripts\native-setup.ps1
# Then set engineMode to "native" in %APPDATA%\Cinekive\config.json
```

Track progress / vote in [Discussions](https://github.com/Gianluca-Improta/cinekive/discussions) and [docs/ROADMAP.md](ROADMAP.md).

## Ways to run it

| Mode | Who | What you get |
|------|-----|----------------|
| **Desktop app** | Everyone | Installer / portable — wizard, window, tray, Share menu |
| **Bootstrap (browser)** | Devs / power users | `.\scripts\bootstrap.ps1` or `./scripts/bootstrap.sh` |
| **PWA** | Quick UI install | Browser → Install Cinekive (engine still local) |
| **Docker / compose** | Servers | `docker compose up` |
| **Native engine** | Early adopters | Experimental — no Docker (see above) |

## Desktop app (end users)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and start it  
2. Download the installer from [Releases](https://github.com/Gianluca-Improta/cinekive/releases)  
3. Open **Cinekive** → wizard → pick archive folder → **Start**  

Details: [DESKTOP.md](DESKTOP.md).

### Build the installer (developers)

```powershell
.\scripts\desktop.ps1 -Dist
# → apps/desktop/release/
```

```bash
cd apps/desktop && npm run dist:mac     # on macOS
cd apps/desktop && npm run dist:linux   # on Linux
```

## Easier first launch

```powershell
.\scripts\bootstrap.ps1    # Windows
./scripts/bootstrap.sh     # macOS / Linux
```

Creates `.env`, data folders, starts compose, prints http://localhost:3000.

## Roadmap

1. **Now** — Electron installers + Docker engine + bootstrap scripts  
2. **Next** — Pre-built images from GHCR (faster first launch, no local `--build`)  
3. **Then** — Stable native sidecars (no Docker for end users)  
4. **Later** — Signed builds, auto-update, static gallery export  
