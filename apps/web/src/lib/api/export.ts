/** Clip and library exports. */

import { getApiUrl } from "./client";
import { downloadBlob } from "../download";

  const exportShotClip = async (shotId: string, handlesSec = 0) => {
      const res = await fetch(`${getApiUrl()}/shots/${shotId}/clip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles_sec: handlesSec, copy_streams: false }),
      });
      if (!res.ok) throw new Error("Clip export failed");
      const blob = await res.blob();
      downloadBlob(blob, `clip_${shotId.slice(0, 8)}.mp4`);
    };

  const exportShots = async (
      shotIds: string[],
      format: "zip" | "json" | "framechain" | "edl" = "zip"
    ) => {
      const res = await fetch(`${getApiUrl()}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shot_ids: shotIds, format, include_previews: false }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const ext = format === "zip" ? "zip" : format === "edl" ? "edl" : "json";
      downloadBlob(blob, `cinearchive_export.${ext}`);
    };

  const exportProject = async (
      projectId: string,
      format: "gallery" | "zip" | "pptx" = "gallery",
      opts?: { include_previews?: boolean }
    ) => {
      const res = await fetch(`${getApiUrl()}/projects/${projectId}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          include_previews: Boolean(opts?.include_previews),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Project export failed");
      }
      const blob = await res.blob();
      const ext = format === "pptx" ? "pptx" : "zip";
      const cd = res.headers.get("content-disposition") || "";
      const match = /filename="?([^";]+)"?/i.exec(cd);
      downloadBlob(blob, match?.[1] || `cinekive_project.${ext}`);
    };

export const exportApi = {
  exportShotClip,
  exportShots,
  exportProject,
};
