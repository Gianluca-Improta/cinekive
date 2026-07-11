"""Job repository."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.db.models.job import Job


class JobRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, job: Job) -> Job:
        self.session.add(job)
        await self.session.flush()
        return job

    async def get(self, job_id: UUID | str) -> Job | None:
        return await self.session.get(Job, str(job_id))

    async def list_for_project(self, project_id: UUID | str, limit: int = 20) -> list[Job]:
        result = await self.session.execute(
            select(Job)
            .where(Job.project_id == str(project_id))
            .order_by(Job.created_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_recent(self, limit: int = 40) -> list[Job]:
        result = await self.session.execute(
            select(Job).order_by(Job.created_at.desc()).limit(limit)
        )
        return list(result.scalars().all())

    async def update_progress(
        self,
        job_id: UUID | str,
        *,
        status: str | None = None,
        progress_pct: float | None = None,
        current_step: str | None = None,
        total_items: int | None = None,
        processed_items: int | None = None,
        error_message: str | None = None,
        payload_json: dict[str, Any] | None = None,
    ) -> Job | None:
        job = await self.get(job_id)
        if not job:
            return None
        if status is not None:
            job.status = status
            if status == "running" and job.started_at is None:
                job.started_at = datetime.now(timezone.utc)
            if status in {"completed", "failed", "cancelled"}:
                job.finished_at = datetime.now(timezone.utc)
        if progress_pct is not None:
            job.progress_pct = progress_pct
        if current_step is not None:
            job.current_step = current_step
        if total_items is not None:
            job.total_items = total_items
        if processed_items is not None:
            job.processed_items = processed_items
        if error_message is not None:
            job.error_message = error_message
        if payload_json is not None:
            job.payload_json = payload_json
        await self.session.flush()
        return job
