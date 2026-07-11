"""Background folder watcher for auto-ingest."""

from __future__ import annotations

import asyncio
from pathlib import Path

from cinearchive.config import Settings, get_settings
from cinearchive.db.models.job import Job
from cinearchive.db.session import SessionLocal
from cinearchive.jobs.runner import VIDEO_EXTS, IMAGE_EXTS, run_ingest_job
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.utils.logging import get_logger
from uuid import uuid4

logger = get_logger(__name__)


class FolderWatcher:
    """Polls project watch folders and queues ingest for new files."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._seen: dict[str, set[str]] = {}
        self._task: asyncio.Task | None = None
        self._running = False

    @property
    def running(self) -> bool:
        return self._running

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Folder watcher started (poll=%.1fs)", self.settings.watcher_poll_sec)

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Folder watcher stopped")

    async def status(self) -> dict:
        async with SessionLocal() as session:
            repo = ProjectRepository(session)
            projects = await repo.list()
            watched = [
                {
                    "project_id": p.id,
                    "name": p.name,
                    "watch_folder": p.watch_folder,
                    "watch_enabled": p.watch_enabled,
                    "seen_files": len(self._seen.get(p.id, set())),
                }
                for p in projects
                if p.watch_enabled and p.watch_folder
            ]
        return {"enabled": self._running, "projects": watched}

    async def _loop(self) -> None:
        while self._running:
            try:
                await self._tick()
            except Exception as exc:
                logger.warning("Watcher tick error: %s", exc)
            await asyncio.sleep(self.settings.watcher_poll_sec)

    async def _tick(self) -> None:
        async with SessionLocal() as session:
            repo = ProjectRepository(session)
            projects = [p for p in await repo.list() if p.watch_enabled and p.watch_folder]

        for project in projects:
            folder = Path(project.watch_folder or "")
            if not folder.is_dir():
                continue
            seen = self._seen.setdefault(project.id, set())
            new_videos: list[str] = []
            new_images: list[str] = []
            for path in folder.rglob("*"):
                if not path.is_file():
                    continue
                key = str(path.resolve())
                if key in seen:
                    continue
                # Skip incomplete writes (size changing) — simple mtime age check
                try:
                    age = path.stat().st_mtime
                    import time

                    if time.time() - age < 2.0:
                        continue
                except OSError:
                    continue
                seen.add(key)
                ext = path.suffix.lower()
                if ext in VIDEO_EXTS:
                    new_videos.append(key)
                elif ext in IMAGE_EXTS:
                    new_images.append(key)

            if new_videos:
                await self._enqueue(project.id, new_videos, "video", project.sampling_mode, project.generate_previews)
            if new_images:
                await self._enqueue(project.id, new_images, "images", project.sampling_mode, False)

    async def _enqueue(
        self,
        project_id: str,
        paths: list[str],
        mode: str,
        sampling_mode: str,
        generate_previews: bool,
    ) -> None:
        job_id = str(uuid4())
        job_type = "ingest_video" if mode == "video" else "ingest_images"
        async with SessionLocal() as session:
            session.add(
                Job(
                    id=job_id,
                    project_id=project_id,
                    type=job_type,
                    status="pending",
                    progress_pct=0.0,
                    current_step="queued by watcher",
                    total_items=0,
                    processed_items=0,
                    payload_json={"paths": paths, "mode": mode, "source": "watcher"},
                )
            )
            await session.commit()

        logger.info("Watcher queued %s job %s (%d files) for project %s", mode, job_id, len(paths), project_id)
        asyncio.create_task(
            run_ingest_job(
                job_id,
                project_id,
                paths,
                mode=mode,
                recursive=False,
                sampling_mode=sampling_mode,
                generate_previews=generate_previews,
                settings=self.settings,
            )
        )


_watcher: FolderWatcher | None = None


def get_watcher(settings: Settings | None = None) -> FolderWatcher:
    global _watcher
    if _watcher is None:
        _watcher = FolderWatcher(settings)
    return _watcher
