"""Inspiration Seek — opt-in external reference download into the local archive.

Disabled by default (`SEEK_ENABLED=false`). When enabled, agents / UI can request
external stills or clips from configured providers and land them in
`data/library/_seek/` (or a project inbox) for normal ingest.

Providers are pluggable stubs — wire real FilmGrab / Hive / EyeCandy / ad-lib
APIs behind the same interface without changing the core local loop.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import urlparse

import httpx

from cinearchive.config import Settings, get_settings
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import ensure_dir

logger = get_logger(__name__)


@dataclass
class SeekCandidate:
    title: str
    source: str  # provider name
    url: str
    thumb_url: str | None = None
    tags: list[str] | None = None
    license_note: str | None = None


class SeekProvider(Protocol):
    name: str

    async def search(self, query: str, *, limit: int = 12) -> list[SeekCandidate]: ...


class UrlDownloadProvider:
    """Minimal provider: treat the query as a direct image/video URL to fetch."""

    name = "url"

    async def search(self, query: str, *, limit: int = 12) -> list[SeekCandidate]:
        q = query.strip()
        if not q.startswith(("http://", "https://")):
            return []
        return [
            SeekCandidate(
                title=Path(urlparse(q).path).name or "download",
                source=self.name,
                url=q,
                tags=["external", "url"],
                license_note="User-supplied URL — verify rights before commercial use.",
            )
        ]


class StubCatalogProvider:
    """Placeholder catalog for UI wiring until real APIs are connected."""

    name = "stub"

    async def search(self, query: str, *, limit: int = 12) -> list[SeekCandidate]:
        # No network — returns empty so Seek never invents fake assets.
        logger.info("Stub seek provider queried for %r (no results until API keys wired)", query)
        return []


def _safe_filename(name: str) -> str:
    clean = re.sub(r"[^\w.\-]+", "_", name).strip("._")
    return (clean or "seek_asset")[:180]


class InspirationSeek:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.providers: list[SeekProvider] = [UrlDownloadProvider(), StubCatalogProvider()]

    @property
    def enabled(self) -> bool:
        return bool(self.settings.seek_enabled)

    def download_dir(self, project_slug: str | None = None) -> Path:
        base = Path(self.settings.seek_download_dir)
        if project_slug:
            return ensure_dir(base / project_slug)
        return ensure_dir(base)

    async def search(self, query: str, *, limit: int = 12) -> list[SeekCandidate]:
        if not self.enabled:
            raise RuntimeError("Inspiration Seek is disabled. Set SEEK_ENABLED=true to opt in.")
        results: list[SeekCandidate] = []
        for provider in self.providers:
            try:
                batch = await provider.search(query, limit=limit)
                results.extend(batch)
            except Exception as exc:
                logger.warning("Seek provider %s failed: %s", getattr(provider, "name", "?"), exc)
            if len(results) >= limit:
                break
        return results[:limit]

    async def download(
        self,
        candidate: SeekCandidate,
        *,
        project_slug: str | None = None,
        require_enabled: bool = True,
    ) -> Path:
        if require_enabled and not self.enabled:
            raise RuntimeError("Inspiration Seek is disabled. Set SEEK_ENABLED=true to opt in.")
        dest_dir = self.download_dir(project_slug)
        from cinearchive.pipelines.media_download import download_stream, is_stream_url

        if is_stream_url(candidate.url):
            path = download_stream(candidate.url, dest_dir, title_hint=candidate.title)
            logger.info("Seek stream downloaded %s → %s", candidate.url, path)
            return path

        name = _safe_filename(candidate.title)
        # Preserve extension from URL when possible
        suffix = Path(urlparse(candidate.url).path).suffix.lower()
        if suffix not in {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".gif"}:
            suffix = ".jpg"
        dest = dest_dir / f"{name}{suffix}"
        if dest.exists():
            dest = dest_dir / f"{name}_{abs(hash(candidate.url)) % 10_000}{suffix}"

        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(candidate.url)
            r.raise_for_status()
            dest.write_bytes(r.content)

        logger.info("Seek downloaded %s → %s", candidate.url, dest)
        return dest
