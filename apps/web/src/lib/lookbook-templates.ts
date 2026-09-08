/** Named moodboard layouts applied into CanvasDoc (client-side lookbook templates). */

import {
  emptyCanvasDoc,
  type CanvasDoc,
  type CanvasGroup,
  type CanvasPos,
  type CanvasSticky,
  type CanvasText,
} from "@/lib/canvas-types";

export type LookbookTemplateId =
  | "commercial-mood"
  | "props-grid"
  | "locations-scout"
  | "wardrobe-look"
  | "client-lookbook"
  | "empty-lighting-grid"
  | "empty-character-grid"
  | "empty-hero-alts";

export type LookbookTemplate = {
  id: LookbookTemplateId;
  label: string;
  hint: string;
  /** Project kinds this template suits best (empty = general). */
  projectKinds: string[];
  /** True when template creates labeled empty slots (no shots required). */
  emptySlots?: boolean;
};

export const LOOKBOOK_TEMPLATES: LookbookTemplate[] = [
  {
    id: "commercial-mood",
    label: "Commercial mood",
    hint: "Title + 3×3 grid + sticky notes",
    projectKinds: ["commercial", "general", "social", "stills", "video", "mixed"],
  },
  {
    id: "props-grid",
    label: "Props grid",
    hint: "Dense grid with a Hero props group",
    projectKinds: ["props", "stills", "mixed", "commercial"],
  },
  {
    id: "locations-scout",
    label: "Locations scout",
    hint: "Wide frames in landscape rows",
    projectKinds: ["locations", "stills", "video", "mixed", "narrative"],
  },
  {
    id: "wardrobe-look",
    label: "Wardrobe looks",
    hint: "Two columns — Look A / Look B",
    projectKinds: ["wardrobe", "stills", "mixed", "commercial"],
  },
  {
    id: "client-lookbook",
    label: "Client lookbook",
    hint: "Print-friendly title + padded grid",
    projectKinds: [
      "commercial",
      "narrative",
      "social",
      "stills",
      "video",
      "mixed",
      "props",
      "locations",
      "wardrobe",
    ],
  },
  {
    id: "empty-lighting-grid",
    label: "Lighting grid (empty)",
    hint: "3×3 labeled empty slots — drop frames later",
    projectKinds: ["commercial", "narrative", "video", "mixed", "general"],
    emptySlots: true,
  },
  {
    id: "empty-character-grid",
    label: "Character grid (empty)",
    hint: "2×4 empty slots for cast / looks",
    projectKinds: ["narrative", "commercial", "wardrobe", "mixed"],
    emptySlots: true,
  },
  {
    id: "empty-hero-alts",
    label: "Hero + alts (empty)",
    hint: "One hero slot + six alternatives",
    projectKinds: ["commercial", "social", "stills", "mixed", "general"],
    emptySlots: true,
  },
];

const DEFAULT_W = 220;
const ORIGIN_X = 10000 - 720;
const ORIGIN_Y = 10000 - 420;

function uid(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function placeGrid(
  shotIds: string[],
  opts: {
    cols: number;
    cellW: number;
    gapX: number;
    gapY: number;
    originX: number;
    originY: number;
  }
): Record<string, CanvasPos> {
  const positions: Record<string, CanvasPos> = {};
  shotIds.forEach((id, i) => {
    const col = i % opts.cols;
    const row = Math.floor(i / opts.cols);
    positions[id] = {
      x: opts.originX + col * (opts.cellW + opts.gapX),
      y: opts.originY + row * opts.gapY,
      w: opts.cellW,
    };
  });
  return positions;
}

function boundsOf(positions: Record<string, CanvasPos>): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const vals = Object.values(positions);
  if (!vals.length) {
    return { minX: ORIGIN_X, minY: ORIGIN_Y, maxX: ORIGIN_X + 800, maxY: ORIGIN_Y + 400 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of vals) {
    const h = p.w * 0.62;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.w);
    maxY = Math.max(maxY, p.y + h);
  }
  return { minX, minY, maxX, maxY };
}

