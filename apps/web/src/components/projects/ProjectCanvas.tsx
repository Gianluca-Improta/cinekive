"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
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
} from "lucide-react";
import { api, artifactUrl } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import {
  CANVAS_SHOT_MIME,
  emptyCanvasDoc,
  normalizeCanvasDoc,
  type CanvasDoc,
  type CanvasGroup,
  type CanvasMedia,
  type CanvasPos,
  type CanvasStack,
  type CanvasText,
} from "@/lib/canvas-types";
import { cn } from "@/lib/utils";
import { CanvasShotRail } from "@/components/projects/CanvasShotRail";

type Props = {
  projectId: string;
  shots: Shot[];
  onSelect?: (shot: Shot) => void;
  /** Prefer this board when opening from Send to board */
  initialCollectionId?: string | null;
};

const CANVAS_W = 20000;
const CANVAS_H = 20000;
const DEFAULT_W = 220;
const MIN_SCALE = 0.05;
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

function centerOf(pos: CanvasPos): { x: number; y: number } {
  const h = pos.w * 0.62;
  return { x: pos.x + pos.w / 2, y: pos.y + h / 2 };
}

function softCurve(ax: number, ay: number, bx: number, by: number) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * Math.min(80, len * 0.15);
  const ny = (dx / len) * Math.min(80, len * 0.15);
  return `M ${ax} ${ay} Q ${mx + nx} ${my + ny} ${bx} ${by}`;
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
}: Props) {
  const qc = useQueryClient();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<CanvasDoc>(emptyCanvasDoc());
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(
    initialCollectionId || null
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [linkMode, setLinkMode] = useState(false);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [mediaForm, setMediaForm] = useState<"audio" | "image" | "link" | null>(null);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaLabel, setMediaLabel] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingStackId, setEditingStackId] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const spaceDown = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: canvases = [] } = useQuery({
    queryKey: ["collections", "canvas", projectId],
    queryFn: () => api.listCollections({ project_id: projectId, kind: "canvas" }),
  });

  useEffect(() => {
    if (initialCollectionId) setActiveCanvasId(initialCollectionId);
  }, [initialCollectionId]);

  useEffect(() => {
    if (!canvases.length) {
      setActiveCanvasId(null);
      return;
    }
    if (!activeCanvasId || !canvases.some((c) => c.id === activeCanvasId)) {
      setActiveCanvasId(canvases[0].id);
    }
  }, [canvases, activeCanvasId]);

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
        persist(next);
        return next;
      });
    },
    [persist]
  );

  useEffect(() => {
    if (!canvas?.id) return;
    const fromServer = docFromMeta(detail?.meta as Record<string, unknown> | undefined);
    const fromLocal = loadDocLocal(canvas.id);
    const serverN = fromServer ? Object.keys(fromServer.positions).length : 0;
    const localN = Object.keys(fromLocal.positions).length;
    setDoc(serverN >= localN && fromServer ? fromServer : fromLocal);
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
      if (e.key === "Escape") {
        setLinkMode(false);
        setLinkFrom(null);
        setSelectedIds(new Set());
        setMediaForm(null);
        setEditingGroupId(null);
        setEditingStackId(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        if (canvas?.id) {
          const ids = [...selectedIds];
          void api.removeFromCollection(canvas.id, ids).then(() => {
            qc.invalidateQueries({ queryKey: ["collection", canvas.id] });
            updateDoc((prev) => {
              const positions = { ...prev.positions };
              for (const id of ids) delete positions[id];
              return {
                ...prev,
                positions,
                edges: prev.edges.filter((ed) => !ids.includes(ed.a) && !ids.includes(ed.b)),
                groups: prev.groups.map((g) => ({
                  ...g,
                  shotIds: g.shotIds.filter((id) => !ids.includes(id)),
                })),
                stacks: prev.stacks
                  .map((st) => ({
                    ...st,
                    shotIds: st.shotIds.filter((id) => !ids.includes(id)),
                  }))
                  .filter((st) => st.shotIds.length > 0),
              };
            });
            setSelectedIds(new Set());
          });
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, [selectedIds, canvas?.id, qc, updateDoc]);

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

  const addText = (style: CanvasText["style"] = "title") => {
    const vp = viewportRef.current?.getBoundingClientRect();
    const c = vp
      ? viewportCenterWorld(doc.view, vp)
      : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    const id = `text-${Date.now()}`;
    const item: CanvasText = {
      id,
      x: c.x - 140,
      y: c.y - 24,
      w: style === "title" ? 320 : 280,
      text: style === "title" ? "Concept" : "Note…",
      style,
    };
    updateDoc((prev) => ({ ...prev, texts: [...prev.texts, item] }));
  };

  const addNote = () => {
    const vp = viewportRef.current?.getBoundingClientRect();
    const c = vp
      ? viewportCenterWorld(doc.view, vp)
      : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
    const id = `note-${Date.now()}`;
    updateDoc((prev) => ({
      ...prev,
      notes: [
        ...prev.notes,
        { id, x: c.x - 120, y: c.y - 60, w: 240, text: "" },
      ],
    }));
  };

  const submitMedia = () => {
    const url = mediaUrl.trim();
    if (!url || !mediaForm) return;
    const vp = viewportRef.current?.getBoundingClientRect();
    const c = vp
      ? viewportCenterWorld(doc.view, vp)
      : { x: CANVAS_W / 2, y: CANVAS_H / 2 };
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
    setMediaUrl("");
    setMediaLabel("");
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
    e.preventDefault();
    const vp = viewportRef.current?.getBoundingClientRect();
    if (!vp) return;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, doc.view.scale * factor));
    const mx = e.clientX - vp.left;
    const my = e.clientY - vp.top;
    const wx = (mx - doc.view.x) / doc.view.scale;
    const wy = (my - doc.view.y) / doc.view.scale;
    updateDoc((prev) => ({
      ...prev,
      view: {
        scale: nextScale,
        x: mx - wx * nextScale,
        y: my - wy * nextScale,
      },
    }));
  };

  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2 || spaceDown.current || e.altKey) {
      e.preventDefault();
      setPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY, vx: doc.view.x, vy: doc.view.y };
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    }
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (panning) {
      updateDoc((prev) => ({
        ...prev,
        view: {
          ...prev.view,
          x: panStart.current.vx + (e.clientX - panStart.current.x),
          y: panStart.current.vy + (e.clientY - panStart.current.y),
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
      updateDoc((prev) => ({
        ...prev,
        stacks: prev.stacks.map((st) =>
          st.id === stackId
            ? {
                ...st,
                x: Math.max(0, nx),
                y: Math.max(0, ny),
              }
            : st
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
    setPanning(false);
    setDragging(null);
  };

  const onShotPointerDown = (e: React.PointerEvent, shotId: string) => {
    if (panning || spaceDown.current) return;
    e.stopPropagation();
    e.preventDefault();
    if (linkMode) {
      if (!linkFrom) {
        setLinkFrom(shotId);
      } else if (linkFrom !== shotId) {
        const id = `${linkFrom}-${shotId}`;
        updateDoc((prev) => {
          const exists = prev.edges.some(
            (ed) =>
              (ed.a === linkFrom && ed.b === shotId) || (ed.a === shotId && ed.b === linkFrom)
          );
          if (exists) return prev;
          return { ...prev, edges: [...prev.edges, { id, a: linkFrom, b: shotId }] };
        });
        setLinkFrom(null);
      }
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
    }
    const pos = doc.positions[shotId] || { x: 0, y: 0, w: DEFAULT_W };
    const world = screenToWorld(e.clientX, e.clientY);
    dragOffset.current = { x: world.x - pos.x, y: world.y - pos.y };
    setDragging(shotId);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const groupSelected = () => {
    if (selectedIds.size < 2) return;
    const ids = [...selectedIds];
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
    if (selectedIds.size < 2) return;
    const ids = [...selectedIds];
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
          backgroundColor: "#0c0e12",
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.14) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
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
            onClick={() =>
              updateDoc((p) => ({
                ...p,
                view: { ...p.view, scale: Math.max(MIN_SCALE, p.view.scale * 0.85) },
              }))
            }
            className="px-2 py-1.5 text-cinema-muted hover:text-white"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Zoom in"
            onClick={() =>
              updateDoc((p) => ({
                ...p,
                view: { ...p.view, scale: Math.min(MAX_SCALE, p.view.scale * 1.15) },
              }))
            }
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
        <button
          type="button"
          onClick={() => addText("title")}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Add a title / concept label"
        >
          <Type className="h-3.5 w-3.5" />
          Text
        </button>
        <button
          type="button"
          onClick={addNote}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Add a sticky note"
        >
          <StickyNoteIcon className="h-3.5 w-3.5" />
          Sticky
        </button>
        <button
          type="button"
          onClick={() => setMediaForm("audio")}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Add audio URL"
        >
          <AudioLines className="h-3.5 w-3.5" />
          Audio
        </button>
        <button
          type="button"
          onClick={() => setMediaForm("link")}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
          title="Add image or link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
          Media
        </button>
        <button
          type="button"
          onClick={groupSelected}
          disabled={selectedIds.size < 2}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-white disabled:opacity-40"
          title="Name a visual concept around selection"
        >
          <Group className="h-3.5 w-3.5" />
          Concept
        </button>
        <button
          type="button"
          onClick={stackSelected}
          disabled={selectedIds.size < 2}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-white disabled:opacity-40"
          title="Stack frames into one pile"
        >
          <Layers className="h-3.5 w-3.5" />
          Stack
        </button>
        <button
          type="button"
          onClick={dissolveGroupsForSelection}
          disabled={!selectedIds.size}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-white disabled:opacity-40"
        >
          <Minus className="h-3.5 w-3.5" />
          Ungroup
        </button>
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
          {linkMode ? (linkFrom ? "Click target…" : "Link mode") : "Link"}
        </button>
        <button
          type="button"
          onClick={removeSelectedEdges}
          disabled={!selectedIds.size}
          className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-magenta disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear links
        </button>
        <span className="text-[10px] text-cinema-muted">
          Drag clips from the rail · Space/Alt pan · Shift multi · Esc cancel
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
          onContextMenu={(e) => e.preventDefault()}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
          }}
          onDrop={onDropShot}
          className={cn(
            "relative min-w-0 flex-1 overflow-hidden rounded-lg border border-cinema-border",
            panning || spaceDown.current ? "cursor-grabbing" : "cursor-default"
          )}
          style={{
            minHeight: "32rem",
            backgroundColor: "var(--cinema-black)",
            backgroundImage:
              "radial-gradient(circle, color-mix(in srgb, var(--cinema-body) 12%, transparent) 1px, transparent 1px)",
            backgroundSize: "18px 18px",
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
            >
              {doc.edges.map((edge) => {
                const sa = shotMap.get(edge.a);
                const sb = shotMap.get(edge.b);
                if (!sa || !sb) return null;
                const pa =
                  doc.positions[edge.a] ||
                  ({ x: CANVAS_W / 2, y: CANVAS_H / 2, w: DEFAULT_W } as CanvasPos);
                const pb =
                  doc.positions[edge.b] ||
                  ({ x: CANVAS_W / 2 + 200, y: CANVAS_H / 2, w: DEFAULT_W } as CanvasPos);
                const a = centerOf(pa);
                const b = centerOf(pb);
                return (
                  <path
                    key={edge.id}
                    d={softCurve(a.x, a.y, b.x, b.y)}
                    fill="none"
                    stroke="rgba(94, 234, 212, 0.35)"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                );
              })}
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
              doc.media.length === 0 && (
                <div
                  className="absolute flex w-80 flex-col items-center gap-2 text-center"
                  style={{ left: CANVAS_W / 2 - 160, top: CANVAS_H / 2 - 40 }}
                >
                  <StickyNoteIcon className="h-6 w-6 text-cinema-cyan/70" />
                  <p className="text-sm text-white">Scrapbook</p>
                  <p className="text-xs text-cinema-muted">
                    Drag clips from the project rail, or add text / audio / media. Group into named
                    concepts or stack frames.
                  </p>
                </div>
              )}

            {doc.texts.map((t) => (
              <div
                key={t.id}
                className="absolute"
                style={{ left: t.x, top: t.y, width: t.w }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const start = screenToWorld(e.clientX, e.clientY);
                  const ox = start.x - t.x;
                  const oy = start.y - t.y;
                  const onMove = (ev: PointerEvent) => {
                    const w = screenToWorld(ev.clientX, ev.clientY);
                    updateDoc((prev) => ({
                      ...prev,
                      texts: prev.texts.map((n) =>
                        n.id === t.id ? { ...n, x: w.x - ox, y: w.y - oy } : n
                      ),
                    }));
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
                }}
              >
                <textarea
                  value={t.text}
                  onChange={(e) => {
                    const text = e.target.value;
                    updateDoc((prev) => ({
                      ...prev,
                      texts: prev.texts.map((n) => (n.id === t.id ? { ...n, text } : n)),
                    }));
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  rows={t.style === "title" ? 1 : 3}
                  className={cn(
                    "w-full resize-none border-0 bg-transparent text-white outline-none placeholder:text-cinema-muted",
                    t.style === "title"
                      ? "text-xl font-semibold tracking-tight"
                      : "text-sm text-cinema-muted"
                  )}
                />
                <button
                  type="button"
                  className="text-[10px] text-cinema-muted hover:text-cinema-magenta"
                  onClick={() =>
                    updateDoc((prev) => ({
                      ...prev,
                      texts: prev.texts.filter((n) => n.id !== t.id),
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}

            {doc.notes.map((note) => (
              <div
                key={note.id}
                className="absolute rounded-md border border-amber-400/30 bg-amber-100/95 p-2 shadow-md"
                style={{ left: note.x, top: note.y, width: note.w }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const start = screenToWorld(e.clientX, e.clientY);
                  const ox = start.x - note.x;
                  const oy = start.y - note.y;
                  const onMove = (ev: PointerEvent) => {
                    const w = screenToWorld(ev.clientX, ev.clientY);
                    updateDoc((prev) => ({
                      ...prev,
                      notes: prev.notes.map((n) =>
                        n.id === note.id ? { ...n, x: w.x - ox, y: w.y - oy } : n
                      ),
                    }));
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
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
                  className="min-h-[4.5rem] w-full resize-none bg-transparent text-xs text-stone-900 outline-none placeholder:text-stone-500"
                />
                <button
                  type="button"
                  className="mt-1 text-[10px] text-stone-600 hover:text-stone-900"
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
            ))}

            {doc.media.map((m) => (
              <div
                key={m.id}
                className="absolute overflow-hidden rounded-md border border-cinema-border bg-cinema-panel shadow-lg"
                style={{ left: m.x, top: m.y, width: m.w }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const start = screenToWorld(e.clientX, e.clientY);
                  const ox = start.x - m.x;
                  const oy = start.y - m.y;
                  const onMove = (ev: PointerEvent) => {
                    const w = screenToWorld(ev.clientX, ev.clientY);
                    updateDoc((prev) => ({
                      ...prev,
                      media: prev.media.map((n) =>
                        n.id === m.id ? { ...n, x: w.x - ox, y: w.y - oy } : n
                      ),
                    }));
                  };
                  const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                  };
                  window.addEventListener("pointermove", onMove);
                  window.addEventListener("pointerup", onUp);
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
              </div>
            ))}

            {doc.stacks.map((st) => {
              const active = shotMap.get(st.shotIds[st.activeIndex] || st.shotIds[0]);
              return (
                <div
                  key={st.id}
                  className="absolute"
                  style={{ left: st.x, top: st.y, width: st.w }}
                  onPointerDown={(e) => {
                    if (panning || spaceDown.current) return;
                    e.stopPropagation();
                    e.preventDefault();
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
                    className="relative z-10 overflow-hidden rounded-md border border-cinema-cyan/50 bg-cinema-black shadow-lg"
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
              return (
                <div
                  key={shot.id}
                  onPointerDown={(e) => onShotPointerDown(e, shot.id)}
                  onDoubleClick={() => onSelect?.(shot)}
                  className={cn(
                    "absolute cursor-grab overflow-hidden rounded-md border bg-cinema-black shadow-lg active:cursor-grabbing",
                    selected || linking
                      ? "z-20 border-cinema-cyan ring-2 ring-cinema-cyan/30"
                      : "border-cinema-border/80",
                    dragging === shot.id && "z-30"
                  )}
                  style={{ left: pos.x, top: pos.y, width: pos.w }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artifactUrl(shot.thumb_md_url || shot.thumb_url)}
                    alt=""
                    className="pointer-events-none block w-full select-none"
                    draggable={false}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <CanvasShotRail
          shots={shots}
          onBoardIds={onBoardIds}
          onAddAtCenter={addAtCenter}
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((v) => !v)}
        />
      </div>
    </div>
  );
}
