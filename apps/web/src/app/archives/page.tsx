"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Download,
  ExternalLink,
  Film,
  FolderPlus,
  KeyRound,
  Layers,
  Lock,
  Play,
  Plus,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { JobProgressBanner } from "@/components/jobs/JobProgressBanner";
import { DropZone } from "@/components/ingest/DropZone";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { FALLBACK_IDEAS } from "./_fallback_ideas";
import { useI18n } from "@/lib/i18n/I18nProvider";

type SourceKey = "filmgrab" | "eyecandy" | "shotdeck" | "moviestillsdb" | "stillslab";

const SOURCE_ICONS: Record<string, typeof Film> = {
  filmgrab: Film,
  eyecandy: Layers,
  shotdeck: Lock,
  moviestillsdb: Film,
  stillslab: Lock,
};

const SOURCE_ACCENTS: Record<string, string> = {
  filmgrab: "text-cinema-cyan",
  eyecandy: "text-violet-300",
  shotdeck: "text-amber-300",
  moviestillsdb: "text-sky-300",
  stillslab: "text-rose-300",
};

type ShelfTab = "libraries" | "mirrors" | "discover";

export default function ArchivesPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const router = useRouter();
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
  const [shelf, setShelf] = useState<ShelfTab>("libraries");
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

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
        name: name.trim() || "Untitled Archive",
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

  const data = statusQuery.data;
  const runs = data?.mirror_runs || {};
  const creds = data?.credentials || {};
  const builtInSources = data?.sources || [];
  const ideas = data?.suggestions?.length ? data.suggestions : FALLBACK_IDEAS;

  const publicSources = builtInSources.filter((s) => s.access !== "gated");
  const gatedSources = builtInSources.filter((s) => s.access === "gated");
  const allMirrors = [...publicSources, ...gatedSources];

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

  const totalShots = archiveProjects.reduce((n, a) => n + (a.shot_count || 0), 0);

  const projectFor = (slug?: string, nameHint?: string) =>
    projects.find(
      (p) =>
        (slug && p.slug.toLowerCase() === slug.toLowerCase()) ||
        (nameHint && p.name.toLowerCase() === nameHint.toLowerCase())
    );

  const diskLabel = (source: (typeof builtInSources)[0] | undefined) => {
    const archiveSlug = source?.archive_slug || "";
    const archiveName = source?.archive_name || source?.label || "";
    const archive = projectFor(archiveSlug, archiveName);
    if (source?.exists && source.image_count > 0) {
      return `${source.image_count.toLocaleString()} on disk${
        archive ? ` · ${archive.shot_count} indexed` : ""
      }`;
    }
    if (archive && archive.shot_count > 0) {
      return `${archive.shot_count.toLocaleString()} indexed`;
    }
    if (statusQuery.isFetching || statusQuery.isError) return "Checking…";
    return "Not mirrored";
  };

  const openCreate = (prefill?: { name?: string; url?: string; note?: string }) => {
    if (prefill?.name) setName(prefill.name);
    if (prefill?.url) setSiteUrl(prefill.url);
    if (prefill?.note) setNote(prefill.note);
    setCreating(true);
    setShelf("libraries");
  };

  return (
    <div
      className="flex h-full flex-col overflow-y-auto"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--cinema-grid) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <header className="sticky top-0 z-20 border-b border-cinema-border/80 bg-cinema-black/90 px-6 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
              <Archive className="h-3 w-3 text-cinema-cyan" />
              {t("archives.title")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{t("archives.title")}</h1>
            <p className="mt-1 text-sm text-cinema-muted">
              {archiveProjects.length} archive
              {archiveProjects.length === 1 ? "" : "s"}
              {totalShots > 0 ? ` · ${totalShots.toLocaleString()} frames` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => openCreate()}
            className="inline-flex items-center gap-2 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3.5 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            {t("archives.newArchive")}
          </button>
        </div>

        <div className="mt-4 flex gap-1 border-b border-transparent">
          {(
            [
              ["libraries", t("archives.yourArchives")],
              ["mirrors", t("archives.builtIn")],
              ["discover", t("archives.freeLibraries")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setShelf(id)}
              className={cn(
                "rounded-t px-3 py-2 text-xs transition",
                shelf === id
                  ? "border-b-2 border-cinema-cyan text-cinema-cyan"
                  : "text-cinema-muted hover:text-white"
              )}
            >
              {label}
              {id === "libraries" && archiveProjects.length > 0 && (
                <span className="ml-1.5 text-cinema-muted">{archiveProjects.length}</span>
              )}
              {id === "mirrors" && allMirrors.length > 0 && (
                <span className="ml-1.5 text-cinema-muted">{allMirrors.length}</span>
              )}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-6 py-6">
        {error && (
          <p className="rounded border border-cinema-magenta/40 bg-cinema-magenta/10 px-3 py-2 text-xs text-cinema-magenta">
            {error}
          </p>
        )}
        {activeJobId && (
          <JobProgressBanner
            jobId={activeJobId}
            onDone={() => {
              setActiveJobId(null);
              qc.invalidateQueries({ queryKey: ["projects"] });
              qc.invalidateQueries({ queryKey: ["shots"] });
            }}
          />
        )}

        {shelf === "libraries" && (
          <section>
            {archiveProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-cinema-border/70 bg-cinema-surface/30 px-6 py-16 text-center">
                <Archive className="mb-3 h-8 w-8 text-cinema-muted" />
                <p className="text-sm text-white">No archives yet</p>
                <p className="mt-1 max-w-sm text-xs text-cinema-muted">
                  Drop a stills folder, or mirror FilmGrab / EyeCandy from the Mirrors tab.
                </p>
                <button
                  type="button"
                  onClick={() => openCreate()}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs text-cinema-cyan hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create your first archive
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {archiveProjects.map((a) => (
                  <Link
                    key={a.id}
                    href={`/projects/${a.id}`}
                    className="group relative overflow-hidden rounded-xl border border-cinema-border/70 bg-cinema-surface/60 p-5 transition hover:border-cinema-cyan/40 hover:bg-cinema-surface"
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-40"
                      style={{
                        background:
                          "radial-gradient(ellipse at 20% 0%, rgba(94,234,212,0.12), transparent 55%)",
                      }}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-base font-medium text-white group-hover:text-cinema-cyan">
                          {a.name.replace(/\s*Archive\s*$/i, "") || a.name}
                        </h2>
                        <span className="shrink-0 font-mono text-[10px] text-cinema-muted">
                          {a.shot_count.toLocaleString()}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-cinema-muted">{a.slug}</p>
                      <div className="mt-4 flex items-center justify-between text-[11px]">
                        <span className="text-cinema-muted">
                          {a.shot_count === 1 ? "1 frame" : `${a.shot_count} frames`}
                        </span>
                        <span className="text-cinema-cyan opacity-0 transition group-hover:opacity-100">
                          Open →
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}

                <button
                  type="button"
                  onClick={() => openCreate()}
                  className="flex min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-cinema-border/60 bg-transparent p-5 text-cinema-muted transition hover:border-cinema-cyan/40 hover:text-cinema-cyan"
                >
                  <FolderPlus className="h-5 w-5" />
                  <span className="text-xs">New archive</span>
                </button>
              </div>
            )}
          </section>
        )}

        {shelf === "mirrors" && (
          <section className="space-y-4">
            <p className="max-w-2xl text-xs text-cinema-muted">
              Pull stills to disk, then ingest into an archive project. Subscription sources need
              login once — stored locally only.
            </p>
            {allMirrors.length === 0 && statusQuery.isFetching ? (
              <p className="text-xs text-cinema-muted">Loading sources…</p>
            ) : allMirrors.length === 0 ? (
              <p className="text-xs text-cinema-muted">No built-in scrapers available.</p>
            ) : (
              <div className="space-y-2">
                {allMirrors.map((source) => {
                  const key = source.key as SourceKey;
                  const Icon = SOURCE_ICONS[key] || Archive;
                  const accent = SOURCE_ACCENTS[key] || "text-cinema-cyan";
                  const running = Boolean(runs[key]?.running);
                  const archive = projectFor(source.archive_slug, source.archive_name);
                  const canIngest =
                    Boolean(source.image_count) || Boolean(source.exists) || Boolean(archive);
                  const gated = source.access === "gated";
                  const cred = creds[key];
                  const configured = Boolean(source.credentials_configured || cred?.configured);
                  const form = credForms[key] || { user: "", password: "" };
                  const open = expandedSource === key;

                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-cinema-border/70 bg-cinema-surface/50"
                    >
                      <button
                        type="button"
                        onClick={() => setExpandedSource(open ? null : key)}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", accent)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-white">{source.label}</span>
                            {gated && (
                              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-300">
                                gated
                              </span>
                            )}
                            {running && (
                              <span className="rounded bg-cinema-cyan/15 px-1.5 py-0.5 font-mono text-[9px] text-cinema-cyan">
                                mirroring
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-cinema-muted">
                            {diskLabel(source)}
                            {source.description ? ` · ${source.description}` : ""}
                          </p>
                        </div>
                        <span className="text-[11px] text-cinema-muted">{open ? "Hide" : "Manage"}</span>
                      </button>

                      {open && (
                        <div className="space-y-3 border-t border-cinema-border/60 px-4 py-4">
                          {gated && (
                            <div className="rounded-lg border border-cinema-border/50 bg-cinema-black/40 p-3">
                              <div className="mb-2 flex items-center gap-1.5 text-[11px] text-cinema-muted">
                                <KeyRound className="h-3.5 w-3.5" />
                                Subscription login
                                {configured && cred?.user_hint ? (
                                  <span className="text-cinema-cyan">· {cred.user_hint}</span>
                                ) : null}
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <input
                                  type="email"
                                  autoComplete="username"
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
                                  autoComplete="current-password"
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
                              </div>
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
                                className="mt-2 text-[10px] text-cinema-cyan hover:underline disabled:opacity-40"
                              >
                                Save credentials locally
                              </button>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={
                                mirrorMutation.isPending ||
                                running ||
                                (gated && !configured && !form.user && !form.password)
                              }
                              onClick={() =>
                                mirrorMutation.mutate({
                                  source: key,
                                  ...(form.user && form.password
                                    ? { user: form.user, password: form.password }
                                    : {}),
                                })
                              }
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs disabled:opacity-40",
                                accent,
                                "border-current/30 hover:bg-white/5"
                              )}
                            >
                              <Play className="h-3.5 w-3.5" />
                              {running ? "Mirroring…" : "Start mirror"}
                            </button>
                            <button
                              type="button"
                              disabled={ingestMutation.isPending || !canIngest}
                              onClick={() => ingestMutation.mutate(key)}
                              className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan disabled:opacity-40"
                            >
                              <Download className="h-3.5 w-3.5" />
                              Ingest
                            </button>
                            {archive && (
                              <Link
                                href={`/projects/${archive.id}`}
                                className="text-xs text-cinema-cyan hover:underline"
                              >
                                Open archive
                              </Link>
                            )}
                            {source.site_url && (
                              <a
                                href={source.site_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-cinema-muted hover:text-white"
                              >
                                Site <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {shelf === "discover" && (
          <section className="space-y-4">
            <p className="max-w-2xl text-xs text-cinema-muted">
              Free libraries without scrapers yet. Prefill a new archive, then drop what you
              collect. Check terms before automating.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ideas.map((s) => (
                <div
                  key={s.key}
                  className="flex flex-col rounded-xl border border-cinema-border/60 bg-cinema-surface/40 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm text-white">{s.label}</h3>
                    <a
                      href={s.site_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex shrink-0 items-center gap-1 text-[10px] text-cinema-muted hover:text-cinema-cyan"
                    >
                      Visit <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <p className="mt-2 flex-1 text-[11px] leading-relaxed text-cinema-muted">
                    {s.blurb}
                  </p>
                  <p className="mt-1 text-[10px] text-cinema-muted/70">{s.fit}</p>
                  <button
                    type="button"
                    onClick={() =>
                      openCreate({ name: s.label, url: s.site_url, note: s.fit })
                    }
                    className="mt-3 self-start text-[11px] text-cinema-cyan hover:underline"
                  >
                    + New archive from this
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Create drawer — not the whole page */}
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
                <p className="text-[11px] text-cinema-muted">Name it, then drop a stills folder</p>
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
