"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stethoscope } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/** SQLite ↔ Qdrant doctor + rebuild (Settings → Advanced). */
export function LibraryDoctorPanel() {
  const qc = useQueryClient();
  const [ran, setRan] = useState(false);
  const report = useQuery({
    queryKey: ["library-doctor"],
    queryFn: () => api.verifyLibrary(),
    enabled: ran,
    staleTime: 30_000,
  });

  const rebuild = useMutation({
    mutationFn: () => api.rebuildIndex(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["library-doctor"] });
    },
  });

  const data = report.data;

  return (
    <div className="space-y-3 rounded-xl bg-cinema-surface/50 p-4">
      <div className="flex items-start gap-2">
        <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-cinema-cyan" />
        <div>
          <h3 className="text-sm font-medium text-white">Library doctor</h3>
          <p className="mt-0.5 text-[11px] text-cinema-muted">
            SQLite is source of truth; Qdrant is a rebuildable index. Verify consistency, then rebuild
            if vectors drift.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setRan(true);
            void report.refetch();
          }}
          className="rounded-lg border border-cinema-border px-3 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        >
          {report.isFetching ? "Checking…" : "Verify library"}
        </button>
        <button
          type="button"
          disabled={rebuild.isPending}
          onClick={() => {
            if (
              confirm(
                "Queue reindex for every project? Search may be incomplete until jobs finish."
              )
            ) {
              rebuild.mutate();
            }
          }}
          className="rounded-lg border border-cinema-cyan/35 bg-cinema-cyan/10 px-3 py-1.5 text-[11px] text-cinema-cyan disabled:opacity-40"
        >
          {rebuild.isPending ? "Queuing…" : "Rebuild index"}
        </button>
      </div>

      {rebuild.isSuccess && (
        <p className="text-[11px] text-cinema-cyan">
          Queued {rebuild.data.projects} project reindex job(s). Watch Activity.
        </p>
      )}
      {rebuild.isError && (
        <p className="text-[11px] text-cinema-magenta">
          {(rebuild.error as Error)?.message || "Rebuild failed"}
        </p>
      )}

      {data && (
        <div className="space-y-2 text-[11px]">
          <div
            className={cn(
              "font-medium",
              data.ok ? "text-cinema-cyan" : "text-cinema-magenta"
            )}
          >
            {data.ok ? "OK — SQLite and Qdrant look consistent" : "Issues found"}
          </div>
          <p className="text-cinema-muted">
            SQLite {data.sqlite.shots_active} active · Qdrant {data.qdrant.points} points · dim{" "}
            {data.qdrant.vector_size ?? "?"} (expect {data.qdrant.expected_dim})
          </p>
          {data.issues.map((i) => (
            <p key={i.code} className="text-cinema-magenta">
              [{i.code}] {i.message}
            </p>
          ))}
          {data.warnings.map((w) => (
            <p key={w.code} className="text-amber-200/90">
              [{w.code}] {w.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
