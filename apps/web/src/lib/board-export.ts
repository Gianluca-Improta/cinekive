/** Client-side moodboard → PNG / PDF (Pro board_export). */

import { artifactUrl } from "@/lib/api-client";
import type { CanvasDoc } from "@/lib/canvas-types";
import { downloadBlob } from "@/lib/download";
import type { Shot } from "@/lib/types";

const PAD = 48;
const MAX_EDGE = 4096;
const BG = "#0c0e12";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function shotH(w: number) {
  return w * 0.62;
}

function computeBounds(doc: CanvasDoc): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;

  const grow = (x: number, y: number, w: number, h: number) => {
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const pos of Object.values(doc.positions || {})) {
    grow(pos.x, pos.y, pos.w, shotH(pos.w));
  }
  for (const g of doc.groups || []) grow(g.x, g.y, g.w, g.h);
  for (const n of doc.notes || []) grow(n.x, n.y, n.w, Math.max(80, n.w * 0.55));
  for (const t of doc.texts || []) grow(t.x, t.y, t.w, t.style === "title" ? 48 : 28);
  for (const m of doc.media || []) grow(m.x, m.y, m.w, m.kind === "image" ? shotH(m.w) : 56);
  for (const s of doc.stacks || []) grow(s.x, s.y, s.w, shotH(s.w) + 24);

  if (!any) return null;
  return {
    minX: minX - PAD,
    minY: minY - PAD,
    maxX: maxX + PAD,
    maxY: maxY + PAD,
  };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines = 8
) {
  const words = (text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let yy = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, yy);
      line = word;
      yy += lineH;
      lines += 1;
      if (lines >= maxLines) {
        ctx.fillText("…", x, yy);
        return;
      }
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, yy);
}

