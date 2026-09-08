"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Compass, Grid3X3, Orbit, Sparkles } from "lucide-react";
import { GlobalSearchBar } from "@/components/search/GlobalSearchBar";
import { AdvancedFilters } from "@/components/search/AdvancedFilters";
import { FilterDial, type DialFilters } from "@/components/search/FilterDial";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { ViewControls, type ViewMode } from "@/components/grid/ViewControls";
import {
  DiscoveryExploreField,
  type ExploreMode,
} from "@/components/discovery/DiscoveryExploreField";
import { ShotDetailSheet } from "@/components/shots/ShotDetailSheet";
import { ShotSelectionBar } from "@/components/shots/ShotSelectionBar";
import { useSearch, useShots } from "@/hooks/useSearch";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type DiscoverySurface = "grid" | ExploreMode;

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
  cameraAngle: "",
  lensLook: "",
  lightingStyle: "",
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
  const [surface, setSurface] = useState<DiscoverySurface>("grid");
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");

  useEffect(() => {
    try {
      const v = localStorage.getItem("cinekive.preferInspector");
      if (v === "0") {
        setPreferInspector(false);
        setDetailMode("popup");
      }
      const s = localStorage.getItem("cinekive.discoverySurface");
      if (s === "grid" || s === "canvas" || s === "living") setSurface(s);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("cinekive.discoverySurface", surface);
    } catch {
      /* ignore */
    }
  }, [surface]);

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
    !!dial.cameraAngle ||
    !!dial.lensLook ||
    !!dial.lightingStyle ||
    !!colorHex ||
    favoritesOnly ||
    hasPreviewOnly ||
    heroesOnly ||
    movingOnly ||
    randomize;

  const exploreAll = surface === "canvas" || surface === "living";

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
    camera_angle: dial.cameraAngle || undefined,
    lens_look: dial.lensLook || undefined,
    lighting_style: dial.lightingStyle || undefined,
    color_hex: colorHex,
    randomize: randomize || undefined,
    group_sequences: exploreAll ? false : true,
    limit: exploreAll ? 1000 : 200,
    fetchAll: exploreAll,
    enabled: searching && !paletteShots,
  });

  const shotsQuery = useShots({
    isHero: heroesOnly ? true : undefined,
    isMoving: movingOnly ? true : undefined,
    groupSequences: exploreAll ? false : true,
    randomize,
    randomSeed,
    limit: 200,
    fetchAll: exploreAll,
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

  const clearFilters = useCallback(() => {
    setQuery("");
    setDial(emptyDial());
    setColorHex(undefined);
    setPaletteShots(null);
    setFavoritesOnly(false);
    setHasPreviewOnly(false);
    setHeroesOnly(false);
    setMovingOnly(false);
    setRandomize(false);
  }, []);

  const listLoading =
    !paletteShots &&
    ((searching && searchQuery.isLoading) || (!searching && shotsQuery.isLoading));
  const listError =
    !paletteShots &&
    ((searching && searchQuery.isError) || (!searching && shotsQuery.isError));

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

  const onSelectShot = useCallback(
    (shot: Shot, ev?: MouseEvent) => {
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
    },
    [preferInspector]
  );

  const surfaces: {
    id: DiscoverySurface;
    label: string;
    Icon: typeof Grid3X3;
    hint: string;
  }[] = [
    { id: "grid", label: "Grid", Icon: Grid3X3, hint: "Classic masonry" },
    {
      id: "canvas",
      label: "Infinite",
      Icon: Compass,
      hint: "One giant field — fly with arrows",
    },
    {
      id: "living",
      label: "Living",
      Icon: Orbit,
      hint: "Random craft clusters that morph",
    },
  ];

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
          <div className="flex overflow-hidden rounded border border-cinema-border">
            {surfaces.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                onClick={() => setSurface(s.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs",
                  surface === s.id
                    ? "bg-cinema-panel text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                )}
              >
                <s.Icon className="h-3.5 w-3.5" />
                {s.label}
              </button>
            ))}
          </div>
          {surface === "grid" && (
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
          )}
          {(surface === "canvas" || surface === "living") && (
            <button
              type="button"
              title={preferInspector ? "Inspector on" : "Inspector off"}
              onClick={() => {
                const v = !preferInspector;
                setPreferInspector(v);
                try {
                  localStorage.setItem("cinekive.preferInspector", v ? "1" : "0");
                } catch {
                  /* ignore */
                }
                if (selected) setDetailMode(v ? "inspector" : "popup");
              }}
              className={cn(
                "rounded border px-2 py-1.5 text-xs",
                preferInspector
                  ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                  : "border-cinema-border text-cinema-muted"
              )}
            >
              Inspector
            </button>
          )}
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
        {surface === "living" && (
          <p className="inline-flex items-center gap-1.5 text-[11px] text-cinema-muted">
            <Sparkles className="h-3 w-3 text-cinema-cyan" />
            Living mode groups by craft and morphs to a new arrangement on a timer.
          </p>
        )}
      </header>

      <div className={cn("flex min-h-0 flex-1 flex-col", surface === "grid" ? "px-6 py-4" : "px-4 py-3")}>
        <ShotSelectionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
        />
        {(listLoading || searchQuery.isFetching || shotsQuery.isFetching || paletteMutation.isPending) &&
        shots.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-sm text-cinema-muted">
            <span>{t("discovery.loading")}</span>
            {exploreAll && (
              <span className="text-[11px] text-cinema-muted/80">
                Loading all stills into the field…
              </span>
            )}
          </div>
        ) : surface === "grid" ? (
          <VirtualMasonryGrid
            shots={shots}
            selectedIds={selectedIds}
            onSelect={onSelectShot}
            onOpenPopup={(shot) => {
              setDetailMode("popup");
              setSelected(shot);
            }}
            columns={columns}
            viewMode={viewMode}
            fillHeight
            inspectorOpen={Boolean(selected) && detailMode === "inspector"}
            reserveInspectorGutter={Boolean(selected) && preferInspector}
            emptyState={
              listError ? (
                <>
                  <p className="text-sm text-white">Couldn’t load shots</p>
                  <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                    {(searching ? searchQuery.error : shotsQuery.error) instanceof Error
                      ? (searching ? searchQuery.error : shotsQuery.error)?.message
                      : "Check that the engine is running, then refresh."}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void shotsQuery.refetch();
                      void searchQuery.refetch();
                    }}
                    className="mt-3 rounded border border-cinema-cyan/40 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10"
                  >
                    Retry
                  </button>
                </>
              ) : searching ? (
                <>
                  <p className="text-sm text-white">0 results</p>
                  <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                    {heroesOnly
                      ? "No hero-flagged shots match. Try clearing the Heroes filter."
                      : "Filters or search hid every shot."}
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-3 rounded border border-cinema-cyan/40 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10"
                  >
                    Clear filters
                  </button>
                </>
              ) : undefined
            }
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
        ) : (
          <DiscoveryExploreField
            mode={surface}
            shots={shots}
            selectedIds={selectedIds}
            onSelect={onSelectShot}
            inspectorOpen={Boolean(selected) && detailMode === "inspector"}
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
