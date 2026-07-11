"""Search service — hybrid keyword + semantic retrieval."""

from __future__ import annotations

import logging
import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.shot import Shot
from cinearchive.pipelines.archive_meta import (
    KNOWN_DIRECTORS,
    lookup_director,
    match_director_query,
    match_known_film_title,
)
from cinearchive.pipelines.embedding import EmbeddingPipeline, get_embedding_pipeline
from cinearchive.pipelines.palette import colors_from_hex_list, palette_distance
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.search import (
    AgentQueryRequest,
    AgentQueryResponse,
    MoodboardRequest,
    MoodboardResponse,
    PaletteSearchRequest,
    SearchRequest,
    SearchResponse,
    SearchResult,
    SimilarSearchRequest,
)
from cinearchive.schemas.shot import ShotList
from cinearchive.services.dedupe_service import collapse_shots_to_sequences
from cinearchive.services.shot_mapper import shot_to_read

logger = logging.getLogger(__name__)

# SigLIP text→image cosine scores are often low in absolute terms (~0.05–0.25).
# Use a soft floor only to drop near-zero junk; rank still decides the top.
_VEC_FLOOR_ALONE = 0.03
_VEC_FLOOR_WHEN_META = 0.08
_VEC_WEIGHT_VISUAL = 0.95


def _query_tokens(query: str) -> list[str]:
    stop = {
        "the", "a", "an", "of", "and", "or", "in", "on", "to", "for",
        "by", "from", "film", "films", "movie", "movies",
    }
    raw = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) >= 2]
    tokens = [t for t in raw if t not in stop]
    return tokens or raw


