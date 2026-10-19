"""
Cooper Hewitt Smithsonian Design Museum — Product Design.

Strategies: GraphQL collection API, structured JSON, downloadable collection dumps.
API docs: https://collection.cooperhewitt.org/api/
Respect rate limits; prefer bulk JSON for large harvests.
"""

from __future__ import annotations

from typing import Any

from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle
from cinearchive.modes.models import ImageAsset, ModeId, Provenance, Reference, RightsInfo, Source


class CooperHewittAdapter:
    spec = Source(
        key="cooper_hewitt",
        label="Cooper Hewitt",
        site_url="https://collection.cooperhewitt.org/",
        strategies=["graphql", "json", "bulk_json"],
        modes=[ModeId.PRODUCT],
        rate_limit_note="Use access token; prefer bulk collection JSON for harvests.",
    )

    GRAPHQL = "https://api.collection.cooperhewitt.org/graphql"
    REST = "https://api.collection.cooperhewitt.org/rest/"

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]:
        # Network discover is opt-in via pipeline extra; V1 uses fixtures or REST search.
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
        title = _pick(p, "title", "name") or f"Cooper Hewitt {raw.source_id}"
        image_url = _image(p)
        return Reference(
            title=title,
            description=_pick(p, "description", "medium"),
            modes=[ModeId.PRODUCT],
            materials=_as_list(p.get("medium") or p.get("materials")),
            periods=_as_list(p.get("date") or p.get("period")),
            tags=_as_list(p.get("woe") or p.get("type")),
            categories=_as_list(p.get("type") or p.get("department")),
            place=_pick(p, "woe:country_name", "country"),
            date_text=_pick(p, "date"),
            image=ImageAsset(url=image_url, origin="source") if image_url else None,
            provenance=Provenance(
                source=self.spec.key,
                source_id=str(raw.source_id),
                source_url=raw.fetched_url or p.get("url"),
                source_metadata=p,
                image_origin=image_url,
            ),
        )

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference:
        p = raw.payload
        license_text = _pick(p, "rights", "creditline") or "See Cooper Hewitt object record"
        ref.provenance.rights = RightsInfo(
            license=license_text,
            credit=_pick(p, "creditline"),
            can_display=bool(ref.primary_image_url()),
            notes="Check object-level rights before publishing images.",
        )
        return ref


def _pick(obj: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        v = obj.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
        if isinstance(v, dict) and "title" in v:
            return str(v["title"])
    return None


def _image(p: dict[str, Any]) -> str | None:
    images = p.get("images") or p.get("image")
    if isinstance(images, list) and images:
        first = images[0]
        if isinstance(first, str):
            return first
        if isinstance(first, dict):
            return first.get("b") or first.get("url") or first.get("z")
    if isinstance(images, str):
        return images
    return None


def _as_list(val: Any) -> list[str]:
    if val is None:
        return []
    if isinstance(val, list):
        out = []
        for item in val:
            if isinstance(item, str):
                out.append(item)
            elif isinstance(item, dict) and "name" in item:
                out.append(str(item["name"]))
        return out
    if isinstance(val, str) and val.strip():
        return [val.strip()]
    return []
