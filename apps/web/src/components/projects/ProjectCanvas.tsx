"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Group,
  Layers,
  LayoutTemplate,
  Link2,
  Link as LinkIcon,
  Minus,
  Plus,
  Scan,
  StickyNote as StickyNoteIcon,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut,
  Download,
  FileImage,
  FileText,
  Crown,
  ClipboardCheck,
  Captions,
  Palette,
  Table2,
  Keyboard,
  Sparkles,
  Wand2,
} from "lucide-react";
import { api, artifactUrl } from "@/lib/api-client";
import { downloadBlob } from "@/lib/download";
import type { Shot } from "@/lib/types";
import {
  CANVAS_SHOT_MIME,
  defaultCanvasTheme,
  emptyCanvasDoc,
  isGenNodeId,
  isMediaId,
  isNoteId,
  isStackId,
  isTextId,
  normalizeCanvasDoc,
  type CaptionField,
  type CanvasDoc,
  type CanvasGenNode,
  type CanvasGroup,
  type CanvasMedia,
  type CanvasPos,
  type CanvasStack,
  type CanvasSticky,
  type CanvasText,
  type CanvasTheme,
} from "@/lib/canvas-types";
import { cn, formatTimecode } from "@/lib/utils";
import { CanvasShotRail } from "@/components/projects/CanvasShotRail";
import { CanvasMinimap } from "@/components/projects/CanvasMinimap";
import { CanvasShotlistPanel } from "@/components/projects/CanvasShotlistPanel";
import { CanvasFloatingToolbar } from "@/components/projects/CanvasFloatingToolbar";
import { exportBoardPdf, exportBoardPng, exportBoardHtml, exportApprovedBriefPackage } from "@/lib/board-export";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import { useJob } from "@/hooks/useJobs";
import {
  LOOKBOOK_TEMPLATES,
  applyLookbookTemplate,
  suggestedTemplateId,
  type LookbookTemplateId,
} from "@/lib/lookbook-templates";
import { clampScale, zoomAtFocal, rectsIntersect, type WorldRect } from "@/lib/canvas-nav";
import {
  DEFAULT_SHORTCUTS,
  loadShortcuts,
  matchShortcut,
  saveShortcuts,
  type CanvasShortcutMap,
} from "@/lib/canvas-prefs";
const STICKY_COLORS: Record<NonNullable<CanvasSticky["color"]>, string> = {
  yellow: "border-amber-400/35 bg-amber-100/95",
  pink: "border-pink-400/35 bg-pink-100/95",
  blue: "border-sky-400/35 bg-sky-100/95",
  green: "border-emerald-400/35 bg-emerald-100/95",
  slate: "border-slate-400/40 bg-slate-200/95",
};

/** Dark quiet stickies — default board look (pastel optional in Style). */
const STICKY_QUIET: Record<NonNullable<CanvasSticky["color"]>, string> = {
  yellow: "border-white/10 bg-zinc-900/95",
  pink: "border-rose-400/20 bg-zinc-900/95",
  blue: "border-sky-400/20 bg-zinc-900/95",
  green: "border-emerald-400/20 bg-zinc-900/95",
  slate: "border-white/15 bg-zinc-800/95",
};

const NOTE_H_APPROX = 120;
const MIN_FRAME_W = 120;
const MAX_FRAME_W = 520;

function snapshotDoc(d: CanvasDoc): CanvasDoc {
  return JSON.parse(JSON.stringify(d)) as CanvasDoc;
}

function isViewOnlyChange(prev: CanvasDoc, next: CanvasDoc): boolean {
  return (
    next.positions === prev.positions &&
    next.groups === prev.groups &&
    next.edges === prev.edges &&
    next.notes === prev.notes &&
    next.texts === prev.texts &&
    next.media === prev.media &&
    next.stacks === prev.stacks &&
    next.gens === prev.gens &&
    next.theme === prev.theme &&
    next.shotlist === prev.shotlist &&
    next.view !== prev.view
  );
}

type Props = {
  projectId: string;
  shots: Shot[];
  onSelect?: (shot: Shot) => void;
  /** Prefer this board when opening from Send to board */
  initialCollectionId?: string | null;
  /** Project kind — suggests a lookbook template (props / locations / wardrobe…) */
  projectKind?: string | null;
};

const CANVAS_W = 20000;
const CANVAS_H = 20000;
const DEFAULT_W = 220;
const MIN_SCALE = 0.08;
const MAX_SCALE = 2.5;

function storageKey(id: string) {
  return `cinekive.canvas.v2.${id}`;
}

function loadDocLocal(id: string): CanvasDoc {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return emptyCanvasDoc();
    return normalizeCanvasDoc(JSON.parse(raw) as Partial<CanvasDoc>);
  } catch {
    return emptyCanvasDoc();
  }
}

function docFromMeta(meta: Record<string, unknown> | undefined | null): CanvasDoc | null {
  const canvas = meta?.canvas as Partial<CanvasDoc> | undefined;
  if (!canvas || typeof canvas !== "object") return null;
  return normalizeCanvasDoc(canvas);
}

const GEN_NODE_H = 344;

const LOOK_STRENGTH: Record<"soft" | "balanced" | "close", number> = {
  soft: 0.35,
  balanced: 0.55,
  close: 0.75,
};

type PortSide = "left" | "right" | "top" | "bottom";

function portPoint(
  x: number,
  y: number,
  w: number,
  h: number,
  side: PortSide
): { x: number; y: number } {
  if (side === "left") return { x, y: y + h / 2 };
  if (side === "right") return { x: x + w, y: y + h / 2 };
  if (side === "top") return { x: x + w / 2, y };
  return { x: x + w / 2, y: y + h };
}

/** Pick out/in sides from relative node centers (Framechain-style). */
function pickPortSides(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number }
): { out: PortSide; inn: PortSide } {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { out: "right", inn: "left" } : { out: "left", inn: "right" };
  }
  return dy >= 0 ? { out: "bottom", inn: "top" } : { out: "top", inn: "bottom" };
}

function softCurve(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  outSide: PortSide = "right",
  inSide: PortSide = "left"
) {
  const dist = Math.hypot(bx - ax, by - ay);
  const pull = Math.max(24, Math.min(120, dist * 0.35));
  const offset = (side: PortSide, x: number, y: number) => {
    if (side === "left") return { x: x - pull, y };
    if (side === "right") return { x: x + pull, y };
    if (side === "top") return { x, y: y - pull };
    return { x, y: y + pull };
  };
  const c1 = offset(outSide, ax, ay);
  const c2 = offset(inSide, bx, by);
  return `M ${ax} ${ay} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${bx} ${by}`;
}

function portClass(side: PortSide, connected: boolean, ghost = true) {
  const base =
    "absolute z-20 rounded-full bg-cinema-cyan transition-opacity hover:opacity-90";
  const size = connected ? "h-2 w-2" : "h-1.5 w-1.5";
  const pos =
    side === "left"
      ? "left-[-3px] top-1/2 -translate-y-1/2"
      : side === "right"
        ? "right-[-3px] top-1/2 -translate-y-1/2"
        : side === "top"
          ? "left-1/2 top-[-3px] -translate-x-1/2"
          : "bottom-[-3px] left-1/2 -translate-x-1/2";
  const opacity = connected
    ? "opacity-90 shadow-[0_0_4px_rgba(94,234,212,0.7)]"
    : ghost
      ? "opacity-25 hover:opacity-60"
      : "opacity-40";
  return `${base} ${size} ${pos} ${opacity}`;
}

const TEXT_STYLE_DEFAULTS: Record<CanvasText["style"], number> = {
  title: 28,
  heading: 22,
  body: 14,
  caption: 11,
  label: 10,
};

export const OPEN_GENERATE_EVENT = "cinekive:open-generate";


function nodeBoxForId(
  id: string,
  doc: CanvasDoc,
  shotMap: Map<string, Shot>
): { x: number; y: number; w: number; h: number } | null {
  if (isGenNodeId(id)) {
    const g = (doc.gens || []).find((n) => n.id === id);
    if (!g) return null;
    return { x: g.x, y: g.y, w: g.w, h: GEN_NODE_H };
  }
  if (isTextId(id) || id.startsWith("text-")) {
    const tid = isTextId(id) ? id.slice(5) : id;
    const t = doc.texts.find((n) => n.id === tid);
    if (!t) return null;
    const h = t.style === "title" ? 40 : t.style === "caption" ? 28 : 72;
    return { x: t.x, y: t.y, w: t.w, h };
  }
  if (isNoteId(id) || id.startsWith("note-")) {
    const nid = isNoteId(id) ? id.slice(5) : id;
    const n = doc.notes.find((x) => x.id === nid);
    if (!n) return null;
    return { x: n.x, y: n.y, w: n.w, h: Math.max(80, n.w * 0.55) };
  }
  const pa = doc.positions[id];
  if (!pa && !shotMap.has(id)) return null;
  const pos = pa || ({ x: CANVAS_W / 2, y: CANVAS_H / 2, w: DEFAULT_W } as CanvasPos);
  return { x: pos.x, y: pos.y, w: pos.w, h: pos.w * 0.62 };
}

function viewportCenterWorld(view: CanvasDoc["view"], vp: DOMRect) {
  return {
    x: (vp.width / 2 - view.x) / view.scale,
    y: (vp.height / 2 - view.y) / view.scale,
  };
}

