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

# Catalog ideas (no scraper yet) — shown on Archives hub for discovery.
# Prefer free / research-oriented still libraries. Always check each site's terms.
CATALOG_SUGGESTIONS: list[dict[str, str]] = [
    {
        "key": "screenmusings",
        "label": "ScreenMusings",
        "site_url": "https://screenmusings.org/",
        "blurb": "High-quality frame grabs by film — closest free cousin to FilmGrab.",
        "fit": "Best next scraper candidate for title coverage.",
    },
    {
        "key": "moviestillsdb",
        "label": "MovieStillsDB",
        "site_url": "https://www.moviestillsdb.com/",
        "blurb": "1M+ community stills — also a built-in mirror (optional donator login for full-res).",
        "fit": "Prefer Mirrors tab for pulls; or selective saves into a custom archive.",
    },
    {
        "key": "shotcafe",
        "label": "SHOT.CAFE",
        "site_url": "https://shot.cafe/",
        "blurb": "Curated cinematography stills with color and composition tags.",
        "fit": "Smaller craft-focused set; check ToS before automating.",
    },
    {
        "key": "film-grab-alt",
        "label": "Film Grab (film-grab.com)",
        "site_url": "https://film-grab.com/",
        "blurb": "Already mirrored in-app as FilmGrab — listed here as the reference site.",
        "fit": "Built-in scraper on Mirrors.",
    },
    {
        "key": "bluscreens",
        "label": "Blu-ray Screen Caps / Caps-a-holic style blogs",
        "site_url": "https://caps-a-holic.com/",
        "blurb": "Fan screen-capture galleries (often Blu-ray sourced) organized by title.",
        "fit": "Manual / selective; many sites are fragile or ToS-sensitive.",
    },
    {
        "key": "evanerichards",
        "label": "Evan Richards (cinematography stills)",
        "site_url": "https://www.evanerichards.com/",
        "blurb": "Long-running cinematography stills blog — frames by film and DP.",
        "fit": "Great reference; scrape carefully / prefer manual saves.",
    },
    {
        "key": "thefilmstage-stills",
        "label": "The Film Stage / press still roundups",
        "site_url": "https://thefilmstage.com/",
        "blurb": "Occasional high-res stills and frame posts — not a structured archive.",
        "fit": "Browse + save into a custom archive; not bulk-friendly.",
    },
    {
        "key": "imdb-stills",
        "label": "IMDb media / stills",
        "site_url": "https://www.imdb.com/",
        "blurb": "Official and press stills attached to titles — useful for cast/set references.",
        "fit": "API/ToS restricted; treat as manual reference, not a mirror target.",
    },
    {
        "key": "wikimedia-film",
        "label": "Wikimedia Commons (film)",
        "site_url": "https://commons.wikimedia.org/wiki/Category:Films",
        "blurb": "Public-domain and freely licensed film imagery, posters, production photos.",
        "fit": "Truly free for many items — good for PD-era titles; license varies per file.",
    },
    {
        "key": "internet-archive-film",
        "label": "Internet Archive (movies / stills)",
        "site_url": "https://archive.org/details/movies",
        "blurb": "Public-domain features and related media you can download legally.",
        "fit": "Best for PD films; pair with your own frame extracts.",
    },
    {
        "key": "stillslab",
        "label": "StillsLab",
        "site_url": "https://stillslab.com/",
        "blurb": "Modern stills + music-video frames — also a gated mirror (email + password).",
        "fit": "Use Mirrors tab with subscription credentials.",
    },
    {
        "key": "frameset",
        "label": "Frame Set / similar lookbooks",
        "site_url": "https://frameset.app/",
        "blurb": "Curated frames across film, ads, and music video — often paid tiers.",
        "fit": "Inspiration only unless you have a license; use custom archive for exports you own.",
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


def scan_source(settings: Settings, key: str) -> dict[str, Any]:
    spec = SOURCES.get(key)
    if not spec:
        raise ValueError(f"Unknown source: {key}")
    root = library_root(settings) / spec.folder
    manifest = _read_manifest(root)
    db_stats = _shotdeck_db_stats(root) if key == "shotdeck" else {}
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
        "credentials_configured": creds_configured(library_root(settings), key),
        **({"db_stats": db_stats} if key == "shotdeck" else {}),
    }


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
    discover_only: bool = False,
    user: str | None = None,
    password: str | None = None,
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

    if spec.access == "gated":
        if not auth_user or not auth_pass:
            raise ValueError(
                f"Set {spec.label} credentials on the Archives page or in "
                f"library/.cache/source_credentials.json"
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

    if source == "shotdeck":
        if limit_tasks is not None:
            cmd.extend(["--limit-tasks", str(limit_tasks)])
        if limit_pages is not None:
            cmd.extend(["--limit-pages", str(limit_pages)])
        if limit_shots is not None:
            cmd.extend(["--limit-shots", str(limit_shots)])
        if discover_only:
            cmd.append("--discover-only")
    elif source == "filmgrab" and limit_films is not None:
        cmd.extend(["--limit-films", str(limit_films)])
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
