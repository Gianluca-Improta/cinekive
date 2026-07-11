/** Moodboard layout stored in collection.meta.canvas (+ localStorage mirror). */

export type CanvasPos = { x: number; y: number; w: number };

export type CanvasGroup = {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shotIds: string[];
};

export type CanvasEdge = { id: string; a: string; b: string };

export type CanvasSticky = {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
};

/** Clean title / concept label (not a sticky). */
export type CanvasText = {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  style: "title" | "body";
};

export type CanvasMedia = {
  id: string;
  x: number;
  y: number;
  w: number;
  kind: "audio" | "image" | "link";
  url: string;
  label: string;
};

/** Stacked pile of frames — one visual concept. */
export type CanvasStack = {
  id: string;
  x: number;
  y: number;
  w: number;
  label: string;
  shotIds: string[];
  activeIndex: number;
};

export type CanvasDoc = {
  positions: Record<string, CanvasPos>;
  groups: CanvasGroup[];
  edges: CanvasEdge[];
  notes: CanvasSticky[];
  texts: CanvasText[];
  media: CanvasMedia[];
  stacks: CanvasStack[];
  view: { x: number; y: number; scale: number };
};

export const CANVAS_SHOT_MIME = "application/x-cinekive-shot";

export function emptyCanvasDoc(): CanvasDoc {
  return {
    positions: {},
    groups: [],
    edges: [],
    notes: [],
    texts: [],
    media: [],
    stacks: [],
    view: { x: 0, y: 0, scale: 0.45 },
  };
}

export function normalizeCanvasDoc(raw: Partial<CanvasDoc> | null | undefined): CanvasDoc {
  const base = emptyCanvasDoc();
  if (!raw || typeof raw !== "object") return base;
  return {
    positions: raw.positions || {},
    groups: raw.groups || [],
    edges: raw.edges || [],
    notes: raw.notes || [],
    texts: raw.texts || [],
    media: raw.media || [],
    stacks: raw.stacks || [],
    view: raw.view || base.view,
  };
}
