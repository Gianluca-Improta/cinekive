/** Archive sources, mirrors and credentials. */

import { request } from "./client";
import type { Job, Project } from "../types";

  const sourcesStatus = () =>
      request<{
        sources: {
          key: string;
          label: string;
          path: string;
          ingest_path: string;
          exists: boolean;
          image_count: number;
          manifest_updated_at?: string;
          mirror_available?: boolean;
          mirror_run?: { running?: boolean; pid?: number };
          archive_slug?: string;
          archive_name?: string;
          description?: string;
          site_url?: string;
          access?: string;
          requires_pro?: boolean;
          credentials_configured?: boolean;
          db_stats?: { tasks?: Record<string, number>; shots?: Record<string, number> };
        }[];
        custom_archives?: {
          id: string;
          name: string;
          slug: string;
          description: string | null;
          shot_count: number;
          folder: string;
        }[];
        suggestions?: {
          key: string;
          label: string;
          site_url: string;
          blurb: string;
          fit: string;
        }[];
        mirror_runs?: Record<string, { running?: boolean; pid?: number }>;
        credentials?: Record<string, { configured?: boolean; user_hint?: string }>;
        note?: string;
      }>("/sources/status");

  const createCustomArchive = (body: {
      name: string;
      description?: string;
      site_url?: string;
      source_note?: string;
    }) =>
      request<Project>("/archives", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const uploadToArchive = async (projectId: string, files: File[]) => {
      const form = new FormData();
      files.forEach((f) => {
        form.append("files", f, f.name.includes("/") ? f.name.split("/").pop() || f.name : f.name);
        // Explicit relative path — browsers/Starlette strip slashes from File.name
        form.append("relative_paths", f.name.replace(/\\/g, "/"));
      });
      return request<{ job: Job; message: string }>(`/archives/${projectId}/upload`, {
        method: "POST",
        body: form,
      });
    };

  const ingestArchiveFolder = (projectId: string) =>
      request<{ job: Job; message: string }>(`/archives/${projectId}/ingest-folder`, {
        method: "POST",
      });

  const ingestArchiveSource = (source: "filmgrab" | "eyecandy" | "moviestillsdb") =>
      request<{ job: Job; message: string }>(`/sources/${source}/ingest`, {
        method: "POST",
      });

  const ingestSource = (projectId: string, source: "filmgrab" | "eyecandy" | "moviestillsdb") =>
      request<{ job: Job; message: string }>(`/projects/${projectId}/sources/ingest`, {
        method: "POST",
        body: JSON.stringify({ source, recursive: true }),
      });

  const saveSourceCredentials = (body: { source: string; user: string; password: string }) =>
      request<{ source: string; configured: boolean; user_hint: string; message: string }>(
        "/sources/credentials",
        { method: "POST", body: JSON.stringify(body) }
      );

  const runSourceMirror = (body: {
      source: string;
      user?: string;
      password?: string;
      limit_shots?: number;
      limit_films?: number;
      limit_per_tech?: number;
      max_clips?: number;
      films?: string;
    }) =>
      request<{ message: string; pid?: number; running?: boolean }>("/sources/mirror/run", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const sourcesApi = {
  sourcesStatus,
  createCustomArchive,
  uploadToArchive,
  ingestArchiveFolder,
  ingestArchiveSource,
  ingestSource,
  saveSourceCredentials,
  runSourceMirror,
};
