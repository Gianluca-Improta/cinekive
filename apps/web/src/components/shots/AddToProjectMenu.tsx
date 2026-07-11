"use client";

import { useState, type MouseEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Props = {
  shotIds: string[];
  excludeProjectId?: string | null;
  /** Compact icon button (cards) vs labeled button (detail / selection) */
  variant?: "icon" | "button";
  className?: string;
  onAdded?: () => void;
};

export function AddToProjectMenu({
  shotIds,
  excludeProjectId,
  variant = "icon",
  className,
  onAdded,
}: Props) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    enabled: open,
  });

  const targets = projects.filter((p) => p.id !== excludeProjectId);

  const copyMutation = useMutation({
    mutationFn: (targetId: string) =>
      api.bulkMoveShots({
        shot_ids: shotIds,
        target_project_id: targetId,
        mode: "copy",
      }),
    onSuccess: (res, targetId) => {
      const name = projects.find((p) => p.id === targetId)?.name || "project";
      setMsg(`Added to ${name}`);
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["shots"] });
      onAdded?.();
      setTimeout(() => {
        setMsg(null);
        setOpen(false);
      }, 900);
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (!shotIds.length) return null;

  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <div className={cn("relative", className)} onClick={stop}>
      <button
        type="button"
        title="Add to project"
        onClick={(e) => {
          stop(e);
          setOpen((v) => !v);
          setMsg(null);
        }}
        className={
          variant === "button"
            ? "inline-flex items-center gap-1.5 rounded border border-cinema-border px-2.5 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
            : "rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
        }
      >
        <FolderPlus className="h-3.5 w-3.5" />
        {variant === "button" && <span>Add to</span>}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close"
            onClick={(e) => {
              stop(e);
              setOpen(false);
            }}
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-52 overflow-hidden rounded border border-cinema-border bg-cinema-surface shadow-xl">
            <div className="border-b border-cinema-border px-2 py-1.5 text-[10px] uppercase tracking-wide text-cinema-muted">
              Copy into project
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {targets.length === 0 && (
                <li className="px-3 py-2 text-[11px] text-cinema-muted">No other projects</li>
              )}
              {targets.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={copyMutation.isPending}
                    onClick={(e) => {
                      stop(e);
                      copyMutation.mutate(p.id);
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-cinema-muted hover:bg-cinema-panel hover:text-white disabled:opacity-40"
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="ml-2 shrink-0 text-[10px] opacity-60">{p.shot_count}</span>
                  </button>
                </li>
              ))}
            </ul>
            {msg && (
              <div className="border-t border-cinema-border px-2 py-1.5 text-[10px] text-cinema-cyan">
                {msg}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
