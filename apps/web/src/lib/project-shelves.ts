/** Project department shelves — built-ins + custom named collections. */

import type { Collection } from "@/lib/types";

export type BuiltinShelfKey =
  | "props"
  | "locations"
  | "wardrobe"
  | "characters"
  | "vehicles"
  | "vfx"
  | "look";

export type ShelfDef = {
  key: string;
  label: string;
  /** Shown in Visible tabs by default for new projects */
  defaultVisible?: boolean;
  builtin?: boolean;
  hint?: string;
};

/** Production DNA shelves most commercial / narrative boards need. */
export const BUILTIN_SHELVES: ShelfDef[] = [
  {
    key: "props",
    label: "Props",
    defaultVisible: true,
    builtin: true,
    hint: "Objects, product, hero props",
  },
  {
    key: "locations",
    label: "Locations",
    defaultVisible: true,
    builtin: true,
    hint: "Places, sets, environments",
  },
  {
    key: "wardrobe",
    label: "Wardrobe",
    defaultVisible: true,
    builtin: true,
    hint: "Costume, fabric, styling",
  },
  {
    key: "characters",
    label: "Characters",
    defaultVisible: false,
    builtin: true,
    hint: "Talent, faces, performance stills",
  },
  {
    key: "vehicles",
    label: "Vehicles",
    defaultVisible: false,
    builtin: true,
    hint: "Cars, bikes, aircraft",
  },
  {
    key: "vfx",
    label: "VFX",
    defaultVisible: false,
    builtin: true,
    hint: "Plates, comps, FX refs",
  },
  {
    key: "look",
    label: "Look",
    defaultVisible: false,
    builtin: true,
    hint: "Grade, palette, lighting refs",
  },
];

export const DEFAULT_VISIBLE_TAB_IDS: string[] = [
  "all",
  "props",
  "locations",
  "wardrobe",
  "moodboard",
];

export function shelfKeyOf(c: Collection): string {
  const meta = (c.meta || {}) as { shelf?: string; custom?: boolean };
  const key = String(meta.shelf || "").toLowerCase().trim();
  if (key && key !== "custom") return key;
  // Custom shelves are keyed by collection id so names can collide safely
  if (meta.custom || key === "custom") return `c:${c.id}`;
  return c.name.toLowerCase().trim() || c.id;
}

export function shelfLabel(c: Collection): string {
  return c.name || "Shelf";
}

export function isCustomShelfKey(key: string): boolean {
  return key.startsWith("c:");
}

export function collectionIdFromTab(tab: string, byKey: Map<string, Collection>): string | null {
  if (tab === "all" || tab === "moodboard") return null;
  const hit = byKey.get(tab);
  return hit?.id || null;
}

export function slugifyShelfName(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shelf"
  );
}
