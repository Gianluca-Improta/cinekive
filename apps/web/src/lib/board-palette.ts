/** Tiny client-side palette helpers for board strips (no VLM). */

export type BoardSwatch = { hex: string; percentage: number };

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** k-means on a downscaled image URL — for CanvasMedia / imported pages only. */
export async function kmeansPaletteFromImageUrl(
  url: string,
  k = 5
): Promise<BoardSwatch[]> {
  if (!url || typeof document === "undefined") return [];
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const maxEdge = 96;
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve([]);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const { data } = ctx.getImageData(0, 0, w, h);
        const samples: number[][] = [];
        for (let i = 0; i < data.length; i += 16) {
          const a = data[i + 3];
          if (a < 32) continue;
          samples.push([data[i], data[i + 1], data[i + 2]]);
        }
        if (!samples.length) {
          resolve([]);
          return;
        }
        const centers: number[][] = [];
        for (let i = 0; i < k; i++) {
          centers.push(samples[Math.floor((i * samples.length) / k) % samples.length].slice());
        }
        for (let iter = 0; iter < 8; iter++) {
          const buckets: number[][][] = Array.from({ length: k }, () => []);
          for (const s of samples) {
            let best = 0;
            let bestD = Infinity;
            for (let c = 0; c < k; c++) {
              const d =
                (s[0] - centers[c][0]) ** 2 +
                (s[1] - centers[c][1]) ** 2 +
                (s[2] - centers[c][2]) ** 2;
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
            buckets[best].push(s);
          }
          for (let c = 0; c < k; c++) {
            const b = buckets[c];
            if (!b.length) continue;
            centers[c] = [
              b.reduce((n, p) => n + p[0], 0) / b.length,
              b.reduce((n, p) => n + p[1], 0) / b.length,
              b.reduce((n, p) => n + p[2], 0) / b.length,
            ];
          }
        }
        const counts = new Array(k).fill(0);
        for (const s of samples) {
          let best = 0;
          let bestD = Infinity;
          for (let c = 0; c < k; c++) {
            const d =
              (s[0] - centers[c][0]) ** 2 +
              (s[1] - centers[c][1]) ** 2 +
              (s[2] - centers[c][2]) ** 2;
            if (d < bestD) {
              bestD = d;
              best = c;
            }
          }
          counts[best] += 1;
        }
        const total = counts.reduce((a, b) => a + b, 0) || 1;
        const out = centers
          .map((c, i) => ({
            hex: rgbToHex(c[0], c[1], c[2]),
            percentage: Math.round((counts[i] / total) * 1000) / 10,
          }))
          .filter((s) => s.percentage > 0)
          .sort((a, b) => b.percentage - a.percentage);
        resolve(out);
      } catch {
        resolve([]);
      }
    };
    img.onerror = () => resolve([]);
    img.src = url;
  });
}
