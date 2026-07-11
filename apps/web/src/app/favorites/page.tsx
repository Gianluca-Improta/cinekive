"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { ViewControls, type ViewMode } from "@/components/grid/ViewControls";
import { ShotDetailSheet } from "@/components/shots/ShotDetailSheet";
import { ShotSelectionBar } from "@/components/shots/ShotSelectionBar";
import { useShots } from "@/hooks/useSearch";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

export default function FavoritesPage() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [selected, setSelected] = useState<Shot | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [columns, setColumns] = useState(4);

  const favQuery = useShots({
    isFavorite: true,
    groupSequences: true,
    enabled: true,
  });

  const shots = favQuery.data?.items ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.bulkDeleteShots([id]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["bin"] });
      setSelected(null);
    },
  });

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cinema-border px-6 py-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-cinema-muted">
            <Star className="h-3 w-3 fill-cinema-cyan text-cinema-cyan" />
            {t("favorites.starred")}
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-white">{t("favorites.title")}</h1>
          <p className="text-xs text-cinema-muted">
            {t(shots.length === 1 ? "favorites.count" : "favorites.count_plural", {
              n: shots.length,
            })}
          </p>
        </div>
        <ViewControls
          viewMode={viewMode}
          columns={columns}
          onViewMode={setViewMode}
          onColumns={setColumns}
          inspectorMode={preferInspector}
          onInspectorMode={(v) => {
            setPreferInspector(v);
            try {
              localStorage.setItem("cinekive.preferInspector", v ? "1" : "0");
            } catch {
              /* ignore */
            }
            if (selected) setDetailMode(v ? "inspector" : "popup");
          }}
        />
      </header>

      <div className="flex-1 px-6 py-4">
        <ShotSelectionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds(new Set())}
        />
        {favQuery.isFetching && shots.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-cinema-muted">
            {t("favorites.loading")}
          </div>
        ) : shots.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-cinema-border text-center">
            <Star className="mb-2 h-6 w-6 text-cinema-muted" />
            <p className="text-sm text-white">{t("favorites.empty")}</p>
            <p className="mt-1 max-w-sm text-xs text-cinema-muted">{t("favorites.emptyHint")}</p>
          </div>
        ) : (
          <VirtualMasonryGrid
            shots={shots}
            selectedIds={selectedIds}
            columns={columns}
            viewMode={viewMode}
            onSelect={(shot, ev) => {
              if (ev?.metaKey || ev?.ctrlKey || ev?.shiftKey) {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(shot.id)) next.delete(shot.id);
                  else if (next.size < 200) next.add(shot.id);
                  return next;
                });
                return;
              }
              setDetailMode(preferInspector ? "inspector" : "popup");
              setSelected(shot);
            }}
            onOpenPopup={(shot) => {
              setDetailMode("popup");
              setSelected(shot);
            }}
            onDelete={(s) => {
              if (
                confirm(
                  "Move this shot to the bin? It will be permanently deleted after 30 days."
                )
              ) {
                deleteMutation.mutate(s.id);
              }
            }}
          />
        )}
      </div>

      <ShotDetailSheet
        shot={selected}
        mode={detailMode}
        onModeChange={setDetailMode}
        onClose={() => {
          setSelected(null);
        }}
        onSelectShot={(s) => setSelected(s)}
      />
    </div>
  );
}
