/** Inspiration Seek. */

import { request } from "./client";

  const seekStatus = () =>
      request<{
        enabled: boolean;
        download_dir: string;
        providers: string[];
        brave_configured?: boolean;
        yt_dlp?: boolean;
        note: string;
      }>("/seek/status");

  const seekSearch = (body: { query: string; limit?: number }) =>
      request<{
        enabled: boolean;
        results: {
          title: string;
          source: string;
          url: string;
          thumb_url: string | null;
          tags: string[] | null;
          license_note: string | null;
        }[];
      }>("/seek/search", { method: "POST", body: JSON.stringify(body) });

  const seekDownload = (body: {
      url: string;
      title?: string;
      source?: string;
      project_slug?: string;
    }) =>
      request<{ path: string; message: string }>("/seek/download", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const seekApi = {
  seekStatus,
  seekSearch,
  seekDownload,
};
