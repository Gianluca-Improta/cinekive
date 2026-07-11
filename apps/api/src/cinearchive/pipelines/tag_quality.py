"""Tag / enrichment quality scoring — gate for re-enrich and continuous improve."""

from __future__ import annotations

from typing import Any

from cinearchive.db.models.shot import Shot

# Fields that should not stay as generic "other" after a good pass
_CRAFT_FIELDS = (
    "shot_type",
    "camera_movement",
    "camera_angle",
    "lighting_style",
    "composition",
    "lens_look",
    "color_grade",
    "emotion",
    "content_format",
    "era",
    "visual_style",
    "theme",
    "genre",
)

_WEAK = {"", "other", "unknown", "none", "n/a", "na"}


def _is_weak(val: str | None) -> bool:
    if val is None:
        return True
    return val.strip().lower() in _WEAK


def score_enrichment(shot: Shot | dict[str, Any]) -> dict[str, Any]:
    """Return {score: 0-100, pass: bool, issues: [...], strengths: [...]}."""

    def g(name: str, default=None):
        if isinstance(shot, dict):
            return shot.get(name, default)
        return getattr(shot, name, default)

    issues: list[str] = []
    strengths: list[str] = []
    score = 0.0

    # Version / presence
    ver = int(g("enrichment_version") or 0)
    if ver <= 0:
        issues.append("never_enriched")
        return {
            "score": 0.0,
            "pass": False,
            "issues": issues,
            "strengths": strengths,
            "needs_reenrich": True,
        }

    # Craft enums (max ~40)
    craft_ok = 0
    for field in _CRAFT_FIELDS:
        val = g(field)
        if not _is_weak(val if isinstance(val, str) else None):
            craft_ok += 1
    craft_ratio = craft_ok / len(_CRAFT_FIELDS)
    score += 40.0 * craft_ratio
    if craft_ratio < 0.45:
        issues.append("too_many_other_craft_fields")
    else:
        strengths.append(f"craft_fields:{craft_ok}/{len(_CRAFT_FIELDS)}")

    # Techniques (max 15)
    techniques = list(g("techniques_json") or g("techniques") or [])
    tech_n = len([t for t in techniques if isinstance(t, str) and t.strip()])
    if tech_n >= 3:
        score += 15.0
        strengths.append(f"techniques:{tech_n}")
    elif tech_n >= 1:
        score += 8.0
        issues.append("few_techniques")
    else:
        issues.append("no_techniques")

    # Composition specifically (max 8)
    if not _is_weak(g("composition") if isinstance(g("composition"), str) else None):
        score += 8.0
        strengths.append("composition")
    else:
        issues.append("weak_composition")

    # Mood / subject / intent (max 20)
    mood = (g("mood_vibe") or "") if isinstance(g("mood_vibe"), str) else ""
    subject = (g("subject") or "") if isinstance(g("subject"), str) else ""
    intent = (g("creative_intent") or "") if isinstance(g("creative_intent"), str) else ""
    if len(mood.strip()) >= 8:
        score += 7.0
        strengths.append("mood")
    else:
        issues.append("weak_mood")
    if len(subject.strip()) >= 4:
        score += 5.0
    else:
        issues.append("weak_subject")
    if len(intent.strip()) >= 40 and "unavailable" not in intent.lower():
        score += 8.0
        strengths.append("creative_intent")
    else:
        issues.append("weak_creative_intent")

    # Shapes + tags (max 12)
    shapes = list(g("shapes_json") or g("shapes") or [])
    tags = list(g("tags_json") or g("tags") or [])
    shape_n = len([s for s in shapes if isinstance(s, str) and s not in _WEAK])
    tag_n = len([t for t in tags if isinstance(t, str) and t.strip() and t != "unenriched"])
    if shape_n >= 1:
        score += 5.0
        strengths.append(f"shapes:{shape_n}")
    else:
        issues.append("no_shapes")
    if tag_n >= 6:
        score += 7.0
        strengths.append(f"tags:{tag_n}")
    elif tag_n >= 3:
        score += 4.0
    else:
        issues.append("few_tags")

    # Penalty for explicit failure marker
    if "unenriched" in {str(t).lower() for t in tags}:
        score = min(score, 15.0)
        issues.append("unenriched_tag")

    score = round(max(0.0, min(100.0, score)), 1)
    passed = score >= 55.0 and "never_enriched" not in issues and "unenriched_tag" not in issues
    return {
        "score": score,
        "pass": passed,
        "issues": issues,
        "strengths": strengths,
        "needs_reenrich": not passed,
    }


def link_hints(shot: Shot) -> dict[str, list[str]]:
    """Craft axes useful for connection enrichment / UI chips."""
    hints: dict[str, list[str]] = {}
    for key, attr in (
        ("composition", "composition"),
        ("lighting", "lighting_style"),
        ("emotion", "emotion"),
        ("visual_style", "visual_style"),
        ("theme", "theme"),
        ("era", "era"),
    ):
        val = getattr(shot, attr, None)
        if isinstance(val, str) and not _is_weak(val):
            hints[key] = [val]
    techs = [t for t in (shot.techniques_json or []) if isinstance(t, str) and t.strip()]
    if techs:
        hints["techniques"] = techs[:6]
    shapes = [s for s in (shot.shapes_json or []) if isinstance(s, str) and s.strip()]
    if shapes:
        hints["shapes"] = shapes[:4]
    return hints
