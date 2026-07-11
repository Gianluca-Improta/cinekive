"""Language / translation routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from cinearchive.api.deps import get_settings
from cinearchive.config import Settings
from cinearchive.services.language_service import languages_payload, translate_text

router = APIRouter(tags=["language"])


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    source_lang: str = Field(default="en", max_length=16)
    target_lang: str = Field(min_length=2, max_length=16)


class TranslateResponse(BaseModel):
    translated_text: str
    source_lang: str
    target_lang: str
    provider: str


class TranslateBatchRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=80)
    source_lang: str = Field(default="en", max_length=16)
    target_lang: str = Field(min_length=2, max_length=16)


class TranslateBatchItem(BaseModel):
    text: str
    translated_text: str
    provider: str


class TranslateBatchResponse(BaseModel):
    items: list[TranslateBatchItem]
    source_lang: str
    target_lang: str


@router.post("/translate/batch", response_model=TranslateBatchResponse)
async def translate_batch(
    body: TranslateBatchRequest,
    settings: Settings = Depends(get_settings),
) -> TranslateBatchResponse:
    """Translate many short UI strings in one round-trip (deduped server-side via cache)."""
    items: list[TranslateBatchItem] = []
    for raw in body.texts[:80]:
        text = (raw or "").strip()
        if not text or len(text) > 800:
            items.append(TranslateBatchItem(text=raw or "", translated_text=raw or "", provider="skip"))
            continue
        result = await translate_text(
            text,
            source_lang=body.source_lang,
            target_lang=body.target_lang,
            settings=settings,
        )
        items.append(
            TranslateBatchItem(
                text=text,
                translated_text=result["translated_text"],
                provider=result["provider"],
            )
        )
    return TranslateBatchResponse(
        items=items,
        source_lang=body.source_lang,
        target_lang=body.target_lang,
    )


@router.get("/languages")
async def list_languages() -> dict:
    return languages_payload()


@router.post("/translate", response_model=TranslateResponse)
async def translate(
    body: TranslateRequest,
    settings: Settings = Depends(get_settings),
) -> TranslateResponse:
    result = await translate_text(
        body.text,
        source_lang=body.source_lang,
        target_lang=body.target_lang,
        settings=settings,
    )
    return TranslateResponse(**result)
