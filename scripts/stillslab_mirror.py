#!/usr/bin/env python3
"""Mirror StillsLab stills — subscription login required.

Layout:
  data/library/_stillslab/
    .cache/session.json
    .cache/mirror_state.json
    by_title/{Title}/{still_id}.jpg
    manifest.json

Usage:
  python scripts/stillslab_mirror.py --login-browser
  python scripts/stillslab_mirror.py --user you@mail.com --password secret
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from curl_cffi import requests as cffi_requests
except ImportError:
    cffi_requests = None

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = (
    Path("D:/library/_stillslab")
    if Path("D:/").exists()
    else ROOT / "data" / "library" / "_stillslab"
)
BASE = "https://stillslab.com"
SAFE_DIR_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


@dataclass
class MirrorStats:
    titles: int = 0
    stills_downloaded: int = 0
    stills_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def log(msg: str) -> None:
    print(msg, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def safe_dirname(title: str, fallback: str) -> str:
    t = SAFE_DIR_RE.sub("", (title or "").strip())
    t = re.sub(r"\s+", " ", t).strip(" .")
    return (t or fallback)[:120]


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


class StillsLabClient:
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
        for endpoint, payload in [
            (f"{BASE}/api/v1/auth/login", {"email": user, "password": password}),
            (f"{BASE}/api/auth/login", {"email": user, "password": password}),
            (f"{BASE}/api/login", {"email": user, "password": password, "username": user}),
        ]:
            try:
                r = self.session.post(endpoint, json=payload, timeout=45)
                if r.status_code < 400 and "error" not in r.text.lower()[:200]:
                    self.save_session()
                    probe = self.list_films(limit=1)
                    if probe:
                        return True
            except Exception:
                continue
        return False

    def login_browser(self, user: str = "", password: str = "", timeout_sec: int = 300) -> bool:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page()
            page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
            if user and password:
                for sel in ['input[type="email"]', 'input[name="email"]']:
                    if page.locator(sel).count():
                        page.fill(sel, user)
                        break
                for sel in ['input[type="password"]', 'input[name="password"]']:
                    if page.locator(sel).count():
                        page.fill(sel, password)
                        break
                for sel in ['button[type="submit"]', 'text=Log in', 'text=Sign in']:
                    if page.locator(sel).count():
                        page.click(sel)
                        break
            else:
                log(f"Log in to StillsLab manually ({timeout_sec}s)…")
            deadline = time.time() + timeout_sec
            while time.time() < deadline:
                cookies = page.context.cookies()
                if any(c["name"].lower() in ("session", "token", "auth") for c in cookies):
                    break
                if "log out" in page.content().lower() or "logout" in page.content().lower():
                    break
                page.wait_for_timeout(1000)
            for c in page.context.cookies():
                self.session.cookies.set(c["name"], c["value"])
            browser.close()
        self.save_session()
        return bool(self.list_films(limit=1))

    def _get_json(self, path: str, params: dict | None = None) -> Any:
        url = path if path.startswith("http") else f"{BASE}{path}"
        r = self.session.get(url, params=params or {}, timeout=60)
        if r.status_code >= 400:
            return None
        try:
            return r.json()
        except Exception:
            return None

    def list_films(self, *, page: int = 1, limit: int = 20) -> list[dict]:
        for path in (
            f"/api/v1/films?page={page}&limit={limit}",
            f"/api/v1/content/films?page={page}&limit={limit}",
            f"/api/films?page={page}&limit={limit}",
        ):
            data = self._get_json(path)
            if isinstance(data, dict):
                items = data.get("items") or data.get("data") or data.get("films")
                if isinstance(items, list) and items:
                    return items
            if isinstance(data, list) and data:
                return data
        # HTML fallback: scrape homepage film cards
        try:
            r = self.session.get(BASE, timeout=60)
            html = r.text
            titles = re.findall(r'"title":"([^"]+)"[^}]*?"slug":"([^"]+)"', html)
            return [{"title": t, "slug": s} for t, s in titles[:limit]]
        except Exception:
            return []

    def list_stills(self, film: dict) -> list[dict]:
        slug = film.get("slug") or film.get("id") or ""
        for path in (
            f"/api/v1/films/{slug}/stills",
            f"/api/v1/content/films/{slug}/stills",
            f"/api/films/{slug}/stills",
        ):
            data = self._get_json(path)
            if isinstance(data, dict):
                items = data.get("items") or data.get("stills") or data.get("data")
                if isinstance(items, list):
                    return items
            if isinstance(data, list):
                return data
        return []

    def still_url(self, still: dict) -> str:
        for key in ("url", "image_url", "imageUrl", "full_url", "src", "path"):
            val = still.get(key)
            if isinstance(val, str) and val.startswith("http"):
                return val
        still_id = still.get("id") or still.get("still_id") or ""
        if still_id:
            return f"{BASE}/api/v1/stills/{still_id}/download"
        return ""

    def fetch_bytes(self, url: str) -> bytes:
        r = self.session.get(url, timeout=120)
        r.raise_for_status()
        return r.content


def ensure_login(client: StillsLabClient, user: str, password: str) -> bool:
    if client.load_session() and client.list_films(limit=1):
        log("Restored StillsLab session.")
        return True
    if user and password and client.login(user, password):
        log("StillsLab login OK.")
        return True
    return False


def mirror(
    out_dir: Path,
    *,
    user: str,
    password: str,
    limit_titles: int | None = None,
    limit_stills: int | None = None,
    delay: float = 1.8,
) -> MirrorStats:
    out_dir.mkdir(parents=True, exist_ok=True)
    by_title = out_dir / "by_title"
    by_title.mkdir(parents=True, exist_ok=True)
    state_path = out_dir / ".cache" / "mirror_state.json"
    state = load_json(state_path, {"done_titles": []})
    done_titles = set(state.get("done_titles") or [])

    client = StillsLabClient(out_dir)
    if not ensure_login(client, user, password):
        raise SystemExit("StillsLab login failed — run --login-browser")

    stats = MirrorStats()
    films = client.list_films(limit=limit_titles or 50)
    log(f"Found {len(films)} titles")

    for film in films:
        title = str(film.get("title") or film.get("name") or film.get("slug") or "unknown")
        key = str(film.get("slug") or film.get("id") or title)
        if key in done_titles:
            continue
        folder = by_title / safe_dirname(title, key)
        folder.mkdir(parents=True, exist_ok=True)
        stills = client.list_stills(film)
        downloaded = 0
        for still in stills:
            if limit_stills and downloaded >= limit_stills:
                break
            still_id = str(still.get("id") or still.get("code") or downloaded)
            dest = folder / f"{still_id}.jpg"
            if dest.exists() and dest.stat().st_size > 5000:
                stats.stills_skipped += 1
                continue
            url = client.still_url(still)
            if not url:
                continue
            try:
                time.sleep(delay)
                dest.write_bytes(client.fetch_bytes(url))
                stats.stills_downloaded += 1
                downloaded += 1
            except Exception as exc:
                stats.errors.append(f"{title}/{still_id}: {exc}")
        stats.titles += 1
        done_titles.add(key)
        state["done_titles"] = sorted(done_titles)
        write_json(state_path, state)
        log(f"  {title}: {downloaded} stills")

    write_json(out_dir / "manifest.json", {"updated_at": utc_now(), "stats": asdict(stats)})
    return stats


def main() -> int:
    p = argparse.ArgumentParser(description="StillsLab mirror")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--user", default=os.environ.get("STILLSLAB_USER", ""))
    p.add_argument("--password", default=os.environ.get("STILLSLAB_PASS", ""))
    p.add_argument("--limit-titles", type=int, default=None)
    p.add_argument("--limit-stills", type=int, default=None)
    p.add_argument("--delay", type=float, default=1.8)
    p.add_argument("--login-browser", action="store_true")
    args = p.parse_args()

    if not args.user:
        try:
            from mirror_credentials import load_credentials

            u, pw = load_credentials("stillslab", out_dir=args.out)
            args.user, args.password = u, pw or args.password
        except ImportError:
            pass

    client = StillsLabClient(args.out)
    if args.login_browser:
        ok = client.login_browser(args.user, args.password)
        return 0 if ok else 1
    if not args.user or not args.password:
        raise SystemExit("Set --user/--password or save credentials on Archives page")
    stats = mirror(
        args.out,
        user=args.user,
        password=args.password,
        limit_titles=args.limit_titles,
        limit_stills=args.limit_stills,
        delay=args.delay,
    )
    log(
        f"Done titles={stats.titles} downloaded={stats.stills_downloaded} "
        f"errors={len(stats.errors)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
