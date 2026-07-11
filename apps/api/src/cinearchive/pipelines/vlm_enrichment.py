"""VLM enrichment via local Ollama — EyeCandy-rich cinematic shot DNA."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError

from cinearchive.config import Settings, get_settings
from cinearchive.pipelines.taxonomy import (
    CAMERA_ANGLES,
    CAMERA_MOVEMENTS,
    COLOR_GRADES,
    COMPOSITIONS,
    CONTENT_FORMATS,
    EMOTIONS,
    ERAS,
    GENRES,
    ISMS,
    LENS_LOOKS,
    LIGHTING_STYLES,
    ORIGINS,
    SHAPES,
    SHOT_TYPES,
    TECHNIQUES,
    THEMES,
    VISUAL_STYLES,
    normalize_composition,
    normalize_list,
    normalize_techniques,
)
from cinearchive.utils.logging import get_logger

logger = get_logger(__name__)

_SHOT = "|".join(SHOT_TYPES)
_MOVE = "|".join(CAMERA_MOVEMENTS)
_ANGLE = "|".join(CAMERA_ANGLES)
_LIGHT = "|".join(LIGHTING_STYLES)
_COMP = "|".join(COMPOSITIONS)
_LENS = "|".join(LENS_LOOKS)
_GRADE = "|".join(COLOR_GRADES)
_EMO = "|".join(EMOTIONS)
_FMT = "|".join(CONTENT_FORMATS)
_ERA = "|".join(ERAS)
_ORIGIN = "|".join(ORIGINS)
_ISM = "|".join(ISMS)
_STYLE = "|".join(VISUAL_STYLES)
_THEME = "|".join(THEMES)
_GENRE = "|".join(GENRES)
_SHAPE = "|".join(SHAPES)
# Keep prompt size sane — list core techniques + tell model more are allowed
_TECH_CORE = ", ".join(
    [
        "dolly",
        "dolly-zoom",
        "tracking",
        "whip-pan",
        "handheld",
        "aerial",
        "fpv-drone",
        "bullet-time",
        "slow-motion",
        "speed-ramp",
        "dutch-angle",
        "low-angle",
        "high-angle",
        "overhead",
        "worms-eye",
        "close-up",
        "wide-shot",
        "ultra-wide",
        "over-the-shoulder",
        "first-person",
        "object-pov",
        "shallow-focus",
        "fisheye",
        "probe",
        "tilt-shift",
        "silhouette",
        "hard-light",
        "haze",
        "halation",
        "reflections",
        "double-exposure",
        "match-cut",
        "crash-cut",
        "jump-cut",
        "freeze-frame",
        "parallax",
        "snorricam",
        "product",
        "tableau",
        "cinemagraph",
        "underwater",
        "vintage",
        "neon",
        "dreamcore",
        "voyeur",
    ]
)

SYSTEM_PROMPT = f"""You are a senior cinematography analyst for a private reference archive
inspired by EyeCandy / FilmGrab / Flim. Go deep: craft, composition, color, shape, era, style, theme.
Analyze the still and return ONLY valid JSON:

{{
  "shot_type": "{_SHOT}",
  "camera_movement": "{_MOVE}",
  "camera_angle": "{_ANGLE}",
  "lighting_style": "{_LIGHT}",
  "composition": "{_COMP}",
  "subject": "short phrase naming the primary subject",
  "lens_look": "{_LENS}",
  "color_grade": "{_GRADE}",
  "mood_vibe": "short cinematic mood phrase (3-6 words)",
  "emotion": "{_EMO}",
  "content_format": "{_FMT}",
  "era": "{_ERA}",
  "origin": "{_ORIGIN}",
  "ism": "{_ISM}",
  "visual_style": "{_STYLE}",
  "theme": "{_THEME}",
  "genre": "{_GENRE}",
  "shapes": ["1-4 geometric / graphic shape links visible in frame"],
  "techniques": ["2-6 EyeCandy-style technique slugs visible in this frame"],
  "creative_intent": "2-3 sentences: craft choices, storytelling, why reference-worthy",
  "tags": ["12-20 lowercase freeform tags: subject, location, color notes, props, wardrobe, texture, brand-feel"]
}}

