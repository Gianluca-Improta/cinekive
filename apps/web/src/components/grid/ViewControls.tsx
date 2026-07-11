"use client";

import { Columns3, Grid2X2, LayoutGrid, List, PanelRight } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";

export type ViewMode = "grid" | "compact" | "list";

type Props = {
  viewMode: ViewMode;
  columns: number;
  onViewMode: (v: ViewMode) => void;
  onColumns: (n: number) => void;
  /** When on, clicking a shot opens the side inspector (no blur) instead of the popup. */
  inspectorMode?: boolean;
  onInspectorMode?: (v: boolean) => void;
};

export function ViewControls({
  viewMode,
  columns,
  onViewMode,
  onColumns,
  inspectorMode,
  onInspectorMode,
}: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="flex overflow-hidden rounded border border-cinema-border">
        <button
          type="button"
          title={t("view.grid")}
          onClick={() => onViewMode("grid")}
          className={`px-2 py-1.5 ${viewMode === "grid" ? "bg-cinema-panel text-cinema-cyan" : "text-cinema-muted"}`}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={t("view.compact")}
          onClick={() => onViewMode("compact")}
          className={`px-2 py-1.5 ${viewMode === "compact" ? "bg-cinema-panel text-cinema-cyan" : "text-cinema-muted"}`}
        >
          <Grid2X2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={t("view.list")}
          onClick={() => onViewMode("list")}
          className={`px-2 py-1.5 ${viewMode === "list" ? "bg-cinema-panel text-cinema-cyan" : "text-cinema-muted"}`}
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>
      {onInspectorMode && (
        <button
          type="button"
          title={inspectorMode ? t("view.inspectorOnHint") : t("view.inspectorOffHint")}
          onClick={() => onInspectorMode(!inspectorMode)}
          className={`inline-flex items-center gap-1.5 rounded border px-2 py-1.5 ${
            inspectorMode
              ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:text-white"
          }`}
        >
          <PanelRight className="h-3.5 w-3.5" />
          {t("view.inspector")}
        </button>
      )}
      {viewMode !== "list" && (
        <label className="flex items-center gap-1.5 text-cinema-muted">
          <Columns3 className="h-3.5 w-3.5" />
          <select
            value={columns}
            onChange={(e) => onColumns(Number(e.target.value))}
            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 outline-none focus:border-cinema-cyan"
          >
            {[2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {t("view.cols", { n })}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
