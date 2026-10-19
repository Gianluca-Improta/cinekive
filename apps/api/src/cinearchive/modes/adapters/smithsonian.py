"""
Smithsonian Open Access — all modes.

Strategies: API + JSON data repository.
Image availability depends on rights / public-domain status.
Docs: https://www.si.edu/openaccess
"""

from __future__ import annotations

from typing import Any

from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle
from cinearchive.modes.models import ImageAsset, ModeId, Provenance, Reference, RightsInfo, Source


class SmithsonianAdapter:
    spec = Source(
        key="smithsonian",
        label="Smithsonian Open Access",
        site_url="https://www.si.edu/openaccess",
        strategies=["rest", "bulk_json"],
        modes=[ModeId.ARCHITECTURE, ModeId.FASHION, ModeId.PRODUCT],
        rate_limit_note="Open Access API; filter on usage rights before displaying images.",
    )

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]:
        _ = query
        return []

    def fetch(self, handle: RemoteHandle) -> RawRecord:
        return RawRecord(
            source=self.spec.key,
            source_id=handle.source_id,
            payload=handle.hint.get("payload") or {},
            fetched_url=handle.url,
        )

    def normalize(self, raw: RawRecord) -> Reference:
        p = raw.payload
        content = p.get("content") if isinstance(p.get("content"), dict) else p
        descriptive = content.get("descriptiveNonRepeating") if isinstance(content, dict) else {}
        if not isinstance(descriptive, dict):
            descriptive = {}
        title = _title(descriptive) or f"Smithsonian {raw.source_id}"
        image_url = _media(descriptive)
        freetext = content.get("freetext") if isinstance(content, dict) else {}
        return Reference(
            title=title,
            description=_freetext_first(freetext, "notes") or _freetext_first(freetext, "physicalDescription"),
            modes=_guess_modes(p),
            materials=_freetext_all(freetext, "physicalDescription"),
            styles=_freetext_all(freetext, "setName"),
            periods=_freetext_all(freetext, "date"),
            tags=_freetext_all(freetext, "topic"),
            categories=_freetext_all(freetext, "objectType"),
            place=_freetext_first(freetext, "place"),
            date_text=_freetext_first(freetext, "date"),
            image=ImageAsset(url=image_url, origin="source") if image_url else None,
            provenance=Provenance(
                source=self.spec.key,
                source_id=str(raw.source_id),
                source_url=descriptive.get("record_link") or raw.fetched_url,
                source_metadata=p,
                image_origin=image_url,
            ),
        )

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference:
        p = raw.payload
        usage = str(p.get("usage") or p.get("content", {}).get("freeText", "") or "")
        is_oa = "open" in usage.lower() or bool(p.get("isOpenAccess"))
        ref.provenance.rights = RightsInfo(
            license="Smithsonian Open Access (CC0)" if is_oa else "Check Smithsonian usage flags",
            is_public_domain=is_oa or None,
            can_display=bool(ref.primary_image_url()) and is_oa,
            notes="Display images only when Open Access flags permit.",
        )
        return ref


def _title(descriptive: dict[str, Any]) -> str | None:
    title = descriptive.get("title")
    if isinstance(title, dict):
        return title.get("content")
    if isinstance(title, str):
        return title
    return None


def _media(descriptive: dict[str, Any]) -> str | None:
    media = descriptive.get("online_media") or {}
    resources = media.get("media") if isinstance(media, dict) else None
    if isinstance(resources, list) and resources:
        first = resources[0]
        if isinstance(first, dict):
            return first.get("content") or first.get("thumbnail")
    return None


def _freetext_first(freetext: Any, key: str) -> str | None:
    items = _freetext_all(freetext, key)
    return items[0] if items else None


def _freetext_all(freetext: Any, key: str) -> list[str]:
    if not isinstance(freetext, dict):
        return []
    block = freetext.get(key) or []
    if isinstance(block, dict):
        block = [block]
    out = []
    for item in block:
        if isinstance(item, dict) and item.get("content"):
            out.append(str(item["content"]))
        elif isinstance(item, str):
            out.append(item)
    return out


def _guess_modes(p: dict[str, Any]) -> list[ModeId]:
    blob = str(p).lower()
    modes: list[ModeId] = []
    if any(w in blob for w in ("building", "architecture", "interior", "house")):
        modes.append(ModeId.ARCHITECTURE)
    if any(w in blob for w in ("costume", "dress", "fashion", "textile")):
        modes.append(ModeId.FASHION)
    if not modes:
        modes.append(ModeId.PRODUCT)
    return modes
