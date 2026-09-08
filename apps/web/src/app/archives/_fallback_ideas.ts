/** Shown when API suggestions are unavailable — keep in sync with sources_service.CATALOG_SUGGESTIONS. */
export const FALLBACK_IDEAS: {
  key: string;
  label: string;
  site_url: string;
  blurb: string;
  fit: string;
  kind: string;
  preview_urls?: string[];
}[] = [
  {
    key: "movie-screencaps",
    label: "Movie Screencaps",
    site_url: "https://movie-screencaps.com/",
    blurb: "Large free HD screencap archive by title — Blu-ray/DVD sourced frames.",
    fit: "Best free bulk browse after FilmGrab; selective saves into a custom archive.",
    kind: "free",
  },
  {
    key: "shotcafe",
    label: "SHOT.CAFE",
    site_url: "https://shot.cafe/",
    blurb: "Curated cinematography stills with color, composition, and crew tags.",
    fit: "Smaller craft-focused set; free to browse — check ToS before automating.",
    kind: "free",
  },
  {
    key: "evanerichards",
    label: "Evan Richards",
    site_url: "https://www.evanerichards.com/",
    blurb: "Long-running free cinematography stills blog — frames by film and DP.",
    fit: "Great reference (~100k+ grabs); prefer manual / selective saves.",
    kind: "free",
  },
  {
    key: "bluscreens",
    label: "BluScreens",
    site_url: "https://www.bluscreens.net/",
    blurb: "High-res Blu-ray screen captures organized by title.",
    fit: "Manual / selective; fragile fan sites — don't bulk-hammer.",
    kind: "free",
  },
  {
    key: "homeofthenutty",
    label: "Home of the Nutty",
    site_url: "https://www.homeofthenutty.com/",
    blurb: "Long-running free screencap galleries — large title coverage.",
    fit: "Browse + save into a custom archive; ToS-sensitive for scrapers.",
    kind: "free",
  },
  {
    key: "screencapped",
    label: "Screencapped.net",
    site_url: "https://screencapped.net/",
    blurb: "Non-profit high-quality screencaps and stills.",
    fit: "Free browse; selective ingest into your own archive folder.",
    kind: "free",
  },
  {
    key: "capsaholic",
    label: "Caps-a-holic",
    site_url: "https://caps-a-holic.com/",
    blurb: "Fan Blu-ray screen-capture galleries organized by title.",
    fit: "Manual / selective; many sister caps sites are fragile.",
    kind: "free",
  },
  {
    key: "wikimedia-film",
    label: "Wikimedia Commons (film)",
    site_url: "https://commons.wikimedia.org/wiki/Category:Films",
    blurb: "Public-domain and freely licensed film imagery, posters, production photos.",
    fit: "Truly free for many files — license varies per asset; check each file.",
    kind: "free",
  },
  {
    key: "internet-archive-film",
    label: "Internet Archive (movies)",
    site_url: "https://archive.org/details/movies",
    blurb: "Public-domain features and related media you can download legally.",
    fit: "Best for PD films; pair with your own frame extracts via Ingest.",
    kind: "free",
  },
  {
    key: "frameset",
    label: "Frame Set",
    site_url: "https://frameset.app/",
    blurb: "Curated frames across film, ads, and music video — freemium search.",
    fit: "Inspiration / limited free searches; licensed exports only.",
    kind: "freemium",
  },
  {
    key: "flim",
    label: "Flim",
    site_url: "https://flim.ai/",
    blurb: "Large searchable movie / MV / ad shot database with AI filters.",
    fit: "Freemium daily searches; use custom archive for anything you license.",
    kind: "freemium",
  },
  {
    key: "seek-film",
    label: "Seek",
    site_url: "https://seek.film/",
    blurb: "1M+ stills searchable by mood, light, and composition.",
    fit: "Free tier + trial; not a mirror target — browse then save owned exports.",
    kind: "freemium",
  },
];
