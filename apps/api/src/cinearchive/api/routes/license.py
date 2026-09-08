"""License / Pro activation routes — Gumroad verify, no Cinekive accounts."""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cinearchive.api.deps import get_settings
from cinearchive.config import Settings
from cinearchive.services import entitlements as ent
from cinearchive.services import gumroad_license as gum

router = APIRouter(prefix="/license", tags=["license"])


class ActivateBody(BaseModel):
    license_key: str = Field(..., min_length=4)
    email: str | None = None
    machine_id: str | None = None


class DeactivateBody(BaseModel):
    confirm: bool = False


class ReverifyBody(BaseModel):
    machine_id: str | None = None


def _merge_machine_ids(existing: list[Any] | None, machine_id: str | None) -> list[str]:
    ids = [str(x) for x in (existing or []) if x]
    if machine_id and machine_id not in ids:
        ids.append(machine_id)
    return ids


def _machine_already_registered(doc: dict[str, Any] | None, machine_id: str | None) -> bool:
    if not doc or not machine_id:
        return False
    ids = [str(x) for x in (doc.get("machineIds") or []) if x]
    return machine_id in ids and str(doc.get("licenseKey") or "") != ""


@router.get("/entitlements")
async def get_entitlements(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    # Opportunistic online re-check when past interval (does not consume device uses).
    doc = ent._read_license_doc(settings)
    if (
        doc
        and str(doc.get("tier") or "").lower() == "pro"
        and doc.get("licenseKey")
        and doc.get("source") == "gumroad"
        and gum.gumroad_configured()
    ):
        verified_at = float(doc.get("verifiedAt") or doc.get("activatedAt") or 0)
        if verified_at and (time.time() - verified_at) >= gum.REVERIFY_INTERVAL_SEC:
            try:
                result = await gum.verify_license_key(
                    str(doc["licenseKey"]),
                    increment_uses=False,
                )
                if result.get("success"):
                    doc["verifiedAt"] = time.time()
                    doc["usesCount"] = result.get("uses")
                    purchase = result.get("purchase") or {}
                    if purchase.get("email"):
                        doc["email"] = purchase.get("email")
                    if purchase.get("refunded") or purchase.get("chargebacked"):
                        # Treat as invalid — clear Pro
                        ent.clear_license(settings)
                    else:
                        ent.write_license(doc, settings)
            except Exception:
                pass  # stay on cached verifiedAt / grace logic
    return ent.entitlements_payload(settings)


@router.post("/reverify")
async def reverify_license(
    body: ReverifyBody | None = None,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Re-check Gumroad without incrementing uses (online keepalive)."""
    body = body or ReverifyBody()
    doc = ent._read_license_doc(settings)
    if not doc or str(doc.get("tier") or "").lower() != "pro" or not doc.get("licenseKey"):
        return {"ok": False, "error": "no_license", "message": "No Pro license on this machine."}

    if doc.get("source") == "dev":
        doc["verifiedAt"] = time.time()
        ent.write_license(doc, settings)
        return {"ok": True, "entitlements": ent.entitlements_payload(settings)}

    if doc.get("source") == "trial":
        from cinearchive.services import trial_license as trial

        check = trial.validate_trial_key(
            str(doc.get("licenseKey") or ""),
            settings=settings,
            allow_burned_same_machine=True,
            machine_id=body.machine_id,
        )
        if not check.get("ok"):
            if check.get("error") in {"trial_expired", "clock_tamper"}:
                ent.clear_license(settings)
            return {
                "ok": False,
                "error": check.get("error"),
                "message": check.get("message"),
                "entitlements": ent.entitlements_payload(settings),
            }
        doc["verifiedAt"] = check["now"]
        doc["expiresAt"] = float(check["expires_at"])
        doc["timeSource"] = check.get("time_source")
        if body.machine_id:
            doc["machineIds"] = _merge_machine_ids(doc.get("machineIds"), body.machine_id)
        ent.write_license(doc, settings)
        return {
            "ok": True,
            "entitlements": ent.entitlements_payload(settings),
            "trial": True,
            "expires_at": check["expires_at"],
            "time_source": check.get("time_source"),
        }

    if not gum.gumroad_configured():
        if _license_enforce():
            return {
                "ok": False,
                "error": "gumroad_unconfigured",
                "message": "Cannot re-verify: Gumroad is not configured on this build.",
                "entitlements": ent.entitlements_payload(settings),
            }
        doc["verifiedAt"] = time.time()
        ent.write_license(doc, settings)
        return {"ok": True, "entitlements": ent.entitlements_payload(settings), "warning": "gumroad_unconfigured"}

    try:
        result = await gum.verify_license_key(str(doc["licenseKey"]), increment_uses=False)
    except Exception as exc:
        return {
            "ok": False,
            "error": "verify_unreachable",
            "message": f"Could not reach Gumroad ({exc}). Pro stays active until the offline grace window ends.",
            "entitlements": ent.entitlements_payload(settings),
            "grace_sec": gum.OFFLINE_GRACE_SEC,
        }

    if not result.get("success"):
        return {
            "ok": False,
            "error": "invalid_license",
            "message": result.get("message") or "License is no longer valid.",
            "entitlements": ent.entitlements_payload(settings),
        }

    purchase = result.get("purchase") or {}
    if purchase.get("refunded") or purchase.get("chargebacked"):
        ent.clear_license(settings)
        return {
            "ok": False,
            "error": "license_revoked",
            "message": "This purchase was refunded or charged back. Pro tools are locked; Free Desktop still works.",
            "entitlements": ent.entitlements_payload(settings),
        }

    doc["verifiedAt"] = time.time()
    doc["usesCount"] = result.get("uses")
    if purchase.get("email"):
        doc["email"] = purchase.get("email")
    if body.machine_id:
        doc["machineIds"] = _merge_machine_ids(doc.get("machineIds"), body.machine_id)
    ent.write_license(doc, settings)
    return {"ok": True, "entitlements": ent.entitlements_payload(settings), "uses": result.get("uses")}


def _license_enforce() -> bool:
    return (os.environ.get("CINEKIVE_LICENSE_ENFORCE") or "").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def _dev_license_allowed() -> bool:
    # When packaged (enforce on), require explicit opt-in for DEV keys.
    default = "false" if _license_enforce() else "true"
    return os.environ.get("CINEKIVE_ALLOW_DEV_LICENSE", default).lower() in (
        "1",
        "true",
        "yes",
    )


@router.post("/activate")
async def activate_license(
    body: ActivateBody,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Activate Cinekive Pro with a Gumroad license key (or offline signed / dev key)."""
    key = body.license_key.strip()
    email = (body.email or "").strip() or None
    machine_id = (body.machine_id or "").strip() or None
    enforce = _license_enforce()

    # Dev / honor-system unlock
    if key.upper() in {"CINEKIVE-DEV-PRO", "DEV-PRO"} and _dev_license_allowed():
        doc = {
            "tier": "pro",
            "licenseKey": key,
            "email": email or "dev@local",
            "product": "Cinekive Pro",
            "activatedAt": time.time(),
            "verifiedAt": time.time(),
            "machineIds": [machine_id] if machine_id else [],
            "source": "dev",
            "usesCount": 0,
            "deviceLimit": gum.DEVICE_LIMIT,
        }
        path = ent.write_license(doc, settings)
        return {"ok": True, "entitlements": ent.entitlements_payload(settings), "path": str(path)}

    # Signed 14-day trials (absolute expiry + trusted network time)
    from cinearchive.services import trial_license as trial

    if trial.is_trial_key(key):
        if enforce and not trial.production_secret_configured():
            return {
                "ok": False,
                "error": "trial_secret_missing",
                "message": (
                    "Trial keys require CINEKIVE_TRIAL_SECRET in the packaged app. "
                    "Ask the maintainer to configure release secrets."
                ),
            }
        # First activation must see trusted network time when enforcing.
        if enforce:
            remote = trial.fetch_trusted_unix_time()
            if remote is None:
                return {
                    "ok": False,
                    "error": "trusted_time_required",
                    "message": "Connect to the internet once to activate a trial (trusted time check).",
                }
            trial.remember_trusted_time(remote, settings)

        existing = ent._read_license_doc(settings)
        same_trial = (
            existing
            and str(existing.get("licenseKey") or "") == key
            and str(existing.get("source") or "") == "trial"
        )
        check = trial.validate_trial_key(
            key,
            settings=settings,
            allow_burned_same_machine=bool(same_trial),
            machine_id=machine_id,
        )
        if not check.get("ok"):
            return {
                "ok": False,
                "error": check.get("error") or "invalid_trial",
                "message": check.get("message") or "Invalid trial key",
                "expires_at": check.get("expires_at"),
            }
        payload = check["payload"]
        jti = str(check["jti"])
        if not same_trial:
            trial.burn_jti(
                jti,
                settings=settings,
                meta={"email": payload.get("email"), "machine_id": machine_id},
            )
        doc = {
            "tier": "pro",
            "licenseKey": key,
            "email": email or payload.get("email"),
            "product": "Cinekive Pro Trial",
            "activatedAt": time.time(),
            "verifiedAt": check["now"],
            "expiresAt": float(check["expires_at"]),
            "machineIds": [machine_id] if machine_id else [],
            "source": "trial",
            "trialJti": jti,
            "usesCount": 1,
            "deviceLimit": 1,
            "timeSource": check.get("time_source"),
        }
        path = ent.write_license(doc, settings)
        return {
            "ok": True,
            "entitlements": ent.entitlements_payload(settings),
            "path": str(path),
            "trial": True,
            "expires_at": check["expires_at"],
            "time_source": check.get("time_source"),
        }

    existing = ent._read_license_doc(settings)
    already_here = (
        existing
        and str(existing.get("licenseKey") or "") == key
        and _machine_already_registered(existing, machine_id)
    )

    if not gum.gumroad_configured():
        if enforce:
            return {
                "ok": False,
                "error": "gumroad_unconfigured",
                "message": (
                    "This build cannot verify paid licenses (Gumroad not configured). "
                    "Use a CK-TRIAL-… key from the maintainer, or a release build with Gumroad wired."
                ),
            }
        # Self-hosted without Gumroad product — accept key for testing
        doc = {
            "tier": "pro",
            "licenseKey": key,
            "email": email,
            "product": "Cinekive Pro",
            "activatedAt": time.time(),
            "verifiedAt": time.time(),
            "machineIds": _merge_machine_ids(
                existing.get("machineIds") if existing and existing.get("licenseKey") == key else [],
                machine_id,
            ),
            "source": "manual",
            "usesCount": 0,
            "deviceLimit": gum.DEVICE_LIMIT,
        }
        path = ent.write_license(doc, settings)
        return {"ok": True, "entitlements": ent.entitlements_payload(settings), "path": str(path)}

    # Probe uses without consuming a seat when this machine is already registered.
    try:
        probe = await gum.verify_license_key(key, increment_uses=False)
    except Exception as exc:
        if existing and existing.get("licenseKey") == key and existing.get("tier") == "pro":
            # Network down — keep cached Pro; do not refresh verifiedAt (grace still applies)
            path = ent.license_file_path(settings)
            payload = ent.entitlements_payload(settings)
            payload["offline"] = True
            return {
                "ok": True,
                "entitlements": payload,
                "path": str(path),
                "warning": str(exc),
                "message": "Offline — using cached license until the 14-day grace window ends.",
            }
        return {
            "ok": False,
            "error": "verify_unreachable",
            "message": f"Could not reach Gumroad ({exc}). Check your connection and try again.",
        }

    if not probe.get("success"):
        return {
            "ok": False,
            "error": "invalid_license",
            "message": str(probe.get("message") or "Invalid license key"),
        }

    purchase = probe.get("purchase") or {}
    uses = int(probe.get("uses") or 0)
    if purchase.get("refunded") or purchase.get("chargebacked"):
        return {
            "ok": False,
            "error": "license_revoked",
            "message": "This purchase was refunded or charged back.",
        }

    if not already_here and uses >= gum.DEVICE_LIMIT:
        return {
            "ok": False,
            "error": "device_limit",
            "message": gum.device_limit_exceeded_message(uses, gum.DEVICE_LIMIT),
            "uses": uses,
            "device_limit": gum.DEVICE_LIMIT,
        }

    increment_done = False
    if not already_here:
        try:
            activated = await gum.verify_license_key(key, increment_uses=True)
        except Exception as exc:
            return {
                "ok": False,
                "error": "verify_unreachable",
                "message": f"Could not reach Gumroad to register this device ({exc}).",
            }
        if not activated.get("success"):
            return {
                "ok": False,
                "error": "invalid_license",
                "message": str(activated.get("message") or "Activation failed"),
            }
        uses = int(activated.get("uses") or uses + 1)
        purchase = activated.get("purchase") or purchase
        increment_done = True
        if uses > gum.DEVICE_LIMIT:
            return {
                "ok": False,
                "error": "device_limit",
                "message": gum.device_limit_exceeded_message(uses, gum.DEVICE_LIMIT),
                "uses": uses,
                "device_limit": gum.DEVICE_LIMIT,
            }

    gumroad_email = purchase.get("email") or email
    prior_ids = (
        existing.get("machineIds")
        if existing and str(existing.get("licenseKey") or "") == key
        else []
    )
    doc = {
        "tier": "pro",
        "licenseKey": key,
        "email": gumroad_email,
        "product": purchase.get("product_name") or "Cinekive Pro",
        "activatedAt": float(existing.get("activatedAt") or time.time())
        if existing and existing.get("licenseKey") == key
        else time.time(),
        "verifiedAt": time.time(),
        "machineIds": _merge_machine_ids(prior_ids, machine_id),
        "source": "gumroad",
        "purchase_id": purchase.get("id"),
        "usesCount": uses,
        "deviceLimit": gum.DEVICE_LIMIT,
        "incrementedOnActivate": increment_done,
    }
    path = ent.write_license(doc, settings)
    return {
        "ok": True,
        "entitlements": ent.entitlements_payload(settings),
        "path": str(path),
        "uses": uses,
        "device_limit": gum.DEVICE_LIMIT,
    }


@router.post("/deactivate")
async def deactivate_license(
    body: DeactivateBody,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not body.confirm:
        return {"ok": False, "error": "confirm_required"}
    ent.clear_license(settings)
    return {"ok": True, "entitlements": ent.entitlements_payload(settings)}
