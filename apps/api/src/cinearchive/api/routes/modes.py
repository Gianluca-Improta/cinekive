"""Mode routes — the vocabulary packs the UI switches between."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from cinearchive.modes.registry import all_modes_payload, mode_payload

router = APIRouter(prefix="/modes", tags=["modes"])


@router.get("")
async def list_modes() -> dict[str, Any]:
    """All available modes and the adapters that can serve them."""
    return all_modes_payload()


@router.get("/{mode_id}")
async def get_mode(mode_id: str) -> dict[str, Any]:
    """One mode pack. Unknown ids fall back to the cinematic pack."""
    return mode_payload(mode_id)
