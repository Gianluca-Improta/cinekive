"""Shared credential loader for mirror scripts."""

from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_LIBRARY = Path(__file__).resolve().parents[1] / "data" / "library"
CREDENTIALS_FILE = "source_credentials.json"


def _library_root(out_dir: Path | None = None) -> Path:
    if out_dir is not None:
        # _shotdeck -> library root
        parts = out_dir.resolve().parts
        if "_filmgrab" in parts:
            return Path(*parts[: parts.index("_filmgrab")])
        if "_eyecandy" in parts:
            return Path(*parts[: parts.index("_eyecandy")])
        if "_shotdeck" in parts:
            return Path(*parts[: parts.index("_shotdeck")])
        if "_moviestillsdb" in parts:
            return Path(*parts[: parts.index("_moviestillsdb")])
        if "_stillslab" in parts:
            return Path(*parts[: parts.index("_stillslab")])
        if out_dir.name.startswith("_"):
            return out_dir.parent
    env = os.environ.get("CINEKIVE_LIBRARY", "")
    if env:
        return Path(env)
    if Path("D:/library").exists():
        return Path("D:/library")
    return DEFAULT_LIBRARY


def load_credentials(source_key: str, *, out_dir: Path | None = None) -> tuple[str, str]:
    """Load user/password from env vars or library .cache/source_credentials.json."""
    env_user = os.environ.get(f"{source_key.upper()}_USER", "") or os.environ.get(
        f"{source_key.upper()}_EMAIL", ""
    )
    env_pass = os.environ.get(f"{source_key.upper()}_PASS", "") or os.environ.get(
        f"{source_key.upper()}_PASSWORD", ""
    )
    # ShotDeck legacy env names
    if source_key == "shotdeck":
        env_user = env_user or os.environ.get("SHOTDECK_USER", "")
        env_pass = env_pass or os.environ.get("SHOTDECK_PASS", "")
    if env_user and env_pass:
        return env_user, env_pass

    path = _library_root(out_dir) / ".cache" / CREDENTIALS_FILE
    if not path.exists():
        return "", ""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        row = data.get(source_key) if isinstance(data, dict) else None
        if isinstance(row, dict):
            return str(row.get("user") or ""), str(row.get("password") or "")
    except Exception:
        pass
    return "", ""
