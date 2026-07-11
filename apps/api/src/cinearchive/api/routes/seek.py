"""Inspiration Seek API — opt-in external reference download."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings
from cinearchive.config import Settings
from cinearchive.pipelines.inspiration_seek import InspirationSeek, SeekCandidate

router = APIRouter(prefix="/seek", tags=["seek"])


class SeekSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)
    limit: int = Field(default=12, ge=1, le=48)


class SeekCandidateOut(BaseModel):
    title: str
    source: str
    url: str
    thumb_url: str | None = None
    tags: list[str] | None = None
    license_note: str | None = None


class SeekSearchResponse(BaseModel):
    enabled: bool
    results: list[SeekCandidateOut]


class SeekDownloadRequest(BaseModel):
    url: str
    title: str = "seek_asset"
    source: str = "url"
    project_slug: str | None = None
    tags: list[str] | None = None
    license_note: str | None = None


class SeekDownloadResponse(BaseModel):
    path: str
    message: str


@router.get("/status")
async def seek_status(settings: Settings = Depends(get_settings)) -> dict:
    from cinearchive.pipelines.media_download import yt_dlp_available

    return {
        "enabled": bool(settings.seek_enabled),
        "download_dir": settings.seek_download_dir,
        "providers": ["url", "youtube", "vimeo", "tiktok", "instagram", "x", "stub"],
        "yt_dlp": yt_dlp_available(),
        "note": "Paste a URL in the project drop zone. Uses local yt-dlp (not Downr). One clip at a time; --no-playlist.",
    }


class SeekImportLinkRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    project_id: str | None = None
    project_slug: str | None = None
    title: str | None = None
    ingest: bool = True


@router.post("/import-link", response_model=SeekDownloadResponse)
async def seek_import_link(
    body: SeekImportLinkRequest,
    background: BackgroundTasks,
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
) -> SeekDownloadResponse:
    """Drop a YouTube / Vimeo / direct URL — download into library and optionally ingest."""
    if not settings.seek_enabled:
        # Allow link import even when catalog seek is off — local archive growth
        pass
    from cinearchive.pipelines.media_download import download_stream, is_stream_url
    from cinearchive.pipelines.inspiration_seek import InspirationSeek, SeekCandidate
    from cinearchive.repositories.project_repo import ProjectRepository
    from cinearchive.services.ingest_service import IngestService
    from cinearchive.utils.paths import project_video_dir

    slug = body.project_slug
    project_id = body.project_id
    if project_id:
        project = await ProjectRepository(session).get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        slug = project.slug
        dest = project_video_dir(settings, slug)
    else:
        dest = InspirationSeek(settings).download_dir(slug)

    try:
        if is_stream_url(body.url):
            path = download_stream(body.url, dest, title_hint=body.title)
        else:
            seek = InspirationSeek(settings)
            path = await seek.download(
                SeekCandidate(
                    title=body.title or "link_asset",
                    source="url",
                    url=body.url,
                    tags=["link-import"],
                ),
                project_slug=slug,
                require_enabled=False,
            )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:500]) from exc

    msg = f"Downloaded to {path}"
    if body.ingest and project_id:
        try:
            from uuid import UUID as _UUID

            svc = IngestService(session, settings)
            suffix = path.suffix.lower()
            if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}:
                res = await svc.ingest_images_paths(
                    _UUID(project_id),
                    [str(path)],
                    recursive=False,
                    background=background,
                )
            else:
                res = await svc.ingest_videos_paths(
                    _UUID(project_id),
                    [str(path)],
                    recursive=False,
                    background=background,
                )
            msg = f"Downloaded and ingest queued ({res.job.id})"
        except Exception as exc:
            msg = f"Downloaded to {path}; ingest failed: {exc}"

    return SeekDownloadResponse(path=str(path), message=msg)


@router.post("/search", response_model=SeekSearchResponse)
async def seek_search(
    body: SeekSearchRequest,
    settings: Settings = Depends(get_settings),
) -> SeekSearchResponse:
    seek = InspirationSeek(settings)
    if not seek.enabled:
        return SeekSearchResponse(enabled=False, results=[])
    try:
        results = await seek.search(body.query, limit=body.limit)
    except RuntimeError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return SeekSearchResponse(
        enabled=True,
        results=[
            SeekCandidateOut(
                title=c.title,
                source=c.source,
                url=c.url,
                thumb_url=c.thumb_url,
                tags=c.tags,
                license_note=c.license_note,
            )
            for c in results
        ],
    )


@router.post("/download", response_model=SeekDownloadResponse)
async def seek_download(
    body: SeekDownloadRequest,
    settings: Settings = Depends(get_settings),
) -> SeekDownloadResponse:
    seek = InspirationSeek(settings)
    if not seek.enabled:
        raise HTTPException(
            status_code=403,
            detail="Inspiration Seek is disabled. Set SEEK_ENABLED=true to opt in.",
        )
    candidate = SeekCandidate(
        title=body.title,
        source=body.source,
        url=body.url,
        tags=body.tags,
        license_note=body.license_note,
    )
    try:
        path = await seek.download(candidate, project_slug=body.project_slug)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)[:500]) from exc
    return SeekDownloadResponse(
        path=str(path),
        message="Downloaded into seek inbox. Run project ingest on that folder to archive.",
    )
