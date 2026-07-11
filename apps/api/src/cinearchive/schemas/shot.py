"""Shot Pydantic schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class DominantColor(BaseModel):
    hex: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    percentage: float = Field(ge=0, le=100)
    lab: tuple[float, float, float] | None = None


class ShotRead(BaseModel):
    id: UUID
    project_id: UUID
    source_type: Literal["video", "image"]
    source_path: str
    source_filename: str | None = None
    source_title: str | None = None
    source_meta: dict[str, Any] = Field(default_factory=dict)
    scene_index: int
    start_timecode_ms: int | None
    end_timecode_ms: int | None
    duration_ms: int | None
    keyframe_ms: int | None = None
    source_fps: float | None = None
    collection_id: UUID | None = None
    dialogue: list[dict[str, Any]] | dict[str, Any] | None = None
    dialogue_text: str | None = None
    width: int
    height: int
    dominant_colors: list[DominantColor]
    has_preview: bool
    thumb_url: str
    thumb_md_url: str
    preview_url: str | None
    keyframe_url: str
    shot_type: str | None = None
    camera_movement: str | None = None
    camera_angle: str | None = None
    lighting_style: str | None = None
    composition: str | None = None
    subject: str | None = None
    lens_look: str | None = None
    color_grade: str | None = None
    mood_vibe: str | None = None
    creative_intent: str | None = None
    content_format: str | None = None
    emotion: str | None = None
    era: str | None = None
    origin: str | None = None
    ism: str | None = None
    director: str | None = None
    visual_style: str | None = None
    theme: str | None = None
    genre: str | None = None
    shapes: list[str] = []
    tags: list[str] = []
    techniques: list[str] = []
    enrichment_version: int = 0
    enrichment_quality: dict[str, Any] | None = None
    link_hints: dict[str, list[str]] | None = None
    sequence_id: str | None = None
    frame_role: str | None = None
    hero_score: float = 0.0
    is_hero: bool = False
    is_moving: bool = False
    grade_reason: str | None = None
    is_duplicate: bool = False
    notes: str | None = None
    is_favorite: bool = False
    deleted_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ShotUpdate(BaseModel):
    tags: list[str] | None = None
    techniques: list[str] | None = None
    notes: str | None = None
    is_favorite: bool | None = None
    is_hero: bool | None = None
    shot_type: str | None = None
    camera_movement: str | None = None
    camera_angle: str | None = None
    lighting_style: str | None = None
    composition: str | None = None
    subject: str | None = None
    lens_look: str | None = None
    color_grade: str | None = None
    mood_vibe: str | None = None
    creative_intent: str | None = None
    content_format: str | None = None
    emotion: str | None = None


class ShotList(BaseModel):
    items: list[ShotRead]
    total: int
    offset: int
    limit: int


class ShotBulkRequest(BaseModel):
    shot_ids: list[UUID] = Field(min_length=1, max_length=500)


class ShotBulkMoveRequest(ShotBulkRequest):
    target_project_id: UUID
    mode: Literal["move", "copy"] = "move"


class ShotBulkCollectionRequest(ShotBulkRequest):
    collection_id: UUID


class ShotBulkResponse(BaseModel):
    affected: int
    message: str
