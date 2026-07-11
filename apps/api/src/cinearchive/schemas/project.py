"""Project Pydantic schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


ProjectKind = Literal["commercial", "social", "archive", "general", "narrative"]
FormFactor = Literal["long_form", "short_form", "mixed"]


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    kind: ProjectKind = "commercial"
    form_factor: FormFactor | None = None
    aspect_ratio: str | None = Field(default=None, max_length=16)
    brief: str | None = None
    feeling: str | None = Field(default=None, max_length=512)
    references_text: str | None = None
    sampling_mode: Literal["fast", "full", "heroes", "moments"] = "heroes"
    generate_previews: bool = True
    vlm_enrichment: bool = False
    watch_folder: str | None = None
    watch_enabled: bool = False
    slug: str | None = Field(default=None, max_length=128)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    kind: ProjectKind | None = None
    form_factor: FormFactor | None = None
    aspect_ratio: str | None = Field(default=None, max_length=16)
    brief: str | None = None
    feeling: str | None = Field(default=None, max_length=512)
    references_text: str | None = None
    sampling_mode: Literal["fast", "full", "heroes", "moments"] | None = None
    generate_previews: bool | None = None
    vlm_enrichment: bool | None = None
    watch_folder: str | None = None
    watch_enabled: bool | None = None


class ProjectRead(BaseModel):
    id: UUID
    name: str
    slug: str
    description: str | None
    kind: str = "commercial"
    form_factor: str | None = None
    aspect_ratio: str | None = None
    brief: str | None = None
    feeling: str | None = None
    references_text: str | None = None
    sampling_mode: str
    generate_previews: bool
    video_dir: str
    vlm_enrichment: bool = False
    watch_folder: str | None = None
    watch_enabled: bool = False
    shot_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ProjectList(BaseModel):
    items: list[ProjectRead]
    total: int
