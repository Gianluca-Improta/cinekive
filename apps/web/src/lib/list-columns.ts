/** Configurable metadata columns for list / detail grid view. */

import type { Shot } from "@/lib/types";
import { formatTimecode } from "@/lib/utils";

export type ListColumnId =
  | "shot"
  | "comp"
  | "light"
  | "mood"
  | "tech"
  | "era"
  | "tc"
  | "lens"
  | "cam"
  | "move"
  | "format"
  | "grade"
  | "emotion"
  | "subject"
  | "origin"
  | "ism"
  | "director"
  | "style"
  | "aspect";

export type ListColumnDef = {
  id: ListColumnId;
  label: string;
  /** Short header for dense list */
  short: string;
  value: (shot: Shot) => string;
};

export const LIST_COLUMN_CATALOG: ListColumnDef[] = [
  { id: "shot", label: "Shot type", short: "Shot", value: (s) => s.shot_type || "—" },
  { id: "comp", label: "Composition", short: "Comp", value: (s) => s.composition || "—" },
  { id: "light", label: "Lighting", short: "Light", value: (s) => s.lighting_style || "—" },
  {
    id: "mood",
    label: "Mood",
    short: "Mood",
    value: (s) => s.mood_vibe || s.emotion || "—",
  },
  {
    id: "tech",
    label: "Technique",
    short: "Tech",
    value: (s) => s.techniques?.[0] || "—",
  },
  {
    id: "era",
    label: "Era / period",
    short: "Era",
    value: (s) => s.era || s.ism || "—",
  },
  {
    id: "tc",
    label: "Timecode",
    short: "TC",
    value: (s) => formatTimecode(s.start_timecode_ms) || "—",
  },
  { id: "lens", label: "Lens look", short: "Lens", value: (s) => s.lens_look || "—" },
  { id: "cam", label: "Camera angle", short: "Cam", value: (s) => s.camera_angle || "—" },
  {
    id: "move",
    label: "Camera move",
    short: "Move",
    value: (s) => s.camera_movement || "—",
  },
  {
    id: "format",
    label: "Format",
    short: "Format",
    value: (s) => s.content_format || "—",
  },
  { id: "grade", label: "Color grade", short: "Grade", value: (s) => s.color_grade || "—" },
  { id: "emotion", label: "Emotion", short: "Emotion", value: (s) => s.emotion || "—" },
  { id: "subject", label: "Subject", short: "Subject", value: (s) => s.subject || "—" },
  { id: "origin", label: "Origin", short: "Origin", value: (s) => s.origin || "—" },
  { id: "ism", label: "Ism", short: "Ism", value: (s) => s.ism || "—" },
  {
    id: "director",
    label: "Director",
    short: "Dir",
    value: (s) =>
      s.director ||
      (typeof s.source_meta?.director === "string" ? s.source_meta.director : "") ||
      "—",
  },
  {
    id: "style",
    label: "Visual style",
    short: "Style",
    value: (s) => s.visual_style || "—",
  },
  {
    id: "aspect",
    label: "Aspect",
    short: "Aspect",
    value: (s) => {
      if (!s.width || !s.height) return "—";
      const r = s.width / Math.max(s.height, 1);
      if (r >= 2.2) return "21:9";
      if (r >= 1.7) return "16:9";
      if (r >= 1.4) return "3:2";
      if (r >= 1.2) return "4:3";
      if (r >= 0.9) return "1:1";
      if (r >= 0.7) return "3:4";
      return "9:16";
    },
  },
];

export const DEFAULT_LIST_COLUMNS: ListColumnId[] = [
  "shot",
  "comp",
  "light",
  "mood",
  "tech",
  "era",
  "tc",
];

const STORAGE_KEY = "cinekive.listColumns.v1";

export function loadListColumns(): ListColumnId[] {
  if (typeof window === "undefined") return [...DEFAULT_LIST_COLUMNS];
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as string[] | null;
    if (!Array.isArray(raw) || !raw.length) return [...DEFAULT_LIST_COLUMNS];
    const valid = new Set(LIST_COLUMN_CATALOG.map((c) => c.id));
    const next = raw.filter((id): id is ListColumnId => valid.has(id as ListColumnId));
    return next.length ? next : [...DEFAULT_LIST_COLUMNS];
  } catch {
    return [...DEFAULT_LIST_COLUMNS];
  }
}

export function saveListColumns(ids: ListColumnId[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids.length ? ids : DEFAULT_LIST_COLUMNS));
  } catch {
    /* ignore */
  }
}

export function resolveListColumns(ids: ListColumnId[]): ListColumnDef[] {
  const map = new Map(LIST_COLUMN_CATALOG.map((c) => [c.id, c]));
  return ids.map((id) => map.get(id)).filter(Boolean) as ListColumnDef[];
}
