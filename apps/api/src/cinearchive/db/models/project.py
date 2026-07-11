"""Project ORM model."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from cinearchive.db.base import Base

if TYPE_CHECKING:
    from cinearchive.db.models.job import Job
    from cinearchive.db.models.shot import Shot


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # commercial | social | archive | general — intention bucket for the library
    kind: Mapped[str] = mapped_column(String(32), default="commercial", index=True, nullable=False)
    # Social delivery: long_form | short_form | mixed (optional)
    form_factor: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Primary delivery aspect: 16:9 | 9:16 | 1:1 | 4:5 | mixed (optional filter hint)
    aspect_ratio: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Creative brief — lives on the project so search / VLM share context
    brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    feeling: Mapped[str | None] = mapped_column(String(512), nullable=True)
    references_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    sampling_mode: Mapped[str] = mapped_column(String(16), default="heroes", nullable=False)
    generate_previews: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    video_dir: Mapped[str] = mapped_column(String(512), nullable=False)
    # Phase 1
    vlm_enrichment: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # Phase 2
    watch_folder: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    watch_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    shots: Mapped[list[Shot]] = relationship("Shot", back_populates="project", cascade="all, delete-orphan")
    jobs: Mapped[list[Job]] = relationship("Job", back_populates="project", cascade="all, delete-orphan")
