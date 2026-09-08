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
  /** Sticky tint — Obsidian-style color options */
  color?: "yellow" | "pink" | "blue" | "green" | "slate";
  z?: number;
};

/** Image family presets — Auto picks local/cloud; named families map to checkpoints. */
export type CanvasImageFamily = "auto" | "sd" | "flux1" | "qwen-image";
/** How tightly to match the linked reference still. */
export type CanvasLookStrength = "soft" | "balanced" | "close";

/** Pro generate node — refs via edges to shots; Run → new still on board. */
export type CanvasGenNode = {
  id: string;
  x: number;
  y: number;
  w: number;
  prompt: string;
  status?: "idle" | "running" | "done" | "error";
  jobId?: string | null;
  resultShotId?: string | null;
  error?: string | null;
  /** Image backend override — auto uses Settings. */
  backend?: "auto" | "a1111" | "comfyui" | "cloud";
  /** Prefer family over raw checkpoint ids in the UI. */
  family?: CanvasImageFamily;
  /** Soft / balanced / close → denoising strength. */
  look?: CanvasLookStrength;
  /** @deprecated prefer family */
  model?: string;
  /** @deprecated prefer look */
  strength?: number;
  size?: "1024" | "1280" | "1536";
  /** Output aspect ratio hint (UI + prompt context). */
  aspect?: "16:9" | "9:16" | "1:1" | "4:3" | "21:9";
  /** Quality → size: low/1024, standard/1280, high/1536. */
  quality?: "low" | "standard" | "high";
  /** Variant count (UI for now). */
  variants?: 1 | 2 | 4;
  /** Optional shot-type hint prepended into the run prompt. */
  shotHint?: string;
  /** Optional camera-angle hint prepended into the run prompt. */
  angleHint?: string;
};

