"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { SearchFilters, SearchResponse } from "@/lib/types";

export function useSearch(params: SearchFilters & { enabled?: boolean }) {
  const { enabled = true, ...filters } = params;
  const query = (filters.query || "").trim();

  return useQuery({
    queryKey: ["search", filters],
    queryFn: () =>
      api.search({
        ...filters,
        query: query || undefined,
        group_sequences: filters.group_sequences ?? true,
        hide_duplicates: filters.hide_duplicates ?? true,
        limit: filters.limit ?? (query ? 200 : 96),
      }),
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
    groupSequences = true,
    randomize,
    randomSeed = 0,
    enabled = true,
  } = params;
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
      groupSequences,
      randomize,
      randomSeed,
    ],
    queryFn: () =>
      api.listShots({
        project_id: projectId || undefined,
        has_preview: hasPreview ?? undefined,
        is_favorite: isFavorite ?? undefined,
        is_hero: isHero ?? undefined,
        is_moving: isMoving ?? undefined,
        shot_type: shotType || undefined,
        content_format: contentFormat || undefined,
        emotion: emotion || undefined,
        technique: technique || undefined,
        group_sequences: groupSequences,
        randomize: randomize || undefined,
        limit: 200,
      }),
    enabled,
  });
}
