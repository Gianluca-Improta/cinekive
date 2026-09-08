/** Client-side moodboard → PNG / PDF (Pro board_export). */

import { artifactUrl } from "@/lib/api-client";
import type { CanvasDoc, CaptionField } from "@/lib/canvas-types";
import { defaultCanvasTheme } from "@/lib/canvas-types";
import { downloadBlob } from "@/lib/download";
import type { Shot } from "@/lib/types";
import { formatTimecode } from "@/lib/utils";

const PAD = 48;
const MAX_EDGE = 4096;

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

function shotH(w: number, captionH = 0) {
  return w * 0.62 + captionH;
}

function captionBlock(shot: Shot | undefined, fields: CaptionField[]): string[] {
  if (!shot) return [];
  const lines: string[] = [];
  for (const f of fields) {
    if (f === "title") {
      const t = shot.source_title || shot.source_filename;
      if (t) lines.push(String(t).slice(0, 48));
    } else if (f === "shot_type" && shot.shot_type) lines.push(shot.shot_type);
    else if (f === "technique" && shot.techniques?.[0]) lines.push(shot.techniques[0]);
    else if (f === "timecode") {
      const tc = formatTimecode(shot.start_timecode_ms);
      if (tc && tc !== "—") lines.push(tc);
    } else if (f === "mood" && shot.mood_vibe) lines.push(shot.mood_vibe);
    else if (f === "composition" && shot.composition) lines.push(shot.composition);
    else if (f === "lens" && shot.lens_look) lines.push(shot.lens_look);
    else if (f === "camera" && (shot.camera_angle || shot.camera_movement)) {
      lines.push([shot.camera_angle, shot.camera_movement].filter(Boolean).join(" · "));
    } else if (f === "lighting" && shot.lighting_style) lines.push(shot.lighting_style);
  }
  return lines.slice(0, 3);
}

