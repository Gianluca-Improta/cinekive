/** Native drag-out of shot frames into other apps (PPT, Finder, Explorer, etc.). */

import type { DragEvent } from "react";
import { artifactUrl } from "@/lib/api-client";
import { shotArtifactFilename } from "@/lib/download";
import type { Shot } from "@/lib/types";

const blobCache = new Map<string, File>();

export function shotFrameUrl(shot: Shot): string {
  return artifactUrl(shot.keyframe_url || shot.thumb_md_url || shot.thumb_url);
}

/** Prefetch keyframe as a File so dragstart can attach it synchronously. */
export async function prefetchShotDragFile(shot: Shot): Promise<File | null> {
  const url = shotFrameUrl(shot);
  if (!url) return null;
  const cached = blobCache.get(shot.id);
  if (cached) return cached;
  try {
    const res = await fetch(url, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const name = shotArtifactFilename(shot, "frame");
    const file = new File([blob], name, { type: blob.type || "image/jpeg" });
    blobCache.set(shot.id, file);
    if (blobCache.size > 80) {
      const first = blobCache.keys().next().value;
      if (first) blobCache.delete(first);
    }
    return file;
  } catch {
    return null;
  }
}

export function applyShotDragData(e: DragEvent, shot: Shot, file?: File | null): void {
  const url = shotFrameUrl(shot);
  const name = shotArtifactFilename(shot, "frame");
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("text/uri-list", url);
  e.dataTransfer.setData("text/plain", url);
  if (url.startsWith("http")) {
    e.dataTransfer.setData("DownloadURL", `image/jpeg:${name}:${url}`);
  }
  const f = file || blobCache.get(shot.id);
  if (f) {
    try {
      e.dataTransfer.items.add(f);
    } catch {
      /* some browsers reject File adds */
    }
  }
}
