"""Cinekive Free vs Pro entitlements.

Open-core model:
- Default tier is ``free`` with soft feature gates — including source builds.
- Pro unlocks only via ``license.json``: a Gumroad activation or a signed
  14-day trial key. There is no environment-variable path to Pro.
- ``CINEKIVE_TIER=pro`` is honoured only when ``CINEKIVE_ALLOW_DEV_LICENSE`` is
  explicitly enabled, which packaged builds hard-set to ``false``.

Gating is client-side by nature: anyone can patch a local checkout. The point is
that a plain ``git clone && build`` yields Free, so Pro is a deliberate act
rather than the default.
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

APP_VERSION = "0.5.3"

PRO_FEATURES: tuple[str, ...] = (
    "archive_mirrors",
    "continuous_enrich",
    "cloud_vlm",
    "batch_export",
    "board_export",
    "moodboard",
    "folder_watcher",
    "share_tunnel",
    "global_dedupe",
    "agent_api",
    "mcp_server",
    "unlimited_projects",
    "no_promo",
    # BYO-key image generation from a reference still (not craft tagging)
    "image_generate",
)

FREE_FEATURES: tuple[str, ...] = (
    "search",
    "ingest",
    "single_export",
    "lan_access",
    "manual_enrich",
)

FREE_MAX_PROJECTS = 3

# Offline Pro grace / re-verify cadence — see gumroad_license.py (defaults: 14 days).
try:
    from cinearchive.services.gumroad_license import (
        DEVICE_LIMIT,
        OFFLINE_GRACE_SEC,
        REVERIFY_INTERVAL_SEC,
    )
except Exception:  # pragma: no cover
    DEVICE_LIMIT = 3
    OFFLINE_GRACE_SEC = 14 * 24 * 3600
    REVERIFY_INTERVAL_SEC = 14 * 24 * 3600

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


def _dev_license_allowed() -> bool:
    """Env-var Pro is opt-in for local development only.

    Packaged builds set this to "false" (see desktop launcher/engine-native), so
    a released installer can never be unlocked with CINEKIVE_TIER=pro.
    """
    return (os.environ.get("CINEKIVE_ALLOW_DEV_LICENSE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _env_tier() -> str | None:
    raw = (os.environ.get("CINEKIVE_TIER") or "").strip().lower()
    if raw == "pro" and not _dev_license_allowed():
        # Downgrading a repo checkout to Free is the whole point of the gate.
        return "free"
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
                pass  # fall through — bad signature
            else:
                source = str(doc.get("source") or "")
                # Trial keys: absolute expiry + trusted time (not local-clock grace alone).
                if source == "trial":
                    from cinearchive.services import trial_license as trial

                    key = str(doc.get("licenseKey") or "")
                    check = trial.validate_trial_key(
                        key,
                        settings=settings,
                        allow_burned_same_machine=True,
                    )
                    public = _public_license(doc)
                    public["expires_at"] = check.get("expires_at") or doc.get("expiresAt")
                    public["trial"] = True
                    if not check.get("ok"):
                        return "free", {
                            "source": "trial_invalid",
                            "features": list(FREE_FEATURES),
                            "license": public,
                            "needs_reverify": False,
                            "grace_expired": True,
                            "trial_expired": True,
                            "error": check.get("error"),
                            "time_source": check.get("time_source"),
                        }
                    return "pro", {
                        "source": "trial",
                        "features": list(PRO_FEATURES),
                        "license": public,
                        "needs_reverify": False,
                        "grace_expired": False,
                        "trial_expires_at": check.get("expires_at"),
                        "time_source": check.get("time_source"),
                        "device_limit": 1,
                    }

                verified_at = float(doc.get("verifiedAt") or doc.get("activatedAt") or 0)
                # Prefer trusted time for grace (same probes as trials) so clock rollback
                # cannot quietly extend offline Pro.
                try:
                    from cinearchive.services import trial_license as trial

                    now, _ts = trial.trusted_now(settings)
                except Exception:
                    now = time.time()
                age = (now - verified_at) if verified_at else 0
                public = _public_license(doc)
                # Past offline grace without a successful online verify → Pro tools lock.
                if verified_at and age > OFFLINE_GRACE_SEC:
                    return "free", {
                        "source": "license_grace_expired",
                        "features": list(FREE_FEATURES),
                        "license": public,
                        "needs_reverify": True,
                        "grace_expired": True,
                        "grace_sec": OFFLINE_GRACE_SEC,
                        "reverify_interval_sec": REVERIFY_INTERVAL_SEC,
                        "device_limit": int(doc.get("deviceLimit") or DEVICE_LIMIT),
                    }
                needs_reverify = bool(verified_at and age >= REVERIFY_INTERVAL_SEC)
                return "pro", {
                    "source": "license_file",
                    "features": list(PRO_FEATURES),
                    "license": public,
                    "needs_reverify": needs_reverify,
                    "grace_expired": False,
                    "grace_sec": OFFLINE_GRACE_SEC,
                    "reverify_interval_sec": REVERIFY_INTERVAL_SEC,
                    "device_limit": int(doc.get("deviceLimit") or DEVICE_LIMIT),
                }

    # Free is the default everywhere, including source builds and plain Docker.
    # Pro requires a real license.json (Gumroad activation or signed trial key);
    # the previous "unset enforce flag means unlocked" path gave the public repo
    # Pro for free, so it is gone. Local dev opts in via CINEKIVE_ALLOW_DEV_LICENSE.
    if _dev_license_allowed() and (os.environ.get("CINEKIVE_TIER") or "").strip().lower() == "pro":
        return "pro", {"source": "dev_override", "features": list(PRO_FEATURES)}

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
        "uses_count": doc.get("usesCount"),
        "device_limit": doc.get("deviceLimit") or DEVICE_LIMIT,
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
        "support_email": os.environ.get("CINEKIVE_SUPPORT_EMAIL", "cinekive@agentmail.to"),
        "version": APP_VERSION,
        "device_limit": DEVICE_LIMIT,
        "grace_sec": OFFLINE_GRACE_SEC,
        "reverify_interval_sec": REVERIFY_INTERVAL_SEC,
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
            "message": f"'{feature}' requires Cinekive Pro. Free Desktop keeps working — only Pro tools are locked.",
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
