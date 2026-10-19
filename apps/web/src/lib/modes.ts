"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ModeListResponse, type ModePack } from "@/lib/api-client";

const STORAGE_KEY = "cinekive.mode";
export const DEFAULT_MODE = "cinematic";

/** Fallback used before the API answers, so the UI never renders empty labels. */
export const FALLBACK_PACK: ModePack = {
  id: DEFAULT_MODE,
  label: "Cinematic",
  short_label: "Cinema",
  reference_noun: "shot",
  reference_noun_plural: "shots",
  creator_noun: "cinematographer",
  creator_noun_plural: "cinematographers",
  hero_line: "Stills, clips, and frames — searchable by craft, colour, and light.",
  search_placeholder: "Search shots, lighting setups, lenses, grades…",
  suggestions: [],
  facets: [],
  category_labels: {},
  interests: [],
  sources: [],
};

export function getStoredMode(): string {
  if (typeof window === "undefined") return DEFAULT_MODE;
  try {
    return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_MODE;
  } catch {
    return DEFAULT_MODE;
  }
}

export function setStoredMode(modeId: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, modeId);
  } catch {
    /* storage unavailable */
  }
}

export function useModes() {
  return useQuery<ModeListResponse>({
    queryKey: ["modes"],
    queryFn: () => api.getModes(),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The active mode. Switching a mode changes the vocabulary of the whole app
 * (what a record is called, which suggestions show) without changing the data.
 */
export function useMode() {
  const { data, isLoading } = useModes();
  const [modeId, setModeId] = useState<string>(DEFAULT_MODE);

  useEffect(() => {
    const stored = getStoredMode();
    if (stored) setModeId(stored);
  }, []);

  const modes = data?.modes ?? [];
  const pack = modes.find((m) => m.id === modeId) ?? modes[0] ?? FALLBACK_PACK;

  const selectMode = useCallback((next: string) => {
    setModeId(next);
    setStoredMode(next);
  }, []);

  return { pack, modes, selectMode, isLoading };
}
