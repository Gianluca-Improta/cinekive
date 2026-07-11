#!/usr/bin/env python3
"""One-screen archive pipeline status — mirrors, disk, ingest jobs, recent log tails."""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = os.environ.get("CINEKIVE_API", "http://localhost:8000").rstrip("/")


def safe_print(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(msg.encode("ascii", errors="replace").decode("ascii"), flush=True)


def process_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if handle:
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

SOURCES = {
    "filmgrab": {
        "label": "FilmGrab",
        "disk": ROOT / "data" / "library" / "_filmgrab",
        "glob": "**/*.jpg",
        "project_id": "68b6eb1b-6e56-4350-a0a7-cd709782c64e",
    },
    "eyecandy": {
        "label": "EyeCandy",
        "disk": ROOT / "data" / "library" / "_eyecandy",
        "glob": "**/*.gif",
        "project_id": "b8e404f9-7d47-437f-912b-fd975213fe1e",
    },
    "shotdeck": {
        "label": "ShotDeck",
        "disk": Path("D:/library/_shotdeck") if Path("D:/").exists() else ROOT / "data" / "library" / "_shotdeck",
        "glob": "**/*.jpg",
        "project_id": "6dbcf19c-440d-408e-9918-e3fc09c30573",
    },
}

PROJECT_NAMES = {v["project_id"]: v["label"] for v in SOURCES.values()}


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def tail_lines(path: Path, n: int = 5) -> list[str]:
    if not path.exists():
        return ["(no log)"]
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        return lines[-n:] if lines else ["(empty)"]
    except Exception as exc:
        return [f"(read error: {exc})"]


def count_files(root: Path, pattern: str) -> int:
    if not root.exists():
        return 0
    n = 0
    for p in root.glob(pattern):
        if not p.is_file() or ".cache" in p.parts:
            continue
        n += 1
    return n


def api_get(path: str, timeout: float = 12.0) -> dict | list | None:
    try:
        req = urllib.request.Request(f"{API}{path}", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def fmt_age(iso: str | None) -> str:
    if not iso:
        return "—"
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        sec = (datetime.now(timezone.utc) - dt).total_seconds()
        if sec < 60:
            return f"{int(sec)}s ago"
        if sec < 3600:
            return f"{int(sec // 60)}m ago"
        return f"{int(sec // 3600)}h ago"
    except Exception:
        return iso[:19]


def mirror_pid(root: Path) -> tuple[int | None, bool]:
    for name in ("loop.pid", "mirror.pid"):
        pid_path = root / ".cache" / name
        if not pid_path.exists():
            continue
        try:
            pid = int(pid_path.read_text(encoding="utf-8").strip())
        except Exception:
            continue
        return pid, process_alive(pid)
    run = load_json(root / ".cache" / "mirror_run.json")
    pid = run.get("pid")
    if pid and run.get("running"):
        pid = int(pid)
        return pid, process_alive(pid)
    return None, False


def shotdeck_db_summary(root: Path) -> str:
    db = root / ".cache" / "state.db"
    if not db.exists():
        return "no state.db"
    try:
        conn = sqlite3.connect(db)
        tasks = dict(conn.execute("SELECT status, COUNT(*) FROM tasks GROUP BY status").fetchall())
        shots = dict(conn.execute("SELECT status, COUNT(*) FROM shots GROUP BY status").fetchall())
        conn.close()
        return f"tasks={tasks} shots={shots}"
    except Exception as exc:
        return f"db error: {exc}"


def print_section(title: str) -> None:
    safe_print("")
    safe_print(f"=== {title} ===")


def main() -> int:
    health = api_get("/health", timeout=5)
    safe_print(f"Cinekive API @ {API}")
    if isinstance(health, dict):
        safe_print(
            f"  health: ok | sqlite={health.get('sqlite')} qdrant={health.get('qdrant')} "
            f"embed={health.get('embedding_model_loaded')} enrich={health.get('enrich', {}).get('tier', '?')}"
        )
    else:
        safe_print("  health: UNREACHABLE")

    print_section("Mirrors (disk + process)")
    for key, spec in SOURCES.items():
        root: Path = spec["disk"]
        n = count_files(root, spec["glob"])
        pid, alive = mirror_pid(root)
        pid_s = f"pid {pid} {'running' if alive else 'stale'}" if pid else "not running"
        extra = ""
        if key == "filmgrab":
            manifest = load_json(root / "manifest.json")
            extra = f" | {len(manifest.get('films') or {})} films in manifest"
            run = load_json(root / ".cache" / "mirror_run.json")
            if run.get("pid") and not alive:
                mpid = int(run["pid"])
                if process_alive(mpid):
                    pid_s = f"pid {mpid} running (mirror)"
        if key == "shotdeck":
            loop = load_json(root / ".cache" / "loop_state.json")
            blocked = loop.get("blocked")
            extra = (
                f" | cycle={loop.get('cycle')} blocked={blocked} "
                f"on_disk={loop.get('images_on_disk')} updated={fmt_age(loop.get('updated_at'))}"
            )
            for sub in ("by_commercial", "by_music_video", "by_indie", "by_movie"):
                c = count_files(root / sub, "*.jpg")
                if c:
                    extra += f" | {sub}={c}"
            extra += f"\n    {shotdeck_db_summary(root)}"
            log = root / ".cache" / "loop_stdout.log"
        else:
            log = root / ".cache" / "mirror.log"
        safe_print(f"  {spec['label']}: {n} files | {pid_s}{extra}")
        for line in tail_lines(log, 3):
            safe_print(f"    log: {line}")

    print_section("Ingest jobs (running)")
    jobs_data = api_get("/jobs?limit=50")
    running: list[dict] = []
    if isinstance(jobs_data, dict):
        running = [j for j in jobs_data.get("items") or [] if j.get("status") == "running"]
    if not running:
        safe_print("  (none running)")
    else:
        by_project: dict[str, list[dict]] = {}
        for j in running:
            pid = str(j.get("project_id") or "")
            by_project.setdefault(pid, []).append(j)
        for pid, group in by_project.items():
            name = PROJECT_NAMES.get(pid, pid[:8] + "...")
            safe_print(f"  {name}: {len(group)} job(s)")
            for j in group:
                step = (j.get("current_step") or "")[:72]
                safe_print(
                    f"    {j.get('type')} {j.get('progress_pct')}% "
                    f"({j.get('processed_items', 0)}/{j.get('total_items', 0)}) — {step}"
                )

    print_section("Ingest keepalive")
    keepalive_log = ROOT / "data" / "library" / ".cache" / "ingest_keepalive.log"
    ka_pid_path = ROOT / "data" / "library" / ".cache" / "ingest_keepalive.pid"
    if ka_pid_path.exists():
        try:
            kpid = int(ka_pid_path.read_text(encoding="utf-8").strip())
            safe_print(f"  pid {kpid} {'running' if process_alive(kpid) else 'stale'}")
        except Exception:
            pass
    for line in tail_lines(keepalive_log, 4):
        safe_print(f"    {line}")

    print_section("Log tails (live watch)")
    for label, path in [
        ("ShotDeck loop", SOURCES["shotdeck"]["disk"] / ".cache" / "loop_stdout.log"),
        ("FilmGrab mirror", SOURCES["filmgrab"]["disk"] / ".cache" / "mirror.log"),
    ]:
        safe_print(f"  {label}: {path}")
    safe_print("")
    safe_print("  Watch live:  Get-Content D:\\library\\_shotdeck\\.cache\\loop_stdout.log -Wait -Tail 20")
    safe_print("  Auto-refresh: powershell -File scripts/archive_status_watch.ps1")
    safe_print("  One-shot:     python scripts/archive_status.py")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
