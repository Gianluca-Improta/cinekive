# Modes and archive adapters

Cinekive is one application with several vocabularies. The old "Design Kive"
project proved the idea: the same core schema can describe cinematic stills,
museum objects, architecture, and product design. The differences live in
**mode packs** (what things are called, which facets matter) and **source
adapters** (how to pull records from an upstream archive) — never in separate
data models or separate apps.

## Modes

`GET /modes` returns every mode with its vocabulary.

| Mode | A record is | Sources |
|------|-------------|---------|
| `cinematic` | a shot | your local library |
| `architecture` | a space | LoC, Smithsonian, Met |
| `fashion` | a look | Met, Smithsonian |
| `product` | an object | Cooper Hewitt, Rijksmuseum, Met, Smithsonian |

The active mode is stored per device (`cinekive.mode` in local storage) and
changes the wording of the interface: the search placeholder, the nouns used
for records and creators, and the suggestions. It never changes the data.

## Core schema

`cinearchive/modes/models.py` holds the shared records:

- `Reference` — one item, with `Provenance` (where it came from, rights) and
  optional `Enrichment` (AI inference, always labelled as unverified).
- `ImageAsset` — URL, dimensions, IIIF info, origin.
- `Provenance` / `RightsInfo` — source, id, licence, credit, rights URL.
- `Source` — describes an upstream archive and the modes it serves.

## Writing an adapter

An adapter is a small class with four methods:

```python
from cinearchive.modes.adapters.base import AdapterQuery, RawRecord, RemoteHandle

class MyAdapter:
    spec = Source(key="my_archive", label="My Archive", modes=[ModeId.PRODUCT])

    def discover(self, query: AdapterQuery) -> list[RemoteHandle]: ...
    def fetch(self, handle: RemoteHandle) -> RawRecord: ...
    def normalize(self, raw: RawRecord) -> Reference: ...
    def apply_rights(self, raw: RawRecord, ref: Reference) -> Reference: ...
```

Register it and it appears in the mode registry:

```python
from cinearchive.modes.adapters import register
register("my_archive", MyAdapter)
```

Two rules keep the archive honest:

1. **Keep the source metadata.** Store the untouched payload in
   `Provenance.source_metadata` so a record can always be traced back.
2. **Rights are explicit.** `apply_rights` decides whether an image may be
   displayed. Public-domain flags come from the source, not from a guess.

## Custom archives for other collections

The same ideas work for a private collection. A folder importer plus a
column mapper (CSV / XLSX) turns any spreadsheet into an archive — the
shotlist template workflow already does this for shot lists. The mapper
describes which column is the title, which is the creator, which are tags.

That is the intended path for "my own archive of X": define the columns, point
Cinekive at the folder, and let the enrich pipeline fill in the rest.
