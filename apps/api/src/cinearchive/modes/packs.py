"""Adaptive mode packs — terminology, facets, suggestions. One system, four modes.

Cinekive (cinematic) is the default. The design modes come from the Design
Kive archive work and share the same core schema: differences live in
terminology, facets and sources, never in separate models.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from cinearchive.modes.models import ModeId


class ModePack(BaseModel):
    id: ModeId
    label: str
    short_label: str
    reference_noun: str  # singular
    reference_noun_plural: str
    creator_noun: str
    creator_noun_plural: str
    hero_line: str
    search_placeholder: str
    suggestions: list[str] = Field(default_factory=list)
    facets: list[str] = Field(default_factory=list)
    category_labels: dict[str, str] = Field(default_factory=dict)
    default_sources: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)


MODE_PACKS: dict[ModeId, ModePack] = {
    ModeId.CINEMATIC: ModePack(
        id=ModeId.CINEMATIC,
        label="Cinematic",
        short_label="Cinema",
        reference_noun="shot",
        reference_noun_plural="shots",
        creator_noun="cinematographer",
        creator_noun_plural="cinematographers",
        hero_line="Stills, clips, and frames — searchable by craft, colour, and light.",
        search_placeholder="Search shots, lighting setups, lenses, grades…",
        suggestions=[
            "golden hour backlight",
            "hard key light",
            "35mm anamorphic",
            "rain on glass",
            "practical neon",
            "high contrast noir",
            "soft diffusion",
        ],
        facets=["craft", "lighting", "palette", "tags", "categories", "creators"],
        category_labels={
            "exterior": "Exterior",
            "interior": "Interior",
            "detail": "Detail",
            "portrait": "Portrait",
            "landscape": "Landscape",
            "night": "Night",
        },
        default_sources=[],
        interests=[
            "lighting",
            "colour grade",
            "lens choice",
            "composition",
            "set design",
            "costume",
        ],
    ),
    ModeId.ARCHITECTURE: ModePack(
        id=ModeId.ARCHITECTURE,
        label="Architecture + Interior",
        short_label="Architecture",
        reference_noun="space",
        reference_noun_plural="spaces",
        creator_noun="architect",
        creator_noun_plural="architects",
        hero_line="Spaces, structures, and interiors — archived with provenance.",
        search_placeholder="Search façades, interiors, plans, materials…",
        suggestions=[
            "brutalist concrete",
            "Japanese tea house",
            "Art Deco lobby",
            "courtyard garden",
            "mid-century living room",
            "vaulted nave",
        ],
        facets=["materials", "styles", "periods", "place", "creators", "categories"],
        category_labels={
            "exterior": "Exterior",
            "interior": "Interior",
            "detail": "Detail",
            "plan": "Plan / Drawing",
            "landscape": "Landscape",
        },
        default_sources=["loc", "smithsonian"],
        interests=[
            "residential",
            "civic",
            "sacred",
            "adaptive reuse",
            "lighting",
            "furniture in situ",
        ],
    ),
    ModeId.FASHION: ModePack(
        id=ModeId.FASHION,
        label="Fashion",
        short_label="Fashion",
        reference_noun="look",
        reference_noun_plural="looks",
        creator_noun="designer",
        creator_noun_plural="designers",
        hero_line="Garments, textiles, and looks — from museum collections.",
        search_placeholder="Search silhouettes, textiles, designers, eras…",
        suggestions=[
            "silk evening gown",
            "tailored menswear",
            "kimono textile",
            "1920s flapper",
            "couture embroidery",
            "workwear denim",
        ],
        facets=["materials", "styles", "periods", "creators", "categories", "tags"],
        category_labels={
            "dress": "Dress",
            "outerwear": "Outerwear",
            "accessory": "Accessory",
            "textile": "Textile",
            "ensemble": "Ensemble",
            "footwear": "Footwear",
        },
        default_sources=["met", "smithsonian"],
        interests=[
            "couture",
            "ready-to-wear",
            "textile design",
            "costume history",
            "street style archive",
            "accessories",
        ],
    ),
    ModeId.PRODUCT: ModePack(
        id=ModeId.PRODUCT,
        label="Product Design",
        short_label="Product",
        reference_noun="object",
        reference_noun_plural="objects",
        creator_noun="designer",
        creator_noun_plural="designers",
        hero_line="Objects, tools, and decorative arts — designed to be studied.",
        search_placeholder="Search objects, materials, makers, typologies…",
        suggestions=[
            "Bauhaus teapot",
            "ceramics glaze",
            "industrial chair",
            "poster typography",
            "lighting fixture",
            "Japanese lacquer",
        ],
        facets=["materials", "styles", "periods", "creators", "categories", "tags"],
        category_labels={
            "furniture": "Furniture",
            "ceramics": "Ceramics",
            "metalwork": "Metalwork",
            "graphics": "Graphics",
            "lighting": "Lighting",
            "tool": "Tool / Instrument",
            "decorative": "Decorative arts",
        },
        default_sources=["cooper_hewitt", "rijksmuseum", "smithsonian"],
        interests=[
            "furniture",
            "industrial design",
            "ceramics",
            "graphics",
            "lighting",
            "everyday objects",
        ],
    ),
}


def get_mode(mode_id: ModeId | str) -> ModePack:
    key = ModeId(mode_id) if not isinstance(mode_id, ModeId) else mode_id
    return MODE_PACKS[key]


def get_mode_or_default(mode_id: ModeId | str | None) -> ModePack:
    """Never raise for an unknown id — fall back to the cinematic pack."""
    try:
        return get_mode(mode_id)  # type: ignore[arg-type]
    except (ValueError, KeyError):
        return MODE_PACKS[ModeId.CINEMATIC]


def all_modes() -> list[ModePack]:
    return list(MODE_PACKS.values())


def merge_mode_labels(mode_ids: list[ModeId | str]) -> dict[str, str]:
    """Union category labels across selected modes for mixed browsing."""
    out: dict[str, str] = {}
    for mid in mode_ids:
        pack = get_mode(mid)
        out.update(pack.category_labels)
    return out
