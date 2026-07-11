# Packaging & distribution

Cinekive is **local-first**. The desktop app is a real Windows program; Docker runs the engine in the background.

## Ways to run it

| Mode | Who | What you get |
|------|-----|----------------|
| **Desktop app** | Everyone | Installer / portable `.exe` — wizard, window, tray, Share menu |
| **PWA** | Quick UI install | Browser → Install Cinekive (engine still local) |
| **Docker / compose** | Power users & servers | `docker compose up` as today |
| **Hosted VPS** | Teams | Same compose on a GPU box + domain |

## Desktop app (end users)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)  
2. Run `Cinekive-*-setup.exe` (or the portable build)  
3. Open **Cinekive** → wizard → pick archive folder → **Start**  

Details: [DESKTOP.md](DESKTOP.md).

### Build the installer (developers)

```powershell
.\scripts\desktop.ps1 -Dist
# → apps/desktop/release/
```

The installer bundles API + web Docker build context. On first packaged launch it copies the stack to `%APPDATA%\Cinekive\runtime` (writable `.env`) and data to `%APPDATA%\Cinekive\data`.

**Menu:** library folder, Share view link, restart engine, settings.

Requires **Docker Desktop** for this generation. Later: sidecars so end users never open Docker.

## Share a view link

```powershell
.\scripts\share-tunnel.ps1
# or Desktop → Share → Create view link
```

Also: select shots → **Export ZIP**.

## Choose where the archive lives

Desktop wizard / menu, or:

```env
LIBRARY_HOST_PATH=D:/CinekiveLibrary
CINEKIVE_DATA_DIR=C:/Users/You/AppData/Roaming/Cinekive/data
```

## Hosted (team server)

Same as before: compose on a machine with disk (+ optional GPU), reverse proxy on `:3000`, optional auth.

## Roadmap

1. **Now** — Electron installer + first-run wizard + Docker engine  
2. **Next** — Pre-built images from a registry (faster first launch)  
3. **Then** — Sidecars / no Docker for end users  
4. **Later** — Static gallery export; optional read-only publish  
