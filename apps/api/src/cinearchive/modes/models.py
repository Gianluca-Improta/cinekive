"""Generic core schema. Domain differences live in taxonomy/config, not alternate models."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field


class ModeId(str, Enum):
    CINEMATIC = "cinematic"
    ARCHITECTURE = "architecture"
    FASHION = "fashion"
    PRODUCT = "product"


class RightsInfo(BaseModel):
    license: str = "unknown"
    credit: str | None = None
    rights_url: str | None = None
    is_public_domain: bool | None = None
    can_display: bool = True
    notes: str | None = None


class ImageAsset(BaseModel):
    url: str
    width: int | None = None
    height: int | None = None
    iiif_info_url: str | None = None
    origin: str = "source"  # source | derived | local
    alt: str | None = None


class Provenance(BaseModel):
    source: str
    source_id: str
    source_url: str | None = None
    source_metadata: dict[str, Any] = Field(default_factory=dict)
    rights: RightsInfo = Field(default_factory=RightsInfo)
    image_origin: str | None = None
    ingested_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Enrichment(BaseModel):
    """AI / heuristic inference — never treated as verified archival metadata."""

    tags: list[str] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)
    periods: list[str] = Field(default_factory=list)
    classification: dict[str, Any] = Field(default_factory=dict)
    embedding_id: str | None = None
    related_ids: list[str] = Field(default_factory=list)
    model: str | None = None
    version: int = 0
    inferred_at: datetime | None = None
    disclaimer: str = "AI-inferred; not verified archival metadata"


class Creator(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    role: str | None = None  # designer, architect, maker, atelier…
    source_ids: dict[str, str] = Field(default_factory=dict)


class Material(BaseModel):
    id: str
    label: str
    aliases: list[str] = Field(default_factory=list)


class Style(BaseModel):
    id: str
    label: str
    aliases: list[str] = Field(default_factory=list)


class Period(BaseModel):
    id: str
    label: str
    start_year: int | None = None
    end_year: int | None = None


class Source(BaseModel):
    key: str
    label: str
    site_url: str | None = None
    strategies: list[str] = Field(default_factory=list)
    modes: list[ModeId] = Field(default_factory=list)
    rate_limit_note: str | None = None


class Collection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: str | None = None
    reference_ids: list[str] = Field(default_factory=list)
    mode_ids: list[ModeId] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: str | None = None
    mode_ids: list[ModeId] = Field(default_factory=list)
    collection_ids: list[str] = Field(default_factory=list)
    reference_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Annotation(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    reference_id: str
    body: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Reference(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str | None = None
    creators: list[Creator] = Field(default_factory=list)
    image: ImageAsset | None = None
    images: list[ImageAsset] = Field(default_factory=list)
    modes: list[ModeId] = Field(default_factory=list)
    materials: list[str] = Field(default_factory=list)
    styles: list[str] = Field(default_factory=list)
    periods: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    place: str | None = None
    date_text: str | None = None
    provenance: Provenance
    enrichment: Enrichment | None = None
    content_hash: str | None = None  # for dedupe
    notes: str | None = None

    def primary_image_url(self) -> str | None:
        if self.image and self.image.url:
            return self.image.url
        if self.images:
            return self.images[0].url
        return None
