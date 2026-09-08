"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, ChevronDown, Layers, LayoutTemplate, MessageSquareText, MoreHorizontal, Search, Settings2, Upload, Crown } from "lucide-react";
import { GlobalSearchBar } from "@/components/search/GlobalSearchBar";
import { AdvancedFilters } from "@/components/search/AdvancedFilters";
import { FilterDial, type DialFilters } from "@/components/search/FilterDial";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { ViewControls, type ViewMode } from "@/components/grid/ViewControls";
import { ShotDetailSheet } from "@/components/shots/ShotDetailSheet";
import { ShotSelectionBar } from "@/components/shots/ShotSelectionBar";
import { openIngestPanel } from "@/components/ingest/IngestPanel";
import { ProjectBriefPanel } from "@/components/projects/ProjectBriefPanel";
import { ProjectCanvas } from "@/components/projects/ProjectCanvas";
import { ProjectShareMenu } from "@/components/projects/ProjectShareMenu";
import { ReferenceSeekPanel } from "@/components/projects/ReferenceSeekPanel";
import { JobProgressBanner } from "@/components/jobs/JobProgressBanner";
import { LibraryQualityPanel } from "@/components/settings/LibraryQualityPanel";
import { useSearch, useShots } from "@/hooks/useSearch";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import {
  BUILTIN_SHELVES,
  DEFAULT_VISIBLE_TAB_IDS,
  isCustomShelfKey,
  shelfLabel,
} from "@/lib/project-shelves";

/** all | moodboard | builtin shelf key | c:{collectionId} for custom */
type ProjectTab = string;

function parseSavedTab(raw: string | null): ProjectTab | null {
  if (!raw) return null;
  if (raw === "canvas" || raw === "moodboard") return "moodboard";
  if (raw === "grid" || raw === "all") return "all";
  if (BUILTIN_SHELVES.some((s) => s.key === raw)) return raw;
  if (isCustomShelfKey(raw)) return raw;
  return null;
}

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

function samplingLabel(mode: string): string {
  const m = (mode || "").toLowerCase();
  if (m === "heroes") return "hero sampling";
  if (m === "moments") return "moment sampling";
  if (m === "fast") return "fast sampling";
  if (m === "full") return "full sampling";
  return `${mode} sampling`;
}

function loadVisibleTabs(projectId: string): string[] {
  try {
    const raw = localStorage.getItem(`cinekive.projectTabs.${projectId}`);
    if (!raw) return [...DEFAULT_VISIBLE_TAB_IDS];
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed) || !parsed.length) return [...DEFAULT_VISIBLE_TAB_IDS];
    const next = parsed.filter((id) => typeof id === "string" && id.length > 0);
    if (!next.includes("all")) next.unshift("all");
    if (!next.includes("moodboard")) next.push("moodboard");
    return next;
  } catch {
    return [...DEFAULT_VISIBLE_TAB_IDS];
  }
}

function persistVisibleTabs(projectId: string, tabs: string[]) {
  try {
    localStorage.setItem(`cinekive.projectTabs.${projectId}`, JSON.stringify(tabs));
  } catch {
    /* ignore */
  }
}

