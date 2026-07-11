"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { GlobalSearchBar } from "@/components/search/GlobalSearchBar";
import { AdvancedFilters } from "@/components/search/AdvancedFilters";
import { FilterDial, type DialFilters } from "@/components/search/FilterDial";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { ViewControls, type ViewMode } from "@/components/grid/ViewControls";
import { ShotDetailSheet } from "@/components/shots/ShotDetailSheet";
import { ShotSelectionBar } from "@/components/shots/ShotSelectionBar";
import { useSearch, useShots } from "@/hooks/useSearch";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

const emptyDial = (): DialFilters => ({
  shotType: "",
  technique: "",
  composition: "",
  era: "",
  origin: "",
  ism: "",
  director: "",
  visualStyle: "",
  theme: "",
  genre: "",
  shape: "",
  emotion: "",
  contentFormat: "",
  mood: "",
});

export default function HomePage() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Shot | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hasPreviewOnly, setHasPreviewOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [heroesOnly, setHeroesOnly] = useState(false);
  const [movingOnly, setMovingOnly] = useState(false);
  const [dial, setDial] = useState<DialFilters>(emptyDial);
  const [colorHex, setColorHex] = useState<string | undefined>();
  const [paletteShots, setPaletteShots] = useState<Shot[] | null>(null);
  const [randomSeed, setRandomSeed] = useState(0);
  const [randomize, setRandomize] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [columns, setColumns] = useState(4);
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");

  useEffect(() => {
    try {
      const v = localStorage.getItem("cinekive.preferInspector");
      if (v === "0") {
        setPreferInspector(false);
        setDetailMode("popup");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const patchDial = useCallback((patch: Partial<DialFilters>) => {
    setPaletteShots(null);
    setRandomize(false);
    setDial((d) => ({ ...d, ...patch }));
  }, []);

  const onShiftAlike = useCallback(
    (shot: Shot) => {
      setPaletteShots(null);
      setSelected(null);
      setQuery("");
      patchDial({
        composition: shot.composition || "",
        shotType: shot.shot_type || "",
        emotion: shot.emotion || "",
        technique: shot.techniques?.[0] || "",
        contentFormat: shot.content_format || "",
        mood: shot.mood_vibe || "",
        visualStyle: shot.visual_style || "",
        theme: shot.theme || "",
        era: shot.era || "",
        origin: shot.origin || "",
        ism: shot.ism || "",
        director: shot.director || (shot.source_meta?.director as string) || "",
      });
    },
    [patchDial]
  );

  const searching =
    query.trim().length > 0 ||
    !!dial.shotType ||
    !!dial.mood ||
    !!dial.contentFormat ||
    !!dial.emotion ||
    !!dial.technique ||
    !!dial.composition ||
    !!dial.era ||
    !!dial.origin ||
    !!dial.ism ||
    !!dial.director ||
    !!dial.visualStyle ||
    !!dial.theme ||
    !!dial.genre ||
    !!dial.shape ||
    !!colorHex ||
    favoritesOnly ||
    hasPreviewOnly ||
    heroesOnly ||
    movingOnly ||
    randomize;

  const searchQuery = useSearch({
    query: query.trim(),
    has_preview: hasPreviewOnly ? true : undefined,
    is_favorite: favoritesOnly ? true : undefined,
    is_hero: heroesOnly ? true : undefined,
    is_moving: movingOnly ? true : undefined,
    shot_type: dial.shotType || undefined,
    mood_vibe: dial.mood || undefined,
    content_format: dial.contentFormat || undefined,
    emotion: dial.emotion || undefined,
    technique: dial.technique || undefined,
    composition: dial.composition || undefined,
    era: dial.era || undefined,
    origin: dial.origin || undefined,
    ism: dial.ism || undefined,
    director: dial.director || undefined,
    visual_style: dial.visualStyle || undefined,
    theme: dial.theme || undefined,
    genre: dial.genre || undefined,
    shape: dial.shape || undefined,
    color_hex: colorHex,
    randomize: randomize || undefined,
    group_sequences: true,
    enabled: searching && !paletteShots,
  });

  const shotsQuery = useShots({
    isHero: heroesOnly ? true : undefined,
    isMoving: movingOnly ? true : undefined,
    groupSequences: true,
    randomize,
    randomSeed,
    enabled: !searching && !paletteShots,
  });

  const paletteMutation = useMutation({
    mutationFn: (shotId: string) => api.searchPalette({ shot_id: shotId, limit: 48 }),
    onSuccess: (data) => {
      setPaletteShots(data.results.map((r) => r.shot));
      setSelected(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.bulkDeleteShots([id]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["bin"] });
      setSelected(null);
    },
  });

  const shots = useMemo(() => {
    if (paletteShots) return paletteShots;
    if (searching) return searchQuery.data?.results.map((r) => r.shot) ?? [];
    return shotsQuery.data?.items ?? [];
  }, [paletteShots, searching, searchQuery.data, shotsQuery.data]);

  const onChange = useCallback((v: string) => {
    setPaletteShots(null);
    setRandomize(false);
    setQuery(v);
  }, []);

  const onRandomize = useCallback(() => {
    setPaletteShots(null);
    setRandomize(true);
    setRandomSeed((s) => s + 1);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b border-cinema-border px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[8rem] shrink-0">
            <h1 className="text-base font-semibold tracking-tight text-white">
              {t("discovery.title")}
            </h1>
            <p className="text-[11px] text-cinema-muted">
              {t("discovery.subtitle")}
              {colorHex ? ` · color ${colorHex}` : ""}
            </p>
          </div>
          <GlobalSearchBar
            value={query}
            onChange={onChange}
            placeholder={t("discovery.searchPlaceholder")}
          />
          <FilterDial value={dial} onChange={patchDial} />
          <ViewControls
            viewMode={viewMode}
            columns={columns}
            onViewMode={setViewMode}
            onColumns={setColumns}
            inspectorMode={preferInspector}
            onInspectorMode={(v) => {
              setPreferInspector(v);
              try {
                localStorage.setItem("cinekive.preferInspector", v ? "1" : "0");
              } catch {
                /* ignore */
              }
              if (selected) setDetailMode(v ? "inspector" : "popup");
            }}
          />
          {paletteShots && (
            <button
              type="button"
              onClick={() => setPaletteShots(null)}
              className="text-xs text-cinema-muted hover:text-white"
            >
              {t("discovery.clearPalette")}
            </button>
          )}
        </div>
        <AdvancedFilters
          shotType={dial.shotType}
          composition={dial.composition}
          mood={dial.mood}
          contentFormat={dial.contentFormat}
          emotion={dial.emotion}
          technique={dial.technique}
          favoritesOnly={favoritesOnly}
          hasPreviewOnly={hasPreviewOnly}
          heroesOnly={heroesOnly}
          movingOnly={movingOnly}
          onShotType={(v) => patchDial({ shotType: v })}
          onComposition={(v) => patchDial({ composition: v })}
          onMood={(v) => patchDial({ mood: v })}
          onContentFormat={(v) => patchDial({ contentFormat: v })}
          onEmotion={(v) => patchDial({ emotion: v })}
          onTechnique={(v) => patchDial({ technique: v })}
          onFavoritesOnly={(v) => {
            setPaletteShots(null);
            setFavoritesOnly(v);
          }}
          onHasPreviewOnly={(v) => {
            setPaletteShots(null);
            setHasPreviewOnly(v);
          }}
          onHeroesOnly={(v) => {
            setPaletteShots(null);
            setHeroesOnly(v);
          }}
          onMovingOnly={(v) => {
            setPaletteShots(null);
            setMovingOnly(v);
          }}
          onRandomize={onRandomize}
        />
        {colorHex && (
          <button
            type="button"
            onClick={() => setColorHex(undefined)}
            className="text-[11px] text-cinema-cyan"
          >
            Clear color filter {colorHex}
          </button>
        )}
      </header>

      <div className="flex-1 px-6 py-4">
        <ShotSelectionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
        />
        {(searchQuery.isFetching || shotsQuery.isFetching || paletteMutation.isPending) &&
        shots.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-cinema-muted">
            {t("discovery.loading")}
          </div>
        ) : (
          <VirtualMasonryGrid
            shots={shots}
            selectedIds={selectedIds}
            onSelect={(shot, ev) => {
              if (ev?.metaKey || ev?.ctrlKey || ev?.shiftKey) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(shot.id)) next.delete(shot.id);
                  else if (next.size < 200) next.add(shot.id);
                  return next;
                });
                return;
              }
              setDetailMode(preferInspector ? "inspector" : "popup");
              setSelected(shot);
            }}
            onOpenPopup={(shot) => {
              setDetailMode("popup");
              setSelected(shot);
            }}
            columns={columns}
            viewMode={viewMode}
            onDelete={(s) => {
              if (
                confirm(
                  "Move this shot to the bin? It will be permanently deleted after 30 days."
                )
              ) {
                deleteMutation.mutate(s.id);
              }
            }}
            onColorClick={(hex) => {
              setPaletteShots(null);
              setColorHex(hex);
            }}
          />
        )}
      </div>

      <ShotDetailSheet
        shot={selected}
        mode={detailMode}
        onModeChange={setDetailMode}
        onClose={() => {
          setSelected(null);
        }}
        onSelectShot={(s) => setSelected(s)}
        onShiftAlike={onShiftAlike}
        onColorClick={(hex) => {
          setPaletteShots(null);
          setColorHex(hex);
          setSelected(null);
        }}
        onSimilarPalette={(id) => paletteMutation.mutate(id)}
        onFilterClick={(kind, value) => {
          setPaletteShots(null);
          setSelected(null);
          if (kind === "technique") patchDial({ technique: value });
          else if (kind === "shot_type") patchDial({ shotType: value });
          else if (kind === "composition") patchDial({ composition: value });
          else if (kind === "era") patchDial({ era: value });
          else if (kind === "origin") patchDial({ origin: value });
          else if (kind === "ism") patchDial({ ism: value });
          else if (kind === "director") patchDial({ director: value });
          else if (kind === "theme") patchDial({ theme: value });
          else if (kind === "genre") patchDial({ genre: value });
          else if (kind === "shape") patchDial({ shape: value });
          else if (kind === "visual_style") patchDial({ visualStyle: value });
          else if (kind === "emotion") patchDial({ emotion: value });
          else if (kind === "tag") setQuery(value);
        }}
      />
    </div>
  );
}