function computeBounds(doc: CanvasDoc): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  const theme = { ...defaultCanvasTheme(), ...(doc.theme || {}) };
  const capH = theme.showCaptions ? 36 : 0;

  const grow = (x: number, y: number, w: number, h: number) => {
    any = true;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };

  for (const pos of Object.values(doc.positions || {})) {
    grow(pos.x, pos.y, pos.w, shotH(pos.w, capH));
  }
  for (const g of doc.groups || []) grow(g.x, g.y, g.w, g.h);
  for (const n of doc.notes || []) grow(n.x, n.y, n.w, Math.max(80, n.w * 0.55));
  for (const t of doc.texts || []) grow(t.x, t.y, t.w, t.style === "title" ? 48 : 28);
  for (const m of doc.media || []) grow(m.x, m.y, m.w, m.kind === "image" ? shotH(m.w) : 56);
  for (const s of doc.stacks || []) grow(s.x, s.y, s.w, shotH(s.w) + 24);
  for (const g of doc.gens || []) grow(g.x, g.y, g.w, 200);

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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
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

  const theme = { ...defaultCanvasTheme(), ...(doc.theme || {}) };
  const capH = theme.showCaptions ? 36 : 0;
  const bg = theme.bg || "#111111";
  const accent = theme.exportTitleColor || theme.accent || "#66FCF1";
  const muted = theme.exportMutedColor || "#8B98A8";

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

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = accent;
  ctx.font = "600 14px Inter, system-ui, sans-serif";
  ctx.fillText(title || "Cinekive board", 16, 22);
  ctx.fillStyle = muted;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("Exported from Cinekive", Math.max(16, W - 150), 22);

  const ox = -bounds.minX;
  const oy = -bounds.minY + 36 / scale;
  const shotMap = new Map(shots.map((s) => [s.id, s]));

  const tx = (x: number) => (x + ox) * scale;
  const ty = (y: number) => (y + oy) * scale;
  const ts = (n: number) => n * scale;

  for (const g of doc.groups || []) {
    ctx.strokeStyle = `${accent}59`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tx(g.x), ty(g.y), ts(g.w), ts(g.h));
    ctx.fillStyle = `${accent}1f`;
    ctx.fillRect(tx(g.x), ty(g.y), ts(g.w), ts(22));
    ctx.fillStyle = accent;
    ctx.font = `${Math.max(10, 11 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillText(g.label || "Group", tx(g.x) + 6, ty(g.y) + ts(15));
  }

  ctx.strokeStyle = "rgba(139,152,168,0.55)";
  ctx.lineWidth = Math.max(1, scale);
  for (const e of doc.edges || []) {
    const center = (id: string): { x: number; y: number } | null => {
      if (id.startsWith("gen-")) {
        const g = (doc.gens || []).find((n) => n.id === id);
        if (!g) return null;
        return { x: g.x + g.w / 2, y: g.y + 100 };
      }
      const p = doc.positions[id];
      if (!p) return null;
      return { x: p.x + p.w / 2, y: p.y + shotH(p.w) / 2 };
    };
    const a = center(e.a);
    const b = center(e.b);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo(tx(a.x), ty(a.y));
    ctx.lineTo(tx(b.x), ty(b.y));
    ctx.stroke();
  }

  const radius = Math.max(0, theme.cardRadius || 0) * scale;

  for (const [id, pos] of Object.entries(doc.positions || {})) {
    const shot = shotMap.get(id);
    const url = artifactUrl(shot?.thumb_md_url || shot?.thumb_url || shot?.keyframe_url);
    const img = await loadImage(url);
    const x = tx(pos.x);
    const y = ty(pos.y);
    const w = ts(pos.w);
    const hImg = ts(shotH(pos.w));
    const hCap = theme.showCaptions ? ts(capH) : 0;
    ctx.fillStyle = "#1F2833";
    if (radius > 0) {
      roundRect(ctx, x, y, w, hImg + hCap, radius);
      ctx.fill();
      ctx.save();
      roundRect(ctx, x, y, w, hImg, radius);
      ctx.clip();
    } else {
      ctx.fillRect(x, y, w, hImg + hCap);
    }
    if (img) {
      const ir = img.width / Math.max(1, img.height);
      const br = w / hImg;
      let dw = w;
      let dh = hImg;
      let dx = x;
      let dy = y;
      if (ir > br) {
        dh = w / ir;
        dy = y + (hImg - dh) / 2;
      } else {
        dw = hImg * ir;
        dx = x + (w - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }
    if (radius > 0) ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(x, y, w, hImg + hCap);
    if (theme.showCaptions && shot) {
      const lines = captionBlock(shot, theme.captionFields);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y + hImg, w, hCap);
      ctx.fillStyle = "#E8EEF4";
      ctx.font = `${Math.max(8, 9 * scale)}px Inter, system-ui, sans-serif`;
      lines.forEach((line, i) => {
        ctx.fillText(line, x + 4, y + hImg + ts(12 + i * 11));
      });
    }
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

  for (const g of doc.gens || []) {
    const x = tx(g.x);
    const y = ty(g.y);
    const w = ts(g.w);
    const h = ts(200);
    ctx.fillStyle = "#152028";
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    roundRect(ctx, x, y, w, h, Math.max(4, 6 * scale));
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = `600 ${Math.max(11, 13 * scale)}px Inter, system-ui, sans-serif`;
    ctx.fillText("Generate", x + ts(10), y + ts(22));
    ctx.fillStyle = muted;
    ctx.font = `${Math.max(10, 11 * scale)}px Inter, system-ui, sans-serif`;
    wrapText(
      ctx,
      (g.prompt || "").slice(0, 180) || "(empty prompt)",
      x + ts(10),
      y + ts(44),
      w - ts(20),
      Math.max(12, 14 * scale),
      6
    );
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

export type BoardExportLayout = "board" | "contact" | "slides";

function boardShotsInOrder(doc: CanvasDoc, shots: Shot[]): Shot[] {
  const map = new Map(shots.map((s) => [s.id, s]));
  const ordered = Object.keys(doc.positions || {})
    .map((id) => map.get(id))
    .filter((s): s is Shot => Boolean(s));
  if (ordered.length) return ordered;
  return shots;
}

/** Contact sheet: grid of stills with captions on a letter-ish canvas. */
async function renderContactSheetCanvas(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<HTMLCanvasElement> {
  const theme = { ...defaultCanvasTheme(), ...(doc.theme || {}) };
  const fields = theme.captionFields?.length
    ? theme.captionFields
    : (["title", "shot_type"] as CaptionField[]);
  const items = boardShotsInOrder(doc, shots);
  if (!items.length) throw new Error("Board is empty — add frames before exporting.");

  const cols = items.length <= 6 ? 3 : 4;
  const pageW = 1275;
  const margin = 36;
  const gap = 16;
  const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const imgH = cellW * 0.62;
  const capH = 44;
  const cellH = imgH + capH;
  const rows = Math.ceil(items.length / cols);
  const headerH = 48;
  const pageH = Math.min(
    MAX_EDGE,
    Math.ceil(headerH + margin + rows * cellH + (rows - 1) * gap + margin)
  );

  const canvas = document.createElement("canvas");
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const bg = theme.bg || "#111111";
  const accent = theme.exportTitleColor || theme.accent || "#66FCF1";
  const muted = theme.exportMutedColor || "#8B98A8";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.fillStyle = accent;
  ctx.font = "600 16px Inter, system-ui, sans-serif";
  ctx.fillText(title || "Contact sheet", margin, 28);
  ctx.fillStyle = muted;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("Contact sheet · Cinekive", pageW - margin - 140, 28);

  for (let i = 0; i < items.length; i++) {
    const shot = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellW + gap);
    const y = headerH + margin * 0.35 + row * (cellH + gap);
    if (y + cellH > pageH - 8) break;

    ctx.fillStyle = "#1F2833";
    ctx.fillRect(x, y, cellW, imgH);
    const url = artifactUrl(shot.thumb_md_url || shot.thumb_url || shot.keyframe_url);
    const img = await loadImage(url);
    if (img) {
      const ir = img.width / Math.max(1, img.height);
      const br = cellW / imgH;
      let dw = cellW;
      let dh = imgH;
      let dx = x;
      let dy = y;
      if (ir > br) {
        dh = cellW / ir;
        dy = y + (imgH - dh) / 2;
      } else {
        dw = imgH * ir;
        dx = x + (cellW - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    const lines = captionBlock(shot, fields);
    ctx.fillStyle = muted;
    ctx.font = "10px Inter, system-ui, sans-serif";
    let ly = y + imgH + 12;
    for (const line of lines.slice(0, 2)) {
      const t = line.length > 42 ? `${line.slice(0, 40)}…` : line;
      ctx.fillText(t, x + 2, ly);
      ly += 12;
    }
  }

  return canvas;
}

/** Shot pages: vertical stack of frames with titles (single tall PDF). */
async function renderSlidesCanvas(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<HTMLCanvasElement> {
  const theme = { ...defaultCanvasTheme(), ...(doc.theme || {}) };
  const fields = theme.captionFields?.length
    ? theme.captionFields
    : (["title", "shot_type", "technique"] as CaptionField[]);
  const items = boardShotsInOrder(doc, shots);
  if (!items.length) throw new Error("Board is empty — add frames before exporting.");

  const pageW = 900;
  const margin = 40;
  const frameW = pageW - margin * 2;
  const frameH = frameW * 0.56;
  const blockH = frameH + 72;
  const headerH = 52;
  const pageH = Math.min(MAX_EDGE, headerH + items.length * blockH + margin);

  const canvas = document.createElement("canvas");
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  const bg = theme.bg || "#111111";
  const accent = theme.exportTitleColor || theme.accent || "#66FCF1";
  const muted = theme.exportMutedColor || "#8B98A8";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, pageW, pageH);
  ctx.fillStyle = accent;
  ctx.font = "600 18px Inter, system-ui, sans-serif";
  ctx.fillText(title || "Shot pages", margin, 30);
  ctx.fillStyle = muted;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.fillText("Shot pages · Cinekive", pageW - margin - 130, 30);

  for (let i = 0; i < items.length; i++) {
    const shot = items[i];
    const y = headerH + i * blockH;
    if (y + frameH > pageH - 8) break;

    ctx.fillStyle = "#1F2833";
    ctx.fillRect(margin, y, frameW, frameH);
    const url = artifactUrl(shot.thumb_md_url || shot.keyframe_url || shot.thumb_url);
    const img = await loadImage(url);
    if (img) {
      const ir = img.width / Math.max(1, img.height);
      const br = frameW / frameH;
      let dw = frameW;
      let dh = frameH;
      let dx = margin;
      let dy = y;
      if (ir > br) {
        dh = frameW / ir;
        dy = y + (frameH - dh) / 2;
      } else {
        dw = frameH * ir;
        dx = margin + (frameW - dw) / 2;
      }
      ctx.drawImage(img, dx, dy, dw, dh);
    }

    const lines = captionBlock(shot, fields);
    const heading =
      lines[0] ||
      shot.source_title ||
      shot.source_filename ||
      `Shot ${i + 1}`;
    ctx.fillStyle = accent;
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    ctx.fillText(String(heading).slice(0, 72), margin, y + frameH + 22);
    ctx.fillStyle = muted;
    ctx.font = "11px Inter, system-ui, sans-serif";
    const sub = lines.slice(1).join(" · ");
    if (sub) ctx.fillText(sub.slice(0, 90), margin, y + frameH + 40);
  }

  return canvas;
}

export async function exportBoardPng(
  doc: CanvasDoc,
  shots: Shot[],
  title: string,
  opts?: { layout?: BoardExportLayout }
): Promise<void> {
  const layout = opts?.layout || "board";
  const canvas =
    layout === "contact"
      ? await renderContactSheetCanvas(doc, shots, title)
      : layout === "slides"
        ? await renderSlidesCanvas(doc, shots, title)
        : await renderBoardCanvas(doc, shots, title);
  const blob = await canvasToBlob(canvas, "image/png");
  downloadBlob(blob, `${slugify(title)}.png`);
}

export async function exportBoardPdf(
  doc: CanvasDoc,
  shots: Shot[],
  title: string,
  opts?: { layout?: BoardExportLayout }
): Promise<void> {
  const layout = opts?.layout || "board";
  const canvas =
    layout === "contact"
      ? await renderContactSheetCanvas(doc, shots, title)
      : layout === "slides"
        ? await renderSlidesCanvas(doc, shots, title)
        : await renderBoardCanvas(doc, shots, title);
  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.92);
  const buf = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegToPdf(buf, canvas.width, canvas.height);
  const suffix =
    layout === "contact" ? "-contact" : layout === "slides" ? "-shots" : "";
  downloadBlob(pdf, `${slugify(title)}${suffix}.pdf`);
}

export async function exportBoardHtml(
  doc: CanvasDoc,
  shots: Shot[],
  title: string
): Promise<void> {
  const canvas = await renderBoardCanvas(doc, shots, title);
  const png = await canvasToBlob(canvas, "image/png");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to encode board image"));
    reader.readAsDataURL(png);
  });

  const esc = (s: string) =>
    (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const stickies = (doc.notes || [])
    .map((n) => `<li><pre>${esc(n.text || "")}</pre></li>`)
    .join("\n");
  const texts = (doc.texts || [])
    .map((t) => `<li><strong>${esc(t.style)}</strong> — ${esc(t.text || "")}</li>`)
    .join("\n");
  const frames = shots
    .filter((s) => doc.positions?.[s.id])
    .map((s) => {
      const label = esc(s.source_title || s.source_filename || s.id.slice(0, 8));
      return `<li>${label}</li>`;
    })
    .join("\n");

  // Plain-text only — do not render Markdown until sanitizer exists (audit dependency).
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(title || "Cinekive board")}</title>
<style>
  body{margin:0;background:#111;color:#E8EEF4;font:14px/1.45 Inter,system-ui,sans-serif}
  main{max-width:1100px;margin:0 auto;padding:24px}
  h1{color:#66FCF1;font-size:22px;margin:0 0 8px}
  .meta{color:#8B98A8;font-size:12px;margin-bottom:20px}
  img.board{width:100%;height:auto;border:1px solid #2a3440;border-radius:6px;background:#1F2833}
  section{margin-top:28px}
  h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8B98A8;margin:0 0 10px}
  ul{margin:0;padding-left:18px}
  pre{white-space:pre-wrap;margin:0;font:12px/1.4 ui-monospace,monospace;color:#E8EEF4}
  footer{margin-top:36px;color:#8B98A8;font-size:11px}
</style>
</head>
<body>
<main>
  <h1>${esc(title || "Cinekive board")}</h1>
  <p class="meta">Static export from Cinekive · for client review · offline</p>
  <img class="board" alt="Board" src="${dataUrl}"/>
  ${frames ? `<section><h2>Frames</h2><ul>${frames}</ul></section>` : ""}
  ${texts ? `<section><h2>Text</h2><ul>${texts}</ul></section>` : ""}
  ${stickies ? `<section><h2>Stickies</h2><ul>${stickies}</ul></section>` : ""}
  <footer>Generated locally. Not a license grant.</footer>
</main>
</body>
</html>`;

  downloadBlob(
    new Blob([html], { type: "text/html;charset=utf-8" }),
    `${slugify(title)}.html`
  );
}

