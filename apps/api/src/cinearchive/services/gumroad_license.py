"""Gumroad license verification helpers (no Cinekive accounts — key check only)."""

from __future__ import annotations

import os
from typing import Any

import httpx

# Seat / device budget tracked via Gumroad `uses` (incremented only on activation).
DEVICE_LIMIT = int(os.environ.get("CINEKIVE_LICENSE_DEVICE_LIMIT", "3"))

# Online re-check cadence (increment_uses_count=false).
REVERIFY_INTERVAL_SEC = int(os.environ.get("CINEKIVE_LICENSE_REVERIFY_SEC", str(14 * 24 * 3600)))

# Offline Pro grace after last successful verify — then Pro tools lock; Free stays.
OFFLINE_GRACE_SEC = int(os.environ.get("CINEKIVE_LICENSE_GRACE_SEC", str(14 * 24 * 3600)))

GUMROAD_VERIFY_URL = "https://api.gumroad.com/v2/licenses/verify"


def _split_env(name: str) -> list[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def configured_products() -> list[dict[str, str]]:
    """Return product identity dicts for verify attempts (permalink and/or id)."""
    permalinks = _split_env("GUMROAD_PRODUCT_PERMALINK")
    ids = _split_env("GUMROAD_PRODUCT_ID")
    # Defaults from known listing slug when nothing configured (dev / docs).
    if not permalinks and not ids:
        permalinks = ["cinekive-pro", "cinekive-pro-annual"]
    out: list[dict[str, str]] = []
    for p in permalinks:
        out.append({"product_permalink": p})
    for i in ids:
        out.append({"product_id": i})
    return out


def gumroad_configured() -> bool:
    return bool(_split_env("GUMROAD_PRODUCT_PERMALINK") or _split_env("GUMROAD_PRODUCT_ID"))


async def verify_license_key(
    license_key: str,
    *,
    increment_uses: bool,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """
    POST Gumroad licenses/verify.

    Returns dict with keys: success, uses, purchase, message, product_ref
    """
    key = license_key.strip()
    access_token = (os.environ.get("GUMROAD_ACCESS_TOKEN") or "").strip()
    products = configured_products()
    own_client = client is None
    if own_client:
        client = httpx.AsyncClient(timeout=20.0)
    assert client is not None

    last_message = "License verification failed"
    try:
        for prod in products:
            form: dict[str, str] = {
                "license_key": key,
                "increment_uses_count": "true" if increment_uses else "false",
            }
            form.update(prod)
            if access_token:
                form["access_token"] = access_token
            r = await client.post(GUMROAD_VERIFY_URL, data=form)
            data = r.json() if r.content else {}
            if r.status_code == 200 and data.get("success"):
                uses = data.get("uses")
                try:
                    uses_n = int(uses) if uses is not None else 0
                except (TypeError, ValueError):
                    uses_n = 0
                return {
                    "success": True,
                    "uses": uses_n,
                    "purchase": data.get("purchase") or {},
                    "message": None,
                    "product_ref": prod,
                    "raw": data,
                }
            last_message = str(
                data.get("message") or data.get("error") or last_message
            )
        return {
            "success": False,
            "uses": 0,
            "purchase": {},
            "message": last_message,
            "product_ref": None,
            "raw": {},
        }
    finally:
        if own_client:
            await client.aclose()


def device_limit_exceeded_message(uses: int, limit: int = DEVICE_LIMIT) -> str:
    return (
        f"This Pro license is already active on {uses} device"
        f"{'s' if uses != 1 else ''} (limit is {limit} per subscription). "
        f"Deactivate Pro on another machine under Settings → Cinekive Pro, "
        f"reset uses in your Gumroad library, or email cinekive@agentmail.to "
        f"for Enterprise seats."
    )
