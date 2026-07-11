"""Ingest service — queue jobs and save uploads into browsable library folders."""

from __future__ import annotations

import shutil
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import BackgroundTasks, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.job import Job
from cinearchive.jobs.runner import run_ingest_job
from cinearchive.repositories.job_repo import JobRepository
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.schemas.ingest import IngestResponse
from cinearchive.schemas.job import JobRead
from cinearchive.utils.paths import project_video_dir


class IngestService:
    def __init__(self, session: AsyncSession, settings: Settings) -> None:
        self.session = session
        self.settings = settings
        self.projects = ProjectRepository(session)
        self.jobs = JobRepository(session)

    async def _require_project(self, project_id: UUID):
        project = await self.projects.get(project_id)
        if not project:
            raise ValueError("Project not found")
        return project

    def _dest_dir(self, project) -> Path:
        # Prefer slug-based library path; fall back to video_dir field
        slug = project.slug or project.video_dir
        return project_video_dir(self.settings, slug)

    async def ingest_videos_upload(
        self,
        project_id: UUID,
        files: list[UploadFile],
        background: BackgroundTasks,
    ) -> IngestResponse:
        project = await self._require_project(project_id)
        dest_dir = self._dest_dir(project)
        saved: list[str] = []
        for upload in files:
            if not upload.filename:
                continue
            safe_name = Path(upload.filename).name
            dest = dest_dir / f"{uuid4().hex[:8]}_{safe_name}"
            with dest.open("wb") as out:
                shutil.copyfileobj(upload.file, out)
            saved.append(str(dest))

        if not saved:
            raise ValueError("No files uploaded")

        return await self._enqueue(
            project_id=project_id,
            job_type="ingest_video",
            mode="video",
            paths=saved,
            sampling_mode=project.sampling_mode,
            generate_previews=project.generate_previews,
            background=background,
        )

    async def ingest_videos_paths(
        self,
        project_id: UUID,
        paths: list[str],
        recursive: bool,
        background: BackgroundTasks,
    ) -> IngestResponse:
        project = await self._require_project(project_id)
        return await self._enqueue(
            project_id=project_id,
            job_type="ingest_video",
            mode="video",
            paths=paths,
            recursive=recursive,
            sampling_mode=project.sampling_mode,
            generate_previews=project.generate_previews,
            background=background,
        )

    async def ingest_images_upload(
        self,
        project_id: UUID,
        files: list[UploadFile],
        background: BackgroundTasks,
        *,
        relative_paths: list[str] | None = None,
    ) -> IngestResponse:
        """Upload stills, preserving relative folder paths when provided.

        Dropping ``_shotdeck/by_movie/Blade Runner/…`` keeps that tree so ingest
        can still detect ShotDeck / FilmGrab / EyeCandy routing from path segments.
        Pass ``relative_paths`` aligned with ``files`` (browsers strip slashes from File.name).
        """
        project = await self._require_project(project_id)
        kind = (getattr(project, "kind", None) or "").lower()
        if kind == "archive":
            from cinearchive.utils.paths import library_root

            dest_root = library_root(self.settings) / "_archives" / project.slug
        else:
            dest_root = self._dest_dir(project) / "stills"
        dest_root.mkdir(parents=True, exist_ok=True)
        saved: list[str] = []
        rels = relative_paths or []
        for idx, upload in enumerate(files):
            if not upload.filename and not (idx < len(rels) and rels[idx]):
                continue
            raw = (rels[idx] if idx < len(rels) and rels[idx] else upload.filename or "").replace(
                "\\", "/"
            )
            parts = [p for p in raw.split("/") if p and p not in {".", ".."}]
            if not parts:
                continue
            if any(p.startswith(".") for p in parts[:-1]):
                continue
            rel = Path(*parts)
            dest = dest_root / rel
            if len(parts) == 1:
                dest = dest_root / "inbox" / f"{uuid4().hex[:8]}_{parts[0]}"
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open("wb") as out:
                shutil.copyfileobj(upload.file, out)
            saved.append(str(dest))
        if not saved:
            raise ValueError("No files uploaded")
        return await self._enqueue(
            project_id=project_id,
            job_type="ingest_images",
            mode="images",
            paths=saved,
            sampling_mode=project.sampling_mode,
            generate_previews=False,
            background=background,
        )

    async def ingest_images_paths(
        self,
        project_id: UUID,
        paths: list[str],
        recursive: bool,
        background: BackgroundTasks,
    ) -> IngestResponse:
        project = await self._require_project(project_id)
        return await self._enqueue(
            project_id=project_id,
            job_type="ingest_images",
            mode="images",
            paths=paths,
            recursive=recursive,
            sampling_mode=project.sampling_mode,
            generate_previews=False,
            background=background,
        )

    async def _enqueue(
        self,
        *,
        project_id: UUID,
        job_type: str,
        mode: str,
        paths: list[str],
        background: BackgroundTasks,
        recursive: bool = True,
        sampling_mode: str = "fast",
        generate_previews: bool = True,
        collection_id: str | None = None,
    ) -> IngestResponse:
        job = Job(
            id=str(uuid4()),
            project_id=str(project_id),
            type=job_type,
            status="pending",
            progress_pct=0.0,
            current_step="queued",
            total_items=0,
            processed_items=0,
            payload_json={
                "paths": paths,
                "mode": mode,
                "recursive": recursive,
                "sampling_mode": sampling_mode,
                "generate_previews": generate_previews,
                "collection_id": collection_id,
            },
        )
        await self.jobs.create(job)
        await self.session.commit()

        background.add_task(
            run_ingest_job,
            job.id,
            str(project_id),
            paths,
            mode=mode,
            recursive=recursive,
            sampling_mode=sampling_mode,
            generate_previews=generate_previews,
            collection_id=collection_id,
            settings=self.settings,
        )

        return IngestResponse(
            job=JobRead.model_validate(job),
            message="Ingest job queued",
        )

    async def ingest_into_collection(
        self,
        collection_id: UUID,
        *,
        project_id: UUID,
        paths: list[str],
        recursive: bool,
        sampling_mode: str | None,
        generate_previews: bool,
        background: BackgroundTasks,
    ) -> IngestResponse:
        from cinearchive.db.models.collection import Collection

        col = await self.session.get(Collection, str(collection_id))
        if not col:
            raise ValueError("Collection not found")
        mode = sampling_mode or col.sampling_mode or "moments"
        return await self._enqueue(
            project_id=project_id,
            job_type="ingest_video",
            mode="video",
            paths=paths,
            recursive=recursive,
            sampling_mode=mode,
            generate_previews=generate_previews,
            collection_id=str(collection_id),
            background=background,
        )
