"""
Library of Congress — Architecture.

Strategies: JSON/YAML item + resource APIs, IIIF image services.
Docs: https://www.loc.gov/apis/
Expect heterogeneous metadata; keep source_metadata intact.
"""

from __future__ import annotations

from typing import Any

from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle
from cinearchive.modes.models import ImageAsset, ModeId, Provenance, Reference, RightsInfo, Source


class LocAdapter:
    spec = Source(
        key="loc",
        label="Library of Congress",
        site_url="https://www.loc.gov/",
        strategies=["rest", "iiif"],
        modes=[ModeId.ARCHITECTURE],
        rate_limit_note="JSON item endpoints; heterogeneous fields by collection.",
    )

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]:
        # LoC JSON search is often Cloudflare-gated from datacenters; fixtures still work.
        try:
            from cinearchive.modes.http import get_json

            data = get_json(
                "https://www.loc.gov/search/",
                params={"q": query.q or "architecture", "fo": "json", "c": query.limit},
            )
        except Exception:
            return []
        results = data.get("results") or []
        handles = []
        for item in results[: query.limit]:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or item.get("url") or "")
            if not sid:
                continue
            handles.append(
                RemoteHandle(
                    source=self.spec.key,
                    source_id=sid,
                    url=item.get("url"),
                    hint={"payload": item, "mode": "architecture"},
                )
            )
        return handles

    def fetch(self, handle: RemoteHandle) -> RawRecord:
        return RawRecord(
            source=self.spec.key,
            source_id=handle.source_id,
            payload=handle.hint.get("payload") or {},
            fetched_url=handle.url,
        )

    def normalize(self, raw: RawRecord) -> Reference:
        p = raw.payload
        item = p.get("item") if isinstance(p.get("item"), dict) else p
        title = _first(item.get("title")) or f"LoC {raw.source_id}"
        image_url = _iiif_or_image(p, item)
        return Reference(
            title=title,
            description=_first(item.get("description") or item.get("summary")),
            modes=[ModeId.ARCHITECTURE],
            materials=_listish(item.get("medium")),
            styles=_listish(item.get("subjects")),
            periods=_listish(item.get("dates") or item.get("date")),
            tags=_listish(item.get("subject") or item.get("subjects")),
            categories=_listish(item.get("original_format")),
            place=_first(item.get("location") or item.get("place")),
            date_text=_first(item.get("date")),
            image=ImageAsset(
                url=image_url,
                iiif_info_url=_iiif_info(p),
                origin="iiif" if _iiif_info(p) else "source",
            )
            if image_url
            else None,
            provenance=Provenance(
                source=self.spec.key,
                source_id=str(raw.source_id),
                source_url=raw.fetched_url or _first(item.get("url")),
                source_metadata=p,
                image_origin=image_url,
            ),
        )

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference:
        item = raw.payload.get("item") if isinstance(raw.payload.get("item"), dict) else raw.payload
        rights = _first(item.get("rights") or item.get("rights_information")) or "See LoC rights statement"
        ref.provenance.rights = RightsInfo(
            license=rights,
            rights_url=_first(item.get("rights_advisory")),
            can_display=bool(ref.primary_image_url()),
            notes="LoC rights vary by collection; inspect item-level statements.",
        )
        return ref


def _first(val: Any) -> str | None:
    if val is None:
        return None
    if isinstance(val, list) and val:
        return _first(val[0])
    if isinstance(val, dict):
        return val.get("title") or val.get("name")
    text = str(val).strip()
    return text or None


def _listish(val: Any) -> list[str]:
    if val is None:
        return []
    if isinstance(val, list):
        out = []
        for v in val:
            t = _first(v)
            if t:
                out.append(t)
        return out
    t = _first(val)
    return [t] if t else []


def _iiif_info(p: dict[str, Any]) -> str | None:
    resources = p.get("resources") or []
    if isinstance(resources, list):
        for r in resources:
            if isinstance(r, dict) and r.get("url") and "iiif" in str(r.get("url")).lower():
                return str(r["url"])
    return p.get("iiif") if isinstance(p.get("iiif"), str) else None


def _iiif_or_image(p: dict[str, Any], item: dict[str, Any]) -> str | None:
    info = _iiif_info(p)
    if info:
        base = info.rstrip("/").removesuffix("/info.json")
        return f"{base}/full/!800,800/0/default.jpg"
    image = item.get("image_url") or p.get("image")
    return _first(image)
