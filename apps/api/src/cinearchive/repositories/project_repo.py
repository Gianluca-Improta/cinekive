"""Project repository."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.db.models.project import Project
from cinearchive.db.models.shot import Shot


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(self, project: Project) -> Project:
        self.session.add(project)
        await self.session.flush()
        return project

    async def get(self, project_id: UUID | str) -> Project | None:
        return await self.session.get(Project, str(project_id))

    async def get_by_slug(self, slug: str) -> Project | None:
        result = await self.session.execute(select(Project).where(Project.slug == slug))
        return result.scalar_one_or_none()

    async def list(self) -> list[Project]:
        result = await self.session.execute(select(Project).order_by(Project.created_at.desc()))
        return list(result.scalars().all())

    async def delete(self, project: Project) -> None:
        await self.session.delete(project)
        await self.session.flush()

    async def shot_count(self, project_id: UUID | str) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(Shot).where(Shot.project_id == str(project_id))
        )
        return int(result.scalar_one())
