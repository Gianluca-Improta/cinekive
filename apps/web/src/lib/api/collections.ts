/** Collections and the built-in project shelves. */

import { request } from "./client";
import { BUILTIN_SHELVES, shelfKeyOf } from "../project-shelves";
import type { Collection, CollectionDetail, Job } from "../types";

  const listCollections = (params?: { project_id?: string; kind?: string }) => {
      const q = new URLSearchParams();
      if (params?.project_id) q.set("project_id", params.project_id);
      if (params?.kind) q.set("kind", params.kind);
      const qs = q.toString();
      return request<Collection[]>(`/collections${qs ? `?${qs}` : ""}`);
    };

  const getCollection = (id: string) => request<CollectionDetail>(`/collections/${id}`);

  const createCollection = (body: {
      name: string;
      description?: string;
      project_id?: string;
      kind?: string;
      year?: number;
      content_format?: string;
      sampling_mode?: string;
      meta?: Record<string, unknown>;
    }) =>
      request<Collection>("/collections", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const updateCollection = (
      id: string,
      body: { name?: string; description?: string | null; meta?: Record<string, unknown> }
    ) =>
      request<Collection>(`/collections/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

  const removeFromCollection = (collectionId: string, shotIds: string[]) =>
      request(`/collections/${collectionId}/shots/remove`, {
        method: "POST",
        body: JSON.stringify({ shot_ids: shotIds }),
      });

  const ingestIntoCollection = (
      collectionId: string,
      body: {
        paths: string[];
        project_id: string;
        recursive?: boolean;
        sampling_mode?: string;
        generate_previews?: boolean;
      }
    ) =>
      request<{ job: Job; message: string }>(`/collections/${collectionId}/ingest`, {
        method: "POST",
        body: JSON.stringify(body),
      });

  const addToCollection = (collectionId: string, shotIds: string[]) =>
      request(`/collections/${collectionId}/shots`, {
        method: "POST",
        body: JSON.stringify({ shot_ids: shotIds }),
      });

  /** Department shelves inside a project (built-ins + any custom). */
  const ensureProjectShelves = async (projectId: string) => {
      const existing = await listCollections({ project_id: projectId, kind: "shelf" });
      const byKey = new Map<string, Collection>();
      for (const c of existing) {
        byKey.set(shelfKeyOf(c), c);
      }
      for (const w of BUILTIN_SHELVES) {
        if (byKey.has(w.key)) continue;
        const created = await createCollection({
          name: w.label,
          project_id: projectId,
          kind: "shelf",
          description: w.hint
            ? `${w.label} — ${w.hint}`
            : `${w.label} shelf — department refs inside this project`,
          meta: { shelf: w.key, builtin: true },
        });
        byKey.set(w.key, created);
      }
      return Object.fromEntries(byKey.entries()) as Record<string, Collection>;
    };

  /** Create a user-named shelf tab for a project. */
  const createProjectShelf = async (projectId: string, name: string) => {
      const label = name.trim().slice(0, 48);
      if (!label) throw new Error("Name required");
      const created = await createCollection({
        name: label,
        project_id: projectId,
        kind: "shelf",
        description: `${label} — custom project shelf`,
        meta: { shelf: "custom", custom: true },
      });
      return { collection: created, key: shelfKeyOf(created) };
    };

export const collectionsApi = {
  listCollections,
  getCollection,
  createCollection,
  updateCollection,
  removeFromCollection,
  ingestIntoCollection,
  addToCollection,
  ensureProjectShelves,
  createProjectShelf,
};