export function ProjectCanvas({
  projectId,
  shots,
  onSelect,
  initialCollectionId,
  projectKind,
}: Props) {
  const qc = useQueryClient();
  const canBoardExport = useHasFeature("board_export");
  const canGenerate = useHasFeature("image_generate");
  const viewportRef = useRef<HTMLDivElement>(null);
  const [exportBusy, setExportBusy] = useState<
    "png" | "pdf" | "brief" | "html" | "bundle" | "pdfin" | "bundlein" | null
  >(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [doc, setDoc] = useState<CanvasDoc>(emptyCanvasDoc());
  const [shotlistOpen, setShotlistOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState<CanvasShortcutMap>(DEFAULT_SHORTCUTS);
  const [createMenu, setCreateMenu] = useState<{
    screenX: number;
    screenY: number;
    worldX: number;
    worldY: number;
  } | null>(null);
  const [mediaAt, setMediaAt] = useState<{ x: number; y: number } | null>(null);
  const [activeGenJobId, setActiveGenJobId] = useState<string | null>(null);
  const [activeGenNodeId, setActiveGenNodeId] = useState<string | null>(null);
  const preGenShotIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    setShortcuts(loadShortcuts());
  }, []);

  const { data: activeGenJob } = useJob(activeGenJobId);

  const theme: CanvasTheme = useMemo(
    () => ({ ...defaultCanvasTheme(), ...(doc.theme || {}) }),
    [doc.theme]
  );

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(
    initialCollectionId || null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [pdfLayout, setPdfLayout] = useState<"board" | "contact" | "slides">("board");
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mediaForm, setMediaForm] = useState<"audio" | "image" | "link" | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaLabel, setMediaLabel] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingStackId, setEditingStackId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const [vpSize, setVpSize] = useState({ width: 900, height: 560 });
  const dragOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const panMovedRef = useRef(false);
  const spaceDown = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyRef = useRef<CanvasDoc[]>([]);
  const futureRef = useRef<CanvasDoc[]>([]);
  const historyArmedRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);
  const [resizing, setResizing] = useState<string | null>(null);
  const resizeStart = useRef({ w: DEFAULT_W, clientX: 0 });

  const { data: canvases = [] } = useQuery({
    queryKey: ["collections", "canvas", projectId],
    queryFn: () => api.listCollections({ project_id: projectId, kind: "canvas" }),
  });

  useEffect(() => {
    if (initialCollectionId) setActiveCanvasId(initialCollectionId);
  }, [initialCollectionId]);

  useEffect(() => {
    if (!canvases.length) {
      if (!initialCollectionId) setActiveCanvasId(null);
      return;
    }
    if (initialCollectionId && canvases.some((c) => c.id === initialCollectionId)) {
      setActiveCanvasId(initialCollectionId);
      return;
    }
    if (!activeCanvasId || !canvases.some((c) => c.id === activeCanvasId)) {
      setActiveCanvasId(canvases[0].id);
    }
  }, [canvases, activeCanvasId, initialCollectionId]);

  const canvas = canvases.find((c) => c.id === activeCanvasId) || canvases[0];

  const { data: detail } = useQuery({
    queryKey: ["collection", canvas?.id],
    queryFn: () => api.getCollection(canvas!.id),
    enabled: !!canvas?.id,
  });

  const canvasShots = detail?.shots ?? [];
  const shotMap = useMemo(() => new Map(canvasShots.map((s) => [s.id, s])), [canvasShots]);
  const onBoardIds = useMemo(() => new Set(canvasShots.map((s) => s.id)), [canvasShots]);
  const stackedShotIds = useMemo(() => {
    const ids = new Set<string>();
    for (const st of doc.stacks) for (const id of st.shotIds) ids.add(id);
    return ids;
  }, [doc.stacks]);

  const selectedText = useMemo(() => {
    for (const id of selectedIds) {
      if (!isTextId(id)) continue;
      const tid = id.slice(5);
      return doc.texts.find((t) => t.id === tid) || null;
    }
    return null;
  }, [selectedIds, doc.texts]);

  const persistLocal = useCallback((id: string, next: CanvasDoc) => {
    try {
      localStorage.setItem(storageKey(id), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const persistServer = useCallback((id: string, next: CanvasDoc) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void api.updateCollection(id, { meta: { canvas: next } }).catch(() => {});
    }, 600);
  }, []);

  const persist = useCallback(
    (next: CanvasDoc) => {
      if (!canvas) return;
      persistLocal(canvas.id, next);
      persistServer(canvas.id, next);
    },
    [canvas, persistLocal, persistServer]
  );

  const updateDoc = useCallback(
    (fn: (prev: CanvasDoc) => CanvasDoc) => {
      setDoc((prev) => {
        const next = fn(prev);
        if (next === prev) return prev;
        if (!isViewOnlyChange(prev, next) && !historyArmedRef.current) {
          historyArmedRef.current = true;
          historyRef.current = [
            ...historyRef.current.slice(-(40 - 1)),
            snapshotDoc(prev),
          ];
          futureRef.current = [];
          queueMicrotask(() => {
            historyArmedRef.current = false;
          });
          setHistoryTick((t) => t + 1);
        }
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const undo = useCallback(() => {
    const snap = historyRef.current.pop();
    if (!snap) return;
    setDoc((prev) => {
      futureRef.current = [...futureRef.current, snapshotDoc(prev)].slice(-40);
      persist(snap);
      return snap;
    });
    setHistoryTick((t) => t + 1);
  }, [persist]);

  const redo = useCallback(() => {
    const snap = futureRef.current.pop();
    if (!snap) return;
    setDoc((prev) => {
      historyRef.current = [...historyRef.current, snapshotDoc(prev)].slice(-40);
      persist(snap);
      return snap;
    });
    setHistoryTick((t) => t + 1);
  }, [persist]);

  const patchTheme = useCallback(
    (patch: Partial<CanvasTheme>) => {
      updateDoc((prev) => ({
        ...prev,
        theme: { ...defaultCanvasTheme(), ...(prev.theme || {}), ...patch },
      }));
    },
    [updateDoc]
  );

  const deleteSelection = useCallback(() => {
    if (!selectedIds.size && !selectedEdgeId) return;

    if (selectedEdgeId) {
      const edgeId = selectedEdgeId;
      updateDoc((prev) => ({
        ...prev,
        edges: prev.edges.filter((ed) => ed.id !== edgeId),
      }));
      setSelectedEdgeId(null);
      if (!selectedIds.size) return;
    }

    if (!selectedIds.size) return;
    const ids = [...selectedIds];
    const genIds = ids.filter((id) => isGenNodeId(id));
    const noteIds = ids.filter(isNoteId).map((id) => id.slice(5));
    const textIds = ids.filter(isTextId).map((id) => id.slice(5));
    const mediaIds = ids.filter(isMediaId).map((id) => id.slice(6));
    const stackIds = ids.filter(isStackId).map((id) => id.slice(6));
    const shotIds = ids.filter(
      (id) =>
        !isGenNodeId(id) &&
        !isNoteId(id) &&
        !isTextId(id) &&
        !isMediaId(id) &&
        !isStackId(id)
    );

    const hasBoardItems =
      genIds.length ||
      noteIds.length ||
      textIds.length ||
      mediaIds.length ||
      stackIds.length;

    if (hasBoardItems) {
      updateDoc((prev) => {
        let next: CanvasDoc = { ...prev };
        if (genIds.length) {
          next = {
            ...next,
            gens: (next.gens || []).filter((g) => !genIds.includes(g.id)),
            edges: next.edges.filter(
              (ed) => !genIds.includes(ed.a) && !genIds.includes(ed.b)
            ),
          };
        }
        if (noteIds.length) {
          next = { ...next, notes: next.notes.filter((n) => !noteIds.includes(n.id)) };
        }
        if (textIds.length) {
          next = { ...next, texts: next.texts.filter((t) => !textIds.includes(t.id)) };
        }
        if (mediaIds.length) {
          next = { ...next, media: next.media.filter((m) => !mediaIds.includes(m.id)) };
        }
        if (stackIds.length) {
          const positions = { ...next.positions };
          for (const st of next.stacks.filter((s) => stackIds.includes(s.id))) {
            st.shotIds.forEach((id, i) => {
              positions[id] = {
                x: st.x + i * 28,
                y: st.y + i * 18,
                w: st.w,
              };
            });
          }
          next = {
            ...next,
            stacks: next.stacks.filter((st) => !stackIds.includes(st.id)),
            positions,
          };
        }
        return next;
      });
    }

    const stripShotsFromDoc = (shotIdsToRemove: string[]) => {
      updateDoc((prev) => {
        const positions = { ...prev.positions };
        for (const id of shotIdsToRemove) delete positions[id];
        return {
          ...prev,
          positions,
          edges: prev.edges.filter(
            (ed) => !shotIdsToRemove.includes(ed.a) && !shotIdsToRemove.includes(ed.b)
          ),
          groups: prev.groups.map((g) => ({
            ...g,
            shotIds: g.shotIds.filter((id) => !shotIdsToRemove.includes(id)),
          })),
          stacks: prev.stacks
            .map((st) => ({
              ...st,
              shotIds: st.shotIds.filter((id) => !shotIdsToRemove.includes(id)),
            }))
            .filter((st) => st.shotIds.length > 0),
        };
      });
    };

    if (shotIds.length) {
      // Optimistic remove from board; sync collection when we have an id
      stripShotsFromDoc(shotIds);
      if (canvas?.id) {
        void api.removeFromCollection(canvas.id, shotIds).then(() => {
          qc.invalidateQueries({ queryKey: ["collection", canvas.id] });
        });
      }
    }
    setSelectedIds(new Set());
    setSelectedEdgeId(null);
  }, [selectedIds, selectedEdgeId, canvas?.id, qc, updateDoc]);

  const bringForward = useCallback(() => {
    if (!selectedIds.size) return;
    const z = Date.now();
    updateDoc((prev) => {
      let notes = prev.notes;
      let texts = prev.texts;
      let media = prev.media;
      for (const id of selectedIds) {
        if (isNoteId(id)) {
          const nid = id.slice(5);
          notes = notes.map((n) => (n.id === nid ? { ...n, z } : n));
        } else if (isTextId(id)) {
          const tid = id.slice(5);
          texts = texts.map((t) => (t.id === tid ? { ...t, z } : t));
        } else if (isMediaId(id)) {
          const mid = id.slice(6);
          const hit = media.find((m) => m.id === mid);
          if (hit) media = [...media.filter((m) => m.id !== mid), hit];
        }
      }
      return { ...prev, notes, texts, media };
    });
  }, [selectedIds, updateDoc]);

  const alignSelectedLeft = useCallback(() => {
    const ids = [...selectedIds].filter(
      (id) => !isGenNodeId(id) && !isNoteId(id) && !isTextId(id) && !isMediaId(id) && !isStackId(id)
    );
    if (ids.length < 2) return;
    let minX = Infinity;
    for (const id of ids) {
      const p = doc.positions[id];
      if (p) minX = Math.min(minX, p.x);
    }
    if (!Number.isFinite(minX)) return;
    updateDoc((prev) => {
      const positions = { ...prev.positions };
      for (const id of ids) {
        const p = positions[id];
        if (p) positions[id] = { ...p, x: minX };
      }
      return { ...prev, positions };
    });
  }, [selectedIds, doc.positions, updateDoc]);

  const rowSelectedShots = useCallback(() => {
    const ids = [...selectedIds].filter(
      (id) => !isGenNodeId(id) && !isNoteId(id) && !isTextId(id) && !isMediaId(id) && !isStackId(id)
    );
    if (ids.length < 2) return;
    const sorted = [...ids].sort((a, b) => {
      const pa = doc.positions[a];
      const pb = doc.positions[b];
      return (pa?.x ?? 0) - (pb?.x ?? 0);
    });
    const first = doc.positions[sorted[0]!];
    if (!first) return;
    const gap = 24;
    updateDoc((prev) => {
      const positions = { ...prev.positions };
      let x = first.x;
      const y = first.y;
      for (const id of sorted) {
        const p = positions[id] || { x: 0, y: 0, w: DEFAULT_W };
        positions[id] = { ...p, x, y };
        x += p.w + gap;
      }
      return { ...prev, positions };
    });
  }, [selectedIds, doc.positions, updateDoc]);

  const shotCaptionLines = useCallback(
    (shot: Shot): string[] => {
      const fields = theme.captionFields || [];
      const lines: string[] = [];
      for (const f of fields) {
        if (f === "title") {
          const t = shot.source_title || shot.source_filename;
          if (t) lines.push(String(t).slice(0, 42));
        } else if (f === "shot_type" && shot.shot_type) lines.push(shot.shot_type);
        else if (f === "technique" && shot.techniques?.[0]) lines.push(shot.techniques[0]);
        else if (f === "timecode") {
          const tc = formatTimecode(shot.start_timecode_ms);
          if (tc && tc !== "—") lines.push(tc);
        }         else if (f === "mood" && shot.mood_vibe) lines.push(shot.mood_vibe);
        else if (f === "composition" && shot.composition) lines.push(shot.composition);
        else if (f === "lens" && shot.lens_look) lines.push(shot.lens_look);
        else if (f === "camera" && (shot.camera_angle || shot.camera_movement)) {
          lines.push([shot.camera_angle, shot.camera_movement].filter(Boolean).join(" · "));
        } else if (f === "lighting" && shot.lighting_style) lines.push(shot.lighting_style);
      }
      return lines.slice(0, 3);
    },
    [theme.captionFields]
  );

  useEffect(() => {
    if (!canvas?.id) return;
    const fromServer = docFromMeta(detail?.meta as Record<string, unknown> | undefined);
    const fromLocal = loadDocLocal(canvas.id);
    const serverN = fromServer ? Object.keys(fromServer.positions).length : 0;
    const localN = Object.keys(fromLocal.positions).length;
    setDoc(serverN >= localN && fromServer ? fromServer : fromLocal);
    historyRef.current = [];
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, [canvas?.id, detail?.meta]);

  // Place any board shots that lack a position
  useEffect(() => {
    if (!canvasShots.length) return;
    const missing = canvasShots.filter((s) => !doc.positions[s.id] && !stackedShotIds.has(s.id));
    if (!missing.length) return;
    updateDoc((prev) => {
      const positions = { ...prev.positions };
      let placed = 0;
      for (const s of missing) {
        if (positions[s.id]) continue;
        const i = Object.keys(positions).length + placed;
        positions[s.id] = {
          x: CANVAS_W / 2 - 800 + (i % 8) * (DEFAULT_W + 40),
          y: CANVAS_H / 2 - 400 + Math.floor(i / 8) * 180,
          w: DEFAULT_W,
        };
        placed += 1;
      }
      return placed ? { ...prev, positions } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when membership changes
  }, [canvasShots.map((s) => s.id).join(",")]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = e.type === "keydown";
      if (e.type !== "keydown") return;
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (e.key === "Escape") {
        setLinkMode(false);
        setLinkFrom(null);
        setSelectedIds(new Set());
        setSelectedEdgeId(null);
        setMediaForm(null);
        setMediaAt(null);
        setEditingGroupId(null);
        setEditingStackId(null);
        setTemplateOpen(false);
        setStyleOpen(false);
        setKeysOpen(false);
        setMarquee(null);
        setCreateMenu(null);
      }

      // Why: text/gen/sticky select focuses inputs — still allow Delete/Backspace to
      // remove the selection unless the caret is mid-edit inside non-empty text.
      if (e.key === "Delete" || e.key === "Backspace") {
        const hasSel = selectedIds.size > 0 || Boolean(selectedEdgeId);
        if (hasSel) {
          if (typing) {
            const el = e.target as HTMLInputElement | HTMLTextAreaElement;
            const val = typeof el.value === "string" ? el.value : "";
            const start = el.selectionStart ?? 0;
            const end = el.selectionEnd ?? 0;
            const range = start !== end;
            if (e.key === "Backspace" && (range || start > 0)) return;
            if (e.key === "Delete" && (range || start < val.length)) return;
            try {
              el.blur();
            } catch {
              /* ignore */
            }
          }
          e.preventDefault();
          deleteSelection();
          return;
        }
      }

      if (typing) return;

      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (!typing && (e.key === "a" || e.key === "A") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const vp = viewportRef.current?.getBoundingClientRect();
        if (vp) {
          const worldX = (vp.width / 2 - doc.view.x) / doc.view.scale;
          const worldY = (vp.height / 2 - doc.view.y) / doc.view.scale;
          setCreateMenu({
            screenX: vp.width / 2,
            screenY: vp.height / 2,
            worldX,
            worldY,
          });
        }
      }

      if (matchShortcut(e, shortcuts.zoomIn)) {
        e.preventDefault();
        zoomBy(1.12);
      }
      if (matchShortcut(e, shortcuts.zoomOut)) {
        e.preventDefault();
        zoomBy(1 / 1.12);
      }
      if (!typing && e.key === "0") {
        e.preventDefault();
        updateDoc((prev) => ({
          ...prev,
          view: { ...prev.view, scale: 0.45 },
        }));
      }
      if (matchShortcut(e, shortcuts.fit) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        fitView();
      }
      if (matchShortcut(e, shortcuts.captions) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        patchTheme({ showCaptions: !theme.showCaptions });
      }
      if (matchShortcut(e, shortcuts.shotlist) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShotlistOpen((v) => !v);
      }
      if (matchShortcut(e, shortcuts.style) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setStyleOpen((v) => !v);
      }
      if (
        matchShortcut(e, shortcuts.selectAll) &&
        (e.metaKey || e.ctrlKey)
      ) {
        e.preventDefault();
        setSelectedIds(new Set(canvasShots.map((s) => s.id).filter((id) => !stackedShotIds.has(id))));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedIds,
    selectedEdgeId,
    canvas?.id,
    qc,
    updateDoc,
    shortcuts,
    theme.showCaptions,
    patchTheme,
    canvasShots,
    stackedShotIds,
    undo,
    redo,
    deleteSelection,
  ]);

  useEffect(() => {
    if (!activeGenJob || !activeGenNodeId) return;
    const status = activeGenJob.status;
    if (status === "failed" || status === "cancelled") {
      const err = activeGenJob.error_message || "Generate failed";
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === activeGenNodeId ? { ...g, status: "error", error: err } : g
        ),
      }));
      setActiveGenJobId(null);
      setActiveGenNodeId(null);
      return;
    }
    if (status !== "completed") return;

    const genId = activeGenNodeId;
    const jobId = activeGenJobId;
    void (async () => {
      let freshId: string | null = null;
      for (let i = 0; i < 12; i++) {
        try {
          const listed = await api.listShots({ project_id: projectId, limit: 80 });
          freshId =
            listed.items.find((s) => !preGenShotIds.current.has(s.id))?.id || null;
          if (freshId) break;
        } catch {
          /* retry */
        }
        await new Promise((r) => setTimeout(r, 700));
      }
      if (!freshId || !canvas?.id) {
        updateDoc((prev) => ({
          ...prev,
          gens: (prev.gens || []).map((g) =>
            g.id === genId
              ? {
                  ...g,
                  status: "error",
                  error: "Generated still not found yet — check library",
                  jobId,
                }
              : g
          ),
        }));
        setActiveGenJobId(null);
        setActiveGenNodeId(null);
        qc.invalidateQueries({ queryKey: ["shots"] });
        return;
      }
      try {
        await api.addToCollection(canvas.id, [freshId]);
        await qc.invalidateQueries({ queryKey: ["collection", canvas.id] });
        await qc.invalidateQueries({ queryKey: ["shots"] });
        updateDoc((prev) => {
          const near =
            (prev.gens || []).find((g) => g.id === genId) ||
            ({ x: CANVAS_W / 2, y: CANVAS_H / 2, w: 300 } as CanvasGenNode);
          const positions = {
            ...prev.positions,
            [freshId!]: {
              x: near.x + near.w + 40,
              y: near.y,
              w: DEFAULT_W,
            },
          };
          const edges = [...prev.edges];
          const eid = `${genId}-${freshId}`;
          if (
            !edges.some(
              (ed) =>
                (ed.a === genId && ed.b === freshId) ||
                (ed.a === freshId && ed.b === genId)
            )
          ) {
            edges.push({ id: eid, a: genId, b: freshId! });
          }
          return {
            ...prev,
            positions,
            edges,
            gens: (prev.gens || []).map((g) =>
              g.id === genId
                ? {
                    ...g,
                    status: "done" as const,
                    resultShotId: freshId,
                    error: null,
                    jobId,
                  }
                : g
            ),
          };
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not place result";
        updateDoc((prev) => ({
          ...prev,
          gens: (prev.gens || []).map((g) =>
            g.id === genId ? { ...g, status: "error", error: msg } : g
          ),
        }));
      } finally {
        setActiveGenJobId(null);
        setActiveGenNodeId(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGenJob?.status, activeGenJobId, activeGenNodeId]);

  useEffect(() => {
    const onOpenGen = (e: Event) => {
      const detail = (
        e as CustomEvent<{ prompt?: string; projectId?: string | null }>
      ).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      const vp = viewportRef.current?.getBoundingClientRect();
      const c = vp
        ? viewportCenterWorld(doc.view, vp)
        : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
      const id = `gen-${Date.now()}`;
      updateDoc((prev) => ({
        ...prev,
        gens: [
          ...(prev.gens || []),
          {
            id,
            x: c.x - 150,
            y: c.y - 100,
            w: 300,
            prompt: detail?.prompt || "",
            status: "idle",
          },
        ],
      }));
      setSelectedIds(new Set([id]));
    };
    window.addEventListener(OPEN_GENERATE_EVENT, onOpenGen);
    return () => window.removeEventListener(OPEN_GENERATE_EVENT, onOpenGen);
  }, [projectId, doc.view, updateDoc]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      setVpSize({ width: r.width, height: r.height });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvas?.id]);


  const createMutation = useMutation({
    mutationFn: (name?: string) =>
      api.createCollection({
        name: name || `Board ${canvases.length + 1}`,
        kind: "canvas",
        project_id: projectId,
        sampling_mode: "heroes",
        meta: { canvas: emptyCanvasDoc() },
      }),
    onSuccess: (col) => {
      qc.invalidateQueries({ queryKey: ["collections", "canvas", projectId] });
      setActiveCanvasId(col.id);
    },
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.updateCollection(canvas!.id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collections", "canvas", projectId] });
      setRenameOpen(false);
    },
  });

  const placeShot = useCallback(
    (shotId: string, x: number, y: number) => {
      if (!canvas?.id) return;
      const already = onBoardIds.has(shotId);
      const applyPos = () => {
        updateDoc((prev) => ({
          ...prev,
          positions: {
            ...prev.positions,
            [shotId]: { x, y, w: DEFAULT_W },
          },
          stacks: prev.stacks.map((st) => ({
            ...st,
            shotIds: st.shotIds.filter((id) => id !== shotId),
          })),
        }));
      };
      if (already) {
        applyPos();
        return;
      }
      void api.addToCollection(canvas.id, [shotId]).then(() => {
        qc.invalidateQueries({ queryKey: ["collection", canvas.id] });
        qc.invalidateQueries({ queryKey: ["collections", "canvas", projectId] });
        applyPos();
      });
    },
    [canvas?.id, onBoardIds, projectId, qc, updateDoc]
  );

  const addAtCenter = useCallback(
    (shotId: string) => {
      const vp = viewportRef.current?.getBoundingClientRect();
      if (!vp) {
        placeShot(shotId, CANVAS_W / 2 - DEFAULT_W / 2, CANVAS_H / 2 - 80);
        return;
      }
      const c = viewportCenterWorld(doc.view, vp);
      placeShot(shotId, c.x - DEFAULT_W / 2, c.y - 80);
    },
    [doc.view, placeShot]
  );

  const addText = (style: CanvasText["style"] = "title", at?: { x: number; y: number }) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    const c =
      at ||
      (vp ? viewportCenterWorld(doc.view, vp) : { x: CANVAS_W / 2, y: CANVAS_H / 2 });
    const id = `text-${Date.now()}`;
    const item: CanvasText = {
      id,
      x: c.x - 140,
      y: c.y - 24,
      w: style === "title" ? 320 : style === "caption" ? 220 : 280,
      text: style === "title" ? "Concept" : style === "caption" ? "Caption" : "Note…",
      style,
      z: Date.now(),
    };
    updateDoc((prev) => ({ ...prev, texts: [...prev.texts, item] }));
    setCreateMenu(null);
    return id;
  };

  const addNote = (
    color: NonNullable<CanvasSticky["color"]> = "yellow",
    at?: { x: number; y: number }
  ) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    const c =
      at ||
      (vp ? viewportCenterWorld(doc.view, vp) : { x: CANVAS_W / 2, y: CANVAS_H / 2 });
    const id = `note-${Date.now()}`;
    updateDoc((prev) => ({
      ...prev,
      notes: [
        ...prev.notes,
        { id, x: c.x - 120, y: c.y - 60, w: 240, text: "", color, z: Date.now() },
      ],
    }));
    setCreateMenu(null);
    return id;
  };

  const addGenNode = (at?: { x: number; y: number }, prompt = "") => {
    const vp = viewportRef.current?.getBoundingClientRect();
    const c =
      at ||
      (vp ? viewportCenterWorld(doc.view, vp) : { x: CANVAS_W / 2, y: CANVAS_H / 2 });
    const id = `gen-${Date.now()}`;
    const node: CanvasGenNode = {
      id,
      x: c.x - 160,
      y: c.y - 100,
      w: 320,
      prompt,
      status: "idle",
      family: "auto",
      look: "balanced",
      quality: "standard",
      size: "1280",
      aspect: "16:9",
      variants: 1,
    };
    updateDoc((prev) => ({
      ...prev,
      gens: [...(prev.gens || []), node],
    }));
    setSelectedIds(new Set([id]));
    setCreateMenu(null);
    return id;
  };

  const submitMedia = () => {
    const url = mediaUrl.trim();
    if (!url || !mediaForm) return;
    const vp = viewportRef.current?.getBoundingClientRect();
    const c =
      mediaAt ||
      (vp ? viewportCenterWorld(doc.view, vp) : { x: CANVAS_W / 2, y: CANVAS_H / 2 });
    const item: CanvasMedia = {
      id: `media-${Date.now()}`,
      x: c.x - 140,
      y: c.y - 40,
      w: mediaForm === "image" ? 280 : 260,
      kind: mediaForm,
      url,
      label: mediaLabel.trim() || (mediaForm === "audio" ? "Audio" : mediaForm === "image" ? "Image" : "Link"),
    };
    updateDoc((prev) => ({ ...prev, media: [...prev.media, item] }));
    setMediaForm(null);
    setMediaAt(null);
    setMediaUrl("");
    setMediaLabel("");
  };

  const openCreateMenuAt = (clientX: number, clientY: number) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const world = screenToWorld(clientX, clientY);
    setCreateMenu({
      screenX: clientX - vp.left,
      screenY: clientY - vp.top,
      worldX: world.x,
      worldY: world.y,
    });
  };

  const linkedShotIdsForGen = useCallback(
    (genId: string) => {
      const ids: string[] = [];
      for (const ed of doc.edges) {
        const other = ed.a === genId ? ed.b : ed.b === genId ? ed.a : null;
        if (other && !isGenNodeId(other) && shotMap.has(other)) ids.push(other);
      }
      return ids;
    },
    [doc.edges, shotMap]
  );

  const runGenNode = async (genId: string) => {
    if (!canGenerate) {
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId
            ? { ...g, status: "error", error: "Pro required for image generate" }
            : g
        ),
      }));
      return;
    }
    const node = (doc.gens || []).find((g) => g.id === genId);
    if (!node || node.status === "running") return;
    const linked = linkedShotIdsForGen(genId);
    const selectedShots = [...selectedIds].filter((id) => !isGenNodeId(id) && shotMap.has(id));
    const primary = linked[0] || selectedShots[0];
    if (!primary) {
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId
            ? { ...g, status: "error", error: "Link a reference frame first" }
            : g
        ),
      }));
      return;
    }
    try {
      const listed = await api.listShots({ project_id: projectId, limit: 200 });
      preGenShotIds.current = new Set(listed.items.map((s) => s.id));
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId
            ? { ...g, status: "running", error: null, jobId: null }
            : g
        ),
      }));
      const look = node.look || "balanced";
      const strength = node.strength ?? LOOK_STRENGTH[look];
      const family = node.family || "auto";
      const quality = node.quality || "standard";
      const sizeFromQuality =
        quality === "low" ? 1024 : quality === "high" ? 1536 : 1280;
      const size = node.quality
        ? sizeFromQuality
        : Number(node.size || String(sizeFromQuality)) || sizeFromQuality;
      const hints = [node.shotHint, node.angleHint].map((h) => h?.trim()).filter(Boolean);
      const promptBody = node.prompt.trim();
      const prompt = hints.length
        ? `[${hints.join(", ")}]${promptBody ? ` ${promptBody}` : ""}`.trim()
        : promptBody || undefined;
      const res = await api.generateFromShot(primary, {
        prompt,
        family,
        model: family === "auto" ? undefined : family,
        backend: node.backend || "auto",
        strength,
        size,
      });
      const jobId = res.job?.id;
      if (!jobId) throw new Error("No job returned");
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId ? { ...g, status: "running", jobId, error: null } : g
        ),
      }));
      setActiveGenJobId(jobId);
      setActiveGenNodeId(genId);
      qc.invalidateQueries({ queryKey: ["jobs"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generate failed";
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId ? { ...g, status: "error", error: msg } : g
        ),
      }));
    }
  };

  const placeGenerateFromSelection = () => {
    const shotIds = [...selectedIds].filter((id) => !isGenNodeId(id) && shotMap.has(id));
    let ax = 0;
    let ay = 0;
    let n = 0;
    for (const id of shotIds) {
      const p = doc.positions[id];
      if (!p) continue;
      ax += p.x + p.w / 2;
      ay += p.y + p.w * 0.3;
      n += 1;
    }
    const at =
      n > 0
        ? { x: ax / n + 180, y: ay / n }
        : undefined;
    const genId = addGenNode(at);
    if (shotIds.length) {
      updateDoc((prev) => {
        const edges = [...prev.edges];
        for (const sid of shotIds) {
          const eid = `${sid}-${genId}`;
          if (edges.some((ed) => (ed.a === sid && ed.b === genId) || (ed.a === genId && ed.b === sid)))
            continue;
          edges.push({ id: eid, a: sid, b: genId });
        }
        return { ...prev, edges };
      });
    }
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return { x: 0, y: 0 };
    return {
      x: (clientX - vp.left - doc.view.x) / doc.view.scale,
      y: (clientY - vp.top - doc.view.y) / doc.view.scale,
    };
  };

  const onWheel = (e: React.WheelEvent) => {
    // Framechain-style: Ctrl/Cmd+wheel zooms; plain wheel also zooms (moodboard default)
    e.preventDefault();
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = clampScale(doc.view.scale * factor);
    const mx = e.clientX - vp.left;
    const my = e.clientY - vp.top;
    updateDoc((prev) => ({
      ...prev,
      view: zoomAtFocal(prev.view, nextScale, mx, my),
    }));
  };

  const zoomBy = (factor: number) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) {
      updateDoc((prev) => ({
        ...prev,
        view: { ...prev.view, scale: clampScale(prev.view.scale * factor) },
      }));
      return;
    }
    updateDoc((prev) => ({
      ...prev,
      view: zoomAtFocal(prev.view, prev.view.scale * factor, vp.width / 2, vp.height / 2),
    }));
  };

  const jumpToWorld = (wx: number, wy: number) => {
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    updateDoc((prev) => ({
      ...prev,
      view: {
        ...prev.view,
        x: vp.width / 2 - wx * prev.view.scale,
        y: vp.height / 2 - wy * prev.view.scale,
      },
    }));
  };

  const onViewportPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const onItem = Boolean(target.closest("[data-canvas-item]"));

    // Middle / Space / Alt = pan
    if (e.button === 1 || spaceDown.current || e.altKey) {
      e.preventDefault();
      panMovedRef.current = false;
      setPanning(true);
      setMarquee(null);
      setCreateMenu(null);
      panStart.current = { x: e.clientX, y: e.clientY, vx: doc.view.x, vy: doc.view.y };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    // Right-drag empty OR Shift-left empty = marquee multi-select
    if ((e.button === 2 || (e.button === 0 && e.shiftKey)) && !onItem) {
      e.preventDefault();
      const w = screenToWorld(e.clientX, e.clientY);
      setMarquee({ x0: w.x, y0: w.y, x1: w.x, y1: w.y });
      setPanning(false);
      setCreateMenu(null);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      return;
    }

    // Left-click empty: wire-drop opens create menu; else pan (click = deselect)
    if (e.button === 0 && !onItem) {
      e.preventDefault();
      setCreateMenu(null);
      if (linkMode || linkFrom) {
        openCreateMenuAt(e.clientX, e.clientY);
        return;
      }
      panMovedRef.current = false;
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, vx: doc.view.x, vy: doc.view.y };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (linkMode || linkFrom) {
      setLinkCursor(screenToWorld(e.clientX, e.clientY));
    }
    if (marquee) {
      const w = screenToWorld(e.clientX, e.clientY);
      setMarquee((m) => (m ? { ...m, x1: w.x, y1: w.y } : m));
      return;
    }
    if (resizing) {
      const dw = (e.clientX - resizeStart.current.clientX) / doc.view.scale;
      const nextW = Math.max(
        MIN_FRAME_W,
        Math.min(MAX_FRAME_W, resizeStart.current.w + dw)
      );
      if (resizing.startsWith("media:")) {
        const mid = resizing.slice(6);
        updateDoc((prev) => ({
          ...prev,
          media: prev.media.map((m) => (m.id === mid ? { ...m, w: nextW } : m)),
        }));
      } else if (resizing.startsWith("text:")) {
        const tid = resizing.slice(5);
        updateDoc((prev) => ({
          ...prev,
          texts: prev.texts.map((t) =>
            t.id === tid ? { ...t, w: Math.max(80, Math.min(720, nextW)) } : t
          ),
        }));
      } else {
        updateDoc((prev) => {
          const p = prev.positions[resizing] || { x: 0, y: 0, w: DEFAULT_W };
          return {
            ...prev,
            positions: { ...prev.positions, [resizing]: { ...p, w: nextW } },
          };
        });
      }
      return;
    }
    if (panning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      if (Math.hypot(dx, dy) > 5) panMovedRef.current = true;
      updateDoc((prev) => ({
        ...prev,
        view: {
          ...prev.view,
          x: panStart.current.vx + dx,
          y: panStart.current.vy + dy,
        },
      }));
      return;
    }
    if (!dragging) return;
    if (dragging.startsWith("stack:")) {
      const stackId = dragging.slice(6);
      const world = screenToWorld(e.clientX, e.clientY);
      const nx = world.x - dragOffset.current.x;
      const ny = world.y - dragOffset.current.y;
      const dragKey = `stack:${stackId}`;
      updateDoc((prev) => {
        const cur = prev.stacks.find((st) => st.id === stackId);
        if (!cur) return prev;
        const dx = nx - cur.x;
        const dy = ny - cur.y;
        const moving =
          selectedIds.has(dragKey) && selectedIds.size > 1
            ? [...selectedIds].filter(isStackId).map((id) => id.slice(6))
            : [stackId];
        const moveSet = new Set(moving);
        return {
          ...prev,
          stacks: prev.stacks.map((st) =>
            moveSet.has(st.id)
              ? {
                  ...st,
                  x: Math.max(0, st.x + dx),
                  y: Math.max(0, st.y + dy),
                }
              : st
          ),
        };
      });
      return;
    }
    if (dragging.startsWith("note:")) {
      const noteId = dragging.slice(5);
      const world = screenToWorld(e.clientX, e.clientY);
      const nx = world.x - dragOffset.current.x;
      const ny = world.y - dragOffset.current.y;
      const dragKey = `note:${noteId}`;
      updateDoc((prev) => {
        const cur = prev.notes.find((n) => n.id === noteId);
        if (!cur) return prev;
        const dx = nx - cur.x;
        const dy = ny - cur.y;
        const moving =
          selectedIds.has(dragKey) && selectedIds.size > 1
            ? [...selectedIds].filter(isNoteId).map((id) => id.slice(5))
            : [noteId];
        const moveSet = new Set(moving);
        return {
          ...prev,
          notes: prev.notes.map((n) =>
            moveSet.has(n.id)
              ? { ...n, x: Math.max(0, n.x + dx), y: Math.max(0, n.y + dy) }
              : n
          ),
        };
      });
      return;
    }
    if (dragging.startsWith("text:")) {
      const textId = dragging.slice(5);
      const world = screenToWorld(e.clientX, e.clientY);
      const nx = world.x - dragOffset.current.x;
      const ny = world.y - dragOffset.current.y;
      const dragKey = `text:${textId}`;
      updateDoc((prev) => {
        const cur = prev.texts.find((t) => t.id === textId);
        if (!cur) return prev;
        const dx = nx - cur.x;
        const dy = ny - cur.y;
        const moving =
          selectedIds.has(dragKey) && selectedIds.size > 1
            ? [...selectedIds].filter(isTextId).map((id) => id.slice(5))
            : [textId];
        const moveSet = new Set(moving);
        return {
          ...prev,
          texts: prev.texts.map((t) =>
            moveSet.has(t.id)
              ? { ...t, x: Math.max(0, t.x + dx), y: Math.max(0, t.y + dy) }
              : t
          ),
        };
      });
      return;
    }
    if (dragging.startsWith("media:")) {
      const mediaId = dragging.slice(6);
      const world = screenToWorld(e.clientX, e.clientY);
      const nx = world.x - dragOffset.current.x;
      const ny = world.y - dragOffset.current.y;
      const dragKey = `media:${mediaId}`;
      updateDoc((prev) => {
        const cur = prev.media.find((m) => m.id === mediaId);
        if (!cur) return prev;
        const dx = nx - cur.x;
        const dy = ny - cur.y;
        const moving =
          selectedIds.has(dragKey) && selectedIds.size > 1
            ? [...selectedIds].filter(isMediaId).map((id) => id.slice(6))
            : [mediaId];
        const moveSet = new Set(moving);
        return {
          ...prev,
          media: prev.media.map((m) =>
            moveSet.has(m.id)
              ? { ...m, x: Math.max(0, m.x + dx), y: Math.max(0, m.y + dy) }
              : m
          ),
        };
      });
      return;
    }
    if (dragging.startsWith("gen:")) {
      const genId = dragging.slice(4);
      const world = screenToWorld(e.clientX, e.clientY);
      const nx = world.x - dragOffset.current.x;
      const ny = world.y - dragOffset.current.y;
      updateDoc((prev) => ({
        ...prev,
        gens: (prev.gens || []).map((g) =>
          g.id === genId
            ? { ...g, x: Math.max(0, nx), y: Math.max(0, ny) }
            : g
        ),
      }));
      return;
    }
    const world = screenToWorld(e.clientX, e.clientY);
    const nx = world.x - dragOffset.current.x;
    const ny = world.y - dragOffset.current.y;
    updateDoc((prev) => {
      const cur = prev.positions[dragging] || { x: 0, y: 0, w: DEFAULT_W };
      const dx = nx - cur.x;
      const dy = ny - cur.y;
      const moving =
        selectedIds.has(dragging) && selectedIds.size > 1 ? selectedIds : new Set([dragging]);
      const positions = { ...prev.positions };
      for (const id of moving) {
        if (
          isNoteId(id) ||
          isTextId(id) ||
          isMediaId(id) ||
          isStackId(id) ||
          isGenNodeId(id)
        ) {
          continue;
        }
        const p = positions[id] || { x: 0, y: 0, w: DEFAULT_W };
        positions[id] = {
          ...p,
          x: Math.max(0, Math.min(CANVAS_W - p.w, p.x + dx)),
          y: Math.max(0, Math.min(CANVAS_H - 80, p.y + dy)),
        };
      }
      const groups = prev.groups.map((g) => {
        if (!g.shotIds.length || !g.shotIds.every((id) => moving.has(id))) return g;
        return { ...g, x: Math.max(0, g.x + dx), y: Math.max(0, g.y + dy) };
      });
      return { ...prev, positions, groups };
    });
  };

  const onViewportPointerUp = () => {
    let marqueeMeaningful = false;
    if (marquee) {
      const box: WorldRect = {
        x: Math.min(marquee.x0, marquee.x1),
        y: Math.min(marquee.y0, marquee.y1),
        w: Math.abs(marquee.x1 - marquee.x0),
        h: Math.abs(marquee.y1 - marquee.y0),
      };
      if (box.w > 8 || box.h > 8) {
        marqueeMeaningful = true;
        const next = new Set<string>();
        for (const [id, p] of Object.entries(doc.positions)) {
          if (stackedShotIds.has(id)) continue;
          const r = { x: p.x, y: p.y, w: p.w, h: p.w * 0.62 };
          if (rectsIntersect(box, r)) next.add(id);
        }
        for (const g of doc.gens || []) {
          const r = { x: g.x, y: g.y, w: g.w, h: GEN_NODE_H };
          if (rectsIntersect(box, r)) next.add(g.id);
        }
        for (const note of doc.notes) {
          const r = { x: note.x, y: note.y, w: note.w, h: NOTE_H_APPROX };
          if (rectsIntersect(box, r)) next.add(`note:${note.id}`);
        }
        for (const t of doc.texts) {
          const h = t.style === "title" ? 40 : t.style === "caption" ? 28 : 72;
          const r = { x: t.x, y: t.y, w: t.w, h };
          if (rectsIntersect(box, r)) next.add(`text:${t.id}`);
        }
        for (const m of doc.media) {
          const r = { x: m.x, y: m.y, w: m.w, h: 100 };
          if (rectsIntersect(box, r)) next.add(`media:${m.id}`);
        }
        for (const st of doc.stacks) {
          const r = { x: st.x, y: st.y, w: st.w, h: st.w * 0.7 };
          if (rectsIntersect(box, r)) next.add(`stack:${st.id}`);
        }
        setSelectedIds(next);
        setSelectedEdgeId(null);
      }
      setMarquee(null);
    }
    const wasPanning = panning;
    setPanning(false);
    setDragging(null);
    setResizing(null);
    if (wasPanning && !panMovedRef.current && !marqueeMeaningful) {
      setSelectedIds(new Set());
      setSelectedEdgeId(null);
    }
  };

  const beginOrCompleteLink = (nodeId: string) => {
    if (!linkFrom) {
      setLinkMode(true);
      setLinkFrom(nodeId);
      return;
    }
    if (linkFrom === nodeId) return;
    const id = `${linkFrom}-${nodeId}`;
    updateDoc((prev) => {
      const exists = prev.edges.some(
        (ed) =>
          (ed.a === linkFrom && ed.b === nodeId) || (ed.a === nodeId && ed.b === linkFrom)
      );
      if (exists) return prev;
      return { ...prev, edges: [...prev.edges, { id, a: linkFrom, b: nodeId }] };
    });
    setLinkFrom(null);
  };

  const onShotPointerDown = (e: React.PointerEvent, shotId: string) => {
    if (panning || spaceDown.current) return;
    e.stopPropagation();
    e.preventDefault();
    if (linkMode) {
      beginOrCompleteLink(shotId);
      return;
    }
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(shotId)) next.delete(shotId);
        else next.add(shotId);
        return next;
      });
    } else if (!selectedIds.has(shotId)) {
      setSelectedIds(new Set([shotId]));
      setSelectedEdgeId(null);
    }
    const pos = doc.positions[shotId] || { x: 0, y: 0, w: DEFAULT_W };
    const world = screenToWorld(e.clientX, e.clientY);
    dragOffset.current = { x: world.x - pos.x, y: world.y - pos.y };
    setDragging(shotId);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const groupSelected = () => {
    const ids = [...selectedIds].filter((id) => !isGenNodeId(id) && shotMap.has(id));
    if (ids.length < 2) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    for (const id of ids) {
      const p = doc.positions[id];
      if (!p) continue;
      const h = p.w * 0.7;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + h);
    }
    if (!Number.isFinite(minX)) return;
    const pad = 28;
    const g: CanvasGroup = {
      id: `g-${Date.now()}`,
      label: `Concept ${doc.groups.length + 1}`,
      x: minX - pad,
      y: minY - pad - 18,
      w: maxX - minX + pad * 2,
      h: maxY - minY + pad * 2 + 18,
      shotIds: ids,
    };
    updateDoc((prev) => ({ ...prev, groups: [...prev.groups, g] }));
    setEditingGroupId(g.id);
  };

  const stackSelected = () => {
    const ids = [...selectedIds].filter((id) => !isGenNodeId(id) && shotMap.has(id));
    if (ids.length < 2) return;
    const first = doc.positions[ids[0]];
    const x = first?.x ?? CANVAS_W / 2;
    const y = first?.y ?? CANVAS_H / 2;
    const stack: CanvasStack = {
      id: `stack-${Date.now()}`,
      x,
      y,
      w: DEFAULT_W,
      label: `Stack ${doc.stacks.length + 1}`,
      shotIds: ids,
      activeIndex: 0,
    };
    updateDoc((prev) => {
      const positions = { ...prev.positions };
      for (const id of ids) delete positions[id];
      return {
        ...prev,
        positions,
        stacks: [...prev.stacks, stack],
        groups: prev.groups.map((g) => ({
          ...g,
          shotIds: g.shotIds.filter((id) => !ids.includes(id)),
        })),
      };
    });
    setSelectedIds(new Set());
    setEditingStackId(stack.id);
  };

  const unstack = (stackId: string) => {
    updateDoc((prev) => {
      const st = prev.stacks.find((s) => s.id === stackId);
      if (!st) return prev;
      const positions = { ...prev.positions };
      st.shotIds.forEach((id, i) => {
        positions[id] = {
          x: st.x + i * 28,
          y: st.y + i * 18,
          w: st.w,
        };
      });
      return {
        ...prev,
        positions,
        stacks: prev.stacks.filter((s) => s.id !== stackId),
      };
    });
  };

  const dissolveGroupsForSelection = () => {
    updateDoc((prev) => ({
      ...prev,
      groups: prev.groups.filter((g) => !g.shotIds.some((id) => selectedIds.has(id))),
    }));
  };

  const removeSelectedEdges = () => {
    updateDoc((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => !selectedIds.has(e.a) && !selectedIds.has(e.b)),
    }));
  };

  const deleteSelectedEdgeOrLinks = () => {
    if (selectedEdgeId) {
      const edgeId = selectedEdgeId;
      updateDoc((prev) => ({
        ...prev,
        edges: prev.edges.filter((e) => e.id !== edgeId),
      }));
      setSelectedEdgeId(null);
      return;
    }
    removeSelectedEdges();
  };

  const applyTemplate = (id: LookbookTemplateId) => {
    const meta = LOOKBOOK_TEMPLATES.find((t) => t.id === id);
    const boardIds = canvasShots.map((s) => s.id);
    if (!meta?.emptySlots && !boardIds.length) {
      setExportErr("Add frames to the board before applying a lookbook template — or pick an empty-slot starter.");
      setTemplateOpen(false);
      return;
    }
    const hasLayout =
      Object.keys(doc.positions).length > 0 ||
      doc.texts.length > 0 ||
      doc.notes.length > 0 ||
      doc.groups.length > 0;
    if (
      hasLayout &&
      !confirm("Replace the current board layout with this lookbook template?")
    ) {
      return;
    }
    setExportErr(null);
    setTemplateOpen(false);
    const vp = viewportRef.current?.getBoundingClientRect();
    updateDoc(() => {
      const next = applyLookbookTemplate(boardIds, id, {
        boardTitle: canvas?.name,
      });
      // Center the template block in the viewport (avoid stale fitView after setState)
      const ox = 10000 - 720;
      const oy = 10000 - 420;
      const scale = 0.42;
      const vw = vp?.width ?? 900;
      const vh = vp?.height ?? 560;
      return {
        ...next,
        view: {
          scale,
          x: vw / 2 - (ox + 400) * scale,
          y: vh / 2 - (oy + 200) * scale,
        },
      };
    });
  };

  const suggestedId = suggestedTemplateId(projectKind);

  const fitView = () => {
    if (!canvasShots.length || !viewportRef.current) {
      updateDoc((prev) => ({
        ...prev,
        view: { x: -CANVAS_W * 0.1, y: -CANVAS_H * 0.1, scale: 0.2 },
      }));
      return;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = 0;
    let maxY = 0;
    const consider = (x: number, y: number, w: number, h: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
    };
    canvasShots.forEach((s, i) => {
      if (stackedShotIds.has(s.id)) return;
      const p = doc.positions[s.id] || {
        x: CANVAS_W / 2 + (i % 8) * 260,
        y: CANVAS_H / 2 + Math.floor(i / 8) * 180,
        w: DEFAULT_W,
      };
      consider(p.x, p.y, p.w, p.w * 0.7);
    });
    for (const st of doc.stacks) consider(st.x, st.y, st.w, st.w * 0.7);
    for (const t of doc.texts) consider(t.x, t.y, t.w, 40);
    for (const m of doc.media) consider(m.x, m.y, m.w, 80);
    if (!Number.isFinite(minX)) return;
    const vp = viewportRef.current.getBoundingClientRect();
    const pad = 80;
    const bw = Math.max(400, maxX - minX + pad * 2);
    const bh = Math.max(300, maxY - minY + pad * 2);
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(vp.width / bw, vp.height / bh)));
    updateDoc((prev) => ({
      ...prev,
      view: {
        scale,
        x: vp.width / 2 - ((minX + maxX) / 2) * scale,
        y: vp.height / 2 - ((minY + maxY) / 2) * scale,
      },
    }));
  };

  const onDropShot = (e: React.DragEvent) => {
    e.preventDefault();
    const shotId =
      e.dataTransfer.getData(CANVAS_SHOT_MIME) || e.dataTransfer.getData("text/plain");
    if (!shotId || !shotId.match(/^[0-9a-f-]{36}$/i)) return;
    const world = screenToWorld(e.clientX, e.clientY);
    placeShot(shotId, world.x - DEFAULT_W / 2, world.y - 60);
  };

  if (!canvas) {
    return (
      <div
        className="flex h-full min-h-[28rem] flex-col items-center justify-center gap-3 rounded-lg border border-cinema-border"
        style={{
          // Framechain v5 canvas: #111 + soft 24px dot grid
          backgroundColor: "#111111",
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <LayoutTemplate className="h-8 w-8 text-cinema-cyan" />
        <div className="text-sm text-white">Moodboard</div>
        <p className="max-w-md text-center text-xs text-cinema-muted">
          Infinite board for visual concepts — frames, text, audio, stacks, and named groups.
        </p>
        <button
          type="button"
          onClick={() => createMutation.mutate(undefined)}
          disabled={createMutation.isPending}
          className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
        >
          New board
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[36rem] flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full flex-wrap items-center gap-1">
          {canvases.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCanvasId(c.id)}
              className={cn(
                "rounded border px-2.5 py-1 text-[11px]",
                c.id === canvas.id
                  ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                  : "border-cinema-border text-cinema-muted hover:text-white"
              )}
            >
              {c.name}
              <span className="ml-1 opacity-60">{c.shot_count}</span>
            </button>
          ))}
          <button
            type="button"
            title="New moodboard"
            onClick={() => createMutation.mutate(undefined)}
            disabled={createMutation.isPending}
            className="inline-flex items-center gap-1 rounded border border-dashed border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
          >
            <Plus className="h-3 w-3" />
            Board
          </button>
          <button
            type="button"
            title="Rename board"
            onClick={() => setRenameOpen(true)}
            className="rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:text-white"
          >
            Rename
          </button>
        </div>
        {renameOpen && (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const name = String(fd.get("name") || "").trim();
              if (name) renameMutation.mutate(name);
            }}
          >
            <input
              name="name"
              defaultValue={canvas.name}
              autoFocus
              className="w-36 rounded border border-cinema-border bg-cinema-black px-2 py-1 text-[11px] text-white outline-none focus:border-cinema-cyan"
            />
            <button type="submit" className="text-[11px] text-cinema-cyan">
              Save
            </button>
            <button
              type="button"
              onClick={() => setRenameOpen(false)}
              className="text-[11px] text-cinema-muted"
            >
              Cancel
            </button>
          </form>
        )}
        <span className="text-xs text-cinema-muted">
          {canvasShots.length} frames · {Math.round(doc.view.scale * 100)}%
        </span>
        <div className="flex overflow-hidden rounded border border-cinema-border">
          <button
            type="button"
            title="Zoom out"
            onClick={() => zoomBy(1 / 1.12)}
            className="px-2 py-1.5 text-cinema-muted hover:text-white"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Zoom in (=)"
            onClick={() => zoomBy(1.12)}
            className="px-2 py-1.5 text-cinema-muted hover:text-white"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Fit content"
            onClick={fitView}
            className="px-2 py-1.5 text-cinema-muted hover:text-white"
          >
            <Scan className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex overflow-hidden rounded border border-cinema-border">
          <button
            type="button"
            title={canBoardExport ? "Export board PNG" : "Board export is Pro"}
            disabled={Boolean(exportBusy)}
            onClick={async () => {
              if (!canBoardExport) {
                window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                return;
              }
              setExportErr(null);
              setExportBusy("png");
              try {
                await exportBoardPng(doc, shots, canvas.name);
              } catch (e) {
                setExportErr((e as Error).message || "PNG export failed");
              } finally {
                setExportBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            {canBoardExport ? (
              <FileImage className="h-3.5 w-3.5" />
            ) : (
              <Crown className="h-3.5 w-3.5 text-cinema-cyan" />
            )}
            {exportBusy === "png" ? "…" : "PNG"}
          </button>
          <button
            type="button"
            title={canBoardExport ? "Export board PDF" : "Board export is Pro"}
            disabled={Boolean(exportBusy)}
            onClick={async () => {
              if (!canBoardExport) {
                window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                return;
              }
              setExportErr(null);
              setExportBusy("pdf");
              try {
                await exportBoardPdf(doc, shots, canvas.name, { layout: pdfLayout });
              } catch (e) {
                setExportErr((e as Error).message || "PDF export failed");
              } finally {
                setExportBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 border-l border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            {canBoardExport ? (
              <FileText className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {exportBusy === "pdf" ? "…" : "PDF"}
          </button>
          <select
            value={pdfLayout}
            onChange={(e) =>
              setPdfLayout(e.target.value as "board" | "contact" | "slides")
            }
            title="PDF layout"
            className="border-l border-cinema-border bg-cinema-black px-1.5 py-1.5 text-[10px] text-cinema-muted outline-none hover:text-white"
          >
            <option value="board">Board</option>
            <option value="contact">Contact</option>
            <option value="slides">Shot pages</option>
          </select>
          <button
            type="button"
            title={canBoardExport ? "Export static HTML for client review" : "Board export is Pro"}
            disabled={Boolean(exportBusy)}
            onClick={async () => {
              if (!canBoardExport) {
                window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                return;
              }
              setExportErr(null);
              setExportBusy("html");
              try {
                await exportBoardHtml(doc, shots, canvas.name);
              } catch (e) {
                setExportErr((e as Error).message || "HTML export failed");
              } finally {
                setExportBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 border-l border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            HTML
            {exportBusy === "html" ? "…" : ""}
          </button>
          <button
            type="button"
            title={
              canBoardExport
                ? "Approved brief package (PDF + markdown)"
                : "Approved brief package is Pro"
            }
            disabled={Boolean(exportBusy)}
            onClick={async () => {
              if (!canBoardExport) {
                window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                return;
              }
              setExportErr(null);
              setExportBusy("brief");
              try {
                await exportApprovedBriefPackage(doc, shots, canvas.name, {
                  projectName: project?.name,
                  brief: project?.brief,
                  feeling: project?.feeling,
                  references: project?.references_text,
                });
              } catch (e) {
                setExportErr((e as Error).message || "Brief package failed");
              } finally {
                setExportBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 border-l border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            {canBoardExport ? (
              <ClipboardCheck className="h-3.5 w-3.5" />
            ) : (
              <Crown className="h-3.5 w-3.5 text-cinema-cyan" />
            )}
            {exportBusy === "brief" ? "…" : "Brief"}
          </button>
          <button
            type="button"
            title={canBoardExport ? "Export portable .ckboard.zip bundle" : "Board export is Pro"}
            disabled={Boolean(exportBusy) || !canvas?.id}
            onClick={async () => {
              if (!canBoardExport || !canvas?.id) {
                if (!canBoardExport) window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                return;
              }
              setExportErr(null);
              setExportBusy("bundle");
              try {
                const media_urls = [
                  ...canvasShots.flatMap((s) =>
                    [s.keyframe_url, s.thumb_md_url, s.thumb_url, s.preview_url].filter(Boolean) as string[]
                  ),
                  ...doc.media.map((m) => m.url).filter(Boolean),
                ];
                const blob = await api.exportBoardBundle(projectId, canvas.id, {
                  canvas: doc,
                  board_name: canvas.name,
                  media_urls,
                });
                downloadBlob(blob, `${(canvas.name || "board").replace(/\s+/g, "-")}.ckboard.zip`);
              } catch (e) {
                setExportErr((e as Error).message || "Bundle export failed");
              } finally {
                setExportBusy(null);
              }
            }}
            className="inline-flex items-center gap-1 border-l border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            {exportBusy === "bundle" ? "…" : "Bundle"}
          </button>
        </div>
        <label
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Import PDF pages as board-only images (not searchable)"
        >
          <FileText className="h-3.5 w-3.5" />
          PDF
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file || !canvas?.id) return;
              setExportErr(null);
              setExportBusy("pdfin");
              try {
                const res = await api.importBoardDocument(projectId, canvas.id, file);
                const originX = 10000 - 400;
                const originY = 10000 - 200;
                updateDoc((prev) => {
                  const media = [...prev.media];
                  res.pages.forEach((p, i) => {
                    media.push({
                      id: `media-${crypto.randomUUID?.() || Date.now()}-${i}`,
                      x: originX + (i % 4) * 260,
                      y: originY + Math.floor(i / 4) * 200,
                      w: 240,
                      kind: "image",
                      url: artifactUrl(p.url),
                      label: `Page ${p.page}`,
                    });
                  });
                  return { ...prev, media };
                });
              } catch (err) {
                setExportErr((err as Error).message || "PDF import failed");
              } finally {
                setExportBusy(null);
              }
            }}
          />
        </label>
        <label
          className="inline-flex cursor-pointer items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Import a .ckboard.zip from another install"
        >
          <Download className="h-3.5 w-3.5" />
          Open bundle
          <input
            type="file"
            accept=".zip,.ckboard.zip,application/zip"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              setExportErr(null);
              setExportBusy("bundlein");
              try {
                const res = await api.importBoardBundle(projectId, file);
                const next = normalizeCanvasDoc(res.canvas as Partial<CanvasDoc>);
                // Prefer CanvasMedia urls already remapped; keep local positions
                updateDoc(() => next);
              } catch (err) {
                setExportErr((err as Error).message || "Bundle import failed");
              } finally {
                setExportBusy(null);
              }
            }}
          />
        </label>
        <div className="relative">
          <button
            type="button"
            title="Apply a lookbook layout template"
            onClick={() => setTemplateOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          >
            <LayoutTemplate className="h-3.5 w-3.5" />
            Template
          </button>
          {templateOpen ? (
            <div className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded border border-cinema-border bg-cinema-panel shadow-xl">
              <div className="border-b border-cinema-border px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                Lookbook templates
              </div>
              {LOOKBOOK_TEMPLATES.map((tpl) => {
                const recommended = tpl.id === suggestedId;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => applyTemplate(tpl.id)}
                    className="flex w-full flex-col gap-0.5 px-2.5 py-2 text-left hover:bg-cinema-cyan/10"
                  >
                    <span className="flex items-center gap-1.5 text-[12px] text-white">
                      {tpl.label}
                      {recommended ? (
                        <span className="rounded bg-cinema-cyan/15 px-1 py-0.5 text-[9px] uppercase tracking-wide text-cinema-cyan">
                          suggested
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] leading-snug text-cinema-muted">{tpl.hint}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {exportErr && <span className="text-[11px] text-cinema-magenta">{exportErr}</span>}
        {selectedText ? (
          <div
            className="flex flex-wrap items-center gap-1 rounded-md border border-cinema-border bg-cinema-panel/80 px-1 py-0.5"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <select
              value={selectedText.style}
              onChange={(e) => {
                const style = e.target.value as CanvasText["style"];
                const tid = selectedText.id;
                updateDoc((prev) => ({
                  ...prev,
                  texts: prev.texts.map((n) =>
                    n.id === tid
                      ? {
                          ...n,
                          style,
                          fontSize: n.fontSize ?? TEXT_STYLE_DEFAULTS[style],
                        }
                      : n
                  ),
                }));
              }}
              className="rounded border border-cinema-border bg-cinema-black/80 px-1 py-0.5 text-[10px] text-white"
            >
              <option value="title">title</option>
              <option value="heading">heading</option>
              <option value="body">body</option>
              <option value="caption">caption</option>
              <option value="label">label</option>
            </select>
            <input
              type="number"
              min={12}
              max={72}
              value={selectedText.fontSize ?? TEXT_STYLE_DEFAULTS[selectedText.style]}
              onChange={(e) => {
                const next = Math.max(12, Math.min(72, Number(e.target.value) || 12));
                const tid = selectedText.id;
                updateDoc((prev) => ({
                  ...prev,
                  texts: prev.texts.map((n) =>
                    n.id === tid ? { ...n, fontSize: next } : n
                  ),
                }));
              }}
              className="w-12 rounded border border-cinema-border bg-cinema-black/80 px-1 py-0.5 text-[10px] text-white"
            />
            {(["left", "center", "right"] as const).map((align) => (
              <button
                key={align}
                type="button"
                title={align}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px]",
                  (selectedText.align || "left") === align
                    ? "bg-cinema-cyan/25 text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                )}
                onClick={() => {
                  const tid = selectedText.id;
                  updateDoc((prev) => ({
                    ...prev,
                    texts: prev.texts.map((n) =>
                      n.id === tid ? { ...n, align } : n
                    ),
                  }));
                }}
              >
                {align === "left" ? "L" : align === "center" ? "C" : "R"}
              </button>
            ))}
            <input
              type="color"
              value={selectedText.color || "#ffffff"}
              onChange={(e) => {
                const color = e.target.value;
                const tid = selectedText.id;
                updateDoc((prev) => ({
                  ...prev,
                  texts: prev.texts.map((n) =>
                    n.id === tid ? { ...n, color } : n
                  ),
                }));
              }}
              className="h-5 w-5 cursor-pointer rounded border border-cinema-border bg-transparent"
            />
            <select
              value={selectedText.weight || "normal"}
              onChange={(e) => {
                const weight = e.target.value as NonNullable<CanvasText["weight"]>;
                const tid = selectedText.id;
                updateDoc((prev) => ({
                  ...prev,
                  texts: prev.texts.map((n) =>
                    n.id === tid ? { ...n, weight } : n
                  ),
                }));
              }}
              className="rounded border border-cinema-border bg-cinema-black/80 px-1 py-0.5 text-[10px] text-white"
            >
              <option value="normal">normal</option>
              <option value="medium">medium</option>
              <option value="bold">bold</option>
            </select>
          </div>
        ) : null}
        {selectedIds.size >= 2 || selectedEdgeId ? (
          <div className="flex items-center gap-1 rounded-md border border-cinema-cyan/25 bg-cinema-cyan/5 px-1 py-0.5">
            {selectedIds.size >= 2 ? (
              <>
            <button
              type="button"
              onClick={stackSelected}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cinema-muted hover:text-white"
              title="Stack frames into one pile"
            >
              <Layers className="h-3.5 w-3.5" />
              Stack
            </button>
            <button
              type="button"
              onClick={groupSelected}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cinema-muted hover:text-white"
              title="Name a visual concept around selection"
            >
              <Group className="h-3.5 w-3.5" />
              Concept
            </button>
            <button
              type="button"
              onClick={() => {
                setLinkMode((v) => !v);
                setLinkFrom(null);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px]",
                linkMode
                  ? "bg-cinema-cyan/15 text-cinema-cyan"
                  : "text-cinema-muted hover:text-white"
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              {linkMode ? (linkFrom ? "Click target…" : "Link") : "Link"}
            </button>
            <button
              type="button"
              onClick={placeGenerateFromSelection}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cinema-muted hover:text-cinema-cyan"
              title="Create Generate node from selection"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </button>
            <button
              type="button"
              onClick={dissolveGroupsForSelection}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cinema-muted hover:text-white"
              title="Ungroup"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={deleteSelectedEdgeOrLinks}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-cinema-muted hover:text-cinema-magenta"
              title={selectedEdgeId ? "Delete wire" : "Clear links"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : selectedIds.size === 1 ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setLinkMode((v) => !v);
                setLinkFrom(null);
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded border px-2 py-1.5 text-[11px]",
                linkMode
                  ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                  : "border-cinema-border text-cinema-muted hover:text-white"
              )}
            >
              <Link2 className="h-3.5 w-3.5" />
              {linkMode ? (linkFrom ? "Click target…" : "Link") : "Link"}
            </button>
            <button
              type="button"
              onClick={placeGenerateFromSelection}
              className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
              title="Generate from selection"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generate
            </button>
          </div>
        ) : (
          <span className="text-[10px] text-cinema-muted">
            Double-click or A to create
          </span>
        )}
        <button
          type="button"
          onClick={() => patchTheme({ showCaptions: !theme.showCaptions })}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-2 py-1.5 text-[11px]",
            theme.showCaptions
              ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:text-white"
          )}
          title={`Frame captions (${shortcuts.captions.toUpperCase()})`}
        >
          <Captions className="h-3.5 w-3.5" />
          Captions
        </button>
        <button
          type="button"
          onClick={() => patchTheme({ showFrameBorder: !theme.showFrameBorder })}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-2 py-1.5 text-[11px]",
            theme.showFrameBorder
              ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:text-white"
          )}
          title="Frame borders on stills"
        >
          Frame
        </button>
        <button
          type="button"
          onClick={() => setShotlistOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 rounded border px-2 py-1.5 text-[11px]",
            shotlistOpen
              ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:text-white"
          )}
          title={`Shotlist (${shortcuts.shotlist.toUpperCase()})`}
        >
          <Table2 className="h-3.5 w-3.5" />
          Shotlist
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setKeysOpen(false);
              setStyleOpen((v) => !v);
            }}
            className={cn(
              "inline-flex items-center gap-1 rounded border px-2 py-1.5 text-[11px]",
              styleOpen
                ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                : "border-cinema-border text-cinema-muted hover:text-white"
            )}
            title={`Board style (${shortcuts.style.toUpperCase()})`}
          >
            <Palette className="h-3.5 w-3.5" />
            Style
          </button>
          {styleOpen ? (
            <div className="absolute left-0 top-full z-40 mt-1 w-64 space-y-2 rounded border border-cinema-border bg-cinema-panel p-3 shadow-xl">
              <label className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted">
                Board / export BG
                <input
                  type="color"
                  value={theme.bg}
                  onChange={(e) => patchTheme({ bg: e.target.value })}
                  className="h-6 w-10 cursor-pointer rounded border border-cinema-border bg-transparent"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted">
                Accent
                <input
                  type="color"
                  value={theme.accent}
                  onChange={(e) =>
                    patchTheme({ accent: e.target.value, exportTitleColor: e.target.value })
                  }
                  className="h-6 w-10 cursor-pointer rounded border border-cinema-border bg-transparent"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted">
                Card radius
                <input
                  type="range"
                  min={0}
                  max={16}
                  value={theme.cardRadius}
                  onChange={(e) => patchTheme({ cardRadius: Number(e.target.value) })}
                  className="w-28"
                />
              </label>
              <label className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted">
                Frame borders
                <input
                  type="checkbox"
                  checked={Boolean(theme.showFrameBorder)}
                  onChange={(e) => patchTheme({ showFrameBorder: e.target.checked })}
                  className="h-3.5 w-3.5 accent-cinema-cyan"
                />
              </label>
              <div className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted">
                Stickies
                <div className="flex overflow-hidden rounded border border-cinema-border">
                  <button
                    type="button"
                    onClick={() => patchTheme({ stickyStyle: "quiet" })}
                    className={cn(
                      "px-2 py-0.5 text-[9px]",
                      (theme.stickyStyle || "quiet") === "quiet"
                        ? "bg-cinema-cyan/15 text-cinema-cyan"
                        : "text-cinema-muted hover:text-white"
                    )}
                  >
                    Quiet
                  </button>
                  <button
                    type="button"
                    onClick={() => patchTheme({ stickyStyle: "pastel" })}
                    className={cn(
                      "px-2 py-0.5 text-[9px]",
                      theme.stickyStyle === "pastel"
                        ? "bg-cinema-cyan/15 text-cinema-cyan"
                        : "text-cinema-muted hover:text-white"
                    )}
                  >
                    Pastel
                  </button>
                </div>
              </div>
              <div className="text-[10px] text-cinema-muted">Caption fields</div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    "title",
                    "shot_type",
                    "technique",
                    "timecode",
                    "mood",
                    "composition",
                    "lens",
                    "camera",
                    "lighting",
                  ] as CaptionField[]
                ).map((f) => {
                  const on = theme.captionFields.includes(f);
                  return (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        const next = on
                          ? theme.captionFields.filter((x) => x !== f)
                          : [...theme.captionFields, f];
                        patchTheme({
                          captionFields: next.length ? next : (["title"] as CaptionField[]),
                        });
                      }}
                      className={cn(
                        "rounded border px-1.5 py-0.5 text-[9px]",
                        on
                          ? "border-cinema-cyan/40 text-cinema-cyan"
                          : "border-cinema-border text-cinema-muted"
                      )}
                    >
                      {f}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setStyleOpen(false);
              setKeysOpen((v) => !v);
            }}
            className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-white"
            title="Keyboard shortcuts"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Keys
          </button>
          {keysOpen ? (
            <div className="absolute left-0 top-full z-40 mt-1 w-72 space-y-2 rounded border border-cinema-border bg-cinema-panel p-3 shadow-xl">
              <p className="text-[10px] text-cinema-muted">
                Click empty canvas to deselect. Right-drag empty canvas to marquee-select, then drag any selected frame to move all.
                Click a key field and press a letter to rebind. Esc also clears selection.
              </p>
              {(
                [
                  ["fit", "Fit"],
                  ["zoomIn", "Zoom in"],
                  ["zoomOut", "Zoom out"],
                  ["captions", "Captions"],
                  ["shotlist", "Shotlist"],
                  ["style", "Style"],
                  ["selectAll", "Select all (with Ctrl/⌘)"],
                ] as const
              ).map(([id, label]) => (
                <label
                  key={id}
                  className="flex items-center justify-between gap-2 text-[10px] text-cinema-muted"
                >
                  {label}
                  <input
                    value={shortcuts[id]}
                    onChange={() => {}}
                    onKeyDown={(ev) => {
                      ev.preventDefault();
                      ev.stopPropagation();
                      const k =
                        ev.key === " "
                          ? "space"
                          : ev.key.length === 1
                            ? ev.key.toLowerCase()
                            : ev.key === "=" || ev.key === "+"
                              ? "="
                              : ev.key === "-" || ev.key === "_"
                                ? "-"
                                : shortcuts[id];
                      const next = { ...shortcuts, [id]: k };
                      setShortcuts(next);
                      saveShortcuts(next);
                    }}
                    readOnly
                    className="w-12 rounded border border-cinema-border bg-cinema-black px-1 py-0.5 text-center font-mono text-[10px] text-cinema-cyan outline-none"
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
        <span className="text-[10px] text-cinema-muted">
          Click empty to deselect · Right-drag select · Wheel zoom · Space pan ·{" "}
          {shortcuts.fit.toUpperCase()} fit
        </span>
      </div>

      {mediaForm && (
        <form
          className="flex flex-wrap items-end gap-2 rounded border border-cinema-border bg-cinema-panel/80 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitMedia();
          }}
        >
          <label className="space-y-1 text-[10px] text-cinema-muted">
            Kind
            <select
              value={mediaForm}
              onChange={(e) => setMediaForm(e.target.value as "audio" | "image" | "link")}
              className="block rounded border border-cinema-border bg-cinema-black px-2 py-1 text-[11px] text-white"
            >
              <option value="audio">Audio</option>
              <option value="image">Image URL</option>
              <option value="link">Link</option>
            </select>
          </label>
          <label className="min-w-[14rem] flex-1 space-y-1 text-[10px] text-cinema-muted">
            URL
            <input
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://…"
              autoFocus
              className="block w-full rounded border border-cinema-border bg-cinema-black px-2 py-1 text-[11px] text-white outline-none focus:border-cinema-cyan"
            />
          </label>
          <label className="w-40 space-y-1 text-[10px] text-cinema-muted">
            Label
            <input
              value={mediaLabel}
              onChange={(e) => setMediaLabel(e.target.value)}
              placeholder="Optional"
              className="block w-full rounded border border-cinema-border bg-cinema-black px-2 py-1 text-[11px] text-white outline-none focus:border-cinema-cyan"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-cinema-cyan/20 px-3 py-1.5 text-[11px] text-cinema-cyan"
          >
            Add to board
          </button>
          <button
            type="button"
            onClick={() => setMediaForm(null)}
            className="px-2 py-1.5 text-[11px] text-cinema-muted"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="flex min-h-0 flex-1 gap-0">
        <div
          ref={viewportRef}
          onWheel={onWheel}
          onPointerDown={onViewportPointerDown}
          onPointerMove={onViewportPointerMove}
          onPointerUp={onViewportPointerUp}
          onDoubleClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("[data-canvas-item]")) return;
            openCreateMenuAt(e.clientX, e.clientY);
          }}
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={onDropShot}
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden rounded-lg border border-cinema-border",
            panning || spaceDown.current ? "cursor-grabbing" : "cursor-default",
            panning && "[&_[data-canvas-item]]:pointer-events-none"
          )}
          style={{
            minHeight: "32rem",
            backgroundColor: theme.bg || "#111111",
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
            backgroundPosition: `${doc.view.x}px ${doc.view.y}px`,
          }}
        >
          <div
            className="absolute origin-top-left"
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `translate(${doc.view.x}px, ${doc.view.y}px) scale(${doc.view.scale})`,
            }}
          >
            <svg
              className="pointer-events-none absolute inset-0"
              width={CANVAS_W}
              height={CANVAS_H}
              style={{ zIndex: 1 }}
            >
              {doc.edges.map((edge) => {
                const boxA = nodeBoxForId(edge.a, doc, shotMap);
                const boxB = nodeBoxForId(edge.b, doc, shotMap);
                if (!boxA || !boxB) return null;
                const sides = pickPortSides(boxA, boxB);
                const a = portPoint(boxA.x, boxA.y, boxA.w, boxA.h, sides.out);
                const b = portPoint(boxB.x, boxB.y, boxB.w, boxB.h, sides.inn);
                const d = softCurve(a.x, a.y, b.x, b.y, sides.out, sides.inn);
                const selected = selectedEdgeId === edge.id;
                return (
                  <g key={edge.id} className="pointer-events-auto">
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      strokeLinecap="round"
                      className="cursor-pointer"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdgeId(edge.id);
                        setSelectedIds(new Set());
                      }}
                      onDoubleClick={(ev) => {
                        ev.stopPropagation();
                        updateDoc((prev) => ({
                          ...prev,
                          edges: prev.edges.filter((ed) => ed.id !== edge.id),
                        }));
                        setSelectedEdgeId(null);
                      }}
                    />
                    <path
                      d={d}
                      fill="none"
                      stroke={
                        selected ? "rgba(94,234,212,0.95)" : "rgba(94,234,212,0.35)"
                      }
                      strokeWidth={selected ? 2 : 1}
                      strokeLinecap="round"
                      className="pointer-events-none"
                    />
                  </g>
                );
              })}
              {linkFrom && linkCursor
                ? (() => {
                    const box = nodeBoxForId(linkFrom, doc, shotMap);
                    if (!box) return null;
                    const fake = {
                      x: linkCursor.x - 1,
                      y: linkCursor.y - 1,
                      w: 2,
                      h: 2,
                    };
                    const sides = pickPortSides(box, fake);
                    const a = portPoint(box.x, box.y, box.w, box.h, sides.out);
                    return (
                      <path
                        d={softCurve(
                          a.x,
                          a.y,
                          linkCursor.x,
                          linkCursor.y,
                          sides.out,
                          sides.inn
                        )}
                        fill="none"
                        stroke="rgba(94,234,212,0.5)"
                        strokeWidth={1}
                        strokeLinecap="round"
                        strokeDasharray="4 3"
                      />
                    );
                  })()
                : null}
            </svg>

            {doc.groups.map((g) => (
              <div
                key={g.id}
                className="absolute rounded-xl border border-cinema-cyan/25 bg-cinema-cyan/[0.04]"
                style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
              >
                {editingGroupId === g.id ? (
                  <input
                    autoFocus
                    defaultValue={g.label}
                    className="absolute left-2 top-1.5 w-[calc(100%-1rem)] rounded border border-cinema-cyan/40 bg-cinema-black/80 px-1.5 py-0.5 text-[11px] font-medium text-cinema-cyan outline-none"
                    onBlur={(e) => {
                      const label = e.target.value.trim() || g.label;
                      updateDoc((prev) => ({
                        ...prev,
                        groups: prev.groups.map((x) => (x.id === g.id ? { ...x, label } : x)),
                      }));
                      setEditingGroupId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingGroupId(null);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  />
                ) : (
                  <button
                    type="button"
                    className="absolute left-3 top-2 text-left text-[11px] font-medium tracking-wide text-cinema-cyan/80 hover:text-cinema-cyan"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingGroupId(g.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    title="Double-click to rename concept"
                  >
                    {g.label}
                  </button>
                )}
              </div>
            ))}

            {canvasShots.length === 0 &&
              doc.notes.length === 0 &&
              doc.texts.length === 0 &&
              doc.media.length === 0 &&
              !(doc.gens || []).length && (
                <div
                  className="absolute flex w-80 flex-col items-center gap-2 text-center"
                  style={{ left: CANVAS_W / 2 - 160, top: CANVAS_H / 2 - 40 }}
                >
                  <StickyNoteIcon className="h-6 w-6 text-cinema-cyan/70" />
                  <p className="text-sm text-white">Scrapbook</p>
                  <p className="text-xs text-cinema-muted">
                    Drag clips from the rail. Double-click (or press A) to add text, sticky,
                    Generate, or media. Link refs into a Generate node to run.
                  </p>
                </div>
              )}

            {(doc.gens || []).map((g) => {
              const refs = linkedShotIdsForGen(g.id);
              const running = g.status === "running";
              const connectedSides = new Set<PortSide>();
              for (const ed of doc.edges) {
                if (ed.a !== g.id && ed.b !== g.id) continue;
                const boxA = nodeBoxForId(ed.a, doc, shotMap);
                const boxB = nodeBoxForId(ed.b, doc, shotMap);
                if (!boxA || !boxB) continue;
                const sides = pickPortSides(boxA, boxB);
                if (ed.a === g.id) connectedSides.add(sides.out);
                if (ed.b === g.id) connectedSides.add(sides.inn);
              }
              const family = g.family || "auto";
              const look = g.look || "balanced";
              return (
                <div
                  key={g.id}
                  data-canvas-item
                  className={cn(
                    "absolute rounded-lg border bg-cinema-panel/95 shadow-lg",
                    selectedIds.has(g.id)
                      ? "border-cinema-cyan ring-1 ring-cinema-cyan/40"
                      : "border-cinema-border",
                    linkFrom === g.id && "ring-2 ring-cinema-cyan"
                  )}
                  style={{
                    left: g.x,
                    top: g.y,
                    width: g.w,
                    minHeight: GEN_NODE_H,
                    zIndex: 10,
                  }}
                  onPointerDown={(e) => {
                    if (panning || spaceDown.current) return;
                    e.stopPropagation();
                    e.preventDefault();
                    if (linkMode) {
                      beginOrCompleteLink(g.id);
                      return;
                    }
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.id)) next.delete(g.id);
                        else next.add(g.id);
                        return next;
                      });
                    } else {
                      setSelectedIds(new Set([g.id]));
                    }
                    const start = screenToWorld(e.clientX, e.clientY);
                    dragOffset.current = { x: start.x - g.x, y: start.y - g.y };
                    setDragging(`gen:${g.id}`);
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                >
                  {(["left", "right"] as PortSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      data-port={side === "left" ? "in" : "out"}
                      title={side}
                      className={portClass(side, connectedSides.has(side))}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        beginOrCompleteLink(g.id);
                      }}
                    />
                  ))}
                  {(["top", "bottom"] as PortSide[])
                    .filter((side) => connectedSides.has(side))
                    .map((side) => (
                      <button
                        key={side}
                        type="button"
                        data-port={side}
                        title={side}
                        className={portClass(side, true, false)}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          beginOrCompleteLink(g.id);
                        }}
                      />
                    ))}
                  <div className="flex items-center gap-1.5 border-b border-cinema-border/80 bg-cinema-black/40 px-2.5 py-1.5">
                    <Wand2 className="h-3.5 w-3.5 text-cinema-cyan" />
                    <span className="text-[11px] font-medium text-white">Generate</span>
                    <span
                      className={cn(
                        "ml-auto rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide",
                        running
                          ? "bg-cinema-cyan/15 text-cinema-cyan"
                          : g.status === "error"
                            ? "bg-cinema-magenta/15 text-cinema-magenta"
                            : g.status === "done"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "text-cinema-muted"
                      )}
                    >
                      {g.status || "idle"}
                    </span>
                  </div>

                  {/* PARAMS — kept above the prompt so settings read as node config, not prose */}
                  <div
                    className="space-y-2 border-b border-cinema-border/60 bg-cinema-black/25 px-2 py-2"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block">
                        <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                          Model
                        </span>
                        <select
                          value={family}
                          onChange={(e) => {
                            const next = e.target.value as NonNullable<CanvasGenNode["family"]>;
                            updateDoc((prev) => ({
                              ...prev,
                              gens: (prev.gens || []).map((n) =>
                                n.id === g.id ? { ...n, family: next, model: next } : n
                              ),
                            }));
                          }}
                          className="w-full rounded border border-cinema-border bg-cinema-black/80 px-1.5 py-1 text-[10px] text-white outline-none focus:border-cinema-cyan/50"
                          title="Auto picks local Forge/Comfy or cloud from Settings"
                        >
                          <option value="auto">Auto</option>
                          <option value="sd">Stable Diffusion</option>
                          <option value="flux1">Flux 1</option>
                          <option value="qwen-image">Qwen Image</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                          Aspect
                        </span>
                        <select
                          value={g.aspect || "16:9"}
                          onChange={(e) => {
                            const aspect = e.target.value as NonNullable<CanvasGenNode["aspect"]>;
                            updateDoc((prev) => ({
                              ...prev,
                              gens: (prev.gens || []).map((n) =>
                                n.id === g.id ? { ...n, aspect } : n
                              ),
                            }));
                          }}
                          className="w-full rounded border border-cinema-border bg-cinema-black/80 px-1.5 py-1 text-[10px] text-white outline-none focus:border-cinema-cyan/50"
                          title="Output aspect ratio"
                        >
                          <option value="16:9">16:9</option>
                          <option value="9:16">9:16</option>
                          <option value="1:1">1:1</option>
                          <option value="4:3">4:3</option>
                          <option value="21:9">21:9</option>
                        </select>
                      </label>
                    </div>

                    <div>
                      <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                        Match reference
                      </span>
                      <div className="flex overflow-hidden rounded border border-cinema-border">
                        {(["soft", "balanced", "close"] as const).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              updateDoc((prev) => ({
                                ...prev,
                                gens: (prev.gens || []).map((n) =>
                                  n.id === g.id
                                    ? { ...n, look: opt, strength: LOOK_STRENGTH[opt] }
                                    : n
                                ),
                              }))
                            }
                            className={cn(
                              "flex-1 border-r border-cinema-border px-1 py-1 text-[10px] capitalize last:border-r-0",
                              look === opt
                                ? "bg-cinema-cyan/15 text-cinema-cyan"
                                : "text-cinema-muted hover:text-white"
                            )}
                            title={
                              opt === "soft"
                                ? "Loose variation"
                                : opt === "close"
                                  ? "Stay near the reference"
                                  : "Balanced match"
                            }
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="block">
                        <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                          Quality
                        </span>
                        <select
                          value={g.quality || "standard"}
                          onChange={(e) => {
                            const quality = e.target.value as NonNullable<
                              CanvasGenNode["quality"]
                            >;
                            const size =
                              quality === "low" ? "1024" : quality === "high" ? "1536" : "1280";
                            updateDoc((prev) => ({
                              ...prev,
                              gens: (prev.gens || []).map((n) =>
                                n.id === g.id
                                  ? { ...n, quality, size: size as CanvasGenNode["size"] }
                                  : n
                              ),
                            }));
                          }}
                          className="w-full rounded border border-cinema-border bg-cinema-black/80 px-1.5 py-1 text-[10px] text-white outline-none focus:border-cinema-cyan/50"
                          title="Render size"
                        >
                          <option value="low">Low · 1024</option>
                          <option value="standard">Standard · 1280</option>
                          <option value="high">High · 1536</option>
                        </select>
                      </label>
                      <div>
                        <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                          Variants
                        </span>
                        <div className="flex overflow-hidden rounded border border-cinema-border">
                          {([1, 2, 4] as const).map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() =>
                                updateDoc((prev) => ({
                                  ...prev,
                                  gens: (prev.gens || []).map((n) =>
                                    n.id === g.id ? { ...n, variants: v } : n
                                  ),
                                }))
                              }
                              className={cn(
                                "flex-1 border-r border-cinema-border px-1 py-1 text-[10px] last:border-r-0",
                                (g.variants || 1) === v
                                  ? "bg-cinema-cyan/15 text-cinema-cyan"
                                  : "text-cinema-muted hover:text-white"
                              )}
                              title={`${v} variant${v > 1 ? "s" : ""}`}
                            >
                              ×{v}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Native disclosure keeps rarely-used hints out of the default node height */}
                    <details className="group">
                      <summary className="cursor-pointer list-none text-[9px] uppercase tracking-[0.08em] text-cinema-muted hover:text-white">
                        <span className="group-open:hidden">+ Framing hints</span>
                        <span className="hidden group-open:inline">− Framing hints</span>
                      </summary>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                        <input
                          value={g.shotHint || ""}
                          onChange={(e) => {
                            const shotHint = e.target.value;
                            updateDoc((prev) => ({
                              ...prev,
                              gens: (prev.gens || []).map((n) =>
                                n.id === g.id ? { ...n, shotHint } : n
                              ),
                            }));
                          }}
                          placeholder="Shot type"
                          aria-label="Shot type hint"
                          className="min-w-0 rounded border border-cinema-border bg-cinema-black/80 px-1.5 py-1 text-[10px] text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan/50"
                        />
                        <input
                          value={g.angleHint || ""}
                          onChange={(e) => {
                            const angleHint = e.target.value;
                            updateDoc((prev) => ({
                              ...prev,
                              gens: (prev.gens || []).map((n) =>
                                n.id === g.id ? { ...n, angleHint } : n
                              ),
                            }));
                          }}
                          placeholder="Angle"
                          aria-label="Camera angle hint"
                          className="min-w-0 rounded border border-cinema-border bg-cinema-black/80 px-1.5 py-1 text-[10px] text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan/50"
                        />
                      </div>
                    </details>
                  </div>

                  {/* REFS — inputs feeding this node */}
                  {refs.length > 0 ? (
                    <div className="flex items-center gap-1 overflow-x-auto px-2 pt-2">
                      <span className="shrink-0 text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                        Refs
                      </span>
                      {refs.slice(0, 6).map((sid) => {
                        const shot = shotMap.get(sid);
                        const src = artifactUrl(
                          shot?.thumb_md_url || shot?.thumb_url || shot?.keyframe_url
                        );
                        return (
                          <div
                            key={sid}
                            className="h-9 w-9 shrink-0 overflow-hidden rounded border border-cinema-border bg-cinema-black"
                            title={shot?.source_title || shot?.source_filename || "Linked ref"}
                          >
                            {src ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={src} alt="" className="h-full w-full object-cover" />
                            ) : null}
                          </div>
                        );
                      })}
                      {refs.length > 6 ? (
                        <span className="self-center text-[9px] text-cinema-muted">
                          +{refs.length - 6}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <p className="px-2.5 pt-2 text-[10px] text-cinema-muted">
                      Link a frame as reference
                    </p>
                  )}

                  {/* PROMPT — last input before Run, mirrors the read order of the node */}
                  <div className="px-2 pt-2" onPointerDown={(e) => e.stopPropagation()}>
                    <span className="mb-0.5 block text-[8px] uppercase tracking-[0.08em] text-cinema-muted">
                      Prompt
                    </span>
                    <textarea
                      value={g.prompt}
                      onChange={(e) => {
                        const prompt = e.target.value;
                        updateDoc((prev) => ({
                          ...prev,
                          gens: (prev.gens || []).map((n) =>
                            n.id === g.id ? { ...n, prompt } : n
                          ),
                        }));
                      }}
                      placeholder="What should change? warmer practicals, rain…"
                      aria-label="Generate prompt"
                      rows={3}
                      className="w-full resize-none rounded border border-cinema-border bg-cinema-black/80 px-2 py-1.5 text-[11px] leading-snug text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan/50"
                    />
                  </div>

                  <div className="flex items-center gap-2 border-t border-cinema-border/60 px-2.5 py-2">
                    {canGenerate ? (
                      <button
                        type="button"
                        disabled={running}
                        onClick={(e) => {
                          e.stopPropagation();
                          void runGenNode(g.id);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-cinema-cyan/20 px-2 py-1.5 text-[11px] text-cinema-cyan hover:bg-cinema-cyan/30 disabled:opacity-40"
                      >
                        <Sparkles className="h-3 w-3" />
                        {running ? "Running…" : "Run"}
                      </button>
                    ) : (
                      <a
                        href={PRO_UPGRADE_URL}
                        target="_blank"
                        rel="noreferrer"
                        onPointerDown={(e) => e.stopPropagation()}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-amber-500/40 px-2 py-1.5 text-[11px] text-amber-200"
                      >
                        <Crown className="h-3 w-3" />
                        Pro to Run
                      </a>
                    )}
                  </div>
                  {g.error ? (
                    <p className="px-2.5 pb-2 text-[10px] text-cinema-magenta">{g.error}</p>
                  ) : null}
                </div>
              );
            })}

            {doc.texts.map((t) => {
              const selKey = `text:${t.id}`;
              const selected = selectedIds.has(selKey);
              const fontSize = t.fontSize ?? TEXT_STYLE_DEFAULTS[t.style];
              const fontWeight =
                t.weight === "bold" ? 700 : t.weight === "medium" ? 500 : 400;
              return (
              <div
                key={t.id}
                data-canvas-item
                className={cn(
                  "absolute",
                  selected && "ring-1 ring-cinema-cyan/50 rounded-sm"
                )}
                style={{ left: t.x, top: t.y, width: t.w, zIndex: t.z || 10 }}
              >
                <div
                  className={cn(
                    "mb-0.5 flex items-center gap-1",
                    selected ? "opacity-100" : "opacity-0 hover:opacity-70"
                  )}
                  onPointerDown={(e) => {
                    if (panning || spaceDown.current) return;
                    e.stopPropagation();
                    e.preventDefault();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(selKey)) next.delete(selKey);
                        else next.add(selKey);
                        return next;
                      });
                    } else {
                      setSelectedIds(new Set([selKey]));
                    }
                    const start = screenToWorld(e.clientX, e.clientY);
                    dragOffset.current = { x: start.x - t.x, y: start.y - t.y };
                    setDragging(`text:${t.id}`);
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                  title="Drag to move"
                >
                  <span className="h-1 w-8 cursor-grab rounded-full bg-white/25 active:cursor-grabbing" />
                  <span className="text-[9px] text-cinema-muted">move</span>
                </div>
                <textarea
                  value={t.text}
                  onChange={(e) => {
                    const text = e.target.value;
                    updateDoc((prev) => ({
                      ...prev,
                      texts: prev.texts.map((n) => (n.id === t.id ? { ...n, text } : n)),
                    }));
                  }}
                  onFocus={() => setSelectedIds(new Set([selKey]))}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setSelectedIds(new Set([selKey]));
                  }}
                  rows={t.style === "title" || t.style === "caption" || t.style === "label" ? 1 : 3}
                  style={{
                    fontSize,
                    fontWeight,
                    textAlign: t.align || "left",
                    color: t.color || undefined,
                  }}
                  className={cn(
                    "w-full resize-none border-0 bg-transparent outline-none placeholder:text-cinema-muted",
                    !t.color &&
                      (t.style === "caption" || t.style === "label" || t.style === "body"
                        ? "text-cinema-muted"
                        : "text-white"),
                    t.style === "caption" && "uppercase tracking-widest",
                    t.style === "label" && "uppercase tracking-wide",
                    t.style === "title" && "tracking-tight"
                  )}
                />
                <div className="mt-0.5 flex gap-2">
                  <button
                    type="button"
                    className="text-[10px] text-cinema-muted hover:text-cinema-cyan"
                    onClick={() =>
                      updateDoc((prev) => ({
                        ...prev,
                        texts: prev.texts.map((n) =>
                          n.id === t.id ? { ...n, z: Date.now() } : n
                        ),
                      }))
                    }
                  >
                    Front
                  </button>
                  <button
                    type="button"
                    className="text-[10px] text-cinema-muted hover:text-cinema-magenta"
                    onClick={() => {
                      updateDoc((prev) => ({
                        ...prev,
                        texts: prev.texts.filter((n) => n.id !== t.id),
                      }));
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(selKey);
                        return next;
                      });
                    }}
                  >
                    Delete
                  </button>
                </div>
                {selected ? (
                  <div
                    className="absolute bottom-0 right-0 h-3 w-3 cursor-se-resize rounded-sm border border-cinema-cyan/50 bg-cinema-cyan/30"
                    title="Resize width"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      setSelectedIds(new Set([selKey]));
                      resizeStart.current = { w: t.w, clientX: e.clientX };
                      setResizing(`text:${t.id}`);
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                  />
                ) : null}
              </div>
              );
            })}

            {doc.notes.map((note) => {
              const selKey = `note:${note.id}`;
              const selected = selectedIds.has(selKey);
              const pastel = theme.stickyStyle === "pastel";
              const colorKey = note.color || "yellow";
              return (
              <div
                key={note.id}
                data-canvas-item
                className={cn(
                  "absolute rounded-md border p-2 shadow-md",
                  pastel ? STICKY_COLORS[colorKey] : STICKY_QUIET[colorKey],
                  selected && "ring-2 ring-cinema-cyan/40"
                )}
                style={{ left: note.x, top: note.y, width: note.w, zIndex: note.z || 10 }}
                onPointerDown={(e) => {
                  if (panning || spaceDown.current) return;
                  e.stopPropagation();
                  e.preventDefault();
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(selKey)) next.delete(selKey);
                      else next.add(selKey);
                      return next;
                    });
                  } else if (!selectedIds.has(selKey)) {
                    setSelectedIds(new Set([selKey]));
                  }
                  const start = screenToWorld(e.clientX, e.clientY);
                  dragOffset.current = { x: start.x - note.x, y: start.y - note.y };
                  setDragging(`note:${note.id}`);
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
              >
                <textarea
                  value={note.text}
                  placeholder="Script beat, reference, idea…"
                  onChange={(e) => {
                    const text = e.target.value;
                    updateDoc((prev) => ({
                      ...prev,
                      notes: prev.notes.map((n) => (n.id === note.id ? { ...n, text } : n)),
                    }));
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    "min-h-[4.5rem] w-full resize-none bg-transparent text-xs outline-none",
                    pastel
                      ? "text-stone-900 placeholder:text-stone-500"
                      : "text-zinc-100 placeholder:text-zinc-500"
                  )}
                />
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {(Object.keys(STICKY_COLORS) as (keyof typeof STICKY_COLORS)[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      className={cn(
                        "h-3.5 w-3.5 rounded-sm border",
                        pastel ? "border-black/20" : "border-white/20",
                        pastel ? STICKY_COLORS[c] : STICKY_QUIET[c],
                        (note.color || "yellow") === c &&
                          (pastel ? "ring-1 ring-stone-800" : "ring-1 ring-cinema-cyan/60")
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        updateDoc((prev) => ({
                          ...prev,
                          notes: prev.notes.map((n) =>
                            n.id === note.id ? { ...n, color: c } : n
                          ),
                        }));
                      }}
                    />
                  ))}
                  <button
                    type="button"
                    className={cn(
                      "ml-auto text-[10px]",
                      pastel
                        ? "text-stone-600 hover:text-stone-900"
                        : "text-zinc-500 hover:text-zinc-200"
                    )}
                    onClick={() =>
                      updateDoc((prev) => ({
                        ...prev,
                        notes: prev.notes.filter((n) => n.id !== note.id),
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
              );
            })}

            {doc.media.map((m) => {
              const selKey = `media:${m.id}`;
              const selected = selectedIds.has(selKey);
              return (
              <div
                key={m.id}
                data-canvas-item
                className={cn(
                  "absolute overflow-hidden rounded-md border bg-cinema-panel shadow-lg",
                  selected
                    ? "border-cinema-cyan ring-1 ring-cinema-cyan/40"
                    : "border-cinema-border"
                )}
                style={{ left: m.x, top: m.y, width: m.w, zIndex: 10 }}
                onPointerDown={(e) => {
                  if (panning || spaceDown.current) return;
                  e.stopPropagation();
                  e.preventDefault();
                  if (e.shiftKey || e.metaKey || e.ctrlKey) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(selKey)) next.delete(selKey);
                      else next.add(selKey);
                      return next;
                    });
                  } else if (!selectedIds.has(selKey)) {
                    setSelectedIds(new Set([selKey]));
                  }
                  const start = screenToWorld(e.clientX, e.clientY);
                  dragOffset.current = { x: start.x - m.x, y: start.y - m.y };
                  setDragging(`media:${m.id}`);
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                }}
              >
                <div className="flex items-center justify-between border-b border-cinema-border px-2 py-1">
                  <span className="truncate text-[10px] text-cinema-cyan">{m.label}</span>
                  <button
                    type="button"
                    className="text-[10px] text-cinema-muted hover:text-cinema-magenta"
                    onClick={() =>
                      updateDoc((prev) => ({
                        ...prev,
                        media: prev.media.filter((n) => n.id !== m.id),
                      }))
                    }
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    ×
                  </button>
                </div>
                <div className="p-2" onPointerDown={(e) => e.stopPropagation()}>
                  {m.kind === "audio" ? (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <audio src={m.url} controls className="w-full" />
                  ) : m.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.label} className="w-full rounded object-cover" />
                  ) : (
                    <a
                      href={m.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate text-[11px] text-cinema-cyan underline"
                    >
                      {m.url}
                    </a>
                  )}
                </div>
                {selected ? (
                  <div
                    className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 cursor-se-resize rounded-tl bg-cinema-cyan/80"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      resizeStart.current = { w: m.w, clientX: e.clientX };
                      setResizing(`media:${m.id}`);
                      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                    }}
                  />
                ) : null}
              </div>
              );
            })}

            {doc.stacks.map((st) => {
              const active = shotMap.get(st.shotIds[st.activeIndex] || st.shotIds[0]);
              const selKey = `stack:${st.id}`;
              const selected = selectedIds.has(selKey);
              return (
                <div
                  key={st.id}
                  data-canvas-item
                  className={cn("absolute", selected && "z-20")}
                  style={{ left: st.x, top: st.y, width: st.w, zIndex: selected ? 20 : 10 }}
                  onPointerDown={(e) => {
                    if (panning || spaceDown.current) return;
                    e.stopPropagation();
                    e.preventDefault();
                    if (e.shiftKey || e.metaKey || e.ctrlKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(selKey)) next.delete(selKey);
                        else next.add(selKey);
                        return next;
                      });
                    } else if (!selectedIds.has(selKey)) {
                      setSelectedIds(new Set([selKey]));
                    }
                    const world = screenToWorld(e.clientX, e.clientY);
                    dragOffset.current = { x: world.x - st.x, y: world.y - st.y };
                    setDragging(`stack:${st.id}`);
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                >
                  {st.shotIds.slice(0, 3).map((_, i) => (
                    <div
                      key={i}
                      className="absolute rounded-md border border-cinema-border bg-cinema-black shadow-md"
                      style={{
                        left: i * 6,
                        top: i * 6,
                        width: st.w,
                        height: st.w * 0.62,
                        zIndex: i,
                      }}
                    />
                  ))}
                  <div
                    className={cn(
                      "relative z-10 overflow-hidden rounded-md border bg-cinema-black shadow-lg",
                      selected ? "border-cinema-cyan ring-1 ring-cinema-cyan/40" : "border-cinema-cyan/50"
                    )}
                    style={{ width: st.w }}
                  >
                    {active ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={artifactUrl(active.thumb_md_url || active.thumb_url)}
                        alt=""
                        className="pointer-events-none block w-full select-none"
                        draggable={false}
                      />
                    ) : (
                      <div className="aspect-video bg-cinema-panel" />
                    )}
                    <div className="flex items-center justify-between gap-1 border-t border-cinema-border bg-cinema-surface/95 px-1.5 py-1">
                      {editingStackId === st.id ? (
                        <input
                          autoFocus
                          defaultValue={st.label}
                          className="min-w-0 flex-1 rounded border border-cinema-border bg-cinema-black px-1 text-[10px] text-white outline-none"
                          onBlur={(e) => {
                            const label = e.target.value.trim() || st.label;
                            updateDoc((prev) => ({
                              ...prev,
                              stacks: prev.stacks.map((x) =>
                                x.id === st.id ? { ...x, label } : x
                              ),
                            }));
                            setEditingStackId(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <button
                          type="button"
                          className="truncate text-[10px] text-cinema-cyan"
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            setEditingStackId(st.id);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          {st.label}
                        </button>
                      )}
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          className="px-1 text-[10px] text-cinema-muted hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateDoc((prev) => ({
                              ...prev,
                              stacks: prev.stacks.map((x) =>
                                x.id === st.id
                                  ? {
                                      ...x,
                                      activeIndex:
                                        (x.activeIndex - 1 + x.shotIds.length) % x.shotIds.length,
                                    }
                                  : x
                              ),
                            }));
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          ‹
                        </button>
                        <span className="text-[9px] text-cinema-muted">
                          {st.activeIndex + 1}/{st.shotIds.length}
                        </span>
                        <button
                          type="button"
                          className="px-1 text-[10px] text-cinema-muted hover:text-white"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateDoc((prev) => ({
                              ...prev,
                              stacks: prev.stacks.map((x) =>
                                x.id === st.id
                                  ? {
                                      ...x,
                                      activeIndex: (x.activeIndex + 1) % x.shotIds.length,
                                    }
                                  : x
                              ),
                            }));
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          title="Unstack"
                          className="px-1 text-[10px] text-cinema-muted hover:text-cinema-magenta"
                          onClick={(e) => {
                            e.stopPropagation();
                            unstack(st.id);
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {canvasShots.map((shot, i) => {
              if (stackedShotIds.has(shot.id)) return null;
              const pos = doc.positions[shot.id] || {
                x: CANVAS_W / 2 - 800 + (i % 8) * (DEFAULT_W + 40),
                y: CANVAS_H / 2 - 400 + Math.floor(i / 8) * 180,
                w: DEFAULT_W,
              };
              const selected = selectedIds.has(shot.id);
              const linking = linkFrom === shot.id;
              const caps = theme.showCaptions ? shotCaptionLines(shot) : [];
              const showBorder = theme.showFrameBorder || selected || linking;
              const connectedSides = new Set<PortSide>();
              for (const ed of doc.edges) {
                if (ed.a !== shot.id && ed.b !== shot.id) continue;
                const boxA = nodeBoxForId(ed.a, doc, shotMap);
                const boxB = nodeBoxForId(ed.b, doc, shotMap);
                if (!boxA || !boxB) continue;
                const sides = pickPortSides(boxA, boxB);
                if (ed.a === shot.id) connectedSides.add(sides.out);
                if (ed.b === shot.id) connectedSides.add(sides.inn);
              }
              return (
                <div
                  key={shot.id}
                  data-canvas-item
                  onPointerDown={(e) => onShotPointerDown(e, shot.id)}
                  onDoubleClick={() => onSelect?.(shot)}
                  className={cn(
                    "absolute cursor-grab bg-cinema-black shadow-lg active:cursor-grabbing",
                    showBorder ? "border" : "border-0",
                    selected || linking
                      ? "ring-2 ring-cinema-cyan/30"
                      : theme.showFrameBorder
                        ? "border-cinema-border/80"
                        : "",
                    dragging === shot.id && "z-30"
                  )}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    width: pos.w,
                    zIndex: dragging === shot.id ? 30 : selected || linking ? 20 : 10,
                    borderRadius: theme.cardRadius,
                    borderColor:
                      selected || linking
                        ? theme.accent
                        : theme.showFrameBorder
                          ? undefined
                          : "transparent",
                    borderWidth: showBorder ? undefined : 0,
                    boxShadow:
                      selected || linking ? `0 0 0 2px ${theme.accent}55` : undefined,
                  }}
                >
                  {(["left", "right"] as PortSide[]).map((side) => (
                    <button
                      key={side}
                      type="button"
                      data-port={side === "left" ? "in" : "out"}
                      title={side}
                      className={portClass(side, connectedSides.has(side))}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        beginOrCompleteLink(shot.id);
                      }}
                    />
                  ))}
                  {(["top", "bottom"] as PortSide[])
                    .filter((side) => connectedSides.has(side))
                    .map((side) => (
                      <button
                        key={side}
                        type="button"
                        data-port={side}
                        title={side}
                        className={portClass(side, true, false)}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          beginOrCompleteLink(shot.id);
                        }}
                      />
                    ))}
                  <div className="overflow-hidden" style={{ borderRadius: theme.cardRadius }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={artifactUrl(shot.thumb_md_url || shot.thumb_url)}
                      alt=""
                      className="pointer-events-none block w-full select-none"
                      draggable={false}
                    />
                    {(shot.dominant_colors?.length ?? 0) > 0 ? (
                      <div className="flex h-1.5 w-full overflow-hidden">
                        {shot.dominant_colors.slice(0, 5).map((c) => (
                          <span
                            key={`${shot.id}-${c.hex}`}
                            title={`${c.hex} · ${c.percentage}%`}
                            className="h-full"
                            style={{
                              backgroundColor: c.hex,
                              width: `${Math.max(8, c.percentage)}%`,
                              flexGrow: Math.max(1, c.percentage),
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
                    {theme.showCaptions && caps.length > 0 ? (
                      <div
                        className="space-y-0.5 border-t border-white/10 px-1.5 py-1"
                        style={{ background: "rgba(0,0,0,0.72)" }}
                      >
                        {caps.map((line) => (
                          <div
                            key={line}
                            className="truncate font-mono text-[9px] leading-tight text-white/90"
                          >
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {selected ? (
                    <div
                      className="absolute bottom-0 right-0 z-10 h-3.5 w-3.5 cursor-se-resize rounded-tl bg-cinema-cyan/80"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        resizeStart.current = { w: pos.w, clientX: e.clientX };
                        setResizing(shot.id);
                        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>

          {marquee ? (
            <div
              className="pointer-events-none absolute z-20 border border-cinema-cyan/70 bg-cinema-cyan/10"
              style={{
                left:
                  Math.min(marquee.x0, marquee.x1) * doc.view.scale + doc.view.x,
                top:
                  Math.min(marquee.y0, marquee.y1) * doc.view.scale + doc.view.y,
                width: Math.abs(marquee.x1 - marquee.x0) * doc.view.scale,
                height: Math.abs(marquee.y1 - marquee.y0) * doc.view.scale,
              }}
            />
          ) : null}

          {createMenu ? (
            <div
              className="absolute z-50 w-44 overflow-hidden rounded-md border border-cinema-border bg-cinema-panel shadow-xl"
              style={{
                left: Math.min(createMenu.screenX, Math.max(8, vpSize.width - 180)),
                top: Math.min(createMenu.screenY, Math.max(8, vpSize.height - 180)),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-cinema-border px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                Create
              </div>
              {(
                [
                  ["text", "Text", Type],
                  ["sticky", "Sticky", StickyNoteIcon],
                  ["generate", "Generate", Sparkles],
                  ["media", "Media", LinkIcon],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-white hover:bg-cinema-cyan/10"
                  onClick={() => {
                    const at = { x: createMenu.worldX, y: createMenu.worldY };
                    let newId: string | null = null;
                    if (key === "text") newId = addText("title", at);
                    else if (key === "sticky") newId = addNote("yellow", at);
                    else if (key === "generate") newId = addGenNode(at);
                    else {
                      setMediaAt(at);
                      setMediaForm("link");
                      setCreateMenu(null);
                      return;
                    }
                    if (newId && linkFrom) {
                      const from = linkFrom;
                      const to = newId;
                      updateDoc((prev) => {
                        const exists = prev.edges.some(
                          (ed) =>
                            (ed.a === from && ed.b === to) ||
                            (ed.a === to && ed.b === from)
                        );
                        if (exists) return prev;
                        return {
                          ...prev,
                          edges: [...prev.edges, { id: `${from}-${to}`, a: from, b: to }],
                        };
                      });
                      setLinkFrom(null);
                      setLinkMode(false);
                      setLinkCursor(null);
                    }
                  }}
                >
                  <Icon className="h-3.5 w-3.5 text-cinema-cyan" />
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <CanvasMinimap doc={doc} viewport={vpSize} onJump={jumpToWorld} />

          <CanvasFloatingToolbar
            canUndo={historyTick >= 0 && historyRef.current.length > 0}
            canRedo={historyTick >= 0 && futureRef.current.length > 0}
            showFrameBorder={Boolean(theme.showFrameBorder)}
            hasSelection={selectedIds.size > 0}
            hasShotSelection={
              [...selectedIds].filter(
                (id) =>
                  !isGenNodeId(id) &&
                  !isNoteId(id) &&
                  !isTextId(id) &&
                  !isMediaId(id) &&
                  !isStackId(id)
              ).length >= 2
            }
            linkMode={linkMode}
            zoomPct={Math.round(doc.view.scale * 100)}
            onUndo={undo}
            onRedo={redo}
            onZoomIn={() => zoomBy(1.12)}
            onZoomOut={() => zoomBy(1 / 1.12)}
            onFit={fitView}
            onBringForward={bringForward}
            onDelete={deleteSelection}
            onToggleFrameBorders={() =>
              patchTheme({ showFrameBorder: !theme.showFrameBorder })
            }
            onAlignLeft={alignSelectedLeft}
            onRow={rowSelectedShots}
            onToggleLink={() => {
              if (linkMode) {
                setLinkMode(false);
                setLinkFrom(null);
                setLinkCursor(null);
              } else {
                setLinkMode(true);
              }
            }}
            onAddText={() => addText("title")}
            onAddSticky={() => addNote("yellow")}
            onAddGenerate={() => addGenNode()}
          />
        </div>

        <CanvasShotRail
          shots={shots}
          onBoardIds={onBoardIds}
          onAddAtCenter={addAtCenter}
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((v) => !v)}
        />
      </div>

      <CanvasShotlistPanel
        rows={doc.shotlist || []}
        shots={canvasShots}
        collapsed={!shotlistOpen}
        onToggle={() => setShotlistOpen((v) => !v)}
        onChange={(rows) => updateDoc((prev) => ({ ...prev, shotlist: rows }))}
        onFocusShot={(shotId) => {
          const pos = doc.positions[shotId];
          if (pos) jumpToWorld(pos.x + pos.w / 2, pos.y + 60);
          setSelectedIds(new Set([shotId]));
        }}
      />
    </div>
  );
}
