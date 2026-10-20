/** Search, palette, translation and moodboards. */

import { request } from "./client";
import type { MoodboardResponse, SearchFilters, SearchResponse } from "../types";

  const search = (body: SearchFilters) =>
      request<SearchResponse>("/search", {
        method: "POST",
        body: JSON.stringify(body),
      });

  /** Page through /search until every matching still is loaded (for Infinite / Living). */
  const searchAll = async (body: SearchFilters & { pageSize?: number }) => {
      const pageSize = Math.min(Math.max(body.pageSize ?? 1000, 1), 2000);
      const { pageSize: _ps, ...rest } = body;
      const results: SearchResponse["results"] = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const page = await search({
          ...rest,
          group_sequences: rest.group_sequences ?? false,
          hide_duplicates: rest.hide_duplicates ?? true,
          offset,
          limit: pageSize,
        });
        results.push(...page.results);
        total = page.total;
        if (!page.results.length) break;
        offset += page.results.length;
        if (page.results.length < pageSize) break;
      }
      return {
        results,
        total: results.length,
        query: body.query ?? null,
      } satisfies SearchResponse;
    };

  const searchPalette = (body: { shot_id?: string; colors?: string[]; project_id?: string; limit?: number }) =>
      request<SearchResponse>("/search/palette", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const searchSimilar = (body: { shot_id: string; project_id?: string; limit?: number }) =>
      request<SearchResponse>("/search/similar", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const searchSameSource = (body: { shot_id: string; limit?: number }) =>
      request<SearchResponse>("/search/same-source", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const translate = (body: { text: string; source_lang?: string; target_lang: string }) =>
      request<{
        translated_text: string;
        source_lang: string;
        target_lang: string;
        provider: string;
      }>("/translate", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const translateBatch = (body: {
      texts: string[];
      source_lang?: string;
      target_lang: string;
    }) =>
      request<{
        items: { text: string; translated_text: string; provider: string }[];
        source_lang: string;
        target_lang: string;
      }>("/translate/batch", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const moodboard = (body: {
      text: string;
      project_id?: string;
      limit?: number;
      shot_type?: string;
      mood_vibe?: string;
    }) =>
      request<MoodboardResponse>("/moodboard", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const searchApi = {
  search,
  searchAll,
  searchPalette,
  searchSimilar,
  searchSameSource,
  translate,
  translateBatch,
  moodboard,
};
