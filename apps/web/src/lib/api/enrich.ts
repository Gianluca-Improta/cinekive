/** Enrichment, dialogue and dedupe jobs. */

import { request } from "./client";
import type { Job } from "../types";

  const enrichProject = (
      projectId: string,
      body?: { shot_ids?: string[]; force?: boolean; tier?: string; model?: string }
    ) =>
      request<{ job: Job; message: string }>(`/projects/${projectId}/enrich`, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });

  const dialogueProject = (
      projectId: string,
      body?: { shot_ids?: string[]; force?: boolean; model?: string }
    ) =>
      request<{ job: Job; message: string }>(`/projects/${projectId}/dialogue`, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });

  const asrStatus = () =>
      request<{ available: boolean; backends: string[]; enabled: boolean; model: string }>(
        "/asr/status"
      );

  const dedupeProject = (projectId: string) =>
      request<{ job: Job; message: string }>(`/projects/${projectId}/dedupe`, {
        method: "POST",
        body: JSON.stringify({}),
      });

export const enrichApi = {
  enrichProject,
  dialogueProject,
  asrStatus,
  dedupeProject,
};
