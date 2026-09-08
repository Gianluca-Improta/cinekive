/** Client-side project lookbook PDF (contact sheet). */

import { artifactUrl } from "@/lib/api-client";
import { downloadBlob } from "@/lib/download";
import type { Shot } from "@/lib/types";

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

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Export failed"))), type, quality);
  });
}

/** Minimal single-page PDF wrapping a JPEG (same approach as board-export). */
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
    (name || "project")
      .replace(/[^\w.\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 60) || "project"
  );
}

/** Multi-page-feel contact sheet PDF (one tall canvas page). */
export async function exportProjectPdf(
  shots: Shot[],
  title: string,
  opts?: { feeling?: string | null; max?: number }
): Promise<void> {
  const list = shots.slice(0, opts?.max ?? 60);
  if (!list.length) throw new Error("No shots to export");

  const cols = 3;
  const cellW = 420;
  const cellH = 280;
  const gap = 16;
  const pad = 48;
  const headerH = 72;
  const rows = Math.ceil(list.length / cols);
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const height = pad * 2 + headerH + rows * cellH + (rows - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = Math.min(width, 3600);
  canvas.height = Math.min(height, 12000);
  const scale = canvas.width / width;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.scale(scale, scale);
  ctx.fillStyle = "#0b0c0e";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#f2f4f7";
  ctx.font = "600 28px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(title || "Cinekive lookbook", pad, pad + 28);
  ctx.fillStyle = "#8b919a";
  ctx.font = "14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    opts?.feeling?.trim() || `${list.length} references`,
    pad,
    pad + 52
  );

  await Promise.all(
    list.map(async (shot, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = pad + col * (cellW + gap);
      const y = pad + headerH + row * (cellH + gap);
      const url = artifactUrl(shot.keyframe_url || shot.thumb_md_url || shot.thumb_url);
      const img = await loadImage(url);
      ctx.fillStyle = "#14161a";
      ctx.fillRect(x, y, cellW, cellH);
      if (img) {
        const ir = img.width / Math.max(img.height, 1);
        const cr = cellW / cellH;
        let dw = cellW;
        let dh = cellH;
        let dx = x;
        let dy = y;
        if (ir > cr) {
          dh = cellW / ir;
          dy = y + (cellH - dh) / 2;
        } else {
          dw = cellH * ir;
          dx = x + (cellW - dw) / 2;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
      }
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x, y + cellH - 36, cellW, 36);
      ctx.fillStyle = "#fff";
      ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
      const label = (shot.source_title || shot.source_filename || shot.shot_type || "shot").slice(
        0,
        42
      );
      ctx.fillText(label, x + 10, y + cellH - 14);
    })
  );

  const jpegBlob = await canvasToBlob(canvas, "image/jpeg", 0.9);
  const buf = new Uint8Array(await jpegBlob.arrayBuffer());
  const pdf = jpegToPdf(buf, canvas.width, canvas.height);
  downloadBlob(pdf, `${slugify(title)}-lookbook.pdf`);
}
