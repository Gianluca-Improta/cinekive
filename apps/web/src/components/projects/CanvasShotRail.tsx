"use client";

import { useMemo, useState } from "react";
import { LayoutGrid, Plus, Search } from "lucide-react";
import type { Shot } from "@/lib/types";
import { artifactUrl } from "@/lib/api-client";
import { CANVAS_SHOT_MIME } from "@/lib/canvas-types";
import { cn } from "@/lib/utils";

type Props = {
  shots: Shot[];
  onBoardIds: Set<string>;
  onAddAtCenter: (shotId: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
};

export function CanvasShotRail({
  shots,
  onBoardIds,
  onAddAtCenter,
  collapsed,
  onToggle,
}: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = [...shots].sort((a, b) => {
      const ao = onBoardIds.has(a.id) ? 1 : 0;
      const bo = onBoardIds.has(b.id) ? 1 : 0;
      return ao - bo;
    });
    if (!needle) return list;
    return list.filter((s) => {
      const blob = [
        s.source_title,
        s.source_filename,
        s.shot_type,
        s.mood_vibe,
        s.subject,
        ...(s.techniques || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(needle);
    });
  }, [shots, q, onBoardIds]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title="Show project clips"
        className="flex h-full w-9 shrink-0 flex-col items-center gap-2 border-l border-cinema-border bg-cinema-surface/80 py-3 text-cinema-muted hover:text-cinema-cyan"
      >
        <LayoutGrid className="h-4 w-4" />
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ writingMode: "vertical-rl" }}
        >
          Clips
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-l border-cinema-border bg-cinema-surface/90">
      <div className="flex items-center justify-between border-b border-cinema-border px-2.5 py-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-cinema-muted">Project</div>
          <div className="text-xs text-white">{shots.length} clips</div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="text-[10px] text-cinema-muted hover:text-white"
        >
          Hide
        </button>
      </div>
      <div className="border-b border-cinema-border px-2 py-1.5">
        <label className="flex items-center gap-1.5 rounded border border-cinema-border bg-cinema-black px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-cinema-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter…"
            className="w-full bg-transparent text-[11px] text-white outline-none placeholder:text-cinema-muted"
          />
        </label>
      </div>
      <p className="px-2.5 py-1.5 text-[10px] text-cinema-muted">
        Drag onto the board, or tap +
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-cinema-muted">No clips match</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((shot) => {
              const onBoard = onBoardIds.has(shot.id);
              return (
                <div
                  key={shot.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(CANVAS_SHOT_MIME, shot.id);
                    e.dataTransfer.setData("text/plain", shot.id);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  className={cn(
                    "group relative cursor-grab overflow-hidden rounded border bg-cinema-black active:cursor-grabbing",
                    onBoard ? "border-cinema-cyan/40 opacity-70" : "border-cinema-border"
                  )}
                  title={shot.source_title || shot.source_filename || "Shot"}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artifactUrl(shot.thumb_url)}
                    alt=""
                    className="pointer-events-none aspect-video w-full object-cover"
                    draggable={false}
                  />
                  {onBoard && (
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[8px] text-cinema-cyan">
                      On board
                    </span>
                  )}
                  <button
                    type="button"
                    title="Add to board center"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddAtCenter(shot.id);
                    }}
                    className="absolute bottom-1 right-1 rounded border border-cinema-border bg-black/75 p-0.5 text-cinema-cyan opacity-0 transition group-hover:opacity-100"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
