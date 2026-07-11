"""Project CRUD routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.project import ProjectCreate, ProjectList, ProjectRead, ProjectUpdate
from cinearchive.services.project_service import ProjectService

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProjectRead:
    service = ProjectService(session, settings)
    return await service.create(body)


@router.get("", response_model=ProjectList)
async def list_projects(
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProjectList:
    service = ProjectService(session, settings)
    items = await service.list()
    return ProjectList(items=items, total=len(items))


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProjectRead:
    service = ProjectService(session, settings)
    project = await service.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProjectRead:
    service = ProjectService(session, settings)
    project = await service.update(project_id, body)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: UUID,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> None:
    service = ProjectService(session, settings, vector_repo=vector_repo)
    ok = await service.delete(project_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Project not found")
