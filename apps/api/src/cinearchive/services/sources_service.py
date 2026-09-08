"""Bootstrap archive sources (ShotDeck, FilmGrab, EyeCandy) — scan + ingest + mirror."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cinearchive.config import Settings
from cinearchive.services.credentials_service import configured as creds_configured
from cinearchive.services.credentials_service import get_source as get_source_credentials
from cinearchive.utils.paths import library_root

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True)
class SourceSpec:
    key: str
    label: str
    folder: str
    ingest_path: str
    mirror_script: str | None = None
    archive_slug: str = ""
    archive_name: str = ""
    description: str = ""
    site_url: str = ""
    # public = free mirror OK for personal use; gated = paid/login — leave alone in UI
    access: str = "public"


SOURCES: dict[str, SourceSpec] = {
    "filmgrab": SourceSpec(
        key="filmgrab",
        label="FilmGrab",
        folder="_filmgrab",
        ingest_path="/data/library/_filmgrab",
        mirror_script="filmgrab_mirror.py",
        archive_slug="filmgrab-archive",
        archive_name="FilmGrab Archive",
        description="Film stills by title — the classic framegrab library.",
        site_url="https://film-grab.com/",
        access="public",
    ),
    "eyecandy": SourceSpec(
        key="eyecandy",
        label="EyeCandy",
        folder="_eyecandy",
        ingest_path="/data/library/_eyecandy",
        mirror_script="eyecandy_mirror.py",
        archive_slug="eyecandy-archive",
        archive_name="EyeCandy Archive",
        description="Technique GIFs (dolly, whip pan, rack focus…) with craft labels.",
        site_url="https://eyecannndy.com/",
        access="public",
    ),
    "shotdeck": SourceSpec(
        key="shotdeck",
        label="ShotDeck",
        folder="_shotdeck",
        ingest_path="/data/library/_shotdeck",
        mirror_script="shotdeck_mirror.py",
        archive_slug="shotdeck-archive",
        archive_name="ShotDeck Archive",
        description="Commercials, music videos, and indie films from ShotDeck (skips titles already in FilmGrab).",
        site_url="https://shotdeck.com/",
        access="gated",
    ),
    "moviestillsdb": SourceSpec(
        key="moviestillsdb",
        label="MovieStillsDB",
        folder="_moviestillsdb",
        ingest_path="/data/library/_moviestillsdb",
        mirror_script="moviestillsdb_mirror.py",
        archive_slug="moviestillsdb-archive",
        archive_name="MovieStillsDB Archive",
        description="1M+ community stills — previews without login; donator account for full resolution.",
        site_url="https://www.moviestillsdb.com/",
        access="public",
    ),
    "stillslab": SourceSpec(
        key="stillslab",
        label="StillsLab",
        folder="_stillslab",
        ingest_path="/data/library/_stillslab/by_title",
        mirror_script="stillslab_mirror.py",
        archive_slug="stillslab-archive",
        archive_name="StillsLab Archive",
        description="Film/TV/music-video stills — subscription email + password required.",
        site_url="https://stillslab.com/",
        access="gated",
    ),
}

# Prefer free / research-oriented still libraries. Always check each site's terms.
# Curated = discover + open site / save into a custom archive (no bulk mirror unless noted).
# ScreenMusings parked (domain placeholder as of 2026) — re-add when the gallery returns.
CATALOG_SUGGESTIONS: list[dict[str, Any]] = [
    {
        "key": "movie-screencaps",
        "label": "Movie Screencaps",
        "site_url": "https://movie-screencaps.com/",
        "blurb": "Large free HD screencap archive by title — Blu-ray/DVD sourced frames.",
        "fit": "Best free bulk browse after FilmGrab; selective saves into a custom archive.",
        "kind": "free",
    },
    {
        "key": "shotcafe",
        "label": "SHOT.CAFE",
        "site_url": "https://shot.cafe/",
        "blurb": "Curated cinematography stills with color, composition, and crew tags.",
        "fit": "Smaller craft-focused set; free to browse — check ToS before automating.",
        "kind": "free",
    },
    {
        "key": "evanerichards",
        "label": "Evan Richards",
        "site_url": "https://www.evanerichards.com/",
        "blurb": "Long-running free cinematography stills blog — frames by film and DP.",
        "fit": "Great reference (~100k+ grabs); prefer manual / selective saves.",
        "kind": "free",
    },
    {
        "key": "bluscreens",
        "label": "BluScreens",
        "site_url": "https://www.bluscreens.net/",
        "blurb": "High-res Blu-ray screen captures organized by title.",
        "fit": "Manual / selective; fragile fan sites — don't bulk-hammer.",
        "kind": "free",
    },
    {
        "key": "homeofthenutty",
        "label": "Home of the Nutty",
        "site_url": "https://www.homeofthenutty.com/",
        "blurb": "Long-running free screencap galleries — large title coverage.",
        "fit": "Browse + save into a custom archive; ToS-sensitive for scrapers.",
        "kind": "free",
    },
    {
        "key": "screencapped",
        "label": "Screencapped.net",
        "site_url": "https://screencapped.net/",
        "blurb": "Non-profit high-quality screencaps and stills.",
        "fit": "Free browse; selective ingest into your own archive folder.",
        "kind": "free",
    },
    {
        "key": "capsaholic",
        "label": "Caps-a-holic",
        "site_url": "https://caps-a-holic.com/",
        "blurb": "Fan Blu-ray screen-capture galleries organized by title.",
        "fit": "Manual / selective; many sister caps sites are fragile.",
        "kind": "free",
    },
    {
        "key": "wikimedia-film",
        "label": "Wikimedia Commons (film)",
        "site_url": "https://commons.wikimedia.org/wiki/Category:Films",
        "blurb": "Public-domain and freely licensed film imagery, posters, production photos.",
        "fit": "Truly free for many files — license varies per asset; check each file.",
        "kind": "free",
    },
    {
        "key": "internet-archive-film",
        "label": "Internet Archive (movies)",
        "site_url": "https://archive.org/details/movies",
        "blurb": "Public-domain features and related media you can download legally.",
        "fit": "Best for PD films; pair with your own frame extracts via Ingest.",
        "kind": "free",
    },
    {
        "key": "frameset",
        "label": "Frame Set",
        "site_url": "https://frameset.app/",
        "blurb": "Curated frames across film, ads, and music video — freemium search.",
        "fit": "Inspiration / limited free searches; licensed exports only.",
        "kind": "freemium",
    },
    {
        "key": "flim",
        "label": "Flim",
        "site_url": "https://flim.ai/",
        "blurb": "Large searchable movie / MV / ad shot database with AI filters.",
        "fit": "Freemium daily searches; use custom archive for anything you license.",
        "kind": "freemium",
    },
    {
        "key": "seek-film",
        "label": "Seek",
        "site_url": "https://seek.film/",
        "blurb": "1M+ stills searchable by mood, light, and composition.",
        "fit": "Free tier + trial; not a mirror target — browse then save owned exports.",
        "kind": "freemium",
    },
]


def _read_manifest(root: Path, *, max_bytes: int = 900_000) -> dict[str, Any]:
    path = root / "manifest.json"
    if not path.exists():
        return {}
    try:
        if path.stat().st_size > max_bytes:
            return {"_large": True}
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _shotdeck_db_stats(root: Path) -> dict[str, Any]:
    db_path = root / ".cache" / "state.db"
    if not db_path.exists():
        return {}
    try:
        conn = sqlite3.connect(db_path)
        tasks = dict(conn.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status").fetchall())
        shots = dict(conn.execute("SELECT status, COUNT(*) FROM shots GROUP BY status").fetchall())
        conn.close()
        return {"tasks": tasks, "shots": shots}
    except Exception:
        return {}


def _count_from_manifest(manifest: dict[str, Any]) -> int | None:
    if manifest.get("_large"):
        return None
    stats = manifest.get("stats")
    if isinstance(stats, dict):
        for key in ("images_downloaded", "gifs_downloaded", "shots_downloaded"):
            val = stats.get(key)
            if isinstance(val, int) and val > 0:
                return val
    counts = manifest.get("counts")
    if isinstance(counts, dict):
        shots = counts.get("shots")
        if isinstance(shots, dict):
            downloaded = shots.get("downloaded")
            if isinstance(downloaded, int) and downloaded > 0:
                return downloaded
    clips = manifest.get("clips")
    if isinstance(clips, dict) and clips:
        return len(clips)
    films = manifest.get("films")
    if isinstance(films, dict) and films:
        total = sum(int(v.get("image_count") or 0) for v in films.values() if isinstance(v, dict))
        if total > 0:
            return total
    return None


def _count_images(root: Path, *, manifest: dict[str, Any], db_stats: dict[str, Any]) -> int:
    from_manifest = _count_from_manifest(manifest)
    if from_manifest is not None:
        return from_manifest
    downloaded = (db_stats.get("shots") or {}).get("downloaded")
    if isinstance(downloaded, int) and downloaded > 0:
        return downloaded
    if not root.exists():
        return 0

    # Large manifests (EyeCandy): count one level deep instead of full rglob
    if manifest.get("_large"):
        n = 0
        for child in root.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            for p in child.iterdir():
                if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
                    n += 1
        return n

    n = 0
    for p in root.rglob("*"):
        if n >= 8000:
            break
        if not p.is_file():
            continue
        if any(part.startswith(".") for part in p.parts):
            continue
        if p.suffix.lower() in IMAGE_EXTS:
            n += 1
    return n


def _mirror_run_state(root: Path) -> dict[str, Any]:
    path = root / ".cache" / "mirror_run.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _sample_preview_relpaths(root: Path, *, limit: int = 6) -> list[str]:
    """Pick a few image paths under a mirror folder for hub card collages."""
    if not root.is_dir():
        return []
    found: list[str] = []
    try:
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip cache / hidden
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                if Path(name).suffix.lower() not in IMAGE_EXTS:
                    continue
                full = Path(dirpath) / name
                try:
                    rel = full.relative_to(root).as_posix()
                except ValueError:
                    continue
                found.append(rel)
                if len(found) >= limit * 8:
                    break
            if len(found) >= limit * 8:
                break
    except OSError:
        return []
    if not found:
        return []
    # Spread samples across the list so we don't only get one film folder
    step = max(1, len(found) // limit)
    return [found[i] for i in range(0, len(found), step)][:limit]


def scan_source(settings: Settings, key: str) -> dict[str, Any]:
    spec = SOURCES.get(key)
    if not spec:
        raise ValueError(f"Unknown source: {key}")
    root = library_root(settings) / spec.folder
    manifest = _read_manifest(root)
    db_stats = _shotdeck_db_stats(root) if key == "shotdeck" else {}
    samples = _sample_preview_relpaths(root, limit=6)
    return {
        "key": spec.key,
        "label": spec.label,
        "path": str(root),
        "ingest_path": spec.ingest_path,
        "exists": root.exists(),
        "image_count": _count_images(root, manifest=manifest, db_stats=db_stats),
        "manifest_updated_at": manifest.get("updated_at"),
        "mirror_available": spec.mirror_script is not None,
        "mirror_run": _mirror_run_state(root),
        "archive_slug": spec.archive_slug,
        "archive_name": spec.archive_name,
        "description": spec.description,
        "site_url": spec.site_url,
        "access": spec.access,
        "requires_pro": spec.access == "gated",
        "credentials_configured": creds_configured(library_root(settings), key),
        "preview_urls": [f"/sources/{key}/preview/{i}" for i in range(len(samples))],
        "preview_count": len(samples),
        **({"db_stats": db_stats} if key == "shotdeck" else {}),
    }


def resolve_preview_file(settings: Settings, key: str, index: int) -> Path | None:
    """Resolve a sampled mirror still for hub card collage."""
    spec = SOURCES.get(key)
    if not spec or index < 0:
        return None
    root = library_root(settings) / spec.folder
    samples = _sample_preview_relpaths(root, limit=max(6, index + 1))
    if index >= len(samples):
        return None
    path = (root / samples[index]).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def scan_all(settings: Settings) -> list[dict[str, Any]]:
    return [scan_source(settings, k) for k in SOURCES]


def resolve_mirror_script(settings: Settings, spec: SourceSpec) -> Path | None:
    if not spec.mirror_script:
        return None
    candidates: list[Path] = []
    if settings.mirror_scripts_dir:
        candidates.append(Path(settings.mirror_scripts_dir) / spec.mirror_script)
    candidates.append(Path(__file__).resolve().parents[5] / "scripts" / spec.mirror_script)
    candidates.append(Path("/app/scripts") / spec.mirror_script)
    for p in candidates:
        if p.is_file():
            return p
    return None


def _resolve_credentials(settings: Settings, source: str) -> tuple[str, str]:
    lib = library_root(settings)
    user, password = get_source_credentials(lib, source)
    if source == "shotdeck" and not user:
        user = settings.shotdeck_user or ""
        password = settings.shotdeck_pass or ""
    return user, password


def start_mirror(
    settings: Settings,
    *,
    source: str,
    limit_films: int | None = None,
    limit_per_tech: int | None = None,
    max_clips: int | None = None,
    limit_tasks: int | None = 3,
    limit_pages: int | None = 2,
    limit_shots: int | None = 30,
    films: str | None = None,
    discover_only: bool = False,
    user: str | None = None,
    password: str | None = None,
    login_browser: bool = False,
) -> dict[str, Any]:
    spec = SOURCES.get(source)
    if not spec or not spec.mirror_script:
        raise ValueError(f"Mirror not supported for source: {source}")

    script = resolve_mirror_script(settings, spec)
    if not script:
        raise ValueError(
            f"Mirror script not found. Mount ./scripts or run: python scripts/{spec.mirror_script}"
        )

    root = library_root(settings) / spec.folder
    root.mkdir(parents=True, exist_ok=True)
    run_state_path = root / ".cache" / "mirror_run.json"
    run_state_path.parent.mkdir(parents=True, exist_ok=True)

    existing = _mirror_run_state(root)
    if existing.get("pid") and existing.get("running"):
        try:
            os.kill(int(existing["pid"]), 0)
            return {"message": "Mirror already running", **existing}
        except OSError:
            pass

    cmd = [sys.executable, str(script), "--out", str(root)]
    env = os.environ.copy()

    auth_user = (user or "").strip()
    auth_pass = (password or "").strip()
    if not auth_user:
        auth_user, auth_pass = _resolve_credentials(settings, source)

    if login_browser:
        if source not in {"shotdeck", "stillslab"}:
            raise ValueError(f"Browser login is not supported for {spec.label}")
        # Headful Playwright window — user completes Cloudflare / SSO there.
        cmd.append("--login-browser")
        if auth_user:
            cmd.extend(["--user", auth_user])
        if auth_pass:
            cmd.extend(["--password", auth_pass])
        env[f"{source.upper()}_USER"] = auth_user
        env[f"{source.upper()}_PASS"] = auth_pass
        if source == "shotdeck":
            env["SHOTDECK_USER"] = auth_user
            env["SHOTDECK_PASS"] = auth_pass
        log_path = root / ".cache" / "mirror_login.log"
        log_f = open(log_path, "a", encoding="utf-8")
        proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT, env=env)
        state = {
            "pid": proc.pid,
            "running": True,
            "started_at": time.time(),
            "source": source,
            "log_path": str(log_path),
            "mode": "login_browser",
        }
        run_state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        return {
            "message": (
                f"{spec.label}: browser login window opened. "
                "Complete Cloudflare/sign-in there, then run Mirror again."
            ),
            **state,
        }

    if spec.access == "gated":
        if not auth_user or not auth_pass:
            raise ValueError(
                f"Set {spec.label} credentials on the Archives page or in "
                f"library/.cache/source_credentials.json — or use Browser login "
                f"when Cloudflare blocks password login."
            )
        cmd.extend(["--user", auth_user, "--password", auth_pass])
        env[f"{source.upper()}_USER"] = auth_user
        env[f"{source.upper()}_PASS"] = auth_pass
        if source == "shotdeck":
            env["SHOTDECK_USER"] = auth_user
            env["SHOTDECK_PASS"] = auth_pass
    elif auth_user and auth_pass:
        cmd.extend(["--user", auth_user, "--password", auth_pass])
        env[f"{source.upper()}_USER"] = auth_user
        env[f"{source.upper()}_PASS"] = auth_pass

    films_arg = (films or "").strip()
    if source == "shotdeck":
        if limit_tasks is not None:
            cmd.extend(["--limit-tasks", str(limit_tasks)])
        if limit_pages is not None:
            cmd.extend(["--limit-pages", str(limit_pages)])
        if limit_shots is not None:
            cmd.extend(["--limit-shots", str(limit_shots)])
        if discover_only:
            cmd.append("--discover-only")
    elif source == "filmgrab":
        if films_arg:
            cmd.extend(["--films", films_arg])
        if limit_films is not None:
            cmd.extend(["--limit-films", str(limit_films)])
        if limit_shots is not None:
            cmd.extend(["--limit-images", str(limit_shots)])
    elif source == "eyecandy":
        if limit_per_tech is not None:
            cmd.extend(["--limit-per-tech", str(limit_per_tech)])
        if max_clips is not None:
            cmd.extend(["--max-clips", str(max_clips)])
    elif source == "moviestillsdb" and limit_films is not None:
        cmd.extend(["--limit-movies", str(limit_films)])
    elif source == "stillslab":
        if limit_shots is not None:
            cmd.extend(["--limit-stills", str(limit_shots)])
        if limit_films is not None:
            cmd.extend(["--limit-titles", str(limit_films)])

    log_path = root / ".cache" / "mirror.log"
    log_f = open(log_path, "a", encoding="utf-8")
    proc = subprocess.Popen(cmd, stdout=log_f, stderr=subprocess.STDOUT, env=env)
    state = {
        "pid": proc.pid,
        "running": True,
        "started_at": time.time(),
        "source": source,
        "log_path": str(log_path),
    }
    run_state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
    return {"message": f"{spec.label} mirror started", **state}


def refresh_mirror_run_state(settings: Settings, source: str) -> dict[str, Any]:
    spec = SOURCES.get(source)
    if not spec:
        return {}
    root = library_root(settings) / spec.folder
    state = _mirror_run_state(root)
    pid = state.get("pid")
    if pid and state.get("running"):
        try:
            os.kill(int(pid), 0)
        except OSError:
            state["running"] = False
            state["finished_at"] = time.time()
            (root / ".cache" / "mirror_run.json").write_text(
                json.dumps(state, indent=2), encoding="utf-8"
            )
    return state
