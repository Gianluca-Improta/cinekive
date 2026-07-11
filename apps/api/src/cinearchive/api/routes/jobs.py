"""Job polling routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session
from cinearchive.repositories.job_repo import JobRepository
from cinearchive.schemas.job import JobList, JobRead

router = APIRouter(tags=["jobs"])


@router.get("/jobs", response_model=JobList)
async def list_recent_jobs(
    limit: int = 40,
    session: AsyncSession = Depends(get_db_session),
) -> JobList:
    """Recent jobs across all projects — for the activity log panel."""
    repo = JobRepository(session)
    items = await repo.list_recent(min(max(limit, 1), 100))
    return JobList(items=[JobRead.model_validate(j) for j in items], total=len(items))


@router.get("/jobs/{job_id}", response_model=JobRead)
async def get_job(
    job_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> JobRead:
    repo = JobRepository(session)
    job = await repo.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobRead.model_validate(job)


@router.get("/projects/{project_id}/jobs", response_model=JobList)
async def list_project_jobs(
    project_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> JobList:
    repo = JobRepository(session)
    items = await repo.list_for_project(project_id)
    return JobList(items=[JobRead.model_validate(j) for j in items], total=len(items))
