"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Columns3, Plus } from "lucide-react";
import type { Shot } from "@/lib/types";
import { ShotCard } from "@/components/shots/ShotCard";
import { artifactUrl } from "@/lib/api-client";
import {
  DEFAULT_LIST_COLUMNS,
  LIST_COLUMN_CATALOG,
  loadListColumns,
  resolveListColumns,
  saveListColumns,
  type ListColumnId,
} from "@/lib/list-columns";
import type { ViewMode } from "@/components/grid/ViewControls";
import { cn } from "@/lib/utils";

type Props = {
  shots: Shot[];
  onSelect: (shot: Shot, ev?: MouseEvent) => void;
  onOpenPopup?: (shot: Shot) => void;
  columns?: number;
  selectedIds?: Set<string>;
  viewMode?: ViewMode;
  onDelete?: (shot: Shot) => void;
  onColorClick?: (hex: string) => void;
  inspectorOpen?: boolean;
  /** Keep right gutter even when inspector closed — stops grid jump on popup/inspector toggle */
  reserveInspectorGutter?: boolean;
  /** Custom empty UI (filters / load errors). */
  emptyState?: ReactNode;
  /** Fill parent flex height instead of viewport calc. */
  fillHeight?: boolean;
};

type LaidOut = {
  shot: Shot;
  col: number;
  y: number;
  h: number;
};

function aspectRatio(shot: Shot): number {
  const w = shot.width || 3;
  const h = shot.height || 2;
  return w / Math.max(h, 1);
}

/** 0 landscape · 1 square · 2 portrait — clump similar frames together */
function aspectBucket(shot: Shot): number {
  const r = aspectRatio(shot);
  if (r >= 1.25) return 0;
  if (r <= 0.85) return 2;
  return 1;
}

function sortByAspect(shots: Shot[]): Shot[] {
  return [...shots].sort((a, b) => {
    const d = aspectBucket(a) - aspectBucket(b);
    if (d !== 0) return d;
    // Within bucket, taller-first keeps column packing stable
    return aspectRatio(a) - aspectRatio(b);
  });
}

const GAP = 12;

