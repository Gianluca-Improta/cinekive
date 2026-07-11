"""Bootstrap source archives — ShotDeck, FilmGrab, EyeCandy."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_settings
from cinearchive.config import Settings
from cinearchive.schemas.ingest import IngestResponse
from cinearchive.services.credentials_service import (
    mask_user,
    save_source as save_source_credentials,
    status_for_sources,
)
from cinearchive.services.ingest_service import IngestService
from cinearchive.services.sources_service import (
    CATALOG_SUGGESTIONS,
    SOURCES,
    refresh_mirror_run_state,
    scan_all,
    scan_source,
    start_mirror,
)
from cinearchive.services.project_service import ProjectService
from cinearchive.schemas.project import ProjectCreate, ProjectRead
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.utils.paths import library_root, slugify

router = APIRouter(tags=["sources"])


class SourceIngestRequest(BaseModel):
    source: str = Field(description="shotdeck | filmgrab | eyecandy")
    recursive: bool = True


class MirrorRunRequest(BaseModel):
    source: str = "filmgrab"
    limit_tasks: int | None = Field(default=3, ge=1, le=500)
    limit_pages: int | None = Field(default=2, ge=1, le=500)
    limit_shots: int | None = Field(default=30, ge=1, le=5000)
    limit_films: int | None = Field(default=None, ge=1, le=10_000)
    limit_per_tech: int | None = Field(default=None, ge=1, le=2000)
    max_clips: int | None = Field(default=None, ge=1, le=50_000)
    discover_only: bool = False
    user: str | None = Field(default=None, max_length=320)
    password: str | None = Field(default=None, max_length=512)


class SourceCredentialsRequest(BaseModel):
    source: str = Field(description="shotdeck | stillslab | moviestillsdb (optional full-res)")
    user: str = Field(min_length=1, max_length=320)
    password: str = Field(min_length=1, max_length=512)


class CustomArchiveCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    site_url: str | None = Field(default=None, max_length=500)
    # Optional note for a service you plan to mirror later
    source_note: str | None = Field(default=None, max_length=1000)


@router.get("/sources/status")
async def sources_status(
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    items = scan_all(settings)
    mirror_runs = {key: refresh_mirror_run_state(settings, key) for key in SOURCES}
    gated_keys = [k for k, s in SOURCES.items() if s.access == "gated"]
    optional_keys = ["moviestillsdb"]
    cred_status = status_for_sources(library_root(settings), gated_keys + optional_keys)

    # User-created archive projects (kind=archive)
    custom: list[dict] = []
    try:
        projects = await ProjectRepository(session).list()
        builtin_slugs = {s.archive_slug for s in SOURCES.values() if s.archive_slug}
        for p in projects:
            kind = (getattr(p, "kind", None) or "").lower()
            if kind != "archive":
                continue
            if (p.slug or "") in builtin_slugs:
                continue
            custom.append(
                {
                    "id": str(p.id),
                    "name": p.name,
                    "slug": p.slug,
                    "description": p.description,
                    "shot_count": await ProjectRepository(session).shot_count(p.id),
                    "folder": str(library_root(settings) / "_archives" / p.slug),
                }
            )
    except Exception:
        custom = []

    return {
        "sources": items,
        "custom_archives": custom,
        "suggestions": CATALOG_SUGGESTIONS,
        "mirror_runs": mirror_runs,
        "credentials": cred_status,
        "shotdeck_mirror_run": mirror_runs.get("shotdeck") or {},
        "shotdeck_credentials_configured": cred_status.get("shotdeck", {}).get("configured", False),
        "note": (
            "Archives hub — built-in mirrors plus your own still libraries. "
            "Never commit ./data."
        ),
    }


@router.post("/archives", response_model=ProjectRead, status_code=201)
async def create_custom_archive(
    body: CustomArchiveCreate,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> ProjectRead:
    """Create a user archive project + on-disk folder for stills from any source."""
    base = slugify(body.name)
    folder = library_root(settings) / "_archives" / base
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "inbox").mkdir(exist_ok=True)

    desc_parts = [body.description or "Custom still archive"]
    if body.site_url:
        desc_parts.append(f"Source: {body.site_url}")
    if body.source_note:
        desc_parts.append(body.source_note)

    project = await ProjectService(session, settings).create(
        ProjectCreate(
            name=body.name.strip(),
            description=" · ".join(desc_parts),
            slug=base,
            kind="archive",
            sampling_mode="heroes",
            generate_previews=False,
            vlm_enrichment=True,
        )
    )
    return project


@router.post("/archives/{project_id}/upload", response_model=IngestResponse)
async def upload_to_archive(
    project_id: UUID,
    background: BackgroundTasks,
    files: list[UploadFile] = File(...),
    relative_paths: list[str] | None = Form(default=None),
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Drop stills/GIFs into a custom (or any) archive project. Folders keep structure."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Archive not found")
    service = IngestService(session, settings)
    try:
        return await service.ingest_images_upload(
            project_id, files, background, relative_paths=relative_paths
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/archives/{project_id}/ingest-folder", response_model=IngestResponse)
async def ingest_archive_folder(
    project_id: UUID,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    recursive: bool = True,
) -> IngestResponse:
    """Ingest files already under data/library/_archives/{slug}/ for this archive."""
    project = await ProjectRepository(session).get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Archive not found")
    folder = library_root(settings) / "_archives" / project.slug
    if not folder.exists():
        raise HTTPException(
            status_code=400,
            detail=f"No folder at {folder}. Drop files via upload or copy into that path.",
        )
    # Prefer container path when running in Docker
    ingest_path = f"/data/library/_archives/{project.slug}"
    service = IngestService(session, settings)
    try:
        return await service.ingest_images_paths(
            project_id, [ingest_path], recursive, background
        )
    except ValueError as exc:
        # Fall back to host path
        try:
            return await service.ingest_images_paths(
                project_id, [str(folder)], recursive, background
            )
        except ValueError as exc2:
            raise HTTPException(status_code=400, detail=str(exc2)) from exc2


@router.post("/sources/{source_key}/ingest", response_model=IngestResponse)
async def ingest_archive_source(
    source_key: str,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    recursive: bool = True,
) -> IngestResponse:
    """Ensure the dedicated archive project exists, then ingest the mirrored folder into it."""
    spec = SOURCES.get(source_key)
    if not spec:
        raise HTTPException(status_code=400, detail=f"Unknown source: {source_key}")
    if spec.access == "gated" and source_key == "shotdeck":
        # Allow ingest of already-local files only; no encouragement to scrape
        pass

    repo = ProjectRepository(session)
    project = None
    if spec.archive_slug:
        project = await repo.get_by_slug(spec.archive_slug)
    if not project:
        for p in await repo.list():
            if (p.name or "").lower() == (spec.archive_name or "").lower():
                project = p
                break
    if not project:
        project_read = await ProjectService(session, settings).create(
            ProjectCreate(
                name=spec.archive_name or spec.label,
                description=spec.description or None,
                slug=spec.archive_slug or None,
                kind="archive",
                sampling_mode="heroes",
                generate_previews=False,
                vlm_enrichment=True,
            )
        )
        project_id = UUID(str(project_read.id))
    else:
        project_id = UUID(str(project.id))

    service = IngestService(session, settings)
    try:
        return await service.ingest_images_paths(
            project_id,
            [spec.ingest_path],
            recursive,
            background,
        )
    except ValueError as exc:
        code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.get("/sources/{source_key}/status")
async def source_status(source_key: str, settings: Settings = Depends(get_settings)) -> dict:
    try:
        return scan_source(settings, source_key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/projects/{project_id}/sources/ingest", response_model=IngestResponse)
async def ingest_source(
    project_id: UUID,
    body: SourceIngestRequest,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    """Legacy: ingest a source into an arbitrary project. Prefer POST /sources/{key}/ingest."""
    spec = SOURCES.get(body.source)
    if not spec:
        raise HTTPException(status_code=400, detail=f"Unknown source: {body.source}")
    service = IngestService(session, settings)
    try:
        return await service.ingest_images_paths(
            project_id,
            [spec.ingest_path],
            body.recursive,
            background,
        )
    except ValueError as exc:
        code = 404 if "not found" in str(exc).lower() else 400
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@router.post("/sources/credentials")
async def save_credentials(
    body: SourceCredentialsRequest,
    settings: Settings = Depends(get_settings),
) -> dict:
    """Save subscription credentials locally for a gated archive mirror."""
    if body.source not in SOURCES:
        raise HTTPException(status_code=400, detail=f"Unknown source: {body.source}")
    save_source_credentials(
        library_root(settings),
        body.source,
        body.user.strip(),
        body.password,
    )
    return {
        "source": body.source,
        "configured": True,
        "user_hint": mask_user(body.user.strip()),
        "message": f"{SOURCES[body.source].label} credentials saved locally",
    }


@router.get("/sources/credentials")
async def list_credentials(settings: Settings = Depends(get_settings)) -> dict:
    keys = [k for k, s in SOURCES.items() if s.access == "gated"] + ["moviestillsdb"]
    return {"credentials": status_for_sources(library_root(settings), keys)}


@router.post("/sources/mirror/run")
async def run_mirror(
    body: MirrorRunRequest,
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        return start_mirror(
            settings,
            source=body.source,
            limit_tasks=body.limit_tasks,
            limit_pages=body.limit_pages,
            limit_shots=body.limit_shots,
            limit_films=body.limit_films,
            limit_per_tech=body.limit_per_tech,
            max_clips=body.max_clips,
            discover_only=body.discover_only,
            user=body.user,
            password=body.password,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
