/** Shot listing, editing, bin and bulk actions. */

import { request } from "./client";
import type { SearchResponse, Shot, Taxonomy } from "../types";

  const listShots = (params?: {
      project_id?: string;
      has_preview?: boolean;
      is_favorite?: boolean;
      is_hero?: boolean;
      is_moving?: boolean;
      hide_duplicates?: boolean;
      group_sequences?: boolean;
      shot_type?: string;
      content_format?: string;
      emotion?: string;
      technique?: string;
      randomize?: boolean;
      offset?: number;
      limit?: number;
    }) => {
      const q = new URLSearchParams();
      if (params?.project_id) q.set("project_id", params.project_id);
      if (params?.has_preview !== undefined) q.set("has_preview", String(params.has_preview));
      if (params?.is_favorite !== undefined) q.set("is_favorite", String(params.is_favorite));
      if (params?.is_hero !== undefined) q.set("is_hero", String(params.is_hero));
      if (params?.is_moving !== undefined) q.set("is_moving", String(params.is_moving));
      if (params?.hide_duplicates !== undefined)
        q.set("hide_duplicates", String(params.hide_duplicates));
      if (params?.group_sequences !== undefined)
        q.set("group_sequences", String(params.group_sequences));
      if (params?.shot_type) q.set("shot_type", params.shot_type);
      if (params?.content_format) q.set("content_format", params.content_format);
      if (params?.emotion) q.set("emotion", params.emotion);
      if (params?.technique) q.set("technique", params.technique);
      if (params?.randomize) q.set("randomize", "true");
      if (params?.offset !== undefined) q.set("offset", String(params.offset));
      if (params?.limit !== undefined) q.set("limit", String(params.limit));
      const qs = q.toString();
      return request<{ items: Shot[]; total: number; offset: number; limit: number }>(
        `/shots${qs ? `?${qs}` : ""}`
      );
    };

  /** Page through /shots until every matching still is loaded (for Infinite / Living). */
  const listAllShots = async (params?: {
      project_id?: string;
      has_preview?: boolean;
      is_favorite?: boolean;
      is_hero?: boolean;
      is_moving?: boolean;
      hide_duplicates?: boolean;
      group_sequences?: boolean;
      shot_type?: string;
      content_format?: string;
      emotion?: string;
      technique?: string;
      randomize?: boolean;
      pageSize?: number;
    }) => {
      const pageSize = Math.min(Math.max(params?.pageSize ?? 1000, 1), 2000);
      const { pageSize: _ps, ...rest } = params || {};
      const items: Shot[] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await listShots({
          ...rest,
          group_sequences: rest.group_sequences ?? false,
          hide_duplicates: rest.hide_duplicates ?? true,
          offset,
          limit: pageSize,
        });
        items.push(...page.items);
        total = page.total;
        if (!page.items.length) break;
        offset += page.items.length;
        if (page.items.length < pageSize) break;
      }
      return { items, total: items.length };
    };

  const getShot = (id: string) => request<Shot>(`/shots/${id}`);

  const generateFromShot = (
      id: string,
      body?: {
        prompt?: string;
        model?: string;
        backend?: string;
        strength?: number;
        size?: number;
        family?: string;
      }
    ) =>
      request<{ job: { id: string }; message: string }>(`/shots/${id}/generate`, {
        method: "POST",
        body: JSON.stringify(body || {}),
      });

  const getTaxonomy = () => request<Taxonomy>("/taxonomy");

  const updateShot = (
      id: string,
      body: Partial<{
        tags: string[];
        techniques: string[];
        notes: string | null;
        is_favorite: boolean;
        is_hero: boolean;
        shot_type: string | null;
        camera_movement: string | null;
        camera_angle: string | null;
        lighting_style: string | null;
        composition: string | null;
        subject: string | null;
        lens_look: string | null;
        color_grade: string | null;
        mood_vibe: string | null;
        creative_intent: string | null;
        content_format: string | null;
        emotion: string | null;
      }>
    ) =>
      request<Shot>(`/shots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });

  const bulkDeleteShots = (shot_ids: string[]) =>
      request<{ affected: number; message: string }>("/shots/bulk/delete", {
        method: "POST",
        body: JSON.stringify({ shot_ids }),
      });

  const listBin = (params?: { project_id?: string; offset?: number; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.project_id) q.set("project_id", params.project_id);
      if (params?.offset != null) q.set("offset", String(params.offset));
      if (params?.limit != null) q.set("limit", String(params.limit));
      const qs = q.toString();
      return request<{ items: Shot[]; total: number; offset: number; limit: number }>(
        `/shots/bin${qs ? `?${qs}` : ""}`
      );
    };

  const bulkRestoreShots = (shot_ids: string[]) =>
      request<{ affected: number; message: string }>("/shots/bulk/restore", {
        method: "POST",
        body: JSON.stringify({ shot_ids }),
      });

  const bulkPurgeShots = (shot_ids: string[]) =>
      request<{ affected: number; message: string }>("/shots/bulk/purge", {
        method: "POST",
        body: JSON.stringify({ shot_ids }),
      });

  const purgeExpiredBin = () =>
      request<{ affected: number; message: string }>("/shots/bin/purge-expired", {
        method: "POST",
      });

  const bulkMoveShots = (body: {
      shot_ids: string[];
      target_project_id: string;
      mode?: "move" | "copy";
    }) =>
      request<{ affected: number; message: string }>("/shots/bulk/move", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const bulkAddToCollection = (body: { shot_ids: string[]; collection_id: string }) =>
      request<{ affected: number; message: string }>("/shots/bulk/collection", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const searchCraft = (body: { shot_id: string; limit?: number }) =>
      request<SearchResponse>("/search/craft", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const shotsApi = {
  listShots,
  listAllShots,
  getShot,
  generateFromShot,
  getTaxonomy,
  updateShot,
  bulkDeleteShots,
  listBin,
  bulkRestoreShots,
  bulkPurgeShots,
  purgeExpiredBin,
  bulkMoveShots,
  bulkAddToCollection,
  searchCraft,
};
