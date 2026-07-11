"""Ingest Pydantic schemas."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, Field

from cinearchive.schemas.job import JobRead


class IngestPathRequest(BaseModel):
    """Ingest from paths already on the server volume (or absolute host-mapped paths)."""

    paths: list[str] = Field(min_length=1)
    recursive: bool = True


class IngestResponse(BaseModel):
    job: JobRead
    message: str = "Ingest job queued"
