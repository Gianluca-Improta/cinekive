#!/usr/bin/env python3
"""Mirror MovieStillsDB previews into local film folders.

Layout:
  data/library/_moviestillsdb/
    .cache/mirror_state.json
    {Movie Title}/
      {code}.jpg
    manifest.json

Previews (500px) download without login. Pass --user/--password for donator full-res when available.

Usage:
  python scripts/moviestillsdb_mirror.py
  python scripts/moviestillsdb_mirror.py --limit-movies 5
  python scripts/moviestillsdb_mirror.py --user you@mail.com --password secret
"""

from __future__ import annotations

import argparse
import html as html_lib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "library" / "_moviestillsdb"
BASE = "https://www.moviestillsdb.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
MOVIE_HREF_RE = re.compile(r'href="(/movies/[^"]+)"')
PREVIEW_RE = re.compile(
    r'"code":"(?P<code>[^"]+)"[^}]*?"preview":\{[^}]*?"path":"(?P<url>https:\\/\\/cdn\.moviestillsdb\.com\\/i\\/500x\\/[^"]+)"',
)
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)
SAFE_DIR_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
CSRF_RE = re.compile(r'name="csrf-token"\s+content="([^"]+)"', re.I)


@dataclass
class MirrorStats:
    movies: int = 0
    images_downloaded: int = 0
    images_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def log(msg: str) -> None:
    print(msg, flush=True)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def safe_dirname(title: str) -> str:
    t = SAFE_DIR_RE.sub("", (title or "").strip())
    t = re.sub(r"\s+", " ", t).strip(" .")
    return (t or "untitled")[:120]


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


class MSDBClient:
    def __init__(self) -> None:
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
        self.logged_in = False

    def get_text(self, url: str, *, referer: str | None = None) -> str:
        headers = {"User-Agent": UA, "Accept": "text/html,application/json"}
        if referer:
            headers["Referer"] = referer
        req = urllib.request.Request(url, headers=headers)
        with self.opener.open(req, timeout=60) as resp:
            return resp.read().decode("utf-8", errors="replace")

    def get_bytes(self, url: str) -> bytes:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": BASE})
        with self.opener.open(req, timeout=120) as resp:
            return resp.read()

    def login(self, user: str, password: str) -> bool:
        try:
            page = self.get_text(f"{BASE}/login")
        except Exception:
            return False
        csrf = ""
        m = CSRF_RE.search(page)
        if m:
            csrf = m.group(1)
        data = urllib.parse.urlencode({"email": user, "password": password}).encode()
        headers = {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": f"{BASE}/login",
            "Origin": BASE,
        }
        if csrf:
            headers["X-CSRF-TOKEN"] = csrf
        req = urllib.request.Request(f"{BASE}/login", data=data, headers=headers, method="POST")
        try:
            with self.opener.open(req, timeout=45) as resp:
                body = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
        self.logged_in = "logout" in body.lower() or "log out" in body.lower()
        return self.logged_in


def movie_title_from_html(html: str, fallback: str) -> str:
    m = TITLE_RE.search(html)
    if not m:
        return fallback
    title = m.group(1).strip()
    title = re.sub(r"\s*-\s*Movie stills.*$", "", title, flags=re.I)
    return title or fallback


def parse_stills(html: str) -> list[tuple[str, str]]:
    clean = html.replace("\\/", "/")
    out: list[tuple[str, str]] = []
    seen: set[str] = set()
    for m in PREVIEW_RE.finditer(clean):
        code, url = m.group("code"), m.group("url").replace("\\/", "/")
        if code in seen:
            continue
        seen.add(code)
        out.append((code, url))
    if out:
        return out
    # fallback: any 500x preview paths
    for url in re.findall(r"https://cdn\.moviestillsdb\.com/i/500x/[a-z0-9]+/[^\"\\]+\.jpg", clean, re.I):
        code = Path(url).stem.split("-")[0] or url.rsplit("/", 1)[-1][:12]
        if code not in seen:
            seen.add(code)
            out.append((code, url))
    return out


def discover_movies(client: MSDBClient, *, limit: int | None = None) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for seed in (f"{BASE}/", f"{BASE}/movies/recent"):
        try:
            html = client.get_text(seed)
        except Exception:
            continue
        for href in MOVIE_HREF_RE.findall(html):
            if href in seen or href.endswith("/movies/recent") or re.fullmatch(r"/movies/\d{4}", href):
                continue
            seen.add(href)
            urls.append(BASE + href)
            if limit and len(urls) >= limit:
                return urls
    return urls


def mirror(
    out_dir: Path,
    *,
    user: str = "",
    password: str = "",
    limit_movies: int | None = None,
    delay: float = 1.5,
) -> MirrorStats:
    out_dir.mkdir(parents=True, exist_ok=True)
    cache = out_dir / ".cache"
    cache.mkdir(parents=True, exist_ok=True)
    state_path = cache / "mirror_state.json"
    state = load_json(state_path, {"done_movies": []})
    done = set(state.get("done_movies") or [])

    client = MSDBClient()
    if user and password:
        if client.login(user, password):
            log("MovieStillsDB login OK")
        else:
            log("MovieStillsDB login failed — continuing with preview-only downloads")

    stats = MirrorStats()
    movies = discover_movies(client, limit=limit_movies)
    log(f"Found {len(movies)} movie pages")

    for url in movies:
        slug = url.rsplit("/", 1)[-1]
        if slug in done:
            stats.images_skipped += 1
            continue
        try:
            time.sleep(delay)
            html = client.get_text(url, referer=BASE)
            title = movie_title_from_html(html, slug)
            stills = parse_stills(html)
            if not stills:
                stats.errors.append(f"{slug}: no stills parsed")
                done.add(slug)
                continue
            folder = out_dir / safe_dirname(title)
            folder.mkdir(parents=True, exist_ok=True)
            for code, img_url in stills:
                dest = folder / f"{code}.jpg"
                if dest.exists() and dest.stat().st_size > 8000:
                    stats.images_skipped += 1
                    continue
                try:
                    time.sleep(delay * 0.5)
                    dest.write_bytes(client.get_bytes(img_url))
                    stats.images_downloaded += 1
                except Exception as exc:
                    stats.errors.append(f"{code}: {exc}")
            stats.movies += 1
            done.add(slug)
            state["done_movies"] = sorted(done)
            write_json(state_path, state)
            log(f"  {title}: {len(stills)} stills")
        except Exception as exc:
            stats.errors.append(f"{slug}: {exc}")

    write_json(
        out_dir / "manifest.json",
        {"updated_at": utc_now(), "stats": asdict(stats), "movies_done": len(done)},
    )
    return stats


def main() -> int:
    p = argparse.ArgumentParser(description="MovieStillsDB mirror")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--user", default="")
    p.add_argument("--password", default="")
    p.add_argument("--limit-movies", type=int, default=None)
    p.add_argument("--delay", type=float, default=1.5)
    args = p.parse_args()

    if not args.user:
        try:
            from mirror_credentials import load_credentials

            u, pw = load_credentials("moviestillsdb", out_dir=args.out)
            args.user, args.password = u, pw or args.password
        except ImportError:
            pass

    stats = mirror(
        args.out,
        user=args.user,
        password=args.password,
        limit_movies=args.limit_movies,
        delay=args.delay,
    )
    log(
        f"Done movies={stats.movies} downloaded={stats.images_downloaded} "
        f"skipped={stats.images_skipped} errors={len(stats.errors)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
