"""Background VLM enrichment job + continuous improve helpers."""

from __future__ import annotations

import traceback
from pathlib import Path
from typing import Any

from cinearchive.config import Settings, get_settings
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.tag_quality import link_hints, score_enrichment
from cinearchive.pipelines.vlm_enrichment import VLMEnricher
from cinearchive.pipelines.vlm_tiers import (
    EnrichTier,
    detect_vram_gb,
    list_ollama_models,
    pick_model,
)
from cinearchive.repositories.shot_repo import ShotRepository
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.shot_mapper import shot_payload
from cinearchive.utils.logging import get_logger
from qdrant_client import QdrantClient

logger = get_logger(__name__)

ENRICHMENT_VERSION = 7


async def resolve_enrich_model(
    settings: Settings,
    *,
    tier: EnrichTier | None = None,
    model_override: str | None = None,
) -> tuple[str, EnrichTier, float | None]:
    """Pick Ollama vision model from tier / override / VRAM."""
    from cinearchive.pipelines.vlm_tiers import auto_tier_for_vram

    vram = detect_vram_gb()
    if vram is None and settings.enrich_vram_gb is not None:
        vram = float(settings.enrich_vram_gb)

    if model_override and model_override.strip():
        t: EnrichTier = tier or settings.enrich_tier  # type: ignore[assignment]
        resolved_override: EnrichTier = (
            auto_tier_for_vram(vram) if t == "auto" else t  # type: ignore[assignment]
        )
        return model_override.strip(), resolved_override, vram

    want: EnrichTier = tier or settings.enrich_tier  # type: ignore[assignment]
    installed = await list_ollama_models(settings.ollama_url)
    model, _info = pick_model(
        tier=want,
        installed=installed,
        vram_gb=vram,
        configured_default=settings.ollama_model,
    )
    resolved: EnrichTier = auto_tier_for_vram(vram) if want == "auto" else want
    return model, resolved, vram


def _apply_result(shot: Any, result: Any) -> dict[str, Any]:
    """Write enrichment fields onto shot; return quality report."""
    shot.shot_type = result.shot_type
    shot.camera_movement = result.camera_movement
    shot.camera_angle = result.camera_angle
    shot.lighting_style = result.lighting_style
    shot.composition = result.composition
    shot.subject = result.subject
    shot.lens_look = result.lens_look
    shot.color_grade = result.color_grade
    shot.mood_vibe = result.mood_vibe
    shot.creative_intent = result.creative_intent
    shot.emotion = result.emotion
    shot.content_format = result.content_format
    shot.era = result.era
    shot.origin = getattr(result, "origin", None) or getattr(shot, "origin", None)
    shot.ism = getattr(result, "ism", None) or getattr(shot, "ism", None)
    shot.visual_style = result.visual_style
    shot.theme = result.theme
    shot.genre = result.genre
    shot.shapes_json = result.shapes

    existing = [t for t in (shot.tags_json or []) if isinstance(t, str)]
    merged: list[str] = []
    for t in existing + list(result.tags or []):
        clean = t.strip()
        if clean and clean not in merged and clean.lower() != "unenriched":
            merged.append(clean)
        if len(merged) >= 32:
            break
    meta = shot.source_meta_json or {}
    for key in ("film_title", "movie_title"):
        ft = meta.get(key)
        if isinstance(ft, str) and ft.strip() and ft.strip() not in merged:
            merged.insert(0, ft.strip()[:96])
    if shot.source_title:
        base = shot.source_title.split(" — ", 1)[0].strip()
        if base and base not in merged:
            merged.insert(0, base[:96])
    # Craft link tags for search / connections
    for label, attr in (
        ("comp", "composition"),
        ("light", "lighting_style"),
        ("emotion", "emotion"),
        ("style", "visual_style"),
        ("theme", "theme"),
        ("ism", "ism"),
        ("origin", "origin"),
        ("era", "era"),
    ):
        val = getattr(shot, attr, None)
        if isinstance(val, str) and val.strip() and val.lower() not in {"other", "unknown", ""}:
            tag = f"{label}:{val.strip()}"
            if tag not in merged:
                merged.append(tag)
    # Director from archive meta → searchable + linkable
    director = (shot.source_meta_json or {}).get("director")
    if isinstance(director, str) and director.strip():
        dtag = f"director:{director.strip()}"
        if dtag not in merged:
            merged.insert(0, dtag[:96])
            if director.strip() not in merged:
                merged.insert(0, director.strip()[:96])
    shot.tags_json = merged
    shot.techniques_json = result.techniques
    shot.enrichment_version = ENRICHMENT_VERSION

    qa = score_enrichment(shot)
    meta = dict(shot.source_meta_json or {})
    meta["enrichment_quality"] = {
        "score": qa["score"],
        "pass": qa["pass"],
        "issues": qa["issues"],
        "checked_at_version": ENRICHMENT_VERSION,
    }
    meta["link_hints"] = link_hints(shot)
    shot.source_meta_json = meta
    return qa


