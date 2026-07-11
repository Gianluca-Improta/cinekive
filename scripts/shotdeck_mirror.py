#!/usr/bin/env python3
"""Resumable ShotDeck mirror — personal/local use only."""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

ROOT = Path(__file__).resolve().parents[1]
TAXONOMY_PATH = Path(__file__).with_name("shotdeck_taxonomy.json")
BASE = "https://shotdeck.com"
DEFAULT_OUT = Path("D:/library/_shotdeck") if Path("D:/").exists() else ROOT / "data" / "library" / "_shotdeck"
BROWSE_REFERER = f"{BASE}/browse/stills"
PAGE_SIZE = 30

SHOTID_RE = re.compile(r"data-shotid=['\"]([^'\"]+)['\"]")
GALLERY_RE = re.compile(
    r"data-shotid=['\"](?P<shot_id>[^'\"]+)['\"](?P<body>.*?)(?=data-shotid=['\"]|$)",
    re.S,
)
FILENAME_RE = re.compile(r"data-filename=['\"]([^'\"]+)['\"]")
SIZE_RE = re.compile(r"data-size=['\"]([^'\"]+)['\"]")
TITLE_RE = re.compile(r"class=['\"]gallerytitle[^'\"]*['\"][^>]*>\s*<a[^>]*>([^<]+)</a>", re.I)
THUMB_RE = re.compile(r"<img[^>]+class=['\"][^'\"]*still[^'\"]*['\"][^>]+src=['\"]([^'\"]+)['\"]", re.I)
CLIP_RE = re.compile(r"class=['\"]yesclip['\"]")
LOGIN_ERR_RE = re.compile(r"Whoops!.*?credentials", re.I | re.S)
SAFE_DIR_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


@dataclass
class ShotRef:
    shot_id: str
    movie_title: str = ""
    thumb_url: str = ""
    filename: str = ""
    dimensions: str = ""
    has_clip: bool = False
    image_url: str = ""
    clip_url: str = ""
    source_path: str = ""


@dataclass
class MirrorStats:
    tasks_done: int = 0
    shots_discovered: int = 0
    shots_seen: int = 0
    shots_downloaded: int = 0
    shots_skipped: int = 0
    cf_blocks: int = 0
    errors: list[str] = field(default_factory=list)

    def merge(self, other: "MirrorStats") -> None:
        self.tasks_done += other.tasks_done
        self.shots_discovered += other.shots_discovered
        self.shots_seen += other.shots_seen
        self.shots_downloaded += other.shots_downloaded
        self.shots_skipped += other.shots_skipped
        self.cf_blocks += other.cf_blocks
        self.errors.extend(other.errors)


