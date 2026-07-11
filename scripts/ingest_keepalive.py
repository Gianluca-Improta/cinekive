#!/usr/bin/env python3
"""Keep archive ingests moving — queue catch-up jobs when mirrors add files."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "db" / "cinearchive.db"
API = os.environ.get("CINEKIVE_API", "http://localhost:8000").rstrip("/")

SOURCES = ("filmgrab", "eyecandy", "shotdeck")
PROJECT_IDS = {
    "filmgrab": "68b6eb1b-6e56-4350-a0a7-cd709782c64e",
    "eyecandy": "b8e404f9-7d47-437f-912b-fd975213fe1e",
    "shotdeck": "6dbcf19c-440d-408e-9918-e3fc09c30573",
}


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    try:
        print(f"[{ts}] {msg}", flush=True)
    except UnicodeEncodeError:
        print(f"[{ts}] {msg}".encode("ascii", errors="replace").decode("ascii"), flush=True)


def api_post(path: str, body: dict | None = None, timeout: float = 120.0) -> dict:
    data = json.dumps(body or {}).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(path: str, timeout: float = 30.0) -> dict | list | None:
    try:
        req = urllib.request.Request(f"{API}{path}", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def cancel_stale_running_ingests(*, max_age_hours: float = 2.0, all_running: bool = False) -> int:
    if not DB.exists():
        return 0
    conn = sqlite3.connect(DB)
    try:
        if all_running:
            cur = conn.execute(
                """
                UPDATE jobs
                SET status = 'cancelled',
                    finished_at = datetime('now'),
                    current_step = 'cancelled — restarting ingest'
                WHERE status = 'running'
                  AND type IN ('ingest_images', 'ingest_video')
                """
            )
        else:
            cur = conn.execute(
                """
                UPDATE jobs
                SET status = 'cancelled',
                    finished_at = datetime('now'),
                    current_step = 'cancelled — stale ingest worker'
                WHERE status = 'running'
                  AND type IN ('ingest_images', 'ingest_video')
                  AND started_at IS NOT NULL
                  AND datetime(started_at) < datetime('now', ?)
                """,
                (f"-{int(max_age_hours * 60)} minutes",),
            )
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


def running_ingests_by_project() -> dict[str, list[dict]]:
    data = api_get("/jobs?limit=80")
    out: dict[str, list[dict]] = {}
    if not isinstance(data, dict):
        return out
    for job in data.get("items") or []:
        if job.get("status") != "running":
            continue
        if job.get("type") not in ("ingest_images", "ingest_video"):
            continue
        pid = str(job.get("project_id") or "")
        out.setdefault(pid, []).append(job)
    return out


def queue_source_ingest(source: str, *, timeout: float = 300.0) -> str | None:
    try:
        res = api_post(f"/sources/{source}/ingest?recursive=true", {}, timeout=timeout)
        job = res.get("job") or {}
        return job.get("id")
    except urllib.error.HTTPError as exc:
        log(f"  {source}: HTTP {exc.code} {exc.read().decode()[:200]}")
        return None
    except Exception as exc:
        log(f"  {source}: {exc}")
        return None


def ensure_ingests(*, force: bool = False) -> None:
    running = running_ingests_by_project()
    total_running = sum(len(v) for v in running.values())
    if total_running >= 1 and not force:
        for pid, jobs in running.items():
            j = jobs[0]
            name = next((k for k, v in PROJECT_IDS.items() if v == pid), pid[:8])
            log(
                f"  {name}: ingest active ({j.get('progress_pct')}% "
                f"{j.get('processed_items')}/{j.get('total_items')}) — waiting"
            )
        return

    for source in SOURCES:
        pid = PROJECT_IDS[source]
        active = running.get(pid, [])
        if active and not force:
            j = active[0]
            log(
                f"  {source}: already running ({j.get('progress_pct')}% "
                f"{j.get('processed_items')}/{j.get('total_items')})"
            )
            continue
        job_id = queue_source_ingest(source)
        if job_id:
            log(f"  {source}: queued ingest job {job_id[:8]}...")
            # One archive at a time — avoids SQLite lock + GPU pile-up
            return
        log(f"  {source}: failed to queue")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Keep archive ingests running")
    p.add_argument("--once", action="store_true", help="Run one pass and exit")
    p.add_argument("--interval-min", type=float, default=20.0)
    p.add_argument("--cancel-stale", action="store_true", help="Cancel running ingests older than 2h")
    p.add_argument("--cancel-all-running", action="store_true", help="Cancel every running ingest job")
    p.add_argument("--force", action="store_true", help="Queue ingest even if one is running")
    args = p.parse_args(argv)

    if args.cancel_all_running:
        n = cancel_stale_running_ingests(all_running=True)
        log(f"Cancelled {n} running ingest job(s) in DB")
    elif args.cancel_stale:
        n = cancel_stale_running_ingests()
        log(f"Cancelled {n} stale ingest job(s) in DB")

    log(f"Ingest keepalive -> {API}")
    while True:
        health = api_get("/health", timeout=8)
        if not isinstance(health, dict):
            log("API not ready — retrying in 60s")
            if args.once:
                return 1
            time.sleep(60)
            continue

        log("Checking archives...")
        ensure_ingests(force=args.force)

        if args.once:
            return 0
        time.sleep(max(60.0, args.interval_min * 60.0))


if __name__ == "__main__":
    raise SystemExit(main())
