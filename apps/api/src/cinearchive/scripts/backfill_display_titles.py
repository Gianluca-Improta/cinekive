"""Backfill human-readable display titles on existing archive shots.

  docker exec cinearchive-api python -m cinearchive.scripts.backfill_display_titles
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from sqlalchemy import select

from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.pipelines.archive_meta import (
    enrich_archive_meta,
    eyecandy_clean_title,
)
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def _film_title_from_shot(shot: Shot) -> str | None:
    meta = dict(shot.source_meta_json or {})
    for key in ("film_title", "movie_title"):
        val = meta.get(key)
        if isinstance(val, str) and val.strip():
            # Reject opaque shot IDs
            if re.fullmatch(r"[A-Z0-9]{6,12}", val.strip()):
                continue
            return val.strip().split(" — ", 1)[0].strip()

    path = (shot.source_path or "").replace("\\", "/")
    parts = path.split("/")
    # …/_filmgrab/{Film}/file.jpg
    for marker in ("_filmgrab", "filmgrab", "_moviestillsdb", "moviestillsdb", "_stillslab", "stillslab"):
        for i, p in enumerate(parts):
            if p.lower() == marker or marker in p.lower():
                if i + 1 < len(parts) - 1:
                    cand = parts[i + 1]
                    if cand.lower() not in {
                        "by_movie", "by_commercial", "by_music_video", "by_indie",
                        "by_title", "inbox", "stills", "cache",
                    }:
                        return cand
    # …/_shotdeck/by_movie|by_commercial|by_music_video|by_indie/{Title}/id.jpg
    for i, p in enumerate(parts):
        if p.lower() in {"by_movie", "by_commercial", "by_music_video", "by_indie"} and i + 1 < len(parts) - 1:
            return parts[i + 1]
    # …/_eyecandy/{technique}/{Title}__ec123.gif
    for i, p in enumerate(parts):
        if "eyecandy" in p.lower() and shot.source_filename:
            return eyecandy_clean_title(shot.source_filename)
    return None


async def main(*, limit: int = 50_000) -> None:
    updated = 0
    async with SessionLocal() as session:
        result = await session.execute(
            select(Shot).where(Shot.deleted_at.is_(None)).limit(limit)
        )
        shots = list(result.scalars().all())
        for shot in shots:
            meta = dict(shot.source_meta_json or {})
            film = _film_title_from_shot(shot)
            fname = shot.source_filename or meta.get("filename")
            # EyeCandy cleanup when title still has ec####
            if meta.get("eyecandy") or (shot.source_path or "").lower().find("eyecandy") >= 0:
                if fname:
                    clean = eyecandy_clean_title(str(fname))
                    if not film:
                        film = clean
            enrich_archive_meta(meta, filename=str(fname) if fname else None, film_title=film)
            display = meta.get("display_title")
            if not display:
                continue
            changed = False
            if shot.source_title != display:
                shot.source_title = display
                changed = True
            if shot.source_meta_json != meta:
                shot.source_meta_json = meta
                changed = True
            if changed:
                updated += 1
        await session.commit()
    logger.info("Backfilled display titles on %s shots", updated)
    print(f"updated={updated}")


if __name__ == "__main__":
    asyncio.run(main())
