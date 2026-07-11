"""Collection and export schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cinearchive.schemas.shot import ShotRead

CollectionKind = Literal["moodboard", "work", "reel", "lookbook", "canvas"]
WorkSampling = Literal["heroes", "moments", "full"]


class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    project_id: UUID | None = None
    kind: CollectionKind = "moodboard"
    year: int | None = None
    content_format: str | None = None
    sampling_mode: WorkSampling = "moments"
    meta: dict[str, Any] = Field(default_factory=dict)


class CollectionRead(BaseModel):
    id: UUID
    project_id: UUID | None
    name: str
    description: str | None
    kind: str = "moodboard"
    year: int | None = None
    content_format: str | None = None
    sampling_mode: str = "moments"
    cover_shot_id: str | None = None
    meta: dict[str, Any] = Field(default_factory=dict)
    shot_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class CollectionDetail(CollectionRead):
    shots: list[ShotRead] = []


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    meta: dict[str, Any] | None = None


class CollectionAddShots(BaseModel):
    shot_ids: list[UUID] = Field(min_length=1)


class CollectionIngestRequest(BaseModel):
    """Drop media into a work/reel collection — auto-links moments."""

    paths: list[str] = Field(min_length=1)
    recursive: bool = False
    project_id: UUID
    sampling_mode: WorkSampling | None = None
    generate_previews: bool = True
    run_dialogue: bool = False


class ExportRequest(BaseModel):
    shot_ids: list[UUID] = Field(min_length=1)
    format: str = Field(default="zip", pattern=r"^(zip|json|framechain|edl)$")
    include_previews: bool = False


class ClipExportRequest(BaseModel):
    handles_sec: float = Field(default=0.0, ge=0, le=5)
    copy_streams: bool = False


class EnrichRequest(BaseModel):
    shot_ids: list[UUID] | None = None
    force: bool = False
    # auto | fast | balanced | quality — omit to use ENRICH_TIER / VRAM auto
    tier: str | None = None
    model: str | None = None


class DialogueRequest(BaseModel):
    shot_ids: list[UUID] | None = None
    force: bool = False
    model: str | None = None


class WatcherStatus(BaseModel):
    enabled: bool
    projects: list[dict]