export type ApprovedBriefMeta = {
  projectName?: string | null;
  brief?: string | null;
  feeling?: string | null;
  references?: string | null;
  approvedBy?: string;
};

/** Pro handoff: board PDF + markdown brief package (client approvals / production). */
export async function exportApprovedBriefPackage(
  doc: CanvasDoc,
  shots: Shot[],
  boardTitle: string,
  meta: ApprovedBriefMeta = {}
): Promise<void> {
  const { inferRights } = await import("@/lib/rights");
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ");
  const boardShots = shots.filter((s) => doc.positions?.[s.id]);
  const list = boardShots.length ? boardShots : shots;

  const craftTally: Record<string, number> = {};
  for (const s of list) {
    for (const key of [s.shot_type, s.lighting_style, s.composition, s.mood_vibe, ...(s.techniques || [])]) {
      if (!key) continue;
      craftTally[key] = (craftTally[key] || 0) + 1;
    }
  }
  const topCraft = Object.entries(craftTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, n]) => `- ${k} (${n})`)
    .join("\n");

  const rightsLines = list
    .map((s) => {
      const r = inferRights(s);
      const title = s.source_title || s.source_filename || s.id.slice(0, 8);
      return `- ${title} — **${r.label}** (${r.code}): ${r.hint}`;
    })
    .join("\n");

  const md = `# Approved brief package

**Board:** ${boardTitle}
**Project:** ${meta.projectName || "—"}
**Approved:** ${stamp}${meta.approvedBy ? ` · ${meta.approvedBy}` : ""}
**Frames on board:** ${list.length}

## Creative brief

${(meta.brief || "_No project brief set — add one in the project panel._").trim()}

## Feeling / tone

${(meta.feeling || "_—_").trim()}

## References

${(meta.references || "_—_").trim()}

## Craft summary (from board frames)

${topCraft || "_No craft tags yet._"}

## Frame rights / provenance

${rightsLines || "_No frames._"}

## Notes

- This package is a production handoff aid, not a legal license grant.
- Clear commercial use per frame before publish / broadcast.
- Generated by Cinekive · local-first archive
`;

  downloadBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${slugify(boardTitle)}-approved-brief.md`);

  const theme = { ...defaultCanvasTheme(), ...(doc.theme || {}) };
  const bg = theme.bg || "#111111";
  const accent = theme.accent || "#66FCF1";

  // Cover + board stacked into one PDF page strip
  const cover = document.createElement("canvas");
  cover.width = 1200;
  cover.height = 1600;
  const ctx = cover.getContext("2d");
  if (ctx) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cover.width, cover.height);
    ctx.fillStyle = accent;
    ctx.font = "700 28px Inter, system-ui, sans-serif";
    ctx.fillText("APPROVED", 64, 80);
    ctx.fillStyle = "#E8EEF4";
    ctx.font = "600 36px Inter, system-ui, sans-serif";
    wrapText(ctx, boardTitle || "Moodboard", 64, 140, 1070, 44, 3);
    ctx.fillStyle = theme.exportMutedColor || "#8B98A8";
    ctx.font = "400 16px Inter, system-ui, sans-serif";
    ctx.fillText(`${meta.projectName || "Project"} · ${stamp}`, 64, 280);
    ctx.fillStyle = "#E8EEF4";
    ctx.font = "500 18px Inter, system-ui, sans-serif";
    wrapText(ctx, meta.brief || "No brief on project yet.", 64, 340, 1070, 26, 18);
    if (meta.feeling) {
      ctx.fillStyle = "#E8B86D";
      ctx.font = "500 16px Inter, system-ui, sans-serif";
      wrapText(ctx, `Feeling: ${meta.feeling}`, 64, 900, 1070, 22, 4);
    }
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(64, 1400, 220, 48);
    ctx.font = "600 14px Inter, system-ui, sans-serif";
    ctx.fillText("CLIENT READY", 84, 1430);
  }

  const board = await renderBoardCanvas(doc, shots, boardTitle);
  const stack = document.createElement("canvas");
  const gap = 24;
  stack.width = Math.max(cover.width, board.width);
  stack.height = cover.height + gap + board.height;
  const sctx = stack.getContext("2d");
  if (!sctx) throw new Error("Canvas unsupported");
  sctx.fillStyle = bg;
  sctx.fillRect(0, 0, stack.width, stack.height);
  sctx.drawImage(cover, 0, 0);
  sctx.drawImage(board, 0, cover.height + gap);

  const jpegBlob = await canvasToBlob(stack, "image/jpeg", 0.9);
  const buf = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegToPdf(buf, stack.width, stack.height);
  downloadBlob(pdf, `${slugify(boardTitle)}-approved-package.pdf`);
}
