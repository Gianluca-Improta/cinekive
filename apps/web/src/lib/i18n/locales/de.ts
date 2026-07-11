import type { MessageTree } from "../types";

const de: MessageTree = {
  brand: { tagline: "Lokales filmisches Archiv" },
  nav: {
    narrative: "Narrativ",
    commercial: "Werbung",
    social: "Social Media",
    archives: "Archive",
    discovery: "Entdecken",
    favorites: "Favoriten",
    bin: "Papierkorb",
  },
  discovery: {
    title: "Entdecken",
    searchPlaceholder: "Film, Technik, Stimmung suchenâ€¦ (âŒ˜K)",
    loading: "Lade Shotsâ€¦",
  },
  favorites: { title: "Favoriten", empty: "Noch keine Favoriten", loading: "Lade Favoritenâ€¦" },
  detail: {
    title: "Shot-Details",
    connections: "Verbindungen",
    translate: "Ãœbersetzen",
    showOriginal: "Original zeigen",
    translating: "Ãœbersetzeâ€¦",
    save: "Speichern",
  },
  language: {
    label: "Sprache",
    core: "Kern: Englisch",
    autoTranslate: "Inhalt Ã¼bersetzen",
  },
  common: { create: "Erstellen", cancel: "Abbrechen", delete: "LÃ¶schen", close: "SchlieÃŸen" },
  filters: { dialIn: "Filter", composition: "Komposition", favoritesOnly: "Nur Favoriten" },
  archives: { title: "Archive", newArchive: "Neues Archiv" },
};

export default de;
