"""Project service."""

from __future__ import annotations

import shutil
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.project import Project
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.project import ProjectCreate, ProjectRead, ProjectUpdate
from cinearchive.utils.paths import (
    legacy_project_artifact_dir,
    legacy_project_video_dir,
    project_library_dir,
    project_shots_dir,
    project_video_dir,
    slugify,
)


class ProjectService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        vector_repo: VectorRepository | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.repo = ProjectRepository(session)
        self.vector_repo = vector_repo

    async def create(self, data: ProjectCreate) -> ProjectRead:
        preferred = (data.slug or "").strip()
        base_slug = slugify(preferred) if preferred else slugify(data.name)
        slug = base_slug
        n = 1
        while await self.repo.get_by_slug(slug):
            n += 1
            slug = f"{base_slug}-{n}"

        project_id = str(uuid4())
        # video_dir stores the library-relative project folder (slug)
        project = Project(
            id=project_id,
            name=data.name,
            slug=slug,
            description=data.description,
            kind=getattr(data, "kind", None) or "commercial",
            form_factor=getattr(data, "form_factor", None),
            aspect_ratio=getattr(data, "aspect_ratio", None),
            brief=getattr(data, "brief", None),
            feeling=getattr(data, "feeling", None),
            references_text=getattr(data, "references_text", None),
            sampling_mode=data.sampling_mode,
            generate_previews=data.generate_previews,
            video_dir=slug,
            vlm_enrichment=data.vlm_enrichment,
            watch_folder=data.watch_folder,
            watch_enabled=data.watch_enabled,
        )
        await self.repo.create(project)
        project_video_dir(self.settings, slug)
        project_shots_dir(self.settings, slug)
        # Default watch inbox for auto-ingest
        inbox = project_video_dir(self.settings, slug) / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        await self.session.commit()
        return await self.to_read(project)

    async def update(self, project_id: UUID, data: ProjectUpdate) -> ProjectRead | None:
        project = await self.repo.get(project_id)
        if not project:
            return None
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(project, field, value)
        await self.session.flush()
        await self.session.commit()
        return await self.to_read(project)

    async def list(self) -> list[ProjectRead]:
        projects = await self.repo.list()
        return [await self.to_read(p) for p in projects]

    async def get(self, project_id: UUID) -> ProjectRead | None:
        project = await self.repo.get(project_id)
        if not project:
            return None
        return await self.to_read(project)

    async def delete(self, project_id: UUID) -> bool:
        project = await self.repo.get(project_id)
        if not project:
            return False

        if self.vector_repo:
            try:
                self.vector_repo.delete_by_project(project_id)
            except Exception:
                pass

        # Remove library folder + any legacy UUID folders
        for path in (
            project_library_dir(self.settings, project.slug),
            legacy_project_video_dir(self.settings, UUID(str(project_id))),
            legacy_project_artifact_dir(self.settings, UUID(str(project_id))),
        ):
            if path.exists():
                shutil.rmtree(path, ignore_errors=True)

        await self.repo.delete(project)
        await self.session.commit()
        return True

    async def to_read(self, project: Project) -> ProjectRead:
        count = await self.repo.shot_count(project.id)
        return ProjectRead(
            id=project.id,  # type: ignore[arg-type]
            name=project.name,
            slug=project.slug,
            description=project.description,
            kind=getattr(project, "kind", None) or "commercial",
            form_factor=getattr(project, "form_factor", None),
            aspect_ratio=getattr(project, "aspect_ratio", None),
            brief=getattr(project, "brief", None),
            feeling=getattr(project, "feeling", None),
            references_text=getattr(project, "references_text", None),
            sampling_mode=project.sampling_mode,
            generate_previews=project.generate_previews,
            video_dir=project.video_dir,
            vlm_enrichment=bool(getattr(project, "vlm_enrichment", False)),
            watch_folder=getattr(project, "watch_folder", None),
            watch_enabled=bool(getattr(project, "watch_enabled", False)),
            shot_count=count,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