def _film_title(shot: Shot) -> str:
    meta = shot.source_meta_json or {}
    for key in ("film_title", "movie_title", "title"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    title = (shot.source_title or "").strip()
    if " — " in title:
        return title.split(" — ", 1)[0].strip()
    # Prefer folder name under archive roots
    path = (shot.source_path or "").replace("\\", "/")
    for marker in ("/_filmgrab/", "/_eyecandy/", "/_moviestillsdb/", "/_shotdeck/"):
        if marker in path:
            rest = path.split(marker, 1)[1]
            folder = rest.split("/", 1)[0].strip()
            if folder:
                return folder
    return title


def _director_of(shot: Shot) -> str:
    meta = shot.source_meta_json or {}
    d = meta.get("director")
    if isinstance(d, str) and d.strip():
        return d.strip()
    for tag in shot.tags_json or []:
        if isinstance(tag, str) and tag.lower().startswith("director:"):
            return tag.split(":", 1)[1].strip()
    # Infer from known film title / folder when meta was never enriched
    inferred = lookup_director(_film_title(shot))
    return inferred or ""


def _films_for_director(director: str) -> list[str]:
    """Known film titles associated with a director (for query expansion)."""
    needle = director.strip().lower()
    if not needle:
        return []
    out: list[str] = []
    for title, d in KNOWN_DIRECTORS.items():
        if needle in d.lower() or d.lower() in needle:
            out.append(title)
    # Prefer longer titles first (more specific)
    out.sort(key=len, reverse=True)
    return out


def _searchable_blob(shot: Shot) -> str:
    meta = shot.source_meta_json or {}
    parts = [
        shot.source_title,
        shot.source_filename,
        shot.source_path,
        shot.subject,
        shot.mood_vibe,
        shot.creative_intent,
        shot.dialogue_text,
        shot.shot_type,
        getattr(shot, "composition", None),
        getattr(shot, "emotion", None),
        getattr(shot, "content_format", None),
        getattr(shot, "era", None),
        getattr(shot, "origin", None),
        getattr(shot, "ism", None),
        getattr(shot, "visual_style", None),
        getattr(shot, "theme", None),
        getattr(shot, "genre", None),
        getattr(shot, "lighting_style", None),
        getattr(shot, "camera_movement", None),
        meta.get("film_title"),
        meta.get("movie_title"),
        meta.get("title"),
        meta.get("film_slug"),
        meta.get("director"),
        meta.get("cinematographer"),
        meta.get("dp"),
        _director_of(shot),
        _film_title(shot),
        " ".join(shot.tags_json or []),
        " ".join(getattr(shot, "techniques_json", None) or []),
        " ".join(getattr(shot, "shapes_json", None) or []),
    ]
    return " ".join(str(p) for p in parts if p).lower()


def _classify_query(query: str, tokens: list[str]) -> str:
    """Return 'metadata' | 'visual' | 'mixed' for hybrid weighting."""
    if match_director_query(query) or match_known_film_title(query):
        return "metadata"
    if len(tokens) <= 2 and all(t.isalpha() for t in tokens):
        look = {
            "neon", "night", "rain", "fog", "silhouette", "closeup", "wide",
            "dark", "warm", "cold", "blue", "red", "gold", "sunset", "noir",
            "cyberpunk", "desert", "ocean", "city", "crowd", "empty", "moody",
        }
        if any(t in look for t in tokens):
            return "visual"
        return "mixed"
    return "visual"


def _keyword_score(shot: Shot, query: str, tokens: list[str]) -> float:
    """Score how well a shot's metadata matches a text query (0–1)."""
    q = query.strip().lower()
    if not q:
        return 0.0

    title = (shot.source_title or "").lower()
    film = _film_title(shot).lower()
    path = (shot.source_path or "").lower().replace("\\", "/")
    filename = (shot.source_filename or "").lower()
    director = _director_of(shot).lower()
    blob = _searchable_blob(shot)

    score = 0.0

    resolved = match_director_query(query)
    if resolved and director:
        if resolved.lower() in director or director in resolved.lower():
            score = max(score, 0.98)
        elif any(tok in director for tok in tokens):
            score = max(score, 0.95)
    elif director and q in director:
        score = max(score, 0.96)
    elif director and tokens and all(tok in director for tok in tokens):
        score = max(score, 0.94)

    if film and (film == q or q == film):
        score = max(score, 1.0)
    elif film and (q in film or film in q):
        score = max(score, 0.97)
    elif title and q in title:
        score = max(score, 0.94)
    elif path and q.replace(" ", "/") in path:
        score = max(score, 0.92)
    elif path and q in path:
        score = max(score, 0.9)
    elif filename and q in filename:
        score = max(score, 0.75)

    if tokens:
        fields = {
            "film": film,
            "title": title,
            "path": path,
            "director": director,
            "blob": blob,
        }
        hits = 0
        title_hits = 0
        director_hits = 0
        for tok in tokens:
            matched = False
            for name, field in fields.items():
                if tok in field:
                    matched = True
                    if name in {"film", "title", "path"}:
                        title_hits += 1
                    if name == "director":
                        director_hits += 1
                    break
            if matched:
                hits += 1
        if hits:
            coverage = hits / len(tokens)
            if director_hits == len(tokens):
                score = max(score, 0.93 + 0.05 * coverage)
            elif title_hits == len(tokens):
                score = max(score, 0.88 + 0.1 * coverage)
            else:
                score = max(score, 0.45 + 0.4 * coverage)

    if getattr(shot, "is_hero", False):
        score = min(1.0, score + 0.01)
    if getattr(shot, "has_preview", False):
        score = min(1.0, score + 0.005)
    return min(1.0, score)


def _director_matches(shot: Shot, needle: str) -> bool:
    n = needle.strip().lower()
    if not n:
        return True
    d = _director_of(shot).lower()
    if n in d or d in n:
        return True
    # Surname token
    for tok in re.findall(r"[a-z0-9]+", n):
        if len(tok) >= 3 and tok in d:
            return True
    return n in _searchable_blob(shot)


class SearchService:
    def __init__(
        self,
        session: AsyncSession,
        settings: Settings,
        vector_repo: VectorRepository,
        embedder: EmbeddingPipeline | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.vector_repo = vector_repo
        self.shot_repo = ShotRepository(session)
        self.embedder = embedder or get_embedding_pipeline(settings)

    def _filter_kwargs(self, req: SearchRequest) -> dict:
        hide_dups = req.hide_duplicates
        if hide_dups is None:
            hide_dups = self.settings.hide_duplicates_by_default
        return {
            "project_id": req.project_id,
            "has_preview": req.has_preview,
            "is_favorite": req.is_favorite,
            "is_hero": req.is_hero,
            "is_moving": req.is_moving,
            "hide_duplicates": hide_dups,
            "tags": req.tags,
            "shot_type": req.shot_type,
            "mood_vibe": req.mood_vibe,
            "camera_movement": req.camera_movement,
            "lighting_style": req.lighting_style,
            "composition": req.composition,
            "content_format": req.content_format,
            "emotion": req.emotion,
            "technique": req.technique,
            "era": req.era,
            "origin": req.origin,
            "ism": req.ism,
            "director": req.director,
            "visual_style": req.visual_style,
            "theme": req.theme,
            "genre": req.genre,
            "shape": req.shape,
            "color_hex": req.color_hex.upper() if req.color_hex else None,
        }

    def _should_group(self, group_sequences: bool | None) -> bool:
        if group_sequences is None:
            return bool(self.settings.group_sequences_by_default)
        return bool(group_sequences)

    def _collapse_results(self, results: list[SearchResult]) -> list[SearchResult]:
        """Keep best-scoring shot per sequence_id."""
        best: dict[str, SearchResult] = {}
        order: list[str] = []
        for r in results:
            key = r.shot.sequence_id or str(r.shot.id)
            if key not in best:
                order.append(key)
                best[key] = r
            elif r.score > best[key].score:
                best[key] = r
            elif r.score == best[key].score and r.shot.has_preview and not best[key].shot.has_preview:
                best[key] = r
        return [best[k] for k in order]

    async def search(self, req: SearchRequest) -> SearchResponse:
        filters = self._filter_kwargs(req)
        group = self._should_group(req.group_sequences)

        if req.query and req.query.strip():
            q = req.query.strip()
            tokens = _query_tokens(q)
            intent = _classify_query(q, tokens)
            kw_scores: dict[str, float] = {}
            vec_scores: dict[str, float] = {}
            shots_by_id: dict[str, Shot] = {}

            # Resolve "fincher" / "nolan" — expand to known film titles too
            resolved_director = match_director_query(q)
            director_filter = req.director  # dial only; query resolution uses expansion
            film_expansions: list[str] = []
            if resolved_director:
                film_expansions = _films_for_director(resolved_director)
            known_film = match_known_film_title(q)
            if known_film and known_film not in film_expansions:
                film_expansions = [known_film, *film_expansions]

            async def _add_keyword_hits(query_str: str, *, as_director: str | None = None) -> None:
                hits = await self.shot_repo.search_text(
                    query_str,
                    project_id=req.project_id,
                    has_preview=req.has_preview,
                    is_favorite=req.is_favorite,
                    is_hero=req.is_hero,
                    is_moving=req.is_moving,
                    hide_duplicates=filters["hide_duplicates"],
                    shot_type=req.shot_type,
                    mood_vibe=req.mood_vibe,
                    composition=req.composition,
                    content_format=req.content_format,
                    emotion=req.emotion,
                    technique=req.technique,
                    era=req.era,
                    origin=req.origin,
                    ism=req.ism,
                    director=as_director or director_filter,
                    visual_style=req.visual_style,
                    theme=req.theme,
                    genre=req.genre,
                    shape=req.shape,
                    color_hex=filters.get("color_hex"),
                    tag=req.tags[0] if req.tags else None,
                    limit=min(max(req.limit * 12, 400), 2000),
                )
                for shot in hits:
                    # Score against original user query (director surname still matches inferred director)
                    kw = _keyword_score(shot, q, tokens)
                    if kw <= 0 and as_director:
                        kw = 0.9
                    elif kw <= 0 and query_str != q:
                        # Film-title expansion hit
                        kw = 0.92
                    elif kw <= 0:
                        kw = 0.4
                    shots_by_id[shot.id] = shot
                    kw_scores[shot.id] = max(kw_scores.get(shot.id, 0.0), kw)

            await _add_keyword_hits(q)
            if resolved_director:
                await _add_keyword_hits(resolved_director, as_director=resolved_director)
            for title in film_expansions[:12]:
                await _add_keyword_hits(title)

            strong_meta = sum(1 for v in kw_scores.values() if v >= 0.85)
            run_vector = True
            if intent == "metadata" and strong_meta >= max(3, min(12, req.limit // 4)):
                run_vector = False
            # Director/film query with zero library hits: don't dump random visuals
            if intent == "metadata" and not kw_scores:
                run_vector = False

            if run_vector:
                try:
                    vectors = self.embedder.embed_text([q])
                    fetch_limit = min(req.limit * (4 if group else 3), 240)
                    # Soft filters: exact Qdrant director/mood break substring dials
                    vec_filters = {**filters, "director": None, "mood_vibe": None}
                    hits = self.vector_repo.search(
                        vector=vectors[0],
                        limit=fetch_limit,
                        offset=0,
                        **vec_filters,
                    )
                    missing = [str(h.id) for h in hits if str(h.id) not in shots_by_id]
                    if missing:
                        for s in await self.shot_repo.get_many(missing):
                            shots_by_id[s.id] = s
                    for hit in hits:
                        shot = shots_by_id.get(str(hit.id))
                        if not shot:
                            continue
                        if filters.get("is_moving") is not None and bool(shot.is_moving) != filters["is_moving"]:
                            continue
                        if director_filter and not _director_matches(shot, director_filter):
                            continue
                        if req.mood_vibe and (shot.mood_vibe or "") and req.mood_vibe.lower() not in shot.mood_vibe.lower():
                            continue
                        vec = float(hit.score)
                        floor = (
                            _VEC_FLOOR_WHEN_META
                            if (strong_meta or intent == "metadata")
                            else _VEC_FLOOR_ALONE
                        )
                        if vec < floor:
                            continue
                        vec_scores[shot.id] = max(vec_scores.get(shot.id, 0.0), vec)
                except Exception as exc:
                    logger.warning("Vector search unavailable, keyword-only: %s", exc)

            # Merge channels
            results: list[SearchResult] = []
            all_ids = set(kw_scores) | set(vec_scores)
            for sid in all_ids:
                shot = shots_by_id.get(sid)
                if not shot:
                    continue
                if filters.get("is_moving") is not None and bool(shot.is_moving) != filters["is_moving"]:
                    continue
                if director_filter and not _director_matches(shot, director_filter):
                    continue
                kw = kw_scores.get(sid, 0.0)
                vec = vec_scores.get(sid, 0.0)
                if intent == "metadata":
                    if kw <= 0:
                        continue
                    score = kw if vec <= 0 else max(kw, 0.75 * kw + 0.25 * vec)
                elif kw >= 0.85:
                    score = max(kw, vec)
                elif kw > 0 and vec > 0:
                    score = min(1.0, 0.55 * kw + 0.5 * vec)
                elif kw > 0:
                    score = kw
                else:
                    score = vec * _VEC_WEIGHT_VISUAL
                results.append(SearchResult(shot=shot_to_read(shot), score=float(score)))

            results.sort(key=lambda r: r.score, reverse=True)
            if group:
                results = self._collapse_results(results)
            if req.randomize and results:
                import random

                random.shuffle(results)
            sliced = results[req.offset : req.offset + req.limit]
            return SearchResponse(results=sliced, total=len(results), query=req.query)

        # Browse without text query (filters only — including color)
        fetch_limit = min(req.limit * 6, 600) if group else req.limit
        fetch_offset = 0 if group else req.offset
        items, total = await self.shot_repo.list(
            project_id=req.project_id,
            has_preview=req.has_preview,
            is_favorite=req.is_favorite,
            is_hero=req.is_hero,
            is_moving=req.is_moving,
            hide_duplicates=filters["hide_duplicates"],
            shot_type=req.shot_type,
            mood_vibe=req.mood_vibe,
            composition=req.composition,
            lighting_style=req.lighting_style,
            content_format=req.content_format,
            emotion=req.emotion,
            technique=req.technique,
            era=req.era,
            origin=req.origin,
            ism=req.ism,
            director=req.director,
            visual_style=req.visual_style,
            theme=req.theme,
            genre=req.genre,
            shape=req.shape,
            color_hex=filters.get("color_hex"),
            tag=req.tags[0] if req.tags else None,
            randomize=req.randomize and not group,
            offset=fetch_offset,
            limit=fetch_limit if group else req.limit,
        )
        if group:
            items = collapse_shots_to_sequences(items)
            total = len(items)
            if req.randomize:
                import random

                random.shuffle(items)
            items = items[req.offset : req.offset + req.limit]
        return SearchResponse(
            results=[SearchResult(shot=shot_to_read(s), score=1.0) for s in items],
            total=total,
            query=None,
        )

    async def list_shots(
        self,
        *,
        project_id: UUID | None = None,
        has_preview: bool | None = None,
        is_favorite: bool | None = None,
        is_hero: bool | None = None,
        is_moving: bool | None = None,
        hide_duplicates: bool | None = True,
        shot_type: str | None = None,
        content_format: str | None = None,
        emotion: str | None = None,
        technique: str | None = None,
        randomize: bool = False,
        group_sequences: bool | None = None,
        offset: int = 0,
        limit: int = 48,
    ) -> ShotList:
        group = self._should_group(group_sequences)
        fetch_limit = min(limit * 6, 600) if group else limit
        fetch_offset = 0 if group else offset
        items, total = await self.shot_repo.list(
            project_id=project_id,
            has_preview=has_preview,
            is_favorite=is_favorite,
            is_hero=is_hero,
            is_moving=is_moving,
            hide_duplicates=hide_duplicates if hide_duplicates is not None else True,
            shot_type=shot_type,
            content_format=content_format,
            emotion=emotion,
            technique=technique,
            randomize=randomize and not group,
            offset=fetch_offset,
            limit=fetch_limit if group else limit,
        )
        if group:
            items = collapse_shots_to_sequences(items)
            total = len(items)
            if randomize:
                import random

                random.shuffle(items)
            items = items[offset : offset + limit]
        return ShotList(
            items=[shot_to_read(s) for s in items],
            total=total,
            offset=offset,
            limit=limit,
        )

    async def search_palette(self, req: PaletteSearchRequest) -> SearchResponse:
        target_colors: list[dict] = []
        if req.shot_id:
            shot = await self.shot_repo.get(req.shot_id)
            if shot:
                target_colors = list(shot.dominant_colors_json or [])
        if req.colors:
            target_colors = colors_from_hex_list(req.colors)

        if not target_colors:
            return SearchResponse(results=[], total=0, query=None)

        items, _ = await self.shot_repo.list(
            project_id=req.project_id,
            hide_duplicates=True,
            limit=min(req.limit * 20, 2000),
        )
        scored: list[SearchResult] = []
        for s in items:
            if req.shot_id and s.id == str(req.shot_id):
                continue
            dist = palette_distance(target_colors, list(s.dominant_colors_json or []))
            score = max(0.0, 1.0 - dist)
            scored.append(SearchResult(shot=shot_to_read(s), score=score))
        scored.sort(key=lambda r: r.score, reverse=True)
        sliced = scored[: req.limit]
        return SearchResponse(results=sliced, total=len(scored), query=None)

    async def search_similar(self, req: SimilarSearchRequest) -> SearchResponse:
        """Visual nearest neighbors for a shot (SigLIP embedding in Qdrant)."""
        shot = await self.shot_repo.get(req.shot_id)
        if not shot:
            return SearchResponse(results=[], total=0, query=None)

        vector = self.vector_repo.get_vector(str(req.shot_id))
        if vector is None:
            # Fallback: re-embed keyframe if the point is missing
            try:
                from cinearchive.services.artifact_service import resolve_artifact

                keyframe = resolve_artifact(self.settings, shot.keyframe_path)
                if keyframe.is_file():
                    vector = self.embedder.embed_images([keyframe])[0]
            except Exception:
                vector = None
        if vector is None:
            return SearchResponse(results=[], total=0, query=None)

        hits = self.vector_repo.search(
            vector=vector,
            limit=req.limit + 8,
            offset=0,
            project_id=req.project_id,
            hide_duplicates=req.hide_duplicates,
        )
        ids = [str(h.id) for h in hits if str(h.id) != str(req.shot_id)]
        shots = await self.shot_repo.get_many(ids)
        by_id = {s.id: s for s in shots}
        results: list[SearchResult] = []
        for h in hits:
            sid = str(h.id)
            if sid == str(req.shot_id):
                continue
            s = by_id.get(sid)
            if not s or s.deleted_at is not None:
                continue
            results.append(SearchResult(shot=shot_to_read(s), score=float(h.score)))
            if len(results) >= req.limit:
                break
        return SearchResponse(results=results, total=len(results), query=f"similar:{req.shot_id}")

    async def search_same_source(self, shot_id: UUID | str, *, limit: int = 16) -> SearchResponse:
        """Other frames from the same film / source title."""
        shot = await self.shot_repo.get(shot_id)
        if not shot:
            return SearchResponse(results=[], total=0, query=None)
        film = _film_title(shot)
        if not film or len(film) < 2:
            return SearchResponse(results=[], total=0, query=None)
        hits = await self.shot_repo.search_text(
            film,
            project_id=None,
            hide_duplicates=True,
            limit=min(limit + 20, 200),
        )
        results: list[SearchResult] = []
        for s in hits:
            if s.id == str(shot_id):
                continue
            # Prefer same film title / path folder
            score = _keyword_score(s, film, _query_tokens(film))
            if score < 0.85:
                continue
            results.append(SearchResult(shot=shot_to_read(s), score=score))
            if len(results) >= limit:
                break
        return SearchResponse(results=results, total=len(results), query=film)

    async def search_craft_links(
        self, shot_id: UUID | str, *, limit: int = 12
    ) -> SearchResponse:
        """Shots sharing composition / lighting / emotion / style (enriched links)."""
        shot = await self.shot_repo.get(shot_id)
        if not shot:
            return SearchResponse(results=[], total=0, query=None)

        weak = {"", "other", "unknown", "none", "n/a"}

        def _ok(val: str | None) -> str | None:
            if not isinstance(val, str) or val.strip().lower() in weak:
                return None
            return val.strip()

        queries: list[dict] = []
        if _ok(getattr(shot, "composition", None)):
            queries.append({"composition": _ok(shot.composition)})
        if _ok(getattr(shot, "lighting_style", None)):
            queries.append({"lighting_style": _ok(shot.lighting_style)})
        if _ok(getattr(shot, "emotion", None)):
            queries.append({"emotion": _ok(shot.emotion)})
        if _ok(getattr(shot, "visual_style", None)):
            queries.append({"visual_style": _ok(shot.visual_style)})
        if _ok(getattr(shot, "theme", None)):
            queries.append({"theme": _ok(shot.theme)})

        scored: dict[str, float] = {}
        for kwargs in queries:
            items, _ = await self.shot_repo.list(
                hide_duplicates=True,
                limit=min(limit * 4, 48),
                **kwargs,
            )
            for s in items:
                if s.id == str(shot_id):
                    continue
                scored[s.id] = scored.get(s.id, 0.0) + 1.0

        if not scored:
            return SearchResponse(results=[], total=0, query="craft")

        ranked = sorted(scored.items(), key=lambda x: x[1], reverse=True)[:limit]
        shots = await self.shot_repo.get_many([sid for sid, _ in ranked])
        by_id = {s.id: s for s in shots}
        max_score = max(scored.values()) or 1.0
        results = [
            SearchResult(
                shot=shot_to_read(by_id[sid]),
                score=round(sc / max_score, 3),
            )
            for sid, sc in ranked
            if sid in by_id
        ]
        return SearchResponse(results=results, total=len(results), query="craft")

    async def moodboard(self, req: MoodboardRequest) -> MoodboardResponse:
        text = (req.text or "").strip()
        concepts = [c.strip() for c in re.split(r"[,;\n]+", text) if c.strip()][:8]
        if not concepts and text:
            concepts = [text[:120]]

        query_used = " | ".join(concepts[:3]) if concepts else text
        if not query_used:
            return MoodboardResponse(concepts=[], results=[], query_used="")

        vectors = self.embedder.embed_text([query_used])
        hits = self.vector_repo.search(
            vector=vectors[0],
            limit=req.limit,
            project_id=req.project_id,
            shot_type=req.shot_type,
            mood_vibe=req.mood_vibe,
        )
        ids = [str(h.id) for h in hits]
        shots = await self.shot_repo.get_many(ids)
        by_id = {s.id: s for s in shots}
        results = [
            SearchResult(shot=shot_to_read(by_id[str(h.id)]), score=float(h.score))
            for h in hits
            if str(h.id) in by_id
        ]
        return MoodboardResponse(concepts=concepts, results=results, query_used=query_used)

    async def agent_query(self, req: AgentQueryRequest) -> AgentQueryResponse:
        """Parse natural language into filters + semantic query (rule-based, local)."""
        prompt = req.prompt.lower()
        interpretation: dict = {"raw": req.prompt, "filters": {}, "semantic": req.prompt}

        shot_types = [
            "extreme-close-up",
            "close-up",
            "medium",
            "wide",
            "aerial",
            "pov",
            "insert",
            "low-angle",
            "high-angle",
        ]
        movements = ["tracking", "dolly", "pan", "tilt", "handheld", "crane", "static", "zoom"]
        lighting = [
            "neon",
            "golden-hour",
            "low-key",
            "high-key",
            "silhouette",
            "natural",
            "overcast",
        ]

        for st in shot_types:
            if st in prompt or st.replace("-", " ") in prompt:
                interpretation["filters"]["shot_type"] = (
                    "close-up" if st in {"low-angle", "high-angle"} else st
                )
                if st in {"low-angle", "high-angle"}:
                    interpretation["filters"]["tags"] = [st]
                break
        for mv in movements:
            if mv in prompt:
                interpretation["filters"]["camera_movement"] = mv
                break
        for lt in lighting:
            if lt in prompt:
                interpretation["filters"]["lighting_style"] = lt
                break

        from cinearchive.pipelines.taxonomy import COMPOSITIONS, COMPOSITION_ALIASES

        for slug in COMPOSITIONS:
            if slug == "other":
                continue
            if slug in prompt or slug.replace("-", " ") in prompt:
                interpretation["filters"]["composition"] = slug
                break
        else:
            for alias, slug in COMPOSITION_ALIASES.items():
                if alias in prompt or alias.replace("-", " ") in prompt:
                    interpretation["filters"]["composition"] = slug
                    break

        # Color hex or named colors
        hex_match = re.search(r"#[0-9a-fA-F]{6}", req.prompt)
        color_names = {
            "teal": "#008080",
            "cyan": "#00E5FF",
            "magenta": "#FF006E",
            "orange": "#FF8C00",
            "blue": "#1E90FF",
            "red": "#DC143C",
            "green": "#228B22",
            "amber": "#FFBF00",
        }
        if hex_match:
            interpretation["filters"]["color_hex"] = hex_match.group(0).upper()
        else:
            for name, hx in color_names.items():
                if name in prompt:
                    interpretation["filters"]["color_hex"] = hx
                    break

        mood_words = re.findall(
            r"\b(melancholic|tense|romantic|eerie|hopeful|violent|serene|noir|dreamy|brutal)\b",
            prompt,
        )
        if mood_words:
            interpretation["filters"]["mood_vibe"] = mood_words[0]

        if req.filters:
            interpretation["filters"].update(req.filters)

        search_req = SearchRequest(
            query=req.prompt,
            project_id=req.project_id,
            limit=req.limit,
            shot_type=interpretation["filters"].get("shot_type"),
            camera_movement=interpretation["filters"].get("camera_movement"),
            lighting_style=interpretation["filters"].get("lighting_style"),
            composition=interpretation["filters"].get("composition"),
            mood_vibe=interpretation["filters"].get("mood_vibe"),
            color_hex=interpretation["filters"].get("color_hex"),
            tags=interpretation["filters"].get("tags"),
        )
        resp = await self.search(search_req)
        msg = (
            f"Interpreted as hybrid search with filters {interpretation['filters']}; "
            f"returning {len(resp.results)} shots."
        )
        return AgentQueryResponse(
            interpretation=interpretation,
            results=resp.results,
            message=msg,
        )
