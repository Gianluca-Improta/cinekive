"""Lightweight text chat against the configured local / Pro VLM provider."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

# Prefer small text models for chat; fall back to the configured VLM name.
_CHAT_MODEL_PREFS = (
    "gemma3:4b",
    "gemma3:1b",
    "gemma3",
    "gemma2:2b",
    "gemma2:9b",
    "llama3.2:3b",
    "llama3.2:1b",
    "llama3.2",
    "qwen2.5:3b",
    "qwen2.5:7b",
    "qwen2.5",
    "phi4-mini",
    "phi3:mini",
)


def load_craft_system_prompt() -> str:
    path = Path(__file__).resolve().parent.parent / "prompts" / "craft_chat.md"
    try:
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    except OSError:
        pass
    return (
        "You are Gemi Local AI in Cinekive, a local cinematic stills archive. "
        "Be concise. Never invent shot counts — use the provided library context."
    )


def _ollama_url_candidates(settings: Settings) -> list[str]:
    from cinearchive.services import vlm_config as vc

    primary = (vc.effective_ollama_url(settings) or "").rstrip("/")
    extras = [
        "http://127.0.0.1:11434",
        "http://localhost:11434",
        "http://host.docker.internal:11434",
    ]
    out: list[str] = []
    for u in [primary, *extras]:
        if u and u not in out:
            out.append(u)
    return out


async def _list_ollama_models(url: str) -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"{url}/api/tags")
            r.raise_for_status()
            data = r.json()
        names = []
        for m in data.get("models") or []:
            name = (m.get("name") or m.get("model") or "").strip()
            if name:
                names.append(name)
        return names
    except Exception:
        return []


def _pick_chat_model(installed: list[str], configured: str) -> str:
    lower = {n.lower(): n for n in installed}
    for pref in _CHAT_MODEL_PREFS:
        if pref.lower() in lower:
            return lower[pref.lower()]
        # prefix match e.g. gemma3:4b-instruct-q4_K_M
        for key, original in lower.items():
            if key.startswith(pref.lower()):
                return original
    if configured:
        # Prefer non-VL if something smaller is installed with same family
        cfg = configured.lower()
        for key, original in lower.items():
            if "vl" in key or "vision" in key:
                continue
            if cfg.split(":")[0] and key.startswith(cfg.split(":")[0]):
                return original
        return configured
    return installed[0] if installed else configured


async def complete_text(
    settings: Settings,
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float = 0.4,
    max_tokens: int = 900,
) -> str | None:
    """Return model text or None if the provider is unreachable."""
    from cinearchive.services import vlm_config as vc

    provider = vc.effective_provider(settings)
    try:
        if provider == "openai_compatible":
            return await _openai_chat(
                settings,
                system=system,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return await _ollama_chat(
            settings,
            system=system,
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_text failed: %s", exc)
        return None


async def _ollama_chat(
    settings: Settings,
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> str | None:
    from cinearchive.services import vlm_config as vc

    configured = vc.effective_model(settings)
    # Probe URLs quickly; only call /api/chat when tags succeed
    live_urls: list[tuple[str, list[str]]] = []
    for url in _ollama_url_candidates(settings):
        installed = await _list_ollama_models(url)
        if installed:
            live_urls.append((url, installed))
    if not live_urls:
        return None

    for url, installed in live_urls:
        model = _pick_chat_model(installed, configured)
        if not model:
            continue
        payload: dict[str, Any] = {
            "model": model,
            "stream": False,
            "options": {"temperature": temperature, "num_predict": max_tokens},
            "messages": [{"role": "system", "content": system}, *messages],
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                r = await client.post(f"{url}/api/chat", json=payload)
                if r.status_code >= 400:
                    logger.info("ollama chat %s %s → %s", url, model, r.status_code)
                    continue
                data = r.json()
            msg = data.get("message") or {}
            text = (msg.get("content") or data.get("response") or "").strip()
            if text:
                logger.info("craft chat via ollama %s model=%s", url, model)
                return text
        except Exception as exc:  # noqa: BLE001
            logger.info("ollama chat miss %s: %s", url, exc)
            continue
    return None


async def _openai_chat(
    settings: Settings,
    *,
    system: str,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
) -> str | None:
    from cinearchive.services import vlm_config as vc

    cfg = vc.effective_openai(settings)
    base = (cfg.get("base_url") or "").rstrip("/")
    model = (cfg.get("model") or "").strip()
    key = (cfg.get("api_key") or "").strip()
    if not base or not model:
        return None
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    payload = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        r = await client.post(f"{base}/chat/completions", headers=headers, json=payload)
        r.raise_for_status()
        data = r.json()
    choices = data.get("choices") or []
    if not choices:
        return None
    content = ((choices[0].get("message") or {}).get("content") or "").strip()
    return content or None
