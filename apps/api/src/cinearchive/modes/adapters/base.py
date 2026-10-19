"""Adapter types — source-specific logic stays in adapters, not the core app."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

from cinearchive.modes.models import ModeId, Reference, Source


@dataclass
class AdapterQuery:
    q: str | None = None
    modes: list[ModeId] = field(default_factory=list)
    limit: int = 24
    cursor: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class RemoteHandle:
    source: str
    source_id: str
    url: str | None = None
    hint: dict[str, Any] = field(default_factory=dict)


@dataclass
class RawRecord:
    source: str
    source_id: str
    payload: dict[str, Any]
    fetched_url: str | None = None


@runtime_checkable
class SourceAdapter(Protocol):
    spec: Source

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]: ...

    def fetch(self, handle: RemoteHandle) -> RawRecord: ...

    def normalize(self, raw: RawRecord) -> Reference: ...

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference: ...
