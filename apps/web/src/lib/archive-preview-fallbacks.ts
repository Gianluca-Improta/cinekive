/**
 * Rights-cleared cinematic stills used when a mirror has no local samples yet.
 * Distinct sets per source so Seed cards do not all look identical.
 * Prefer live /sources/{key}/preview when available.
 */
const U = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=480&q=70`;

/**
 * Bundled public-domain film stills (apps/web/public/archive-previews).
 * Shipped with the installer so Seed cards still render offline / air-gapped,
 * where the remote Unsplash + Commons URLs above would show empty tiles.
 * PD only — third-party mirror frames are never redistributed in the package.
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

const SETS: Record<string, string[]> = {
  filmgrab: [
    U("photo-1478720568477-152d9b164e26"),
    U("photo-1440404653325-ab127d49abb1"),
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1536440136628-849c177e76a1"),
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1594909122845-11baa439b7bf"),
  ],
  eyecandy: [
    U("photo-1492691527719-9d1e07e534b4"),
    U("photo-1485846234645-a62644f84728"),
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1574267432553-4b4628081c31"),
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1518676590629-3dcbd9c28b28"),
  ],
  shotdeck: [
    U("photo-1485846234645-a62644f84728"),
    U("photo-1574267432553-4b4628081c31"),
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1492691527719-9d1e07e534b4"),
    U("photo-1478720568477-152d9b164e26"),
    U("photo-1524985069026-dd778a71c7b4"),
  ],
  moviestillsdb: [
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1594909122845-11baa439b7bf"),
    U("photo-1440404653325-ab127d49abb1"),
    U("photo-1509347528160-9a9e33742cdb"),
    U("photo-1535016120720-7caccbed8e22"),
    U("photo-1478720568477-152d9b164e26"),
  ],
  stillslab: [
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1518676590629-3dcbd9c28b28"),
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1536440136628-849c177e76a1"),
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1594909122845-11baa439b7bf"),
  ],
  // Curated Seed shelf — unique looks per site (illustrative until a mirror exists)
  "movie-screencaps": [
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1440404653325-ab127d49abb1"),
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1535016120720-7caccbed8e22"),
    U("photo-1509347528160-9a9e33742cdb"),
    U("photo-1524985069026-dd778a71c7b4"),
  ],
  shotcafe: [
    U("photo-1492691527719-9d1e07e534b4"),
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1518676590629-3dcbd9c28b28"),
    U("photo-1485846234645-a62644f84728"),
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1574267432553-4b4628081c31"),
  ],
  evanerichards: [
    U("photo-1478720568477-152d9b164e26"),
    U("photo-1536440136628-849c177e76a1"),
    U("photo-1594909122845-11baa439b7bf"),
    U("photo-1440404653325-ab127d49abb1"),
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1517604931442-7e0c8ed2963c"),
  ],
  bluscreens: [
    U("photo-1535016120720-7caccbed8e22"),
    U("photo-1509347528160-9a9e33742cdb"),
    U("photo-1524985069026-dd778a71c7b4"),
    U("photo-1478720568477-152d9b164e26"),
    U("photo-1485846234645-a62644f84728"),
    U("photo-1492691527719-9d1e07e534b4"),
  ],
  homeofthenutty: [
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1574267432553-4b4628081c31"),
    U("photo-1518676590629-3dcbd9c28b28"),
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1536440136628-849c177e76a1"),
    U("photo-1440404653325-ab127d49abb1"),
  ],
  screencapped: [
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1594909122845-11baa439b7bf"),
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1524985069026-dd778a71c7b4"),
    U("photo-1535016120720-7caccbed8e22"),
    U("photo-1478720568477-152d9b164e26"),
  ],
  capsaholic: [
    U("photo-1485846234645-a62644f84728"),
    U("photo-1509347528160-9a9e33742cdb"),
    U("photo-1492691527719-9d1e07e534b4"),
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1574267432553-4b4628081c31"),
  ],
  // Real Wikimedia Commons film stills / production photos (CC / public domain)
  "wikimedia-film": [
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Metropolis_%281927%29_-_Maschinenmensch.jpg/480px-Metropolis_%281927%29_-_Maschinenmensch.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Charlie_Chaplin.jpg/480px-Charlie_Chaplin.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Orson_Welles_Citizen_Kane.jpg/480px-Orson_Welles_Citizen_Kane.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Battleship_Potemkin_baby_carriage_scene.jpg/480px-Battleship_Potemkin_baby_carriage_scene.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/25/The_Cabinet_of_Dr._Caligari_%281920%29_-_German_poster.jpg/480px-The_Cabinet_of_Dr._Caligari_%281920%29_-_German_poster.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/NosferatuShadow.jpg/480px-NosferatuShadow.jpg",
  ],
  "internet-archive-film": [
    "https://archive.org/services/img/nosferatu",
    "https://archive.org/services/img/Intolerance_1916",
    "https://archive.org/services/img/TheMarkOfZorro1920",
    "https://archive.org/services/img/TheGeneral_1926_Keaton",
    "https://archive.org/services/img/Plan9FromOuterSpace",
    "https://archive.org/services/img/night_of_the_living_dead",
  ],
  frameset: [
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1518676590629-3dcbd9c28b28"),
    U("photo-1492691527719-9d1e07e534b4"),
    U("photo-1524712245354-2c4e5e7121c0"),
    U("photo-1485846234645-a62644f84728"),
    U("photo-1536440136628-849c177e76a1"),
  ],
  flim: [
    U("photo-1535016120720-7caccbed8e22"),
    U("photo-1524985069026-dd778a71c7b4"),
    U("photo-1509347528160-9a9e33742cdb"),
    U("photo-1517604931442-7e0c8ed2963c"),
    U("photo-1594909122845-11baa439b7bf"),
    U("photo-1440404653325-ab127d49abb1"),
  ],
  "seek-film": [
    U("photo-1574267432553-4b4628081c31"),
    U("photo-1478720568477-152d9b164e26"),
    U("photo-1489599849927-2ee91cede3ba"),
    U("photo-1500462918059-b1a0cb512f1d"),
    U("photo-1518676590629-3dcbd9c28b28"),
    U("photo-1492691527719-9d1e07e534b4"),
  ],
};

const DEFAULT = SETS.filmgrab;

/** Prefer live mirror previews; fall back to per-source illustrative stills when empty. */
export function resolveArchivePreviewUrls(
  key: string | undefined,
  liveUrls: string[] | undefined
): { urls: string[]; illustrative: boolean; bundled: string[] } {
  const live = (liveUrls || []).filter(Boolean);
  const k = (key || "").toLowerCase();
  // Offline-safe images the card can swap to if a remote URL fails to load.
  const bundled = bundledSlice(k || "default");
  if (live.length > 0) return { urls: live.slice(0, 6), illustrative: false, bundled };
  const set = SETS[k] || DEFAULT;
  // Wikimedia / IA sets are real archive imagery even without a local mirror
  const illustrative = !(k === "wikimedia-film" || k === "internet-archive-film");
  return { urls: set.slice(0, 6), illustrative, bundled };
}

/** Bundled PD stills for a source — always available, no network required. */
export function bundledArchivePreviewUrls(key: string | undefined, count = 6): string[] {
  return bundledSlice((key || "default").toLowerCase(), count);
}
