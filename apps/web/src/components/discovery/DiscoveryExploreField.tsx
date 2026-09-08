"use client";

/**
 * Discovery explore field — infinite canvas + living randomizer.
 * Pan / zoom / arrow-key fly; living mode morphs cluster layouts over time.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { Shuffle } from "lucide-react";
import { artifactUrl } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ExploreMode = "canvas" | "living";

type Pos = { x: number; y: number; w: number; h: number };
type LayoutMap = Record<string, Pos>;

type Props = {
  mode: ExploreMode;
  shots: Shot[];
  selectedIds?: Set<string>;
  onSelect: (shot: Shot, ev?: ReactMouseEvent) => void;
  inspectorOpen?: boolean;
  className?: string;
};

const TILE_W = 168;
const TILE_H = 112;
const GAP = 14;

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function craftKey(shot: Shot): string {
  return (
    shot.composition ||
    shot.shot_type ||
    shot.mood_vibe ||
    shot.techniques?.[0] ||
    shot.emotion ||
    shot.theme ||
    "misc"
  )
    .toLowerCase()
    .trim()
    .slice(0, 40);
}

function aspectSize(shot: Shot): { w: number; h: number } {
  const ar = (shot.width || 3) / Math.max(shot.height || 2, 1);
  if (ar >= 1.35) return { w: TILE_W * 1.15, h: TILE_H * 0.85 };
  if (ar <= 0.85) return { w: TILE_W * 0.78, h: TILE_H * 1.2 };
  return { w: TILE_W, h: TILE_H };
}

/** Spiral / filmstrip world — easy to fly through with arrows. */
function layoutCanvas(shots: Shot[]): LayoutMap {
  const out: LayoutMap = {};
  const cols = Math.max(8, Math.ceil(Math.sqrt(shots.length * 1.4)));
  shots.forEach((shot, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const { w, h } = aspectSize(shot);
    const jitterX = ((i * 17) % 11) - 5;
    const jitterY = ((i * 31) % 9) - 4;
    out[shot.id] = {
      x: col * (TILE_W + GAP) + jitterX,
      y: row * (TILE_H + GAP) + jitterY,
      w,
      h,
    };
  });
  return out;
}

/** Cluster islands by craft — used by living randomizer. */
function layoutLiving(shots: Shot[], seed: number): LayoutMap {
  const rnd = mulberry32(seed || 1);
  const groups = new Map<string, Shot[]>();
  for (const s of shots) {
    const k = craftKey(s);
    const list = groups.get(k) || [];
    list.push(s);
    groups.set(k, list);
  }
  const keys = [...groups.keys()].sort();
  // Shuffle key order for variety
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }

  const out: LayoutMap = {};
  const clusterCount = Math.max(1, keys.length);
  const ringR = 420 + clusterCount * 55;

  keys.forEach((key, gi) => {
    const members = groups.get(key) || [];
    const angle = (gi / clusterCount) * Math.PI * 2 + rnd() * 0.4;
    const cx = Math.cos(angle) * ringR + (rnd() - 0.5) * 180;
    const cy = Math.sin(angle) * ringR + (rnd() - 0.5) * 180;
    const localCols = Math.max(2, Math.ceil(Math.sqrt(members.length)));
    members.forEach((shot, i) => {
      const lc = i % localCols;
      const lr = Math.floor(i / localCols);
      const { w, h } = aspectSize(shot);
      out[shot.id] = {
        x: cx + lc * (TILE_W * 0.92 + 10) - (localCols * TILE_W) / 2,
        y: cy + lr * (TILE_H * 0.92 + 10) - 40,
        w,
        h,
      };
    });
  });
  return out;
}

function lerpLayout(a: LayoutMap, b: LayoutMap, t: number): LayoutMap {
  const u = Math.min(1, Math.max(0, t));
  const ease = u * u * (3 - 2 * u);
  const out: LayoutMap = {};
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const id of ids) {
    const pa = a[id];
    const pb = b[id];
    if (pa && pb) {
      out[id] = {
        x: pa.x + (pb.x - pa.x) * ease,
        y: pa.y + (pb.y - pa.y) * ease,
        w: pa.w + (pb.w - pa.w) * ease,
        h: pa.h + (pb.h - pa.h) * ease,
      };
    } else if (pb) out[id] = { ...pb };
    else if (pa) out[id] = { ...pa };
  }
  return out;
}

