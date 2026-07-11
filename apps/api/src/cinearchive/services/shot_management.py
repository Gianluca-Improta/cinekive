"""Bulk shot management — soft-delete bin, restore, purge, move, copy."""

from __future__ import annotations

import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.collection import Collection, CollectionShot
from cinearchive.db.models.project import Project
from cinearchive.db.models.shot import Shot
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import artifacts_base, library_root, shot_artifact_dir, to_relative

logger = get_logger(__name__)


class ShotManagementService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        vector_repo: VectorRepository | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.shot_repo = ShotRepository(session)
        self.vector_repo = vector_repo

    def _now(self) -> datetime:
        return datetime.now(timezone.utc)

    async def soft_delete_shots(self, shot_ids: list[str]) -> int:
        """Move shots to the bin (hidden from grids). Hard-deleted after retention."""
        shots = await self.shot_repo.get_many(shot_ids)
        if not shots:
            return 0
        now = self._now()
        ids: list[str] = []
        for s in shots:
            if getattr(s, "deleted_at", None):
                continue
            s.deleted_at = now
            ids.append(s.id)
        await self.session.commit()
        if self.vector_repo and ids:
            try:
                self.vector_repo.delete_points(ids)
            except Exception as exc:
                logger.warning("Qdrant delete (soft) failed: %s", exc)
        return len(ids)

    async def restore_shots(self, shot_ids: list[str]) -> int:
        shots = await self.shot_repo.get_many(shot_ids)
        if not shots:
            return 0
        restored: list[Shot] = []
        for s in shots:
            if not getattr(s, "deleted_at", None):
                continue
            s.deleted_at = None
            restored.append(s)
        await self.session.commit()
        if self.vector_repo and restored:
            dim = self.settings.embedding_dim
            try:
                self.vector_repo.upsert_points(
                    ids=[s.id for s in restored],
                    vectors=[[0.0] * dim for _ in restored],
                    payloads=[shot_payload(s) for s in restored],
                )
            except Exception as exc:
                logger.warning("Qdrant restore upsert failed: %s", exc)
        return len(restored)

    async def permanently_delete_shots(self, shot_ids: list[str]) -> int:
        shots = await self.shot_repo.get_many(shot_ids)
        if not shots:
            return 0
        ids = [s.id for s in shots]
        for s in shots:
            await self.session.delete(s)
        await self.session.commit()
        if self.vector_repo:
            try:
                self.vector_repo.delete_points(ids)
            except Exception as exc:
                logger.warning("Qdrant delete failed: %s", exc)
        return len(ids)

    # Back-compat alias used by routes / selection bar
    async def delete_shots(self, shot_ids: list[str]) -> int:
        return await self.soft_delete_shots(shot_ids)

    async def list_bin(
        self,
        *,
        project_id: str | None = None,
        offset: int = 0,
        limit: int = 48,
    ) -> tuple[list[Shot], int]:
        return await self.shot_repo.list_deleted(
            project_id=project_id, offset=offset, limit=limit
        )

    async def purge_expired(self, *, retention_days: int | None = None) -> int:
        days = retention_days if retention_days is not None else self.settings.trash_retention_days
        cutoff = self._now() - timedelta(days=max(1, int(days)))
        result = await self.session.execute(
            select(Shot).where(Shot.deleted_at.is_not(None)).where(Shot.deleted_at < cutoff)
        )
        expired = list(result.scalars().all())
        if not expired:
            return 0
        ids = [s.id for s in expired]
        for s in expired:
            await self.session.delete(s)
        await self.session.commit()
        if self.vector_repo:
            try:
                self.vector_repo.delete_points(ids)
            except Exception as exc:
                logger.warning("Qdrant purge delete failed: %s", exc)
        logger.info("Purged %d shots from bin (older than %d days)", len(ids), days)
        return len(ids)

    async def add_to_collection(self, collection_id: str, shot_ids: list[str]) -> int:
        collection = await self.session.get(Collection, collection_id)
        if not collection:
            raise ValueError("Collection not found")
        shots = await self.shot_repo.get_many(shot_ids)
        linked = set(
            (
                await self.session.execute(
                    select(CollectionShot.shot_id).where(
                        CollectionShot.collection_id == collection_id
                    )
                )
            )
            .scalars()
            .all()
        )
        added = 0
        for s in shots:
            if s.id in linked or getattr(s, "deleted_at", None):
                continue
            self.session.add(
                CollectionShot(collection_id=collection_id, shot_id=s.id, position=added)
            )
            added += 1
        await self.session.commit()
        return added

    async def move_or_copy(
        self,
        shot_ids: list[str],
        target_project_id: str,
        *,
        mode: str = "move",
    ) -> int:
        target = await self.session.get(Project, target_project_id)
        if not target:
            raise ValueError("Target project not found")
        shots = await self.shot_repo.get_many(shot_ids)
        if not shots:
            return 0

        lib = library_root(self.settings)
        legacy = Path(self.settings.artifacts_dir)
        affected = 0
        new_payloads: list[tuple[str, dict]] = []

        for s in shots:
            if getattr(s, "deleted_at", None):
                continue
            if mode == "move":
                if s.project_id == target_project_id:
                    continue
                s.project_id = target_project_id
                affected += 1
                if self.vector_repo:
                    try:
                        self.vector_repo.set_payload(s.id, shot_payload(s))
                    except Exception as exc:
                        logger.warning("Payload update failed for %s: %s", s.id, exc)
                continue

            new_id = str(uuid4())
            art_dir = shot_artifact_dir(self.settings, target.slug, new_id)
            src_key = lib / s.keyframe_path
            if not src_key.is_file():
                src_key = legacy / s.keyframe_path
            if not src_key.is_file():
                logger.warning("Skip copy missing keyframe %s", s.id)
                continue

            def _copy_rel(rel: str | None, name: str) -> str | None:
                if not rel:
                    return None
                src = lib / rel
                if not src.is_file():
                    src = legacy / rel
                if not src.is_file():
                    return None
                dest = art_dir / name
                shutil.copy2(src, dest)
                return to_relative(artifacts_base(self.settings), dest)

            keyframe = _copy_rel(s.keyframe_path, "keyframe.jpg")
            thumb_sm = _copy_rel(s.thumb_sm_path, "thumb_sm.webp")
            thumb_md = _copy_rel(s.thumb_md_path, "thumb_md.webp")
            preview = None
            if s.preview_path:
                ext = Path(s.preview_path).suffix or ".webp"
                preview = _copy_rel(s.preview_path, f"preview{ext}")
            if not keyframe or not thumb_sm or not thumb_md:
                continue

            clone = Shot(
                id=new_id,
                project_id=target_project_id,
                source_type=s.source_type,
                source_path=s.source_path,
                source_filename=getattr(s, "source_filename", None),
                source_title=getattr(s, "source_title", None),
                source_meta_json=dict(getattr(s, "source_meta_json", None) or {}),
                scene_index=s.scene_index,
                start_timecode_ms=s.start_timecode_ms,
                end_timecode_ms=s.end_timecode_ms,
                duration_ms=s.duration_ms,
                keyframe_path=keyframe,
                thumb_sm_path=thumb_sm,
                thumb_md_path=thumb_md,
                preview_path=preview,
                width=s.width,
                height=s.height,
                dominant_colors_json=list(s.dominant_colors_json or []),
                has_preview=bool(preview),
                qdrant_point_id=new_id,
                shot_type=s.shot_type,
                camera_movement=s.camera_movement,
                camera_angle=getattr(s, "camera_angle", None),
                lighting_style=s.lighting_style,
                composition=getattr(s, "composition", None),
                subject=getattr(s, "subject", None),
                lens_look=getattr(s, "lens_look", None),
                color_grade=getattr(s, "color_grade", None),
                mood_vibe=s.mood_vibe,
                creative_intent=s.creative_intent,
                tags_json=list(s.tags_json or []),
                techniques_json=list(getattr(s, "techniques_json", None) or []),
                enrichment_version=s.enrichment_version or 0,
                content_format=getattr(s, "content_format", None),
                emotion=getattr(s, "emotion", None),
                sequence_id=str(uuid4()) if s.sequence_id else None,
                frame_role=s.frame_role,
                hero_score=s.hero_score or 0,
                is_hero=bool(s.is_hero),
                is_moving=bool(s.is_moving),
                grade_reason=s.grade_reason,
                phash=s.phash,
                is_duplicate=False,
                notes=s.notes,
                is_favorite=bool(s.is_favorite),
                deleted_at=None,
            )
            self.session.add(clone)
            affected += 1
            new_payloads.append((new_id, shot_payload(clone, Path(s.source_path).name)))

        await self.session.commit()

        if self.vector_repo and new_payloads:
            dim = self.settings.embedding_dim
            try:
                self.vector_repo.upsert_points(
                    ids=[p[0] for p in new_payloads],
                    vectors=[[0.0] * dim for _ in new_payloads],
                    payloads=[p[1] for p in new_payloads],
                )
            except Exception as exc:
                logger.warning("Qdrant upsert for copies failed: %s", exc)

        return affected
