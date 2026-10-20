/** Ingesting media into a project. */

import { request } from "./client";
import type { Job } from "../types";

  const ingestVideos = async (projectId: string, files: File[]) => {
      const form = new FormData();
      files.forEach((f) => form.append("files", f));
      return request<{ job: Job; message: string }>(
        `/projects/${projectId}/ingest/videos/upload`,
        { method: "POST", body: form }
      );
    };

  const ingestImages = async (projectId: string, files: File[]) => {
      const form = new FormData();
      files.forEach((f) => {
        form.append("files", f, f.name.includes("/") ? f.name.split("/").pop() || f.name : f.name);
        form.append("relative_paths", f.name.replace(/\\/g, "/"));
      });
      return request<{ job: Job; message: string }>(
        `/projects/${projectId}/ingest/images/upload`,
        { method: "POST", body: form }
      );
    };

export const ingestApi = {
  ingestVideos,
  ingestImages,
};
