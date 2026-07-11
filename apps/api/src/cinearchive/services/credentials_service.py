"""Persist subscription credentials for gated archive mirrors (local only)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DEFAULT_CREDENTIALS_NAME = "source_credentials.json"


def credentials_path(library_root: Path) -> Path:
    return library_root / ".cache" / DEFAULT_CREDENTIALS_NAME


def load_all(library_root: Path) -> dict[str, dict[str, str]]:
    path = credentials_path(library_root)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {}
        out: dict[str, dict[str, str]] = {}
        for key, val in data.items():
            if isinstance(val, dict):
                user = str(val.get("user") or "")
                password = str(val.get("password") or "")
                if user or password:
                    out[str(key)] = {"user": user, "password": password}
        return out
    except Exception:
        return {}


def save_source(library_root: Path, source_key: str, user: str, password: str) -> None:
    path = credentials_path(library_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = load_all(library_root)
    data[source_key] = {"user": user.strip(), "password": password}
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def get_source(library_root: Path, source_key: str) -> tuple[str, str]:
    row = load_all(library_root).get(source_key) or {}
    return row.get("user", ""), row.get("password", "")


def configured(library_root: Path, source_key: str) -> bool:
    user, password = get_source(library_root, source_key)
    return bool(user and password)


def mask_user(user: str) -> str:
    if not user:
        return ""
    if "@" in user:
        local, _, domain = user.partition("@")
        if len(local) <= 2:
            return f"{local[0]}*@{domain}"
        return f"{local[0]}***{local[-1]}@{domain}"
    if len(user) <= 3:
        return user[0] + "*"
    return user[:2] + "***" + user[-1]


def status_for_sources(library_root: Path, keys: list[str]) -> dict[str, Any]:
    all_creds = load_all(library_root)
    out: dict[str, Any] = {}
    for key in keys:
        row = all_creds.get(key) or {}
        user = row.get("user", "")
        out[key] = {
            "configured": bool(user and row.get("password")),
            "user_hint": mask_user(user) if user else "",
        }
    return out
