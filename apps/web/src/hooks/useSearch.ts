"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { SearchFilters, SearchResponse, Shot } from "@/lib/types";

export function useSearch(params: SearchFilters & { enabled?: boolean; fetchAll?: boolean }) {
  const { enabled = true, fetchAll = false, ...filters } = params;
  const query = (filters.query || "").trim();

  return useQuery({
    queryKey: ["search", { ...filters, fetchAll }],
    queryFn: () => {
      const body = {
        ...filters,
        query: query || undefined,
        group_sequences: filters.group_sequences ?? (fetchAll ? false : true),
        hide_duplicates: filters.hide_duplicates ?? true,
        limit: filters.limit ?? (query ? 200 : 96),
      };
      return fetchAll ? api.searchAll(body) : api.search(body);
    },
    enabled,
    placeholderData: (prev: SearchResponse | undefined) => prev,
  });
}

export function useShots(params: {
  projectId?: string | null;
  hasPreview?: boolean | null;
  isFavorite?: boolean | null;
  isHero?: boolean | null;
  isMoving?: boolean | null;
  shotType?: string | null;
  contentFormat?: string | null;
  emotion?: string | null;
  technique?: string | null;
  groupSequences?: boolean;
  randomize?: boolean;
  randomSeed?: number;
  limit?: number;
  fetchAll?: boolean;
  enabled?: boolean;
}) {
  const {
    projectId,
    hasPreview,
    isFavorite,
    isHero,
    isMoving,
    shotType,
    contentFormat,
    emotion,
    technique,
    groupSequences,
    randomize,
    randomSeed = 0,
    limit = 200,
    fetchAll = false,
    enabled = true,
  } = params;
  const group = groupSequences ?? (fetchAll ? false : true);
  return useQuery({
    queryKey: [
      "shots",
      projectId,
      hasPreview,
      isFavorite,
      isHero,
      isMoving,
      shotType,
      contentFormat,
      emotion,
      technique,
      group,
      randomize,
      randomSeed,
      limit,
      fetchAll,
    ],
    queryFn: async (): Promise<{ items: Shot[]; total: number }> => {
      if (fetchAll) {
        return api.listAllShots({
          project_id: projectId || undefined,
          has_preview: hasPreview ?? undefined,
          is_favorite: isFavorite ?? undefined,
          is_hero: isHero ?? undefined,
          is_moving: isMoving ?? undefined,
          shot_type: shotType || undefined,
          content_format: contentFormat || undefined,
          emotion: emotion || undefined,
          technique: technique || undefined,
          group_sequences: false,
          randomize: randomize || undefined,
        });
      }
      return api.listShots({
        project_id: projectId || undefined,
        has_preview: hasPreview ?? undefined,
        is_favorite: isFavorite ?? undefined,
        is_hero: isHero ?? undefined,
        is_moving: isMoving ?? undefined,
        shot_type: shotType || undefined,
        content_format: contentFormat || undefined,
        emotion: emotion || undefined,
        technique: technique || undefined,
        group_sequences: group,
        randomize: randomize || undefined,
        limit,
      });
    },
    enabled,
  });
}
