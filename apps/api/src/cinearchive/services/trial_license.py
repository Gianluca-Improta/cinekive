"""Signed 14-day trial Pro keys — absolute expiry + trusted network time.

Design notes (honest DRM for an open-core app):
- Expiry is an absolute Unix timestamp in the token (not "14 days from first open").
- Validation prefers trusted HTTP Date (Gumroad / Cloudflare / WorldTime) so setting
  the PC clock backward does not extend Pro. If all probes fail, we fall back to
  local time but refuse when local time is *behind* the last trusted sample we stored.
- Each key has a unique jti. After activation, the jti is burned into a local ledger
  so the same key cannot be re-activated after deactivate on that machine.
- Cross-machine key sharing within the window is still possible without a central
  activation server — use Gumroad for paid seats; these trials are for testers you trust.

Mint only with CINEKIVE_TRIAL_SECRET (never ship the mint secret to clients).
Packaged apps need the *same* verify secret via CINEKIVE_TRIAL_SECRET or
CINEKIVE_LICENSE_SECRET in the release environment.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.request
from pathlib import Path
from typing import Any
from uuid import uuid4

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

PREFIX = "CK-TRIAL-"
DEFAULT_DAYS = 14
# If local clock is more than this behind last trusted sample → treat as tamper.
CLOCK_ROLLBACK_SLACK_SEC = 6 * 3600

_TIME_PROBES = (
    "https://api.gumroad.com/v2/products",  # may 401; Date header still useful
    "https://www.cloudflare.com/cdn-cgi/trace",
    "https://worldtimeapi.org/api/timezone/Etc/UTC",
)


def _trial_secret() -> bytes:
    raw = (os.environ.get("CINEKIVE_TRIAL_SECRET") or "").strip()
    if not raw:
        # Dev-only fallback — packaged builds must set CINEKIVE_TRIAL_SECRET.
        raw = "cinekive-trial-v1-change-me-before-shipping"
    return raw.encode("utf-8")


def production_secret_configured() -> bool:
    raw = (os.environ.get("CINEKIVE_TRIAL_SECRET") or "").strip()
    return bool(raw) and raw != "cinekive-trial-v1-change-me-before-shipping"

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(payload_b64: str) -> str:
    return hmac.new(_trial_secret(), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()


def is_trial_key(key: str) -> bool:
    return key.strip().upper().startswith(PREFIX)


def mint_trial(
    *,
    email: str,
    days: int = DEFAULT_DAYS,
    label: str | None = None,
    now: float | None = None,
) -> dict[str, Any]:
    """Create a one-shot trial key. Returns {key, email, jti, expires_at, ...}."""
    now = float(now if now is not None else time.time())
    days = max(1, min(int(days), 90))
    jti = uuid4().hex
    payload = {
        "v": 1,
        "kind": "trial",
        "jti": jti,
        "email": (email or "").strip().lower() or f"tester-{jti[:8]}@trial.local",
        "iat": int(now),
        "exp": int(now + days * 86400),
        "label": (label or "").strip() or None,
        "nonce": secrets.token_hex(8),
    }
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
    key = f"{PREFIX}{payload_b64}.{_sign(payload_b64)}"
    return {
        "key": key,
        "email": payload["email"],
        "jti": jti,
        "issued_at": payload["iat"],
        "expires_at": payload["exp"],
        "days": days,
        "label": payload["label"],
    }


def parse_trial_key(key: str) -> dict[str, Any] | None:
    raw = key.strip()
    if not is_trial_key(raw):
        return None
    body = raw[len(PREFIX) :]
    if "." not in body:
        return None
    payload_b64, sig = body.rsplit(".", 1)
    expected = _sign(payload_b64)
    if not hmac.compare_digest(expected, sig.lower()):
        return None
    try:
        data = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("kind") != "trial" or not data.get("jti"):
        return None
    return data


def _ledger_path(settings: Settings | None = None) -> Path:
    env = os.environ.get("CINEKIVE_TRIAL_LEDGER", "").strip()
    if env:
        return Path(env)
    from cinearchive.services.entitlements import license_file_path

    return license_file_path(settings).parent / "trial_ledger.json"


def _trusted_cache_path(settings: Settings | None = None) -> Path:
    return _ledger_path(settings).parent / "trusted_time.json"


def load_ledger(settings: Settings | None = None) -> dict[str, Any]:
    path = _ledger_path(settings)
    if not path.is_file():
        return {"burned": {}, "version": 1}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"burned": {}, "version": 1}
    except Exception:
        return {"burned": {}, "version": 1}


def burn_jti(jti: str, *, settings: Settings | None = None, meta: dict[str, Any] | None = None) -> None:
    path = _ledger_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    ledger = load_ledger(settings)
    burned = dict(ledger.get("burned") or {})
    burned[jti] = {
        "burned_at": time.time(),
        **(meta or {}),
    }
    ledger["burned"] = burned
    ledger["version"] = 1
    path.write_text(json.dumps(ledger, indent=2), encoding="utf-8")


def is_burned(jti: str, settings: Settings | None = None) -> bool:
    return jti in (load_ledger(settings).get("burned") or {})


def fetch_trusted_unix_time(timeout: float = 4.0) -> float | None:
    """Best-effort trusted UTC seconds from HTTP Date / JSON APIs."""
    for url in _TIME_PROBES:
        try:
            req = urllib.request.Request(url, method="GET", headers={"User-Agent": "Cinekive/trial"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                # Prefer Date header (available even on 4xx)
                date_hdr = resp.headers.get("Date")
                if date_hdr:
                    from email.utils import parsedate_to_datetime

                    dt = parsedate_to_datetime(date_hdr)
                    return dt.timestamp()
                raw = resp.read(2000).decode("utf-8", errors="ignore")
                if "unixtime" in raw:
                    data = json.loads(raw)
                    if isinstance(data.get("unixtime"), (int, float)):
                        return float(data["unixtime"])
        except Exception as exc:
            logger.debug("trusted time probe %s failed: %s", url, exc)
            continue
    return None


def remember_trusted_time(ts: float, settings: Settings | None = None) -> None:
    path = _trusted_cache_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    prev = 0.0
    if path.is_file():
        try:
            prev = float(json.loads(path.read_text(encoding="utf-8")).get("unix") or 0)
        except Exception:
            prev = 0.0
    # Monotonic-ish: never store an older trusted sample (blocks rollback via cache edit alone
    # only helps when combined with signature on license — still store max).
    unix = max(prev, float(ts))
    path.write_text(json.dumps({"unix": unix, "saved_at_local": time.time()}), encoding="utf-8")


def last_trusted_time(settings: Settings | None = None) -> float:
    path = _trusted_cache_path(settings)
    if not path.is_file():
        return 0.0
    try:
        return float(json.loads(path.read_text(encoding="utf-8")).get("unix") or 0)
    except Exception:
        return 0.0


def trusted_now(settings: Settings | None = None) -> tuple[float, str]:
    """
    Return (now_unix, source).

    Prefers network time. Detects local clock rolled behind last trusted sample.
    """
    local = time.time()
    cached = last_trusted_time(settings)
    remote = fetch_trusted_unix_time()
    if remote is not None:
        remember_trusted_time(remote, settings)
        return max(remote, cached), "network"
    if cached and local + CLOCK_ROLLBACK_SLACK_SEC < cached:
        # Local clock behind previously observed trusted time → likely tamper.
        return cached, "cached_reject_rollback"
    if cached:
        return max(local, cached), "local+cache"
    return local, "local"


def validate_trial_key(
    key: str,
    *,
    settings: Settings | None = None,
    allow_burned_same_machine: bool = False,
    machine_id: str | None = None,
) -> dict[str, Any]:
    """
    Validate trial token.

    Returns {ok, error?, payload?, now?, time_source?, expires_at?}.
    """
    payload = parse_trial_key(key)
    if not payload:
        return {"ok": False, "error": "invalid_trial_signature", "message": "Invalid or forged trial key."}

    jti = str(payload["jti"])
    if is_burned(jti, settings) and not allow_burned_same_machine:
        return {
            "ok": False,
            "error": "trial_spent",
            "message": "This trial key was already used. Ask for a regenerated key.",
            "jti": jti,
        }

    now, source = trusted_now(settings)
    if source == "cached_reject_rollback":
        return {
            "ok": False,
            "error": "clock_tamper",
            "message": (
                "System clock looks rolled back vs last trusted time. "
                "Connect to the internet so Cinekive can re-check time, or fix the clock."
            ),
            "jti": jti,
        }

    exp = int(payload.get("exp") or 0)
    if now >= exp:
        return {
            "ok": False,
            "error": "trial_expired",
            "message": "This 14-day trial has expired.",
            "jti": jti,
            "expires_at": exp,
            "now": now,
            "time_source": source,
        }

    return {
        "ok": True,
        "payload": payload,
        "jti": jti,
        "expires_at": exp,
        "now": now,
        "time_source": source,
        "email": payload.get("email"),
        "machine_id": machine_id,
    }
