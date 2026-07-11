"""FastAPI dependency injection."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from fastapi import Depends, Request
from qdrant_client import QdrantClient
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings, get_settings
from cinearchive.db.session import SessionLocal
from cinearchive.pipelines.embedding import EmbeddingPipeline, get_embedding_pipeline
from cinearchive.repositories.vector_repo import VectorRepository


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


def get_qdrant(request: Request) -> QdrantClient:
    return request.app.state.qdrant


def get_vector_repo(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> VectorRepository:
    return VectorRepository(request.app.state.qdrant, settings)


def get_embedder(settings: Settings = Depends(get_settings)) -> EmbeddingPipeline:
    return get_embedding_pipeline(settings)
