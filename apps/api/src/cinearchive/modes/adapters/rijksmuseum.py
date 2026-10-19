"""
Rijksmuseum — Product / Decorative / Design.

Strategies: Search API, OAI-PMH harvest, IIIF images.
Docs: https://data.rijksmuseum.nl/
"""

from __future__ import annotations

from typing import Any

from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle
from cinearchive.modes.models import ImageAsset, ModeId, Provenance, Reference, RightsInfo, Source


class RijksmuseumAdapter:
    spec = Source(
        key="rijksmuseum",
        label="Rijksmuseum",
        site_url="https://www.rijksmuseum.nl/",
        strategies=["rest", "oai_pmh", "iiif"],
        modes=[ModeId.PRODUCT],
        rate_limit_note="Collection API key required for search; OAI-PMH for incremental harvest.",
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
        art = p.get("artObject") if isinstance(p.get("artObject"), dict) else p
        title = art.get("title") or art.get("longTitle") or f"Rijksmuseum {raw.source_id}"
        image_url = _image(art)
        iiif = None
        web = art.get("webImage") if isinstance(art.get("webImage"), dict) else {}
        if web.get("url") and "iiif" in str(web.get("url")).lower():
            iiif = web.get("url")
        return Reference(
            title=title,
            description=art.get("plaqueDescriptionEnglish") or art.get("subTitle"),
            modes=[ModeId.PRODUCT],
            materials=_materials(art),
            styles=_list(art.get("objectCollection")),
            periods=_list(art.get("dating", {}).get("presentingDate") if isinstance(art.get("dating"), dict) else None),
            tags=_list(art.get("objectTypes")),
            categories=_list(art.get("objectTypes")),
            place=_first_maker_place(art),
            date_text=(art.get("dating") or {}).get("presentingDate") if isinstance(art.get("dating"), dict) else None,
            image=ImageAsset(url=image_url, iiif_info_url=iiif, origin="iiif" if iiif else "source")
            if image_url
            else None,
            provenance=Provenance(
                source=self.spec.key,
                source_id=str(art.get("objectNumber") or raw.source_id),
                source_url=raw.fetched_url or (art.get("links") or {}).get("web"),
                source_metadata=p,
                image_origin=image_url,
            ),
        )

    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference:
        art = raw.payload.get("artObject") if isinstance(raw.payload.get("artObject"), dict) else raw.payload
        copy = art.get("copyrightHolder")
        ref.provenance.rights = RightsInfo(
            license="Rijksmuseum — check copyrightHolder / Open Data flags",
            credit=copy,
            can_display=bool(ref.primary_image_url()) and not copy,
            notes="Prefer objects with reusable webImage and no active copyright holder.",
        )
        return ref


def _image(art: dict[str, Any]) -> str | None:
    web = art.get("webImage")
    if isinstance(web, dict) and web.get("url"):
        return str(web["url"])
    return None


def _materials(art: dict[str, Any]) -> list[str]:
    mats = art.get("materials") or []
    if isinstance(mats, list):
        return [str(m) for m in mats if m]
    return []


def _list(val: Any) -> list[str]:
    if not val:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v]
    return [str(val)]


def _first_maker_place(art: dict[str, Any]) -> str | None:
    makers = art.get("principalMakers") or []
    if isinstance(makers, list) and makers and isinstance(makers[0], dict):
        return makers[0].get("placeOfBirth") or makers[0].get("nationality")
    return None
