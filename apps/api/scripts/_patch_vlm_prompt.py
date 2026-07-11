from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src" / "cinearchive" / "pipelines" / "vlm_enrichment.py"
t = p.read_text(encoding="utf-8")
old = '''  "era": "{_ERA}",
  "visual_style": "{_STYLE}",
  "theme": "{_THEME}",
  "genre": "{_GENRE}",'''
new = '''  "era": "{_ERA}",
  "origin": "{_ORIGIN}",
  "ism": "{_ISM}",
  "visual_style": "{_STYLE}",
  "theme": "{_THEME}",
  "genre": "{_GENRE}",'''
if old not in t:
    raise SystemExit("block1 missing")
t = t.replace(old, new, 1)
old2 = """SHAPES for visual rhyming: {_SHAPE}.
ERAS include y2k, 80s, 90s, dreamcore-adjacent cultural moments via theme.

Rules:
- composition = how the frame is designed spatially (not camera move, not lighting). Prefer specific slugs (s-curve, golden-ratio, one-point-perspective) over vague \"other\".
- techniques = craft labels. theme/era/style/genre = cultural & aesthetic axes. shapes = geometry for linking."""
new2 = """SHAPES for visual rhyming: {_SHAPE}.
ISMS (aesthetic school / movement): realism, formalism, surrealism, expressionism, italian-neorealism, french-new-wave, dogme-95, noir, neo-noir, slow-cinema, …
ORIGINS (national/regional cinema when clear): hollywood, french, japanese, korean, …
ERAS include decades + silent-era, golden-age, new-hollywood, y2k, period-piece.

Rules:
- composition = how the frame is designed spatially (not camera move, not lighting). Prefer specific slugs (s-curve, golden-ratio, one-point-perspective) over vague \"other\".
- techniques = craft labels. theme/era/style/genre/ism/origin = cultural & aesthetic axes. shapes = geometry for linking.
- ism = film movement or aesthetic school. origin = cinema culture when readable."""
if old2 not in t:
    raise SystemExit("block2 missing")
t = t.replace(old2, new2, 1)
p.write_text(t, encoding="utf-8")
print("patched", p)
