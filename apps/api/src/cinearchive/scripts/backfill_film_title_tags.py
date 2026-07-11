"""Backfill film titles into tags_json so hybrid search finds existing FilmGrab shots.

Run inside API container or with PYTHONPATH=apps/api/src:

  python -m cinearchive.scripts.backfill_film_title_tags

Or:

  docker exec cinearchive-api python -c "import asyncio; from cinearchive.scripts.backfill_film_title_tags import main; asyncio.run(main())"
"""

from __future__ import annotations

import asyncio
import re

from sqlalchemy import select

from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def _film_title_from_shot(shot: Shot) -> str | None:
    meta = shot.source_meta_json or {}
    for key in ("film_title", "movie_title"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    title = (shot.source_title or "").strip()
    if not title:
        return None
    if " — " in title:
        return title.split(" — ", 1)[0].strip() or None
    # FilmGrab-style: title is the film name (not a bare filename)
    if title.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
        return None
    return title


async def main(*, limit: int = 50_000) -> None:
    updated = 0
    async with SessionLocal() as session:
        result = await session.execute(
            select(Shot).where(Shot.deleted_at.is_(None)).limit(limit)
        )
        shots = list(result.scalars().all())
        for shot in shots:
            film = _film_title_from_shot(shot)
            if not film:
                continue
            tags = [t for t in (shot.tags_json or []) if isinstance(t, str)]
            slug = re.sub(r"[^a-z0-9]+", "-", film.lower()).strip("-")
            changed = False
            for candidate in (film, slug):
                if candidate and candidate not in tags:
                    tags.insert(0, candidate[:96])
                    changed = True
            if not changed:
                continue
            shot.tags_json = tags[:32]
            updated += 1
        await session.commit()
    logger.info("Backfilled film title tags on %s shots", updated)
    print(f"updated={updated}")


if __name__ == "__main__":
    asyncio.run(main())
