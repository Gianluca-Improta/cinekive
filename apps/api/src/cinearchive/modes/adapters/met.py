"""
The Metropolitan Museum of Art — Fashion / Design / Architecture drawings.

Strategies: REST JSON v1.1 search (paginated), object records, Open Access images.
Docs: https://metmuseum.github.io/
Search path moved to /public/collection/v1.1/search (2026).
"""

from __future__ import annotations

from typing import Any

import httpx

from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle
from cinearchive.modes.http import get_json
from cinearchive.modes.models import Creator, ImageAsset, ModeId, Provenance, Reference, RightsInfo, Source


class MetAdapter:
    spec = Source(
        key="met",
        label="The Met",
        site_url="https://www.metmuseum.org/",
        strategies=["rest", "csv"],
        modes=[ModeId.FASHION, ModeId.PRODUCT, ModeId.ARCHITECTURE],
        rate_limit_note="Public Collection API v1.1; paginate with offset/limit; be polite on object fetches.",
    )

    SEARCH = "https://collectionapi.metmuseum.org/public/collection/v1.1/search"
    OBJECT = "https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}"

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]:
        params: dict[str, Any] = {
            "q": query.q or "*",
            "isPublicDomain": "true",
            "hasImages": "true",
            "limit": min(query.limit * 3, 40),
            "offset": int(query.cursor or 0),
        }
        dept = query.extra.get("departmentId")
        if dept:
            params["departmentId"] = dept
        try:
            data = get_json(self.SEARCH, params=params)
        except httpx.HTTPError:
            return []
        ids = data.get("objectIDs") or []
        mode_hint = query.extra.get("mode")
        return [
            RemoteHandle(
                source=self.spec.key,
                source_id=str(oid),
                url=self.OBJECT.format(id=oid),
                hint={"mode": mode_hint} if mode_hint else {},
            )
            for oid in ids[: query.limit * 3]
        ]

    def fetch(self, handle: RemoteHandle) -> RawRecord:
        payload = handle.hint.get("payload")
        if not payload:
            try:
                payload = get_json(self.OBJECT.format(id=handle.source_id))
            except httpx.HTTPError:
                payload = {}
        if handle.hint.get("mode"):
            payload = dict(payload)
            payload["_dk_mode"] = handle.hint["mode"]
        return RawRecord(
            source=self.spec.key,
            source_id=handle.source_id,
            payload=payload,
            fetched_url=handle.url or self.OBJECT.format(id=handle.source_id),
        )

    def normalize(self, raw: RawRecord) -> Reference:
        p = {k: v for k, v in raw.payload.items() if k != "_dk_mode"}
        modes = _modes_from_record(p, raw.payload.get("_dk_mode"))
        image_url = p.get("primaryImageSmall") or p.get("primaryImage") or ""
        creators = []
        for person in p.get("constituents") or []:
            if isinstance(person, dict) and person.get("name"):
                creators.append(Creator(name=str(person["name"]), role=person.get("role")))
        return Reference(
            id=f"met:{p.get('objectID') or raw.source_id}",
            title=p.get("title") or f"Met {raw.source_id}",
            description=p.get("medium") or p.get("creditLine"),
            creators=creators,
            modes=modes,
            materials=_split(p.get("medium")),
            styles=_split(p.get("culture") or p.get("period") or p.get("dynasty")),
            periods=_split(p.get("objectDate") or p.get("era")),
            tags=_split(p.get("classification")),
            categories=_split(p.get("classification") or p.get("department")),
            place=p.get("country") or p.get("geographyType") or p.get("city"),
            date_text=p.get("objectDate"),
            image=ImageAsset(url=image_url, origin="source") if image_url else None,
            provenance=Provenance(
                source=self.spec.key,
                source_id=str(p.get("objectID") or raw.source_id),
                source_url=p.get("objectURL") or raw.fetched_url,
                source_metadata=p,
                image_origin=image_url or None,
            ),
        )

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference:
        p = raw.payload
        is_oa = bool(p.get("isPublicDomain"))
        ref.provenance.rights = RightsInfo(
            license="CC0 / Public Domain" if is_oa else "Restricted — see Met object page",
            credit=p.get("creditLine"),
            is_public_domain=is_oa,
            can_display=is_oa and bool(ref.primary_image_url()),
            notes="Prefer isPublicDomain objects for displayable images.",
        )
        return ref


def _modes_from_record(p: dict[str, Any], hint: Any) -> list[ModeId]:
    if hint:
        try:
            return [ModeId(str(hint))]
        except ValueError:
            pass
    text = " ".join(
        str(p.get(k) or "")
        for k in ("department", "classification", "title", "objectName", "medium")
    ).lower()
    if any(w in text for w in ("costume", "fashion", "dress", "kimono", "textile", "garment")):
        return [ModeId.FASHION]
    if any(w in text for w in ("architect", "facade", "interior", "building", "drawing")):
        return [ModeId.ARCHITECTURE]
    return [ModeId.PRODUCT]


def _split(val: Any) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v]
    return [part.strip() for part in str(val).split(",") if part.strip()]
