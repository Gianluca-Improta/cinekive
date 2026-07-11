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
    core: "Noyau : anglais",
    autoTranslate: "Traduire le contenu",
  },
  common: { create: "Créer", cancel: "Annuler", delete: "Supprimer", close: "Fermer" },
  filters: { dialIn: "Filtres", composition: "Composition", favoritesOnly: "Favoris seulement" },
  archives: { title: "Archives", newArchive: "Nouvelle archive" },
};

export default fr;
