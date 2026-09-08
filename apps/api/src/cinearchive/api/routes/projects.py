"""Project CRUD routes."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.db.models.project import Project as ProjectModel
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
    from cinearchive.services import entitlements as ent

    service = ProjectService(session, settings)
    if body.watch_enabled:
        ent.require_feature("folder_watcher", settings)
    payload = ent.entitlements_payload(settings)
    max_projects = payload.get("limits", {}).get("max_projects")
    if max_projects is not None:
        existing = await service.list()
        if len(existing) >= int(max_projects):
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "pro_required",
                    "feature": "unlimited_projects",
                    "message": f"Free tier includes up to {max_projects} projects. Upgrade to Pro for unlimited.",
                    "upgrade_url": payload["upgrade_url"],
                },
            )
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
    from cinearchive.services.entitlements import require_feature
    from cinearchive.services.watcher import get_watcher
    from cinearchive.utils.paths import project_video_dir

    # Enabling folder watch is Pro — Free keeps manual ingest.
    if body.watch_enabled is True:
        require_feature("folder_watcher", settings)

    service = ProjectService(session, settings)

    # Default watch path to project inbox when enabling without a folder.
    if body.watch_enabled is True and not (body.watch_folder or "").strip():
        existing = await service.get(project_id)
        if existing and not (existing.watch_folder or "").strip():
            inbox = project_video_dir(settings, existing.slug) / "inbox"
            inbox.mkdir(parents=True, exist_ok=True)
            body.watch_folder = str(inbox)

    project = await service.update(project_id, body)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.watch_enabled and project.watch_folder:
        watcher = get_watcher(settings)
        if not watcher.running:
            watcher.start()

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


class ProjectExportBody(BaseModel):
    format: Literal["gallery", "zip", "pptx"] = "gallery"
    include_previews: bool = False


@router.post("/{project_id}/export")
async def export_project(
    project_id: UUID,
    body: ProjectExportBody | None = None,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
):
    """Share package: browsable ZIP gallery, flat ZIP, or PowerPoint deck."""
    from cinearchive.services.entitlements import require_feature
    from cinearchive.services.export_service import ExportService

    body = body or ProjectExportBody()
    require_feature("batch_export", settings)
    row = await session.execute(select(ProjectModel).where(ProjectModel.id == str(project_id)))
    orm = row.scalar_one_or_none()
    if not orm:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        path = await ExportService(session, settings).export_project(
            orm,
            fmt=body.format,
            include_previews=body.include_previews,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media = {
        "gallery": "application/zip",
        "zip": "application/zip",
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    }.get(body.format, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=path.name)
