"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Clapperboard,
  Film,
  FolderOpen,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { ProjectSetupModal } from "@/components/projects/ProjectSetupModal";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function isArchive(p: Project): boolean {
  const k = (p.kind || "").toLowerCase();
  if (k === "archive") return true;
  const slug = (p.slug || "").toLowerCase();
  return (
    slug.includes("archive") ||
    ["filmgrab", "eyecandy", "shotdeck", "moviestillsdb", "stillslab"].includes(slug)
  );
}

function kindIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k === "stills" || k === "mixed") return Film;
  return Clapperboard;
}

type Props = {
  open: boolean;
  onClose: () => void;
  /** Pre-select a project when opened via double-click */
  focusId?: string | null;
};

/** Pro-style project window: list, open, edit brief, delete. */
export function ProjectManagerModal({ open, onClose, focusId }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedId(focusId || null);
    setQuery("");
    setEditOpen(false);
  }, [open, focusId]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: open,
  });

  const jobs = useMemo(() => {
    const list = projects.filter((p) => !isArchive(p));
    list.sort((a, b) => {
      const d = (b.shot_count || 0) - (a.shot_count || 0);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.kind || "").toLowerCase().includes(q) ||
        (p.feeling || "").toLowerCase().includes(q)
    );
  }, [projects, query]);

  const activeId = selectedId || focusId || jobs[0]?.id || null;
  const selected = jobs.find((p) => p.id === activeId) || null;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (selectedId === id) setSelectedId(null);
      if (typeof window !== "undefined" && window.location.pathname.includes(id)) {
        router.push("/");
      }
    },
  });

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />
        <div
          className="relative z-10 flex h-[min(80vh,36rem)] w-full max-w-3xl overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl"
          role="dialog"
          aria-label="Project manager"
        >
          <div className="flex w-[min(42%,16rem)] shrink-0 flex-col border-r border-cinema-border">
            <div className="flex items-center justify-between border-b border-cinema-border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-sm font-medium text-white">
                <FolderOpen className="h-3.5 w-3.5 text-cinema-cyan" />
                Projects
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-cinema-muted hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="border-b border-cinema-border px-2 py-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-cinema-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter…"
                  className="w-full rounded border border-cinema-border bg-cinema-black py-1.5 pl-7 pr-2 text-[11px] text-white outline-none focus:border-cinema-cyan"
                />
              </label>
            </div>
            <nav className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {jobs.length === 0 ? (
                <p className="px-2 py-6 text-center text-[11px] text-cinema-muted">
                  No projects yet
                </p>
              ) : (
                jobs.map((p) => {
                  const Icon = kindIcon(p.kind || "commercial");
                  const active = p.id === activeId;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      onDoubleClick={() => {
                        onClose();
                        router.push(`/projects/${p.id}`);
                      }}
                      className={cn(
                        "mb-0.5 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition",
                        active
                          ? "bg-cinema-cyan/15 text-cinema-cyan"
                          : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="text-[10px] opacity-70">
                          {t(p.shot_count === 1 ? "nav.shotCountOne" : "nav.shotCount", {
                            n: p.shot_count,
                          })}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </nav>
            <p className="border-t border-cinema-border px-3 py-2 text-[10px] text-cinema-muted">
              Double-click a row to open · Delete from the detail pane
            </p>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="border-b border-cinema-border px-4 py-3">
                  <h2 className="truncate text-base font-medium text-white">{selected.name}</h2>
                  <p className="mt-0.5 text-[11px] capitalize text-cinema-muted">
                    {(selected.kind || "commercial").replace(/_/g, " ")}
                    {selected.feeling ? ` · ${selected.feeling}` : ""}
                  </p>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto p-4 text-[12px] text-cinema-muted">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-cinema-border/60 bg-cinema-black/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-cinema-muted">
                        Frames
                      </div>
                      <div className="mt-0.5 font-mono text-sm text-white">
                        {selected.shot_count.toLocaleString()}
                      </div>
                    </div>
                    <div className="rounded-lg border border-cinema-border/60 bg-cinema-black/40 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-cinema-muted">
                        Sampling
                      </div>
                      <div className="mt-0.5 text-sm capitalize text-white">
                        {selected.sampling_mode || "heroes"}
                      </div>
                    </div>
                  </div>
                  {selected.brief ? (
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-wide">Brief</div>
                      <p className="whitespace-pre-wrap leading-relaxed text-white/85">
                        {selected.brief}
                      </p>
                    </div>
                  ) : (
                    <p className="text-cinema-muted">No brief yet — edit to add one.</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 border-t border-cinema-border p-3">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      router.push(`/projects/${selected.id}`);
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Open
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-2 text-xs text-cinema-muted hover:text-white"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={deleteMutation.isPending}
                    onClick={() => {
                      if (confirm(t("nav.deleteConfirm", { name: selected.name }))) {
                        deleteMutation.mutate(selected.id);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-cinema-magenta/35 px-3 py-2 text-xs text-cinema-magenta hover:bg-cinema-magenta/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-cinema-muted">
                Select a project
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectSetupModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        project={selected}
      />
    </>
  );
}
