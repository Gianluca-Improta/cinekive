#!/usr/bin/env python3
"""Create FilmGrab project and queue ingest of the mirror folder."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MIRROR = ROOT / "data" / "library" / "_filmgrab"
API = "http://127.0.0.1:8000"


def req(method: str, path: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode("utf-8")
    r = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def find_project(slug: str, name: str) -> dict | None:
    try:
        projects = req("GET", "/projects")
    except Exception:
        return None
    items = projects if isinstance(projects, list) else projects.get("items") or []
    for p in items:
        if p.get("slug", "").lower() == slug.lower() or p.get("name", "").lower() == name.lower():
            return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", type=Path, default=DEFAULT_MIRROR)
    ap.add_argument("--slug", default="filmgrab")
    ap.add_argument("--name", default="FilmGrab Archive")
    ap.add_argument("--api", default=API)
    args = ap.parse_args()
    global API
    API = args.api.rstrip("/")

    mirror = args.path.resolve()
    if not mirror.exists():
        print(f"Missing {mirror} — run scripts/filmgrab_mirror.py first", file=sys.stderr)
        return 1

    jpgs = [p for p in mirror.rglob("*.jpg") if not any(x.startswith(".") for x in p.parts)]
    print(f"Found {len(jpgs)} JPGs under {mirror}")
    if not jpgs:
        print("Nothing to ingest yet.")
        return 0

    project = find_project(args.slug, args.name)
    if not project:
        print(f"Creating project {args.name!r}…")
        project = req(
            "POST",
            "/projects",
            {
                "name": args.name,
                "description": "Mirrored FilmGrab stills — film title from folder, VLM for craft tags.",
                "sampling_mode": "heroes",
                "generate_previews": False,
            },
        )
    pid = project["id"]
    print(f"Project {project.get('name')} id={pid} slug={project.get('slug')}")

    ingest_path = "/data/library/_filmgrab"
    if args.path.resolve() != DEFAULT_MIRROR.resolve():
        rel = args.path.resolve().relative_to(DEFAULT_MIRROR.resolve())
        ingest_path = f"{ingest_path}/{rel.as_posix()}"

    print(f"Queueing ingest of {ingest_path}…")
    try:
        job = req(
            "POST",
            f"/projects/{pid}/ingest/images/paths",
            {"paths": [ingest_path], "recursive": True},
        )
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        return 1
    print(json.dumps(job, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
