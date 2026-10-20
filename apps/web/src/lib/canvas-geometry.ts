/**
 * Pure canvas geometry — node boxes, ports and edge routing.
 *
 * No React, no DOM, no runtime imports: this module is the piece of the
 * canvas that can be reasoned about (and unit tested) on its own. It follows
 * the same pattern as canvas-nav.ts.
 */

export type CanvasBox = { x: number; y: number; w: number; h: number };

export type PortSide = "left" | "right" | "top" | "bottom";

export const CANVAS_W = 20000;
export const CANVAS_H = 20000;
export const DEFAULT_NODE_W = 220;
export const GEN_NODE_H = 344;

/** Node id prefixes (kept in sync with canvas-types). */
export const GEN_ID_PREFIX = "gen-";
export const NOTE_ID_PREFIX = "note:";
export const TEXT_ID_PREFIX = "text:";

/** The point on a node's edge where a port sits. */
export function portPoint(
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

/** Pick out/in sides from relative node centres (Framechain-style). */
export function pickPortSides(a: CanvasBox, b: CanvasBox): { out: PortSide; inn: PortSide } {
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

/** Cubic path between two ports, bowed out of both nodes. */
export function softCurve(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  outSide: PortSide = "right",
  inSide: PortSide = "left"
): string {
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

/** The world point at the centre of a viewport, given the current view. */
export function viewportCenterWorld(
  view: { x: number; y: number; scale: number },
  vp: { width: number; height: number }
): { x: number; y: number } {
  return {
    x: (vp.width / 2 - view.x) / view.scale,
    y: (vp.height / 2 - view.y) / view.scale,
  };
}

/** Text node height by style. */
export function textNodeHeight(style: string): number {
  if (style === "title") return 40;
  if (style === "caption") return 28;
  return 72;
}

/** Note nodes are roughly 16:9. */
export function noteNodeHeight(w: number): number {
  return Math.max(80, w * 0.55);
}

/** Shot nodes keep a 1:0.62 frame. */
export function shotNodeHeight(w: number): number {
  return w * 0.62;
}