export function VirtualMasonryGrid({
  shots,
  onSelect,
  onOpenPopup,
  columns = 4,
  selectedIds,
  viewMode = "grid",
  onDelete,
  onColorClick,
  inspectorOpen = false,
  reserveInspectorGutter = false,
  emptyState,
  fillHeight = false,
}: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [listCols, setListCols] = useState<ListColumnId[]>(DEFAULT_LIST_COLUMNS);
  const [colsOpen, setColsOpen] = useState(false);

  useEffect(() => {
    setListCols(loadListColumns());
  }, []);

  const metaCols = useMemo(() => resolveListColumns(listCols), [listCols]);

  const setListColsPersist = (next: ListColumnId[]) => {
    const cleaned = next.length ? next : [...DEFAULT_LIST_COLUMNS];
    setListCols(cleaned);
    saveListColumns(cleaned);
  };

  const toggleListCol = (id: ListColumnId) => {
    setListColsPersist(
      listCols.includes(id) ? listCols.filter((x) => x !== id) : [...listCols, id]
    );
  };

  // dynamic grid: Frame + Title + N meta columns
  const listGridTemplate = useMemo(() => {
    const meta = metaCols.map(() => "minmax(4.5rem,0.7fr)").join(" ");
    return `5.5rem minmax(8rem,1.4fr) ${meta || "minmax(4.5rem,0.7fr)"}`;
  }, [metaCols]);

  const gutter = inspectorOpen || reserveInspectorGutter;
  const colCount = useMemo(() => {
    if (viewMode === "list") return 1;
    if (gutter) {
      if (viewMode === "compact") return Math.min(columns, 4);
      return Math.min(columns, 3);
    }
    if (viewMode === "compact") return Math.max(columns, 5);
    return columns;
  }, [viewMode, columns, gutter]);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width || 0;
      setWidth(w);
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (viewMode === "list" || width <= 0) {
      return { items: [] as LaidOut[], totalHeight: 0, colWidth: 0 };
    }
    const sorted = sortByAspect(shots);
    const colWidth = (width - GAP * (colCount - 1)) / colCount;
    const heights = Array.from({ length: colCount }, () => 0);
    const items: LaidOut[] = [];
    for (const shot of sorted) {
      const ar = aspectRatio(shot);
      const h = colWidth / ar;
      let col = 0;
      let minY = heights[0];
      for (let i = 1; i < colCount; i++) {
        if (heights[i] < minY) {
          minY = heights[i];
          col = i;
        }
      }
      items.push({ shot, col, y: heights[col], h });
      heights[col] += h + GAP;
    }
    return {
      items,
      totalHeight: Math.max(0, ...heights),
      colWidth,
    };
  }, [shots, width, colCount, viewMode]);

  const listRows = useMemo(() => {
    if (viewMode !== "list") return [] as Shot[][];
    return shots.map((s) => [s]);
  }, [shots, viewMode]);

  const listVirtualizer = useVirtualizer({
    count: listRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 12,
    enabled: viewMode === "list",
  });

  const { items: visibleItems, totalHeight, colWidth } = layout;

  if (!shots.length) {
    return (
      <div
        className={`flex min-h-[12rem] flex-1 items-center justify-center ${
          fillHeight ? "h-full" : ""
        }`}
      >
        {emptyState || <p className="text-sm text-cinema-muted">No shots yet.</p>}
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={`min-h-0 flex-1 overflow-auto pr-1 ${
        fillHeight ? "h-full" : "h-[calc(100vh-11rem)]"
      } ${gutter ? "md:pr-[28rem]" : ""}`}
    >
      {viewMode === "list" ? (
        <>
          <div
            className="sticky top-0 z-10 mb-1 grid items-center gap-2 border-b border-white/[0.06] bg-cinema-black/95 px-2 py-1.5 text-[9px] uppercase tracking-wider text-cinema-muted backdrop-blur"
            style={{ gridTemplateColumns: `${listGridTemplate} auto` }}
          >
            <span>Frame</span>
            <span>Title</span>
            {metaCols.map((c) => (
              <span key={c.id}>{c.short}</span>
            ))}
            <div className="relative justify-self-end">
              <button
                type="button"
                title="Choose metadata columns"
                onClick={() => setColsOpen((v) => !v)}
                className="inline-flex items-center gap-1 rounded border border-cinema-border/70 px-1.5 py-0.5 text-[9px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
              >
                <Columns3 className="h-3 w-3" />
                <Plus className="h-2.5 w-2.5" />
              </button>
              {colsOpen ? (
                <>
                  <button
                    type="button"
                    className="fixed inset-0 z-40 cursor-default"
                    aria-label="Close"
                    onClick={() => setColsOpen(false)}
                  />
                  <div className="absolute right-0 top-full z-50 mt-1 max-h-72 w-52 overflow-y-auto rounded-lg border border-cinema-border bg-cinema-surface p-2 shadow-xl">
                    <p className="mb-1.5 px-1 text-[9px] uppercase tracking-wide text-cinema-muted">
                      List columns
                    </p>
                    {LIST_COLUMN_CATALOG.map((c) => {
                      const on = listCols.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[11px] normal-case tracking-normal text-white hover:bg-cinema-panel"
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleListCol(c.id)}
                            className="accent-cinema-cyan"
                          />
                          <span className="min-w-0 flex-1 truncate">{c.label}</span>
                          <span className="text-[9px] uppercase text-cinema-muted">{c.short}</span>
                        </label>
                      );
                    })}
                    <button
                      type="button"
                      className="mt-1 w-full rounded px-1.5 py-1 text-left text-[10px] text-cinema-muted hover:text-cinema-cyan"
                      onClick={() => setListColsPersist([...DEFAULT_LIST_COLUMNS])}
                    >
                      Reset defaults
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
          <div
            style={{
              height: listVirtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {listVirtualizer.getVirtualItems().map((vRow) => {
              const row = listRows[vRow.index] || [];
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={listVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="pb-1"
                >
                  {row.map((shot) => {
                    const selected = selectedIds?.has(shot.id);
                    return (
                      <button
                        key={shot.id}
                        type="button"
                        onClick={(e) => onSelect(shot, e)}
                        onDoubleClick={() => onOpenPopup?.(shot)}
                        style={{ gridTemplateColumns: listGridTemplate }}
                        className={cn(
                          "grid w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-[11px] transition hover:border-cinema-cyan/35",
                          selected
                            ? "border-cinema-cyan bg-cinema-cyan/5"
                            : "border-transparent bg-cinema-panel/40 hover:bg-cinema-panel/70"
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={artifactUrl(shot.thumb_md_url || shot.thumb_url)}
                          alt=""
                          className="h-10 w-[5.5rem] rounded object-cover"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-white">
                            {shot.source_title || shot.source_filename || "Shot"}
                          </div>
                          <div className="truncate text-[10px] text-cinema-muted">
                            {[shot.subject, shot.content_format, shot.emotion]
                              .filter(Boolean)
                              .join(" · ")}
                          </div>
                        </div>
                        {metaCols.map((c) => (
                          <span
                            key={c.id}
                            className={cn(
                              "truncate text-cinema-muted",
                              c.id === "tc" && "font-mono text-[10px] tabular-nums"
                            )}
                          >
                            {c.value(shot)}
                          </span>
                        ))}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{ height: totalHeight, position: "relative", width: "100%" }}>
          {visibleItems.map(({ shot, col, y, h }) => (
            <div
              key={shot.id}
              style={{
                position: "absolute",
                top: y,
                left: col * (colWidth + GAP),
                width: colWidth,
                height: h,
              }}
            >
              <ShotCard
                shot={shot}
                selected={selectedIds?.has(shot.id)}
                onClick={(e) => onSelect(shot, e)}
                onDoubleClick={() => onOpenPopup?.(shot)}
                onDelete={onDelete}
                onColorClick={onColorClick}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
