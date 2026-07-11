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
    settings: "Einstellungen",
  },
  topbar: {
    ingest: "Import",
    refresh: "Aktualisieren",
    tour: "Tour",
    appearance: "Darstellung",
    themeDark: "Dunkel",
    themeLight: "Hell",
    themeSlate: "Schiefer",
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
    core: "Fehlende Schlüssel fallen auf Englisch zurück",
    autoTranslate: "Inhalt übersetzen",
    sectionHint: "UI-Sprache. Shot-Text kann separat übersetzt werden.",
  },
  common: {
    create: "Erstellen",
    cancel: "Abbrechen",
    delete: "Löschen",
    close: "Schließen",
    next: "Weiter",
    back: "Zurück",
    skip: "Überspringen",
  },
  filters: { dialIn: "Filter", composition: "Komposition", favoritesOnly: "Nur Favoriten" },
  archives: { title: "Archive", newArchive: "Neues Archiv" },
  bin: { title: "Papierkorb", restore: "Wiederherstellen", deleteForever: "Endgültig löschen" },
  settings: { title: "Einstellungen", appearance: "Darstellung", language: "Sprache" },
  tour: { label: "Tour", skip: "Überspringen", next: "Weiter", finish: "Loslegen" },
};

export default de;