export default function ProjectPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const qc = useQueryClient();
  const canMoodboard = useHasFeature("moodboard");

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Shot | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPreviewOnly, setHasPreviewOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [heroesOnly, setHeroesOnly] = useState(false);
  const [movingOnly, setMovingOnly] = useState(false);
  const [dial, setDial] = useState<DialFilters>(emptyDial);
  const [colorHex, setColorHex] = useState<string | undefined>();
  const [paletteShots, setPaletteShots] = useState<Shot[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [randomSeed, setRandomSeed] = useState(0);
  const [randomize, setRandomize] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [columns, setColumns] = useState(4);
  const [tab, setTab] = useState<ProjectTab>("all");
  const [visibleTabs, setVisibleTabs] = useState<string[]>(DEFAULT_VISIBLE_TAB_IDS);
  const [tabEditorOpen, setTabEditorOpen] = useState(false);
  const [customShelfName, setCustomShelfName] = useState("");
  const [seekOpen, setSeekOpen] = useState(false);
  const [focusBoardId, setFocusBoardId] = useState<string | null>(null);
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem("cinekive.preferInspector") === "0") {
        setPreferInspector(false);
        setDetailMode("popup");
      }
      const saved =
        parseSavedTab(localStorage.getItem(`cinekive.projectTab.${projectId}`)) ||
        parseSavedTab(localStorage.getItem(`cinekive.projectSurface.${projectId}`));
      if (saved) setTab(saved);
      setVisibleTabs(loadVisibleTabs(projectId));
    } catch {
      /* ignore */
    }
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("view") === "canvas") {
      setTab("moodboard");
      const board = sp.get("board");
      if (board) setFocusBoardId(board);
    }
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`cinekive.projectTab.${projectId}`, tab);
      // Keep legacy key in sync for older listeners
      localStorage.setItem(
        `cinekive.projectSurface.${projectId}`,
        tab === "moodboard" ? "canvas" : "grid"
      );
    } catch {
      /* ignore */
    }
  }, [projectId, tab]);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) setTab("all");
  }, [visibleTabs, tab]);

  useEffect(() => {
    const onBoard = (e: Event) => {
      const detail = (
        e as CustomEvent<{ projectId?: string | null; collectionId?: string | null }>
      ).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      if (detail?.collectionId) setFocusBoardId(detail.collectionId);
      setTab("moodboard");
    };
    const onGenerate = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string | null }>).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      setTab("moodboard");
    };
    window.addEventListener("cinekive:open-moodboard", onBoard);
    window.addEventListener("cinekive:open-generate", onGenerate);
    return () => {
      window.removeEventListener("cinekive:open-moodboard", onBoard);
      window.removeEventListener("cinekive:open-generate", onGenerate);
    };
  }, [projectId]);

  const patchDial = useCallback((patch: Partial<DialFilters>) => {
    setPaletteShots(null);
    setRandomize(false);
    setDial((d) => ({ ...d, ...patch }));
  }, []);

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });

  const shelvesQuery = useQuery({
    queryKey: ["project-shelves", projectId],
    queryFn: () => api.ensureProjectShelves(projectId),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const shelves = shelvesQuery.data || null;

  const shelfKey: string | null =
    tab !== "all" && tab !== "moodboard" && shelves?.[tab] ? tab : null;

  const activeShelfId = shelfKey ? shelves?.[shelfKey]?.id : undefined;

  const shelfDetailQuery = useQuery({
    queryKey: ["collection", activeShelfId],
    queryFn: () => api.getCollection(activeShelfId!),
    enabled: Boolean(activeShelfId),
  });

  const tabItems = useMemo(() => {
    const items: { id: string; label: string; locked?: boolean }[] = [];
    for (const id of visibleTabs) {
      if (id === "all") items.push({ id, label: "All", locked: true });
      else if (id === "moodboard") items.push({ id, label: t("project.moodboard"), locked: true });
      else if (shelves?.[id]) items.push({ id, label: shelfLabel(shelves[id]) });
      else {
        const builtin = BUILTIN_SHELVES.find((s) => s.key === id);
        if (builtin) items.push({ id, label: builtin.label });
      }
    }
    return items;
  }, [visibleTabs, shelves, t]);

  const shelfQuickKeys = useMemo(
    () => visibleTabs.filter((id) => id !== "all" && id !== "moodboard"),
    [visibleTabs]
  );

  const createShelfMutation = useMutation({
    mutationFn: (name: string) => api.createProjectShelf(projectId, name),
    onSuccess: ({ key }) => {
      void qc.invalidateQueries({ queryKey: ["project-shelves", projectId] });
      const next = visibleTabs.includes(key) ? visibleTabs : [...visibleTabs.filter((x) => x !== "moodboard"), key, "moodboard"];
      setVisibleTabs(next);
      persistVisibleTabs(projectId, next);
      setCustomShelfName("");
      setTab(key);
    },
  });

  const setVisibleTabsPersist = (next: string[]) => {
    let ordered = next.filter(Boolean);
    if (!ordered.includes("all")) ordered = ["all", ...ordered];
    if (!ordered.includes("moodboard")) ordered = [...ordered, "moodboard"];
    // Keep moodboard last
    ordered = [...ordered.filter((x) => x !== "moodboard"), "moodboard"];
    setVisibleTabs(ordered);
    persistVisibleTabs(projectId, ordered);
  };

  useEffect(() => {
    const onJob = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string; jobId?: string }>).detail;
      if (!detail?.jobId) return;
      if (detail.projectId && detail.projectId !== projectId) return;
      setActiveJobId(detail.jobId);
    };
    window.addEventListener("cinekive:ingest-job", onJob);
    return () => window.removeEventListener("cinekive:ingest-job", onJob);
  }, [projectId]);

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

  const searchQuery = useSearch({
    query: query.trim(),
    project_id: projectId,
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
    group_sequences: true,
    enabled: searching && !paletteShots,
  });

  const shotsQuery = useShots({
    projectId,
    isHero: heroesOnly ? true : undefined,
    isMoving: movingOnly ? true : undefined,
    groupSequences: true,
    randomize,
    randomSeed,
    enabled: !searching && !paletteShots,
  });

  const shots = useMemo(() => {
    let list: Shot[] = [];
    if (paletteShots) list = paletteShots;
    else if (searching) list = searchQuery.data?.results.map((r) => r.shot) ?? [];
    else list = shotsQuery.data?.items ?? [];

    if (shelfKey && shelfDetailQuery.data?.shots) {
      const allowed = new Set(shelfDetailQuery.data.shots.map((s) => s.id));
      // On shelf tabs with no search/filters, show shelf membership order
      if (!searching && !paletteShots) return shelfDetailQuery.data.shots;
      return list.filter((s) => allowed.has(s.id));
    }
    return list;
  }, [
    paletteShots,
    searching,
    searchQuery.data,
    shotsQuery.data,
    shelfKey,
    shelfDetailQuery.data,
  ]);

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
  const filtersActive = searching || Boolean(shelfKey);
  const [enrichTier, setEnrichTier] = useState<"auto" | "fast" | "balanced" | "quality">(
    "auto"
  );

  const enrichTiers = useQuery({
    queryKey: ["enrich-tiers"],
    queryFn: () => api.enrichTiers(),
    staleTime: 60_000,
  });

  const enrichMutation = useMutation({
    mutationFn: () =>
      api.enrichProject(projectId, { force: false, tier: enrichTier }),
    onSuccess: (res) => setActiveJobId(res.job.id),
    onError: (err: Error) => setError(err.message),
  });

  const dialogueMutation = useMutation({
    mutationFn: () => api.dialogueProject(projectId, { force: false }),
    onSuccess: (res) => setActiveJobId(res.job.id),
    onError: (err: Error) => setError(err.message),
  });

  const dedupeMutation = useMutation({
    mutationFn: () => api.dedupeProject(projectId),
    onSuccess: (res) => setActiveJobId(res.job.id),
    onError: (err: Error) => setError(err.message),
  });

  const paletteMutation = useMutation({
    mutationFn: (shotId: string) =>
      api.searchPalette({ shot_id: shotId, project_id: projectId, limit: 48 }),
    onSuccess: (data) => {
      setPaletteShots(data.results.map((r) => r.shot));
      setSelected(null);
    },
  });

  const toggleVlm = useMutation({
    mutationFn: (vlm_enrichment: boolean) => api.updateProject(projectId, { vlm_enrichment }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", projectId] }),
  });

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

  const onSelectShot = useCallback((shot: Shot) => {
    setDetailMode(preferInspector ? "inspector" : "popup");
    setSelected(shot);
  }, [preferInspector]);

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

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-2 border-b border-cinema-border px-5 py-2.5">
        {/* Row 1 — identity · search · primary actions */}
        <div className="flex items-center gap-3">
          <div className="min-w-0 shrink-0 max-w-[11rem] sm:max-w-[14rem]">
            <h1 className="truncate text-sm font-semibold tracking-tight text-white">
              {project?.name || "Project"}
            </h1>
            <p className="truncate text-[10px] text-cinema-muted">
              {project
                ? `${project.shot_count.toLocaleString()} · ${samplingLabel(project.sampling_mode)}${
                    project.kind ? ` · ${project.kind}` : ""
                  }`
                : "…"}
            </p>
          </div>

          <div className="min-w-0 flex-1">
            <GlobalSearchBar
              value={query}
              onChange={onChange}
              placeholder={t("search.projectPlaceholder")}
            />
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => openIngestPanel(projectId)}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-2.5 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
              title="Drop files, folders, or paste a URL"
            >
              <Upload className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Add</span>
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
                title="Tools"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {toolsOpen && (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    aria-label="Close"
                    onClick={() => setToolsOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-lg border border-cinema-border bg-cinema-surface shadow-xl">
                    <div className="border-b border-cinema-border px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                      Tools
                    </div>
                    <div className="flex items-center gap-1 border-b border-cinema-border/60 px-2 py-1.5">
                      <select
                        value={enrichTier}
                        onChange={(e) =>
                          setEnrichTier(e.target.value as "auto" | "fast" | "balanced" | "quality")
                        }
                        className="min-w-0 flex-1 rounded border border-cinema-border bg-cinema-black px-1.5 py-1 text-[11px] text-cinema-muted outline-none"
                      >
                        <option value="auto">
                          Auto
                          {enrichTiers.data?.recommended_tier
                            ? ` → ${enrichTiers.data.recommended_tier}`
                            : ""}
                        </option>
                        <option value="fast">Fast</option>
                        <option value="balanced">Balanced</option>
                        <option value="quality">Quality</option>
                      </select>
                      <button
                        type="button"
                        onClick={() => {
                          enrichMutation.mutate();
                          setToolsOpen(false);
                        }}
                        disabled={enrichMutation.isPending}
                        className="inline-flex items-center gap-1 rounded border border-cinema-cyan/40 px-2 py-1 text-[11px] text-cinema-cyan"
                      >
                        <Brain className="h-3 w-3" />
                        {t("project.enrich")}
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        dialogueMutation.mutate();
                        setToolsOpen(false);
                      }}
                      disabled={dialogueMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-white hover:bg-cinema-panel"
                    >
                      <MessageSquareText className="h-3.5 w-3.5 text-cinema-muted" />
                      Dialogue
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        dedupeMutation.mutate();
                        setToolsOpen(false);
                      }}
                      disabled={dedupeMutation.isPending}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-white hover:bg-cinema-panel"
                    >
                      <Layers className="h-3.5 w-3.5 text-cinema-muted" />
                      Dedupe
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleVlm.mutate(!project?.vlm_enrichment)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] text-white hover:bg-cinema-panel"
                    >
                      <span>VLM enrichment</span>
                      <span
                        className={
                          project?.vlm_enrichment ? "text-cinema-cyan" : "text-cinema-muted"
                        }
                      >
                        {project?.vlm_enrichment ? "On" : "Off"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSeekOpen(true);
                        setToolsOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-white hover:bg-cinema-panel"
                    >
                      <Search className="h-3.5 w-3.5 text-cinema-muted" />
                      Seek references
                    </button>
                    {(project?.kind || "").toLowerCase() === "archive" && (
                      <button
                        type="button"
                        onClick={() => {
                          setStorageOpen((v) => !v);
                          setToolsOpen(false);
                        }}
                        className="flex w-full items-center gap-2 border-t border-cinema-border/60 px-3 py-2 text-left text-[12px] text-white hover:bg-cinema-panel"
                      >
                        Storage · resize / upscale
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>

            {project && (
              <div className="hidden items-center gap-1 sm:flex">
                <ProjectBriefPanel project={project} />
                <ProjectShareMenu project={project} shots={shots} />
              </div>
            )}

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
          </div>
        </div>

        {/* Row 2 — shelves · dial · quick filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center gap-1">
            <div className="flex max-w-full flex-wrap overflow-hidden rounded border border-cinema-border">
              {tabItems.map((item) => {
                const isMood = item.id === "moodboard";
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (isMood && !canMoodboard) {
                        window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                        return;
                      }
                      setTab(item.id);
                    }}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] ${
                      active
                        ? "bg-cinema-panel text-cinema-cyan"
                        : "text-cinema-muted hover:text-white"
                    }`}
                    title={
                      isMood
                        ? canMoodboard
                          ? "Freeform board for liked shots"
                          : "Moodboard is a Pro feature"
                        : item.id === "all"
                          ? "All project shots"
                          : `${item.label} shelf`
                    }
                  >
                    {isMood ? (
                      canMoodboard ? (
                        <LayoutTemplate className="h-3 w-3" />
                      ) : (
                        <Crown className="h-3 w-3 text-cinema-cyan" />
                      )
                    ) : null}
                    {item.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setTabEditorOpen((v) => !v)}
              className="rounded border border-cinema-border p-1 text-cinema-muted hover:text-cinema-cyan"
              title="Customize tabs"
            >
              <Settings2 className="h-3 w-3" />
            </button>
            {tabEditorOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default"
                  aria-label="Close"
                  onClick={() => setTabEditorOpen(false)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-cinema-border bg-cinema-surface p-2 shadow-xl">
                  <p className="mb-1.5 px-1 text-[10px] uppercase tracking-wide text-cinema-muted">
                    Visible tabs
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-white hover:bg-cinema-panel">
                    <input type="checkbox" checked disabled className="accent-cinema-cyan" />
                    All
                    <span className="text-[9px] text-cinema-muted">required</span>
                  </label>
                  {BUILTIN_SHELVES.map((item) => {
                    const on = visibleTabs.includes(item.key);
                    return (
                      <label
                        key={item.key}
                        className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-white hover:bg-cinema-panel"
                        title={item.hint}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            const next = on
                              ? visibleTabs.filter((id) => id !== item.key)
                              : [...visibleTabs.filter((x) => x !== "moodboard"), item.key, "moodboard"];
                            setVisibleTabsPersist(next);
                          }}
                          className="accent-cinema-cyan"
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {!item.defaultVisible && (
                          <span className="text-[9px] text-cinema-muted">extra</span>
                        )}
                      </label>
                    );
                  })}
                  {shelves &&
                    Object.entries(shelves)
                      .filter(([key]) => isCustomShelfKey(key))
                      .map(([key, col]) => {
                        const on = visibleTabs.includes(key);
                        return (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-white hover:bg-cinema-panel"
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={() => {
                                const next = on
                                  ? visibleTabs.filter((id) => id !== key)
                                  : [...visibleTabs.filter((x) => x !== "moodboard"), key, "moodboard"];
                                setVisibleTabsPersist(next);
                              }}
                              className="accent-cinema-cyan"
                            />
                            <span className="min-w-0 flex-1 truncate">{shelfLabel(col)}</span>
                            <span className="text-[9px] text-cinema-muted">custom</span>
                          </label>
                        );
                      })}
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] text-white hover:bg-cinema-panel">
                    <input type="checkbox" checked disabled className="accent-cinema-cyan" />
                    Moodboard
                    <span className="text-[9px] text-cinema-muted">required</span>
                  </label>

                  <div className="mt-2 border-t border-cinema-border/60 pt-2">
                    <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-cinema-muted">
                      Add custom shelf
                    </p>
                    <div className="flex gap-1 px-1">
                      <input
                        value={customShelfName}
                        onChange={(e) => setCustomShelfName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && customShelfName.trim()) {
                            createShelfMutation.mutate(customShelfName.trim());
                          }
                        }}
                        placeholder="e.g. Product, Animals…"
                        className="min-w-0 flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1 text-[11px] text-white outline-none focus:border-cinema-cyan"
                      />
                      <button
                        type="button"
                        disabled={!customShelfName.trim() || createShelfMutation.isPending}
                        onClick={() => createShelfMutation.mutate(customShelfName.trim())}
                        className="rounded border border-cinema-cyan/40 px-2 py-1 text-[11px] text-cinema-cyan disabled:opacity-40"
                      >
                        Add
                      </button>
                    </div>
                    <p className="mt-1 px-1 text-[9px] leading-relaxed text-cinema-muted">
                      Custom shelves live in this project. Select shots on All, then + them from the
                      selection bar.
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <FilterDial value={dial} onChange={patchDial} />
          </div>
        </div>

        {tab !== "moodboard" && (
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
            onFavoritesOnly={setFavoritesOnly}
            onHasPreviewOnly={setHasPreviewOnly}
            onHeroesOnly={setHeroesOnly}
            onMovingOnly={setMovingOnly}
            onRandomize={onRandomize}
          />
        )}

        {project && (
          <div className="flex flex-wrap items-center gap-2 sm:hidden">
            <ProjectBriefPanel project={project} />
            <ProjectShareMenu project={project} shots={shots} />
          </div>
        )}

        {storageOpen && (project?.kind || "").toLowerCase() === "archive" && (
          <div className="rounded-xl border border-cinema-border/60 bg-cinema-surface/30 px-3 py-2">
            <LibraryQualityPanel archiveId={projectId} compact />
          </div>
        )}

        {error && (
          <p className="rounded border border-cinema-magenta/40 bg-cinema-magenta/10 px-3 py-2 text-xs text-cinema-magenta">
            {error}
          </p>
        )}
        <JobProgressBanner
          jobId={activeJobId}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["shots", projectId] });
            qc.invalidateQueries({ queryKey: ["project", projectId] });
            qc.invalidateQueries({ queryKey: ["projects"] });
            qc.invalidateQueries({ queryKey: ["search"] });
            window.setTimeout(() => {
              qc.invalidateQueries({ queryKey: ["shots", projectId] });
              qc.invalidateQueries({ queryKey: ["search"] });
            }, 1500);
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        {tab === "moodboard" ? (
          canMoodboard ? (
          <ProjectCanvas
            projectId={projectId}
            shots={shots}
            onSelect={setSelected}
            initialCollectionId={focusBoardId}
            projectKind={project?.kind}
          />
          ) : (
            <div className="flex min-h-[28rem] flex-col items-center justify-center gap-3 rounded-lg border border-cinema-border bg-cinema-panel/30 px-6 text-center">
              <Crown className="h-8 w-8 text-cinema-cyan" />
              <p className="text-sm text-white">Moodboard is Pro</p>
              <p className="max-w-md text-xs text-cinema-muted">
                Freeform canvas with pan, zoom, minimap, stickies, concepts, and lookbook export.
              </p>
              <a
                href={PRO_UPGRADE_URL}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
              >
                Unlock Pro
              </a>
              <button
                type="button"
                onClick={() => setTab("all")}
                className="text-[11px] text-cinema-muted hover:text-white"
              >
                Back to All
              </button>
            </div>
          )
        ) : (
          <>
            {shelfKey && (
              <p className="mb-3 text-[11px] text-cinema-muted">
                {shelves?.[shelfKey] ? shelfLabel(shelves[shelfKey]) : shelfKey} shelf — select shots
                on All, then add them here from the selection bar.
                {shelfDetailQuery.isLoading ? " Loading…" : ""}
              </p>
            )}
            <ShotSelectionBar
              selectedIds={selectedIds}
              currentProjectId={projectId}
              shelves={shelves}
              shelfKeys={shelfQuickKeys}
              activeShelf={shelfKey}
              onClear={() => setSelectedIds(new Set())}
              onShelfChange={() => {
                qc.invalidateQueries({ queryKey: ["collection", activeShelfId] });
                qc.invalidateQueries({ queryKey: ["project-shelves", projectId] });
              }}
            />
            {listLoading && shots.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-sm text-cinema-muted">
                Loading shots…
              </div>
            ) : (
              <VirtualMasonryGrid
                shots={shots}
                selectedIds={selectedIds}
                viewMode={viewMode}
                columns={columns}
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
                  ) : filtersActive ? (
                    <>
                      <p className="text-sm text-white">0 results</p>
                      <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                        {shelfKey
                          ? "Nothing on this shelf matches the current filters."
                          : heroesOnly
                            ? "No hero-flagged shots match. Heroes is a filter, not the same as hero sampling."
                            : "Filters or search hid every shot in this project."}
                      </p>
                      <button
                        type="button"
                        onClick={clearFilters}
                        className="mt-3 rounded border border-cinema-cyan/40 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (project?.shot_count ?? 0) > 0 ? (
                    <>
                      <p className="text-sm text-white">Shots not showing</p>
                      <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                        This archive reports {project?.shot_count} shots but none loaded. Try refresh
                        or clear filters.
                      </p>
                      <div className="mt-3 flex flex-wrap justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void shotsQuery.refetch();
                            void searchQuery.refetch();
                          }}
                          className="rounded border border-cinema-cyan/40 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10"
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="rounded border border-white/[0.12] px-3 py-1.5 text-xs text-cinema-muted hover:text-white"
                        >
                          Clear filters
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-white">No shots yet</p>
                      <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                        Drop video or stills with Add media to fill this archive.
                      </p>
                    </>
                  )
                }
                onDelete={(s) => {
                  if (
                    confirm(
                      "Move this shot to the bin? It will be permanently deleted after 30 days."
                    )
                  ) {
                    api.bulkDeleteShots([s.id]).then(() => {
                      qc.invalidateQueries({ queryKey: ["shots"] });
                      qc.invalidateQueries({ queryKey: ["search"] });
                      qc.invalidateQueries({ queryKey: ["bin"] });
                      setSelected(null);
                    });
                  }
                }}
                onColorClick={(hex) => {
                  setPaletteShots(null);
                  setColorHex(hex);
                }}
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
                  onSelectShot(shot);
                }}
                onOpenPopup={(shot) => {
                  setDetailMode("popup");
                  setSelected(shot);
                }}
              />
            )}
          </>
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
          setColorHex(hex);
          setPaletteShots(null);
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

      <ReferenceSeekPanel
        open={seekOpen}
        onClose={() => setSeekOpen(false)}
        projectSlug={project?.slug}
      />
    </div>
  );
}
