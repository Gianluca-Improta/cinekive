"""Shot repository."""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.db.models.shot import Shot


class ShotRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_source_paths(self, project_id: UUID | str) -> set[str]:
        result = await self.session.execute(
            select(Shot.source_path).where(
                Shot.project_id == str(project_id),
                Shot.deleted_at.is_(None),
            )
        )
        return {str(row[0]) for row in result.all() if row[0]}

    async def create(self, shot: Shot) -> Shot:
        self.session.add(shot)
        await self.session.flush()
        return shot

    async def create_many(self, shots: list[Shot]) -> list[Shot]:
        self.session.add_all(shots)
        await self.session.flush()
        return shots

    async def get(self, shot_id: UUID | str) -> Shot | None:
        return await self.session.get(Shot, str(shot_id))

    async def get_many(self, shot_ids: list[str]) -> list[Shot]:
        if not shot_ids:
            return []
        result = await self.session.execute(select(Shot).where(Shot.id.in_(shot_ids)))
        return list(result.scalars().all())

    async def search_text(
        self,
        query: str,
        *,
        project_id: UUID | str | None = None,
        has_preview: bool | None = None,
        is_favorite: bool | None = None,
        is_hero: bool | None = None,
        is_moving: bool | None = None,
        hide_duplicates: bool | None = True,
        shot_type: str | None = None,
        mood_vibe: str | None = None,
        composition: str | None = None,
        content_format: str | None = None,
        emotion: str | None = None,
        technique: str | None = None,
        era: str | None = None,
        origin: str | None = None,
        ism: str | None = None,
        director: str | None = None,
        visual_style: str | None = None,
        theme: str | None = None,
        genre: str | None = None,
        shape: str | None = None,
        color_hex: str | None = None,
        tag: str | None = None,
        limit: int = 400,
    ) -> list[Shot]:
        """Keyword / metadata search across titles, paths, tags, and craft text.

        Used so queries like \"Blade Runner 2049\" return that film's shots even when
        visual embeddings alone would miss them.
        """
        q = (query or "").strip()
        if not q:
            return []

        from sqlalchemy import cast, String

        filters = [Shot.deleted_at.is_(None)]
        if project_id is not None:
            filters.append(Shot.project_id == str(project_id))
        if has_preview is not None:
            filters.append(Shot.has_preview == has_preview)
        if is_favorite is not None:
            filters.append(Shot.is_favorite == is_favorite)
        if is_hero is not None:
            filters.append(Shot.is_hero == is_hero)
        if is_moving is not None:
            filters.append(Shot.is_moving == is_moving)
        if hide_duplicates:
            filters.append(Shot.is_duplicate == False)  # noqa: E712
        if shot_type:
            filters.append(Shot.shot_type == shot_type)
        if mood_vibe:
            filters.append(Shot.mood_vibe.ilike(f"%{mood_vibe}%"))
        if composition:
            filters.append(Shot.composition == composition)
        if content_format:
            filters.append(Shot.content_format == content_format)
        if emotion:
            filters.append(Shot.emotion == emotion)
        if era:
            filters.append(Shot.era == era)
        if origin:
            filters.append(Shot.origin == origin)
        if ism:
            filters.append(Shot.ism == ism)
        if visual_style:
            filters.append(Shot.visual_style == visual_style)
        if theme:
            filters.append(Shot.theme == theme)
        if genre:
            filters.append(Shot.genre == genre)
        if tag:
            filters.append(cast(Shot.tags_json, String).like(f'%"{tag}"%'))
        if technique:
            filters.append(cast(Shot.techniques_json, String).like(f'%"{technique}"%'))
        if shape:
            filters.append(cast(Shot.shapes_json, String).like(f'%"{shape}"%'))
        if color_hex:
            hx = color_hex.strip().upper()
            filters.append(cast(Shot.dominant_colors_json, String).ilike(f"%{hx}%"))
        if director:
            d = director.strip()
            filters.append(
                or_(
                    cast(Shot.source_meta_json, String).ilike(f"%{d}%"),
                    cast(Shot.tags_json, String).ilike(f"%director:{d}%"),
                    cast(Shot.tags_json, String).ilike(f'%"{d}"%'),
                )
            )

        # Tokenize: require significant tokens; keep short years (e.g. 2049)
        tokens = [t for t in re.findall(r"[a-z0-9]+", q.lower()) if len(t) >= 2]
        # Drop ultra-common stopwords that hurt film-title matching
        stop = {"the", "a", "an", "of", "and", "or", "in", "on", "to", "for"}
        tokens = [t for t in tokens if t not in stop] or [
            t for t in re.findall(r"[a-z0-9]+", q.lower()) if len(t) >= 2
        ]
        if not tokens:
            return []

        # Prefer phrase match on title/path; also AND significant tokens across searchable text
        phrase = f"%{q}%"
        phrase_clause = or_(
            Shot.source_title.ilike(phrase),
            Shot.source_filename.ilike(phrase),
            Shot.source_path.ilike(phrase),
            cast(Shot.source_meta_json, String).ilike(phrase),
            Shot.subject.ilike(phrase),
            Shot.mood_vibe.ilike(phrase),
            Shot.creative_intent.ilike(phrase),
            Shot.dialogue_text.ilike(phrase),
            cast(Shot.tags_json, String).ilike(phrase),
            cast(Shot.techniques_json, String).ilike(phrase),
        )

        token_clauses = []
        for tok in tokens[:8]:
            like = f"%{tok}%"
            token_clauses.append(
                or_(
                    Shot.source_title.ilike(like),
                    Shot.source_filename.ilike(like),
                    Shot.source_path.ilike(like),
                    cast(Shot.source_meta_json, String).ilike(like),
                    Shot.subject.ilike(like),
                    cast(Shot.tags_json, String).ilike(like),
                    Shot.mood_vibe.ilike(like),
                    Shot.creative_intent.ilike(like),
                    Shot.dialogue_text.ilike(like),
                    cast(Shot.techniques_json, String).ilike(like),
                    Shot.shot_type.ilike(like),
                    Shot.composition.ilike(like),
                    Shot.genre.ilike(like),
                    Shot.theme.ilike(like),
                    Shot.visual_style.ilike(like),
                    Shot.era.ilike(like),
                    Shot.emotion.ilike(like),
                )
            )

        # Phrase OR (all tokens present somewhere in metadata)
        text_match = phrase_clause
        if token_clauses:
            text_match = or_(phrase_clause, and_(*token_clauses))

        list_q = (
            select(Shot)
            .where(*filters)
            .where(text_match)
            .order_by(Shot.hero_score.desc(), Shot.source_title.asc(), Shot.created_at.desc())
            .limit(max(1, min(limit, 2000)))
        )
        result = await self.session.execute(list_q)
        return list(result.scalars().all())

    async def list(
        self,
        *,
        project_id: UUID | str | None = None,
        has_preview: bool | None = None,
        is_favorite: bool | None = None,
        is_hero: bool | None = None,
        hide_duplicates: bool | None = True,
        shot_type: str | None = None,
        mood_vibe: str | None = None,
        composition: str | None = None,
        lighting_style: str | None = None,
        content_format: str | None = None,
        emotion: str | None = None,
        is_moving: bool | None = None,
        tag: str | None = None,
        technique: str | None = None,
        era: str | None = None,
        origin: str | None = None,
        ism: str | None = None,
        director: str | None = None,
        visual_style: str | None = None,
        theme: str | None = None,
        genre: str | None = None,
        shape: str | None = None,
        color_hex: str | None = None,
        randomize: bool = False,
        offset: int = 0,
        limit: int = 48,
    ) -> tuple[list[Shot], int]:
        filters = []
        # Soft-deleted shots live in the bin — hide from normal grids
        filters.append(Shot.deleted_at.is_(None))
        if project_id is not None:
            filters.append(Shot.project_id == str(project_id))
        if has_preview is not None:
            filters.append(Shot.has_preview == has_preview)
        if is_favorite is not None:
            filters.append(Shot.is_favorite == is_favorite)
        if is_hero is not None:
            filters.append(Shot.is_hero == is_hero)
        if is_moving is not None:
            filters.append(Shot.is_moving == is_moving)
        if hide_duplicates:
            filters.append(Shot.is_duplicate == False)  # noqa: E712
        if shot_type:
            filters.append(Shot.shot_type == shot_type)
        if mood_vibe:
            filters.append(Shot.mood_vibe.ilike(f"%{mood_vibe}%"))
        if composition:
            filters.append(Shot.composition == composition)
        if lighting_style:
            filters.append(Shot.lighting_style == lighting_style)
        if content_format:
            filters.append(Shot.content_format == content_format)
        if emotion:
            filters.append(Shot.emotion == emotion)
        if era:
            filters.append(Shot.era == era)
        if origin:
            filters.append(Shot.origin == origin)
        if ism:
            filters.append(Shot.ism == ism)
        if visual_style:
            filters.append(Shot.visual_style == visual_style)
        if theme:
            filters.append(Shot.theme == theme)
        if genre:
            filters.append(Shot.genre == genre)
        if director:
            from sqlalchemy import cast, String

            d = director.strip()
            filters.append(
                or_(
                    cast(Shot.source_meta_json, String).ilike(f"%{d}%"),
                    cast(Shot.tags_json, String).ilike(f"%director:{d}%"),
                    cast(Shot.tags_json, String).ilike(f'%"{d}"%'),
                )
            )

        count_q = select(func.count()).select_from(Shot)
        if randomize:
            list_q = select(Shot).order_by(func.random()).offset(offset).limit(limit)
        else:
            list_q = (
                select(Shot)
                .order_by(Shot.hero_score.desc(), Shot.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
        for f in filters:
            count_q = count_q.where(f)
            list_q = list_q.where(f)

        from sqlalchemy import cast, String

        # Tag / technique filters via JSON text match (SQLite-friendly)
        if tag:
            like = f'%"{tag}"%'
            count_q = count_q.where(cast(Shot.tags_json, String).like(like))
            list_q = list_q.where(cast(Shot.tags_json, String).like(like))
        if technique:
            like_t = f'%"{technique}"%'
            count_q = count_q.where(cast(Shot.techniques_json, String).like(like_t))
            list_q = list_q.where(cast(Shot.techniques_json, String).like(like_t))
        if shape:
            like_s = f'%"{shape}"%'
            count_q = count_q.where(cast(Shot.shapes_json, String).like(like_s))
            list_q = list_q.where(cast(Shot.shapes_json, String).like(like_s))
        if color_hex:
            hx = color_hex.strip().upper()
            like_c = f"%{hx}%"
            count_q = count_q.where(cast(Shot.dominant_colors_json, String).ilike(like_c))
            list_q = list_q.where(cast(Shot.dominant_colors_json, String).ilike(like_c))

        total = int((await self.session.execute(count_q)).scalar_one())
        items = list((await self.session.execute(list_q)).scalars().all())
        return items, total

    async def list_deleted(
        self,
        *,
        project_id: UUID | str | None = None,
        offset: int = 0,
        limit: int = 48,
    ) -> tuple[list[Shot], int]:
        filters = [Shot.deleted_at.is_not(None)]
        if project_id is not None:
            filters.append(Shot.project_id == str(project_id))
        count_q = select(func.count()).select_from(Shot)
        list_q = (
            select(Shot)
            .order_by(Shot.deleted_at.desc())
            .offset(offset)
            .limit(limit)
        )
        for f in filters:
            count_q = count_q.where(f)
            list_q = list_q.where(f)
        total = int((await self.session.execute(count_q)).scalar_one())
        items = list((await self.session.execute(list_q)).scalars().all())
        return items, total

    async def list_unenriched(
        self, project_id: UUID | str, *, force: bool = False, limit: int = 10_000
    ) -> list[Shot]:
        # Keep in sync with enrich_runner.ENRICHMENT_VERSION
        from cinearchive.jobs.enrich_runner import ENRICHMENT_VERSION

        current_version = ENRICHMENT_VERSION
        q = (
            select(Shot)
            .where(Shot.project_id == str(project_id))
            .where(Shot.is_duplicate == False)  # noqa: E712
            .where(Shot.deleted_at.is_(None))
            .order_by(Shot.hero_score.desc(), Shot.created_at.asc())
            .limit(limit)
        )
        if not force:
            q = q.where(
                or_(
                    Shot.enrichment_version == 0,
                    Shot.enrichment_version.is_(None),
                    Shot.enrichment_version < current_version,
                )
            )
        result = await self.session.execute(q)
        return list(result.scalars().all())

    async def delete_by_project(self, project_id: UUID | str) -> None:
        shots, _ = await self.list(project_id=project_id, limit=100_000)
        for shot in shots:
            await self.session.delete(shot)
        await self.session.flush()
