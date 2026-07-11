"""Search, palette, moodboard, and agent routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.api.deps import get_db_session, get_embedder, get_settings, get_vector_repo
from cinearchive.config import Settings
from cinearchive.pipelines.embedding import EmbeddingPipeline
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.schemas.search import (
    AgentQueryRequest,
    AgentQueryResponse,
    MoodboardRequest,
    MoodboardResponse,
    PaletteSearchRequest,
    SearchRequest,
    SearchResponse,
    SimilarSearchRequest,
)
from cinearchive.services.search_service import SearchService

router = APIRouter(tags=["search"])


def _service(
    session: AsyncSession,
    settings: Settings,
    vector_repo: VectorRepository,
    embedder: EmbeddingPipeline,
) -> SearchService:
    return SearchService(session, settings, vector_repo, embedder=embedder)


@router.post("/search", response_model=SearchResponse)
async def search(
    body: SearchRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> SearchResponse:
    return await _service(session, settings, vector_repo, embedder).search(body)


@router.post("/search/palette", response_model=SearchResponse)
async def search_palette(
    body: PaletteSearchRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> SearchResponse:
    return await _service(session, settings, vector_repo, embedder).search_palette(body)


@router.post("/search/similar", response_model=SearchResponse)
async def search_similar(
    body: SimilarSearchRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> SearchResponse:
    """Visual nearest neighbors for a shot (connections panel)."""
    return await _service(session, settings, vector_repo, embedder).search_similar(body)


@router.post("/search/same-source", response_model=SearchResponse)
async def search_same_source(
    body: SimilarSearchRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> SearchResponse:
    """Other frames from the same film / source."""
    return await _service(session, settings, vector_repo, embedder).search_same_source(
        body.shot_id, limit=body.limit
    )


@router.post("/search/craft", response_model=SearchResponse)
async def search_craft(
    body: SimilarSearchRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> SearchResponse:
    """Shots linked by shared craft tags (composition, lighting, emotion, style)."""
    return await _service(session, settings, vector_repo, embedder).search_craft_links(
        body.shot_id, limit=body.limit
    )


@router.post("/moodboard", response_model=MoodboardResponse)
async def moodboard(
    body: MoodboardRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> MoodboardResponse:
    return await _service(session, settings, vector_repo, embedder).moodboard(body)


@router.post("/agent/query", response_model=AgentQueryResponse)
async def agent_query(
    body: AgentQueryRequest,
    session: AsyncSession = Depends(get_db_session),
    settings: Settings = Depends(get_settings),
    vector_repo: VectorRepository = Depends(get_vector_repo),
    embedder: EmbeddingPipeline = Depends(get_embedder),
) -> AgentQueryResponse:
    """Agent-ready endpoint for OpenClaw / multi-agent frameworks.

    Example prompt:
    \"return 5 low-angle tracking shots with melancholic teal-dominant palette matching this logline\"
    """
    return await _service(session, settings, vector_repo, embedder).agent_query(body)
