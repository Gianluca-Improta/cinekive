"""Cinematic taxonomy — EyeCandy-style techniques + shot DNA vocabularies."""

from __future__ import annotations

from fastapi import APIRouter

from cinearchive.pipelines.taxonomy import taxonomy_payload

router = APIRouter(tags=["taxonomy"])


@router.get("/taxonomy")
async def get_taxonomy() -> dict:
    return taxonomy_payload()
