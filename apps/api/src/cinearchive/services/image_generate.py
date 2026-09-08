"""Pro cloud + free local image generation from a reference still.

Local (Free): Automatic1111 / Forge / SD.Next sdapi, or ComfyUI.
Cloud (Pro): OpenAI-compatible /images APIs with BYO key.
"""

from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from cinearchive.config import Settings
from cinearchive.db.models.shot import Shot
from cinearchive.repositories.project_repo import ProjectRepository
from cinearchive.schemas.ingest import IngestResponse
from cinearchive.services.artifact_service import resolve_artifact
from cinearchive.services.entitlements import has_feature, require_feature
from cinearchive.services.ingest_service import IngestService
from cinearchive.services.vlm_config import (
    effective_openai,
    effective_provider,
    is_local_openai_url,
    load_runtime,
)
from cinearchive.utils.logging import get_logger
from cinearchive.utils.paths import ensure_dir, project_library_dir

logger = get_logger(__name__)


def _craft_prompt(shot: Shot, user_prompt: str | None) -> str:
    bits: list[str] = []
    for label, val in (
        ("shot", shot.shot_type),
        ("angle", shot.camera_angle),
        ("lighting", shot.lighting_style),
        ("mood", shot.mood_vibe),
        ("lens", shot.lens_look),
        ("composition", shot.composition),
        ("subject", shot.subject),
        ("era", shot.era),
        ("style", shot.visual_style),
    ):
        if val:
            bits.append(f"{label}: {val}")
    tags: list[str] = []
    raw = shot.tags_json
    if isinstance(raw, list):
        tags = [str(t) for t in raw[:12]]
    elif isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                tags = [str(t) for t in parsed[:12]]
        except Exception:
            pass
    if tags:
        bits.append("tags: " + ", ".join(tags))
    craft = "; ".join(bits) if bits else "cinematic film still"
    base = (
        "Cinematic still photograph inspired by a reference frame. "
        f"Match craft cues ({craft}). Photoreal film look, not illustration. "
        "Do not add watermarks or UI chrome."
    )
    extra = (user_prompt or "").strip()
    return f"{base} Direction: {extra}" if extra else base


def _image_backend(settings: Settings) -> str:
    """auto | cloud | a1111 | comfyui"""
    rt = load_runtime(settings)
    raw = (getattr(rt, "image_backend", None) or "auto").strip().lower()
    if raw in {"cloud", "a1111", "comfyui", "auto"}:
        return raw
    return "auto"


def _image_local_url(settings: Settings) -> str:
    rt = load_runtime(settings)
    return (getattr(rt, "image_local_url", None) or "http://127.0.0.1:7860").rstrip("/")


def _image_cloud_cfg(settings: Settings) -> dict[str, str]:
    """Prefer dedicated image_* keys; fall back to craft OpenAI-compatible credentials."""
    rt = load_runtime(settings)
    openai = effective_openai(settings)
    return {
        "base_url": (
            (getattr(rt, "image_api_base_url", None) or "").strip()
            or (openai.get("base_url") or "https://api.openai.com/v1")
        ).rstrip("/"),
        "api_key": (
            (getattr(rt, "image_api_key", None) or "").strip()
            or (openai.get("api_key") or "")
        ).strip(),
        "model": (
            (getattr(rt, "image_model", None) or "").strip()
            or (openai.get("model") or "dall-e-3")
        ).strip(),
        "site_url": (rt.openai_site_url or openai.get("site_url") or "") or "",
        "app_name": (rt.openai_app_name or openai.get("app_name") or "Cinekive") or "Cinekive",
    }


