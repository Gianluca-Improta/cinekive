import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatTimecode(
  ms: number | null | undefined,
  fps: number | null | undefined = 24
): string {
  if (ms == null) return "—";
  const rate = fps && fps > 0 ? fps : 24;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const frames = Math.floor((ms % 1000) / (1000 / rate));
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