export function suggestedTemplateId(projectKind?: string | null): LookbookTemplateId {
  const k = (projectKind || "").toLowerCase();
  if (k === "props") return "props-grid";
  if (k === "locations") return "locations-scout";
  if (k === "wardrobe") return "wardrobe-look";
  if (k === "narrative" || k === "video") return "client-lookbook";
  if (k === "social" || k === "stills" || k === "mixed") return "commercial-mood";
  return "commercial-mood";
}

export function applyEmptySlotTemplate(
  templateId: LookbookTemplateId,
  opts?: { boardTitle?: string; view?: CanvasDoc["view"] }
): CanvasDoc {
  const title = (opts?.boardTitle || "Board").trim() || "Board";
  const base = emptyCanvasDoc();
  if (opts?.view) base.view = { ...opts.view };

  const texts: CanvasText[] = [];
  const groups: CanvasGroup[] = [];
  const notes: CanvasSticky[] = [];

  const slot = (label: string, col: number, row: number, cellW: number, gapX: number, gapY: number) => {
    const x = ORIGIN_X + col * (cellW + gapX);
    const y = ORIGIN_Y + row * gapY;
    const h = cellW * 0.62;
    groups.push({
      id: uid("grp"),
      label,
      x,
      y,
      w: cellW,
      h: h + 28,
      shotIds: [],
    });
    texts.push({
      id: uid("tx"),
      x: x + 10,
      y: y + h / 2 - 8,
      w: cellW - 20,
      text: label,
      style: "label",
      align: "center",
      color: "#8B98A8",
    });
  };

  texts.push({
    id: uid("tx"),
    x: ORIGIN_X,
    y: ORIGIN_Y - 70,
    w: 520,
    text: title,
    style: "title",
  });

  switch (templateId) {
    case "empty-character-grid": {
      texts[0].text = title || "Characters";
      for (let i = 0; i < 8; i++) {
        slot(`Char ${i + 1}`, i % 4, Math.floor(i / 4), 200, 36, 170);
      }
      break;
    }
    case "empty-hero-alts": {
      texts[0].text = title || "Hero + alts";
      slot("Hero", 0, 0, 320, 40, 220);
      for (let i = 0; i < 6; i++) {
        slot(`Alt ${i + 1}`, 1 + (i % 3), Math.floor(i / 3), 200, 32, 170);
      }
      notes.push({
        id: uid("note"),
        x: ORIGIN_X + 760,
        y: ORIGIN_Y - 40,
        w: 200,
        text: "Drop frames into slots…",
      });
      break;
    }
    case "empty-lighting-grid":
    default: {
      texts[0].text = title || "Lighting";
      const labels = [
        "Key",
        "Fill",
        "Rim",
        "Practical",
        "Motivated",
        "Ambient",
        "Night",
        "Day",
        "Special",
      ];
      labels.forEach((label, i) => {
        slot(label, i % 3, Math.floor(i / 3), DEFAULT_W, 40, 180);
      });
      break;
    }
  }

  return {
    ...base,
    positions: {},
    texts,
    notes,
    groups,
    edges: [],
    media: [],
    stacks: [],
  };
}