async def _call_a1111(
    *,
    base_url: str,
    prompt: str,
    reference_bytes: bytes | None,
    strength: float = 0.55,
    size: int = 1024,
    checkpoint: str | None = None,
) -> bytes:
    root = base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=300.0) as client:
        if checkpoint:
            try:
                await client.post(
                    f"{root}/sdapi/v1/options",
                    json={"sd_model_checkpoint": checkpoint},
                )
            except Exception:
                logger.debug("could not set a1111 checkpoint %s", checkpoint)
        if reference_bytes:
            payload = {
                "init_images": [base64.b64encode(reference_bytes).decode("ascii")],
                "prompt": prompt,
                "negative_prompt": "watermark, text, UI, logo, cartoon, illustration",
                "steps": 28,
                "width": size,
                "height": size,
                "denoising_strength": strength,
                "cfg_scale": 5.5,
            }
            r = await client.post(f"{root}/sdapi/v1/img2img", json=payload)
        else:
            payload = {
                "prompt": prompt,
                "negative_prompt": "watermark, text, UI, logo, cartoon, illustration",
                "steps": 28,
                "width": size,
                "height": size,
                "cfg_scale": 5.5,
            }
            r = await client.post(f"{root}/sdapi/v1/txt2img", json=payload)
        if r.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Local SD/Forge/A1111 generation failed. Is the WebUI running with "
                    f"--api? Provider said: {r.text[:500]}"
                ),
            )
        body = r.json()
        images = body.get("images") or []
        if not images:
            raise HTTPException(status_code=502, detail="Local SD API returned no images")
        return base64.b64decode(images[0].split(",", 1)[-1])


_FAMILY_CHECKPOINTS = {
    "sd": "v1-5-pruned-emaonly.safetensors",
    "flux1": "flux1-dev-fp8.safetensors",
    "qwen-image": "qwen-image",
}


def _resolve_family(family: str | None, model: str | None) -> str:
    raw = (family or model or "auto").strip().lower()
    if raw in {"auto", "sd", "flux1", "qwen-image", "qwen"}:
        return "qwen-image" if raw == "qwen" else raw
    if "flux" in raw:
        return "flux1"
    if "qwen" in raw:
        return "qwen-image"
    if raw.startswith("sd") or "stable" in raw:
        return "sd"
    return "auto"


async def _call_comfyui(
    *,
    base_url: str,
    prompt: str,
    reference_bytes: bytes | None,
    strength: float = 1.0,
    size: int = 1024,
    checkpoint: str | None = None,
) -> bytes:
    """Minimal ComfyUI path via /prompt + history polling (CheckpointLoaderSimple workflow)."""
    root = base_url.rstrip("/")
    client_id = uuid4().hex
    ckpt = checkpoint or "flux1-dev-fp8.safetensors"
    denoise = 1.0 if reference_bytes is None else max(0.05, min(1.0, strength))
    # Compact txt2img graph — user can replace checkpoint name in Settings later.
    workflow: dict[str, Any] = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": int(time.time()) % 2_147_483_647,
                "steps": 20,
                "cfg": 5.5,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": denoise,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": ckpt},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": size, "height": size, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": prompt, "clip": ["4", 1]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": "watermark, text, UI, logo, cartoon",
                "clip": ["4", 1],
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "cinekive", "images": ["8", 0]},
        },
    }
    _ = reference_bytes
    async with httpx.AsyncClient(timeout=300.0) as client:
        r = await client.post(
            f"{root}/prompt",
            json={"prompt": workflow, "client_id": client_id},
        )
        if r.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=(
                    "ComfyUI rejected the job. Load a Flux/SD checkpoint named in the "
                    f"default workflow or switch Image backend to A1111/Forge. {r.text[:400]}"
                ),
            )
        prompt_id = (r.json() or {}).get("prompt_id")
        if not prompt_id:
            raise HTTPException(status_code=502, detail="ComfyUI returned no prompt_id")

        for _ in range(120):
            await _sleep(1.0)
            hist = await client.get(f"{root}/history/{prompt_id}")
            if hist.status_code >= 400:
                continue
            entry = (hist.json() or {}).get(prompt_id) or {}
            outputs = entry.get("outputs") or {}
            for node in outputs.values():
                images = node.get("images") or []
                if not images:
                    continue
                img = images[0]
                fname = img.get("filename")
                sub = img.get("subfolder") or ""
                itype = img.get("type") or "output"
                if not fname:
                    continue
                params = {"filename": fname, "subfolder": sub, "type": itype}
                img_r = await client.get(f"{root}/view", params=params)
                if img_r.status_code < 400 and img_r.content:
                    return img_r.content
        raise HTTPException(status_code=504, detail="ComfyUI timed out waiting for image")


async def _sleep(sec: float) -> None:
    import asyncio

    await asyncio.sleep(sec)


