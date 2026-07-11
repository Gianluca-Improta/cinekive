"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, X } from "lucide-react";
import { DropZone } from "@/components/ingest/DropZone";
import { api } from "@/lib/api-client";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const OPEN_EVENT = "cinekive:open-ingest";

export function openIngestPanel(projectId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_EVENT, { detail: { projectId: projectId || null } })
  );
}

function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/\/projects\/([^/]+)/);
  return m?.[1] || null;
}

function kindLabel(kind: string | null | undefined) {
  const k = (kind || "").toLowerCase();
  if (k === "archive") return "Archive";
  if (k === "commercial") return "Commercial";
  if (k === "social") return "Social";
  if (k === "narrative") return "Narrative";
  return kind || "Project";
}

/** Full-screen ingest workspace (not a skinny side drawer). */
export function IngestPanel() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.listProjects(),
    staleTime: 30_000,
    enabled: open,
  });

  const projects = useMemo(() => {
    const items = projectsQuery.data || [];
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [projectsQuery.data]);

  const target: Project | undefined = projects.find((p) => p.id === targetId);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ projectId?: string | null }>).detail;
      const fromPath = projectIdFromPath(pathname);
      const preferred = detail?.projectId || fromPath || "";
      setTargetId(preferred);
      setStatus(null);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || targetId || !projects.length) return;
    const fromPath = projectIdFromPath(pathname);
    if (fromPath && projects.some((p) => p.id === fromPath)) {
      setTargetId(fromPath);
      return;
    }
    setTargetId(projects[0].id);
  }, [open, targetId, projects, pathname]);

  const ingestMutation = useMutation({
    mutationFn: async ({
      files,
      kind,
    }: {
      files: File[];
      kind: "video" | "image";
    }) => {
      if (!targetId) throw new Error("Pick a project first");
      const proj = projects.find((p) => p.id === targetId);
      const isArchive = (proj?.kind || "").toLowerCase() === "archive";
      if (kind === "image" && isArchive) {
        return api.uploadToArchive(targetId, files);
      }
      if (kind === "video") return api.ingestVideos(targetId, files);
      return api.ingestImages(targetId, files);
    },
    onSuccess: (res) => {
      setError(null);
      setStatus(res.message || "Ingest queued — watch Activity for progress");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      if (targetId) {
        qc.invalidateQueries({ queryKey: ["project", targetId] });
        qc.invalidateQueries({ queryKey: ["shots", targetId] });
      }
    },
    onError: (err: Error) => setError(err.message),
  });

  const importUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      if (!targetId) throw new Error("Pick a project first");
      return api.importLink({ url, project_id: targetId, ingest: true });
    },
    onSuccess: (res) => {
      setError(null);
      setStatus(res.message || "Download queued");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const onFiles = useCallback(
    (files: File[], kind: "video" | "image") => {
      if (!targetId) {
        setError("Select which project this goes to");
        return;
      }
      ingestMutation.mutate({ files, kind });
    },
    [targetId, ingestMutation]
  );

  const busy = ingestMutation.isPending || importUrlMutation.isPending;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--cinema-overlay)] p-4 backdrop-blur-md sm:p-8">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ingest"
        className="flex max-h-[min(920px,94vh)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cinema-border bg-cinema-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-cinema-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cinema-cyan/15 text-cinema-cyan">
              <Upload className="h-4 w-4" />
            </div>
            <div>
              <div className="text-base font-medium text-white">Ingest</div>
              <div className="text-[11px] text-cinema-muted">
                Drop files, folders, or paste any video URL
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-5">
          <label className="block space-y-1.5">
            <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
              Destination
            </span>
            <select
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                setStatus(null);
                setError(null);
              }}
              className="w-full rounded-lg border border-cinema-border bg-cinema-black px-3 py-2.5 text-sm text-white outline-none focus:border-cinema-cyan"
            >
              {!projects.length && <option value="">Loading projects…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {kindLabel(p.kind)} · {p.shot_count} shots
                </option>
              ))}
            </select>
          </label>

          {target && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-cinema-muted">
              <span>
                {(target.kind || "").toLowerCase() === "archive"
                  ? "Archive — stills keep folder paths for titles"
                  : `Sampling: ${target.sampling_mode}`}
              </span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push(`/projects/${target.id}`);
                }}
                className="text-cinema-cyan hover:underline"
              >
                Open project
              </button>
            </div>
          )}

          <DropZone
            compact={false}
            onFiles={onFiles}
            onImportUrl={async (u) => {
              await importUrlMutation.mutateAsync(u);
            }}
            disabled={busy || !targetId}
            className="min-h-[220px]"
          />

          {error && (
            <p className="rounded border border-cinema-magenta/40 bg-cinema-magenta/10 px-3 py-2 text-xs text-cinema-magenta">
              {error}
            </p>
          )}
          {status && !error && (
            <p className="text-sm text-cinema-cyan">{status}</p>
          )}

          <p className="text-[11px] leading-relaxed text-cinema-muted">
            Progress appears in Activity. Re-ingest skips files already in that library.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-cinema-border px-5 py-3">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className={cn(
              "rounded-lg border border-cinema-border px-4 py-2 text-xs text-cinema-muted hover:text-white"
            )}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
