"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Crown, FolderOpen, Save, Settings2, X } from "lucide-react";
import { ProGateBanner } from "@/components/pro/ProGateBanner";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import { api } from "@/lib/api-client";
import type { Project } from "@/lib/types";

type CreateKind =
  | "commercial"
  | "social"
  | "narrative"
  | "stills"
  | "video"
  | "mixed";

const KIND_OPTIONS: { value: CreateKind; label: string }[] = [
  { value: "commercial", label: "Commercial" },
  { value: "narrative", label: "Narrative" },
  { value: "social", label: "Social" },
  { value: "stills", label: "Stills" },
  { value: "video", label: "Video" },
  { value: "mixed", label: "Mixed media" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  /** Edit existing project brief; omit for create */
  project?: Project | null;
};

function defaultName(kind: CreateKind): string {
  switch (kind) {
    case "social":
      return "Untitled Social";
    case "narrative":
      return "Untitled Narrative";
    case "stills":
      return "Untitled Stills";
    case "video":
      return "Untitled Video";
    case "mixed":
      return "Untitled Mixed";
    default:
      return "Untitled Commercial";
  }
}

export function ProjectSetupModal({ open, onClose, project }: Props) {
  const isCreate = !project;
  const router = useRouter();
  const qc = useQueryClient();
  const canWatch = useHasFeature("folder_watcher");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>("commercial");
  const [feeling, setFeeling] = useState("");
  const [brief, setBrief] = useState("");
  const [refs, setRefs] = useState("");
  const [sampling, setSampling] = useState("heroes");
  const [formFactor, setFormFactor] = useState<"long_form" | "short_form" | "mixed" | "">("");
  const [aspect, setAspect] = useState("");
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [watchFolder, setWatchFolder] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setName(project.name);
      setKind(project.kind || "commercial");
      setFeeling(project.feeling || "");
      setBrief(project.brief || "");
      setRefs(project.references_text || "");
      setSampling(project.sampling_mode || "heroes");
      setFormFactor((project.form_factor as typeof formFactor) || "");
      setAspect(project.aspect_ratio || "");
      setWatchEnabled(Boolean(project.watch_enabled));
      setWatchFolder(project.watch_folder || "");
    } else {
      setName("");
      setKind("commercial");
      setFeeling("");
      setBrief("");
      setRefs("");
      setSampling("heroes");
      setFormFactor("");
      setAspect("");
      setWatchEnabled(false);
      setWatchFolder("");
    }
    setError(null);
  }, [open, project]);

  const save = useMutation({
    mutationFn: async () => {
      const k = kind as CreateKind;
      if (isCreate) {
        return api.createProject({
          name: name.trim() || defaultName(k),
          kind: k,
          form_factor: k === "social" ? formFactor || undefined : undefined,
          aspect_ratio: k === "social" ? aspect || undefined : undefined,
          feeling: feeling.trim() || undefined,
          brief: brief.trim() || undefined,
          references_text: refs.trim() || undefined,
          sampling_mode: (sampling as "fast" | "full" | "heroes" | "moments") || "heroes",
          generate_previews: true,
          vlm_enrichment: true,
        });
      }
      return api.updateProject(project!.id, {
        name: name.trim() || project!.name,
        kind: kind as
          | "commercial"
          | "social"
          | "archive"
          | "general"
          | "narrative"
          | "stills"
          | "video"
          | "mixed"
          | "props"
          | "locations"
          | "wardrobe",
        feeling: feeling.trim() || null,
        brief: brief.trim() || null,
        references_text: refs.trim() || null,
        sampling_mode: sampling as "fast" | "full" | "heroes" | "moments",
        watch_enabled: canWatch ? watchEnabled : false,
        watch_folder: watchFolder.trim() || null,
      });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["project", p.id] });
      onClose();
      if (isCreate) router.push(`/projects/${p.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-cinema-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-cinema-cyan" />
            <div>
              <div className="text-sm font-medium text-white">
                {isCreate ? "New project" : "Project brief & management"}
              </div>
              <p className="text-[11px] text-cinema-muted">
                Fill what you need — rest can wait
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">Name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">
              Job / media type
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-cinema-muted outline-none focus:border-cinema-cyan"
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
              {!isCreate && (
                <>
                  <option value="archive">Archive</option>
                  <option value="general">General</option>
                </>
              )}
            </select>
          </label>

          {kind === "social" && (
            <div className="flex gap-2">
              <select
                value={formFactor}
                onChange={(e) => setFormFactor(e.target.value as typeof formFactor)}
                className="flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-cinema-muted outline-none"
              >
                <option value="">Form</option>
                <option value="short_form">Short</option>
                <option value="long_form">Long</option>
                <option value="mixed">Mixed</option>
              </select>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value)}
                className="flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-cinema-muted outline-none"
              >
                <option value="">Aspect</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
                <option value="4:5">4:5</option>
                <option value="16:9">16:9</option>
              </select>
            </div>
          )}

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">
              Feeling / vibe
            </span>
            <input
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g. humid neon nights, quiet dread"
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">Brief</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={3}
              placeholder="Audience, tone, must-haves…"
              className="w-full resize-y rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">
              References
            </span>
            <textarea
              value={refs}
              onChange={(e) => setRefs(e.target.value)}
              rows={2}
              placeholder="Films, DPs, ads, eras"
              className="w-full resize-y rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">
              Sampling
            </span>
            <select
              value={sampling}
              onChange={(e) => setSampling(e.target.value)}
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none"
            >
              <option value="heroes">Heroes — top moments</option>
              <option value="moments">Moments — grade all, mark top N</option>
              <option value="full">Full — every scene</option>
              <option value="fast">Fast — sparse sample</option>
            </select>
          </label>

          {!isCreate && (
            <div className="space-y-2 rounded-lg border border-cinema-border/70 bg-cinema-black/40 p-3">
              <div className="flex items-center gap-2 text-xs text-white">
                <FolderOpen className="h-3.5 w-3.5 text-cinema-cyan" />
                Folder watcher
                {!canWatch && (
                  <span className="rounded border border-cinema-cyan/30 px-1 text-[9px] text-cinema-cyan">
                    Pro
                  </span>
                )}
              </div>
              {!canWatch ? (
                <ProGateBanner
                  feature="folder_watcher"
                  title="Folder watcher is Pro"
                  detail="Auto-ingest unlocks with Pro."
                  compact
                />
              ) : (
                <>
                  <label className="inline-flex items-center gap-2 text-xs text-cinema-muted">
                    <input
                      type="checkbox"
                      checked={watchEnabled}
                      onChange={(e) => setWatchEnabled(e.target.checked)}
                      className="accent-cinema-cyan"
                    />
                    <span className="text-white">Watch folder for new files</span>
                  </label>
                  <input
                    value={watchFolder}
                    onChange={(e) => setWatchFolder(e.target.value)}
                    placeholder="Absolute path (or blank for project inbox)"
                    className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-[11px] text-white outline-none focus:border-cinema-cyan"
                  />
                </>
              )}
              {!canWatch && (
                <a
                  href={PRO_UPGRADE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-cinema-cyan hover:underline"
                >
                  <Crown className="h-3 w-3" /> Unlock Pro
                </a>
              )}
            </div>
          )}

          {error && <p className="text-[11px] text-cinema-magenta">{error}</p>}
        </div>

        <div className="flex gap-2 border-t border-cinema-border p-4">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : isCreate ? "Create project" : "Save brief"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-xs text-cinema-muted hover:text-white"
          >
            {isCreate ? "Cancel" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
