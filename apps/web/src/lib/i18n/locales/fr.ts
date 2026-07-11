import type { MessageTree } from "../types";

/** Partial packs â€” missing keys fall back to English. */
const fr: MessageTree = {
  brand: { tagline: "Archive cinÃ©matographique locale" },
  nav: {
    narrative: "Narratif",
    commercial: "PublicitÃ©s",
    social: "RÃ©seaux sociaux",
    archives: "Archives",
    discovery: "DÃ©couvrir",
    favorites: "Favoris",
    bin: "Corbeille",
  },
  discovery: {
    title: "DÃ©couvrir",
    searchPlaceholder: "Chercher un film, une technique, une ambianceâ€¦ (âŒ˜K)",
    loading: "Chargementâ€¦",
  },
  favorites: { title: "Favoris", empty: "Pas encore de favoris", loading: "Chargementâ€¦" },
  detail: {
    title: "DÃ©tail du plan",
    connections: "Connexions",
    translate: "Traduire",
    showOriginal: "Voir lâ€™original",
    translating: "Traductionâ€¦",
    save: "Enregistrer",
  },
  language: {
    label: "Langue",
    core: "Noyau : anglais",
    autoTranslate: "Traduire le contenu",
  },
  common: { create: "CrÃ©er", cancel: "Annuler", delete: "Supprimer", close: "Fermer" },
  filters: { dialIn: "Filtres", composition: "Composition", favoritesOnly: "Favoris seulement" },
  archives: { title: "Archives", newArchive: "Nouvelle archive" },
};

export default fr;
