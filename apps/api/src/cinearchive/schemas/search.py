"""Search Pydantic schemas."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from cinearchive.schemas.shot import ShotRead


class SearchRequest(BaseModel):
    query: str | None = None
    project_id: UUID | None = None
    has_preview: bool | None = None
    is_favorite: bool | None = None
    is_hero: bool | None = None
    hide_duplicates: bool | None = True
    tags: list[str] | None = None
    shot_type: str | None = None
    mood_vibe: str | None = None
    camera_movement: str | None = None
    lighting_style: str | None = None
    composition: str | None = None
    content_format: str | None = None
    emotion: str | None = None
    technique: str | None = None
    era: str | None = None
    origin: str | None = None
    ism: str | None = None
    director: str | None = None
    visual_style: str | None = None
    theme: str | None = None
    genre: str | None = None
    shape: str | None = None
    color_hex: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")
    randomize: bool = False
    group_sequences: bool | None = None
    is_moving: bool | None = None
    limit: int = Field(default=48, ge=1, le=200)
    offset: int = Field(default=0, ge=0)


class SearchResult(BaseModel):
    shot: ShotRead
    score: float


class SearchResponse(BaseModel):
    results: list[SearchResult]
    total: int
    query: str | None


class PaletteSearchRequest(BaseModel):
    """Find shots with similar color palette."""

    shot_id: UUID | None = None
    colors: list[str] | None = None  # hex list
    project_id: UUID | None = None
    limit: int = Field(default=48, ge=1, le=200)


class SimilarSearchRequest(BaseModel):
    """Find visually / thematically connected shots for a given shot."""

    shot_id: UUID
    project_id: UUID | None = None
    limit: int = Field(default=16, ge=1, le=48)
    hide_duplicates: bool = True


class MoodboardRequest(BaseModel):
    """Pitch / logline → curated moodboard. Project brief is blended when project_id set."""

    text: str = Field(default="", max_length=8000)
    project_id: UUID | None = None
    limit: int = Field(default=24, ge=1, le=100)
    shot_type: str | None = None
    mood_vibe: str | None = None


class MoodboardResponse(BaseModel):
    concepts: list[str]
    results: list[SearchResult]
    query_used: str


class AgentQueryRequest(BaseModel):
    """Natural-language agent query for OpenClaw / multi-agent frameworks."""

    prompt: str = Field(min_length=3, max_length=4000)
    project_id: UUID | None = None
    limit: int = Field(default=5, ge=1, le=50)
    filters: dict | None = None


class AgentQueryResponse(BaseModel):
    interpretation: dict
    results: list[SearchResult]
    message: str
