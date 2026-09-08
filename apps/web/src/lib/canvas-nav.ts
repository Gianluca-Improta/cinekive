/** Pure canvas view math (transform model — not scroll). */

export type CanvasView = { x: number; y: number; scale: number };

export const CANVAS_WORLD = 20000;
export const MIN_SCALE = 0.08;
export const MAX_SCALE = 2.5;

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

/** Zoom so the world point under (focalX, focalY) in viewport stays fixed. */
export function zoomAtFocal(
  view: CanvasView,
  nextScale: number,
  focalX: number,
  focalY: number
): CanvasView {
  const scale = clampScale(nextScale);
  const wx = (focalX - view.x) / view.scale;
  const wy = (focalY - view.y) / view.scale;
  return {
    scale,
    x: focalX - wx * scale,
    y: focalY - wy * scale,
  };
}

export function screenToWorld(
  view: CanvasView,
  clientX: number,
  clientY: number,
  vp: { left: number; top: number }
): { x: number; y: number } {
  return {
    x: (clientX - vp.left - view.x) / view.scale,
    y: (clientY - vp.top - view.y) / view.scale,
  };
}

export type WorldRect = { x: number; y: number; w: number; h: number };

export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

export type MinimapBounds = {
  minX: number;
  minY: number;
  span: number;
};

/** Content-fit square bounds for minimap (pad + min span). */
export function contentFitBounds(
  rects: WorldRect[],
  viewport: WorldRect,
  pad = 400,
  minSpan = 1600
): MinimapBounds {
  let minX = viewport.x;
  let minY = viewport.y;
  let maxX = viewport.x + viewport.w;
  let maxY = viewport.y + viewport.h;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  minX -= pad;
  minY -= pad;
  maxX += pad;
  maxY += pad;
  const span = Math.max(minSpan, maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return {
    minX: cx - span / 2,
    minY: cy - span / 2,
    span,
  };
}
