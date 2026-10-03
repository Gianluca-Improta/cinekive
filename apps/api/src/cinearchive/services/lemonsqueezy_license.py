"""Lemon Squeezy license checks (no Cinekive accounts — key + instance only).

The license API is public: activate / validate / deactivate do not need the
store API key. Product allowlisting stops a key for a different Lemon product
from unlocking Cinekive.
"""

from __future__ import annotations

import os
from typing import Any

# Seat budget. Lemon's own activation_limit wins when the license returns one.
DEVICE_LIMIT = int(os.environ.get("CINEKIVE_LICENSE_DEVICE_LIMIT", "3"))

REVERIFY_INTERVAL_SEC = int(os.environ.get("CINEKIVE_LICENSE_REVERIFY_SEC", str(14 * 24 * 3600)))
OFFLINE_GRACE_SEC = int(os.environ.get("CINEKIVE_LICENSE_GRACE_SEC", str(14 * 24 * 3600)))

# Published store. Override with env if the listing moves.
DEFAULT_STORE_SLUG = "cinekive"
DEFAULT_PRODUCT_ID = "1346696"
# Published Lifetime variant (buy_now slug). Annual stays unset until that
# variant is a live $19/year subscription in the Lemon dashboard.
DEFAULT_LIFETIME_VARIANT_SLUG = "938df13e-96e3-406f-a56f-2a245b790ada"

ACTIVATE_URL = "https://api.lemonsqueezy.com/v1/licenses/activate"
VALIDATE_URL = "https://api.lemonsqueezy.com/v1/licenses/validate"
DEACTIVATE_URL = "https://api.lemonsqueezy.com/v1/licenses/deactivate"

_OK_STATUS = {"active", "inactive"}


def _split_env(name: str) -> list[str]:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


def allowed_product_ids() -> set[str]:
    ids = _split_env("LEMONSQUEEZY_PRODUCT_IDS") or _split_env("LEMONSQUEEZY_PRODUCT_ID")
    if not ids:
        ids = [DEFAULT_PRODUCT_ID]
    return set(ids)


def store_slug() -> str:
    return (os.environ.get("LEMONSQUEEZY_STORE_SLUG") or DEFAULT_STORE_SLUG).strip() or DEFAULT_STORE_SLUG


def checkout_url(kind: str = "lifetime") -> str:
    """Buy link. Annual uses LEMONSQUEEZY_VARIANT_ANNUAL when that variant is live."""
    override = (os.environ.get("CINEKIVE_PRO_URL") or "").strip()
    if kind == "annual":
        slug = (os.environ.get("LEMONSQUEEZY_VARIANT_ANNUAL") or "").strip()
        if slug:
            return f"https://{store_slug()}.lemonsqueezy.com/checkout/buy/{slug}"
        if override:
            return override
    slug = (os.environ.get("LEMONSQUEEZY_VARIANT_LIFETIME") or DEFAULT_LIFETIME_VARIANT_SLUG).strip()
    if slug:
        return f"https://{store_slug()}.lemonsqueezy.com/checkout/buy/{slug}"
    if override:
        return override
    return f"https://{store_slug()}.lemonsqueezy.com"


def lemonsqueezy_configured() -> bool:
    """License API needs no secret. Disable with CINEKIVE_LEMONSQUEEZY=off for forks."""
    flag = (os.environ.get("CINEKIVE_LEMONSQUEEZY") or "on").strip().lower()
    return flag not in {"0", "false", "off", "no"}


def device_limit_exceeded_message(uses: int, limit: int = DEVICE_LIMIT) -> str:
    return (
        f"This Pro license is already active on {uses} device"
        f"{'s' if uses != 1 else ''} (limit is {limit}). "
        f"Deactivate Pro on another machine under Settings → Cinekive Pro, "
        f"or email cinekive@agentmail.to for more seats."
    )


def _limit_from_license(license_key: dict[str, Any]) -> int:
    raw = license_key.get("activation_limit")
    try:
        n = int(raw) if raw is not None else 0
    except (TypeError, ValueError):
        n = 0
    if n > 0:
        return n
    return DEVICE_LIMIT


