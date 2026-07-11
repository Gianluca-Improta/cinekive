"""Qdrant vector repository."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


class VectorRepository:
    def __init__(self, client: QdrantClient, settings: Settings) -> None:
        self.client = client
        self.settings = settings
        self.collection = settings.qdrant_collection

    def ensure_collection(self) -> None:
        existing = {c.name for c in self.client.get_collections().collections}
        if self.collection not in existing:
            logger.info(
                "Creating Qdrant collection %s (dim=%s)",
                self.collection,
                self.settings.embedding_dim,
            )
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=qm.VectorParams(
                    size=self.settings.embedding_dim,
                    distance=qm.Distance.COSINE,
                ),
            )
        for field, schema in [
            ("project_id", qm.PayloadSchemaType.KEYWORD),
            ("has_preview", qm.PayloadSchemaType.BOOL),
            ("dominant_color_hex", qm.PayloadSchemaType.KEYWORD),
            ("tags", qm.PayloadSchemaType.KEYWORD),
            ("techniques", qm.PayloadSchemaType.KEYWORD),
            ("shot_type", qm.PayloadSchemaType.KEYWORD),
            ("mood_vibe", qm.PayloadSchemaType.KEYWORD),
            ("camera_movement", qm.PayloadSchemaType.KEYWORD),
            ("lighting_style", qm.PayloadSchemaType.KEYWORD),
            ("content_format", qm.PayloadSchemaType.KEYWORD),
            ("emotion", qm.PayloadSchemaType.KEYWORD),
            ("era", qm.PayloadSchemaType.KEYWORD),
            ("origin", qm.PayloadSchemaType.KEYWORD),
            ("ism", qm.PayloadSchemaType.KEYWORD),
            ("director", qm.PayloadSchemaType.KEYWORD),
            ("visual_style", qm.PayloadSchemaType.KEYWORD),
            ("theme", qm.PayloadSchemaType.KEYWORD),
            ("genre", qm.PayloadSchemaType.KEYWORD),
            ("shapes", qm.PayloadSchemaType.KEYWORD),
            ("camera_angle", qm.PayloadSchemaType.KEYWORD),
            ("composition", qm.PayloadSchemaType.KEYWORD),
            ("lens_look", qm.PayloadSchemaType.KEYWORD),
            ("color_grade", qm.PayloadSchemaType.KEYWORD),
            ("source_filename", qm.PayloadSchemaType.KEYWORD),
            ("source_title", qm.PayloadSchemaType.TEXT),
            ("film_title", qm.PayloadSchemaType.TEXT),
            ("collection_id", qm.PayloadSchemaType.KEYWORD),
            ("dialogue_text", qm.PayloadSchemaType.TEXT),
            ("is_favorite", qm.PayloadSchemaType.BOOL),
            ("is_hero", qm.PayloadSchemaType.BOOL),
            ("is_duplicate", qm.PayloadSchemaType.BOOL),
            ("is_moving", qm.PayloadSchemaType.BOOL),
        ]:
            try:
                self.client.create_payload_index(
                    collection_name=self.collection,
                    field_name=field,
                    field_schema=schema,
                )
            except Exception:
                pass  # index may already exist

    def upsert_points(
        self,
        *,
        ids: list[str],
        vectors: list[list[float]],
        payloads: list[dict[str, Any]],
    ) -> None:
        points = [
            qm.PointStruct(id=pid, vector=vec, payload=payload)
            for pid, vec, payload in zip(ids, vectors, payloads, strict=True)
        ]
        self.client.upsert(collection_name=self.collection, points=points)

    def set_payload(self, point_id: str, payload: dict[str, Any]) -> None:
        self.client.set_payload(
            collection_name=self.collection,
            payload=payload,
            points=[point_id],
        )

    def build_filter(
        self,
        *,
        project_id: UUID | str | None = None,
        has_preview: bool | None = None,
        is_favorite: bool | None = None,
        is_hero: bool | None = None,
        is_moving: bool | None = None,
        hide_duplicates: bool | None = True,
        tags: list[str] | None = None,
        technique: str | None = None,
        shot_type: str | None = None,
        mood_vibe: str | None = None,
        camera_movement: str | None = None,
        lighting_style: str | None = None,
        composition: str | None = None,
        content_format: str | None = None,
        emotion: str | None = None,
        era: str | None = None,
        origin: str | None = None,
        ism: str | None = None,
        director: str | None = None,
        visual_style: str | None = None,
        theme: str | None = None,
        genre: str | None = None,
        shape: str | None = None,
        color_hex: str | None = None,
    ) -> qm.Filter | None:
        must: list[qm.Condition] = []
        must_not: list[qm.Condition] = []
        if project_id is not None:
            must.append(
                qm.FieldCondition(key="project_id", match=qm.MatchValue(value=str(project_id)))
            )
        if has_preview is not None:
            must.append(
                qm.FieldCondition(key="has_preview", match=qm.MatchValue(value=has_preview))
            )
        if is_favorite is not None:
            must.append(
                qm.FieldCondition(key="is_favorite", match=qm.MatchValue(value=is_favorite))
            )
        if is_hero is not None:
            must.append(qm.FieldCondition(key="is_hero", match=qm.MatchValue(value=is_hero)))
        if is_moving is not None:
            must.append(qm.FieldCondition(key="is_moving", match=qm.MatchValue(value=is_moving)))
        if hide_duplicates:
            # must_not keeps points that lack the field (legacy payloads)
            must_not.append(
                qm.FieldCondition(key="is_duplicate", match=qm.MatchValue(value=True))
            )
        if shot_type:
            must.append(qm.FieldCondition(key="shot_type", match=qm.MatchValue(value=shot_type)))
        if mood_vibe:
            # Keyword exact match; partial mood matching is handled in hybrid re-rank
            must.append(
                qm.FieldCondition(key="mood_vibe", match=qm.MatchValue(value=mood_vibe))
            )
        if camera_movement:
            must.append(
                qm.FieldCondition(
                    key="camera_movement", match=qm.MatchValue(value=camera_movement)
                )
            )
        if lighting_style:
            must.append(
                qm.FieldCondition(
                    key="lighting_style", match=qm.MatchValue(value=lighting_style)
                )
            )
        if composition:
            must.append(
                qm.FieldCondition(key="composition", match=qm.MatchValue(value=composition))
            )
        if content_format:
            must.append(
                qm.FieldCondition(
                    key="content_format", match=qm.MatchValue(value=content_format)
                )
            )
        if emotion:
            must.append(qm.FieldCondition(key="emotion", match=qm.MatchValue(value=emotion)))
        if era:
            must.append(qm.FieldCondition(key="era", match=qm.MatchValue(value=era)))
        if origin:
            must.append(qm.FieldCondition(key="origin", match=qm.MatchValue(value=origin)))
        if ism:
            must.append(qm.FieldCondition(key="ism", match=qm.MatchValue(value=ism)))
        if director:
            must.append(
                qm.FieldCondition(key="director", match=qm.MatchValue(value=director))
            )
        if visual_style:
            must.append(
                qm.FieldCondition(key="visual_style", match=qm.MatchValue(value=visual_style))
            )
        if theme:
            must.append(qm.FieldCondition(key="theme", match=qm.MatchValue(value=theme)))
        if genre:
            must.append(qm.FieldCondition(key="genre", match=qm.MatchValue(value=genre)))
        if shape:
            must.append(qm.FieldCondition(key="shapes", match=qm.MatchValue(value=shape)))
        if color_hex:
            must.append(
                qm.FieldCondition(
                    key="dominant_color_hex", match=qm.MatchValue(value=color_hex.upper())
                )
            )
        if tags:
            for tag in tags:
                must.append(qm.FieldCondition(key="tags", match=qm.MatchValue(value=tag)))
        if technique:
            must.append(
                qm.FieldCondition(key="techniques", match=qm.MatchValue(value=technique))
            )
        if not must and not must_not:
            return None
        return qm.Filter(must=must or None, must_not=must_not or None)

    def get_vector(self, point_id: str) -> list[float] | None:
        """Fetch the stored embedding for a shot point, if present."""
        try:
            points = self.client.retrieve(
                collection_name=self.collection,
                ids=[point_id],
                with_vectors=True,
                with_payload=False,
            )
        except Exception:
            return None
        if not points:
            return None
        vec = points[0].vector
        if isinstance(vec, dict):
            # Named vectors — take the first
            vec = next(iter(vec.values()), None)
        if not isinstance(vec, list) or not vec:
            return None
        return [float(x) for x in vec]

    def search(
        self,
        *,
        vector: list[float],
        limit: int = 48,
        offset: int = 0,
        project_id: UUID | str | None = None,
        has_preview: bool | None = None,
        is_favorite: bool | None = None,
        is_hero: bool | None = None,
        is_moving: bool | None = None,
        hide_duplicates: bool | None = True,
        tags: list[str] | None = None,
        technique: str | None = None,
        shot_type: str | None = None,
        mood_vibe: str | None = None,
        camera_movement: str | None = None,
        lighting_style: str | None = None,
        composition: str | None = None,
        content_format: str | None = None,
        emotion: str | None = None,
        era: str | None = None,
        origin: str | None = None,
        ism: str | None = None,
        director: str | None = None,
        visual_style: str | None = None,
        theme: str | None = None,
        genre: str | None = None,
        shape: str | None = None,
        color_hex: str | None = None,
    ) -> list[qm.ScoredPoint]:
        query_filter = self.build_filter(
            project_id=project_id,
            has_preview=has_preview,
            is_favorite=is_favorite,
            is_hero=is_hero,
            is_moving=is_moving,
            hide_duplicates=hide_duplicates,
            tags=tags,
            technique=technique,
            shot_type=shot_type,
            mood_vibe=mood_vibe,
            camera_movement=camera_movement,
            lighting_style=lighting_style,
            composition=composition,
            content_format=content_format,
            emotion=emotion,
            era=era,
            origin=origin,
            ism=ism,
            director=director,
            visual_style=visual_style,
            theme=theme,
            genre=genre,
            shape=shape,
            color_hex=color_hex,
        )
        try:
            result = self.client.query_points(
                collection_name=self.collection,
                query=vector,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=True,
            )
            return list(result.points)
        except Exception:
            return self.client.search(
                collection_name=self.collection,
                query_vector=vector,
                query_filter=query_filter,
                limit=limit,
                offset=offset,
                with_payload=True,
            )

    def scroll_payloads(
        self,
        *,
        project_id: UUID | str | None = None,
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        query_filter = self.build_filter(project_id=project_id)
        points, _ = self.client.scroll(
            collection_name=self.collection,
            scroll_filter=query_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        out = []
        for p in points:
            payload = dict(p.payload or {})
            payload["_id"] = str(p.id)
            out.append(payload)
        return out

    def delete_by_project(self, project_id: UUID | str) -> None:
        self.client.delete(
            collection_name=self.collection,
            points_selector=qm.FilterSelector(
                filter=qm.Filter(
                    must=[
                        qm.FieldCondition(
                            key="project_id",
                            match=qm.MatchValue(value=str(project_id)),
                        )
                    ]
                )
            ),
        )

    def delete_points(self, ids: list[str]) -> None:
        if not ids:
            return
        self.client.delete(
            collection_name=self.collection,
            points_selector=qm.PointIdsList(points=ids),
        )

    def health(self) -> bool:
        try:
            self.client.get_collections()
            return True
        except Exception:
            return False
