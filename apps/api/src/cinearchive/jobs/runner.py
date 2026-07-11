"""Background ingest job runner — durable per-file commits + library layout."""

from __future__ import annotations

import re
import shutil
import traceback
from pathlib import Path
from uuid import UUID, uuid4

from sqlalchemy import select

from cinearchive.config import Settings, get_settings
from cinearchive.db.models.ingest_batch import IngestBatch
from cinearchive.db.models.project import Project
from cinearchive.db.models.shot import Shot
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.progress import update_job
from cinearchive.pipelines.color_analysis import analyze_colors
from cinearchive.pipelines.embedding import get_embedding_pipeline
from cinearchive.pipelines.frame_extractor import (
    copy_image_as_keyframe,
    extract_keyframe,
    make_thumbnails,
)
from cinearchive.pipelines.preview_generator import generate_preview
from cinearchive.pipelines.scene_detection import detect_scenes, keyframe_times
from cinearchive.pipelines.vlm_enrichment import source_title_from_path
from cinearchive.pipelines.archive_meta import (
    enrich_archive_meta,
    eyecandy_clean_title,
    frame_label_from_filename,
)
from cinearchive.pipelines.sequence_grader import (
    GradedSequence,
    find_near_duplicate,
    grade_sequences,
    perceptual_hash,
)
from cinearchive.repositories.vector_repo import VectorRepository
from cinearchive.services.dedupe_service import (
    load_global_hashes,
    load_project_hashes,
    mark_within_sequence_duplicates,
)
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import artifacts_base, shot_artifact_dir, to_relative
from qdrant_client import QdrantClient

logger = get_logger(__name__)

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def _techniques_from_path(media_path: Path) -> list[str]:
    """Pre-tag from parent folder for EyeCandy-style mirrors.

    Matches …/_eyecandy/{technique}/file.gif or any path segment named like
    eyecandy / eye-candy when folders are dropped into a custom archive.
    """
    from cinearchive.pipelines.taxonomy import normalize_technique

    parts = list(media_path.parts)
    parts_lower = [p.lower() for p in parts]
    marker_idx = -1
    for i, part in enumerate(parts_lower):
        if part in {"_eyecandy", "eyecandy", "eye-candy", "eye_candy"} or "eyecandy" in part:
            marker_idx = i
            break
    if marker_idx < 0:
        return []
    # Technique is the folder directly under the eyecandy root when possible
    if marker_idx + 1 < len(parts) - 1:
        parent = parts[marker_idx + 1].lower().strip()
    else:
        parent = media_path.parent.name.lower().strip()
    if not parent or parent.startswith(".") or parent in {
        "stills", "videos", "shots", "inbox", "clips", "meta", "cache",
        "by_movie", "by_commercial", "by_music_video", "by_indie"
    }:
        return []
    tech = normalize_technique(parent)
    if tech:
        return [tech]
    clean = parent.replace("_", "-").replace(" ", "-")
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", clean):
        return [clean]
    return []


