"use client";

import { useMemo } from "react";
import type { CanvasDoc, CanvasPos } from "@/lib/canvas-types";
import { contentFitBounds, type WorldRect } from "@/lib/canvas-nav";

type Props = {
  doc: CanvasDoc;
  viewport: { width: number; height: number };
  onJump: (worldX: number, worldY: number) => void;
};

const SHOT_H = 0.62;

function shotRect(id: string, p: CanvasPos): WorldRect {
  return { x: p.x, y: p.y, w: p.w, h: p.w * SHOT_H };
}

export function CanvasMinimap({ doc, viewport, onJump }: Props) {
  const items = useMemo(() => {
    const rects: { id: string; r: WorldRect; fill: string }[] = [];
    for (const [id, p] of Object.entries(doc.positions)) {
      rects.push({ id: `s:${id}`, r: shotRect(id, p), fill: "rgba(56,189,248,0.55)" });
    }
    for (const n of doc.notes) {
      rects.push({
        id: `n:${n.id}`,
        r: { x: n.x, y: n.y, w: n.w, h: 120 },
        fill: "rgba(250,204,21,0.5)",
      });
    }
    for (const t of doc.texts) {
      rects.push({
        id: `t:${t.id}`,
        r: { x: t.x, y: t.y, w: t.w, h: t.style === "title" ? 36 : 24 },
        fill: "rgba(255,255,255,0.45)",
      });
    }
    for (const m of doc.media) {
      rects.push({
        id: `m:${m.id}`,
        r: { x: m.x, y: m.y, w: m.w, h: 72 },
        fill: "rgba(167,139,250,0.5)",
      });
    }
    for (const st of doc.stacks) {
      rects.push({
        id: `k:${st.id}`,
        r: { x: st.x, y: st.y, w: st.w, h: st.w * SHOT_H },
        fill: "rgba(34,211,238,0.55)",
      });
    }
    return rects;
  }, [doc]);

  const vpWorld: WorldRect = {
    x: -doc.view.x / doc.view.scale,
    y: -doc.view.y / doc.view.scale,
    w: viewport.width / doc.view.scale,
    h: viewport.height / doc.view.scale,
  };

  const bounds = contentFitBounds(
    items.map((i) => i.r),
    vpWorld
  );

  const size = 148;

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - svg.left) / size;
    const ny = (e.clientY - svg.top) / size;
    const wx = bounds.minX + nx * bounds.span;
    const wy = bounds.minY + ny * bounds.span;
    onJump(wx, wy);
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-3 right-3 z-30 overflow-hidden rounded-md border border-cinema-border/80 bg-cinema-surface/90 shadow-lg backdrop-blur-sm"
      title="Minimap — click to jump"
    >
      <svg
        width={size}
        height={size}
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.span} ${bounds.span}`}
        className="block cursor-crosshair"
        onClick={onClick}
      >
        <rect
          x={bounds.minX}
          y={bounds.minY}
          width={bounds.span}
          height={bounds.span}
          fill="rgba(0,0,0,0.35)"
        />
        {items.map((it) => (
          <rect
            key={it.id}
            x={it.r.x}
            y={it.r.y}
            width={Math.max(8, it.r.w)}
            height={Math.max(8, it.r.h)}
            fill={it.fill}
            rx={4}
          />
        ))}
        <rect
          x={vpWorld.x}
          y={vpWorld.y}
          width={vpWorld.w}
          height={vpWorld.h}
          fill="rgba(56,189,248,0.12)"
          stroke="rgba(56,189,248,0.85)"
          strokeWidth={bounds.span * 0.004}
        />
      </svg>
    </div>
  );
}
