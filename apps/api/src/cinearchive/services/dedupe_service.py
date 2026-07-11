"""Project-wide near-duplicate detection and sequence collapse helpers."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.db.models.shot import Shot
from cinearchive.pipelines.sequence_grader import find_near_duplicate, hamming_distance
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


async def load_project_hashes(
    session: AsyncSession,
    project_id: str,
    *,
    exclude_duplicates: bool = True,
) -> list[tuple[str, str]]:
    """Return [(phash, shot_id), ...] for existing project shots."""
    q = select(Shot.id, Shot.phash).where(
        Shot.project_id == project_id,
        Shot.phash.is_not(None),
        Shot.phash != "",
    )
    if exclude_duplicates:
        q = q.where(Shot.is_duplicate == False)  # noqa: E712
    rows = (await session.execute(q)).all()
    return [(str(phash), str(sid)) for sid, phash in rows if phash]


def pick_sequence_representative(shots: list[Shot]) -> Shot:
    """Prefer mid/still with preview, then highest hero_score."""

    def rank(s: Shot) -> tuple:
        role = (s.frame_role or "").lower()
        role_rank = 0 if role in ("mid", "still", "") else 1
        return (
            role_rank,
            0 if s.has_preview else 1,
            -(float(s.hero_score or 0)),
            s.created_at.timestamp() if s.created_at else 0,
        )

    return sorted(shots, key=rank)[0]


def collapse_shots_to_sequences(shots: Iterable[Shot]) -> list[Shot]:
    """One shot per sequence_id (or per id when sequence_id is missing)."""
    groups: dict[str, list[Shot]] = defaultdict(list)
    order: list[str] = []
    for s in shots:
        key = s.sequence_id or s.id
        if key not in groups:
            order.append(key)
        groups[key].append(s)
    return [pick_sequence_representative(groups[k]) for k in order]


def mark_within_sequence_duplicates(
    frames: list[tuple[str, str, str]],
    *,
    threshold: int = 8,
) -> dict[str, str]:
    """
    Given [(shot_id, phash, frame_role), ...] for one sequence, mark near-dupes
    of the mid/still frame (or first frame) as duplicates.

    Returns {duplicate_shot_id: canonical_shot_id}.
    """
    if len(frames) < 2:
        return {}
    # Prefer mid as canonical
    canonical = None
    for sid, ph, role in frames:
        if role in ("mid", "still"):
            canonical = (sid, ph)
            break
    if canonical is None:
        canonical = (frames[0][0], frames[0][1])

    canon_id, canon_hash = canonical
    dups: dict[str, str] = {}
    for sid, ph, role in frames:
        if sid == canon_id or not ph or not canon_hash:
            continue
        if hamming_distance(ph, canon_hash) <= threshold:
            dups[sid] = canon_id
    return dups


async def load_global_hashes(
    session: AsyncSession,
    *,
    exclude_duplicates: bool = True,
) -> list[tuple[str, str]]:
    """Return [(phash, shot_id), ...] across all projects for ingest-time dedupe."""
    q = select(Shot.id, Shot.phash).where(
        Shot.phash.is_not(None),
        Shot.phash != "",
    )
    if exclude_duplicates:
        q = q.where(Shot.is_duplicate == False)  # noqa: E712
    rows = (await session.execute(q)).all()
    return [(str(phash), str(sid)) for sid, phash in rows if phash]


async def dedupe_across_all_projects(
    session: AsyncSession,
    *,
    threshold: int = 10,
) -> dict[str, int]:
    """Mark near-duplicates across every project/archive (best hero_score wins)."""
    result = await session.execute(
        select(Shot)
        .where(
            Shot.phash.is_not(None),
            Shot.phash != "",
            Shot.is_duplicate == False,  # noqa: E712
        )
        .order_by(Shot.hero_score.desc(), Shot.created_at.asc())
    )
    shots = list(result.scalars().all())
    known: list[tuple[str, str]] = []
    marked = 0
    for s in shots:
        ph = s.phash or ""
        hit = find_near_duplicate(ph, known, threshold=threshold)
        if hit:
            s.is_duplicate = True
            s.duplicate_of = hit
            marked += 1
        else:
            known.append((ph, s.id))
    await session.commit()
    logger.info("Global cross-archive dedupe: scanned=%d marked=%d", len(shots), marked)
    return {"scanned": len(shots), "marked_duplicate": marked}


async def dedupe_all_projects(
    session: AsyncSession,
    project_ids: list[str],
    *,
    threshold: int = 10,
    sequence_threshold: int = 8,
) -> dict[str, int]:
    """Per-project pass then cross-archive pass."""
    totals = {"projects": 0, "scanned": 0, "marked_duplicate": 0, "sequences_collapsed": 0}
    for pid in project_ids:
        stats = await dedupe_project_shots(
            session,
            pid,
            threshold=threshold,
            sequence_threshold=sequence_threshold,
        )
        totals["projects"] += 1
        totals["scanned"] += stats.get("scanned", 0)
        totals["marked_duplicate"] += stats.get("marked_duplicate", 0)
        totals["sequences_collapsed"] += stats.get("sequences_collapsed", 0)
    global_stats = await dedupe_across_all_projects(session, threshold=threshold)
    totals["marked_duplicate"] += global_stats.get("marked_duplicate", 0)
    totals["global_scanned"] = global_stats.get("scanned", 0)
    return totals


async def dedupe_project_shots(
    session: AsyncSession,
    project_id: str,
    *,
    threshold: int = 10,
    sequence_threshold: int = 8,
) -> dict[str, int]:
    """
    Recompute is_duplicate / duplicate_of for an entire project.

    Strategy:
    1. Within each sequence_id, collapse near-identical start/end onto mid.
    2. Across the project, first-seen (highest hero_score) wins; later near-dupes flagged.
    """
    result = await session.execute(
        select(Shot)
        .where(Shot.project_id == project_id)
        .order_by(Shot.hero_score.desc(), Shot.created_at.asc())
    )
    shots = list(result.scalars().all())
    if not shots:
        return {"scanned": 0, "marked_duplicate": 0, "cleared": 0, "sequences_collapsed": 0}

    # Reset then recompute
    for s in shots:
        s.is_duplicate = False
        s.duplicate_of = None

    seq_groups: dict[str, list[Shot]] = defaultdict(list)
    for s in shots:
        if s.sequence_id:
            seq_groups[s.sequence_id].append(s)

    sequences_collapsed = 0
    for seq_shots in seq_groups.values():
        frames = [(s.id, s.phash or "", s.frame_role or "") for s in seq_shots]
        dups = mark_within_sequence_duplicates(frames, threshold=sequence_threshold)
        if dups:
            sequences_collapsed += 1
            by_id = {s.id: s for s in seq_shots}
            for dup_id, canon_id in dups.items():
                shot = by_id[dup_id]
                shot.is_duplicate = True
                shot.duplicate_of = canon_id

    # Project-wide: walk by hero_score desc so best frame is canonical
    known: list[tuple[str, str]] = []
    marked = 0
    for s in shots:
        if s.is_duplicate:
            marked += 1
            continue
        ph = s.phash or ""
        if not ph:
            known.append(("", s.id))  # keep slot but won't match
            continue
        hit = find_near_duplicate(ph, known, threshold=threshold)
        if hit:
            s.is_duplicate = True
            s.duplicate_of = hit
            marked += 1
        else:
            known.append((ph, s.id))

    await session.commit()
    logger.info(
        "Dedupe project %s: scanned=%d marked=%d sequences_collapsed=%d",
        project_id,
        len(shots),
        marked,
        sequences_collapsed,
    )
    return {
        "scanned": len(shots),
        "marked_duplicate": marked,
        "cleared": 0,
        "sequences_collapsed": sequences_collapsed,
    }