COMPOSITION (pick the strongest primary spatial design — one slug):
- Grids/ratios: rule-of-thirds, golden-ratio, golden-spiral, golden-triangle, centered, central-framing, off-center, symmetry, asymmetry
- Letter/curve: s-curve (S-comp), l-composition, c-composition, z-composition, x-composition, triangular, pyramid, circular, radial
- Perspective/depth: one-point-perspective, two-point-perspective, three-point-perspective, vanishing-point, converging-lines, leading-lines, parallel-lines, diagonal, deep-space, flat-space, layered, overlapping, foreground-interest
- Framing: frame-within-frame, tunnel, corridor, negative-space, fill-the-frame, isolation, open-frame, closed-frame
- Balance/density: balanced, unbalanced, minimal, crowded, pattern, repetition, breaking-pattern
- Placement: looking-room, lead-room, headroom, short-side, horizon-low, horizon-high, horizon-center
- Graphic: juxtaposition, silhouette, reflection, mirror, split-screen, screen-in-screen, match-cut
Full allowed set: {_COMP}.

TECHNIQUES (prefer these slugs; multi-label OK): {_TECH_CORE}, …
Also valid: {", ".join(TECHNIQUES[:40])} … (full EyeCandy-like set).
SHAPES for visual rhyming: {_SHAPE}.
ISMS (aesthetic school / movement): realism, formalism, surrealism, expressionism, italian-neorealism, french-new-wave, dogme-95, noir, neo-noir, slow-cinema, …
ORIGINS (national/regional cinema when clear): hollywood, french, japanese, korean, …
ERAS include decades + silent-era, golden-age, new-hollywood, y2k, period-piece.

