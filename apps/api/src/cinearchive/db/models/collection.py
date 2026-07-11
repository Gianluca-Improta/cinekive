"""Collection / moodboard / work ORM models.

Kinds:
  moodboard — curated shot list (classic)
  work      — a film/ad/episode you drop in; moments auto-link here
  reel      — editorial sequence / cutdown
  lookbook  — visual reference board
  canvas    — freeform project board for arranging liked shots
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from cinearchive.db.base import Base


class Collection(Base):
    __tablename__ = "collections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), index=True, nullable=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # moodboard | work | reel | lookbook | canvas
    kind: Mapped[str] = mapped_column(String(32), default="moodboard", index=True, nullable=False)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # film | commercial | music-video | series | short | other
    content_format: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # heroes | moments | full — how ingest should grade when targeting this work
    sampling_mode: Mapped[str] = mapped_column(String(16), default="moments", nullable=False)
    cover_shot_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CollectionShot(Base):
    __tablename__ = "collection_shots"
    __table_args__ = (UniqueConstraint("collection_id", "shot_id", name="uq_collection_shot"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    collection_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("collections.id", ondelete="CASCADE"), index=True, nullable=False
    )
    shot_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("shots.id", ondelete="CASCADE"), index=True, nullable=False
    )
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
