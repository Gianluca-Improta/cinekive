"""Collections, works, export, and clip routes."""

from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.collection import (
    ClipExportRequest,
    CollectionAddShots,
    CollectionCreate,
    CollectionDetail,
    CollectionIngestRequest,
    CollectionRead,
    CollectionUpdate,
    ExportRequest,
)
from cinearchive.schemas.ingest import IngestResponse
from cinearchive.schemas.shot import ShotRead, ShotUpdate
from cinearchive.services.collection_service import CollectionService
from cinearchive.services.export_service import ExportService
from cinearchive.services.ingest_service import IngestService
from cinearchive.services.shot_mapper import shot_payload, shot_to_read
from cinearchive.utils.ffmpeg import extract_source_clip
from cinearchive.utils.paths import ensure_dir

router = APIRouter(tags=["collections"])


@router.post("/collections", response_model=CollectionRead, status_code=201)
async def create_collection(
    body: CollectionCreate,
    session: AsyncSession = Depends(get_db_session),
) -> CollectionRead:
    return await CollectionService(session).create(body)


@router.get("/collections", response_model=list[CollectionRead])
async def list_collections(
    project_id: UUID | None = None,
    kind: str | None = Query(default=None, description="moodboard|work|reel|lookbook"),
    session: AsyncSession = Depends(get_db_session),
) -> list[CollectionRead]:
    return await CollectionService(session).list(project_id, kind=kind)


@router.get("/collections/{collection_id}", response_model=CollectionDetail)
async def get_collection(
    collection_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> CollectionDetail:
    detail = await CollectionService(session).get(collection_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Collection not found")
    return detail


@router.patch("/collections/{collection_id}", response_model=CollectionRead)
async def update_collection(
    collection_id: UUID,
    body: CollectionUpdate,
    session: AsyncSession = Depends(get_db_session),
) -> CollectionRead:
    try:
        return await CollectionService(session).update(
            collection_id,
            name=body.name,
            description=body.description,
            meta=body.meta,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/collections/{collection_id}/shots", response_model=CollectionDetail)
async def add_to_collection(
    collection_id: UUID,
    body: CollectionAddShots,
    session: AsyncSession = Depends(get_db_session),
) -> CollectionDetail:
    try:
        return await CollectionService(session).add_shots(collection_id, body.shot_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/collections/{collection_id}/shots/remove", response_model=CollectionDetail)
async def remove_from_collection(
    collection_id: UUID,
    body: CollectionAddShots,
    session: AsyncSession = Depends(get_db_session),
) -> CollectionDetail:
    try:
        return await CollectionService(session).remove_shots(collection_id, body.shot_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/collections/{collection_id}/ingest", response_model=IngestResponse)
async def ingest_into_collection(
    collection_id: UUID,
    body: CollectionIngestRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Drop a film/ad into a work collection — grades moments and links them."""
    try:
        return await IngestService(session, settings).ingest_into_collection(
            collection_id,
            project_id=body.project_id,
            paths=body.paths,
            recursive=body.recursive,
            sampling_mode=body.sampling_mode,
            generate_previews=body.generate_previews,
            background=background,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/collections/{collection_id}", status_code=204)
async def delete_collection(
    collection_id: UUID,
    session: AsyncSession = Depends(get_db_session),
) -> None:
    ok = await CollectionService(session).delete(collection_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Collection not found")


@router.post("/export")
async def export_shots(
    body: ExportRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    try:
        path = await ExportService(session, settings).export(
            body.shot_ids,
            fmt=body.format,
            include_previews=body.include_previews,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    media = {
        "zip": "application/zip",
        "json": "application/json",
        "framechain": "application/json",
        "edl": "text/plain",
    }.get(body.format, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=path.name)


@router.post("/shots/{shot_id}/clip")
async def export_shot_clip(
    shot_id: UUID,
    body: ClipExportRequest | None = None,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    """Export a source-resolution clip for the shot's original in/out timecodes."""
    body = body or ClipExportRequest()
    repo = ShotRepository(session)
    shot = await repo.get(shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")
    if shot.source_type != "video" or shot.start_timecode_ms is None or shot.end_timecode_ms is None:
        raise HTTPException(status_code=400, detail="Shot has no video timecodes")
    src = Path(shot.source_path)
    if not src.is_file():
        raise HTTPException(status_code=404, detail="Source video not found on disk")

    out_dir = ensure_dir(Path(settings.artifacts_dir) / "_clips")
    safe = (shot.source_filename or shot.id)[:40].replace(" ", "_")
    out = out_dir / f"{shot.id[:8]}_{safe}_clip.mp4"
    try:
        extract_source_clip(
            src,
            (shot.start_timecode_ms or 0) / 1000.0,
            (shot.end_timecode_ms or 0) / 1000.0,
            out,
            handles_sec=body.handles_sec,
            copy_streams=body.copy_streams,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Clip export failed: {exc}") from exc
    return FileResponse(out, media_type="video/mp4", filename=out.name)


@router.patch("/shots/{shot_id}", response_model=ShotRead)
async def update_shot(
    shot_id: UUID,
    body: ShotUpdate,
    session: AsyncSession = Depends(get_db_session),
    vector_repo: VectorRepository = Depends(get_vector_repo),
) -> ShotRead:
    repo = ShotRepository(session)
    shot = await repo.get(shot_id)
    if not shot:
        raise HTTPException(status_code=404, detail="Shot not found")

    data = body.model_dump(exclude_unset=True)
    if "tags" in data:
        shot.tags_json = data.pop("tags") or []
    if "techniques" in data:
        shot.techniques_json = data.pop("techniques") or []
    for k, v in data.items():
        setattr(shot, k, v)
    await session.commit()
    await session.refresh(shot)

    try:
        vector_repo.set_payload(shot.id, shot_payload(shot))
    except Exception:
        pass

    return shot_to_read(shot)


@router.get("/watcher/status")
async def watcher_status(settings: Settings = Depends(get_settings)) -> dict:
    from cinearchive.services.watcher import get_watcher

    return await get_watcher(settings).status()
