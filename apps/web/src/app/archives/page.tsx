"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Crown,
  Download,
  ExternalLink,
  FolderPlus,
  KeyRound,
  LayoutGrid,
  List,
  Play,
  Plus,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { ArchiveLibraryCard } from "@/components/archives/ArchiveLibraryCard";
import { ArchiveHubCard } from "@/components/archives/ArchiveHubCard";
import { DropZone } from "@/components/ingest/DropZone";
import { JobProgressBanner } from "@/components/jobs/JobProgressBanner";
import { ProGateBanner } from "@/components/pro/ProGateBanner";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import { api, getApiUrl } from "@/lib/api-client";
import { resolveArchivePreviewUrls } from "@/lib/archive-preview-fallbacks";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FALLBACK_IDEAS } from "./_fallback_ideas";

type SourceKey = "filmgrab" | "eyecandy" | "shotdeck" | "moviestillsdb" | "stillslab";
type FilterKind = "all" | "yours" | "mirrors" | "curated";
type SortKind = "updated" | "name" | "frames";
type HubView = "cards" | "details";
type Idea = (typeof FALLBACK_IDEAS)[number];
type MirrorSource = {
  key: string;
  label: string;
  description?: string;
  site_url?: string;
  access?: string;
  archive_slug?: string;
  archive_name?: string;
  exists?: boolean;
  image_count?: number;
  credentials_configured?: boolean;
  requires_pro?: boolean;
  preview_urls?: string[];
};

type Tile =
  | { kind: "archive"; id: string; project: Project }
  | { kind: "mirror"; id: string; source: MirrorSource }
  | { kind: "curated"; id: string; idea: Idea };

const SOURCE_ACCENTS: Record<string, string> = {
  filmgrab: "border-cinema-cyan/40 bg-cinema-cyan/10",
  eyecandy: "border-violet-400/40 bg-violet-500/10",
  shotdeck: "border-amber-400/40 bg-amber-500/10",
  moviestillsdb: "border-sky-400/40 bg-sky-500/10",
  stillslab: "border-rose-400/40 bg-rose-500/10",
};

