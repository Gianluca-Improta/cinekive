"""Language / translation module — English core, pluggable backends.

Order of backends:
1. LibreTranslate (self-hosted or public) when configured / reachable
2. MyMemory free API as a soft fallback (network; not for offline)
3. Identity (return source) so the UI never hard-fails

UI strings are handled client-side via locale packs + an optional DOM
overlay (UiTranslateLayer). This module translates freeform content and
batched UI chrome strings for that overlay.
"""

from __future__ import annotations

import hashlib
import time
from typing import Any

import httpx

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

# In-process cache: hash(text|src|tgt) -> (translated, ts)
_CACHE: dict[str, tuple[str, float]] = {}
_CACHE_TTL_SEC = 7 * 24 * 3600
_CACHE_MAX = 4000

# UI / content language codes we expose
SUPPORTED = {
    "en": "English",
    "zh": "Chinese",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "ja": "Japanese",
    "pt": "Portuguese",
    "ko": "Korean",
    "it": "Italian",
    "ru": "Russian",
}

# LibreTranslate / MyMemory code aliases
_LT_CODES = {
    "zh": "zh",
    "en": "en",
    "es": "es",
    "fr": "fr",
    "de": "de",
    "ja": "ja",
    "pt": "pt",
    "ko": "ko",
    "it": "it",
    "ru": "ru",
}


def _cache_key(text: str, source: str, target: str) -> str:
    raw = f"{source}|{target}|{text}".encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _cache_get(key: str) -> str | None:
    hit = _CACHE.get(key)
    if not hit:
        return None
    text, ts = hit
    if time.time() - ts > _CACHE_TTL_SEC:
        _CACHE.pop(key, None)
        return None
    return text


def _cache_set(key: str, text: str) -> None:
    if len(_CACHE) >= _CACHE_MAX:
        # Drop oldest ~10%
        oldest = sorted(_CACHE.items(), key=lambda kv: kv[1][1])[: _CACHE_MAX // 10]
        for k, _ in oldest:
            _CACHE.pop(k, None)
    _CACHE[key] = (text, time.time())


async def _libretranslate(
    text: str,
    *,
    source: str,
    target: str,
    settings: Settings,
) -> str | None:
    base = (settings.libretranslate_url or "").rstrip("/")
    if not base:
        return None
    payload: dict[str, Any] = {
        "q": text,
        "source": source if source != "auto" else "auto",
        "target": target,
        "format": "text",
    }
    if settings.libretranslate_api_key:
        payload["api_key"] = settings.libretranslate_api_key
    try:
        async with httpx.AsyncClient(timeout=settings.translate_timeout_sec) as client:
            r = await client.post(f"{base}/translate", json=payload)
            if r.status_code >= 400:
                logger.warning("LibreTranslate %s: %s", r.status_code, r.text[:200])
                return None
            data = r.json()
            out = data.get("translatedText") or data.get("translated_text")
            return str(out).strip() if out else None
    except Exception as e:
        logger.warning("LibreTranslate failed: %s", e)
        return None


async def _mymemory(text: str, *, source: str, target: str) -> str | None:
    """Public free endpoint — rate-limited; used only as soft fallback."""
    if len(text) > 450:
        text = text[:450]
    langpair = f"{source}|{target}"
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get(
                "https://api.mymemory.translated.net/get",
                params={"q": text, "langpair": langpair},
            )
            if r.status_code >= 400:
                return None
            data = r.json()
            out = (data.get("responseData") or {}).get("translatedText")
            if not out:
                return None
            # MyMemory sometimes echoes "INVALID SOURCE LANGUAGE ..." etc.
            if "MYMEMORY WARNING" in str(out).upper():
                return None
            return str(out).strip()
    except Exception as e:
        logger.warning("MyMemory failed: %s", e)
        return None


async def translate_text(
    text: str,
    *,
    target_lang: str,
    source_lang: str = "en",
    settings: Settings,
) -> dict[str, Any]:
    text = (text or "").strip()
    target = (target_lang or "en").lower().split("-")[0]
    source = (source_lang or "en").lower().split("-")[0]
    if source == "auto":
        source = "en"

    if not text:
        return {
            "translated_text": "",
            "source_lang": source,
            "target_lang": target,
            "provider": "none",
        }

    if target == source:
        return {
            "translated_text": text,
            "source_lang": source,
            "target_lang": target,
            "provider": "identity",
        }

    src = _LT_CODES.get(source, source)
    tgt = _LT_CODES.get(target, target)
    key = _cache_key(text, src, tgt)
    cached = _cache_get(key)
    if cached is not None:
        return {
            "translated_text": cached,
            "source_lang": source,
            "target_lang": target,
            "provider": "cache",
        }

    provider = "identity"
    out = text

    lt = await _libretranslate(text, source=src, target=tgt, settings=settings)
    if lt:
        out, provider = lt, "libretranslate"
    elif settings.translate_allow_public_fallback:
        mm = await _mymemory(text, source=src, target=tgt)
        if mm:
            out, provider = mm, "mymemory"

    if provider != "identity":
        _cache_set(key, out)

    return {
        "translated_text": out,
        "source_lang": source,
        "target_lang": target,
        "provider": provider,
    }


def languages_payload() -> dict[str, Any]:
    return {
        "core": "en",
        "languages": [{"code": c, "name": n} for c, n in SUPPORTED.items()],
        "note": "UI packs + optional DOM overlay; /translate and /translate/batch handle freeform + chrome.",
    }