async def run_enrich_job(
    job_id: str,
    project_id: str,
    *,
    shot_ids: list[str] | None = None,
    force: bool = False,
    tier: EnrichTier | None = None,
    model: str | None = None,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    from cinearchive.utils.paths import library_root

    artifacts = library_root(settings)
    legacy = Path(settings.artifacts_dir)

    try:
        await update_job(job_id, status="running", current_step="Loading shots", progress_pct=1.0)

        model_name, resolved_tier, vram = await resolve_enrich_model(
            settings, tier=tier, model_override=model
        )
        logger.info(
            "Enrich job %s using model=%s tier=%s vram=%s",
            job_id,
            model_name,
            resolved_tier,
            f"{vram:.1f}GB" if vram else "unknown",
        )

        project_ctx: dict = {}
        async with SessionLocal() as session:
            from cinearchive.db.models.project import Project

            project = await session.get(Project, project_id)
            if project:
                project_ctx = {
                    "project_name": project.name,
                    "project_brief": getattr(project, "brief", None),
                    "project_feeling": getattr(project, "feeling", None),
                    "project_references": getattr(project, "references_text", None),
                }
            repo = ShotRepository(session)
            if shot_ids:
                shots = await repo.get_many(shot_ids)
            else:
                shots = await repo.list_unenriched(project_id, force=force)
            work = [
                {
                    "id": s.id,
                    "keyframe_path": s.keyframe_path,
                    "source_title": getattr(s, "source_title", None),
                    "source_filename": getattr(s, "source_filename", None)
                    or Path(s.source_path).name,
                    "frame_role": getattr(s, "frame_role", None),
                    "is_moving": bool(getattr(s, "is_moving", False)),
                    "content_format": getattr(s, "content_format", None),
                }
                for s in shots
            ]

        if not work:
            await update_job(
                job_id,
                status="completed",
                current_step="Nothing to enrich",
                progress_pct=100.0,
                total_items=0,
                processed_items=0,
            )
            return

        await update_job(
            job_id,
            total_items=len(work),
            current_step=f"Enriching 0/{len(work)} · {model_name}",
        )

        enricher = VLMEnricher(settings, model=model_name)
        qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
        vector_repo = VectorRepository(qdrant, settings)

        processed = 0
        passed = 0
        failed_qa = 0
        for item in work:
            await update_job(
                job_id,
                current_step=f"Enriching {item['id'][:8]}… ({model_name})",
                progress_pct=round((processed / len(work)) * 100, 1),
                processed_items=processed,
            )
            keyframe = artifacts / item["keyframe_path"]
            if not keyframe.is_file():
                keyframe = legacy / item["keyframe_path"]
            if not keyframe.is_file():
                logger.warning("Missing keyframe for %s", item["id"])
                processed += 1
                continue

            result = await enricher.enrich_image(
                keyframe,
                context={
                    "source_title": item.get("source_title"),
                    "source_filename": item.get("source_filename"),
                    "frame_role": item.get("frame_role"),
                    "is_moving": item.get("is_moving"),
                    "content_hint": item.get("content_format"),
                    **project_ctx,
                },
            )

            async with SessionLocal() as session:
                repo = ShotRepository(session)
                shot = await repo.get(item["id"])
                if not shot:
                    processed += 1
                    continue
                qa = _apply_result(shot, result)
                if qa["pass"]:
                    passed += 1
                else:
                    failed_qa += 1
                    logger.info(
                        "Tag QA soft-fail %s score=%.1f issues=%s",
                        item["id"][:8],
                        qa["score"],
                        qa["issues"][:4],
                    )
                await session.commit()
                await session.refresh(shot)
                payload = shot_payload(shot)
                try:
                    from cinearchive.pipelines.sidecar_meta import write_shot_sidecar

                    write_shot_sidecar(shot)
                except Exception:
                    pass

            vector_repo.set_payload(item["id"], payload)
            processed += 1

        await update_job(
            job_id,
            status="completed",
            current_step=f"Done · {passed} pass / {failed_qa} need polish · {model_name}",
            progress_pct=100.0,
            processed_items=processed,
        )
        logger.info(
            "Enrich job %s completed (%d shots, %d QA pass, %d QA fail, model=%s)",
            job_id,
            processed,
            passed,
            failed_qa,
            model_name,
        )

    except Exception as exc:
        logger.error("Enrich job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        await update_job(
            job_id,
            status="failed",
            current_step="Failed",
            error_message=str(exc)[:2000],
            progress_pct=100.0,
        )


async def enrich_shot_batch(
    shot_ids: list[str],
    *,
    settings: Settings,
    model_name: str,
    project_ctx: dict | None = None,
) -> dict[str, int]:
    """Enrich a small batch (used by continuous scheduler). Returns counts."""
    from cinearchive.utils.paths import library_root

    artifacts = library_root(settings)
    legacy = Path(settings.artifacts_dir)
    enricher = VLMEnricher(settings, model=model_name)
    qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
    vector_repo = VectorRepository(qdrant, settings)
    ctx = project_ctx or {}

    ok = 0
    fail = 0
    for sid in shot_ids:
        async with SessionLocal() as session:
            repo = ShotRepository(session)
            shot = await repo.get(sid)
            if not shot:
                continue
            keyframe = artifacts / shot.keyframe_path
            if not keyframe.is_file():
                keyframe = legacy / shot.keyframe_path
            if not keyframe.is_file():
                fail += 1
                continue
            result = await enricher.enrich_image(
                keyframe,
                context={
                    "source_title": getattr(shot, "source_title", None),
                    "source_filename": getattr(shot, "source_filename", None)
                    or Path(shot.source_path).name,
                    "frame_role": getattr(shot, "frame_role", None),
                    "is_moving": bool(getattr(shot, "is_moving", False)),
                    "content_hint": getattr(shot, "content_format", None),
                    **ctx,
                },
            )
            qa = _apply_result(shot, result)
            await session.commit()
            await session.refresh(shot)
            payload = shot_payload(shot)
            try:
                from cinearchive.pipelines.sidecar_meta import write_shot_sidecar

                write_shot_sidecar(shot)
            except Exception:
                pass
            vector_repo.set_payload(sid, payload)
            if qa["pass"]:
                ok += 1
            else:
                fail += 1
    return {"ok": ok, "fail": fail, "total": len(shot_ids)}
