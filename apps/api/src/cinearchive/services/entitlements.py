"""Cinekive Free vs Pro entitlements.

Open-core model:
- Default tier is ``free`` with soft feature gates.
- Pro unlocks via ``license.json`` (Gumroad activation) or ``CINEKIVE_TIER=pro``.
- Self-built installs can set ``CINEKIVE_TIER=pro`` (honor system).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from cinearchive.config import Settings

APP_VERSION = "0.5.0"

PRO_FEATURES: tuple[str, ...] = (
    "archive_mirrors",
    "continuous_enrich",
    "batch_export",
    "share_tunnel",
    "global_dedupe",
    "agent_api",
    "unlimited_projects",
    "no_promo",
)

FREE_FEATURES: tuple[str, ...] = (
    "search",
    "ingest",
    "canvas_basic",
    "single_export",
    "lan_access",
    "manual_enrich",
)

FREE_MAX_PROJECTS = 3
OFFLINE_GRACE_SEC = 30 * 24 * 3600  # 30 days after last verify

# Not DRM — keeps casual license.json edits from flipping tier without a key.
_SIGNING_SECRET = os.environ.get(
    "CINEKIVE_LICENSE_SECRET",
    "cinekive-pro-v1-open-core-not-a-vault",
).encode("utf-8")


def _license_paths(settings: Settings | None = None) -> list[Path]:
    paths: list[Path] = []
    env = os.environ.get("CINEKIVE_LICENSE_PATH", "").strip()
    if env:
        paths.append(Path(env))
    # Desktop default locations (API may run in Docker with host mount, or native)
    appdata = os.environ.get("APPDATA") or os.environ.get("CINEKIVE_USER_DATA")
    if appdata:
        root = Path(appdata)
        if root.name.lower() != "cinekive":
            root = root / "Cinekive"
        paths.append(root / "license.json")
    home = Path.home()
    paths.append(home / "Library" / "Application Support" / "Cinekive" / "license.json")
    paths.append(home / ".config" / "Cinekive" / "license.json")
    if settings and settings.models_dir:
        # Fallback next to models (native engine data dir sibling)
        try:
            data = Path(settings.models_dir).resolve().parent
            paths.append(data.parent / "license.json")
            paths.append(data / "license.json")
        except Exception:
            pass
    # Dedupe
    seen: set[str] = set()
    out: list[Path] = []
    for p in paths:
        key = str(p)
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def license_file_path(settings: Settings | None = None) -> Path:
    for p in _license_paths(settings):
        if p.is_file():
            return p
    # Prefer write target
    candidates = _license_paths(settings)
    return candidates[0] if candidates else Path("license.json")


def _sign_payload(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hmac.new(_SIGNING_SECRET, body, hashlib.sha256).hexdigest()


def verify_signature(doc: dict[str, Any]) -> bool:
    sig = doc.get("signature")
    if not sig or not isinstance(sig, str):
        return False
    payload = {k: v for k, v in doc.items() if k != "signature"}
    expected = _sign_payload(payload)
    return hmac.compare_digest(expected, sig)


def sign_document(payload: dict[str, Any]) -> dict[str, Any]:
    doc = dict(payload)
    doc["signature"] = _sign_payload(doc)
    return doc


def _read_license_doc(settings: Settings | None = None) -> dict[str, Any] | None:
    for path in _license_paths(settings):
        if not path.is_file():
            continue
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(doc, dict):
                return doc
        except Exception:
            continue
    return None


def _env_tier() -> str | None:
    raw = (os.environ.get("CINEKIVE_TIER") or "").strip().lower()
    if raw in ("pro", "free"):
        return raw
    return None


def resolve_tier(settings: Settings | None = None) -> tuple[str, dict[str, Any]]:
    """Return (tier, meta)."""
    env_tier = _env_tier()
    if env_tier == "pro":
        return "pro", {"source": "env", "features": list(PRO_FEATURES)}
    if env_tier == "free":
        return "free", {"source": "env", "features": list(FREE_FEATURES)}

    doc = _read_license_doc(settings)
    if doc:
        tier = str(doc.get("tier") or "free").lower()
        if tier == "pro":
            if doc.get("signature") and not verify_signature(doc):
                pass  # fall through
            else:
                verified_at = float(doc.get("verifiedAt") or doc.get("activatedAt") or 0)
                now = time.time()
                needs_reverify = bool(verified_at and (now - verified_at) > OFFLINE_GRACE_SEC)
                return "pro", {
                    "source": "license_file",
                    "features": list(PRO_FEATURES),
                    "license": _public_license(doc),
                    "needs_reverify": needs_reverify,
                }

    # Packaged desktop sets CINEKIVE_LICENSE_ENFORCE=true → free until activated.
    # Self-built / plain Docker leave it unset → unlocked (honor system).
    enforce = (os.environ.get("CINEKIVE_LICENSE_ENFORCE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    if not enforce:
        return "pro", {"source": "self_built", "features": list(PRO_FEATURES)}

    return "free", {"source": "default", "features": list(FREE_FEATURES)}


def _public_license(doc: dict[str, Any]) -> dict[str, Any]:
    key = str(doc.get("licenseKey") or "")
    hint = ""
    if len(key) >= 8:
        hint = f"{key[:4]}…{key[-4:]}"
    elif key:
        hint = "••••"
    return {
        "email": doc.get("email"),
        "key_hint": hint,
        "activated_at": doc.get("activatedAt"),
        "verified_at": doc.get("verifiedAt"),
        "product": doc.get("product") or "Cinekive Pro",
    }


def entitlements_payload(settings: Settings | None = None) -> dict[str, Any]:
    tier, meta = resolve_tier(settings)
    features = list(PRO_FEATURES) if tier == "pro" else list(FREE_FEATURES)
    return {
        "tier": tier,
        "is_pro": tier == "pro",
        "features": features,
        "limits": {
            "max_projects": None if tier == "pro" else FREE_MAX_PROJECTS,
        },
        "upgrade_url": os.environ.get(
            "CINEKIVE_PRO_URL",
            "https://gianlucaimprota.gumroad.com/l/cinekive-pro",
        ),
        "price_usd": 19,
        "early_bird_usd": 12,
        "support_email": os.environ.get("CINEKIVE_SUPPORT_EMAIL", "hello@gianlucaimprota.com"),
        "version": APP_VERSION,
        **{k: v for k, v in meta.items() if k != "features"},
    }


def has_feature(feature: str, settings: Settings | None = None) -> bool:
    tier, meta = resolve_tier(settings)
    feats = set(meta.get("features") or [])
    if tier == "pro":
        return feature in PRO_FEATURES or feature in FREE_FEATURES
    return feature in feats or feature in FREE_FEATURES


def require_feature(feature: str, settings: Settings | None = None) -> None:
    if has_feature(feature, settings):
        return
    raise HTTPException(
        status_code=402,
        detail={
            "error": "pro_required",
            "feature": feature,
            "message": f"'{feature}' requires Cinekive Pro ($19 one-time).",
            "upgrade_url": entitlements_payload(settings)["upgrade_url"],
        },
    )


def write_license(doc: dict[str, Any], settings: Settings | None = None) -> Path:
    path = license_file_path(settings)
    # Prefer user-data style path for writes
    write_path = _license_paths(settings)[0]
    write_path.parent.mkdir(parents=True, exist_ok=True)
    signed = sign_document(doc)
    write_path.write_text(json.dumps(signed, indent=2), encoding="utf-8")
    return write_path


def clear_license(settings: Settings | None = None) -> bool:
    removed = False
    for path in _license_paths(settings):
        if path.is_file():
            try:
                path.unlink()
                removed = True
            except Exception:
                pass
    return removed
