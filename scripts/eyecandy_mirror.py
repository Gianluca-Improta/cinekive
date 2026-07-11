#!/usr/bin/env python3
"""Mirror EyeCandy (eyecannndy.com) GIFs into local technique folders.

Layout:
  data/library/_eyecandy/
    .cache/clips/{clip_id}.gif     # canonical bytes (resume-safe)
    .cache/meta/{clip_id}.json     # title, urls, techniques
    {technique-slug}/
      {Safe Title}__ec{clip_id}.gif
    manifest.json

Usage:
  python scripts/eyecandy_mirror.py                  # full archive
  python scripts/eyecandy_mirror.py --techniques dolly-shot,bolt-cam
  python scripts/eyecandy_mirror.py --limit-per-tech 5 --dry-run
  python scripts/eyecandy_mirror.py --skip-gifs      # metadata + webp thumbs only

Polite defaults: ~2 req/s to HTML, CDN downloads uncapped but sequential.
Personal/local bootstrap only — respect EyeCandy ToS for redistribution.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "library" / "_eyecandy"
BASE = "https://eyecannndy.com"
ASSET = "https://asset.eyecannndy.com"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

CLIP_ID_RE = re.compile(r'hx-get="/clip_info_g/(\d+)/')
TECH_HREF_RE = re.compile(r'href="(/technique/([a-z0-9\-]+))"')
T_ID_RE = re.compile(r"[?&]t_id=(\d+)")
PAIR_RE = re.compile(
    r'hx-get="/clip_info_g/(\d+)/[\s\S]{0,2000}?'
    r'src="(https://asset\.eyecannndy\.com/media/clip/[^"]+\.webp)"'
    r'[\s\S]{0,500}?alt="([^"]*)"',
    re.I,
)
DOWNLOAD_RE = re.compile(r'/downloads/([A-Za-z0-9+\-/=_]+)/([^"/]+)')
SAFE_RE = re.compile(r"[^\w\s.\-()'&+,]+", re.UNICODE)


def decode_download_payload(b64: str) -> str:
    s = b64.strip().replace("-", "+").replace("_", "/")
    pad = (-len(s)) % 4
    if pad:
        s += "=" * pad
    return base64.b64decode(s).decode("utf-8", errors="replace")


@dataclass
class ClipRef:
    clip_id: str
    technique: str
    title: str
    webp_url: str | None = None
    gif_url: str | None = None
    download_title: str | None = None


@dataclass
class MirrorStats:
    techniques: int = 0
    clips_seen: int = 0
    gifs_downloaded: int = 0
    gifs_skipped: int = 0
    errors: list[str] = field(default_factory=list)


def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"), flush=True)


def safe_title(title: str, clip_id: str) -> str:
    t = (title or "").strip() or f"clip-{clip_id}"
    t = SAFE_RE.sub("", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    t = t[:120] or f"clip-{clip_id}"
    return f"{t}__ec{clip_id}"


def http_get(url: str, *, referer: str | None = None, timeout: float = 60.0) -> bytes:
    headers = {
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    if "clip_info_g" in url:
        headers["HX-Request"] = "true"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def http_get_text(url: str, *, referer: str | None = None, timeout: float = 60.0) -> str:
    return http_get(url, referer=referer, timeout=timeout).decode("utf-8", errors="replace")


def list_techniques(html: str | None = None) -> list[str]:
    if html is None:
        html = http_get_text(f"{BASE}/", referer=f"{BASE}/")
    slugs = sorted({m.group(2) for m in TECH_HREF_RE.finditer(html)})
    return slugs


def technique_t_id(html: str) -> str:
    m = T_ID_RE.search(html)
    return m.group(1) if m else ""


def parse_technique_page(html: str, technique: str) -> list[ClipRef]:
    by_id: dict[str, ClipRef] = {}
    for m in PAIR_RE.finditer(html):
        cid, webp, alt = m.group(1), m.group(2), m.group(3).strip()
        by_id[cid] = ClipRef(clip_id=cid, technique=technique, title=alt or f"clip-{cid}", webp_url=webp)
    # fallback: ids only
    for m in CLIP_ID_RE.finditer(html):
        cid = m.group(1)
        if cid not in by_id:
            by_id[cid] = ClipRef(clip_id=cid, technique=technique, title=f"clip-{cid}")
    return list(by_id.values())


def fetch_clip_download(clip_id: str, technique: str, *, t_id: str = "") -> tuple[str | None, str | None]:
    """Return (gif_url, download_title) from clip_info_g HTML."""
    qs = urllib.parse.urlencode(
        {
            "type": "technique",
            "board": "",
            "entry": "",
            "p_type": "",
            "p_id": "",
            "t_id": t_id,
            "q": "",
        }
    )
    url = f"{BASE}/clip_info_g/{clip_id}/?{qs}"
    html = http_get_text(url, referer=f"{BASE}/technique/{technique}")
    m = DOWNLOAD_RE.search(html)
    if not m:
        return None, None
    raw = decode_download_payload(m.group(1))
    title = urllib.parse.unquote(m.group(2).rstrip("/"))
    if raw.startswith("http") and raw.lower().endswith((".gif", ".webp", ".mp4", ".webm")):
        return raw, title
    return None, title


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def link_or_copy(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists():
        return
    try:
        dest.hardlink_to(src)
    except OSError:
        import shutil

        shutil.copy2(src, dest)


def mirror(
    out_dir: Path,
    *,
    techniques: Iterable[str] | None = None,
    limit_per_tech: int | None = None,
    delay: float = 0.45,
    skip_gifs: bool = False,
    dry_run: bool = False,
    max_clips: int | None = None,
) -> MirrorStats:
    out_dir = out_dir.resolve()
    cache_clips = out_dir / ".cache" / "clips"
    cache_meta = out_dir / ".cache" / "meta"
    cache_clips.mkdir(parents=True, exist_ok=True)
    cache_meta.mkdir(parents=True, exist_ok=True)

    stats = MirrorStats()
    log(f"Fetching technique index from {BASE}/ …")
    home = http_get_text(f"{BASE}/", referer=f"{BASE}/")
    all_techs = list_techniques(home)
    selected = list(techniques) if techniques else all_techs
    selected = [t.strip().lower() for t in selected if t.strip()]
    unknown = [t for t in selected if t not in set(all_techs)]
    if unknown:
        log(f"Note: {len(unknown)} technique(s) not on home nav (still trying): {unknown[:8]}")
    stats.techniques = len(selected)
    log(f"Techniques to mirror: {len(selected)} / {len(all_techs)} on site")

    manifest: dict = load_json(out_dir / "manifest.json")
    manifest.setdefault("source", BASE)
    manifest.setdefault("techniques", {})
    manifest.setdefault("clips", {})

    total_done = 0
    for ti, tech in enumerate(selected, 1):
        log(f"[{ti}/{len(selected)}] technique/{tech}")
        try:
            time.sleep(delay)
            html = http_get_text(f"{BASE}/technique/{tech}", referer=f"{BASE}/")
        except Exception as exc:
            msg = f"{tech}: page fetch failed: {exc}"
            log(f"  ERROR {msg}")
            stats.errors.append(msg)
            continue

        clips = parse_technique_page(html, tech)
        t_id = technique_t_id(html)
        if limit_per_tech is not None:
            clips = clips[:limit_per_tech]
        log(f"  {len(clips)} clips on page (t_id={t_id or '?'})")
        tech_manifest = manifest["techniques"].setdefault(
            tech, {"clip_ids": [], "count": 0, "t_id": t_id}
        )
        tech_manifest["t_id"] = t_id

        for clip in clips:
            if max_clips is not None and total_done >= max_clips:
                log("Hit --max-clips; stopping.")
                write_json(out_dir / "manifest.json", manifest)
                return stats

            stats.clips_seen += 1
            cid = clip.clip_id
            meta_path = cache_meta / f"{cid}.json"
            meta = load_json(meta_path)
            techs = set(meta.get("techniques") or [])
            techs.add(tech)

            gif_path = cache_clips / f"{cid}.gif"
            need_gif = not skip_gifs and not gif_path.exists()

            if need_gif or not meta.get("gif_url"):
                try:
                    time.sleep(delay)
                    gif_url, dl_title = fetch_clip_download(cid, tech, t_id=t_id)
                    if gif_url:
                        clip.gif_url = gif_url
                    if dl_title:
                        clip.download_title = dl_title
                        clip.title = dl_title
                except Exception as exc:
                    msg = f"{tech}/{cid}: clip_info failed: {exc}"
                    log(f"  ERROR {msg}")
                    stats.errors.append(msg)

            title = clip.download_title or clip.title or meta.get("title") or f"clip-{cid}"
            gif_url = clip.gif_url or meta.get("gif_url")

            if need_gif and gif_url and not dry_run:
                try:
                    log(f"  DL {cid} {title[:60]}")
                    data = http_get(gif_url, referer=f"{BASE}/technique/{tech}", timeout=180.0)
                    if len(data) < 500 or data[:6] == b"<html>" or data[:3] == b"<!D":
                        raise RuntimeError(f"not a gif ({len(data)} bytes)")
                    gif_path.write_bytes(data)
                    stats.gifs_downloaded += 1
                    total_done += 1
                except Exception as exc:
                    msg = f"{tech}/{cid}: gif download failed: {exc}"
                    log(f"  ERROR {msg}")
                    stats.errors.append(msg)
                    need_gif = False
            elif gif_path.exists():
                stats.gifs_skipped += 1

            meta.update(
                {
                    "clip_id": cid,
                    "title": title,
                    "webp_url": clip.webp_url or meta.get("webp_url"),
                    "gif_url": gif_url or meta.get("gif_url"),
                    "techniques": sorted(techs),
                    "source": f"{BASE}/technique/{tech}",
                }
            )
            if not dry_run:
                write_json(meta_path, meta)

            # Place into technique folder (hardlink to cache when possible)
            if gif_path.exists() and not dry_run:
                dest = out_dir / tech / f"{safe_title(title, cid)}.gif"
                link_or_copy(gif_path, dest)

            if cid not in tech_manifest["clip_ids"]:
                tech_manifest["clip_ids"].append(cid)
            tech_manifest["count"] = len(tech_manifest["clip_ids"])
            manifest["clips"][cid] = {
                "title": title,
                "techniques": sorted(techs),
                "gif": str(gif_path.relative_to(out_dir)).replace("\\", "/") if gif_path.exists() else None,
            }

        write_json(out_dir / "manifest.json", manifest)

    write_json(out_dir / "manifest.json", manifest)
    write_json(
        out_dir / "README.json",
        {
            "source": BASE,
            "note": "Local mirror for Cinekive bootstrap. Keep EyeCandy titles; technique = folder name.",
            "ingest": "POST /projects/{id}/ingest/images/paths with path to this folder, recursive=true",
            "stats": asdict(stats),
        },
    )
    return stats


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Mirror EyeCandy GIFs into technique folders")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--techniques", type=str, default="", help="Comma-separated technique slugs")
    p.add_argument("--limit-per-tech", type=int, default=None)
    p.add_argument("--max-clips", type=int, default=None, help="Stop after N successful GIF downloads")
    p.add_argument("--delay", type=float, default=0.45, help="Seconds between HTML requests")
    p.add_argument("--skip-gifs", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--list-techniques", action="store_true")
    args = p.parse_args(argv)

    if args.list_techniques:
        techs = list_techniques()
        for t in techs:
            print(t)
        print(f"# {len(techs)} techniques", file=sys.stderr)
        return 0

    techs = [t for t in args.techniques.split(",") if t.strip()] or None
    stats = mirror(
        args.out,
        techniques=techs,
        limit_per_tech=args.limit_per_tech,
        delay=args.delay,
        skip_gifs=args.skip_gifs,
        dry_run=args.dry_run,
        max_clips=args.max_clips,
    )
    log(
        f"Done. techniques={stats.techniques} clips_seen={stats.clips_seen} "
        f"downloaded={stats.gifs_downloaded} skipped={stats.gifs_skipped} errors={len(stats.errors)}"
    )
    return 1 if stats.errors and stats.gifs_downloaded == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
