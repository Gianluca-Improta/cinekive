"""Collections / works / moodboards service."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.db.models.collection import Collection, CollectionShot
from cinearchive.db.models.shot import Shot
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.schemas.collection import CollectionCreate, CollectionDetail, CollectionRead
from cinearchive.services.shot_mapper import shot_to_read


def _to_read(col: Collection, shot_count: int = 0) -> CollectionRead:
    return CollectionRead(
        id=col.id,  # type: ignore[arg-type]
        project_id=col.project_id,  # type: ignore[arg-type]
        name=col.name,
        description=col.description,
        kind=getattr(col, "kind", None) or "moodboard",
        year=getattr(col, "year", None),
        content_format=getattr(col, "content_format", None),
        sampling_mode=getattr(col, "sampling_mode", None) or "moments",
        cover_shot_id=getattr(col, "cover_shot_id", None),
        meta=dict(getattr(col, "meta_json", None) or {}),
        shot_count=shot_count,
        created_at=col.created_at,
    )


class CollectionService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.shots = ShotRepository(session)

    async def create(self, data: CollectionCreate) -> CollectionRead:
        col = Collection(
            id=str(uuid4()),
            name=data.name,
            description=data.description,
            project_id=str(data.project_id) if data.project_id else None,
            kind=data.kind,
            year=data.year,
            content_format=data.content_format,
            sampling_mode=data.sampling_mode,
            meta_json=dict(data.meta or {}),
        )
        self.session.add(col)
        await self.session.flush()
        await self.session.commit()
        return _to_read(col, 0)

    async def list(
        self,
        project_id: UUID | None = None,
        kind: str | None = None,
    ) -> list[CollectionRead]:
        q = select(Collection).order_by(Collection.created_at.desc())
        if project_id:
            q = q.where(Collection.project_id == str(project_id))
        if kind:
            q = q.where(Collection.kind == kind)
        cols = list((await self.session.execute(q)).scalars().all())
        out: list[CollectionRead] = []
        for c in cols:
            count = int(
                (
                    await self.session.execute(
                        select(func.count())
                        .select_from(CollectionShot)
                        .where(CollectionShot.collection_id == c.id)
                    )
                ).scalar_one()
            )
            # Also count shots linked via shot.collection_id (work archives)
            linked = int(
                (
                    await self.session.execute(
                        select(func.count()).select_from(Shot).where(Shot.collection_id == c.id)
                    )
                ).scalar_one()
            )
            out.append(_to_read(c, max(count, linked)))
        return out

    async def get(self, collection_id: UUID) -> CollectionDetail | None:
        col = await self.session.get(Collection, str(collection_id))
        if not col:
            return None
        links = list(
            (
                await self.session.execute(
                    select(CollectionShot)
                    .where(CollectionShot.collection_id == col.id)
                    .order_by(CollectionShot.position)
                )
            ).scalars().all()
        )
        shot_ids = [l.shot_id for l in links]
        if not shot_ids:
            # Fall back to shots with collection_id FK (work ingest)
            linked_shots = list(
                (
                    await self.session.execute(
                        select(Shot)
                        .where(Shot.collection_id == col.id)
                        .order_by(Shot.hero_score.desc(), Shot.start_timecode_ms.asc())
                    )
                ).scalars().all()
            )
            ordered = [shot_to_read(s) for s in linked_shots]
        else:
            shots = await self.shots.get_many(shot_ids)
            by_id = {s.id: s for s in shots}
            ordered = [shot_to_read(by_id[sid]) for sid in shot_ids if sid in by_id]
        base = _to_read(col, len(ordered))
        return CollectionDetail(**base.model_dump(), shots=ordered)

    async def add_shots(self, collection_id: UUID, shot_ids: list[UUID]) -> CollectionDetail:
        col = await self.session.get(Collection, str(collection_id))
        if not col:
            raise ValueError("Collection not found")
        existing = {
            r.shot_id
            for r in (
                await self.session.execute(
                    select(CollectionShot).where(CollectionShot.collection_id == col.id)
                )
            ).scalars().all()
        }
        pos = len(existing)
        for sid in shot_ids:
            if str(sid) in existing:
                continue
            self.session.add(
                CollectionShot(
                    id=str(uuid4()),
                    collection_id=col.id,
                    shot_id=str(sid),
                    position=pos,
                )
            )
            # Also stamp work FK when collection is a work/reel
            if col.kind in ("work", "reel"):
                shot = await self.session.get(Shot, str(sid))
                if shot and not shot.collection_id:
                    shot.collection_id = col.id
            pos += 1
        await self.session.commit()
        detail = await self.get(collection_id)
        assert detail
        return detail

    async def update(
        self,
        collection_id: UUID,
        *,
        name: str | None = None,
        description: str | None = None,
        meta: dict | None = None,
    ) -> CollectionRead:
        col = await self.session.get(Collection, str(collection_id))
        if not col:
            raise ValueError("Collection not found")
        if name is not None:
            col.name = name
        if description is not None:
            col.description = description
        if meta is not None:
            # Merge so canvas layout updates don't wipe other keys
            current = dict(col.meta_json or {})
            current.update(meta)
            col.meta_json = current
        await self.session.commit()
        await self.session.refresh(col)
        return _to_read(col, 0)

    async def remove_shots(self, collection_id: UUID, shot_ids: list[UUID]) -> CollectionDetail:
        col = await self.session.get(Collection, str(collection_id))
        if not col:
            raise ValueError("Collection not found")
        ids = {str(s) for s in shot_ids}
        links = list(
            (
                await self.session.execute(
                    select(CollectionShot).where(CollectionShot.collection_id == col.id)
                )
            ).scalars().all()
        )
        for link in links:
            if link.shot_id in ids:
                await self.session.delete(link)
        await self.session.commit()
        detail = await self.get(collection_id)
        assert detail
        return detail

    async def delete(self, collection_id: UUID) -> bool:
        col = await self.session.get(Collection, str(collection_id))
        if not col:
            return False
        await self.session.delete(col)
        await self.session.commit()
        return True
