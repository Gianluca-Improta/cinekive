"""Shot ORM model — sequence-aware cinematic archive."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cinearchive.db.base import Base

if TYPE_CHECKING:
    from cinearchive.db.models.project import Project


class Shot(Base):
    __tablename__ = "shots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=False
    )
    source_type: Mapped[str] = mapped_column(String(16), nullable=False)  # video | image
    source_path: Mapped[str] = mapped_column(Text, nullable=False)
    source_filename: Mapped[str | None] = mapped_column(String(512), nullable=True, index=True)
    source_title: Mapped[str | None] = mapped_column(String(512), nullable=True, index=True)
    source_meta_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    scene_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_timecode_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_timecode_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Exact frame time used for the keyframe extract (clip-ready)
    keyframe_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Optional link to a work/reel collection (The Matrix, etc.)
    collection_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("collections.id", ondelete="SET NULL"), index=True, nullable=True
    )
    dialogue_json: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSON, nullable=True)
    dialogue_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    keyframe_path: Mapped[str] = mapped_column(Text, nullable=False)
    thumb_sm_path: Mapped[str] = mapped_column(Text, nullable=False)
    thumb_md_path: Mapped[str] = mapped_column(Text, nullable=False)
    preview_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    height: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    dominant_colors_json: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list, nullable=False)
    has_preview: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    qdrant_point_id: Mapped[str] = mapped_column(String(36), nullable=False)

    # Taxonomy / shot DNA
    shot_type: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    camera_movement: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    camera_angle: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    lighting_style: Mapped[str | None] = mapped_column(String(64), nullable=True)
    composition: Mapped[str | None] = mapped_column(String(128), nullable=True)
    subject: Mapped[str | None] = mapped_column(String(255), nullable=True)
    lens_look: Mapped[str | None] = mapped_column(String(64), nullable=True)
    color_grade: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mood_vibe: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    creative_intent: Mapped[str | None] = mapped_column(Text, nullable=True)
    tags_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    techniques_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    enrichment_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    content_format: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    emotion: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    era: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    origin: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    ism: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    visual_style: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    theme: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    genre: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    shapes_json: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)

    # Sequence / hero curation
    sequence_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    frame_role: Mapped[str | None] = mapped_column(String(16), nullable=True)  # start|mid|end|still
    hero_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    is_hero: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    is_moving: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    grade_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Dedup
    phash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_duplicate: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)
    duplicate_of: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Editing
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, index=True, nullable=False)

    # Soft-delete bin — purged permanently after retention window
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    project: Mapped[Project] = relationship("Project", back_populates="shots")