/** Clean title / concept label (not a sticky). */
export type CanvasText = {
  id: string;
  x: number;
  y: number;
  w: number;
  text: string;
  style: "title" | "heading" | "body" | "caption" | "label";
  z?: number;
  fontSize?: number;
  align?: "left" | "center" | "right";
  color?: string;
  weight?: "normal" | "medium" | "bold";
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

export type CaptionField =
  | "title"
  | "shot_type"
  | "technique"
  | "timecode"
  | "mood"
  | "composition"
  | "lens"
  | "camera"
  | "lighting";

export type CanvasTheme = {
  bg: string;
  accent: string;
  cardRadius: number;
  showCaptions: boolean;
  /** White/accent frame around stills — off by default (cleaner board). */
  showFrameBorder?: boolean;
  /** Soft pastel stickies vs quiet dark notes. */
  stickyStyle?: "pastel" | "quiet";
  captionFields: CaptionField[];
  exportTitleColor?: string;
  exportMutedColor?: string;
};

/**
 * Commercial shotlist row — mirrors 070425_shotlist_Template.xlsx columns.
 * Kept CSV-friendly for paste / export.
 */
export type CanvasShotlistRow = {
  id: string;
  shotId?: string | null;
  done?: boolean;
  setupNumber: string;
  number: string;
  subject: string;
  description: string;
  reference: string;
  shotSizeStart: string;
  shotSizeEnd: string;
  angleStart: string;
  angleEnd: string;
  moveStart: string;
  moveEnd: string;
  composition: string;
  dialogVo: string;
  soundDesign: string;
  scriptTimeSec: string;
  /** Legacy aliases kept for older boards */
  shotType?: string;
  notes?: string;
};

export type CanvasDoc = {
  positions: Record<string, CanvasPos>;
  groups: CanvasGroup[];
  edges: CanvasEdge[];
  notes: CanvasSticky[];
  texts: CanvasText[];
  media: CanvasMedia[];
  stacks: CanvasStack[];
  gens: CanvasGenNode[];
  view: { x: number; y: number; scale: number };
  theme?: CanvasTheme;
  shotlist?: CanvasShotlistRow[];
};

export const CANVAS_SHOT_MIME = "application/x-cinekive-shot";

export const DEFAULT_CAPTION_FIELDS: CaptionField[] = ["title", "shot_type", "technique"];

export const SHOTLIST_CSV_HEADERS = [
  "Done",
  "Setup #",
  "Shot #",
  "Subject",
  "Shot Description",
  "Reference",
  "Shot Size Start",
  "Shot Size End",
  "Angle Start",
  "Angle End",
  "Camera Movement Start",
  "Camera Movement End",
  "Composition",
  "Dialog/VO",
  "Sound Design",
  "Script Time (Seconds)",
] as const;

export function emptyShotlistRow(partial?: Partial<CanvasShotlistRow>): CanvasShotlistRow {
  return {
    id: crypto.randomUUID?.() || `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    shotId: null,
    done: false,
    setupNumber: "",
    number: "",
    subject: "",
    description: "",
    reference: "",
    shotSizeStart: "",
    shotSizeEnd: "",
    angleStart: "",
    angleEnd: "",
    moveStart: "",
    moveEnd: "",
    composition: "",
    dialogVo: "",
    soundDesign: "",
    scriptTimeSec: "",
    shotType: "",
    notes: "",
    ...partial,
  };
}

export function normalizeShotlistRow(raw: Partial<CanvasShotlistRow> | null | undefined): CanvasShotlistRow {
  const base = emptyShotlistRow();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    id: raw.id || base.id,
    done: Boolean(raw.done),
    setupNumber: raw.setupNumber ?? "",
    number: raw.number ?? "",
    subject: raw.subject ?? "",
    description: raw.description ?? raw.notes ?? "",
    reference: raw.reference ?? "",
    shotSizeStart: raw.shotSizeStart ?? raw.shotType ?? "",
    shotSizeEnd: raw.shotSizeEnd ?? "",
    angleStart: raw.angleStart ?? "",
    angleEnd: raw.angleEnd ?? "",
    moveStart: raw.moveStart ?? "",
    moveEnd: raw.moveEnd ?? "",
    composition: raw.composition ?? "",
    dialogVo: raw.dialogVo ?? "",
    soundDesign: raw.soundDesign ?? "",
    scriptTimeSec: raw.scriptTimeSec ?? "",
    shotId: raw.shotId ?? null,
  };
}

export function defaultCanvasTheme(): CanvasTheme {
  return {
    bg: "#111111",
    accent: "#66FCF1",
    cardRadius: 6,
    showCaptions: false,
    showFrameBorder: false,
    stickyStyle: "quiet",
    captionFields: [...DEFAULT_CAPTION_FIELDS],
    exportTitleColor: "#66FCF1",
    exportMutedColor: "#8B98A8",
  };
}

export function emptyCanvasDoc(): CanvasDoc {
  return {
    positions: {},
    groups: [],
    edges: [],
    notes: [],
    texts: [],
    media: [],
    stacks: [],
    gens: [],
    view: { x: 0, y: 0, scale: 0.45 },
    theme: defaultCanvasTheme(),
    shotlist: [],
  };
}

export function normalizeCanvasDoc(raw: Partial<CanvasDoc> | null | undefined): CanvasDoc {
  const base = emptyCanvasDoc();
  if (!raw || typeof raw !== "object") return base;
  const theme = { ...defaultCanvasTheme(), ...(raw.theme || {}) };
  if (!Array.isArray(theme.captionFields) || !theme.captionFields.length) {
    theme.captionFields = [...DEFAULT_CAPTION_FIELDS];
  }
  if (theme.showFrameBorder == null) theme.showFrameBorder = false;
  if (!theme.stickyStyle) theme.stickyStyle = "quiet";
  return {
    positions: raw.positions || {},
    groups: raw.groups || [],
    edges: raw.edges || [],
    notes: raw.notes || [],
    texts: raw.texts || [],
    media: raw.media || [],
    stacks: raw.stacks || [],
    gens: Array.isArray(raw.gens) ? raw.gens : [],
    view: raw.view || base.view,
    theme,
    shotlist: Array.isArray(raw.shotlist)
      ? raw.shotlist.map((r) => normalizeShotlistRow(r))
      : [],
  };
}

/** True when id is a generate node (not a shot UUID on the board). */
export function isGenNodeId(id: string): boolean {
  return id.startsWith("gen-");
}

export function isNoteId(id: string): boolean {
  return id.startsWith("note:");
}
export function isTextId(id: string): boolean {
  return id.startsWith("text:");
}
export function isMediaId(id: string): boolean {
  return id.startsWith("media:");
}
export function isStackId(id: string): boolean {
  return id.startsWith("stack:");
}
