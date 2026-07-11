"""Runtime VLM / enrichment config — overrides env without container restart.

Persisted at {models_dir}/vlm_runtime.json so Settings → UI can change
provider, base URL, API key, and model while the API stays up.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from cinearchive.config import Settings
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

VlmProvider = Literal["ollama", "openai_compatible"]


class VlmRuntimeConfig(BaseModel):
    """Live overrides for craft-tag enrichment."""

    enabled: bool | None = None
    provider: VlmProvider = "ollama"
    # Ollama
    ollama_url: str | None = None
    ollama_model: str | None = None
    # OpenAI-compatible (OpenRouter, Kimi/Moonshot, LM Studio, vLLM, OpenClaw gateways…)
    openai_base_url: str | None = None
    openai_api_key: str | None = None
    openai_model: str | None = None
    # Optional OpenRouter extras
    openai_site_url: str | None = None
    openai_app_name: str | None = "Cinekive"
    # Enrich behaviour
    enrich_tier: Literal["auto", "fast", "balanced", "quality"] | None = None
    enrich_continuous: bool | None = None
    enrich_interval_sec: float | None = None
    enrich_batch_size: int | None = None
    vlm_timeout_sec: float | None = None


_PRESETS: dict[str, dict[str, Any]] = {
    "ollama": {
        "label": "Ollama (local)",
        "provider": "ollama",
        "ollama_url": "http://host.docker.internal:11434",
        "hint": "Local vision models — qwen3-vl, qwen2.5vl, gemma3…",
    },
    "openrouter": {
        "label": "OpenRouter",
        "provider": "openai_compatible",
        "openai_base_url": "https://openrouter.ai/api/v1",
        "openai_model": "google/gemini-2.5-flash",
        "hint": "Any OpenRouter vision model — paste API key",
    },
    "kimi": {
        "label": "Kimi / Moonshot",
        "provider": "openai_compatible",
        "openai_base_url": "https://api.moonshot.cn/v1",
        "openai_model": "moonshot-v1-8k-vision-preview",
        "hint": "Moonshot vision — use your Kimi API key",
    },
    "openai": {
        "label": "OpenAI",
        "provider": "openai_compatible",
        "openai_base_url": "https://api.openai.com/v1",
        "openai_model": "gpt-4o-mini",
        "hint": "Official OpenAI vision models",
    },
    "custom": {
        "label": "Custom OpenAI-compatible",
        "provider": "openai_compatible",
        "openai_base_url": "http://host.docker.internal:1234/v1",
        "openai_model": "",
        "hint": "LM Studio, vLLM, OpenClaw, any /v1/chat/completions endpoint",
    },
}


def runtime_path(settings: Settings) -> Path:
    base = Path(settings.models_dir or "/data/models")
    base.mkdir(parents=True, exist_ok=True)
    return base / "vlm_runtime.json"


def load_runtime(settings: Settings) -> VlmRuntimeConfig:
    path = runtime_path(settings)
    if not path.is_file():
        return VlmRuntimeConfig()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return VlmRuntimeConfig.model_validate(data)
    except Exception as e:
        logger.warning("Failed to read VLM runtime config: %s", e)
        return VlmRuntimeConfig()


def save_runtime(settings: Settings, cfg: VlmRuntimeConfig) -> VlmRuntimeConfig:
    path = runtime_path(settings)
    path.write_text(cfg.model_dump_json(indent=2), encoding="utf-8")
    logger.info("Saved VLM runtime config → %s", path)
    return cfg


def merge_runtime(settings: Settings, patch: dict[str, Any]) -> VlmRuntimeConfig:
    current = load_runtime(settings)
    data = current.model_dump()
    for k, v in patch.items():
        if k in data:
            data[k] = v
    cfg = VlmRuntimeConfig.model_validate(data)
    return save_runtime(settings, cfg)


def effective_provider(settings: Settings) -> VlmProvider:
    rt = load_runtime(settings)
    return rt.provider or "ollama"


def effective_enabled(settings: Settings) -> bool:
    rt = load_runtime(settings)
    if rt.enabled is not None:
        return bool(rt.enabled)
    return bool(settings.vlm_enabled)


def effective_model(settings: Settings) -> str:
    rt = load_runtime(settings)
    if rt.provider == "openai_compatible":
        return (rt.openai_model or settings.ollama_model or "").strip()
    return (rt.ollama_model or settings.ollama_model or "").strip()


def effective_ollama_url(settings: Settings) -> str:
    rt = load_runtime(settings)
    return (rt.ollama_url or settings.ollama_url or "").rstrip("/")


def effective_openai(settings: Settings) -> dict[str, str | None]:
    rt = load_runtime(settings)
    return {
        "base_url": (rt.openai_base_url or "").rstrip("/"),
        "api_key": rt.openai_api_key or "",
        "model": rt.openai_model or "",
        "site_url": rt.openai_site_url,
        "app_name": rt.openai_app_name or "Cinekive",
    }


def effective_continuous(settings: Settings) -> bool:
    rt = load_runtime(settings)
    if rt.enrich_continuous is not None:
        return bool(rt.enrich_continuous) and effective_enabled(settings)
    return bool(settings.enrich_continuous) and effective_enabled(settings)


def effective_tier(settings: Settings) -> str:
    rt = load_runtime(settings)
    return rt.enrich_tier or settings.enrich_tier


def effective_timeout(settings: Settings) -> float:
    rt = load_runtime(settings)
    if rt.vlm_timeout_sec is not None:
        return float(rt.vlm_timeout_sec)
    return float(settings.vlm_timeout_sec)


def presets_payload() -> list[dict[str, Any]]:
    return [{"id": k, **v} for k, v in _PRESETS.items()]


def public_config(settings: Settings) -> dict[str, Any]:
    """Safe for UI — masks API key."""
    rt = load_runtime(settings)
    key = rt.openai_api_key or ""
    masked = ("••••" + key[-4:]) if len(key) > 4 else ("••••" if key else "")
    return {
        "enabled": effective_enabled(settings),
        "provider": rt.provider,
        "ollama_url": effective_ollama_url(settings),
        "ollama_model": rt.ollama_model or settings.ollama_model,
        "openai_base_url": rt.openai_base_url or "",
        "openai_api_key_set": bool(key),
        "openai_api_key_masked": masked,
        "openai_model": rt.openai_model or "",
        "openai_site_url": rt.openai_site_url,
        "openai_app_name": rt.openai_app_name or "Cinekive",
        "enrich_tier": effective_tier(settings),
        "enrich_continuous": effective_continuous(settings),
        "enrich_interval_sec": rt.enrich_interval_sec
        if rt.enrich_interval_sec is not None
        else settings.enrich_interval_sec,
        "enrich_batch_size": rt.enrich_batch_size
        if rt.enrich_batch_size is not None
        else settings.enrich_batch_size,
        "vlm_timeout_sec": effective_timeout(settings),
        "env_defaults": {
            "vlm_enabled": settings.vlm_enabled,
            "ollama_url": settings.ollama_url,
            "ollama_model": settings.ollama_model,
            "enrich_continuous": settings.enrich_continuous,
        },
        "presets": presets_payload(),
        "active_model": effective_model(settings),
    }


class VlmConfigUpdate(BaseModel):
    enabled: bool | None = None
    provider: VlmProvider | None = None
    ollama_url: str | None = None
    ollama_model: str | None = None
    openai_base_url: str | None = None
    openai_api_key: str | None = Field(default=None, description="Omit to keep; empty string clears")
    openai_model: str | None = None
    openai_site_url: str | None = None
    openai_app_name: str | None = None
    enrich_tier: Literal["auto", "fast", "balanced", "quality"] | None = None
    enrich_continuous: bool | None = None
    enrich_interval_sec: float | None = None
    enrich_batch_size: int | None = None
    vlm_timeout_sec: float | None = None
    preset: str | None = None