export function applyLookbookTemplate(
  shotIds: string[],
  templateId: LookbookTemplateId,
  opts?: { boardTitle?: string; view?: CanvasDoc["view"] }
): CanvasDoc {
  const emptyMeta = LOOKBOOK_TEMPLATES.find((t) => t.id === templateId);
  if (emptyMeta?.emptySlots) {
    return applyEmptySlotTemplate(templateId, opts);
  }

  const ids = [...shotIds];
  const title = (opts?.boardTitle || "Lookbook").trim() || "Lookbook";
  const base = emptyCanvasDoc();
  if (opts?.view) base.view = { ...opts.view };

  let positions: Record<string, CanvasPos> = {};
  const texts: CanvasText[] = [];
  const notes: CanvasSticky[] = [];
  const groups: CanvasGroup[] = [];

  switch (templateId) {
    case "props-grid": {
      texts.push({
        id: uid("tx"),
        x: ORIGIN_X,
        y: ORIGIN_Y - 70,
        w: 480,
        text: title || "Props",
        style: "title",
      });
      positions = placeGrid(ids, {
        cols: 5,
        cellW: 180,
        gapX: 28,
        gapY: 150,
        originX: ORIGIN_X,
        originY: ORIGIN_Y,
      });
      const hero = ids.slice(0, Math.min(6, ids.length));
      if (hero.length >= 2) {
        const b = boundsOf(
          Object.fromEntries(hero.map((id) => [id, positions[id]]).filter(([, p]) => p))
        );
        groups.push({
          id: uid("grp"),
          label: "Hero props",
          x: b.minX - 24,
          y: b.minY - 36,
          w: Math.max(280, b.maxX - b.minX + 48),
          h: Math.max(160, b.maxY - b.minY + 56),
          shotIds: hero,
        });
      }
      break;
    }
    case "locations-scout": {
      texts.push({
        id: uid("tx"),
        x: ORIGIN_X,
        y: ORIGIN_Y - 70,
        w: 520,
        text: title || "Locations",
        style: "title",
      });
      positions = placeGrid(ids, {
        cols: 3,
        cellW: 280,
        gapX: 36,
        gapY: 200,
        originX: ORIGIN_X,
        originY: ORIGIN_Y,
      });
      notes.push({
        id: uid("note"),
        x: ORIGIN_X + 920,
        y: ORIGIN_Y - 40,
        w: 200,
        text: "Scout notes…",
      });
      break;
    }
    case "wardrobe-look": {
      texts.push({
        id: uid("tx"),
        x: ORIGIN_X,
        y: ORIGIN_Y - 70,
        w: 480,
        text: title || "Wardrobe",
        style: "title",
      });
      const mid = Math.ceil(ids.length / 2);
      const lookA = ids.slice(0, mid);
      const lookB = ids.slice(mid);
      const left = placeGrid(lookA, {
        cols: 2,
        cellW: DEFAULT_W,
        gapX: 32,
        gapY: 170,
        originX: ORIGIN_X,
        originY: ORIGIN_Y,
      });
      const right = placeGrid(lookB, {
        cols: 2,
        cellW: DEFAULT_W,
        gapX: 32,
        gapY: 170,
        originX: ORIGIN_X + 560,
        originY: ORIGIN_Y,
      });
      positions = { ...left, ...right };
      if (lookA.length) {
        const b = boundsOf(left);
        groups.push({
          id: uid("grp"),
          label: "Look A",
          x: b.minX - 24,
          y: b.minY - 36,
          w: Math.max(260, b.maxX - b.minX + 48),
          h: Math.max(160, b.maxY - b.minY + 56),
          shotIds: lookA,
        });
      }
      if (lookB.length) {
        const b = boundsOf(right);
        groups.push({
          id: uid("grp"),
          label: "Look B",
          x: b.minX - 24,
          y: b.minY - 36,
          w: Math.max(260, b.maxX - b.minX + 48),
          h: Math.max(160, b.maxY - b.minY + 56),
          shotIds: lookB,
        });
      }
      break;
    }
    case "client-lookbook": {
      texts.push(
        {
          id: uid("tx"),
          x: ORIGIN_X,
          y: ORIGIN_Y - 110,
          w: 640,
          text: title,
          style: "title",
        },
        {
          id: uid("tx"),
          x: ORIGIN_X,
          y: ORIGIN_Y - 55,
          w: 640,
          text: "Visual references for review",
          style: "body",
        }
      );
      positions = placeGrid(ids, {
        cols: 4,
        cellW: 200,
        gapX: 40,
        gapY: 170,
        originX: ORIGIN_X,
        originY: ORIGIN_Y + 20,
      });
      break;
    }
    case "commercial-mood":
    default: {
      texts.push({
        id: uid("tx"),
        x: ORIGIN_X,
        y: ORIGIN_Y - 70,
        w: 520,
        text: title,
        style: "title",
      });
      positions = placeGrid(ids, {
        cols: 3,
        cellW: DEFAULT_W,
        gapX: 40,
        gapY: 180,
        originX: ORIGIN_X,
        originY: ORIGIN_Y,
      });
      notes.push({
        id: uid("note"),
        x: ORIGIN_X + 760,
        y: ORIGIN_Y - 40,
        w: 200,
        text: "Direction / notes…",
      });
      break;
    }
  }

  return {
    ...base,
    positions,
    texts,
    notes,
    groups,
    edges: [],
    media: [],
    stacks: [],
  };
}
