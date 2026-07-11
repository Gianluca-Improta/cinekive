"""Async SQLAlchemy engine and session factory."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinearchive.config import get_settings

_settings = get_settings()
engine = create_async_engine(
    _settings.database_url,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in _settings.database_url else {},
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
