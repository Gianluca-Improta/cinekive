"""API routes package."""

from cinearchive.api.routes import (
    collections,
    enrich,
    health,
    ingest,
    jobs,
    projects,
    search,
    seek,
    shots,
    sources,
    taxonomy,
)

__all__ = [
    "health",
    "projects",
    "ingest",
    "jobs",
    "shots",
    "search",
    "enrich",
    "collections",
    "seek",
    "sources",
    "taxonomy",
]
