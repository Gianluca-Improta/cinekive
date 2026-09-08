"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FolderInput, Trash2, X, Crown } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Collection } from "@/lib/types";
import { SendToBoardMenu } from "@/components/shots/SendToBoardMenu";
import { useEntitlements, PRO_UPGRADE_URL } from "@/hooks/useEntitlements";
import { BUILTIN_SHELVES, shelfLabel } from "@/lib/project-shelves";

type Props = {
  selectedIds: Set<string>;
  currentProjectId?: string;
  /** All project shelves keyed by shelfKeyOf() */
  shelves?: Record<string, Collection> | null;
  /** Keys shown as quick-add buttons (visible shelf tabs) */
  shelfKeys?: string[];
  activeShelf?: string | null;
  onClear: () => void;
  onDone?: () => void;
  onShelfChange?: () => void;
};

export function ShotSelectionBar({
  selectedIds,
  currentProjectId,
  shelves,
  shelfKeys,
  activeShelf,
  onClear,
  onDone,
  onShelfChange,
}: Props) {
  const qc = useQueryClient();
  const { data: entitlements } = useEntitlements();
  const [targetProject, setTargetProject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = useMemo(() => [...selectedIds], [selectedIds]);
  const canBatchExport = Boolean(entitlements?.is_pro) || ids.length <= 1;

  const quickKeys = useMemo(() => {
    if (shelfKeys?.length) return shelfKeys;
    return BUILTIN_SHELVES.filter((s) => s.defaultVisible).map((s) => s.key);
  }, [shelfKeys]);

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

  const shelfMutation = useMutation({
    mutationFn: async (key: string) => {
      let shelfMap = shelves;
      if (!shelfMap && currentProjectId) {
        shelfMap = await api.ensureProjectShelves(currentProjectId);
      }
      const col = shelfMap?.[key];
      if (!col) throw new Error("Shelf not ready");
      await api.addToCollection(col.id, ids);
      return col.id;
    },
    onSuccess: (collectionId) => {
      qc.invalidateQueries({ queryKey: ["collection", collectionId] });
      qc.invalidateQueries({ queryKey: ["project-shelves", currentProjectId] });
      onShelfChange?.();
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  const removeShelfMutation = useMutation({
    mutationFn: async () => {
      if (!activeShelf || !shelves?.[activeShelf]) throw new Error("No active shelf");
      const col = shelves[activeShelf];
      await api.removeFromCollection(col.id, ids);
      return col.id;
    },
    onSuccess: (collectionId) => {
      qc.invalidateQueries({ queryKey: ["collection", collectionId] });
      onShelfChange?.();
      onClear();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (ids.length === 0) return null;

  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded border border-cinema-cyan/40 bg-cinema-panel/95 px-3 py-2 text-xs backdrop-blur">
      <span className="font-medium text-cinema-cyan">{ids.length} selected</span>
      <button
        type="button"
        onClick={() => {
          if (!canBatchExport) {
            window.open(entitlements?.upgrade_url || PRO_UPGRADE_URL, "_blank");
            return;
          }
          api.exportShots(ids, "zip").catch((e: Error) => setError(e.message));
        }}
        title={canBatchExport ? "Export ZIP" : "Batch export requires Pro"}
        className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1 text-cinema-muted hover:text-white"
      >
        {!canBatchExport && <Crown className="h-3 w-3 text-cinema-cyan" />}
        Export
      </button>
      <SendToBoardMenu shotIds={ids} projectId={currentProjectId} label="Send to board" />
      {currentProjectId && quickKeys.length > 0 && (
        <div className="flex max-w-full flex-wrap overflow-hidden rounded border border-cinema-border">
          {quickKeys.map((key) => {
            const col = shelves?.[key];
            const label =
              col ? shelfLabel(col) : BUILTIN_SHELVES.find((s) => s.key === key)?.label || key;
            return (
              <button
                key={key}
                type="button"
                disabled={shelfMutation.isPending || !col}
                onClick={() => shelfMutation.mutate(key)}
                className={`px-2 py-1 text-cinema-muted hover:text-cinema-cyan disabled:opacity-40 ${
                  activeShelf === key ? "bg-cinema-cyan/10 text-cinema-cyan" : ""
                }`}
                title={`Add to ${label} shelf`}
              >
                + {label}
              </button>
            );
          })}
        </div>
      )}
      {activeShelf && (
        <button
          type="button"
          disabled={removeShelfMutation.isPending}
          onClick={() => removeShelfMutation.mutate()}
          className="rounded border border-cinema-border px-2 py-1 text-cinema-muted hover:text-cinema-magenta"
          title="Remove from this shelf"
        >
          Remove from shelf
        </button>
      )}
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
          if (
            confirm(
              `Move ${ids.length} shots to Trash? They will be permanently deleted after 30 days.`
            )
          ) {
            deleteMutation.mutate();
          }
        }}
        className="inline-flex items-center gap-1 rounded border border-cinema-magenta/40 px-2 py-1 text-cinema-magenta hover:bg-cinema-magenta/10"
      >
        <Trash2 className="h-3 w-3" />
        Trash
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
