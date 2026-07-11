"""Job progress helpers."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from cinearchive.db.session import SessionLocal
from cinearchive.repositories.job_repo import JobRepository
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


async def update_job(
    job_id: UUID | str,
    **kwargs: Any,
) -> None:
    async with SessionLocal() as session:
        repo = JobRepository(session)
        await repo.update_progress(job_id, **kwargs)
        await session.commit()