def is_cloudflare(html: str) -> bool:
    low = html.lower()
    return "just a moment" in low or "cf-browser-verification" in low or "challenge-platform" in low


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    try:
        print(f"[{ts}] {msg}", flush=True)
    except UnicodeEncodeError:
        print(f"[{ts}] {msg}".encode("ascii", errors="replace").decode("ascii"), flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def jitter(base: float, spread: float = 0.4) -> float:
    return max(0.05, base * random.uniform(1.0 - spread, 1.0 + spread))


def safe_dirname(title: str, shot_id: str) -> str:
    t = SAFE_DIR_RE.sub("", (title or "").strip())
    t = re.sub(r"\s+", " ", t).strip(" .")
    return (t or f"shot-{shot_id}")[:120]


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default if default is not None else {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default if default is not None else {}


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def slugify_segment(value: str) -> str:
    v = value.strip().replace(" ", "_")
    return re.sub(r"[^\w.\-+]", "", v, flags=re.UNICODE) or "x"


class StateDB:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL DEFAULT 'pending',
                offset_next INTEGER NOT NULL DEFAULT 0,
                empty_streak INTEGER NOT NULL DEFAULT 0,
                shots_found INTEGER NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                updated_at TEXT
            );
            CREATE TABLE IF NOT EXISTS shots (
                shot_id TEXT PRIMARY KEY,
                movie_title TEXT,
                image_url TEXT,
                clip_url TEXT,
                meta_json TEXT,
                file_path TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                source_path TEXT,
                discovered_at TEXT,
                downloaded_at TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                last_error TEXT
            );
            """
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    def upsert_tasks(self, paths: list[str]) -> int:
        n = 0
        for p in paths:
            cur = self.conn.execute(
                "INSERT OR IGNORE INTO tasks(path, updated_at) VALUES(?,?)", (p, utc_now())
            )
            n += cur.rowcount
        self.conn.commit()
        return n

    def next_task(self) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY attempts ASC, id ASC LIMIT 1"
        ).fetchone()

    def update_task(self, task_id: int, **fields: Any) -> None:
        row = self.conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
        if not row:
            return
        data = dict(row)
        data.update(fields)
        if fields.get("bump_attempts"):
            data["attempts"] = row["attempts"] + 1
        data["updated_at"] = utc_now()
        self.conn.execute(
            """UPDATE tasks SET status=:status, offset_next=:offset_next, empty_streak=:empty_streak,
            shots_found=:shots_found, last_error=:last_error, attempts=:attempts, updated_at=:updated_at WHERE id=:id""",
            {**data, "id": task_id},
        )
        self.conn.commit()

    def upsert_shot(self, shot: ShotRef) -> bool:
        if self.conn.execute("SELECT 1 FROM shots WHERE shot_id=?", (shot.shot_id,)).fetchone():
            return False
        meta = asdict(shot)
        self.conn.execute(
            """INSERT INTO shots(shot_id,movie_title,image_url,clip_url,meta_json,status,source_path,discovered_at)
            VALUES (?,?,?,?,?,?,?,?)""",
            (shot.shot_id, shot.movie_title, shot.image_url, shot.clip_url, json.dumps(meta),
             "pending", shot.source_path, utc_now()),
        )
        self.conn.commit()
        return True

    def pending_shots(self, limit: int) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM shots WHERE status='pending' AND attempts<8 ORDER BY discovered_at LIMIT ?",
            (limit,),
        ).fetchall()

    def mark_shot(self, shot_id: str, *, status: str, file_path: str = "", error: str = "") -> None:
        self.conn.execute(
            "UPDATE shots SET status=?, file_path=?, downloaded_at=?, last_error=?, attempts=attempts+1 WHERE shot_id=?",
            (status, file_path, utc_now() if status == "downloaded" else None, error[:500], shot_id),
        )
        self.conn.commit()

    def counts(self) -> dict[str, Any]:
        return {
            "tasks": dict(self.conn.execute("SELECT status,COUNT(*) FROM tasks GROUP BY status").fetchall()),
            "shots": dict(self.conn.execute("SELECT status,COUNT(*) FROM shots GROUP BY status").fetchall()),
        }

    def pending_shot_count(self) -> int:
        row = self.conn.execute("SELECT COUNT(*) FROM shots WHERE status='pending' AND attempts<8").fetchone()
        return int(row[0]) if row else 0

    def reset_pending_tasks(self) -> None:
        self.conn.execute("DELETE FROM tasks WHERE status IN ('pending', 'in_progress')")
        self.conn.commit()


class ShotDeckClient:
    def __init__(self, out_dir: Path) -> None:
        if cffi_requests is None:
            raise RuntimeError("pip install curl_cffi")
        self.out_dir = out_dir
        self.cache = out_dir / ".cache"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.session_path = self.cache / "session.json"
        self.session = cffi_requests.Session(impersonate="chrome")

    def save_session(self) -> None:
        write_json(self.session_path, dict(self.session.cookies))

    def load_session(self) -> bool:
        data = load_json(self.session_path, {})
        if not isinstance(data, dict) or not data:
            return False
        for k, v in data.items():
            self.session.cookies.set(k, str(v))
        return True

    def login(self, user: str, password: str) -> bool:
        self.session.get(f"{BASE}/welcome/login", timeout=30)
        r = self.session.post(
            f"{BASE}/welcome/login",
            data={"go": "1", "user": user, "pass": password, "stay": "1"},
            headers={"Referer": f"{BASE}/welcome/login", "Origin": BASE},
            timeout=45,
        )
        if LOGIN_ERR_RE.search(r.text):
            return False
        self.session.get(BROWSE_REFERER, timeout=30)
        probe = self.search_ajax("text/night/limit/5/offset/0")
        if "not logged in" in probe.lower():
            return False
        self.save_session()
        return True

    def login_browser(self, user: str = "", password: str = "", timeout_sec: int = 300) -> bool:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page()
            page.goto(f"{BASE}/welcome/login", wait_until="domcontentloaded", timeout=60000)
            if user and password:
                page.fill('input[name="user"]', user)
                page.fill('input[name="pass"]', password)
                if page.locator("#stayLoggedIn").count():
                    page.check("#stayLoggedIn")
                page.click('button[type="submit"]')
            else:
                log(f"Log in manually ({timeout_sec}s)…")
            deadline = time.time() + timeout_sec
            while time.time() < deadline:
                if "log out" in page.content().lower() or "logout" in page.content().lower():
                    break
                page.wait_for_timeout(1000)
            for c in page.context.cookies():
                self.session.cookies.set(c["name"], c["value"])
            browser.close()
        self.save_session()
        return "not logged in" not in self.search_ajax("int_ext/Exterior/limit/5/offset/0").lower()

    def search_ajax(self, path_suffix: str) -> str:
        url = f"{BASE}/browse/searchstillsajax/{path_suffix.lstrip('/')}"
        r = self.session.get(url, headers={"Referer": BROWSE_REFERER, "X-Requested-With": "XMLHttpRequest"}, timeout=60)
        return r.text

    def fetch_bytes(self, url: str) -> bytes:
        if url.startswith("/"):
            url = urljoin(BASE, url)
        return self.session.get(url, headers={"Referer": BROWSE_REFERER}, timeout=120).content


def parse_results(html: str, source_path: str) -> list[ShotRef]:
    if "not logged in" in html.lower():
        raise RuntimeError("session expired")
    shots: list[ShotRef] = []
    for m in GALLERY_RE.finditer(html):
        body, shot_id = m.group("body"), m.group("shot_id").strip()
        title_m = TITLE_RE.search(body)
        fn_m = FILENAME_RE.search(body)
        ext = Path(fn_m.group(1)).suffix if fn_m else ".jpg"
        clip_url = f"{BASE}/assets/images/clips/{shot_id}_clip.mp4" if CLIP_RE.search(body) else ""
        size_m = SIZE_RE.search(body)
        shots.append(ShotRef(
            shot_id=shot_id,
            movie_title=unescape(title_m.group(1).strip()) if title_m else "",
            filename=fn_m.group(1) if fn_m else f"{shot_id}.jpg",
            dimensions=size_m.group(1) if size_m else "",
            has_clip=bool(clip_url),
            image_url=f"{BASE}/assets/images/stills/{shot_id}{ext}",
            clip_url=clip_url,
            source_path=source_path,
        ))
    if not shots:
        for shot_id in SHOTID_RE.findall(html):
            shots.append(ShotRef(shot_id=shot_id, image_url=f"{BASE}/assets/images/stills/{shot_id}.jpg", source_path=source_path))
    return shots


def taxonomy_output_subdirs(taxonomy: dict[str, Any]) -> list[str]:
    scopes = taxonomy.get("media_scopes") or []
    if scopes:
        seen: set[str] = set()
        out: list[str] = []
        for scope in scopes:
            sub = str(scope.get("output_subdir") or "by_title")
            if sub not in seen:
                seen.add(sub)
                out.append(sub)
        return out
    if taxonomy.get("output_subdir"):
        return [str(taxonomy["output_subdir"])]
    if taxonomy.get("commercial_only"):
        return ["by_commercial"]
    return ["by_movie"]


def taxonomy_output_subdir(taxonomy: dict[str, Any]) -> str:
    return taxonomy_output_subdirs(taxonomy)[0]


def _media_type_slug(media_type: str) -> str:
    return slugify_segment(media_type)


def scope_for_source_path(source_path: str, taxonomy: dict[str, Any]) -> dict[str, Any] | None:
    path = (source_path or "").strip("/")
    for scope in taxonomy.get("media_scopes") or []:
        mt = _media_type_slug(str(scope.get("media_type", "")))
        prefix = f"media_type/{mt}"
        if path == prefix or path.startswith(f"{prefix}/"):
            return scope
    return None


def output_subdir_for_source_path(source_path: str, taxonomy: dict[str, Any]) -> str:
    scope = scope_for_source_path(source_path, taxonomy)
    if scope:
        return str(scope.get("output_subdir") or "by_title")
    return taxonomy_output_subdir(taxonomy)


def content_type_for_source_path(source_path: str, taxonomy: dict[str, Any]) -> str:
    scope = scope_for_source_path(source_path, taxonomy)
    if scope:
        return str(scope.get("content_type") or scope.get("media_type", "unknown")).lower()
    if taxonomy.get("commercial_only"):
        return "commercial"
    return "feature"


def normalize_title_key(title: str) -> str:
    t = SAFE_DIR_RE.sub("", (title or "").lower())
    t = re.sub(r"[^\w\s]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    if t.startswith("the "):
        t = t[4:]
    return t


def load_filmgrab_titles() -> set[str]:
    roots = [
        ROOT / "data" / "library" / "_filmgrab",
        Path("D:/library/_filmgrab"),
    ]
    titles: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        manifest = load_json(root / "manifest.json", {})
        films = manifest.get("films") if isinstance(manifest, dict) else {}
        if isinstance(films, dict):
            for entry in films.values():
                if not isinstance(entry, dict):
                    continue
                for key in ("title", "folder"):
                    val = entry.get(key)
                    if isinstance(val, str) and val.strip():
                        titles.add(normalize_title_key(val))
        try:
            for child in root.iterdir():
                if not child.is_dir() or child.name.startswith(".") or child.name == ".cache":
                    continue
                titles.add(normalize_title_key(child.name))
        except OSError:
            pass
    return {t for t in titles if t}


def should_skip_filmgrab_title(
    title: str,
    source_path: str,
    taxonomy: dict[str, Any],
    *,
    filmgrab_titles: set[str] | None = None,
) -> bool:
    if not taxonomy.get("filmgrab_skip", True):
        return False
    scope = scope_for_source_path(source_path, taxonomy)
    if not scope or not scope.get("skip_if_in_filmgrab"):
        return False
    key = normalize_title_key(title)
    if not key:
        return False
    titles = filmgrab_titles if filmgrab_titles is not None else load_filmgrab_titles()
    return key in titles


def _join_path(prefix: str, *segments: str) -> str:
    parts = [p.strip("/") for p in (prefix, *segments) if p and p.strip("/")]
    return "/".join(parts)


def _paths_for_scope(scope: dict[str, Any], taxonomy: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    prefix = _join_path("media_type", _media_type_slug(str(scope.get("media_type", ""))))

    if scope.get("include_facets", True):
        facets = taxonomy.get("facets") or {}
        for facet_key, values in facets.items():
            if facet_key == "media_type":
                continue
            for val in values or []:
                paths.append(_join_path(prefix, facet_key, slugify_segment(str(val))))

    pair_seeds = scope.get("pair_seeds") or taxonomy.get("pair_seeds") or []
    if scope.get("include_pair_seeds", True):
        for seed in pair_seeds:
            if not isinstance(seed, (list, tuple)) or len(seed) < 4 or len(seed) % 2:
                continue
            segments: list[str] = []
            for i in range(0, len(seed), 2):
                segments.extend([str(seed[i]), slugify_segment(str(seed[i + 1]))])
            paths.append(_join_path(prefix, *segments))

    for q in scope.get("text_seeds") or []:
        seg = slugify_segment(str(q))
        if not seg:
            continue
        paths.append(_join_path(prefix, "text", seg))
        paths.append(_join_path(prefix, "search", seg))

    if scope.get("include_broad", True):
        paths.append(prefix)

    return paths


def build_task_paths(taxonomy: dict[str, Any]) -> list[str]:
    scopes = taxonomy.get("media_scopes") or []
    if scopes:
        paths: list[str] = []
        for scope in scopes:
            paths.extend(_paths_for_scope(scope, taxonomy))
        seen: set[str] = set()
        return [p for p in paths if not (p in seen or seen.add(p))]

    paths: list[str] = []
    prefix = str(taxonomy.get("path_prefix") or "").strip("/")
    if taxonomy.get("commercial_only") and not prefix:
        prefix = "media_type/Commercial"

    facets = taxonomy.get("facets") or {}
    for facet_key, values in facets.items():
        if facet_key == "media_type":
            continue
        for val in values or []:
            paths.append(_join_path(prefix, facet_key, slugify_segment(str(val))))

    for seed in taxonomy.get("pair_seeds") or []:
        if not isinstance(seed, (list, tuple)) or len(seed) < 4 or len(seed) % 2:
            continue
        segments: list[str] = []
        for i in range(0, len(seed), 2):
            segments.extend([str(seed[i]), slugify_segment(str(seed[i + 1]))])
        paths.append(_join_path(prefix, *segments))

    text_seeds = taxonomy.get("text_seeds") or taxonomy.get("search_seeds") or []
    for q in text_seeds:
        seg = slugify_segment(str(q))
        if not seg:
            continue
        paths.append(_join_path(prefix, "text", seg))
        paths.append(_join_path(prefix, "search", seg))

    if prefix:
        paths.append(prefix)

    if not taxonomy.get("commercial_only"):
        for g in taxonomy.get("genre_seeds") or []:
            paths.append(_join_path(prefix, "genre", slugify_segment(str(g))))
        yr0, yr1 = taxonomy.get("year_range") or [1920, 2026]
        for year in range(int(yr0), int(yr1) + 1):
            paths.append(_join_path(prefix, "year", str(year)))

    seen: set[str] = set()
    return [p for p in paths if not (p in seen or seen.add(p))]


def ensure_login(client: ShotDeckClient, user: str, password: str, *, force: bool = False) -> bool:
    if not force and client.load_session():
        try:
            probe = client.search_ajax("text/night/limit/5/offset/0")
            if "not logged in" not in probe.lower() and not is_cloudflare(probe):
                log("Restored session.")
                return True
        except Exception:
            pass
    log(f"Logging in as {user}…")
    return client.login(user, password)


def refresh_login(out_dir: Path, user: str, password: str) -> bool:
    client = ShotDeckClient(out_dir)
    try:
        client.session_path.unlink(missing_ok=True)
    except Exception:
        pass
    return ensure_login(client, user, password, force=True)


def mirror(out_dir: Path, *, user: str, password: str, delay: float = 1.8,
           discover_only: bool = False, download_only: bool = False,
           max_tasks: int | None = None, max_pages: int | None = None,
           max_shots: int | None = None, download_batch: int = 50) -> MirrorStats:
    out_dir.mkdir(parents=True, exist_ok=True)
    taxonomy = load_json(TAXONOMY_PATH, {})
    db = StateDB(out_dir / ".cache" / "state.db")
    stats = MirrorStats()
    client = ShotDeckClient(out_dir)
    if not ensure_login(client, user, password):
        db.close()
        raise SystemExit("Login failed — try --login-browser")
    try:
        if not download_only:
            db.upsert_tasks(build_task_paths(taxonomy))
            tasks_done = 0
            while True:
                if max_tasks is not None and tasks_done >= max_tasks:
                    break
                task = db.next_task()
                if not task:
                    break
                suffix = f"{task['path']}/limit/{PAGE_SIZE}/offset/{task['offset_next']}"
                log(f"Discover {suffix}")
                try:
                    time.sleep(jitter(delay))
                    html = client.search_ajax(suffix)
                    if is_cloudflare(html):
                        stats.cf_blocks += 1
                        stats.errors.append("cloudflare_challenge")
                        db.update_task(task["id"], status="pending", last_error="cloudflare", bump_attempts=True)
                        break
                    shots = parse_results(html, task["path"])
                except Exception as exc:
                    stats.errors.append(str(exc))
                    db.update_task(task["id"], status="pending", last_error=str(exc), bump_attempts=True)
                    continue
                new = sum(db.upsert_shot(s) for s in shots)
                stats.shots_discovered += new
                stats.shots_seen += len({s.shot_id for s in shots})
                if not shots:
                    streak = task["empty_streak"] + 1
                    if streak >= 2:
                        db.update_task(task["id"], status="done", empty_streak=streak, shots_found=task["shots_found"] + new)
                        tasks_done += 1
                    else:
                        db.update_task(task["id"], status="pending", empty_streak=streak, shots_found=task["shots_found"] + new)
                    continue
                nxt = task["offset_next"] + PAGE_SIZE
                if max_pages and (nxt // PAGE_SIZE) >= max_pages:
                    db.update_task(task["id"], status="done", offset_next=nxt, empty_streak=0, shots_found=task["shots_found"] + new)
                    tasks_done += 1
                else:
                    db.update_task(task["id"], status="pending", offset_next=nxt, empty_streak=0, shots_found=task["shots_found"] + new)
                log(f"  +{new} new")
        if not discover_only:
            downloaded = 0
            filmgrab_titles = load_filmgrab_titles() if taxonomy.get("filmgrab_skip", True) else set()
            if filmgrab_titles:
                log(f"FilmGrab skip list: {len(filmgrab_titles)} titles")
            for row in db.pending_shots(download_batch):
                if max_shots and downloaded >= max_shots:
                    break
                shot_id = row["shot_id"]
                meta = json.loads(row["meta_json"] or "{}")
                title = row["movie_title"] or meta.get("movie_title") or shot_id
                source_path = row["source_path"] or meta.get("source_path") or ""
                if should_skip_filmgrab_title(
                    title, source_path, taxonomy, filmgrab_titles=filmgrab_titles
                ):
                    db.mark_shot(shot_id, status="skipped_filmgrab", error="title in filmgrab")
                    stats.shots_skipped += 1
                    continue
                content_dir = output_subdir_for_source_path(source_path, taxonomy)
                content_type = content_type_for_source_path(source_path, taxonomy)
                folder = out_dir / content_dir / safe_dirname(title, shot_id)
                folder.mkdir(parents=True, exist_ok=True)
                dest = folder / f"{shot_id}.jpg"
                if dest.exists() and dest.stat().st_size > 5000:
                    db.mark_shot(shot_id, status="downloaded", file_path=str(dest))
                    stats.shots_skipped += 1
                    continue
                try:
                    time.sleep(jitter(delay))
                    dest.write_bytes(client.fetch_bytes(row["image_url"] or meta.get("image_url", "")))
                    sidecar = {
                        "source": "shotdeck",
                        "shot_id": shot_id,
                        "movie_title": title,
                        "content_type": content_type,
                        "source_path": source_path,
                    }
                    if content_type == "commercial":
                        sidecar["commercial_title"] = title
                    elif content_type == "music_video":
                        sidecar["music_video_title"] = title
                    else:
                        sidecar["film_title"] = title
                    write_json(folder / f"{shot_id}.json", sidecar)
                    db.mark_shot(shot_id, status="downloaded", file_path=str(dest))
                    stats.shots_downloaded += 1
                    downloaded += 1
                except Exception as exc:
                    db.mark_shot(shot_id, status="pending", error=str(exc))
                    stats.errors.append(f"{shot_id}: {exc}")
    finally:
        write_json(out_dir / "manifest.json", {"updated_at": utc_now(), "counts": db.counts(), "stats": asdict(stats)})
        db.close()
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--user", default=os.environ.get("SHOTDECK_USER", ""))
    p.add_argument("--password", default=os.environ.get("SHOTDECK_PASS", ""))
    p.add_argument("--delay", type=float, default=1.8)
    p.add_argument("--discover-only", action="store_true")
    p.add_argument("--download-only", action="store_true")
    p.add_argument("--limit-tasks", type=int, default=None)
    p.add_argument("--limit-pages", type=int, default=None)
    p.add_argument("--limit-shots", type=int, default=None)
    p.add_argument("--test-login", action="store_true")
    p.add_argument("--login-browser", action="store_true")
    p.add_argument("--seed-tasks", action="store_true")
    p.add_argument(
        "--reset-tasks",
        action="store_true",
        help="Drop pending/in-progress tasks and reseed from taxonomy (keeps done tasks + shots)",
    )
    args = p.parse_args(argv)
    taxonomy = load_json(TAXONOMY_PATH, {})
    if args.seed_tasks or args.reset_tasks:
        db = StateDB(args.out / ".cache" / "state.db")
        if args.reset_tasks:
            db.reset_pending_tasks()
            log("Cleared pending/in-progress tasks")
        n = db.upsert_tasks(build_task_paths(taxonomy))
        log(f"Seeded {n} new tasks ({len(build_task_paths(taxonomy))} paths, scopes={[s.get('media_type') for s in taxonomy.get('media_scopes', [])]})")
        db.close()
        return 0
    client = ShotDeckClient(args.out)
    if args.login_browser:
        ok = client.login_browser(args.user, args.password)
    elif args.test_login:
        ok = ensure_login(client, args.user, args.password)
        if ok:
            probe_path = "media_type/Commercial/limit/5/offset/0"
            n = len(SHOTID_RE.findall(client.search_ajax(probe_path)))
            log(f"Login OK — commercial probe returned {n} shots")
        else:
            log("Login FAILED")
        return 0 if ok else 1
    else:
        if not args.user:
            try:
                from mirror_credentials import load_credentials

                u, pw = load_credentials("shotdeck", out_dir=args.out)
                args.user, args.password = u, pw or args.password
            except ImportError:
                pass
        if not args.user or not args.password:
            raise SystemExit("Set --user/--password, save on Archives page, or SHOTDECK_USER/SHOTDECK_PASS")
        stats = mirror(args.out, user=args.user, password=args.password, delay=args.delay,
                       discover_only=args.discover_only, download_only=args.download_only,
                       max_tasks=args.limit_tasks, max_pages=args.limit_pages, max_shots=args.limit_shots)
        log(f"Done discovered={stats.shots_discovered} downloaded={stats.shots_downloaded} errors={len(stats.errors)}")
        return 0
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