export default function ArchivesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
  const canMirror = useHasFeature("archive_mirrors");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const archiveProjects = useMemo(
    () =>
      projects.filter((p) => {
        const k = (p.kind || "").toLowerCase();
        const slug = (p.slug || "").toLowerCase();
        return (
          k === "archive" ||
          slug.includes("archive") ||
          ["filmgrab", "eyecandy", "shotdeck", "moviestillsdb", "stillslab"].includes(slug)
        );
      }),
    [projects]
  );

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [note, setNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [credForms, setCredForms] = useState<Record<string, { user: string; password: string }>>(
    {}
  );
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [sort, setSort] = useState<SortKind>("updated");
  const [hubView, setHubView] = useState<HubView>("cards");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [limitFilms, setLimitFilms] = useState("12");
  const [limitShots, setLimitShots] = useState("40");
  const [filmsFilter, setFilmsFilter] = useState("");

  const statusQuery = useQuery({
    queryKey: ["sources-status"],
    queryFn: () => api.sourcesStatus(),
    refetchInterval: (q) => {
      const runs = q.state.data?.mirror_runs || {};
      const anyRunning = Object.values(runs).some((r) => r?.running);
      return anyRunning ? 4000 : 20000;
    },
    retry: 1,
  });

  const saveCredsMutation = useMutation({
    mutationFn: (body: { source: string; user: string; password: string }) =>
      api.saveSourceCredentials(body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["sources-status"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const mirrorMutation = useMutation({
    mutationFn: (body: Parameters<typeof api.runSourceMirror>[0]) => api.runSourceMirror(body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["sources-status"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const ingestMutation = useMutation({
    mutationFn: (source: SourceKey) => api.ingestArchiveSource(source),
    onSuccess: (res) => {
      setError(null);
      setActiveJobId(res.job.id);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["sources-status"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const createAndUpload = useMutation({
    mutationFn: async (files?: File[]) => {
      const project = await api.createCustomArchive({
        name: name.trim() || (files?.length ? "Dropped stills" : "Untitled Archive"),
        site_url: siteUrl.trim() || undefined,
        source_note: note.trim() || undefined,
        description: note.trim() || "Custom still archive",
      });
      if (files?.length) {
        const res = await api.uploadToArchive(project.id, files);
        return { project, jobId: res.job.id };
      }
      return { project, jobId: null as string | null };
    },
    onSuccess: ({ project, jobId }) => {
      setName("");
      setSiteUrl("");
      setNote("");
      setPendingFiles(null);
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["sources-status"] });
      if (jobId) setActiveJobId(jobId);
      router.push(`/projects/${project.id}`);
    },
    onError: (err: Error) => setError(err.message),
  });

  const uploadToExisting = useMutation({
    mutationFn: async ({ projectId, files }: { projectId: string; files: File[] }) => {
      setUploadingId(projectId);
      return api.uploadToArchive(projectId, files);
    },
    onSuccess: (res, vars) => {
      setError(null);
      setActiveJobId(res.job.id);
      setUploadingId(null);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["archive-previews", vars.projectId] });
      qc.invalidateQueries({ queryKey: ["shots"] });
    },
    onError: (err: Error) => {
      setUploadingId(null);
      setError(err.message);
    },
  });

  const data = statusQuery.data;
  const runs = data?.mirror_runs || {};
  const creds = data?.credentials || {};
  const ideas: Idea[] = (data?.suggestions?.length ? data.suggestions : FALLBACK_IDEAS) as Idea[];
  const builtInSources = (data?.sources || []) as MirrorSource[];

  const projectFor = (slug?: string, nameHint?: string) =>
    archiveProjects.find(
      (p) =>
        (slug && p.slug.toLowerCase() === slug.toLowerCase()) ||
        (nameHint && p.name.toLowerCase() === nameHint.toLowerCase())
    );

  const mirroredSlugs = new Set(
    builtInSources.map((s) => (s.archive_slug || "").toLowerCase()).filter(Boolean)
  );

  const tiles: Tile[] = useMemo(() => {
    const out: Tile[] = [];
    for (const p of archiveProjects) {
      out.push({ kind: "archive", id: `a:${p.id}`, project: p });
    }
    // Always list every built-in mirror as a card (even if already ingested),
    // so Pro locks stay visible — skip only when the linked archive already
    // represents that mirror in the grid.
    for (const s of builtInSources) {
      const linked = projectFor(s.archive_slug, s.archive_name);
      if (linked) continue;
      out.push({ kind: "mirror", id: `m:${s.key}`, source: s });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveProjects, builtInSources]);

  const curatedTiles: Tile[] = useMemo(
    () => ideas.map((idea) => ({ kind: "curated" as const, id: `c:${idea.key}`, idea })),
    [ideas]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list =
      filter === "curated"
        ? curatedTiles
        : tiles.filter((tile) => {
            if (filter === "yours") return tile.kind === "archive";
            if (filter === "mirrors") {
              return (
                tile.kind === "mirror" ||
                (tile.kind === "archive" && mirroredSlugs.has(tile.project.slug.toLowerCase()))
              );
            }
            // "all" = yours + mirrors only (curated is a separate shelf)
            return tile.kind === "archive" || tile.kind === "mirror";
          });
    if (q) {
      list = list.filter((tile) => {
        const hay =
          tile.kind === "archive"
            ? `${tile.project.name} ${tile.project.description || ""}`
            : tile.kind === "mirror"
              ? `${tile.source.label} ${tile.source.description || ""}`
              : `${tile.idea.label} ${tile.idea.blurb} ${tile.idea.fit}`;
        return hay.toLowerCase().includes(q);
      });
    }
    list = [...list].sort((a, b) => {
      if (sort === "name") {
        const an =
          a.kind === "archive" ? a.project.name : a.kind === "mirror" ? a.source.label : a.idea.label;
        const bn =
          b.kind === "archive" ? b.project.name : b.kind === "mirror" ? b.source.label : b.idea.label;
        return an.localeCompare(bn);
      }
      if (sort === "frames") {
        const af =
          a.kind === "archive"
            ? a.project.shot_count
            : a.kind === "mirror"
              ? a.source.image_count || 0
              : 0;
        const bf =
          b.kind === "archive"
            ? b.project.shot_count
            : b.kind === "mirror"
              ? b.source.image_count || 0
              : 0;
        return bf - af;
      }
      const at =
        a.kind === "archive" ? new Date(a.project.updated_at).getTime() : a.kind === "mirror" ? 1 : 0;
      const bt =
        b.kind === "archive" ? new Date(b.project.updated_at).getTime() : b.kind === "mirror" ? 1 : 0;
      return bt - at;
    });
    return list;
  }, [tiles, curatedTiles, filter, query, sort, mirroredSlugs]);

  const selected =
    filtered.find((t) => t.id === selectedId) ||
    tiles.find((t) => t.id === selectedId) ||
    curatedTiles.find((t) => t.id === selectedId);

  const totalShots = archiveProjects.reduce((n, a) => n + (a.shot_count || 0), 0);

  const mirrorPreview = (source: MirrorSource) => {
    const live = (source.preview_urls || []).map((u) =>
      u.startsWith("http") ? u : `${getApiUrl()}${u}`
    );
    return resolveArchivePreviewUrls(source.key, live);
  };

  const openCreate = (prefill?: { name?: string; url?: string; note?: string }) => {
    if (prefill?.name) setName(prefill.name);
    if (prefill?.url) setSiteUrl(prefill.url);
    if (prefill?.note) setNote(prefill.note);
    setCreating(true);
  };

  const dropCreate = (files: File[]) => {
    setName("");
    setSiteUrl("");
    setNote("");
    setPendingFiles(files);
    createAndUpload.mutate(files);
  };

  const filters: { id: FilterKind; label: string }[] = [
    { id: "all", label: "All" },
    { id: "yours", label: t("archives.yourArchives") },
    { id: "mirrors", label: t("archives.builtIn") },
    ...(ideas.length ? [{ id: "curated" as const, label: t("archives.freeLibraries") }] : []),
  ];

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      data-tour="archives-hub"
      style={{
        backgroundImage: "radial-gradient(circle, var(--cinema-grid) 1px, transparent 1px)",
        backgroundSize: "28px 28px",
      }}
    >
      <header className="shrink-0 border-b border-cinema-border/80 bg-cinema-black/90 px-5 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="mb-0.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
              <Archive className="h-3 w-3 text-cinema-cyan" />
              {t("archives.manage")}
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">{t("archives.title")}</h1>
            <p className="mt-0.5 text-[12px] text-cinema-muted">
              {archiveProjects.length} yours · {builtInSources.length} mirrors
              {totalShots > 0 ? ` · ${totalShots.toLocaleString()} frames indexed` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-2 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("archives.newArchive")}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                filter === f.id
                  ? "border-cinema-cyan/50 bg-cinema-cyan/15 text-cinema-cyan"
                  : "border-cinema-border/60 text-cinema-muted hover:border-cinema-cyan/30 hover:text-white"
              )}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-cinema-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter libraries…"
                className="w-40 rounded border border-cinema-border bg-cinema-black/60 py-1 pl-7 pr-2 text-[11px] text-white outline-none focus:border-cinema-cyan sm:w-52"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKind)}
              className="rounded border border-cinema-border bg-cinema-black/60 px-2 py-1 text-[11px] text-cinema-muted outline-none"
            >
              <option value="updated">Updated</option>
              <option value="name">Name</option>
              <option value="frames">Frames</option>
            </select>
            <div className="flex overflow-hidden rounded border border-cinema-border">
              <button
                type="button"
                title="Card view"
                onClick={() => setHubView("cards")}
                className={cn(
                  "px-2 py-1",
                  hubView === "cards"
                    ? "bg-cinema-panel text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Details view"
                onClick={() => setHubView("details")}
                className={cn(
                  "px-2 py-1",
                  hubView === "details"
                    ? "bg-cinema-panel text-cinema-cyan"
                    : "text-cinema-muted hover:text-white"
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {error && (
            <p className="mb-3 rounded border border-cinema-magenta/40 bg-cinema-magenta/10 px-3 py-2 text-xs text-cinema-magenta">
              {error}
            </p>
          )}
          {activeJobId && (
            <div className="mb-3">
              <JobProgressBanner
                jobId={activeJobId}
                onDone={() => {
                  setActiveJobId(null);
                  qc.invalidateQueries({ queryKey: ["projects"] });
                  qc.invalidateQueries({ queryKey: ["shots"] });
                }}
              />
            </div>
          )}

          <div
            className={cn(
              "mb-4 flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-5 text-center transition",
              createAndUpload.isPending
                ? "border-cinema-cyan/50 bg-cinema-cyan/5"
                : "border-cinema-border/60 bg-cinema-surface/20 hover:border-cinema-cyan/35"
            )}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const files = [...(e.dataTransfer.files || [])];
              if (files.length) dropCreate(files);
            }}
          >
            <Upload className="h-4 w-4 text-cinema-cyan/80" />
            <p className="text-[13px] text-white">
              {createAndUpload.isPending
                ? "Creating archive…"
                : "Drop a stills folder anywhere — or click a library to pull / ingest"}
            </p>
            <button
              type="button"
              onClick={() => openCreate()}
              className="inline-flex items-center gap-1 text-[11px] text-cinema-cyan hover:underline"
            >
              <Plus className="h-3 w-3" /> Name an empty archive
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-xl border border-cinema-border/50 bg-cinema-surface/20 px-6 py-12 text-center">
              <Archive className="mx-auto mb-3 h-7 w-7 text-cinema-muted" />
              <p className="text-sm text-white">Nothing in this filter</p>
              <p className="mt-1 text-xs text-cinema-muted">Clear search or switch type.</p>
            </div>
          ) : (
            <div
              className={cn(
                "grid gap-3",
                hubView === "details"
                  ? "grid-cols-1"
                  : "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              )}
            >
              {filtered.map((tile) => {
                if (tile.kind === "archive") {
                  return (
                    <ArchiveLibraryCard
                      key={tile.id}
                      project={tile.project}
                      selected={selectedId === tile.id}
                      layout={hubView === "details" ? "row" : "card"}
                      onSelect={() => setSelectedId(tile.id)}
                      dropActive={uploadingId === tile.project.id}
                      onDropFiles={(files) =>
                        uploadToExisting.mutate({ projectId: tile.project.id, files })
                      }
                    />
                  );
                }
                if (tile.kind === "mirror") {
                  const key = tile.source.key as SourceKey;
                  const gated =
                    tile.source.access === "gated" || Boolean(tile.source.requires_pro);
                  const locked = gated && !canMirror;
                  const running = Boolean(runs[key]?.running);
                  const preview = mirrorPreview(tile.source);
                  return (
                    <ArchiveHubCard
                      key={tile.id}
                      title={tile.source.label}
                      subtitle={
                        locked
                          ? "Subscription scraper — unlock with Pro"
                          : tile.source.image_count
                            ? `${tile.source.image_count.toLocaleString()} on disk · click to ingest`
                            : tile.source.description || "Click to pull / ingest"
                      }
                      badge={gated ? "mirror" : "free"}
                      previewUrls={preview.urls}
                      bundledUrls={preview.bundled}
                      illustrative={preview.illustrative}
                      locked={locked}
                      selected={selectedId === tile.id}
                      layout={hubView === "details" ? "row" : "card"}
                      accentClass={SOURCE_ACCENTS[key]}
                      onClick={() => {
                        if (locked) {
                          window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                          return;
                        }
                        setSelectedId(tile.id);
                      }}
                      footer={
                        running ? (
                          <span className="font-mono text-[10px] text-cinema-cyan">mirroring…</span>
                        ) : null
                      }
                    />
                  );
                }
                const live =
                  (tile.idea as { preview_urls?: string[] }).preview_urls ||
                  FALLBACK_IDEAS.find((x) => x.key === tile.idea.key)?.preview_urls ||
                  [];
                const preview = resolveArchivePreviewUrls(tile.idea.key, live);
                return (
                  <ArchiveHubCard
                    key={tile.id}
                    title={tile.idea.label}
                    subtitle={tile.idea.blurb}
                    badge={(tile.idea as { kind?: string }).kind || "source"}
                    previewUrls={preview.urls}
                    bundledUrls={preview.bundled}
                    illustrative={preview.illustrative}
                    selected={selectedId === tile.id}
                    layout={hubView === "details" ? "row" : "card"}
                    onClick={() => setSelectedId(tile.id)}
                  />
                );
              })}
            </div>
          )}

          {filter === "all" && curatedTiles.length > 0 && !query.trim() && (
            <section className="mt-8 space-y-3 border-t border-cinema-border/50 pt-6">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <h2 className="text-sm font-medium text-white">Seed from</h2>
                  <p className="text-[11px] text-cinema-muted">
                    Four useful sources — visit, then drop stills into your own archive. Not scrapers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFilter("curated")}
                  className="text-[11px] text-cinema-cyan hover:underline"
                >
                  View all
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {curatedTiles.map((tile) => {
                  if (tile.kind !== "curated") return null;
                  const live =
                    (tile.idea as { preview_urls?: string[] }).preview_urls ||
                    FALLBACK_IDEAS.find((x) => x.key === tile.idea.key)?.preview_urls ||
                    [];
                  const preview = resolveArchivePreviewUrls(tile.idea.key, live);
                  return (
                    <ArchiveHubCard
                      key={tile.id}
                      title={tile.idea.label}
                      subtitle={tile.idea.blurb}
                      badge={(tile.idea as { kind?: string }).kind || "source"}
                      previewUrls={preview.urls}
                      bundledUrls={preview.bundled}
                      illustrative={preview.illustrative}
                      selected={selectedId === tile.id}
                      onClick={() => setSelectedId(tile.id)}
                    />
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {selected && (
          <aside className="fixed inset-x-0 bottom-0 z-30 max-h-[55vh] overflow-y-auto border-t border-cinema-border/80 bg-cinema-surface p-4 shadow-2xl lg:static lg:z-auto lg:max-h-none lg:w-[22rem] lg:shrink-0 lg:border-l lg:border-t-0 lg:bg-cinema-surface/40 lg:shadow-none">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="text-sm font-medium text-white">
                {selected.kind === "archive"
                  ? selected.project.name
                  : selected.kind === "mirror"
                    ? selected.source.label
                    : selected.idea.label}
              </h2>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded p-1 text-cinema-muted hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {selected.kind === "archive" && (
              <div className="space-y-3">
                <p className="text-[11px] text-cinema-muted">
                  {selected.project.shot_count.toLocaleString()} frames · drop stills on the card or
                  open the library.
                </p>
                <Link
                  href={`/projects/${selected.project.id}`}
                  className="inline-flex rounded-full border border-cinema-cyan/40 bg-cinema-cyan/10 px-3.5 py-1.5 text-[11px] text-cinema-cyan"
                >
                  Open archive
                </Link>
              </div>
            )}

            {selected.kind === "mirror" &&
              (() => {
                const source = selected.source;
                const key = source.key as SourceKey;
                const running = Boolean(runs[key]?.running);
                const archive = projectFor(source.archive_slug, source.archive_name);
                const canIngest =
                  Boolean(source.image_count) || Boolean(source.exists) || Boolean(archive);
                const gated = source.access === "gated";
                const locked = gated && !canMirror;
                const cred = creds[key];
                const configured = Boolean(source.credentials_configured || cred?.configured);
                const form = credForms[key] || { user: "", password: "" };
                const filmsN = Number(limitFilms) || undefined;
                const shotsN = Number(limitShots) || undefined;

                return (
                  <div className="space-y-3">
                    <p className="text-[11px] leading-relaxed text-cinema-muted">
                      {source.description}
                    </p>
                    {locked && (
                      <ProGateBanner
                        feature="archive_mirrors"
                        title={`${source.label} is Pro`}
                        detail="Subscription scrapers need Pro. Free mirrors stay available."
                        compact
                      />
                    )}
                    {gated && !locked && (
                      <div className="rounded-xl border border-cinema-border/50 bg-cinema-black/40 p-3">
                        <div className="mb-2 flex items-center gap-1.5 text-[11px] text-cinema-muted">
                          <KeyRound className="h-3.5 w-3.5" />
                          Login
                          {configured && cred?.user_hint ? (
                            <span className="text-cinema-cyan">· {cred.user_hint}</span>
                          ) : null}
                        </div>
                        <div className="grid gap-2">
                          <input
                            type="email"
                            placeholder="Account email"
                            value={form.user}
                            onChange={(e) =>
                              setCredForms((prev) => ({
                                ...prev,
                                [key]: { ...form, user: e.target.value },
                              }))
                            }
                            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
                          />
                          <input
                            type="password"
                            placeholder="Password"
                            value={form.password}
                            onChange={(e) =>
                              setCredForms((prev) => ({
                                ...prev,
                                [key]: { ...form, password: e.target.value },
                              }))
                            }
                            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
                          />
                          <button
                            type="button"
                            disabled={
                              saveCredsMutation.isPending || !form.user || !form.password
                            }
                            onClick={() =>
                              saveCredsMutation.mutate({
                                source: key,
                                user: form.user,
                                password: form.password,
                              })
                            }
                            className="text-left text-[10px] text-cinema-cyan hover:underline disabled:opacity-40"
                          >
                            Save credentials locally
                          </button>
                          {(key === "shotdeck" || key === "stillslab") && (
                            <button
                              type="button"
                              disabled={mirrorMutation.isPending || locked}
                              onClick={() =>
                                mirrorMutation.mutate({
                                  source: key,
                                  user: form.user || undefined,
                                  password: form.password || undefined,
                                  login_browser: true,
                                })
                              }
                              className="text-left text-[10px] text-amber-300/90 hover:underline disabled:opacity-40"
                              title="Opens a browser window so you can pass Cloudflare / SSO, then run Mirror"
                            >
                              Browser login (Cloudflare / SSO)
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 rounded-xl border border-cinema-border/50 bg-cinema-black/30 p-3">
                      <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                        Pull selectors
                      </div>
                      <label className="flex items-center justify-between gap-2 text-[11px] text-cinema-muted">
                        Max titles / films
                        <input
                          value={limitFilms}
                          onChange={(e) => setLimitFilms(e.target.value)}
                          className="w-20 rounded border border-cinema-border bg-cinema-black px-2 py-1 font-mono text-xs text-white outline-none"
                        />
                      </label>
                      <label className="flex items-center justify-between gap-2 text-[11px] text-cinema-muted">
                        Max stills / images
                        <input
                          value={limitShots}
                          onChange={(e) => setLimitShots(e.target.value)}
                          className="w-20 rounded border border-cinema-border bg-cinema-black px-2 py-1 font-mono text-xs text-white outline-none"
                        />
                      </label>
                      {key === "filmgrab" && (
                        <label className="block space-y-1 text-[11px] text-cinema-muted">
                          Specific films (slugs, comma-separated)
                          <input
                            value={filmsFilter}
                            onChange={(e) => setFilmsFilter(e.target.value)}
                            placeholder="blade-runner, heat"
                            className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
                          />
                        </label>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={
                          locked ||
                          mirrorMutation.isPending ||
                          running ||
                          (gated && !configured && !form.user && !form.password)
                        }
                        onClick={() => {
                          if (locked) {
                            window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
                            return;
                          }
                          mirrorMutation.mutate({
                            source: key,
                            limit_films: filmsN,
                            limit_shots: shotsN,
                            films: filmsFilter.trim() || undefined,
                            ...(form.user && form.password
                              ? { user: form.user, password: form.password }
                              : {}),
                          });
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cinema-cyan/40 bg-cinema-cyan/10 px-3.5 py-1.5 text-[11px] text-cinema-cyan disabled:opacity-40"
                      >
                        {locked ? (
                          <Crown className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                        {running ? "Mirroring…" : locked ? "Unlock Pro" : "Start pull"}
                      </button>
                      <button
                        type="button"
                        disabled={ingestMutation.isPending || !canIngest}
                        onClick={() => ingestMutation.mutate(key)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-cinema-border px-3.5 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Ingest
                      </button>
                      {archive && (
                        <Link
                          href={`/projects/${archive.id}`}
                          className="rounded-full px-3 py-1.5 text-[11px] text-cinema-cyan hover:underline"
                        >
                          Open
                        </Link>
                      )}
                      {source.site_url && (
                        <a
                          href={source.site_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] text-cinema-muted hover:text-white"
                        >
                          Site <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })()}

            {selected.kind === "curated" && (
              <div className="space-y-3">
                <p className="text-[12px] leading-relaxed text-cinema-muted">{selected.idea.blurb}</p>
                <p className="text-[10px] text-cinema-muted/70">{selected.idea.fit}</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={selected.idea.site_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-cinema-border px-3.5 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
                  >
                    Visit <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      openCreate({
                        name: selected.idea.label,
                        url: selected.idea.site_url,
                        note: selected.idea.fit,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-cinema-cyan/40 bg-cinema-cyan/10 px-3.5 py-1.5 text-[11px] text-cinema-cyan"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    Seed archive
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {creating && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setCreating(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-cinema-border bg-cinema-surface shadow-2xl">
            <div className="flex items-center justify-between border-b border-cinema-border px-4 py-3">
              <div>
                <div className="text-sm font-medium text-white">New archive</div>
                <p className="text-[11px] text-cinema-muted">Optional name — or just drop stills</p>
              </div>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4">
              <div className="space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Archive name"
                  autoFocus
                  className="w-full rounded border border-cinema-border bg-cinema-black px-3 py-2 text-sm text-white outline-none focus:border-cinema-cyan"
                />
                <input
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  placeholder="Optional site URL"
                  className="w-full rounded border border-cinema-border bg-cinema-black px-3 py-2 text-xs text-white outline-none focus:border-cinema-cyan"
                />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note"
                  className="w-full rounded border border-cinema-border bg-cinema-black px-3 py-2 text-xs text-white outline-none focus:border-cinema-cyan"
                />
              </div>
              <DropZone
                compact
                onFiles={(files, kind) => {
                  if (kind !== "image") {
                    setError("Drop stills / GIFs / image folders (not video) into archives.");
                    return;
                  }
                  setPendingFiles(files);
                  setError(null);
                }}
                disabled={createAndUpload.isPending}
              />
              {pendingFiles && (
                <p className="text-[11px] text-cinema-cyan">
                  {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} ready
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-cinema-border p-4">
              <button
                type="button"
                disabled={createAndUpload.isPending || (!name.trim() && !pendingFiles?.length)}
                onClick={() => createAndUpload.mutate(pendingFiles || undefined)}
                className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-4 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-40"
              >
                {createAndUpload.isPending
                  ? "Creating…"
                  : pendingFiles?.length
                    ? "Create & ingest"
                    : "Create empty"}
              </button>
              {pendingFiles && (
                <button
                  type="button"
                  onClick={() => setPendingFiles(null)}
                  className="rounded px-3 py-2 text-xs text-cinema-muted hover:text-white"
                >
                  Clear drop
                </button>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