async def _call_images_api(
    *,
    base_url: str,
    api_key: str,
    prompt: str,
    model: str,
    reference_bytes: bytes | None,
    reference_name: str,
    site_url: str | None,
    app_name: str | None,
) -> bytes:
    root = base_url.rstrip("/")
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
    }
    if site_url:
        headers["HTTP-Referer"] = site_url
    if app_name:
        headers["X-Title"] = app_name

    async with httpx.AsyncClient(timeout=180.0) as client:
        if reference_bytes and "openai.com" in root:
            files = {
                "image": (reference_name, reference_bytes, "image/jpeg"),
            }
            data = {
                "prompt": prompt,
                "model": model or "gpt-image-1",
                "n": "1",
                "size": "1024x1024",
            }
            r = await client.post(f"{root}/images/edits", headers=headers, data=data, files=files)
            if r.status_code >= 400:
                logger.warning("image edits failed (%s): %s", r.status_code, r.text[:400])
            else:
                return _extract_image_bytes(r.json())

        payload: dict[str, Any] = {
            "model": model or "dall-e-3",
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
            "response_format": "b64_json",
        }
        r = await client.post(f"{root}/images/generations", headers=headers, json=payload)
        if r.status_code >= 400:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Image generation failed. Use a Pro cloud key (OpenAI or OpenRouter) that "
                    f"supports /images/generations. Provider said: {r.text[:500]}"
                ),
            )
        return _extract_image_bytes(r.json())


def _extract_image_bytes(body: dict[str, Any]) -> bytes:
    data = body.get("data") or []
    if not data:
        raise HTTPException(status_code=502, detail="Image API returned no data")
    item = data[0] or {}
    b64 = item.get("b64_json")
    if b64:
        return base64.b64decode(b64)
    url = item.get("url")
    if url:
        import urllib.request

        with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310
            return resp.read()
    raise HTTPException(status_code=502, detail="Image API response missing b64_json/url")


