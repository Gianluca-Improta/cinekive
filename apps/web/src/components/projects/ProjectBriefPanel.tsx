"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Save, Settings2 } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Project } from "@/lib/types";

type Props = {
  project: Project;
};

export function ProjectBriefPanel({ project }: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [feeling, setFeeling] = useState(project.feeling || "");
  const [brief, setBrief] = useState(project.brief || "");
  const [refs, setRefs] = useState(project.references_text || "");
  const [sampling, setSampling] = useState(project.sampling_mode || "heroes");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(project.name);
    setFeeling(project.feeling || "");
    setBrief(project.brief || "");
    setRefs(project.references_text || "");
    setSampling(project.sampling_mode || "heroes");
  }, [project]);

  const save = useMutation({
    mutationFn: () =>
      api.updateProject(project.id, {
        name: name.trim() || project.name,
        feeling: feeling.trim() || null,
        brief: brief.trim() || null,
        references_text: refs.trim() || null,
        sampling_mode: sampling as "fast" | "full" | "heroes" | "moments",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", project.id] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    },
  });

  const hasBrief = Boolean(project.brief || project.feeling);

  return (
    <div className="rounded-lg border border-cinema-border bg-cinema-panel/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="inline-flex items-center gap-2 text-xs text-white">
          <Settings2 className="h-3.5 w-3.5 text-cinema-cyan" />
          Project brief & management
          {hasBrief && !open && (
            <span className="rounded bg-cinema-cyan/15 px-1.5 py-0.5 font-mono text-[9px] text-cinema-cyan">
              brief set
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-cinema-muted" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-cinema-muted" />
        )}
      </button>
      {open && (
        <div className="space-y-3 border-t border-cinema-border px-3 py-3">
          <p className="text-[11px] text-cinema-muted">
            Write the feeling of this job once. Enrichment and search use it as
            context — no separate proposal panel.
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">
              Feeling / vibe
            </span>
            <input
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              placeholder="e.g. humid neon nights, quiet dread, soft 70s film"
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wide text-cinema-muted">Brief</span>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
              placeholder="What is this project for? Audience, tone, must-haves, avoid…"
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
              placeholder="Films, DPs, ads, eras — free text"
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
              <option value="heroes">Heroes — top moments per video</option>
              <option value="moments">Moments — grade all, mark top N</option>
              <option value="full">Full — every scene</option>
              <option value="fast">Fast — sparse sample</option>
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={save.isPending}
              onClick={() => save.mutate()}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              Save brief
            </button>
            {saved && <span className="text-[11px] text-cinema-cyan">Saved</span>}
            {save.isError && (
              <span className="text-[11px] text-cinema-magenta">
                {(save.error as Error).message}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
