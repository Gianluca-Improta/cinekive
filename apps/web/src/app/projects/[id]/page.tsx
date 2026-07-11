"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Layers, LayoutTemplate, MessageSquareText, Upload } from "lucide-react";
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
import { JobProgressBanner } from "@/components/jobs/JobProgressBanner";
import { useSearch, useShots } from "@/hooks/useSearch";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const qc = useQueryClient();

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Shot | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPreviewOnly, setHasPreviewOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [heroesOnly, setHeroesOnly] = useState(false);
  const [movingOnly, setMovingOnly] = useState(false);
  const [dial, setDial] = useState<DialFilters>({
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
  const [colorHex, setColorHex] = useState<string | undefined>();
  const [paletteShots, setPaletteShots] = useState<Shot[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [randomSeed, setRandomSeed] = useState(0);
  const [randomize, setRandomize] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [columns, setColumns] = useState(4);
  const [surface, setSurface] = useState<"grid" | "canvas">("grid");
  const [focusBoardId, setFocusBoardId] = useState<string | null>(null);
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");

  useEffect(() => {
    try {
      if (localStorage.getItem("cinekive.preferInspector") === "0") {
        setPreferInspector(false);
        setDetailMode("popup");
      }
      const saved = localStorage.getItem(`cinekive.projectSurface.${projectId}`);
      if (saved === "canvas" || saved === "grid") setSurface(saved);
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    try {
      localStorage.setItem(`cinekive.projectSurface.${projectId}`, surface);
    } catch {
      /* ignore */
    }
  }, [projectId, surface]);

  useEffect(() => {
    const onBoard = (e: Event) => {
      const detail = (
        e as CustomEvent<{ projectId?: string | null; collectionId?: string | null }>
      ).detail;
      if (detail?.projectId && detail.projectId !== projectId) return;
      if (detail?.collectionId) setFocusBoardId(detail.collectionId);
      setSurface("canvas");
    };
    window.addEventListener("cinekive:open-moodboard", onBoard);
    return () => window.removeEventListener("cinekive:open-moodboard", onBoard);
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
    if (paletteShots) return paletteShots;
    if (searching) return searchQuery.data?.results.map((r) => r.shot) ?? [];
    return shotsQuery.data?.items ?? [];
  }, [paletteShots, searching, searchQuery.data, shotsQuery.data]);

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
      <header className="space-y-2 border-b border-cinema-border px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[10rem] shrink-0">
            <h1 className="text-base font-semibold tracking-tight text-white">
              {project?.name || "Project"}
            </h1>
            <p className="text-[11px] text-cinema-muted">
              {project
                ? `${project.shot_count} shots · ${project.sampling_mode} · VLM ${
                    project.vlm_enrichment ? "on" : "off"
                  }${project.feeling ? ` · ${project.feeling}` : ""}`
                : "Loading…"}
            </p>
          </div>
          <GlobalSearchBar
            value={query}
            onChange={onChange}
            placeholder="Search film title, technique, mood…"
          />
          <FilterDial value={dial} onChange={patchDial} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded border border-cinema-border">
              <button
                type="button"
                onClick={() => setSurface("grid")}
                className={`px-2.5 py-1.5 text-xs ${
                  surface === "grid"
                    ? "bg-cinema-panel text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                }`}
              >
                Grid
              </button>
              <button
                type="button"
                onClick={() => setSurface("canvas")}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs ${
                  surface === "canvas"
                    ? "bg-cinema-panel text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                }`}
                title="Freeform board for liked shots"
              >
                <LayoutTemplate className="h-3.5 w-3.5" />
                Moodboard
              </button>
            </div>
            <div className="flex overflow-hidden rounded border border-cinema-border">
              <select
                value={enrichTier}
                onChange={(e) =>
                  setEnrichTier(e.target.value as "auto" | "fast" | "balanced" | "quality")
                }
                className="bg-cinema-panel px-2 py-1.5 text-[11px] text-cinema-muted outline-none"
                title={
                  enrichTiers.data?.gpu_hint ||
                  enrichTiers.data?.active_model ||
                  "VLM quality tier"
                }
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
                onClick={() => enrichMutation.mutate()}
                disabled={enrichMutation.isPending}
                className="inline-flex items-center gap-1.5 border-l border-cinema-border px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-panel"
                title={
                  enrichTiers.data
                    ? `${enrichTiers.data.active_model} · continuous ${
                        enrichTiers.data.continuous?.enabled ? "on" : "off"
                      }`
                    : "Run VLM enrichment (requires Ollama)"
                }
              >
                <Brain className="h-3.5 w-3.5" />
                Enrich
              </button>
            </div>
            <button
              type="button"
              onClick={() => dialogueMutation.mutate()}
              disabled={dialogueMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
              title="Map spoken dialogue onto shots (requires Whisper)"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
              Dialogue
            </button>
            <button
              type="button"
              onClick={() => dedupeMutation.mutate()}
              disabled={dedupeMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
              title="Collapse near-duplicates and group sequences"
            >
              <Layers className="h-3.5 w-3.5" />
              Dedupe
            </button>
            <button
              type="button"
              onClick={() => toggleVlm.mutate(!project?.vlm_enrichment)}
              className="rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-white"
            >
              VLM {project?.vlm_enrichment ? "On" : "Off"}
            </button>
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

        {project && <ProjectBriefPanel project={project} />}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openIngestPanel(projectId)}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2.5 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
            title="Open ingest panel — pick destination, drop files or URL"
          >
            <Upload className="h-3.5 w-3.5" />
            Add media
          </button>
          {(project?.kind || "").toLowerCase() === "archive" && (
            <span className="text-[11px] text-cinema-muted">
              Stills keep folder paths · re-ingest skips duplicates
            </span>
          )}
        </div>
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
          }}
        />
      </header>

      <div className="flex-1 px-6 py-4">
        {surface === "canvas" ? (
          <ProjectCanvas
            projectId={projectId}
            shots={shots}
            onSelect={setSelected}
            initialCollectionId={focusBoardId}
          />
        ) : (
          <>
            <ShotSelectionBar
              selectedIds={selectedIds}
              currentProjectId={projectId}
              onClear={() => setSelectedIds(new Set())}
            />
            <VirtualMasonryGrid
              shots={shots}
              selectedIds={selectedIds}
              viewMode={viewMode}
              columns={columns}
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
    </div>
  );
}
