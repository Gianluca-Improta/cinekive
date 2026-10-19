"""Polite JSON client for museum APIs."""

from __future__ import annotations

import time
from typing import Any

import httpx

UA = "Cinekive/0.6 (design visual archive; local harvest; respectful rate limits)"
_last_call = 0.0
MIN_INTERVAL = 0.12


def get_json(url: str, params: dict[str, Any] | None = None, timeout: float = 30.0) -> dict[str, Any]:
    global _last_call
    wait = MIN_INTERVAL - (time.monotonic() - _last_call)
    if wait > 0:
        time.sleep(wait)
    with httpx.Client(headers={"User-Agent": UA, "Accept": "application/json"}, timeout=timeout, follow_redirects=True) as client:
        response = client.get(url, params=params)
        _last_call = time.monotonic()
        response.raise_for_status()
        data = response.json()
        if not isinstance(data, dict):
            return {"_list": data} if isinstance(data, list) else {"_value": data}
        return data
