"use client";

import { useMemo, useRef, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Shot } from "@/lib/types";
import { ShotCard } from "@/components/shots/ShotCard";
import { artifactUrl } from "@/lib/api-client";
import { formatTimecode } from "@/lib/utils";
import type { ViewMode } from "@/components/grid/ViewControls";

type Props = {
  shots: Shot[];
  onSelect: (shot: Shot, ev?: MouseEvent) => void;
  /** Double-click opens the large popup stage (even when inspector is preferred). */
  onOpenPopup?: (shot: Shot) => void;
  columns?: number;
  selectedIds?: Set<string>;
  viewMode?: ViewMode;
  onDelete?: (shot: Shot) => void;
  onColorClick?: (hex: string) => void;
};

export function VirtualMasonryGrid({
  shots,
  onSelect,
  onOpenPopup,
  columns = 4,
  selectedIds,
  viewMode = "grid",
  onDelete,
  onColorClick,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const cols = viewMode === "list" ? 1 : viewMode === "compact" ? Math.max(columns, 5) : columns;

  const rows = useMemo(() => {
    const result: Shot[][] = [];
    for (let i = 0; i < shots.length; i += cols) {
      result.push(shots.slice(i, i + cols));
    }
    return result;
  }, [shots, cols]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (viewMode === "list" ? 88 : viewMode === "compact" ? 180 : 280),
    overscan: 4,
  });

  if (shots.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-cinema-border text-center">
        <p className="text-sm text-white">No shots yet</p>
        <p className="mt-1 max-w-sm text-xs text-cinema-muted">
          Create a project and drop a short video to extract cinematic frames.
        </p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-[calc(100vh-11rem)] overflow-auto pr-1">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vRow) => {
          const row = rows[vRow.index] || [];
          return (
            <div
              key={vRow.key}
              data-index={vRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vRow.start}px)`,
              }}
              className="pb-3"
            >
              {viewMode === "list" ? (
                <div className="space-y-2">
                  {row.map((shot) => {
                    const selected = selectedIds?.has(shot.id);
                    return (
                      <button
                        key={shot.id}
                        type="button"
                        onClick={(e) => onSelect(shot, e)}
                        onDoubleClick={() => onOpenPopup?.(shot)}
                        className={`flex w-full items-center gap-3 rounded border bg-cinema-panel p-2 text-left transition hover:border-cinema-cyan/40 ${
                          selected ? "border-cinema-cyan" : "border-cinema-border"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={artifactUrl(shot.thumb_url)}
                          alt=""
                          className="h-14 w-24 shrink-0 rounded object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">
                            {shot.source_title || shot.source_filename || "Shot"}
                          </div>
                          <div className="truncate font-mono text-[10px] text-cinema-muted">
                            {[
                              shot.techniques?.[0],
                              shot.shot_type,
                              shot.camera_movement,
                              shot.camera_angle,
                              shot.frame_role,
                              formatTimecode(shot.start_timecode_ms),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                          {shot.mood_vibe && (
                            <div className="truncate text-[11px] text-cinema-muted">
                              {shot.mood_vibe}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {shot.dominant_colors.slice(0, 3).map((c) => (
                            <span
                              key={c.hex}
                              className="h-3 w-3 rounded-sm border border-white/20"
                              style={{ backgroundColor: c.hex }}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                >
                  {row.map((shot) => (
                    <ShotCard
                      key={shot.id}
                      shot={shot}
                      selected={selectedIds?.has(shot.id)}
                      onClick={(e) => onSelect(shot, e)}
                      onDoubleClick={() => onOpenPopup?.(shot)}
                      onDelete={onDelete}
                      onColorClick={onColorClick}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