async function renderBoardCanvas(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<HTMLCanvasElement> {
  const bounds = computeBounds(doc);
  if (!bounds) {
    throw new Error("Board is empty — add frames before exporting.");
  }

  const rawW = Math.max(320, bounds.maxX - bounds.minX);
  const rawH = Math.max(240, bounds.maxY - bounds.minY);
  const scale = Math.min(1, MAX_EDGE / Math.max(rawW, rawH));
  const W = Math.ceil(rawW * scale);
  const H = Math.ceil(rawH * scale) + 36;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = "#66FCF1";
  ctx.font = "600 14px Inter, system-ui, sans-serif";
  ctx.fillText(title || "Cinekive board", 16, 22);
  ctx.fillStyle = "#8B98A8";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("Exported from Cinekive", Math.max(16, W - 150), 22);

  const ox = -bounds.minX;
  const oy = -bounds.minY + 36 / scale;
  const shotMap = new Map(shots.map((s) => [s.id, s]));

  const tx = (x: number) => (x + ox) * scale;
  const ty = (y: number) => (y + oy) * scale;
  const ts = (n: number) => n * scale;

  for (const g of doc.groups || []) {
    ctx.strokeStyle = "rgba(102,252,241,0.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx(g.x), ty(g.y), ts(g.w), ts(g.h));
    ctx.fillStyle = "rgba(102,252,241,0.12)";
    ctx.fillRect(tx(g.x), ty(g.y), ts(g.w), ts(22));
    ctx.fillStyle = "#66FCF1";
    ctx.font = `${Math.max(10, 11 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillText(g.label || "Group", tx(g.x) + 6, ty(g.y) + ts(15));
  }

  ctx.strokeStyle = "rgba(139,152,168,0.55)";
  ctx.lineWidth = Math.max(1, scale);
  for (const e of doc.edges || []) {
    const a = doc.positions[e.a];
    const b = doc.positions[e.b];
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(tx(a.x + a.w / 2), ty(a.y + shotH(a.w) / 2));
    ctx.lineTo(tx(b.x + b.w / 2), ty(b.y + shotH(b.w) / 2));
    ctx.stroke();
  }

  for (const [id, pos] of Object.entries(doc.positions || {})) {
    const shot = shotMap.get(id);
    const url = artifactUrl(shot?.thumb_md_url || shot?.thumb_url || shot?.keyframe_url);
    const img = await loadImage(url);
    const x = tx(pos.x);
    const y = ty(pos.y);
    const w = ts(pos.w);
    const h = ts(shotH(pos.w));
    ctx.fillStyle = "#1F2833";
    ctx.fillRect(x, y, w, h);
    if (img) {
      const ir = img.width / Math.max(1, img.height);
      const br = w / h;
      let dw = w;
      let dh = h;
      let dx = x;
      let dy = y;
      if (ir > br) {
        dh = w / ir;
        dy = y + (h - dh) / 2;
      } else {
        dw = h * ir;
        dx = x + (w - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(x, y, w, h);
  }

  for (const stack of doc.stacks || []) {
    const sid = stack.shotIds[stack.activeIndex] || stack.shotIds[0];
    const shot = sid ? shotMap.get(sid) : undefined;
    const url = artifactUrl(shot?.thumb_md_url || shot?.thumb_url || shot?.keyframe_url);
    const img = await loadImage(url);
    const x = tx(stack.x);
    const y = ty(stack.y);
    const w = ts(stack.w);
    const h = ts(shotH(stack.w));
    ctx.fillStyle = "#162028";
    ctx.fillRect(x + 6, y + 6, w, h);
    ctx.fillStyle = "#1F2833";
    ctx.fillRect(x, y, w, h);
    if (img) ctx.drawImage(img, x, y, w, h);
    ctx.fillStyle = "#E8B86D";
    ctx.font = `${Math.max(9, 10 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillText(stack.label || "Stack", x, y + h + ts(14));
  }

  for (const n of doc.notes || []) {
    const x = tx(n.x);
    const y = ty(n.y);
    const w = ts(n.w);
    const h = ts(Math.max(80, n.w * 0.55));
    ctx.fillStyle = "#3d3420";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = "#E8B86D";
    ctx.font = `${Math.max(10, 12 * scale)}px Inter, system-ui, sans-serif`;
    wrapText(ctx, n.text || "", x + 8, y + ts(18), w - 16, Math.max(12, 14 * scale));
  }

  for (const t of doc.texts || []) {
    ctx.fillStyle = "#E8EEF4";
    const size = t.style === "title" ? Math.max(16, 22 * scale) : Math.max(11, 13 * scale);
    ctx.font = `${t.style === "title" ? 700 : 500} ${size}px Inter, system-ui, sans-serif`;
    wrapText(ctx, t.text || "", tx(t.x), ty(t.y) + size, ts(t.w), size * 1.25, 6);
  }

  for (const m of doc.media || []) {
    const x = tx(m.x);
    const y = ty(m.y);
    const w = ts(m.w);
    if (m.kind === "image" && m.url) {
      const img = await loadImage(m.url.startsWith("http") ? m.url : artifactUrl(m.url));
      const h = ts(shotH(m.w));
      ctx.fillStyle = "#1F2833";
      ctx.fillRect(x, y, w, h);
      if (img) ctx.drawImage(img, x, y, w, h);
    } else {
      ctx.fillStyle = "#1F2833";
      ctx.fillRect(x, y, w, ts(56));
      ctx.fillStyle = "#8B98A8";
      ctx.font = `${Math.max(10, 11 * scale)}px Inter, system-ui, sans-serif`;
      ctx.fillText(`${m.kind}: ${m.label || m.url || ""}`.slice(0, 60), x + 8, y + ts(32));
    }
  }

  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Export failed"))),
      type,
      quality
    );
  });
}

/** Minimal single-page PDF wrapping a JPEG. */
function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  let cursor = 0;
  const offsets: number[] = [];

  const push = (s: string | Uint8Array) => {
    const b = typeof s === "string" ? enc.encode(s) : s;
    parts.push(b);
    cursor += b.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = cursor;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body);
    else body();
    push("\nendobj\n");
  };

  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>`
  );
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(5, () => {
    push(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    push(jpeg);
    push("\nendstream");
  });

  const xref = cursor;
  push("xref\n0 6\n0000000000 65535 f \n");
  for (let i = 1; i <= 5; i++) {
    push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const total = parts.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of parts) {
    out.set(b, o);
    o += b.length;
  }
  return new Blob([out], { type: "application/pdf" });
}

function slugify(name: string) {
  return (
    (name || "board")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "board"
  );
}

export async function exportBoardPng(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<void> {
  const canvas = await renderBoardCanvas(doc, shots, title);
  const blob = await canvasToBlob(canvas, "image/png");
  downloadBlob(blob, `${slugify(title)}.png`);
}

export async function exportBoardPdf(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<void> {
  const canvas = await renderBoardCanvas(doc, shots, title);
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  const buf = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegToPdf(buf, canvas.width, canvas.height);
  downloadBlob(pdf, `${slugify(title)}.pdf`);
}
