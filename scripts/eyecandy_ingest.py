#!/usr/bin/env python3
"""Create (or reuse) the EyeCandy project and queue image ingest of the mirror.

Usage (host, with API up):
  python scripts/eyecandy_ingest.py
  python scripts/eyecandy_ingest.py --path data/library/_eyecandy/dolly-shot

Uses POST /projects + /projects/{id}/ingest/images/paths against localhost:8000.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MIRROR = ROOT / "data" / "library" / "_eyecandy"
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
    items = projects if isinstance(projects, list) else projects.get("items") or projects.get("projects") or []
    slug_l = slug.lower()
    name_l = name.lower()
    for p in items:
        if p.get("slug", "").lower() == slug_l or p.get("name", "").lower() == name_l:
            return p
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--path", type=Path, default=DEFAULT_MIRROR)
    ap.add_argument("--slug", default="eyecandy")
    ap.add_argument("--name", default="EyeCandy Archive")
    ap.add_argument("--api", default=API)
    args = ap.parse_args()
    global API
    API = args.api.rstrip("/")

    mirror = args.path.resolve()
    if not mirror.exists():
        print(f"Mirror path missing: {mirror}", file=sys.stderr)
        print("Run: python scripts/eyecandy_mirror.py", file=sys.stderr)
        return 1

    # Count gifs excluding .cache
    gifs = [p for p in mirror.rglob("*.gif") if not any(x.startswith(".") for x in p.parts)]
    print(f"Found {len(gifs)} GIFs under {mirror}")
    if not gifs:
        print("Nothing to ingest yet — let the mirror download first.")
        return 0

    project = find_project(args.slug, args.name)
    if not project:
        print(f"Creating project {args.slug!r}…")
        project = req(
            "POST",
            "/projects",
            {
                "name": args.name,
                "description": "Mirrored EyeCandy technique GIFs — titles preserved, techniques from folders.",
                "sampling_mode": "heroes",
                "generate_previews": False,
            },
        )
    pid = project["id"]
    print(f"Project {project.get('name')} id={pid}")

    # Prefer container path if API is in Docker
    container_path = "/data/library/_eyecandy"
    host_hint = str(mirror).replace("\\", "/")
    ingest_path = container_path if "_eyecandy" in host_hint else str(mirror)
    if args.path.resolve() != DEFAULT_MIRROR.resolve():
        # technique subfolder
        rel = args.path.resolve().relative_to(DEFAULT_MIRROR.resolve())
        ingest_path = f"{container_path}/{rel.as_posix()}"

    print(f"Queueing ingest of {ingest_path} (recursive)…")
    try:
        job = req(
            "POST",
            f"/projects/{pid}/ingest/images/paths",
            {"paths": [ingest_path], "recursive": True},
        )
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"Ingest failed: {e.code} {body}", file=sys.stderr)
        return 1

    print(json.dumps(job, indent=2))
    print("Ingest queued. When ready: POST /projects/{id}/enrich")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
