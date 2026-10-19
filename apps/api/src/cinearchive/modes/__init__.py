"""Cinekive modes — vocabulary packs and source adapters.

One archive application, several ways of looking at it:

* ``cinematic`` — the default: shots, lighting, colour, craft.
* ``architecture`` / ``fashion`` / ``product`` — design vocabularies that
  share the same core schema, so a record is a ``Reference`` whichever mode
  you are in.

New archives plug in through :mod:`cinearchive.modes.adapters`; the core
schema never forks.
"""

from __future__ import annotations

from cinearchive.modes.models import (
    Creator,
    Enrichment,
    ImageAsset,
    ModeId,
    Provenance,
    Reference,
    RightsInfo,
    Source,
)
from cinearchive.modes.packs import MODE_PACKS, ModePack, get_mode, get_mode_or_default
from cinearchive.modes.registry import (
    all_modes_payload,
    list_modes,
    mode_payload,
    sources_for_mode,
)

__all__ = [
    "Creator",
    "Enrichment",
    "ImageAsset",
    "MODE_PACKS",
    "ModeId",
    "ModePack",
    "Provenance",
    "Reference",
    "RightsInfo",
    "Source",
    "all_modes_payload",
    "get_mode",
    "get_mode_or_default",
    "list_modes",
    "mode_payload",
    "sources_for_mode",
]
