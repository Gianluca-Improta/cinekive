"""Shot listing, bulk management, and artifact routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.shot import (
    ShotBulkCollectionRequest,
    ShotBulkMoveRequest,
    ShotBulkRequest,
    ShotBulkResponse,
    ShotList,
    ShotRead,
)
from cinearchive.services.artifact_service import resolve_artifact
from cinearchive.services.search_service import SearchService
from cinearchive.services.shot_management import ShotManagementService
from cinearchive.services.shot_mapper import shot_to_read

router = APIRouter(tags=["shots"])


@router.get("/shots", response_model=ShotList)
async def list_shots(
    project_id: UUID | None = None,
    has_preview: bool | None = None,
    is_favorite: bool | None = None,
    is_hero: bool | None = None,
    is_moving: bool | None = None,
    hide_duplicates: bool = True,
    group_sequences: bool | None = None,
    shot_type: str | None = None,
    content_format: str | None = None,
    emotion: str | None = None,
    technique: str | None = None,
    randomize: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotList:
    service = SearchService(session, settings, vector_repo)
    return await service.list_shots(
        project_id=project_id,
        has_preview=has_preview,
        is_favorite=is_favorite,
        is_hero=is_hero,
        is_moving=is_moving,
        hide_duplicates=hide_duplicates,
        shot_type=shot_type,
        content_format=content_format,
        emotion=emotion,
        technique=technique,
        randomize=randomize,
        group_sequences=group_sequences,
        offset=offset,
        limit=limit,
    )


@router.get("/shots/bin", response_model=ShotList)
async def list_bin(
    project_id: UUID | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(48, ge=1, le=200),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotList:
    svc = ShotManagementService(session, settings, vector_repo)
    items, total = await svc.list_bin(
        project_id=str(project_id) if project_id else None,
        offset=offset,
        limit=limit,
    )
    return ShotList(
        items=[shot_to_read(s) for s in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/shots/{shot_id}", response_model=ShotRead)
async def get_shot(
    shot_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> ShotRead:
    repo = ShotRepository(session)
    shot = await repo.get(shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    if getattr(shot, "deleted_at", None):
        # Still readable from bin UI
        return shot_to_read(shot)
    return shot_to_read(shot)


@router.post("/shots/bulk/delete", response_model=ShotBulkResponse)
async def bulk_delete_shots(
    body: ShotBulkRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    """Soft-delete: move to bin. Permanently purged after TRASH_RETENTION_DAYS."""
    svc = ShotManagementService(session, settings, vector_repo)
    n = await svc.soft_delete_shots([str(i) for i in body.shot_ids])
    days = settings.trash_retention_days
    return ShotBulkResponse(
        affected=n,
        message=f"Moved {n} shots to bin (auto-delete after {days} days)",
    )


@router.post("/shots/bulk/restore", response_model=ShotBulkResponse)
async def bulk_restore_shots(
    body: ShotBulkRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    svc = ShotManagementService(session, settings, vector_repo)
    n = await svc.restore_shots([str(i) for i in body.shot_ids])
    return ShotBulkResponse(affected=n, message=f"Restored {n} shots from bin")


@router.post("/shots/bulk/purge", response_model=ShotBulkResponse)
async def bulk_purge_shots(
    body: ShotBulkRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    """Permanently delete selected bin shots now."""
    svc = ShotManagementService(session, settings, vector_repo)
    n = await svc.permanently_delete_shots([str(i) for i in body.shot_ids])
    return ShotBulkResponse(affected=n, message=f"Permanently deleted {n} shots")


@router.post("/shots/bin/purge-expired", response_model=ShotBulkResponse)
async def purge_expired_bin(
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    svc = ShotManagementService(session, settings, vector_repo)
    n = await svc.purge_expired()
    return ShotBulkResponse(
        affected=n,
        message=f"Purged {n} shots older than {settings.trash_retention_days} days",
    )


@router.post("/shots/bulk/move", response_model=ShotBulkResponse)
async def bulk_move_shots(
    body: ShotBulkMoveRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    svc = ShotManagementService(session, settings, vector_repo)
    try:
        n = await svc.move_or_copy(
            [str(i) for i in body.shot_ids],
            str(body.target_project_id),
            mode=body.mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    verb = "Moved" if body.mode == "move" else "Copied"
    return ShotBulkResponse(affected=n, message=f"{verb} {n} shots")


@router.post("/shots/bulk/collection", response_model=ShotBulkResponse)
async def bulk_add_to_collection(
    body: ShotBulkCollectionRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotBulkResponse:
    svc = ShotManagementService(session, settings, vector_repo)
    try:
        n = await svc.add_to_collection(str(body.collection_id), [str(i) for i in body.shot_ids])
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ShotBulkResponse(affected=n, message=f"Added {n} shots to collection")


@router.get("/artifacts/{path:path}")
async def get_artifact(
    path: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    try:
        resolved = resolve_artifact(settings, path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    suffix = resolved.suffix.lower()
    media_types = {
        ".webp": "image/webp",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".mp4": "video/mp4",
        ".webm": "video/webm",
        ".gif": "image/gif",
        ".zip": "application/zip",
        ".json": "application/json",
    }
    return FileResponse(resolved, media_type=media_types.get(suffix, "application/octet-stream"))