async def _probe_a1111(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(f"{url.rstrip('/')}/sdapi/v1/sd-models")
            return r.status_code < 500
    except Exception:
        return False


async def _probe_comfy(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(f"{url.rstrip('/')}/system_stats")
            return r.status_code < 500
    except Exception:
        return False


async def generate_from_shot(
    session: AsyncSession,
    settings: Settings,
    shot_id: UUID,
    *,
    prompt: str | None,
    model: str | None,
    background: BackgroundTasks,
    backend: str | None = None,
    strength: float | None = None,
    size: int | None = None,
    family: str | None = None,
) -> IngestResponse:
    shot = await session.get(Shot, str(shot_id))
    if not shot or getattr(shot, "deleted_at", None):
        raise HTTPException(status_code=404, detail="Shot not found")

    projects = ProjectRepository(session)
    project = await projects.get(UUID(shot.project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    keyframe = resolve_artifact(settings, shot.keyframe_path)
    ref_bytes: bytes | None = None
    if keyframe and keyframe.is_file():
        ref_bytes = keyframe.read_bytes()

    craft_prompt = _craft_prompt(shot, prompt)
    configured = _image_backend(settings)
    backend_pref = (backend or configured or "auto").strip().lower()
    if backend_pref not in {"auto", "a1111", "comfyui", "cloud"}:
        backend_pref = "auto"
    local_url = _image_local_url(settings)
    used_backend = backend_pref
    fam = _resolve_family(family, model)
    denoise = float(strength) if strength is not None else 0.55
    denoise = max(0.05, min(1.0, denoise))
    edge = int(size) if size in {1024, 1280, 1536} else 1024
    gen_model = (model or "").strip()
    ckpt = None
    if fam in _FAMILY_CHECKPOINTS and fam != "auto":
        ckpt = _FAMILY_CHECKPOINTS[fam]
        gen_model = gen_model or fam

    # Family hints which local backend to try first when Auto.
    prefer_comfy = fam in {"flux1", "qwen-image"}
    prefer_a1111 = fam == "sd"

    image_bytes: bytes | None = None
    try:
        if backend_pref == "cloud":
            pass
        elif backend_pref == "a1111" or (backend_pref == "auto" and prefer_a1111):
            a1111_url = local_url if "7860" in local_url or backend_pref == "a1111" else "http://127.0.0.1:7860"
            if backend_pref == "a1111" or await _probe_a1111(a1111_url):
                image_bytes = await _call_a1111(
                    base_url=a1111_url,
                    prompt=craft_prompt,
                    reference_bytes=ref_bytes,
                    strength=denoise,
                    size=edge,
                    checkpoint=ckpt if fam == "sd" else None,
                )
                used_backend = "a1111"
                gen_model = gen_model or "local-a1111"

        if image_bytes is None and backend_pref in {"auto", "comfyui"}:
            comfy_url = local_url if "8188" in local_url or backend_pref == "comfyui" else "http://127.0.0.1:8188"
            if backend_pref == "comfyui" or prefer_comfy or await _probe_comfy(comfy_url):
                if backend_pref == "comfyui" or await _probe_comfy(comfy_url):
                    image_bytes = await _call_comfyui(
                        base_url=comfy_url,
                        prompt=craft_prompt,
                        reference_bytes=ref_bytes,
                        strength=denoise,
                        size=edge,
                        checkpoint=ckpt if fam in {"flux1", "qwen-image"} else None,
                    )
                    used_backend = "comfyui"
                    gen_model = gen_model or "local-comfyui"

        if image_bytes is None and backend_pref == "auto" and not prefer_a1111:
            a1111_url = "http://127.0.0.1:7860"
            if await _probe_a1111(a1111_url):
                image_bytes = await _call_a1111(
                    base_url=a1111_url,
                    prompt=craft_prompt,
                    reference_bytes=ref_bytes,
                    strength=denoise,
                    size=edge,
                    checkpoint=ckpt if fam == "sd" else None,
                )
                used_backend = "a1111"
                gen_model = gen_model or "local-a1111"

        if image_bytes is None:
            # Cloud path — Pro + API key
            require_feature("image_generate", settings)
            cloud = _image_cloud_cfg(settings)
            api_key = cloud["api_key"]
            base_url = cloud["base_url"]
            if not api_key:
                provider = effective_provider(settings)
                openai = effective_openai(settings)
                if provider == "openai_compatible" and (openai.get("api_key") or "").strip():
                    api_key = str(openai.get("api_key") or "").strip()
                    base_url = str(openai.get("base_url") or base_url).rstrip("/")
            if not api_key:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "No local image backend found (start Forge/A1111 with --api on :7860 "
                        "or ComfyUI on :8188), or set a Pro cloud image API key in Settings."
                    ),
                )
            if not is_local_openai_url(base_url) and not has_feature("image_generate", settings):
                require_feature("image_generate", settings)
            if fam == "qwen-image":
                gen_model = gen_model or "qwen/qwen-image"
            elif fam == "flux1":
                gen_model = gen_model or "black-forest-labs/flux-1-dev"
            elif fam == "sd":
                gen_model = gen_model or "stabilityai/stable-diffusion-xl-base-1.0"
            else:
                gen_model = (
                    gen_model
                    or cloud["model"]
                    or ("dall-e-3" if "openai.com" in base_url else "openai/dall-e-3")
                )
            if any(x in gen_model.lower() for x in ("gpt-4", "claude", "gemini", "sonnet")):
                gen_model = "dall-e-3" if "openai.com" in base_url else "openai/dall-e-3"
            image_bytes = await _call_images_api(
                base_url=base_url,
                api_key=api_key,
                prompt=craft_prompt,
                model=gen_model,
                reference_bytes=ref_bytes,
                reference_name="reference.jpg",
                site_url=cloud.get("site_url") or None,
                app_name=cloud.get("app_name") or None,
            )
            used_backend = "cloud"
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("generate_from_shot failed")
        raise HTTPException(status_code=502, detail=f"Image generation error: {exc}") from exc

    assert image_bytes is not None
    suffix = ".png" if image_bytes[:8].startswith(b"\x89PNG") else ".jpg"
    lib = project_library_dir(settings, project.slug)
    out_dir = ensure_dir(lib / "generated")
    out_name = f"{uuid4().hex}{suffix}"
    out_path = out_dir / out_name
    out_path.write_bytes(image_bytes)

    meta_path = out_dir / f"{out_path.stem}.cinekive.json"
    meta_path.write_text(
        json.dumps(
            {
                "origin": "generated",
                "parent_shot_id": str(shot_id),
                "prompt": craft_prompt,
                "model": gen_model,
                "family": fam,
                "backend": used_backend,
                "strength": denoise,
                "size": edge,
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    ingest = IngestService(session, settings)
    return await ingest.ingest_images_paths(
        UUID(shot.project_id),
        [str(out_path)],
        recursive=False,
        background=background,
    )
