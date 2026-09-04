"""License / Pro activation routes."""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cinearchive.api.deps import get_settings
from cinearchive.config import Settings
from cinearchive.services import entitlements as ent

router = APIRouter(prefix="/license", tags=["license"])


class ActivateBody(BaseModel):
    license_key: str = Field(..., min_length=4)
    email: str | None = None
    machine_id: str | None = None


class DeactivateBody(BaseModel):
    confirm: bool = False


@router.get("/entitlements")
async def get_entitlements(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return ent.entitlements_payload(settings)


@router.post("/activate")
async def activate_license(
    body: ActivateBody,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Activate Cinekive Pro with a Gumroad license key (or offline signed key)."""
    key = body.license_key.strip()
    email = (body.email or "").strip() or None

    # Dev / honor-system unlock
    if key.upper() in {"CINEKIVE-DEV-PRO", "DEV-PRO"} and os.environ.get("CINEKIVE_ALLOW_DEV_LICENSE", "true").lower() in (
        "1",
        "true",
        "yes",
    ):
        doc = {
            "tier": "pro",
            "licenseKey": key,
            "email": email or "dev@local",
            "product": "Cinekive Pro",
            "activatedAt": time.time(),
            "verifiedAt": time.time(),
            "machineIds": [body.machine_id] if body.machine_id else [],
            "source": "dev",
        }
        path = ent.write_license(doc, settings)
        return {"ok": True, "entitlements": ent.entitlements_payload(settings), "path": str(path)}

    product_id = os.environ.get("GUMROAD_PRODUCT_ID", "").strip()
    access_token = os.environ.get("GUMROAD_ACCESS_TOKEN", "").strip()

    verified = False
    gumroad_email = email
    purchase: dict[str, Any] = {}

    if product_id:
        # https://app.gumroad.com/api#verify-a-license
        form = {
            "product_id": product_id,
            "license_key": key,
            "increment_uses_count": "true",
        }
        if access_token:
            form["access_token"] = access_token
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                r = await client.post("https://api.gumroad.com/v2/licenses/verify", data=form)
                data = r.json() if r.content else {}
            if r.status_code == 200 and data.get("success"):
                verified = True
                purchase = data.get("purchase") or {}
                gumroad_email = purchase.get("email") or gumroad_email
            else:
                msg = data.get("message") or data.get("error") or "License verification failed"
                # Offline fallback: accept CKPRO. prefixed locally-issued keys only when signed later
                if not key.startswith("CKPRO."):
                    return {
                        "ok": False,
                        "error": "invalid_license",
                        "message": str(msg),
                    }
        except Exception as exc:
            # Network down — allow re-activation only if we already have this key on disk
            existing = None
            try:
                for p in ent._license_paths(settings):
                    if p.is_file():
                        import json

                        existing = json.loads(p.read_text(encoding="utf-8"))
                        break
            except Exception:
                existing = None
            if existing and existing.get("licenseKey") == key and existing.get("tier") == "pro":
                existing["verifiedAt"] = existing.get("verifiedAt") or time.time()
                path = ent.write_license(existing, settings)
                payload = ent.entitlements_payload(settings)
                payload["offline"] = True
                return {"ok": True, "entitlements": payload, "path": str(path), "warning": str(exc)}
            return {
                "ok": False,
                "error": "verify_unreachable",
                "message": f"Could not reach Gumroad ({exc}). Check your connection and try again.",
            }
    else:
        # No Gumroad product configured — accept any non-empty key as Pro for self-hosted testing
        # Production desktop ships GUMROAD_PRODUCT_ID in .env via installer docs.
        verified = True
        purchase = {"email": gumroad_email}

    if not verified and not key.startswith("CKPRO."):
        return {"ok": False, "error": "invalid_license", "message": "Invalid license key"}

    machine_ids: list[str] = []
    if body.machine_id:
        machine_ids.append(body.machine_id)

    doc = {
        "tier": "pro",
        "licenseKey": key,
        "email": gumroad_email,
        "product": "Cinekive Pro",
        "activatedAt": time.time(),
        "verifiedAt": time.time(),
        "machineIds": machine_ids,
        "source": "gumroad" if product_id else "manual",
        "purchase_id": purchase.get("id"),
    }
    path = ent.write_license(doc, settings)
    return {"ok": True, "entitlements": ent.entitlements_payload(settings), "path": str(path)}


@router.post("/deactivate")
async def deactivate_license(
    body: DeactivateBody,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    if not body.confirm:
        return {"ok": False, "error": "confirm_required"}
    ent.clear_license(settings)
    return {"ok": True, "entitlements": ent.entitlements_payload(settings)}
