"""Adapter registry — new archives register here; core schema stays unchanged."""

from __future__ import annotations

from cinearchive.modes.adapters.base import SourceAdapter
from cinearchive.modes.adapters.cooper_hewitt import CooperHewittAdapter
from cinearchive.modes.adapters.loc import LocAdapter
from cinearchive.modes.adapters.met import MetAdapter
from cinearchive.modes.adapters.rijksmuseum import RijksmuseumAdapter
from cinearchive.modes.adapters.smithsonian import SmithsonianAdapter

_ADAPTERS: dict[str, type[SourceAdapter]] = {
    "cooper_hewitt": CooperHewittAdapter,
    "met": MetAdapter,
    "loc": LocAdapter,
    "smithsonian": SmithsonianAdapter,
    "rijksmuseum": RijksmuseumAdapter,
}


def available() -> list[str]:
    return sorted(_ADAPTERS)


def get(key: str) -> SourceAdapter:
    if key not in _ADAPTERS:
        raise KeyError(f"Unknown adapter {key!r}. Known: {available()}")
    return _ADAPTERS[key]()


def register(key: str, cls: type[SourceAdapter]) -> None:
    """Call from a plugin package to add V&A, Europeana, Getty, etc."""
    _ADAPTERS[key] = cls
