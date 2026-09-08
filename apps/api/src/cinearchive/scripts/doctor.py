"""Library doctor — SQLite is source of truth; Qdrant is a rebuildable index.

CLI:
  python -m cinearchive.scripts.doctor
  python -m cinearchive.scripts.doctor --json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import Any
from uuid import uuid4

from qdrant_client import QdrantClient
from sqlalchemy import select, text

from cinearchive.config import Settings, get_settings
from cinearchive.db.session import SessionLocal
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)


def _collection_vector_size(client: QdrantClient, name: str) -> int | None:
    try:
        info = client.get_collection(name)
        vectors = info.config.params.vectors
        if hasattr(vectors, "size"):
            return int(vectors.size)
        if isinstance(vectors, dict):
            for v in vectors.values():
                if hasattr(v, "size"):
                    return int(v.size)
        return None
    except Exception:
        return None


async def verify_library(
    settings: Settings | None = None,
    *,
    qdrant: QdrantClient | None = None,
    sample_limit: int = 5000,
) -> dict[str, Any]:
    """Compare SQLite shots vs Qdrant points; report orphans and dim mismatches."""
    settings = settings or get_settings()
    own_client = qdrant is None
    client = qdrant or QdrantClient(
        url=settings.qdrant_url, timeout=60, check_compatibility=False
    )
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []

    try:
        async with SessionLocal() as session:
            row = await session.execute(
                text("SELECT COUNT(*) FROM shots WHERE deleted_at IS NULL")
            )
            sqlite_active = int(row.scalar() or 0)
            row = await session.execute(
                text("SELECT COUNT(*) FROM shots WHERE deleted_at IS NOT NULL")
            )
            sqlite_trashed = int(row.scalar() or 0)
            row = await session.execute(text("SELECT COUNT(*) FROM projects"))
            projects = int(row.scalar() or 0)
            id_rows = await session.execute(
                text(
                    "SELECT id FROM shots WHERE deleted_at IS NULL "
                    f"LIMIT {int(sample_limit)}"
                )
            )
            sqlite_ids = {str(r[0]) for r in id_rows.fetchall()}

        collection = settings.qdrant_collection
        existing = {c.name for c in client.get_collections().collections}
        if collection not in existing:
            issues.append(
                {
                    "code": "qdrant_collection_missing",
                    "severity": "error",
                    "message": f"Collection {collection!r} does not exist",
                }
            )
            qdrant_count = 0
            dim = None
            qdrant_ids: set[str] = set()
        else:
            dim = _collection_vector_size(client, collection)
            if dim is not None and dim != settings.embedding_dim:
                issues.append(
                    {
                        "code": "embedding_dim_mismatch",
                        "severity": "error",
                        "message": (
                            f"Qdrant dim={dim} vs settings.embedding_dim="
                            f"{settings.embedding_dim} — reindex required before search"
                        ),
                        "qdrant_dim": dim,
                        "expected_dim": settings.embedding_dim,
                    }
                )
            try:
                qdrant_count = int(
                    client.count(collection_name=collection, exact=True).count
                )
            except Exception as exc:
                qdrant_count = -1
                warnings.append(
                    {
                        "code": "qdrant_count_failed",
                        "severity": "warning",
                        "message": str(exc),
                    }
                )

            qdrant_ids = set()
            try:
                offset = None
                while len(qdrant_ids) < sample_limit:
                    records, offset = client.scroll(
                        collection_name=collection,
                        limit=min(256, sample_limit - len(qdrant_ids)),
                        offset=offset,
                        with_payload=False,
                        with_vectors=False,
                    )
                    if not records:
                        break
                    for rec in records:
                        qdrant_ids.add(str(rec.id))
                    if offset is None:
                        break
            except Exception as exc:
                warnings.append(
                    {
                        "code": "qdrant_scroll_failed",
                        "severity": "warning",
                        "message": str(exc),
                    }
                )

        missing_in_qdrant = sorted(sqlite_ids - qdrant_ids)[:50]
        orphan_in_qdrant = sorted(qdrant_ids - sqlite_ids)[:50]
        if missing_in_qdrant:
            issues.append(
                {
                    "code": "shots_missing_vectors",
                    "severity": "error",
                    "message": (
                        f"{len(sqlite_ids - qdrant_ids)} sampled active shots lack Qdrant points"
                    ),
                    "examples": missing_in_qdrant[:10],
                    "count": len(sqlite_ids - qdrant_ids),
                }
            )
        if orphan_in_qdrant:
            warnings.append(
                {
                    "code": "orphan_qdrant_points",
                    "severity": "warning",
                    "message": (
                        f"{len(qdrant_ids - sqlite_ids)} sampled Qdrant points not in active SQLite"
                    ),
                    "examples": orphan_in_qdrant[:10],
                    "count": len(qdrant_ids - sqlite_ids),
                }
            )

        if qdrant_count >= 0 and sqlite_active != qdrant_count:
            warnings.append(
                {
                    "code": "count_drift",
                    "severity": "warning",
                    "message": (
                        f"SQLite active shots={sqlite_active} vs Qdrant points={qdrant_count}"
                    ),
                }
            )

        ok = not any(i.get("severity") == "error" for i in issues)
        return {
            "ok": ok,
            "sqlite": {
                "projects": projects,
                "shots_active": sqlite_active,
                "shots_trashed": sqlite_trashed,
                "ids_sampled": len(sqlite_ids),
            },
            "qdrant": {
                "collection": settings.qdrant_collection,
                "points": qdrant_count,
                "vector_size": dim,
                "expected_dim": settings.embedding_dim,
                "embedding_model": settings.embedding_model,
                "ids_sampled": len(qdrant_ids),
            },
            "issues": issues,
            "warnings": warnings,
            "repair": {
                "rebuild_index": "POST /system/rebuild-index",
                "reindex_project": "POST /projects/{id}/reindex",
            },
        }
    finally:
        if own_client:
            client.close()


async def rebuild_all_indexes(
    settings: Settings | None = None,
    *,
    background_add_task=None,
) -> dict[str, Any]:
    """Enqueue reindex jobs for every project (SQLite → Qdrant)."""
    from cinearchive.db.models.job import Job
    from cinearchive.db.models.project import Project
    from cinearchive.jobs.reindex_runner import run_reindex_job
    from cinearchive.repositories.job_repo import JobRepository
    from cinearchive.repositories.vector_repo import VectorRepository

    settings = settings or get_settings()
    client = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
    try:
        VectorRepository(client, settings).ensure_collection()
    finally:
        client.close()

    job_ids: list[str] = []
    async with SessionLocal() as session:
        result = await session.execute(select(Project.id))
        project_ids = [str(r[0]) for r in result.fetchall()]
        job_repo = JobRepository(session)
        for pid in project_ids:
            job = Job(
                id=str(uuid4()),
                project_id=pid,
                type="reindex",
                status="pending",
                progress_pct=0.0,
                current_step="queued",
                total_items=0,
                processed_items=0,
                payload_json={"source": "doctor_rebuild"},
            )
            await job_repo.create(job)
            job_ids.append(job.id)
            if background_add_task is not None:
                background_add_task(run_reindex_job, job.id, pid, settings=settings)
        await session.commit()

    return {
        "ok": True,
        "projects": len(project_ids),
        "job_ids": job_ids,
        "message": "Reindex jobs queued — SQLite remains source of truth",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify Cinekive SQLite ↔ Qdrant consistency")
    parser.add_argument("--json", action="store_true", help="Print full JSON report")
    args = parser.parse_args(argv)

    report = asyncio.run(verify_library())
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        status = "OK" if report["ok"] else "ISSUES"
        print(f"Cinekive doctor: {status}")
        sq = report["sqlite"]
        qd = report["qdrant"]
        print(
            f"  SQLite  projects={sq['projects']} active_shots={sq['shots_active']} "
            f"trashed={sq['shots_trashed']}"
        )
        print(
            f"  Qdrant  collection={qd['collection']} points={qd['points']} "
            f"dim={qd['vector_size']} (expected {qd['expected_dim']})"
        )
        print(f"  Model   {qd['embedding_model']}")
        for item in report["issues"]:
            print(f"  ERROR   [{item['code']}] {item['message']}")
        for item in report["warnings"]:
            print(f"  WARN    [{item['code']}] {item['message']}")
        if not report["ok"]:
            print("  Repair: POST /system/rebuild-index  or  per-project reindex")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
