"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Plus, Check } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Props = {
  shotIds: string[];
  projectId?: string | null;
  className?: string;
  label?: string;
  /** Called after shots land on a board — e.g. switch project view to Moodboard */
  onAdded?: (collectionId: string) => void;
};

export const OPEN_MOODBOARD_EVENT = "cinekive:open-moodboard";

export function openMoodboard(projectId?: string, collectionId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPEN_MOODBOARD_EVENT, {
      detail: { projectId: projectId || null, collectionId: collectionId || null },
    })
  );
}

export function SendToBoardMenu({
  shotIds,
  projectId,
  className,
  label = "Send to board",
  onAdded,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const { data: boards = [], isFetching } = useQuery({
    queryKey: ["collections", "canvas", projectId || "all"],
    queryFn: () =>
      api.listCollections({
        project_id: projectId || undefined,
        kind: "canvas",
      }),
    enabled: open && shotIds.length > 0,
  });

  const finish = (collectionId: string) => {
    qc.invalidateQueries({ queryKey: ["collection", collectionId] });
    qc.invalidateQueries({ queryKey: ["collections", "canvas"] });
    setJustAdded(collectionId);
    onAdded?.(collectionId);
    openMoodboard(projectId || undefined, collectionId);
    setTimeout(() => {
      setOpen(false);
      setJustAdded(null);
    }, 900);
  };

  const addMutation = useMutation({
    mutationFn: async (collectionId: string) => {
      await api.addToCollection(collectionId, shotIds);
      return collectionId;
    },
    onSuccess: finish,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const col = await api.createCollection({
        name: `Board ${(boards.length || 0) + 1}`,
        kind: "canvas",
        project_id: projectId || undefined,
        sampling_mode: "heroes",
        meta: {
          canvas: {
            positions: {},
            groups: [],
            edges: [],
            notes: [],
            texts: [],
            media: [],
            stacks: [],
            view: { x: 0, y: 0, scale: 0.45 },
          },
        },
      });
      await api.addToCollection(col.id, shotIds);
      return col;
    },
    onSuccess: (col) => {
      setCreating(false);
      finish(col.id);
    },
  });

  if (!shotIds.length) return null;

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
      >
        <LayoutTemplate className="h-3.5 w-3.5" />
        {label}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-lg border border-cinema-border bg-cinema-surface shadow-xl">
          <div className="border-b border-cinema-border px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
            Project moodboard
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {isFetching && (
              <p className="px-2.5 py-2 text-[11px] text-cinema-muted">Loading…</p>
            )}
            {!isFetching && boards.length === 0 && (
              <p className="px-2.5 py-2 text-[11px] text-cinema-muted">
                No boards yet — create one below
              </p>
            )}
            {boards.map((b) => (
              <button
                key={b.id}
                type="button"
                disabled={addMutation.isPending}
                onClick={() => addMutation.mutate(b.id)}
                className="flex w-full items-center justify-between px-2.5 py-1.5 text-left text-[11px] text-white hover:bg-cinema-panel"
              >
                <span className="truncate">{b.name}</span>
                {justAdded === b.id ? (
                  <Check className="h-3 w-3 text-cinema-cyan" />
                ) : (
                  <span className="text-cinema-muted">{b.shot_count}</span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={createMutation.isPending || creating}
            onClick={() => {
              setCreating(true);
              createMutation.mutate();
            }}
            className="flex w-full items-center gap-1.5 border-t border-cinema-border px-2.5 py-2 text-[11px] text-cinema-cyan hover:bg-cinema-panel"
          >
            <Plus className="h-3 w-3" />
            {createMutation.isPending ? "Adding…" : "New board + add"}
          </button>
          <p className="border-t border-cinema-border/50 px-2.5 py-1.5 text-[10px] text-cinema-muted">
            Opens Moodboard after add
          </p>
        </div>
      )}
    </div>
  );
}
