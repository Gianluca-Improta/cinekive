"""GPU-aware VLM model tiers for shot enrichment.

Sweet spots (vision models via Ollama):
  - 8–12 GB VRAM  → fast / balanced on 7–8B VL
  - 16 GB (5060 Ti) → balanced = qwen3-vl:8b (best speed/quality)
  - 24 GB+        → quality can use 32B VL if installed

Text-only models (qwen3.5, gpt-oss) are NOT used for frame tagging.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

EnrichTier = Literal["auto", "fast", "balanced", "quality"]


@dataclass(frozen=True)
class VlmTier:
    key: str
    label: str
    model: str
    min_vram_gb: float
    blurb: str


# Preferred Ollama vision tags (first match that is installed wins within a tier)
TIER_CANDIDATES: dict[str, list[VlmTier]] = {
    "fast": [
        VlmTier("fast", "Fast", "qwen2.5vl:3b", 4, "Quick pass — good for bulk catch-up"),
        VlmTier("fast", "Fast", "gemma3:4b", 5, "Small multimodal — bulk tagging"),
        VlmTier("fast", "Fast", "gemma3:latest", 5, "Small multimodal — bulk tagging"),
        VlmTier("fast", "Fast", "qwen2.5vl:7b", 8, "Solid 7B vision"),
        VlmTier("fast", "Fast", "qwen3-vl:8b", 8, "Falls back to 8B if nothing smaller"),
    ],
    "balanced": [
        VlmTier("balanced", "Balanced", "qwen3-vl:8b", 10, "Sweet spot on 16GB cards"),
        VlmTier("balanced", "Balanced", "qwen3-vl:latest", 10, "Sweet spot on 16GB cards"),
        VlmTier("balanced", "Balanced", "my-qwen3-vl:latest", 10, "Local custom 8B VL"),
        VlmTier("balanced", "Balanced", "qwen2.5vl:7b", 8, "Reliable 7B vision"),
    ],
    "quality": [
        VlmTier("quality", "Quality", "qwen3-vl:32b", 22, "Best craft tags — needs ~24GB"),
        VlmTier("quality", "Quality", "qwen2.5vl:32b", 22, "Best craft tags — needs ~24GB"),
        VlmTier("quality", "Quality", "qwen3-vl:8b", 10, "Best available on 16GB (8B)"),
        VlmTier("quality", "Quality", "qwen3-vl:latest", 10, "Best available on 16GB (8B)"),
        VlmTier("quality", "Quality", "my-qwen3-vl:latest", 10, "Local custom 8B VL"),
    ],
}


def detect_vram_gb() -> float | None:
    """Best-effort VRAM detection (host nvidia-smi). Returns None if unknown."""
    import shutil
    import subprocess

    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.check_output(
            [
                "nvidia-smi",
                "--query-gpu=memory.total",
                "--format=csv,noheader,nounits",
            ],
            text=True,
            timeout=5,
            stderr=subprocess.DEVNULL,
        )
        # Multi-GPU: take the max
        vals = [float(x.strip()) for x in out.splitlines() if x.strip()]
        if not vals:
            return None
        # nvidia-smi reports MiB
        return max(vals) / 1024.0
    except Exception:
        return None


def auto_tier_for_vram(vram_gb: float | None) -> EnrichTier:
    if vram_gb is None:
        return "balanced"
    if vram_gb >= 22:
        return "quality"
    if vram_gb >= 10:
        return "balanced"
    return "fast"


async def list_ollama_models(ollama_url: str) -> set[str]:
    import httpx

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(f"{ollama_url.rstrip('/')}/api/tags")
            r.raise_for_status()
            data = r.json()
            names: set[str] = set()
            for m in data.get("models") or []:
                name = m.get("name") or m.get("model")
                if name:
                    names.add(str(name))
                    # also bare tag without :latest
                    if ":" in name:
                        names.add(name.split(":", 1)[0])
            return names
    except Exception as e:
        logger.warning("Could not list Ollama models: %s", e)
        return set()


def _model_installed(model: str, installed: set[str]) -> bool:
    if model in installed:
        return True
    base, _, tag = model.partition(":")
    if not tag or tag == "latest":
        return base in installed or f"{base}:latest" in installed
    # Require exact tag (qwen3-vl:8b ≠ qwen3-vl:32b)
    return f"{base}:{tag}" in installed


def pick_model(
    *,
    tier: EnrichTier,
    installed: set[str],
    vram_gb: float | None,
    configured_default: str,
) -> tuple[str, VlmTier | None]:
    """Return (model_name, tier_info). Falls back to configured_default."""
    resolved: EnrichTier = auto_tier_for_vram(vram_gb) if tier == "auto" else tier
    candidates = TIER_CANDIDATES.get(resolved) or TIER_CANDIDATES["balanced"]

    for cand in candidates:
        # Skip 32B-class models that won't fit on 16GB
        if vram_gb is not None and cand.min_vram_gb >= 20 and vram_gb < 20:
            continue
        if installed and not _model_installed(cand.model, installed):
            continue
        return cand.model, cand

    if not installed or _model_installed(configured_default, installed):
        return configured_default, None
    for name in sorted(installed):
        low = name.lower()
        if "vl" in low or "vision" in low or low.startswith("gemma3"):
            return name, None
    return configured_default, None


def tiers_payload(
    *,
    installed: set[str],
    vram_gb: float | None,
    active_tier: EnrichTier,
    active_model: str,
) -> dict:
    recommended = auto_tier_for_vram(vram_gb)
    tiers = []
    for key in ("fast", "balanced", "quality"):
        model, info = pick_model(
            tier=key,  # type: ignore[arg-type]
            installed=installed,
            vram_gb=vram_gb,
            configured_default=active_model,
        )
        available = _model_installed(model, installed) if installed else True
        fits = True
        if info and vram_gb is not None and info.min_vram_gb >= 20 and vram_gb < 20:
            fits = False
            # Still show the fallback model that actually fits
            available = _model_installed(model, installed)
        tiers.append(
            {
                "key": key,
                "label": info.label if info else key.title(),
                "model": model,
                "blurb": info.blurb if info else "",
                "min_vram_gb": info.min_vram_gb if info else None,
                "available": available,
                "fits_vram": fits,
                "recommended": key == recommended,
            }
        )
    return {
        "vram_gb": round(vram_gb, 1) if vram_gb is not None else None,
        "gpu_hint": "RTX 5060 Ti 16GB → balanced (qwen3-vl:8b) is the sweet spot"
        if vram_gb and 14 <= vram_gb <= 18
        else (
            "Set ENRICH_VRAM_GB=16 if API runs in Docker without nvidia-smi"
            if vram_gb is None
            else None
        ),
        "active_tier": active_tier,
        "active_model": active_model,
        "recommended_tier": recommended,
        "installed_models": sorted(installed),
        "tiers": tiers,
    }
