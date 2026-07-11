#!/usr/bin/env python3
"""ShotDeck trial harvester — adaptive loop: ramp up until blocked, then cycle back.

Runs for days until stopped. Resumes from SQLite state in {out}/.cache/state.db.
Throttle state persists in {out}/.cache/adaptive.json.

Usage:
  python scripts/shotdeck_loop.py
  python scripts/shotdeck_loop.ps1          # background on Windows

Stop: delete .cache/loop.pid or Ctrl+C in foreground terminal.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from shotdeck_mirror import (  # noqa: E402
    DEFAULT_OUT,
    MirrorStats,
    StateDB,
    build_task_paths,
    load_json,
    log,
    mirror,
    refresh_login,
    TAXONOMY_PATH,
    taxonomy_output_subdir,
    taxonomy_output_subdirs,
    utc_now,
)

DEFAULT_API = os.environ.get("CINEKIVE_API", "http://localhost:8000")
DEFAULT_PROJECT = os.environ.get(
    "SHOTDECK_PROJECT_ID", "6dbcf19c-440d-408e-9918-e3fc09c30573"
)

# Hard caps — adaptive throttle stays within these bounds.
THROTTLE_MIN = {
    "interval_min": 5.0,
    "limit_tasks": 2,
    "limit_pages": 1,
    "limit_shots": 20,
    "delay": 3.0,
}
THROTTLE_MAX = {
    "interval_min": 2.0,
    "limit_tasks": 14,
    "limit_pages": 6,
    "limit_shots": 180,
    "delay": 0.9,
}
BUMP_UP = {
    "interval_min": -0.4,
    "limit_tasks": 1,
    "limit_pages": 1,
    "limit_shots": 18,
    "delay": -0.12,
}
BUMP_DOWN = {
    "interval_min": 2.0,
    "limit_tasks": -2,
    "limit_pages": -1,
    "limit_shots": -30,
    "delay": 0.35,
}


@dataclass
class AdaptiveThrottle:
    interval_min: float
    limit_tasks: int
    limit_pages: int
    limit_shots: int
    delay: float
    level: int = 0
    consecutive_successes: int = 0
    consecutive_blocks: int = 0

    @classmethod
    def from_baseline(
        cls,
        *,
        interval_min: float,
        limit_tasks: int,
        limit_pages: int,
        limit_shots: int,
        delay: float,
    ) -> AdaptiveThrottle:
        return cls(
            interval_min=interval_min,
            limit_tasks=limit_tasks,
            limit_pages=limit_pages,
            limit_shots=limit_shots,
            delay=delay,
        )

    @classmethod
    def load(cls, path: Path, baseline: AdaptiveThrottle) -> AdaptiveThrottle:
        data = load_json(path, {})
        if not isinstance(data, dict) or not data:
            return baseline
        try:
            return cls(
                interval_min=float(data.get("interval_min", baseline.interval_min)),
                limit_tasks=int(data.get("limit_tasks", baseline.limit_tasks)),
                limit_pages=int(data.get("limit_pages", baseline.limit_pages)),
                limit_shots=int(data.get("limit_shots", baseline.limit_shots)),
                delay=float(data.get("delay", baseline.delay)),
                level=int(data.get("level", 0)),
                consecutive_successes=int(data.get("consecutive_successes", 0)),
                consecutive_blocks=int(data.get("consecutive_blocks", 0)),
            )
        except (TypeError, ValueError):
            return baseline

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")

    def _clamp(self) -> None:
        self.interval_min = max(THROTTLE_MIN["interval_min"], min(THROTTLE_MAX["interval_min"], self.interval_min))
        self.limit_tasks = max(THROTTLE_MIN["limit_tasks"], min(THROTTLE_MAX["limit_tasks"], self.limit_tasks))
        self.limit_pages = max(THROTTLE_MIN["limit_pages"], min(THROTTLE_MAX["limit_pages"], self.limit_pages))
        self.limit_shots = max(THROTTLE_MIN["limit_shots"], min(THROTTLE_MAX["limit_shots"], self.limit_shots))
        self.delay = max(THROTTLE_MIN["delay"], min(THROTTLE_MAX["delay"], self.delay))

    def at_max(self) -> bool:
        return (
            self.interval_min <= THROTTLE_MAX["interval_min"]
            and self.limit_tasks >= THROTTLE_MAX["limit_tasks"]
            and self.limit_pages >= THROTTLE_MAX["limit_pages"]
            and self.limit_shots >= THROTTLE_MAX["limit_shots"]
            and self.delay <= THROTTLE_MAX["delay"]
        )

    def bump_up(self) -> bool:
        if self.at_max():
            return False
        self.interval_min += BUMP_UP["interval_min"]
        self.limit_tasks += BUMP_UP["limit_tasks"]
        self.limit_pages += BUMP_UP["limit_pages"]
        self.limit_shots += BUMP_UP["limit_shots"]
        self.delay += BUMP_UP["delay"]
        self.level = min(self.level + 1, 20)
        self._clamp()
        return True

    def bump_down(self) -> bool:
        self.interval_min += BUMP_DOWN["interval_min"]
        self.limit_tasks += BUMP_DOWN["limit_tasks"]
        self.limit_pages += BUMP_DOWN["limit_pages"]
        self.limit_shots += BUMP_DOWN["limit_shots"]
        self.delay += BUMP_DOWN["delay"]
        self.level = max(self.level - 1, 0)
        self._clamp()
        return True

    def on_success(self) -> str | None:
        self.consecutive_blocks = 0
        self.consecutive_successes += 1
        if self.consecutive_successes >= 2 and self.bump_up():
            self.consecutive_successes = 0
            return "ramped_up"
        return None

    def on_block(self) -> str:
        self.consecutive_successes = 0
        self.consecutive_blocks += 1
        self.bump_down()
        return "ramped_down"

    def backoff_minutes(self, base_backoff: float) -> float:
        # Short backoff on real blocks only — cap so the loop keeps moving.
        drop = max(2.0, base_backoff * 0.12 * self.consecutive_blocks)
        return min(8.0, drop + self.level * 0.5)

    def summary(self) -> str:
        return (
            f"tasks={self.limit_tasks} pages={self.limit_pages} shots={self.limit_shots} "
            f"delay={self.delay:.2f}s interval={self.interval_min:.1f}m level={self.level}"
        )


def count_jpgs(root: Path) -> int:
    if not root.exists():
        return 0
    n = 0
    for p in root.rglob("*.jpg"):
        if ".cache" in p.parts:
            continue
        n += 1
    return n


def count_shotdeck_images(out_dir: Path, taxonomy: dict) -> int:
    total = 0
    seen_roots: set[str] = set()
    for sub in taxonomy_output_subdirs(taxonomy):
        root = out_dir / sub
        key = str(root)
        if key in seen_roots:
            continue
        seen_roots.add(key)
        total += count_jpgs(root)
    total += count_jpgs(out_dir / "by_movie")
    return total


def api_get(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_post(url: str, body: dict) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, method="POST", headers={"Content-Type": "application/json", "Accept": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def list_project_ids(api: str) -> list[str]:
    try:
        data = api_get(f"{api.rstrip('/')}/projects")
        items = data.get("items") if isinstance(data, dict) else data
        return [p["id"] for p in items if isinstance(p, dict) and p.get("id")]
    except Exception:
        return []


def any_ingest_running(api: str, project_ids: list[str]) -> bool:
    for pid in project_ids:
        try:
            data = api_get(f"{api.rstrip('/')}/projects/{pid}/jobs")
            items = data.get("items") if isinstance(data, dict) else []
            for job in items:
                if job.get("status") == "running" and job.get("type") == "ingest_images":
                    return True
        except Exception:
            continue
    return False


def wait_for_ingest_slot(api: str, project_ids: list[str], timeout_sec: float = 600) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        if not any_ingest_running(api, project_ids):
            return True
        log("Waiting for other ingest job to finish…")
        time.sleep(30)
    log("Ingest still busy — will queue ShotDeck ingest anyway (API may serialize)")
    return True


def queue_ingest(api: str, project_id: str) -> str | None:
    try:
        res = api_post(
            f"{api.rstrip('/')}/projects/{project_id}/sources/ingest",
            {"source": "shotdeck", "recursive": True},
        )
        job = res.get("job") or {}
        return job.get("id")
    except urllib.error.HTTPError as exc:
        log(f"Ingest queue failed: {exc.read().decode()[:200]}")
        return None
    except Exception as exc:
        log(f"Ingest queue failed: {exc}")
        return None


def write_loop_state(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def pending_shot_count(out_dir: Path) -> int:
    db = StateDB(out_dir / ".cache" / "state.db")
    try:
        return db.pending_shot_count()
    finally:
        db.close()


def run_mirror(
    out_dir: Path,
    *,
    user: str,
    password: str,
    throttle: AdaptiveThrottle,
    download_only: bool,
) -> MirrorStats | None:
    try:
        return mirror(
            out_dir,
            user=user,
            password=password,
            delay=throttle.delay,
            discover_only=False,
            download_only=download_only,
            max_tasks=0 if download_only else throttle.limit_tasks,
            max_pages=throttle.limit_pages if not download_only else None,
            max_shots=throttle.limit_shots,
            download_batch=throttle.limit_shots,
        )
    except SystemExit as exc:
        log(f"Mirror exited: {exc}")
        return None
    except Exception as exc:
        log(f"Mirror error: {exc}")
        return None


def cycle_productive(stats: MirrorStats | None, new_files: int) -> bool:
    if stats is None:
        return False
    if stats.cf_blocks > 0:
        return False
    return (
        stats.shots_discovered > 0
        or stats.shots_downloaded > 0
        or stats.shots_seen > 0
        or new_files > 0
    )


def cycle_blocked(stats: MirrorStats | None, productive: bool) -> bool:
    if stats is None:
        return True
    if stats.cf_blocks > 0:
        return True
    if productive:
        return False
    return stats.shots_seen == 0 and stats.shots_downloaded == 0


def run_loop(
    *,
    out_dir: Path,
    user: str,
    password: str,
    api: str,
    project_id: str,
    baseline: AdaptiveThrottle,
    backoff_min: float,
    download_only_every: int,
) -> None:
    out_dir = out_dir.resolve()
    cache = out_dir / ".cache"
    cache.mkdir(parents=True, exist_ok=True)
    pid_path = cache / "loop.pid"
    state_path = cache / "loop_state.json"
    adaptive_path = cache / "adaptive.json"
    pid_path.write_text(str(os.getpid()), encoding="utf-8")

    throttle = AdaptiveThrottle.load(adaptive_path, baseline)
    throttle.save(adaptive_path)

    taxonomy = load_json(TAXONOMY_PATH, {})
    db = StateDB(cache / "state.db")
    db.upsert_tasks(build_task_paths(taxonomy))
    db.close()

    cycle = 0
    scopes = [s.get("media_type") for s in taxonomy.get("media_scopes", [])]
    log(f"Loop started pid={os.getpid()} out={out_dir} scopes={scopes or ['legacy']}")
    log(f"Initial: {throttle.summary()}")

    try:
        while True:
            cycle += 1
            t0 = time.time()
            imgs_before = count_shotdeck_images(out_dir, taxonomy)
            download_only = download_only_every > 0 and cycle % download_only_every == 0
            throttle_action = None

            log(f"=== Cycle {cycle} {'download-only' if download_only else 'discover+download'} | {throttle.summary()} ===")

            stats = run_mirror(
                out_dir,
                user=user,
                password=password,
                throttle=throttle,
                download_only=download_only,
            )

            # If discover stalled but queue has pending shots, drain downloads this cycle.
            if not download_only and stats is not None:
                pending = pending_shot_count(out_dir)
                stalled = stats.cf_blocks > 0 or (
                    stats.shots_discovered == 0 and stats.shots_downloaded == 0
                )
                if stalled and pending > 0:
                    log(f"Discover stalled — draining up to {pending} pending downloads")
                    dl_stats = run_mirror(
                        out_dir,
                        user=user,
                        password=password,
                        throttle=throttle,
                        download_only=True,
                    )
                    if dl_stats is not None:
                        stats.merge(dl_stats)

            imgs_after = count_shotdeck_images(out_dir, taxonomy)
            new_files = max(0, imgs_after - imgs_before)
            productive = cycle_productive(stats, new_files)
            blocked = cycle_blocked(stats, productive)

            if stats is not None:
                log(
                    f"Cycle stats: discovered={stats.shots_discovered} downloaded={stats.shots_downloaded} "
                    f"skipped={stats.shots_skipped} seen={stats.shots_seen} cf={stats.cf_blocks} "
                    f"errors={len(stats.errors)} new_files={new_files}"
                )

            if productive:
                throttle_action = throttle.on_success()
                if throttle_action:
                    log(f"Throttle {throttle_action}: {throttle.summary()}")
            elif blocked:
                throttle_action = throttle.on_block()
                log(f"Throttle {throttle_action}: {throttle.summary()}")
                if stats is not None and stats.cf_blocks > 0:
                    log("Cloudflare hit — refreshing login session")
                    if refresh_login(out_dir, user, password):
                        log("Session refreshed")
                    else:
                        log("Session refresh failed — try --login-browser if blocks persist")

            throttle.save(adaptive_path)

            ingest_job = None
            if new_files > 0 or (stats and stats.shots_downloaded > 0):
                project_ids = list(set(list_project_ids(api) + [project_id]))
                wait_for_ingest_slot(api, project_ids, timeout_sec=600)
                ingest_job = queue_ingest(api, project_id)
                if ingest_job:
                    log(f"Ingest queued job={ingest_job}")
                else:
                    log("Ingest queue failed this cycle — will retry next cycle")

            write_loop_state(
                state_path,
                {
                    "updated_at": utc_now(),
                    "cycle": cycle,
                    "images_on_disk": imgs_after,
                    "new_files_this_cycle": new_files,
                    "last_stats": None if stats is None else {
                        "discovered": stats.shots_discovered,
                        "downloaded": stats.shots_downloaded,
                        "cf_blocks": stats.cf_blocks,
                        "errors": len(stats.errors),
                    },
                    "ingest_job": ingest_job,
                    "blocked": blocked,
                    "productive": productive,
                    "throttle": asdict(throttle),
                    "throttle_action": throttle_action,
                },
            )

            if blocked:
                sleep_min = throttle.backoff_minutes(backoff_min) * random.uniform(1.0, 1.2)
                log(f"Blocked — short backoff {sleep_min:.1f}m then retry at reduced rate")
            else:
                sleep_min = throttle.interval_min * random.uniform(0.85, 1.15)

            elapsed = time.time() - t0
            sleep_sec = max(45, sleep_min * 60 - elapsed)
            log(f"Sleeping {sleep_sec / 60:.1f}m until next cycle…")
            time.sleep(sleep_sec)
    finally:
        try:
            pid_path.unlink(missing_ok=True)
        except Exception:
            pass


def main() -> int:
    p = argparse.ArgumentParser(description="ShotDeck trial loop — adaptive capture + ingest")
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--user", default=os.environ.get("SHOTDECK_USER", ""))
    p.add_argument("--password", default=os.environ.get("SHOTDECK_PASS", ""))
    p.add_argument("--api", default=DEFAULT_API)
    p.add_argument("--project-id", default=DEFAULT_PROJECT)
    p.add_argument("--interval-min", type=float, default=float(os.environ.get("SHOTDECK_LOOP_INTERVAL_MIN", "10")))
    p.add_argument("--backoff-min", type=float, default=float(os.environ.get("SHOTDECK_LOOP_BACKOFF_MIN", "20")))
    p.add_argument("--limit-tasks", type=int, default=int(os.environ.get("SHOTDECK_LOOP_LIMIT_TASKS", "5")))
    p.add_argument("--limit-pages", type=int, default=int(os.environ.get("SHOTDECK_LOOP_LIMIT_PAGES", "2")))
    p.add_argument("--limit-shots", type=int, default=int(os.environ.get("SHOTDECK_LOOP_LIMIT_SHOTS", "50")))
    p.add_argument("--delay", type=float, default=float(os.environ.get("SHOTDECK_LOOP_DELAY", "2.0")))
    p.add_argument(
        "--download-only-every",
        type=int,
        default=int(os.environ.get("SHOTDECK_LOOP_DOWNLOAD_ONLY_EVERY", "6")),
        help="Every N cycles, only download pending (no new discover)",
    )
    args = p.parse_args()

    if not args.user or not args.password:
        raise SystemExit("Set SHOTDECK_USER and SHOTDECK_PASS")

    cache = args.out / ".cache"
    pid_path = cache / "loop.pid"
    if pid_path.exists():
        try:
            old = int(pid_path.read_text(encoding="utf-8").strip())
            os.kill(old, 0)
            log(f"Loop already running (pid {old}). Stop it first or delete {pid_path}")
            return 1
        except OSError:
            pid_path.unlink(missing_ok=True)

    baseline = AdaptiveThrottle.from_baseline(
        interval_min=args.interval_min,
        limit_tasks=args.limit_tasks,
        limit_pages=args.limit_pages,
        limit_shots=args.limit_shots,
        delay=args.delay,
    )

    run_loop(
        out_dir=args.out,
        user=args.user,
        password=args.password,
        api=args.api,
        project_id=args.project_id,
        baseline=baseline,
        backoff_min=args.backoff_min,
        download_only_every=args.download_only_every,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
