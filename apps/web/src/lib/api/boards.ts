/** Moodboard import and export bundles. */

import { request, getApiUrl } from "./client";

  const importBoardDocument = async (projectId: string, boardId: string, file: File, maxPages = 40) => {
      const form = new FormData();
      form.append("file", file);
      form.append("max_pages", String(maxPages));
      return request<{
        board_id: string;
        pages: Array<{ page: number; filename: string; url: string; width: number; height: number }>;
        message: string;
      }>(`/projects/${projectId}/boards/${boardId}/import-document`, {
        method: "POST",
        body: form,
      });
    };

  const exportBoardBundle = async (
      projectId: string,
      boardId: string,
      body: { canvas: unknown; board_name: string; media_urls: string[] }
    ) => {
      const res = await fetch(`${getApiUrl()}/projects/${projectId}/boards/${boardId}/export-bundle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = res.statusText;
        try {
          const data = await res.json();
          detail = data.detail || JSON.stringify(data);
        } catch {
          /* ignore */
        }
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      return res.blob();
    };

  const importBoardBundle = async (projectId: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return request<{
        board_id: string;
        canvas: Record<string, unknown>;
        message: string;
      }>(`/projects/${projectId}/boards/import-bundle`, {
        method: "POST",
        body: form,
      });
    };

export const boardsApi = {
  importBoardDocument,
  exportBoardBundle,
  importBoardBundle,
};
