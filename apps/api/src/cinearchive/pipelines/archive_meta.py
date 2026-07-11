"""Human-readable archive titles and frame labels.

Mirror files stay as-is (CDN names / opaque IDs). We build display strings for
UI, downloads, and search from folder/sidecar metadata.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

# Curated release years when FilmGrab sidecars only have blog-post years.
# Key = lowercase film title (or slug with spaces).
KNOWN_RELEASE_YEARS: dict[str, int] = {
    "blade runner 2049": 2017,
    "blade runner": 1982,
    "2001: a space odyssey": 1968,
    "2001 a space odyssey": 1968,
    "12 angry men": 1957,
    "12 years a slave": 2013,
    "127 hours": 2010,
    "10 cloverfield lane": 2016,
    "28 days later": 2002,
    "28 years later": 2025,
    "25th hour": 2002,
    "24 hour party people": 2002,
    "2046": 2004,
    "the matrix": 1999,
    "inception": 2010,
    "dune": 2021,
    "dune part two": 2024,
    "dune: part two": 2024,
    "arrival": 2016,
    "sicario": 2015,
    "prisoners": 2013,
    "nocturnal animals": 2016,
    "drive": 2011,
    "mad max fury road": 2015,
    "mad max: fury road": 2015,
    "her": 2013,
    "ex machina": 2014,
    "the social network": 2010,
    "whiplash": 2014,
    "la la land": 2016,
    "moonlight": 2016,
    "parasite": 2019,
    "everything everywhere all at once": 2022,
    "oppenheimer": 2023,
    "barbie": 2023,
    "the batman": 2022,
    "joker": 2019,
    "interstellar": 2014,
    "the revenant": 2015,
    "birdman": 2014,
    "gravity": 2013,
    "children of men": 2006,
    "no country for old men": 2007,
    "there will be blood": 2007,
    "the master": 2012,
    "phantom thread": 2017,
    "moonrise kingdom": 2012,
    "the grand budapest hotel": 2014,
}

KNOWN_DIRECTORS: dict[str, str] = {
    "blade runner 2049": "Denis Villeneuve",
    "blade runner": "Ridley Scott",
    "2001: a space odyssey": "Stanley Kubrick",
    "2001 a space odyssey": "Stanley Kubrick",
    "arrival": "Denis Villeneuve",
    "dune": "Denis Villeneuve",
    "dune part two": "Denis Villeneuve",
    "dune: part two": "Denis Villeneuve",
    "sicario": "Denis Villeneuve",
    "prisoners": "Denis Villeneuve",
    "enemy": "Denis Villeneuve",
    "incendies": "Denis Villeneuve",
    "inception": "Christopher Nolan",
    "interstellar": "Christopher Nolan",
    "the dark knight": "Christopher Nolan",
    "the dark knight rises": "Christopher Nolan",
    "batman begins": "Christopher Nolan",
    "dunkirk": "Christopher Nolan",
    "tenet": "Christopher Nolan",
    "memento": "Christopher Nolan",
    "the prestige": "Christopher Nolan",
    "oppenheimer": "Christopher Nolan",
    "the matrix": "Lana Wachowski, Lilly Wachowski",
    "mad max fury road": "George Miller",
    "mad max: fury road": "George Miller",
    "moonrise kingdom": "Wes Anderson",
    "the grand budapest hotel": "Wes Anderson",
    "the royal tenenbaums": "Wes Anderson",
    "fantastic mr fox": "Wes Anderson",
    "parasite": "Bong Joon-ho",
    "whiplash": "Damien Chazelle",
    "la la land": "Damien Chazelle",
    "drive": "Nicolas Winding Refn",
    "ex machina": "Alex Garland",
    "her": "Spike Jonze",
    "children of men": "Alfonso Cuarón",
    "gravity": "Alfonso Cuarón",
    "roma": "Alfonso Cuarón",
    "no country for old men": "Joel Coen, Ethan Coen",
    "there will be blood": "Paul Thomas Anderson",
    "the master": "Paul Thomas Anderson",
    "phantom thread": "Paul Thomas Anderson",
    "boogie nights": "Paul Thomas Anderson",
    "28 days later": "Danny Boyle",
    "12 angry men": "Sidney Lumet",
    "12 years a slave": "Steve McQueen",
    "10 cloverfield lane": "Dan Trachtenberg",
    "2046": "Wong Kar-wai",
    "in the mood for love": "Wong Kar-wai",
    "chungking express": "Wong Kar-wai",
    "joker": "Todd Phillips",
    "the batman": "Matt Reeves",
    "the social network": "David Fincher",
    "fight club": "David Fincher",
    "se7en": "David Fincher",
    "seven": "David Fincher",
    "gone girl": "David Fincher",
    "zodiac": "David Fincher",
    "the girl with the dragon tattoo": "David Fincher",
    "panic room": "David Fincher",
    "the game": "David Fincher",
    "alien 3": "David Fincher",
    "alien³": "David Fincher",
    "mank": "David Fincher",
    "the killer": "David Fincher",
    "mindhunter": "David Fincher",
    "house of cards": "David Fincher",
    "the revenant": "Alejandro G. Iñárritu",
    "birdman": "Alejandro G. Iñárritu",
    "nocturnal animals": "Tom Ford",
    "moonlight": "Barry Jenkins",
    "everything everywhere all at once": "Daniels",
    "barbie": "Greta Gerwig",
    "25th hour": "Spike Lee",
    "24 hour party people": "Michael Winterbottom",
    "mulholland drive": "David Lynch",
    "blue velvet": "David Lynch",
    "eraserhead": "David Lynch",
    "pulp fiction": "Quentin Tarantino",
    "kill bill": "Quentin Tarantino",
    "reservoir dogs": "Quentin Tarantino",
    "the shining": "Stanley Kubrick",
    "a clockwork orange": "Stanley Kubrick",
    "eyes wide shut": "Stanley Kubrick",
    "barry lyndon": "Stanley Kubrick",
    "apocalypse now": "Francis Ford Coppola",
    "the godfather": "Francis Ford Coppola",
}


# Surname / alias → canonical director display name (built once).
_DIRECTOR_QUERY_INDEX: dict[str, str] | None = None


def _director_query_index() -> dict[str, str]:
    """Map 'fincher', 'david fincher', 'nolan' → canonical director string."""
    global _DIRECTOR_QUERY_INDEX
    if _DIRECTOR_QUERY_INDEX is not None:
        return _DIRECTOR_QUERY_INDEX
    index: dict[str, str] = {}
    for director in set(KNOWN_DIRECTORS.values()):
        # Support multi-director strings ("Joel Coen, Ethan Coen")
        for part in re.split(r"\s*,\s*", director):
            name = part.strip()
            if not name:
                continue
            low = name.lower()
            index[low] = name
            tokens = [t for t in re.findall(r"[a-z0-9]+", low) if len(t) >= 2]
            if tokens:
                # Surname (last token) — "fincher", "nolan", "anderson"
                surname = tokens[-1]
                # Prefer longer/fuller names when colliding (Paul Thomas Anderson vs Wes)
                prev = index.get(surname)
                if prev is None or len(name) >= len(prev):
                    index[surname] = name
                # Full name without punctuation
                index[" ".join(tokens)] = name
    _DIRECTOR_QUERY_INDEX = index
    return index


def match_director_query(query: str | None) -> str | None:
    """If the whole query looks like a director name/surname, return canonical name."""
    if not query:
        return None
    q = _norm_title(query)
    q = re.sub(r"^(films?|movies?|by|from)\s+", "", q).strip()
    q = re.sub(r"\s+(films?|movies?)$", "", q).strip()
    return _director_query_index().get(q)


def match_known_film_title(query: str | None) -> str | None:
    """If query matches a known film title (or close), return the normalized key."""
    if not query:
        return None
    q = _norm_title(query)
    if q in KNOWN_DIRECTORS or q in KNOWN_RELEASE_YEARS:
        return q
    # Strip leading "the " for a second try
    if q.startswith("the ") and (q[4:] in KNOWN_DIRECTORS or q[4:] in KNOWN_RELEASE_YEARS):
        return q[4:]
    return None


def _norm_title(title: str) -> str:
    return re.sub(r"\s+", " ", title.lower().strip())


def lookup_release_year(title: str | None) -> int | None:
    if not title:
        return None
    return KNOWN_RELEASE_YEARS.get(_norm_title(title))


def lookup_director(title: str | None) -> str | None:
    if not title:
        return None
    return KNOWN_DIRECTORS.get(_norm_title(title))


def eyecandy_clean_title(filename: str) -> str:
    """Strip EyeCandy mirror suffix before humanizing."""
    stem = Path(filename).stem
    stem = re.sub(r"__ec\d+$", "", stem, flags=re.I)
    stem = re.sub(r"^[0-9a-f]{6,10}_", "", stem, flags=re.I)
    stem = re.sub(r"[_\-]+", " ", stem)
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem[:200] or filename


def frame_label_from_filename(filename: str | None) -> str | None:
    """Turn bladerunner001.jpg / still_042.jpg into a short frame label.

    Opaque IDs and plain title stems (EyeCandy) return None — no redundant label.
    """
    if not filename:
        return None
    stem = Path(filename).stem
    # EyeCandy / uuid prefixes
    stem = re.sub(r"__ec\d+$", "", stem, flags=re.I)
    stem = re.sub(r"^[0-9a-f]{8}_", "", stem, flags=re.I)

    # trailing digits: bladerunner001, frame_042, still-12
    m = re.search(r"(?:^|[_\-\s])(\d{1,4})$", stem)
    if not m:
        m = re.search(r"(\d{2,4})$", stem)
    if m:
        # Only treat as a frame index when the digits are a suffix on a longer stem
        # or the whole stem is mostly digits
        num = m.group(1)
        prefix = stem[: m.start(1)].rstrip("_- ")
        if prefix or len(num) >= 2:
            return f"frame {num.zfill(3) if len(num) <= 3 else num}"

    # Opaque hash-like stems (shotdeck / moviestills) — skip
    if re.fullmatch(r"[A-Za-z0-9]{6,12}", stem) and not re.search(r"[\s_\-]", stem):
        # all-caps / alphanumeric codes like 4D54V6MG, tc6yyis5
        if stem.isupper() or not re.search(r"[aeiouAEIOU]{2,}", stem):
            return None

    # Readable title stems (EyeCandy "Moonrise Kingdom") — not a frame label
    return None


def format_display_title(
    *,
    film_title: str | None = None,
    release_year: int | str | None = None,
    director: str | None = None,
    frame_label: str | None = None,
    fallback: str | None = None,
) -> str:
    """Build e.g. '2017 - Blade Runner 2049 - Denis Villeneuve · frame 001'."""
    title = (film_title or "").strip() or None
    year = None
    if release_year is not None and str(release_year).strip():
        y = str(release_year).strip()
        if re.fullmatch(r"\d{4}", y):
            year = y
    director = (director or "").strip() or None
    frame_label = (frame_label or "").strip() or None

    parts: list[str] = []
    if year and title:
        parts.append(f"{year} - {title}")
    elif title:
        parts.append(title)
    elif fallback:
        parts.append(fallback.strip())

    if director and title:
        parts[0] = f"{parts[0]} - {director}"

    base = parts[0] if parts else (fallback or "Untitled")
    if frame_label:
        return f"{base} · {frame_label}"
    return base


def enrich_archive_meta(
    meta: dict[str, Any],
    *,
    filename: str | None = None,
    film_title: str | None = None,
) -> dict[str, Any]:
    """Fill display_title, release_year, director on a source_meta dict (in place + return)."""
    title = (
        film_title
        or meta.get("film_title")
        or meta.get("movie_title")
        or meta.get("title")
    )
    if isinstance(title, str):
        title = title.split(" — ", 1)[0].strip()
    else:
        title = None

    # Prefer curated release year over FilmGrab blog year
    release = lookup_release_year(title)
    blog_year = meta.get("film_year") or meta.get("blog_year")
    if release:
        meta["release_year"] = release
        if blog_year and str(blog_year) != str(release):
            meta["blog_year"] = blog_year
    elif blog_year and re.fullmatch(r"\d{4}", str(blog_year)):
        # Keep as blog_year only — don't pretend it's release year
        meta["blog_year"] = str(blog_year)
        meta.pop("release_year", None)

    director = meta.get("director") or lookup_director(title)
    if director:
        meta["director"] = director

    if title:
        meta["film_title"] = title

    frame = frame_label_from_filename(filename or meta.get("filename"))
    if frame:
        meta["frame_label"] = frame

    display = format_display_title(
        film_title=title,
        release_year=meta.get("release_year"),
        director=meta.get("director"),
        frame_label=frame,
        fallback=str(meta.get("title") or filename or "Untitled"),
    )
    meta["display_title"] = display
    return meta