Rules:
- composition = how the frame is designed spatially (not camera move, not lighting). Prefer specific slugs (s-curve, golden-ratio, one-point-perspective) over vague "other".
- techniques = craft labels. theme/era/style/genre/ism/origin = cultural & aesthetic axes. shapes = geometry for linking.
- ism = film movement or aesthetic school. origin = cinema culture when readable.
- tags = descriptive freeform (colors, objects, places). Be specific and multi-label.
- Prefer concrete slugs over "other". Multiple techniques/shapes when earned.
- If start/mid/end of a moving sequence, describe what is unique about THIS moment.
"""

FEW_SHOT_EXAMPLES = [
    {
        "shot_type": "close-up",
        "camera_movement": "static",
        "camera_angle": "eye-level",
        "lighting_style": "low-key",
        "composition": "negative-space",
        "subject": "actor face in shadow",
        "lens_look": "shallow-dof",
        "color_grade": "desaturated",
        "mood_vibe": "tense intimate noir",
        "emotion": "tense",
        "content_format": "film",
        "techniques": ["close-up", "shallow-focus", "silhouette", "hard-light"],
        "creative_intent": "Hard side light isolates the face; negative space and deep shadows create psychological pressure.",
        "tags": [
            "portrait",
            "noir",
            "side-light",
            "chiaroscuro",
            "tension",
            "face",
            "drama",
            "shadow",
        ],
    },
    {
        "shot_type": "wide",
        "camera_movement": "tracking",
        "camera_angle": "low-angle",
        "lighting_style": "neon",
        "composition": "one-point-perspective",
        "subject": "figure walking wet city street",
        "lens_look": "anamorphic",
        "color_grade": "neon",
        "mood_vibe": "cyberpunk rain night",
        "emotion": "lonely",
        "content_format": "ad",
        "techniques": ["tracking", "low-angle", "wide-shot", "reflections", "haze"],
        "creative_intent": "One-point perspective down the wet street; cyan/magenta neon reflections sell futuristic urban loneliness.",
        "tags": [
            "night",
            "urban",
            "rain",
            "neon",
            "city",
            "loneliness",
            "anamorphic",
            "commercial",
            "perspective",
        ],
    },
    {
        "shot_type": "medium",
        "camera_movement": "dolly-in",
        "camera_angle": "eye-level",
        "lighting_style": "golden-hour",
        "composition": "golden-ratio",
        "subject": "couple in pastoral field",
        "lens_look": "anamorphic",
        "color_grade": "warm",
        "mood_vibe": "warm nostalgic pastoral",
        "emotion": "nostalgic",
        "content_format": "commercial",
        "techniques": ["dolly", "two-shot", "shallow-focus", "haze"],
        "creative_intent": "Subjects sit on a golden-ratio intersection; slow dolly and golden backlight read as memory and intimacy.",
        "tags": [
            "romance",
            "golden-hour",
            "backlight",
            "field",
            "couple",
            "warm",
            "anamorphic",
            "lifestyle",
        ],
    },
    {
        "shot_type": "wide",
        "camera_movement": "static",
        "camera_angle": "high-angle",
        "lighting_style": "natural",
        "composition": "s-curve",
        "subject": "winding mountain road through mist",
        "lens_look": "wide-angle",
        "color_grade": "desaturated",
        "mood_vibe": "quiet epic landscape",
        "emotion": "serene",
        "content_format": "film",
        "techniques": ["wide-shot", "aerial", "haze"],
        "shapes": ["curve", "triangle"],
        "creative_intent": "S-curve road pulls the eye through layered mist; classic landscape composition for scale and journey.",
        "tags": ["landscape", "road", "mist", "mountains", "journey", "epic", "nature"],
    },
    {
        "shot_type": "extreme-close-up",
        "camera_movement": "static",
        "camera_angle": "overhead",
        "lighting_style": "hard-light",
        "composition": "centered",
        "subject": "luxury watch on black velvet",
        "lens_look": "macro",
        "color_grade": "high-contrast",
        "mood_vibe": "precise luxury product",
        "emotion": "cold",
        "content_format": "ad",
        "techniques": ["product", "magnification", "overhead", "hard-light", "central-framing"],
        "era": "2020s",
        "visual_style": "commercial-gloss",
        "theme": "luxury",
        "genre": "advertising",
        "shapes": ["circle", "rectangle"],
        "creative_intent": "Macro overhead isolates craftsmanship; specular highlights sell material quality.",
        "tags": ["product", "watch", "luxury", "macro", "specular", "black", "commercial", "detail"],
    },
]


class EnrichmentResult(BaseModel):
    shot_type: str = Field(default="other", max_length=64)
    camera_movement: str = Field(default="static", max_length=64)
    camera_angle: str = Field(default="eye-level", max_length=64)
    lighting_style: str = Field(default="other", max_length=64)
    composition: str = Field(default="other", max_length=128)
    subject: str = Field(default="", max_length=255)
    lens_look: str = Field(default="other", max_length=64)
    color_grade: str = Field(default="other", max_length=64)
    mood_vibe: str = Field(default="", max_length=128)
    emotion: str = Field(default="other", max_length=64)
    content_format: str = Field(default="other", max_length=64)
    era: str = Field(default="other", max_length=64)
    origin: str = Field(default="other", max_length=64)
    ism: str = Field(default="other", max_length=64)
    visual_style: str = Field(default="other", max_length=64)
    theme: str = Field(default="other", max_length=64)
    genre: str = Field(default="other", max_length=64)
    shapes: list[str] = Field(default_factory=list)
    creative_intent: str = Field(default="", max_length=2000)
    techniques: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)

    def normalized(self) -> EnrichmentResult:
        tags = []
        for t in self.tags[:24]:
            clean = re.sub(r"[^a-z0-9\- ]", "", t.lower().strip())
            if clean and clean not in tags:
                tags.append(clean)
        techniques = normalize_techniques(self.techniques, limit=8)
        if not techniques:
            techniques = normalize_techniques(tags, limit=6)
        shapes = normalize_list(self.shapes, SHAPES, limit=4)
        return EnrichmentResult(
            shot_type=(self.shot_type or "other").lower().strip()[:64],
            camera_movement=(self.camera_movement or "static").lower().strip()[:64],
            camera_angle=(self.camera_angle or "eye-level").lower().strip()[:64],
            lighting_style=(self.lighting_style or "other").lower().strip()[:64],
            composition=normalize_composition(self.composition),
            subject=(self.subject or "").strip()[:255],
            lens_look=(self.lens_look or "other").lower().strip()[:64],
            color_grade=(self.color_grade or "other").lower().strip()[:64],
            mood_vibe=(self.mood_vibe or "").strip()[:128],
            emotion=(self.emotion or "other").lower().strip()[:64],
            content_format=(self.content_format or "other").lower().strip()[:64],
            era=(self.era or "other").lower().strip()[:64],
            origin=(self.origin or "other").lower().strip()[:64],
            ism=(self.ism or "other").lower().strip()[:64],
            visual_style=(self.visual_style or "other").lower().strip()[:64],
            theme=(self.theme or "other").lower().strip()[:64],
            genre=(self.genre or "other").lower().strip()[:64],
            shapes=shapes,
            creative_intent=(self.creative_intent or "").strip()[:2000],
            techniques=techniques,
            tags=tags,
        )


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            return json.loads(match.group(0))
        raise


def _clean_title(filename: str) -> str:
    stem = Path(filename).stem
    stem = re.sub(r"^[0-9a-f]{6,10}_", "", stem, flags=re.I)
    stem = re.sub(r"[_\-]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem[:200] or filename


class VLMEnricher:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        model: str | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        from cinearchive.services import vlm_config as vc

        self.model = model or vc.effective_model(self.settings)
        self._provider = vc.effective_provider(self.settings)

    async def health(self) -> bool:
        from cinearchive.services import vlm_config as vc

        if not vc.effective_enabled(self.settings):
            return False
        if self._provider == "openai_compatible":
            return await self._health_openai()
        return await self._health_ollama()

    async def _health_ollama(self) -> bool:
        from cinearchive.services import vlm_config as vc

        url = vc.effective_ollama_url(self.settings)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{url}/api/tags")
                return r.status_code == 200
        except Exception:
            return False

    async def _health_openai(self) -> bool:
        from cinearchive.services import vlm_config as vc

        cfg = vc.effective_openai(self.settings)
        base = cfg["base_url"]
        if not base:
            return False
        headers: dict[str, str] = {}
        if cfg["api_key"]:
            headers["Authorization"] = f"Bearer {cfg['api_key']}"
        if cfg.get("site_url"):
            headers["HTTP-Referer"] = str(cfg["site_url"])
        if cfg.get("app_name"):
            headers["X-Title"] = str(cfg["app_name"])
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{base}/models", headers=headers)
                return r.status_code in (200, 401, 403)
        except Exception:
            return False

    async def enrich_image(
        self,
        image_path: Path,
        *,
        context: dict[str, Any] | None = None,
        model: str | None = None,
    ) -> EnrichmentResult:
        last_err: Exception | None = None
        use_model = model or self.model
        for attempt in range(self.settings.vlm_max_retries + 1):
            try:
                if self._provider == "openai_compatible":
                    return await self._call_openai(
                        image_path, context=context or {}, model=use_model
                    )
                return await self._call_ollama(
                    image_path, context=context or {}, model=use_model
                )
            except Exception as exc:
                last_err = exc
                logger.warning("VLM attempt %d failed: %s", attempt + 1, exc)
        logger.error("VLM enrichment failed after retries: %s", last_err)
        return EnrichmentResult(
            creative_intent="Enrichment unavailable — caption fallback.",
            tags=["unenriched"],
        ).normalized()

    def _build_user_prompt(self, context: dict[str, Any]) -> str:
        examples = "\n".join(json.dumps(ex) for ex in FEW_SHOT_EXAMPLES)
        ctx_bits = []
        if context.get("source_title"):
            ctx_bits.append(f"Source title: {context['source_title']}")
        if context.get("source_filename"):
            ctx_bits.append(f"Filename: {context['source_filename']}")
        if context.get("frame_role"):
            ctx_bits.append(
                f"Sequence role: {context['frame_role']} "
                "(describe what is unique about this moment in the shot)"
            )
        if context.get("is_moving"):
            ctx_bits.append(
                "This frame is part of a moving camera sequence — include movement techniques."
            )
        if context.get("content_hint"):
            ctx_bits.append(f"Likely format hint: {context['content_hint']}")
        if context.get("project_name"):
            ctx_bits.append(f"Project: {context['project_name']}")
        if context.get("project_feeling"):
            ctx_bits.append(f"Desired feeling: {context['project_feeling']}")
        if context.get("project_brief"):
            brief = str(context["project_brief"])[:600]
            ctx_bits.append(f"Project brief: {brief}")
        if context.get("project_references"):
            refs = str(context["project_references"])[:400]
            ctx_bits.append(f"Visual references: {refs}")
        ctx_block = ("\n".join(ctx_bits) + "\n\n") if ctx_bits else ""
        return (
            f"{ctx_block}Examples of good outputs:\n{examples}\n\n"
            "Now analyze this frame and return JSON only. Fill techniques richly."
        )

    def _parse_result(self, raw: str) -> EnrichmentResult:
        parsed = _extract_json(raw)
        try:
            return EnrichmentResult.model_validate(parsed).normalized()
        except ValidationError as exc:
            logger.warning("VLM JSON validation soft-fail: %s", exc)
            return EnrichmentResult(
                shot_type=str(parsed.get("shot_type") or "other"),
                camera_movement=str(parsed.get("camera_movement") or "static"),
                camera_angle=str(parsed.get("camera_angle") or "eye-level"),
                lighting_style=str(parsed.get("lighting_style") or "other"),
                composition=str(parsed.get("composition") or "other"),
                subject=str(parsed.get("subject") or ""),
                lens_look=str(parsed.get("lens_look") or "other"),
                color_grade=str(parsed.get("color_grade") or "other"),
                mood_vibe=str(parsed.get("mood_vibe") or ""),
                emotion=str(parsed.get("emotion") or "other"),
                content_format=str(parsed.get("content_format") or "other"),
                era=str(parsed.get("era") or "other"),
                visual_style=str(parsed.get("visual_style") or "other"),
                theme=str(parsed.get("theme") or "other"),
                genre=str(parsed.get("genre") or "other"),
                shapes=list(parsed.get("shapes") or []),
                creative_intent=str(parsed.get("creative_intent") or raw[:500]),
                techniques=list(parsed.get("techniques") or []),
                tags=list(parsed.get("tags") or [])[:20],
            ).normalized()

    async def _call_ollama(
        self,
        image_path: Path,
        *,
        context: dict[str, Any],
        model: str | None = None,
    ) -> EnrichmentResult:
        from cinearchive.services import vlm_config as vc

        b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        user_prompt = self._build_user_prompt(context)
        payload = {
            "model": model or self.model,
            "prompt": user_prompt,
            "system": SYSTEM_PROMPT,
            "images": [b64],
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.25},
        }
        url = vc.effective_ollama_url(self.settings)
        timeout = vc.effective_timeout(self.settings)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{url}/api/generate", json=payload)
            r.raise_for_status()
            data = r.json()
        raw = data.get("response") or data.get("message", {}).get("content") or ""
        return self._parse_result(raw)

    async def _call_openai(
        self,
        image_path: Path,
        *,
        context: dict[str, Any],
        model: str | None = None,
    ) -> EnrichmentResult:
        """OpenAI-compatible chat/completions with vision (OpenRouter, Kimi, LM Studio…)."""
        from cinearchive.services import vlm_config as vc

        cfg = vc.effective_openai(self.settings)
        base = cfg["base_url"]
        if not base:
            raise RuntimeError("openai_base_url is not set")
        use_model = (model or cfg["model"] or self.model or "").strip()
        if not use_model:
            raise RuntimeError("openai_model is not set")

        mime = "image/jpeg"
        suffix = image_path.suffix.lower()
        if suffix == ".png":
            mime = "image/png"
        elif suffix == ".webp":
            mime = "image/webp"
        b64 = base64.b64encode(image_path.read_bytes()).decode("ascii")
        data_url = f"data:{mime};base64,{b64}"
        user_prompt = self._build_user_prompt(context)

        headers: dict[str, str] = {"Content-Type": "application/json"}
        if cfg["api_key"]:
            headers["Authorization"] = f"Bearer {cfg['api_key']}"
        if cfg.get("site_url"):
            headers["HTTP-Referer"] = str(cfg["site_url"])
        if cfg.get("app_name"):
            headers["X-Title"] = str(cfg["app_name"])

        payload: dict[str, Any] = {
            "model": use_model,
            "temperature": 0.25,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT + "\nReturn JSON only."},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                },
            ],
        }
        payload_with_json = {**payload, "response_format": {"type": "json_object"}}

        timeout = vc.effective_timeout(self.settings)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                f"{base}/chat/completions", headers=headers, json=payload_with_json
            )
            if r.status_code >= 400:
                r = await client.post(
                    f"{base}/chat/completions", headers=headers, json=payload
                )
            r.raise_for_status()
            data = r.json()

        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message") or {}
        raw = msg.get("content") or ""
        if isinstance(raw, list):
            raw = " ".join(
                str(part.get("text") or "") for part in raw if isinstance(part, dict)
            )
        return self._parse_result(str(raw))


def source_title_from_path(path: str | Path) -> str:
    return _clean_title(Path(path).name)
