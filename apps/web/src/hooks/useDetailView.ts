"use client";

import { useCallback, useEffect, useState } from "react";
import type { Shot } from "@/lib/types";
import type { DetailMode } from "@/components/shots/ShotDetailSheet";

const INSPECTOR_KEY = "cinekive.preferInspector";

function readPreferInspector(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = localStorage.getItem(INSPECTOR_KEY);
    if (v === null) return true; // default ON
    return v !== "0";
  } catch {
    return true;
  }
}

/** Shared shot detail open mode — inspector preferred by default. */
export function useDetailView() {
  const [preferInspector, setPreferInspectorState] = useState(true);
  const [detailMode, setDetailMode] = useState<DetailMode>("inspector");
  const [selected, setSelected] = useState<Shot | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false); // unused alias kept off

  useEffect(() => {
    const prefer = readPreferInspector();
    setPreferInspectorState(prefer);
    setDetailMode(prefer ? "inspector" : "popup");
  }, []);

  const setPreferInspector = useCallback((v: boolean) => {
    setPreferInspectorState(v);
    try {
      localStorage.setItem(INSPECTOR_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
    setDetailMode(v ? "inspector" : "popup");
  }, []);

  const openShot = useCallback(
    (shot: Shot, mode?: DetailMode) => {
      const next = mode ?? (preferInspector ? "inspector" : "popup");
      setDetailMode(next);
      setSelected(shot);
    },
    [preferInspector]
  );

  const closeShot = useCallback(() => {
    setSelected(null);
    setSheetExpanded(false);
  }, []);

  return {
    preferInspector,
    setPreferInspector,
    detailMode,
    setDetailMode,
    selected,
    setSelected,
    openShot,
    closeShot,
    sheetExpanded, // silence unused in older call sites
  };
}
