import type { MessageTree } from "../types";

/** Partial packs — missing keys fall back to English. */
const fr: MessageTree = {
  brand: { tagline: "Archive cinématographique locale" },
  nav: {
    narrative: "Narratif",
    commercial: "Publicités",
    social: "Réseaux sociaux",
    archives: "Archives",
    discovery: "Découvrir",
    favorites: "Favoris",
    bin: "Corbeille",
    settings: "Réglages",
  },
  topbar: {
    ingest: "Importer",
    refresh: "Actualiser",
    tour: "Visite",
    appearance: "Apparence",
    themeDark: "Sombre",
    themeLight: "Clair",
    themeSlate: "Ardoise",
  },
  discovery: {
    title: "Découvrir",
    searchPlaceholder: "Chercher un film, une technique, une ambiance… (⌘K)",
    loading: "Chargement…",
  },
  favorites: { title: "Favoris", empty: "Pas encore de favoris", loading: "Chargement…" },
  detail: {
    title: "Détail du plan",
    connections: "Connexions",
    translate: "Traduire",
    showOriginal: "Voir l’original",
    translating: "Traduction…",
    save: "Enregistrer",
  },
  language: {
    label: "Langue",
    core: "Les clés manquantes reviennent à l’anglais",
    autoTranslate: "Traduire le contenu",
    sectionHint: "Langue de l’interface. Le texte des plans se traduit à part.",
  },
  common: {
    create: "Créer",
    cancel: "Annuler",
    delete: "Supprimer",
    close: "Fermer",
    next: "Suivant",
    back: "Retour",
    skip: "Passer",
  },
  filters: { dialIn: "Filtres", composition: "Composition", favoritesOnly: "Favoris seulement" },
  archives: { title: "Archives", newArchive: "Nouvelle archive" },
  bin: { title: "Corbeille", restore: "Restaurer", deleteForever: "Supprimer définitivement" },
  settings: { title: "Réglages", appearance: "Apparence", language: "Langue" },
  tour: { label: "Visite", skip: "Passer", next: "Suivant", finish: "Commencer" },
};

export default fr;
