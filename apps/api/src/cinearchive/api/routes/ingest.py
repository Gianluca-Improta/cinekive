"""Ingest routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings
from cinearchive.config import Settings
from cinearchive.schemas.ingest import IngestPathRequest, IngestResponse
from cinearchive.services.ingest_service import IngestService

router = APIRouter(prefix="/projects/{project_id}/ingest", tags=["ingest"])


def _http_from_value_error(exc: ValueError) -> HTTPException:
    msg = str(exc)
    code = 404 if "not found" in msg.lower() else 400
    return HTTPException(status_code=code, detail=msg)


@router.post("/videos", response_model=IngestResponse)
@router.post("/videos/upload", response_model=IngestResponse)
async def ingest_videos_upload(
    project_id: UUID,
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    service = IngestService(session, settings)
    try:
        return await service.ingest_videos_upload(project_id, files, background)
    except ValueError as exc:
        raise _http_from_value_error(exc) from exc


@router.post("/videos/paths", response_model=IngestResponse)
async def ingest_videos_paths(
    project_id: UUID,
    body: IngestPathRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    service = IngestService(session, settings)
    try:
        return await service.ingest_videos_paths(project_id, body.paths, body.recursive, background)
    except ValueError as exc:
        raise _http_from_value_error(exc) from exc


@router.post("/images", response_model=IngestResponse)
@router.post("/images/upload", response_model=IngestResponse)
async def ingest_images_upload(
    project_id: UUID,
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    relative_paths: list[str] | None = Form(default=None),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    service = IngestService(session, settings)
    try:
        return await service.ingest_images_upload(
            project_id, files, background, relative_paths=relative_paths
        )
    except ValueError as exc:
        raise _http_from_value_error(exc) from exc


@router.post("/images/paths", response_model=IngestResponse)
async def ingest_images_paths(
    project_id: UUID,
    body: IngestPathRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    service = IngestService(session, settings)
    try:
        return await service.ingest_images_paths(project_id, body.paths, body.recursive, background)
    except ValueError as exc:
        raise _http_from_value_error(exc) from exc