export function DiscoveryExploreField({
  mode,
  shots,
  selectedIds,
  onSelect,
  inspectorOpen = false,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState({ x: 0, y: 0, scale: 0.55 });
  const camRef = useRef(cam);
  camRef.current = cam;

  const velRef = useRef({ x: 0, y: 0 });
  const keysRef = useRef<Set<string>>(new Set());
  const dragRef = useRef<{ px: number; py: number; cx: number; cy: number } | null>(null);

  const [seed, setSeed] = useState(() => Date.now() % 1_000_000);
  const [intervalSec, setIntervalSec] = useState<0 | 15 | 30 | 60>(30);
  const [morphing, setMorphing] = useState(false);
  const [layout, setLayout] = useState<LayoutMap>({});
  const fromRef = useRef<LayoutMap>({});
  const toRef = useRef<LayoutMap>({});
  const morphStartRef = useRef(0);
  const morphDur = 2800;

  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const rebuild = useCallback(
    (nextSeed: number, animate: boolean) => {
      const next =
        mode === "living" ? layoutLiving(shots, nextSeed) : layoutCanvas(shots);
      if (animate && Object.keys(layoutRef.current).length > 0) {
        fromRef.current = layoutRef.current;
        toRef.current = next;
        morphStartRef.current = performance.now();
        setMorphing(true);
      } else {
        setLayout(next);
        setMorphing(false);
      }
      setSeed(nextSeed);
    },
    [mode, shots]
  );

  // Initial / mode / shots change
  useEffect(() => {
    const nextSeed = mode === "living" ? seed : 1;
    const next =
      mode === "living" ? layoutLiving(shots, nextSeed) : layoutCanvas(shots);
    setLayout(next);
    setMorphing(false);
    if (shots.length) {
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (const p of Object.values(next)) {
        sx += p.x + p.w / 2;
        sy += p.y + p.h / 2;
        n += 1;
      }
      if (n) {
        const el = wrapRef.current;
        const vw = el?.clientWidth || 800;
        const vh = el?.clientHeight || 600;
        setCam((c) => ({
          ...c,
          x: vw / 2 - (sx / n) * c.scale,
          y: vh / 2 - (sy / n) * c.scale,
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recenter when mode or shot set changes
  }, [mode, shots]);

  // Living auto-reshuffle
  useEffect(() => {
    if (mode !== "living" || intervalSec === 0) return;
    const id = window.setInterval(() => {
      rebuild((Date.now() + Math.floor(Math.random() * 9999)) % 1_000_000, true);
    }, intervalSec * 1000);
    return () => window.clearInterval(id);
  }, [mode, intervalSec, rebuild]);

  // Morph rAF
  useEffect(() => {
    if (!morphing) return;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - morphStartRef.current) / morphDur;
      if (t >= 1) {
        setLayout(toRef.current);
        setMorphing(false);
        return;
      }
      setLayout(lerpLayout(fromRef.current, toRef.current, t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [morphing]);

  // Keyboard fly + continuous pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", "W", "A", "S", "D"].includes(k)) {
        e.preventDefault();
        keysRef.current.add(k.length === 1 ? k.toLowerCase() : k);
      }
      if (k === "+" || k === "=") {
        setCam((c) => ({ ...c, scale: Math.min(2.4, c.scale * 1.12) }));
      }
      if (k === "-" || k === "_") {
        setCam((c) => ({ ...c, scale: Math.max(0.18, c.scale / 1.12) }));
      }
      if (k === "Home") {
        setCam((c) => ({ ...c, x: 40, y: 40 }));
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key;
      keysRef.current.delete(k.length === 1 ? k.toLowerCase() : k);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const keys = keysRef.current;
      const speed = 9.5 / camRef.current.scale;
      let ax = 0;
      let ay = 0;
      if (keys.has("ArrowLeft") || keys.has("a")) ax += 1;
      if (keys.has("ArrowRight") || keys.has("d")) ax -= 1;
      if (keys.has("ArrowUp") || keys.has("w")) ay += 1;
      if (keys.has("ArrowDown") || keys.has("s")) ay -= 1;
      if (ax || ay) {
        const len = Math.hypot(ax, ay) || 1;
        velRef.current.x += (ax / len) * speed * 0.35;
        velRef.current.y += (ay / len) * speed * 0.35;
      }
      velRef.current.x *= 0.86;
      velRef.current.y *= 0.86;
      if (Math.abs(velRef.current.x) > 0.05 || Math.abs(velRef.current.y) > 0.05) {
        setCam((c) => ({
          ...c,
          x: c.x + velRef.current.x,
          y: c.y + velRef.current.y,
        }));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onWheel = (e: ReactWheelEvent) => {
    e.preventDefault();
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setCam((c) => {
      const next = Math.min(2.5, Math.max(0.15, c.scale * factor));
      const wx = (mx - c.x) / c.scale;
      const wy = (my - c.y) / c.scale;
      return {
        scale: next,
        x: mx - wx * next,
        y: my - wy * next,
      };
    });
  };

  const onPointerDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    // Don't start pan if clicking a tile (tiles stopPropagation)
    dragRef.current = {
      px: e.clientX,
      py: e.clientY,
      cx: cam.x,
      cy: cam.y,
    };
  };

  const onPointerMove = (e: ReactMouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setCam((c) => ({
      ...c,
      x: d.cx + (e.clientX - d.px),
      y: d.cy + (e.clientY - d.py),
    }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // Viewport culling
  const visible = useMemo(() => {
    const el = wrapRef.current;
    const vw = el?.clientWidth || 1200;
    const vh = el?.clientHeight || 800;
    const pad = 200;
    const left = (-cam.x - pad) / cam.scale;
    const top = (-cam.y - pad) / cam.scale;
    const right = (vw - cam.x + pad) / cam.scale;
    const bottom = (vh - cam.y + pad) / cam.scale;
    return shots.filter((s) => {
      const p = layout[s.id];
      if (!p) return false;
      return p.x + p.w >= left && p.x <= right && p.y + p.h >= top && p.y <= bottom;
    });
  }, [shots, layout, cam]);

  if (!shots.length) {
    return (
      <div className="flex h-[calc(100vh-12rem)] items-center justify-center rounded-lg border border-dashed border-cinema-border text-sm text-cinema-muted">
        No stills yet — ingest something, then fly the field.
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-[calc(100vh-12rem)] flex-col transition-[padding] duration-200",
        inspectorOpen && "md:pr-[28rem]",
        className
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-cinema-muted">
        <span>
          {mode === "canvas"
            ? "Infinite field — drag to pan, wheel zoom, arrows / WASD to fly"
            : "Living clusters — craft islands reshuffle on a timer"}
        </span>
        <span className="text-cinema-border">·</span>
        <span>
          {visible.length}/{shots.length} in view
        </span>
        {mode === "living" && (
          <>
            <label className="ml-2 inline-flex items-center gap-1.5">
              Reshuffle
              <select
                value={intervalSec}
                onChange={(e) => setIntervalSec(Number(e.target.value) as 0 | 15 | 30 | 60)}
                className="rounded border border-cinema-border bg-cinema-black px-1.5 py-0.5 text-[11px] outline-none"
              >
                <option value={0}>Manual</option>
                <option value={15}>Every 15s</option>
                <option value={30}>Every 30s</option>
                <option value={60}>Every 60s</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                rebuild((Date.now() + Math.floor(Math.random() * 9999)) % 1_000_000, true)
              }
              className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-0.5 text-cinema-cyan hover:bg-cinema-panel"
            >
              <Shuffle className="h-3 w-3" />
              Now
            </button>
          </>
        )}
      </div>

      <div
        ref={wrapRef}
        className="relative min-h-0 flex-1 cursor-grab overflow-hidden rounded-lg border border-cinema-border bg-[#070809] active:cursor-grabbing"
        onWheel={onWheel}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
      >
        <div
          className="absolute origin-top-left will-change-transform"
          style={{
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
          }}
        >
          {visible.map((shot) => {
            const p = layout[shot.id];
            if (!p) return null;
            const src = artifactUrl(shot.thumb_md_url || shot.thumb_url || shot.keyframe_url);
            const selected = selectedIds?.has(shot.id);
            return (
              <button
                key={shot.id}
                type="button"
                title={shot.source_title || shot.source_filename || craftKey(shot)}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(shot, e);
                }}
                className={cn(
                  "absolute overflow-hidden rounded-md border bg-cinema-panel shadow-sm transition-[box-shadow] hover:z-10 hover:shadow-glow",
                  selected ? "border-cinema-cyan ring-1 ring-cinema-cyan/50" : "border-white/10"
                )}
                style={{
                  left: p.x,
                  top: p.y,
                  width: p.w,
                  height: p.h,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  draggable={false}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>

        <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-cinema-border/60 bg-black/55 px-2 py-1 font-mono text-[10px] text-cinema-muted backdrop-blur">
          {Math.round(cam.scale * 100)}% · ←↑→↓ fly
        </div>
      </div>
    </div>
  );
}
