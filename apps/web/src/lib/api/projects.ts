/** Project CRUD and links. */

import { request } from "./client";
import type { Project } from "../types";

  const listProjects = async () => {
      const data = await request<{ items: Project[]; total: number }>("/projects");
      return data.items;
    };

  const createProject = (body: {
      name: string;
      description?: string;
      kind?:
        | "commercial"
        | "social"
        | "archive"
        | "general"
        | "narrative"
        | "stills"
        | "video"
        | "mixed"
        | "props"
        | "locations"
        | "wardrobe";
      form_factor?: "long_form" | "short_form" | "mixed";
      aspect_ratio?: string;
      brief?: string;
      feeling?: string;
      references_text?: string;
      sampling_mode?: "fast" | "full" | "heroes" | "moments";
      generate_previews?: boolean;
      vlm_enrichment?: boolean;
    }) =>
      request<Project>("/projects", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const updateProject = (
      id: string,
      body: Partial<{
        name: string;
        description: string | null;
        kind:
          | "commercial"
          | "social"
          | "archive"
          | "general"
          | "narrative"
          | "stills"
          | "video"
          | "mixed"
          | "props"
          | "locations"
          | "wardrobe";
        form_factor: "long_form" | "short_form" | "mixed" | null;
        aspect_ratio: string | null;
        brief: string | null;
        feeling: string | null;
        references_text: string | null;
        sampling_mode: "fast" | "full" | "heroes" | "moments";
        generate_previews: boolean;
        vlm_enrichment: boolean;
        watch_folder: string | null;
        watch_enabled: boolean;
      }>
    ) =>
      request<Project>(`/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

  const getProject = (id: string) => request<Project>(`/projects/${id}`);

  const deleteProject = (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" });

  const importLink = (body: {
      url: string;
      project_id?: string;
      project_slug?: string;
      title?: string;
      ingest?: boolean;
    }) =>
      request<{ path: string; message: string }>("/seek/import-link", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const projectsApi = {
  listProjects,
  createProject,
  updateProject,
  getProject,
  deleteProject,
  importLink,
};
