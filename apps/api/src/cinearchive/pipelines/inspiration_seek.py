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


class BraveSearchProvider:
    """Brave Search API — image results for reference gathering (Pro)."""

    name = "brave"

    def __init__(self, api_key: str, *, count: int = 12) -> None:
        self.api_key = api_key.strip()
        self.count = max(1, min(count, 20))

    async def search(self, query: str, *, limit: int = 12) -> list[SeekCandidate]:
        if not self.api_key:
            return []
        q = query.strip()
        if not q or q.startswith(("http://", "https://")):
            return []
        n = min(limit, self.count)
        url = "https://api.search.brave.com/res/v1/images/search"
        headers = {
            "Accept": "application/json",
            "X-Subscription-Token": self.api_key,
        }
        params = {"q": q, "count": n, "safesearch": "strict"}
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()
        out: list[SeekCandidate] = []
        for item in data.get("results") or []:
            if not isinstance(item, dict):
                continue
            src = str(item.get("url") or item.get("properties", {}).get("url") or "").strip()
            if not src:
                continue
            thumb = item.get("thumbnail")
            thumb_url = None
            if isinstance(thumb, dict):
                thumb_url = str(thumb.get("src") or "") or None
            elif isinstance(thumb, str):
                thumb_url = thumb
            title = str(item.get("title") or Path(urlparse(src).path).name or "brave result")
            out.append(
                SeekCandidate(
                    title=title[:180],
                    source=self.name,
                    url=src,
                    thumb_url=thumb_url,
                    tags=["external", "brave", "web"],
                    license_note="Web image via Brave Search — verify rights before commercial use.",
                )
            )
        return out[:limit]


def _safe_filename(name: str) -> str:
    clean = re.sub(r"[^\w.\-]+", "_", name).strip("._")
    return (clean or "seek_asset")[:180]


class InspirationSeek:
    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self.providers: list[SeekProvider] = [UrlDownloadProvider()]
        brave_key = (getattr(self.settings, "brave_search_api_key", None) or "").strip()
        if brave_key:
            self.providers.append(
                BraveSearchProvider(
                    brave_key,
                    count=int(getattr(self.settings, "brave_search_count", 12) or 12),
                )
            )
        self.providers.append(StubCatalogProvider())

    @property
    def enabled(self) -> bool:
        # Auto-enable when a Brave key is present so Pro search works without an extra flag.
        if (getattr(self.settings, "brave_search_api_key", None) or "").strip():
            return True
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
