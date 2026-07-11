#!/usr/bin/env python3
"""Mirror FilmGrab (film-grab.com) stills into local film folders.

Layout:
  data/library/_filmgrab/
    .cache/meta/{film_slug}.json
    {Film Title}/
      {Film}_01.jpg
      …
    films.json          # A-Z index cache
    manifest.json

Usage:
  python scripts/filmgrab_mirror.py
  python scripts/filmgrab_mirror.py --limit-films 10
  python scripts/filmgrab_mirror.py --films "blade-runner,paris-texas"
  python scripts/filmgrab_mirror.py --refresh-index

Personal/local bootstrap only — FilmGrab is fair-use reference; don't redistribute.
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
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "library" / "_filmgrab"
BASE = "https://film-grab.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

FILM_URL_RE = re.compile(r'href="(https://film-grab\.com/\d{4}/\d{2}/\d{2}/([^"/]+)/?)"')
TITLE_RE = re.compile(r"<title>([^<]+)</title>", re.I)
H1_RE = re.compile(r'<h1[^>]*class="[^"]*entry-title[^"]*"[^>]*>([^<]+)</h1>', re.I)
# Filenames may include spaces: "01 (155).jpg"
IMG_RE = re.compile(
    r'(https://film-grab\.com/wp-content/uploads/photo-gallery/(?!thumb/)([^"?]+\.jpe?g))',
    re.I,
)
HREF_IMG_RE = re.compile(
    r'href="(https://film-grab\.com/wp-content/uploads/photo-gallery/(?!thumb/)[^"]+\.jpe?g)(?:\?[^"]*)?"',
    re.I,
)
GALLERY_ID_RE = re.compile(r"(?:gallery_id|data-gallery-id)=[\"']?(\d+)", re.I)
DOWNLOAD_GALLERY_RE = re.compile(
    r'admin-ajax\.php\?action=download_gallery&gallery_id=(\d+)[^"\s]*',
    re.I,
)
TAG_RE = re.compile(r'rel="tag">([^<]+)</a>')
SAFE_DIR_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')


@dataclass
class FilmRef:
    url: str
    slug: str
    title: str = ""
    gallery_id: str = ""
    year: str | None = None
    tags: list[str] = field(default_factory=list)
    images: list[str] = field(default_factory=list)


@dataclass
class MirrorStats:
    films: int = 0
    images_downloaded: int = 0
    images_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"), flush=True)


def http_get(url: str, *, referer: str | None = None, timeout: float = 90.0) -> bytes:
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_text(url: str, *, referer: str | None = None, timeout: float = 90.0) -> str:
    return http_get(url, referer=referer, timeout=timeout).decode("utf-8", errors="replace")


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict | list:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def clean_title(raw: str) -> str:
    t = html_lib.unescape(raw or "")
    t = re.sub(r"\s*[–—\-]\s*\[?FILMGRAB\]?\s*$", "", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    return t or "Untitled"


def safe_dirname(title: str, slug: str) -> str:
    t = SAFE_DIR_RE.sub("", title).strip(" .")
    t = re.sub(r"\s+", " ", t)
    return (t or slug)[:140]


def list_films(*, refresh: bool, out_dir: Path) -> list[FilmRef]:
    cache = out_dir / "films.json"
    if cache.exists() and not refresh:
        raw = load_json(cache)
        if isinstance(raw, list) and raw:
            return [FilmRef(**{k: v for k, v in item.items() if k in FilmRef.__dataclass_fields__}) for item in raw]

    log(f"Fetching film index from {BASE}/movies-a-z/ …")
    html = http_get_text(f"{BASE}/movies-a-z/", referer=f"{BASE}/")
    by_slug: dict[str, FilmRef] = {}
    for m in FILM_URL_RE.finditer(html):
        url, slug = m.group(1).rstrip("/"), m.group(2)
        if slug not in by_slug:
            by_slug[slug] = FilmRef(url=url + "/", slug=slug)
    films = sorted(by_slug.values(), key=lambda f: f.slug)
    write_json(cache, [asdict(f) for f in films])
    log(f"Indexed {len(films)} films")
    return films


def parse_film_page(html: str, film: FilmRef) -> FilmRef:
    title_m = H1_RE.search(html) or TITLE_RE.search(html)
    if title_m:
        film.title = clean_title(title_m.group(1))
    else:
        film.title = film.slug.replace("-", " ").title()

    g = GALLERY_ID_RE.search(html)
    if g:
        film.gallery_id = g.group(1)

    tags = [html_lib.unescape(t.group(1)).strip() for t in TAG_RE.finditer(html)]
    film.tags = sorted({t for t in tags if t})
    # year heuristic from tags or URL
    for t in film.tags:
        if re.fullmatch(r"\d{4}", t):
            film.year = t
            break
    if not film.year:
        ym = re.search(r"film-grab\.com/(\d{4})/", film.url)
        if ym:
            film.year = ym.group(1)

    seen: set[str] = set()
    images: list[str] = []

    def _add(url: str) -> None:
        url = html_lib.unescape(url.split("?")[0].strip())
        name = Path(urllib.parse.urlparse(url).path).name
        if re.search(r"-\d+x\d+\.jpe?g$", name, re.I):
            return
        if "/thumb/" in url.lower():
            return
        if url not in seen:
            seen.add(url)
            images.append(url)

    for m in HREF_IMG_RE.finditer(html):
        _add(m.group(1))
    for m in IMG_RE.finditer(html):
        _add(m.group(1))
    film.images = images
    return film


def download_gallery_zip(gallery_id: str, dest_zip: Path, *, referer: str) -> Path:
    url = (
        f"{BASE}/wp-admin/admin-ajax.php?action=download_gallery"
        f"&gallery_id={gallery_id}&bwg=0&type=gallery"
        f"&tag_input_name=bwg_tag_id_bwg_thumbnails_masonry_0"
        f"&bwg_tag_id_bwg_thumbnails_masonry_0&tag=0&bwg_search_0"
    )
    data = http_get(url, referer=referer, timeout=300.0)
    if len(data) < 1000 or data[:2] != b"PK":
        raise RuntimeError(f"zip download failed ({len(data)} bytes, not a zip)")
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    dest_zip.write_bytes(data)
    return dest_zip


def extract_zip_images(zip_path: Path, folder: Path) -> int:
    import zipfile

    count = 0
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename).name
            if not name.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                continue
            if name.startswith(".") or "/thumb/" in info.filename.replace("\\", "/").lower():
                continue
            dest = folder / name
            if dest.exists() and dest.stat().st_size > 1000:
                continue
            with zf.open(info) as src, dest.open("wb") as out:
                out.write(src.read())
            count += 1
    return count


def mirror(
    out_dir: Path,
    *,
    film_slugs: list[str] | None = None,
    limit_films: int | None = None,
    limit_images: int | None = None,
    delay: float = 0.35,
    refresh_index: bool = False,
    dry_run: bool = False,
) -> MirrorStats:
    out_dir = out_dir.resolve()
    meta_dir = out_dir / ".cache" / "meta"
    meta_dir.mkdir(parents=True, exist_ok=True)

    stats = MirrorStats()
    films = list_films(refresh=refresh_index, out_dir=out_dir)

    if film_slugs:
        want = {s.strip().lower() for s in film_slugs if s.strip()}
        films = [f for f in films if f.slug in want or any(w in f.slug for w in want)]
        # allow direct slug not in index
        known = {f.slug for f in films}
        for s in want:
            if s not in known and re.fullmatch(r"[a-z0-9\-]+", s):
                films.append(FilmRef(url=f"{BASE}/", slug=s, title=s.replace("-", " ").title()))

    if limit_films is not None:
        films = films[:limit_films]

    stats.films = len(films)
    log(f"Films to mirror: {len(films)}")

    manifest: dict = load_json(out_dir / "manifest.json")  # type: ignore[assignment]
    if not isinstance(manifest, dict):
        manifest = {}
    manifest.setdefault("source", BASE)
    manifest.setdefault("films", {})

    for i, film in enumerate(films, 1):
        log(f"[{i}/{len(films)}] {film.slug}")
        meta_path = meta_dir / f"{film.slug}.json"
        cached = load_json(meta_path)
        if isinstance(cached, dict) and cached.get("images") and not film.url.endswith("film-grab.com/"):
            # reuse title/images if we already scraped, still download missing files
            film.title = cached.get("title") or film.title
            film.gallery_id = cached.get("gallery_id") or film.gallery_id
            film.year = cached.get("year") or film.year
            film.tags = list(cached.get("tags") or film.tags)
            film.images = list(cached.get("images") or [])
            film.url = cached.get("url") or film.url

        need_scrape = not film.images
        if need_scrape:
            if not film.url or film.url.rstrip("/") == BASE:
                msg = f"{film.slug}: no URL in index"
                log(f"  ERROR {msg}")
                stats.errors.append(msg)
                continue
            try:
                time.sleep(delay)
                page = http_get_text(film.url, referer=f"{BASE}/movies-a-z/")
                parse_film_page(page, film)
            except Exception as exc:
                msg = f"{film.slug}: page fetch failed: {exc}"
                log(f"  ERROR {msg}")
                stats.errors.append(msg)
                continue

        if not film.title:
            film.title = film.slug.replace("-", " ").title()

        folder = out_dir / safe_dirname(film.title, film.slug)
        if not dry_run:
            folder.mkdir(parents=True, exist_ok=True)

        images = film.images
        if limit_images is not None:
            images = images[:limit_images]
        log(f"  {film.title!r} — {len(images)} stills (gallery_id={film.gallery_id or '?'})")

        downloaded_here = 0

        # Prefer per-image CDN pulls; fall back to gallery zip when page has no direct URLs
        if not images and film.gallery_id and not dry_run:
            zip_path = out_dir / ".cache" / "zips" / f"{film.slug}.zip"
            try:
                log(f"  ZIP gallery_id={film.gallery_id}")
                time.sleep(delay)
                if not (zip_path.exists() and zip_path.stat().st_size > 1000):
                    download_gallery_zip(film.gallery_id, zip_path, referer=film.url)
                n = extract_zip_images(zip_path, folder)
                stats.images_downloaded += n
                downloaded_here += n
                log(f"  extracted {n} from zip")
                try:
                    zip_path.unlink(missing_ok=True)
                except Exception:
                    pass
            except Exception as exc:
                msg = f"{film.slug}: zip failed: {exc}"
                log(f"  ERROR {msg}")
                stats.errors.append(msg)

        for img_url in images:
            # Paths may contain spaces — encode path segments only
            parsed = urllib.parse.urlparse(img_url)
            path_enc = urllib.parse.quote(parsed.path)
            fetch_url = urllib.parse.urlunparse(parsed._replace(path=path_enc))
            name = Path(parsed.path).name
            dest = folder / name
            if dest.exists() and dest.stat().st_size > 1000:
                stats.images_skipped += 1
                continue
            if dry_run:
                continue
            try:
                time.sleep(delay * 0.25)
                data = http_get(fetch_url, referer=film.url, timeout=120.0)
                if len(data) < 500 or data[:3] != b"\xff\xd8\xff":
                    raise RuntimeError(f"not a jpeg ({len(data)} bytes)")
                dest.write_bytes(data)
                stats.images_downloaded += 1
                downloaded_here += 1
            except Exception as exc:
                msg = f"{film.slug}/{name}: {exc}"
                log(f"  ERROR {msg}")
                stats.errors.append(msg)

        meta = {
            "slug": film.slug,
            "title": film.title,
            "url": film.url,
            "gallery_id": film.gallery_id,
            "year": film.year,
            "tags": film.tags,
            "images": film.images,
            "folder": folder.name,
        }
        if not dry_run:
            write_json(meta_path, meta)
            # sidecar for ingest
            write_json(folder / "_filmgrab.json", {
                "source": "filmgrab",
                "title": film.title,
                "slug": film.slug,
                "url": film.url,
                "year": film.year,
                "tags": film.tags,
            })

        manifest["films"][film.slug] = {
            "title": film.title,
            "folder": folder.name,
            "year": film.year,
            "image_count": len(images),
            "downloaded_this_run": downloaded_here,
        }
        if i % 5 == 0 or i == len(films):
            write_json(out_dir / "manifest.json", manifest)

    write_json(out_dir / "manifest.json", manifest)
    write_json(
        out_dir / "README.json",
        {
            "source": BASE,
            "note": "Local FilmGrab mirror for Cinekive. Film title = folder name.",
            "ingest": "POST /projects/{id}/ingest/images/paths with /data/library/_filmgrab",
            "stats": asdict(stats),
        },
    )
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Mirror FilmGrab stills into film folders")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--films", type=str, default="", help="Comma-separated film slugs")
    p.add_argument("--limit-films", type=int, default=None)
    p.add_argument("--limit-images", type=int, default=None)
    p.add_argument("--delay", type=float, default=0.35)
    p.add_argument("--refresh-index", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--list-films", action="store_true")
    args = p.parse_args(argv)

    if args.list_films:
        films = list_films(refresh=args.refresh_index, out_dir=args.out)
        for f in films:
            print(f.slug)
        print(f"# {len(films)} films", file=sys.stderr)
        return 0

    slugs = [s for s in args.films.split(",") if s.strip()] or None
    stats = mirror(
        args.out,
        film_slugs=slugs,
        limit_films=args.limit_films,
        limit_images=args.limit_images,
        delay=args.delay,
        refresh_index=args.refresh_index,
        dry_run=args.dry_run,
    )
    log(
        f"Done. films={stats.films} downloaded={stats.images_downloaded} "
        f"skipped={stats.images_skipped} errors={len(stats.errors)}"
    )
    return 1 if stats.errors and stats.images_downloaded == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
