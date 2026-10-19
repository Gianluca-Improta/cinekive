"""Mode registry — one app, several archive vocabularies.

A *mode* is a vocabulary pack (what a record is called, which facets matter,
which sources fit). A *source adapter* knows how to pull records for one
upstream archive. Both are data, not separate applications.
"""

from __future__ import annotations

from typing import Any

from cinearchive.modes import adapters as adapter_registry
from cinearchive.modes.models import ModeId
from cinearchive.modes.packs import MODE_PACKS, ModePack, get_mode_or_default


def list_modes() -> list[ModePack]:
    """All modes, cinematic first."""
    ordered = [MODE_PACKS[ModeId.CINEMATIC]] if ModeId.CINEMATIC in MODE_PACKS else []
    ordered += [pack for key, pack in MODE_PACKS.items() if key != ModeId.CINEMATIC]
    return ordered


def get_pack(mode_id: ModeId | str | None) -> ModePack:
    return get_mode_or_default(mode_id)


def adapter_keys() -> list[str]:
    try:
        return adapter_registry.available()
    except Exception:
        return []


def sources_for_mode(mode_id: ModeId | str | None) -> list[str]:
    """Adapters that can serve this mode, plus the mode's own defaults."""
    pack = get_pack(mode_id)
    keys = set(pack.default_sources)
    for key in adapter_keys():
        try:
            adapter = adapter_registry.get(key)
        except Exception:
            continue
        modes = getattr(getattr(adapter, "spec", None), "modes", []) or []
        if pack.id in modes:
            keys.add(key)
    return sorted(keys)


def mode_payload(mode_id: ModeId | str | None) -> dict[str, Any]:
    pack = get_pack(mode_id)
    return {
        "id": pack.id.value,
        "label": pack.label,
        "short_label": pack.short_label,
        "reference_noun": pack.reference_noun,
        "reference_noun_plural": pack.reference_noun_plural,
        "creator_noun": pack.creator_noun,
        "creator_noun_plural": pack.creator_noun_plural,
        "hero_line": pack.hero_line,
        "search_placeholder": pack.search_placeholder,
        "suggestions": list(pack.suggestions),
        "facets": list(pack.facets),
        "category_labels": dict(pack.category_labels),
        "interests": list(pack.interests),
        "sources": sources_for_mode(pack.id),
    }


def all_modes_payload() -> dict[str, Any]:
    return {
        "modes": [mode_payload(pack.id) for pack in list_modes()],
        "adapters": adapter_keys(),
    }
