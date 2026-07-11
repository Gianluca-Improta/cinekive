#!/usr/bin/env python3
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from shotdeck_mirror import ShotDeckClient, SHOTID_RE, TITLE_RE

out = Path("D:/library/_shotdeck")
c = ShotDeckClient(out)
if not c.load_session():
    raise SystemExit("no session")
html = c.search_ajax("text/night/limit/5/offset/0")
if "not logged in" in html.lower():
    raise SystemExit("session expired")

# Sample titles from a commercial search
for suffix in [
    "text/commercial/limit/30/offset/0",
    "search/commercial/limit/30/offset/0",
    "text/ad/limit/30/offset/0",
    "genre/Commercial/limit/30/offset/0",
    "content_type/Commercial/limit/30/offset/0",
    "media_type/Commercial/limit/30/offset/0",
    "type/Commercial/limit/30/offset/0",
    "format/Commercial/limit/30/offset/0",
    "category/Commercial/limit/30/offset/0",
    "commercial/limit/30/offset/0",
    "commercials/limit/30/offset/0",
]:
    html = c.search_ajax(suffix)
    ids = len(set(SHOTID_RE.findall(html)))
    titles = []
    for m in TITLE_RE.finditer(html):
        t = m.group(1).strip()[:60]
        if t and t not in titles:
            titles.append(t)
        if len(titles) >= 5:
            break
    print(f"\n{suffix} -> {ids} unique ids")
    for t in titles:
        print(f"  - {t}")