def _filmgrab_meta_from_path(media_path: Path) -> dict | None:
    """FilmGrab: …/_filmgrab/{Film Title}/still.jpg or dropped folder named filmgrab."""
    parts = list(media_path.parts)
    parts_lower = [p.lower() for p in parts]
    marker_idx = -1
    for i, part in enumerate(parts_lower):
        if part in {"_filmgrab", "filmgrab", "film-grab", "film_grab"} or part.endswith("filmgrab"):
            marker_idx = i
            break
    if marker_idx < 0:
        # Sidecar next to file still counts
        sidecar = media_path.parent / "_filmgrab.json"
        if not sidecar.exists():
            return None
    parent = media_path.parent
    if parent.name.startswith("."):
        return None
    sidecar = parent / "_filmgrab.json"
    if sidecar.exists():
        try:
            import json

            data = json.loads(sidecar.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("title"):
                data = dict(data)
                data.setdefault("source", "filmgrab")
                return data
        except Exception:
            pass
    if marker_idx < 0:
        return None
    # Film title folder is under the filmgrab root
    if marker_idx + 1 < len(parts) - 1:
        title = parts[marker_idx + 1].strip()
    else:
        title = parent.name.strip()
    if not title or title.lower() in {"stills", "videos", "shots", "inbox"}:
        return None
    return {"source": "filmgrab", "title": title}


def _shotdeck_meta_from_path(media_path: Path) -> dict | None:
    """ShotDeck: …/_shotdeck/by_commercial|by_music_video|by_indie/{Title}/{id}.jpg."""
    parts = list(media_path.parts)
    parts_lower = [p.lower() for p in parts]
    marker_idx = -1
    for i, part in enumerate(parts_lower):
        if part in {"_shotdeck", "shotdeck", "shot-deck", "shot_deck"} or "shotdeck" in part:
            marker_idx = i
            break
    if media_path.name.startswith("."):
        return None
    sidecar = media_path.with_suffix(".json")
    if sidecar.exists():
        try:
            import json

            data = json.loads(sidecar.read_text(encoding="utf-8"))
            if isinstance(data, dict) and (
                data.get("source") == "shotdeck" or data.get("movie_title") or data.get("shot_id")
            ):
                data = dict(data)
                data.setdefault("source", "shotdeck")
                return data
        except Exception:
            pass
    if marker_idx < 0:
        return None
    parent = media_path.parent
    # Skip by_movie intermediate and the shotdeck root itself
    title_dir = parent
    if title_dir.name.lower() in {
        "by_movie",
        "by_commercial",
        "by_music_video",
        "by_indie",
        "cache",
        "meta",
        "stills",
        "inbox",
        "_shotdeck",
        "shotdeck",
        "shot-deck",
        "shot_deck",
    }:
        # Flat dump under _shotdeck — only shot_id known until sidecar has movie_title
        return {
            "source": "shotdeck",
            "shot_id": media_path.stem,
        }
    if title_dir.name.startswith("."):
        return None
    title = title_dir.name.strip()
    if not title:
        return None
    # Don't treat opaque shot IDs as movie titles
    if re.fullmatch(r"[A-Z0-9]{6,12}", title):
        return {
            "source": "shotdeck",
            "shot_id": media_path.stem,
        }
    return {
        "source": "shotdeck",
        "movie_title": title,
        "shot_id": media_path.stem,
    }


def collect_files(paths: list[str], *, recursive: bool, exts: set[str]) -> list[Path]:
    found: list[Path] = []
    for raw in paths:
        p = Path(raw)
        if p.is_file() and p.suffix.lower() in exts:
            found.append(p.resolve())
        elif p.is_dir():
            pattern = "**/*" if recursive else "*"
            for child in p.glob(pattern):
                if not child.is_file() or child.suffix.lower() not in exts:
                    continue
                # Skip mirror cache / hidden dirs / sidecars
                if any(part.startswith(".") for part in child.parts):
                    continue
                if child.name.startswith("_"):
                    continue
                found.append(child.resolve())
    seen: set[str] = set()
    unique: list[Path] = []
    for f in found:
        key = str(f)
        if key not in seen:
            seen.add(key)
            unique.append(f)
    return unique


def _build_payload(shot: Shot, source_filename: str) -> dict:
    from cinearchive.services.shot_mapper import shot_payload

    return shot_payload(shot, source_filename)


def _zero_vectors(n: int, dim: int) -> list[list[float]]:
    return [[0.0] * dim for _ in range(n)]


async def _project_slug(project_id: str) -> str:
    async with SessionLocal() as session:
        project = await session.get(Project, project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        return project.slug


    return {"source": "shotdeck", "movie_title": title, "shot_id": shot_id}


def _archive_folder_meta_from_path(
    media_path: Path, *, markers: set[str], source: str, title_key: str = "title"
) -> dict | None:
    parts = [p.lower() for p in media_path.parts]
    idx = None
    for i, part in enumerate(parts):
        if part in markers or any(m in part for m in markers):
            idx = i
            break
    if idx is None:
        return None
    title = media_path.parent.name if media_path.parent.name else media_path.stem
    if idx + 1 < len(media_path.parts):
        title = media_path.parts[idx + 1]
    return {title_key: title, "source": source}


def _moviestillsdb_meta_from_path(media_path: Path) -> dict | None:
    return _archive_folder_meta_from_path(
        media_path,
        markers={"_moviestillsdb", "moviestillsdb", "movie-stills-db"},
        source="moviestillsdb",
    )


def _stillslab_meta_from_path(media_path: Path) -> dict | None:
    meta = _archive_folder_meta_from_path(
        media_path,
        markers={"_stillslab", "stillslab", "stills-lab"},
        source="stillslab",
        title_key="movie_title",
    )
    if meta and "by_title" in [p.lower() for p in media_path.parts]:
        parts = media_path.parts
        for i, p in enumerate(parts):
            if p.lower() == "by_title" and i + 1 < len(parts):
                meta["movie_title"] = parts[i + 1]
                break
    return meta


async def run_ingest_job(
    job_id: str,
    project_id: str,
    source_paths: list[str],
    *,
    mode: str,  # video | images
    recursive: bool = True,
    sampling_mode: str = "fast",
    generate_previews: bool = True,
    collection_id: str | None = None,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    lib_base = artifacts_base(settings)

    try:
        await update_job(
            job_id,
            status="running",
            current_step="Collecting files",
            progress_pct=1.0,
        )

        slug = await _project_slug(project_id)

        if mode == "video":
            files = collect_files(source_paths, recursive=recursive, exts=VIDEO_EXTS)
        else:
            files = collect_files(source_paths, recursive=recursive, exts=IMAGE_EXTS)

        if not files:
            await update_job(
                job_id,
                status="failed",
                current_step="No matching files found",
                error_message="No video/image files matched the provided paths",
                progress_pct=100.0,
            )
            return

        # Skip paths already in this project so catch-up ingest is safe while mirrors keep downloading
        async with SessionLocal() as session:
            from cinearchive.repositories.shot_repo import ShotRepository

            known = await ShotRepository(session).list_source_paths(project_id)
        if known:
            known_norm = {str(Path(k)).replace("\\", "/").lower() for k in known}
            before = len(files)
            files = [f for f in files if str(f).replace("\\", "/").lower() not in known_norm]
            skipped = before - len(files)
            if skipped:
                logger.info("Ingest %s: skipping %d already-known files", job_id, skipped)

        if not files:
            await update_job(
                job_id,
                status="completed",
                current_step="Nothing new — all files already in this archive",
                progress_pct=100.0,
                processed_items=0,
                total_items=0,
            )
            return

        await update_job(job_id, total_items=len(files), current_step=f"Processing 0/{len(files)}")

        # Warm embedding model once (fail soft — shots still saved)
        embedder = get_embedding_pipeline(settings)
        embed_ok = True
        try:
            embedder.load()
        except Exception as exc:
            embed_ok = False
            logger.error("Embedding model failed to load: %s — shots will be saved without vectors", exc)

        qdrant = QdrantClient(url=settings.qdrant_url, timeout=60, check_compatibility=False)
        vector_repo = VectorRepository(qdrant, settings)
        try:
            vector_repo.ensure_collection()
        except Exception as exc:
            logger.warning("Qdrant ensure_collection: %s", exc)

        processed = 0
        file_errors: list[str] = []
        created_shot_ids: list[str] = []

        for file_idx, media_path in enumerate(files):
            step = f"Processing {media_path.name} ({file_idx + 1}/{len(files)})"
            await update_job(
                job_id,
                current_step=step,
                progress_pct=round(5 + (file_idx / max(len(files), 1)) * 90, 1),
                processed_items=processed,
            )

            try:
                pending_shots: list[Shot] = []
                keyframe_paths: list[Path] = []

                # Project-wide + per-file hash index for near-dupe detection
                async with SessionLocal() as session:
                    if settings.dedupe_global:
                        seen_hashes = await load_global_hashes(session)
                    else:
                        seen_hashes = await load_project_hashes(session, project_id)
                file_hashes: list[tuple[str, str]] = []

                if mode == "video":
                    from cinearchive.utils.ffmpeg import probe_video

                    try:
                        probe = probe_video(media_path)
                        source_fps = float(probe.get("fps") or 0) or None
                    except Exception:
                        probe = {}
                        source_fps = None

                    scenes = detect_scenes(media_path, threshold=settings.scene_detect_threshold)
                    # heroes/curated/fast → top N; moments → all graded, top N marked hero; full → every scene
                    keep_all_moments = sampling_mode in ("moments", "all")
                    use_heroes = sampling_mode not in ("full",)

                    if use_heroes or keep_all_moments:
                        graded = grade_sequences(
                            media_path,
                            scenes,
                            max_heroes=settings.max_heroes_per_video,
                            motion_threshold=settings.motion_threshold,
                            keep_all=keep_all_moments,
                            use_audio=settings.grade_use_audio,
                        )
                        hero_seq_ids: set[str] = set()
                        work_items = []
                        for rank, g in enumerate(graded):
                            seq_id = str(uuid4())
                            if rank < settings.max_heroes_per_video:
                                hero_seq_ids.add(seq_id)
                            times = g.sample_times
                            roles = g.frame_roles
                            if sampling_mode == "fast":
                                mid_i = roles.index("mid") if "mid" in roles else 0
                                times = [times[mid_i]]
                                roles = ["mid"]
                            for role, t_sec in zip(roles, times, strict=True):
                                work_items.append((g, seq_id, role, t_sec, seq_id in hero_seq_ids))
                    else:
                        work_items = []
                        for scene in scenes:
                            seq_id = str(uuid4())
                            times = keyframe_times(scene, sampling_mode)
                            roles = (
                                ["start", "mid", "end"][: len(times)]
                                if len(times) > 1
                                else ["mid"]
                            )
                            g = GradedSequence(
                                scene=scene,
                                score=0.5,
                                motion_score=0.0,
                                sharpness_score=0.5,
                                color_score=0.5,
                                is_moving=len(times) > 1,
                                sample_times=times,
                                frame_roles=roles,
                                reason="full-sample",
                                preview_duration_sec=(
                                    settings.preview_moving_min_sec
                                    if len(times) > 1
                                    else settings.preview_static_sec
                                ),
                            )
                            for role, t_sec in zip(roles, times, strict=True):
                                work_items.append((g, seq_id, role, t_sec, role == "mid"))

                    # Track frames per sequence for within-sequence collapse
                    seq_frames: dict[str, list[tuple[str, str, str]]] = {}

                    for g, seq_id, role, t_sec, is_hero_seq in work_items:
                        scene = g.scene
                        shot_id = str(uuid4())
                        art_dir = shot_artifact_dir(settings, slug, shot_id)
                        keyframe = art_dir / "keyframe.jpg"
                        extract_keyframe(media_path, t_sec, keyframe)
                        thumb_sm = art_dir / "thumb_sm.webp"
                        thumb_md = art_dir / "thumb_md.webp"
                        _, _, width, height = make_thumbnails(
                            keyframe, thumb_sm=thumb_sm, thumb_md=thumb_md
                        )
                        colors = analyze_colors(keyframe)
                        phash = perceptual_hash(keyframe)

                        is_dup = False
                        dup_of = None
                        hit = find_near_duplicate(
                            phash,
                            seen_hashes + file_hashes,
                            threshold=settings.dedupe_hamming_threshold,
                        )
                        if hit:
                            is_dup = True
                            dup_of = hit
                        elif phash:
                            file_hashes.append((phash, shot_id))

                        preview_path = None
                        has_preview = False
                        # GIF/loop on mid frame — longer for moving sequences
                        if generate_previews and role in ("mid", "still"):
                            ext = settings.preview_format
                            preview_file = art_dir / f"preview.{ext}"
                            clip_dur = float(
                                getattr(g, "preview_duration_sec", None)
                                or (
                                    settings.preview_moving_min_sec
                                    if g.is_moving
                                    else settings.preview_static_sec
                                )
                            )
                            result = generate_preview(
                                media_path,
                                start_sec=scene.start_sec,
                                end_sec=scene.end_sec,
                                output=preview_file,
                                duration_sec=clip_dur,
                                fmt=ext,
                            )
                            if result:
                                preview_path = to_relative(lib_base, result)
                                has_preview = True

                        signals = dict(getattr(g, "signals", None) or {})
                        shot = Shot(
                            id=shot_id,
                            project_id=project_id,
                            collection_id=collection_id,
                            source_type="video",
                            source_path=str(media_path),
                            source_filename=media_path.name,
                            source_title=source_title_from_path(media_path),
                            source_meta_json={
                                "filename": media_path.name,
                                "title": source_title_from_path(media_path),
                                "ext": media_path.suffix.lower(),
                                "scene_index": scene.index,
                                "frame_role": role,
                                "is_moving": bool(g.is_moving),
                                "grade_reason": g.reason,
                                "motion_score": float(g.motion_score),
                                "hero_score": float(g.score),
                                "audio_score": float(getattr(g, "audio_score", 0) or 0),
                                "speechiness": float(getattr(g, "speechiness", 0) or 0),
                                "signals": signals,
                                "fps": source_fps,
                                "keyframe_sec": float(t_sec),
                            },
                            scene_index=scene.index,
                            start_timecode_ms=int(scene.start_sec * 1000),
                            end_timecode_ms=int(scene.end_sec * 1000),
                            duration_ms=int(scene.duration_sec * 1000),
                            keyframe_ms=int(float(t_sec) * 1000),
                            source_fps=source_fps,
                            keyframe_path=to_relative(lib_base, keyframe),
                            thumb_sm_path=to_relative(lib_base, thumb_sm),
                            thumb_md_path=to_relative(lib_base, thumb_md),
                            preview_path=preview_path,
                            width=width,
                            height=height,
                            dominant_colors_json=colors,
                            has_preview=has_preview,
                            qdrant_point_id=shot_id,
                            tags_json=[],
                            techniques_json=[],
                            shapes_json=[],
                            enrichment_version=0,
                            is_favorite=False,
                            sequence_id=seq_id,
                            frame_role=role,
                            hero_score=float(g.score),
                            is_hero=bool(is_hero_seq) if (use_heroes or keep_all_moments) else (role == "mid"),
                            is_moving=bool(g.is_moving),
                            grade_reason=g.reason,
                            phash=phash or None,
                            is_duplicate=is_dup,
                            duplicate_of=dup_of,
                        )
                        pending_shots.append(shot)
                        keyframe_paths.append(keyframe)
                        seq_frames.setdefault(seq_id, []).append(
                            (shot_id, phash or "", role)
                        )

                    # Collapse near-identical start/end onto mid within each sequence
                    for frames in seq_frames.values():
                        dups = mark_within_sequence_duplicates(
                            frames, threshold=settings.sequence_dedupe_threshold
                        )
                        if not dups:
                            continue
                        by_id = {s.id: s for s in pending_shots}
                        for dup_id, canon_id in dups.items():
                            shot = by_id.get(dup_id)
                            if shot and not shot.is_duplicate:
                                shot.is_duplicate = True
                                shot.duplicate_of = canon_id
                else:
                    shot_id = str(uuid4())
                    art_dir = shot_artifact_dir(settings, slug, shot_id)
                    keyframe = art_dir / "keyframe.jpg"
                    copy_image_as_keyframe(media_path, keyframe)
                    thumb_sm = art_dir / "thumb_sm.webp"
                    thumb_md = art_dir / "thumb_md.webp"
                    _, _, width, height = make_thumbnails(
                        keyframe, thumb_sm=thumb_sm, thumb_md=thumb_md
                    )
                    colors = analyze_colors(keyframe)
                    phash = perceptual_hash(keyframe)
                    is_dup = False
                    dup_of = None
                    hit = find_near_duplicate(
                        phash,
                        seen_hashes + file_hashes,
                        threshold=settings.dedupe_hamming_threshold,
                    )
                    if hit:
                        is_dup = True
                        dup_of = hit
                    elif phash:
                        file_hashes.append((phash, shot_id))
                    folder_techs = _techniques_from_path(media_path)
                    # EyeCandy: strip __ec{id} on the raw stem before humanizing
                    if folder_techs:
                        title = eyecandy_clean_title(media_path.name)
                    else:
                        title = source_title_from_path(media_path)
                    filmgrab = _filmgrab_meta_from_path(media_path)
                    shotdeck = _shotdeck_meta_from_path(media_path)
                    msdb = _moviestillsdb_meta_from_path(media_path)
                    stillslab = _stillslab_meta_from_path(media_path)

                    film_title: str | None = None
                    if filmgrab and filmgrab.get("title"):
                        film_title = str(filmgrab["title"]).strip()
                    elif shotdeck and shotdeck.get("movie_title"):
                        mt = str(shotdeck["movie_title"]).strip()
                        # Reject opaque shot-id masquerading as a title
                        if mt and not re.fullmatch(r"[A-Z0-9]{6,12}", mt):
                            film_title = mt
                    elif stillslab and stillslab.get("movie_title"):
                        film_title = str(stillslab["movie_title"]).strip()
                    elif msdb and msdb.get("title"):
                        film_title = str(msdb["title"]).strip()

                    if film_title:
                        title = film_title
                    is_gif = media_path.suffix.lower() == ".gif"
                    # Animated sources → copy as preview so grid hover can play the loop
                    preview_path = None
                    has_preview = False
                    if is_gif or media_path.suffix.lower() in {".webp"}:
                        # Prefer real GIF loops; animated WebP also works as <img>
                        try:
                            from PIL import Image as _PilImage

                            anim = is_gif
                            if not anim and media_path.suffix.lower() == ".webp":
                                with _PilImage.open(media_path) as im:
                                    anim = bool(getattr(im, "is_animated", False) and im.n_frames > 1)
                            if anim:
                                dest = art_dir / f"preview{media_path.suffix.lower()}"
                                if not dest.is_file() or dest.stat().st_size == 0:
                                    shutil.copy2(media_path, dest)
                                preview_path = to_relative(lib_base, dest)
                                has_preview = True
                        except Exception as exc:
                            logger.warning("GIF/WebP preview copy failed for %s: %s", media_path.name, exc)
                    tags: list[str] = []
                    if folder_techs:
                        tags.append("eyecandy")
                    if filmgrab:
                        tags.append("filmgrab")
                        ft = film_title or str(filmgrab.get("title") or "").strip()
                        if ft:
                            if ft not in tags:
                                tags.append(ft[:96])
                            slug = re.sub(r"[^a-z0-9]+", "-", ft.lower()).strip("-")
                            if slug and slug not in tags:
                                tags.append(slug[:96])
                        for t in filmgrab.get("tags") or []:
                            if isinstance(t, str) and t and t not in tags:
                                tags.append(t[:64])
                                if len(tags) >= 16:
                                    break
                    if shotdeck:
                        tags.append("shotdeck")
                        if film_title and film_title not in tags:
                            tags.append(film_title[:96])
                    if msdb:
                        tags.append("moviestillsdb")
                        if film_title and film_title not in tags:
                            tags.append(film_title[:96])
                    if stillslab:
                        tags.append("stillslab")
                        if film_title and film_title not in tags:
                            tags.append(film_title[:96])
                    meta = {
                        "filename": media_path.name,
                        "title": title,
                        "ext": media_path.suffix.lower(),
                        "techniques_seed": folder_techs,
                        "eyecandy": bool(folder_techs),
                        "filmgrab": bool(filmgrab),
                        "shotdeck": bool(shotdeck),
                        "moviestillsdb": bool(msdb),
                        "stillslab": bool(stillslab),
                    }
                    if filmgrab:
                        meta["film_title"] = filmgrab.get("title")
                        meta["film_slug"] = filmgrab.get("slug")
                        if filmgrab.get("year"):
                            meta["blog_year"] = filmgrab.get("year")
                            meta["film_year"] = filmgrab.get("year")  # legacy
                        meta["film_url"] = filmgrab.get("url")
                    if shotdeck:
                        if shotdeck.get("movie_title") and not re.fullmatch(
                            r"[A-Z0-9]{6,12}", str(shotdeck.get("movie_title"))
                        ):
                            meta["film_title"] = shotdeck.get("movie_title")
                        ct = shotdeck.get("content_type")
                        if ct:
                            meta["content_type"] = ct
                            if ct not in tags:
                                tags.append(str(ct)[:64])
                        meta["shot_id"] = shotdeck.get("shot_id")
                        meta["dimensions"] = shotdeck.get("dimensions")
                        meta["source_path"] = shotdeck.get("source_path")
                        meta["image_url"] = shotdeck.get("image_url")
                    if msdb:
                        meta["film_title"] = msdb.get("title")
                    if stillslab:
                        meta["film_title"] = stillslab.get("movie_title")

                    enrich_archive_meta(
                        meta,
                        filename=media_path.name,
                        film_title=film_title or meta.get("film_title"),
                    )
                    title = str(meta.get("display_title") or title)
                    meta["title"] = title

                    shot = Shot(
                        id=shot_id,
                        project_id=project_id,
                        collection_id=collection_id,
                        source_type="image",
                        source_path=str(media_path),
                        source_filename=media_path.name,
                        source_title=title,
                        source_meta_json=meta,
                        scene_index=0,
                        start_timecode_ms=None,
                        end_timecode_ms=None,
                        duration_ms=None,
                        keyframe_ms=None,
                        source_fps=None,
                        keyframe_path=to_relative(lib_base, keyframe),
                        thumb_sm_path=to_relative(lib_base, thumb_sm),
                        thumb_md_path=to_relative(lib_base, thumb_md),
                        preview_path=preview_path,
                        width=width,
                        height=height,
                        dominant_colors_json=colors,
                        has_preview=has_preview,
                        qdrant_point_id=shot_id,
                        tags_json=tags,
                        techniques_json=folder_techs,
                        shapes_json=[],
                        enrichment_version=0,
                        is_favorite=False,
                        sequence_id=shot_id,
                        frame_role="still",
                        hero_score=1.0,
                        is_hero=True,
                        is_moving=is_gif,
                        grade_reason=(
                            "eyecandy-gif"
                            if is_gif and folder_techs
                            else (
                                "filmgrab"
                                if filmgrab
                                else (
                                    "shotdeck"
                                    if shotdeck
                                    else (
                                        "stillslab"
                                        if stillslab
                                        else ("moviestillsdb" if msdb else "still")
                                    )
                                )
                            )
                        ),
                        phash=phash or None,
                        is_duplicate=is_dup,
                        duplicate_of=dup_of,
                    )
                    pending_shots.append(shot)
                    keyframe_paths.append(keyframe)

                if not pending_shots:
                    processed += 1
                    continue

                # CRITICAL: commit shots to SQLite BEFORE embedding so archive is never lost
                async with SessionLocal() as session:
                    session.add_all(pending_shots)
                    await session.flush()
                    if collection_id:
                        from cinearchive.db.models.collection import CollectionShot

                        existing = {
                            r.shot_id
                            for r in (
                                await session.execute(
                                    select(CollectionShot).where(
                                        CollectionShot.collection_id == collection_id
                                    )
                                )
                            ).scalars().all()
                        }
                        pos = len(existing)
                        for s in pending_shots:
                            created_shot_ids.append(s.id)
                            if s.id in existing:
                                continue
                            session.add(
                                CollectionShot(
                                    id=str(uuid4()),
                                    collection_id=collection_id,
                                    shot_id=s.id,
                                    position=pos,
                                )
                            )
                            pos += 1
                    else:
                        created_shot_ids.extend(s.id for s in pending_shots)
                    await session.commit()
                    for s in pending_shots:
                        await session.refresh(s)

                await update_job(job_id, current_step=f"Embedding {media_path.name}")
                vectors: list[list[float]]
                if embed_ok:
                    try:
                        vectors = embedder.embed_images(keyframe_paths)
                    except Exception as emb_exc:
                        logger.error("Embed failed for %s: %s", media_path.name, emb_exc)
                        vectors = _zero_vectors(len(pending_shots), settings.embedding_dim)
                        file_errors.append(f"{media_path.name}: embed failed")
                else:
                    vectors = _zero_vectors(len(pending_shots), settings.embedding_dim)

                payloads = [_build_payload(s, media_path.name) for s in pending_shots]
                try:
                    vector_repo.upsert_points(
                        ids=[s.id for s in pending_shots],
                        vectors=vectors,
                        payloads=payloads,
                    )
                except Exception as qd_exc:
                    logger.error("Qdrant upsert failed for %s: %s", media_path.name, qd_exc)
                    file_errors.append(f"{media_path.name}: vector upsert failed")

                processed += 1
                await update_job(
                    job_id,
                    processed_items=processed,
                    progress_pct=round(5 + (processed / max(len(files), 1)) * 90, 1),
                )

            except Exception as file_exc:
                logger.error(
                    "File %s failed: %s\n%s",
                    media_path.name,
                    file_exc,
                    traceback.format_exc(),
                )
                file_errors.append(f"{media_path.name}: {file_exc}")
                continue

        async with SessionLocal() as session:
            session.add(
                IngestBatch(
                    project_id=project_id,
                    job_id=job_id,
                    source_paths_json=source_paths,
                )
            )
            await session.commit()

        status = "completed"
        step = "Done"
        err_msg = None
        if file_errors and processed == 0:
            status = "failed"
            step = "All files failed"
            err_msg = "; ".join(file_errors)[:2000]
        elif file_errors:
            step = f"Done with {len(file_errors)} file warning(s)"
            err_msg = "; ".join(file_errors)[:2000]

        await update_job(
            job_id,
            status=status,
            current_step=step,
            progress_pct=100.0,
            processed_items=processed,
            error_message=err_msg,
        )
        logger.info(
            "Ingest job %s finished status=%s files=%d/%d",
            job_id,
            status,
            processed,
            len(files),
        )
        if processed > 0 and settings.dedupe_on_ingest and settings.dedupe_global:
            from cinearchive.jobs.dedupe_scheduler import schedule_global_dedupe

            schedule_global_dedupe(delay_sec=45.0)

    except Exception as exc:
        logger.error("Ingest job %s failed: %s\n%s", job_id, exc, traceback.format_exc())
        await update_job(
            job_id,
            status="failed",
            current_step="Failed",
            error_message=str(exc)[:2000],
            progress_pct=100.0,
        )
