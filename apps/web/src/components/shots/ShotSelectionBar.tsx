"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FolderInput, Trash2, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { SendToBoardMenu } from "@/components/shots/SendToBoardMenu";

type Props = {
  selectedIds: Set<string>;
  currentProjectId?: string;
  onClear: () => void;
  onDone?: () => void;
};

export function ShotSelectionBar({ selectedIds, currentProjectId, onClear, onDone }: Props) {
  const qc = useQueryClient();
  const [targetProject, setTargetProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => [...selectedIds], [selectedIds]);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const otherProjects = projects.filter((p) => p.id !== currentProjectId);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["shots"] });
    qc.invalidateQueries({ queryKey: ["search"] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["project"] });
    qc.invalidateQueries({ queryKey: ["bin"] });
    onClear();
    onDone?.();
  };

  const deleteMutation = useMutation({
    mutationFn: () => api.bulkDeleteShots(ids),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      api.bulkMoveShots({
        shot_ids: ids,
        target_project_id: targetProject,
        mode: "move",
      }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  const copyMutation = useMutation({
    mutationFn: () =>
      api.bulkMoveShots({
        shot_ids: ids,
        target_project_id: targetProject,
        mode: "copy",
      }),
    onSuccess: invalidate,
    onError: (e: Error) => setError(e.message),
  });

  if (ids.length === 0) return null;

  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded border border-cinema-cyan/40 bg-cinema-panel/95 px-3 py-2 text-xs backdrop-blur">
      <span className="font-medium text-cinema-cyan">{ids.length} selected</span>
      <button
        type="button"
        onClick={() => api.exportShots(ids, "zip")}
        className="rounded border border-cinema-border px-2 py-1 text-cinema-muted hover:text-white"
      >
        Export
      </button>
      <SendToBoardMenu shotIds={ids} projectId={currentProjectId} label="Send to board" />
      <select
        value={targetProject}
        onChange={(e) => setTargetProject(e.target.value)}
        className="rounded border border-cinema-border bg-cinema-black px-2 py-1 text-cinema-muted outline-none"
      >
        <option value="">Move / copy to…</option>
        {otherProjects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!targetProject || moveMutation.isPending}
        onClick={() => moveMutation.mutate()}
        className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1 text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
      >
        <FolderInput className="h-3 w-3" />
        Move
      </button>
      <button
        type="button"
        disabled={!targetProject || copyMutation.isPending}
        onClick={() => copyMutation.mutate()}
        className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1 text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
      >
        <Copy className="h-3 w-3" />
        Copy
      </button>
      <button
        type="button"
        disabled={deleteMutation.isPending}
        onClick={() => {
          if (confirm(`Move ${ids.length} shots to the bin? They will be permanently deleted after 30 days.`)) {
            deleteMutation.mutate();
          }
        }}
        className="inline-flex items-center gap-1 rounded border border-cinema-magenta/40 px-2 py-1 text-cinema-magenta hover:bg-cinema-magenta/10"
      >
        <Trash2 className="h-3 w-3" />
        Bin
      </button>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto inline-flex items-center gap-1 text-cinema-muted hover:text-white"
      >
        <X className="h-3 w-3" />
        Clear
      </button>
      {error && <span className="w-full text-cinema-magenta">{error}</span>}
    </div>
  );
}
