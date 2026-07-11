"""Backfill animated GIF/WebP previews for image shots (EyeCandy hover loops).

Copies source .gif/.webp into shot artifact dirs and sets preview_path / has_preview.
Safe to re-run.

  docker compose exec api python -m cinearchive.scripts.backfill_gif_previews
  # or from host with PYTHONPATH=apps/api/src
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

from sqlalchemy import select

from cinearchive.config import get_settings
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger, setup_logging
from cinearchive.utils.paths import artifacts_base, library_root, to_relative
from qdrant_client import QdrantClient

logger = get_logger(__name__)


def _is_animated(path: Path) -> bool:
    if path.suffix.lower() == ".gif":
        return True
    if path.suffix.lower() != ".webp":
        return False
    try:
        from PIL import Image

        with Image.open(path) as im:
            return bool(getattr(im, "is_animated", False) and im.n_frames > 1)
    except Exception:
        return False


async def run(*, limit: int = 50_000, dry_run: bool = False) -> dict:
    settings = get_settings()
    setup_logging(settings.log_level)
    lib = library_root(settings)
    legacy = Path(settings.artifacts_dir)
    updated = 0
    skipped = 0
    missing = 0

    qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
    vector_repo = VectorRepository(qdrant, settings)

    async with SessionLocal() as session:
        q = (
            select(Shot)
            .where(Shot.source_type == "image")
            .where(Shot.deleted_at.is_(None))
            .limit(limit)
        )
        shots = list((await session.execute(q)).scalars().all())

        for shot in shots:
            # Already has a preview artifact
            if shot.preview_path and shot.has_preview:
                skipped += 1
                continue

            src = Path(shot.source_path)
            if not src.is_file():
                # try under library
                cand = lib / shot.source_path
                if cand.is_file():
                    src = cand
                else:
                    missing += 1
                    continue

            if not _is_animated(src):
                skipped += 1
                continue

            # Artifact dir from keyframe path parent
            if not shot.keyframe_path:
                missing += 1
                continue
            keyframe = lib / shot.keyframe_path
            if not keyframe.is_file():
                keyframe = legacy / shot.keyframe_path
            art_dir = keyframe.parent
            if not art_dir.is_dir():
                missing += 1
                continue

            dest = art_dir / f"preview{src.suffix.lower()}"
            if dry_run:
                logger.info("Would set preview for %s → %s", shot.id[:8], dest.name)
                updated += 1
                continue

            try:
                if not dest.is_file() or dest.stat().st_size == 0:
                    shutil.copy2(src, dest)
                base = artifacts_base(settings)
                shot.preview_path = to_relative(base, dest)
                shot.has_preview = True
                await session.flush()
                try:
                    vector_repo.set_payload(shot.id, shot_payload(shot))
                except Exception:
                    pass
                updated += 1
            except Exception as exc:
                logger.warning("Failed %s: %s", shot.id[:8], exc)
                missing += 1

        if not dry_run:
            await session.commit()

    logger.info(
        "GIF preview backfill: updated=%d skipped=%d missing=%d dry_run=%s",
        updated,
        skipped,
        missing,
        dry_run,
    )
    return {"updated": updated, "skipped": skipped, "missing": missing, "dry_run": dry_run}


def main() -> None:
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=50_000)
    args = p.parse_args()
    asyncio.run(run(limit=args.limit, dry_run=args.dry_run))


if __name__ == "__main__":
    main()
