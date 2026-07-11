"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { api, artifactUrl } from "@/lib/api-client";
import type { Shot } from "@/lib/types";

function daysLeft(deletedAt: string | null): number {
  if (!deletedAt) return 30;
  const deleted = new Date(deletedAt).getTime();
  const purgeAt = deleted + 30 * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function BinPage() {
  const qc = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const binQuery = useQuery({
    queryKey: ["bin"],
    queryFn: () => api.listBin({ limit: 200 }),
  });

  const shots = binQuery.data?.items ?? [];
  const total = binQuery.data?.total ?? 0;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["bin"] });
    qc.invalidateQueries({ queryKey: ["shots"] });
    qc.invalidateQueries({ queryKey: ["search"] });
    setSelectedIds(new Set());
  };

  const restoreMutation = useMutation({
    mutationFn: (ids: string[]) => api.bulkRestoreShots(ids),
    onSuccess: invalidate,
  });

  const purgeMutation = useMutation({
    mutationFn: (ids: string[]) => api.bulkPurgeShots(ids),
    onSuccess: invalidate,
  });

  const selected = useMemo(() => [...selectedIds], [selectedIds]);

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b border-cinema-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-white">Bin</h1>
            <p className="text-xs text-cinema-muted">
              Soft-deleted shots · auto-purge after 30 days · {total} item
              {total === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!selected.length || restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(selected)}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore{selected.length ? ` (${selected.length})` : ""}
            </button>
            <button
              type="button"
              disabled={!selected.length || purgeMutation.isPending}
              onClick={() => {
                if (confirm(`Permanently delete ${selected.length} shots? This cannot be undone.`)) {
                  purgeMutation.mutate(selected);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded border border-cinema-magenta/40 px-3 py-1.5 text-xs text-cinema-magenta hover:bg-cinema-magenta/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete forever
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 px-6 py-4">
        {!shots.length && !binQuery.isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-cinema-muted">
            Bin is empty. Hit X on any shot to send it here.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {shots.map((shot: Shot) => {
                const selected = selectedIds.has(shot.id);
                const left = daysLeft(shot.deleted_at);
                return (
                  <button
                    key={shot.id}
                    type="button"
                    onClick={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(shot.id)) next.delete(shot.id);
                        else next.add(shot.id);
                        return next;
                      });
                    }}
                    className={`group relative overflow-hidden rounded-md border text-left ${
                      selected
                        ? "border-cinema-cyan shadow-glow"
                        : "border-cinema-border hover:border-cinema-cyan/40"
                    }`}
                    style={{ aspectRatio: `${shot.width || 3} / ${shot.height || 2}` }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={artifactUrl(shot.thumb_md_url || shot.thumb_url)}
                      alt=""
                      className="h-full w-full object-cover opacity-80"
                    />
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                      <div className="truncate text-[10px] text-white">
                        {shot.source_title || shot.source_filename || "Shot"}
                      </div>
                      <div className="font-mono text-[9px] text-cinema-muted">
                        {left}d left
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {/* keep masonry available for denser view if needed later */}
            <div className="hidden">
              <VirtualMasonryGrid shots={shots} onSelect={() => undefined} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
