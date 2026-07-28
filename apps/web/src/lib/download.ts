import type { Shot } from "./types";

/** Trigger a save dialog for an in-memory blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const blobUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

/** Fetch artifact and trigger a save dialog without leaving the page. */
export async function downloadArtifact(url: string, filename: string): Promise<void> {
  if (!url) throw new Error("Missing download URL");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  downloadBlob(blob, filename);
}

function slugBase(shot: Pick<Shot, "source_title" | "source_filename">): string {
  return (shot.source_title || shot.source_filename || "shot")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function roleSuffix(shot: Pick<Shot, "frame_role">): string {
  return shot.frame_role && shot.frame_role !== "mid" ? `-${shot.frame_role}` : "";
}

export function extensionFromUrl(url: string, fallback = ".bin"): string {
  try {
    const path = new URL(url, "http://local").pathname;
    const dot = path.lastIndexOf(".");
    if (dot >= 0) return path.slice(dot).toLowerCase();
  } catch {
    /* ignore */
  }
  return fallback;
}

/** Build a sensible filename for hero frame, loop preview, or GIF exports. */
export function shotArtifactFilename(
  shot: Pick<Shot, "source_title" | "source_filename" | "frame_role">,
  kind: "frame" | "loop",
  url?: string
): string {
  const base = slugBase(shot);
  const role = roleSuffix(shot);
  if (kind === "frame") return `${base}${role}.jpg`;
  const ext = url ? extensionFromUrl(url, ".webp") : ".webp";
  return `${base}${role}-loop${ext}`;
}
