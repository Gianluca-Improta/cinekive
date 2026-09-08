"""Async SQLAlchemy engine and session factory."""

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from cinearchive.config import get_settings

_settings = get_settings()
engine = create_async_engine(
    _settings.database_url,
    echo=False,
    # SQLite: keep a small pool but fail fast so /health can't hang forever
    # when background dedupe/enrich holds connections on a large library.
    pool_size=5,
    max_overflow=10,
    pool_timeout=3,
    connect_args={"check_same_thread": False, "timeout": 15}
    if "sqlite" in _settings.database_url
    else {},
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