def _normalize(data: dict[str, Any], *, activated: bool | None = None) -> dict[str, Any]:
    license_key = data.get("license_key") or {}
    if not isinstance(license_key, dict):
        license_key = {}
    instance = data.get("instance") or {}
    if not isinstance(instance, dict):
        instance = {}
    meta = data.get("meta") or {}
    if not isinstance(meta, dict):
        meta = {}
    status = str(license_key.get("status") or "").lower()
    error = data.get("error")
    ok_flag = data.get("activated")
    if ok_flag is None:
        ok_flag = data.get("valid")
    if activated is not None:
        ok_flag = activated
    product_id = str(meta.get("product_id") or "")
    allowed = allowed_product_ids()
    product_ok = (not product_id) or (product_id in allowed)
    status_ok = status in _OK_STATUS or (ok_flag and not status)
    success = bool(ok_flag) and status_ok and product_ok and not error
    if status in {"expired", "disabled"}:
        success = False
        error = error or f"License is {status}."
    if product_id and not product_ok:
        success = False
        error = error or "This key is not for Cinekive Pro."
    try:
        uses = int(license_key.get("activation_usage") or 0)
    except (TypeError, ValueError):
        uses = 0
    return {
        "success": success,
        "uses": uses,
        "limit": _limit_from_license(license_key),
        "status": status,
        "message": None if success else str(error or "License verification failed"),
        "email": meta.get("customer_email"),
        "product_name": meta.get("product_name") or meta.get("variant_name") or "Cinekive Pro",
        "product_id": product_id or None,
        "variant_id": str(meta.get("variant_id") or "") or None,
        "variant_name": meta.get("variant_name"),
        "instance_id": instance.get("id"),
        "instance_name": instance.get("name"),
        "expires_at": license_key.get("expires_at"),
        "customer_id": meta.get("customer_id"),
        "order_id": meta.get("order_id"),
        "raw": data,
    }


async def _post(url: str, form: dict[str, str], client: Any) -> dict[str, Any]:
    r = await client.post(url, data=form)
    try:
        data = r.json() if r.content else {}
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    if r.status_code >= 400 and not data.get("error"):
        data["error"] = data.get("message") or f"Lemon Squeezy returned HTTP {r.status_code}"
        data["activated"] = False
        data["valid"] = False
    return data


async def activate_license_key(
    license_key: str,
    *,
    instance_name: str,
    client: Any | None = None,
) -> dict[str, Any]:
    """Create a Lemon instance. Each successful call consumes one activation."""
    import httpx

    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=20.0)
    assert client is not None
    try:
        data = await _post(
            ACTIVATE_URL,
            {"license_key": license_key.strip(), "instance_name": instance_name[:255] or "Cinekive"},
            client,
        )
        return _normalize(data, activated=bool(data.get("activated")))
    finally:
        if own:
            await client.aclose()


async def validate_license_key(
    license_key: str,
    *,
    instance_id: str,
    client: Any | None = None,
) -> dict[str, Any]:
    """Re-check an existing instance. Does not consume a new seat."""
    import httpx

    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=20.0)
    assert client is not None
    try:
        data = await _post(
            VALIDATE_URL,
            {"license_key": license_key.strip(), "instance_id": instance_id},
            client,
        )
        return _normalize(data, activated=bool(data.get("valid")))
    finally:
        if own:
            await client.aclose()


async def deactivate_license_key(
    license_key: str,
    *,
    instance_id: str,
    client: Any | None = None,
) -> dict[str, Any]:
    import httpx

    own = client is None
    if own:
        client = httpx.AsyncClient(timeout=20.0)
    assert client is not None
    try:
        data = await _post(
            DEACTIVATE_URL,
            {"license_key": license_key.strip(), "instance_id": instance_id},
            client,
        )
        deactivated = bool(data.get("deactivated"))
        return {
            "success": deactivated and not data.get("error"),
            "message": None if deactivated else str(data.get("error") or "Could not deactivate this device."),
            "raw": data,
        }
    finally:
        if own:
            await client.aclose()
