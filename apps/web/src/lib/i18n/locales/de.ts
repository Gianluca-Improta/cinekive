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
    searchPlaceholder: "Film, Technik, Stimmung suchen… (⌘K)",
    loading: "Lade Shots…",
  },
  favorites: { title: "Favoriten", empty: "Noch keine Favoriten", loading: "Lade Favoriten…" },
  detail: {
    title: "Shot-Details",
    connections: "Verbindungen",
    translate: "Übersetzen",
    showOriginal: "Original zeigen",
    translating: "Übersetze…",
    save: "Speichern",
  },
  language: {
    label: "Sprache",
    core: "Kern: Englisch",
    autoTranslate: "Inhalt übersetzen",
  },
  common: { create: "Erstellen", cancel: "Abbrechen", delete: "Löschen", close: "Schließen" },
  filters: { dialIn: "Filter", composition: "Komposition", favoritesOnly: "Nur Favoriten" },
  archives: { title: "Archive", newArchive: "Neues Archiv" },
};

export default de;
