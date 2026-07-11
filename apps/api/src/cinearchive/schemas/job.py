"""Job Pydantic schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel


JobStatus = Literal["pending", "running", "completed", "failed", "cancelled"]
JobType = Literal["ingest_video", "ingest_images", "reindex", "enrich", "export"]


class JobRead(BaseModel):
    id: UUID
    project_id: UUID | None
    type: str
    status: JobStatus
    progress_pct: float
    current_step: str
    total_items: int
    processed_items: int
    error_message: str | None
    payload_json: dict[str, Any]
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class JobList(BaseModel):
    items: list[JobRead]
    total: int
