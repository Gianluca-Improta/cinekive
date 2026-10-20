/**
 * Preview images for the Archive of Archives cards.
 *
 * Cinekive is local-first, so the previews are bundled public-domain film
 * stills that ship with the app (apps/web/public/archive-previews). They work
 * offline, never 404, and load instantly. A per-source slice keeps the cards
 * visually distinct.
 *
 * A live mirror (once the user pulls one) always wins — those frames are the
 * real thing. Until then the card shows an illustrative still, and says so.
 */
const B = (name: string) => `/archive-previews/${name}`;

const BUNDLED_FILM = [
  B("metropolis.jpg"),
  B("caligari.jpg"),
  B("nosferatu.jpg"),
  B("potemkin.jpg"),
  B("the-general.jpg"),
  B("safety-last.jpg"),
  B("intolerance.jpg"),
  B("phantom-opera.jpg"),
  B("sunrise-1927.jpg"),
  B("joan-of-arc.jpg"),
  B("movie-camera.jpg"),
  B("the-kid.jpg"),
];

/** Deterministic per-source slice so each card gets a different-looking set. */
function bundledSlice(key: string, count = 6): string[] {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 997;
  const start = hash % BUNDLED_FILM.length;
  return Array.from(
    { length: count },
    (_, i) => BUNDLED_FILM[(start + i) % BUNDLED_FILM.length]
  );
}

/** Prefer live mirror previews; fall back to illustrative stills when empty. */
export function resolveArchivePreviewUrls(
  key: string | undefined,
  liveUrls: string[] | undefined
): { urls: string[]; illustrative: boolean; bundled: string[] } {
  const live = (liveUrls || []).filter(Boolean);
  const k = (key || "").toLowerCase();
  // Offline-safe images the card can swap to if a remote URL fails to load.
  const bundled = bundledSlice(k || "default");
  if (live.length > 0) return { urls: live.slice(0, 6), illustrative: false, bundled };
  // No mirror yet — the bundled stills stand in, and the card labels them
  // as illustrative so nobody mistakes them for the real archive.
  return { urls: bundled.slice(0, 6), illustrative: true, bundled };
}

/** Bundled PD stills for a source — always available, no network required. */
export function bundledArchivePreviewUrls(key: string | undefined, count = 6): string[] {
  return bundledSlice((key || "default").toLowerCase(), count);
}
