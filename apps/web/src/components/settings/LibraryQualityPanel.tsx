"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardDrive, ImageUpscale } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type LibraryConfig = {
  max_edge: number;
  jpeg_quality: number;
  export_upscale: number;
  realesrgan_enabled: boolean;
  realesrgan_bin: string | null;
  dedupe_on_ingest?: boolean;
  dedupe_global?: boolean;
  dedupe_prefs_initialized?: boolean;
  archives: Record<string, { max_edge?: number; jpeg_quality?: number; export_upscale?: number }>;
};

type Props = {
  /** When set, edits only this archive's override (null fields inherit global). */
  archiveId?: string;
  compact?: boolean;
};

export function LibraryQualityPanel({ archiveId, compact }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["library-config"],
    queryFn: () => api.getLibraryConfig(),
  });
  const [draft, setDraft] = useState<LibraryConfig | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data?.config) setDraft(q.data.config as LibraryConfig);
  }, [q.data]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.updateLibraryConfig(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library-config"] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    },
  });

  if (!draft) {
    return (
      <div className="space-y-2">
        {!compact && (
          <div className="flex items-start gap-2">
            <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-cinema-cyan" />
            <div>
              <h3 className="text-sm font-medium text-white">Library storage</h3>
              <p className="mt-0.5 text-[11px] text-cinema-muted">
                {q.isLoading
                  ? "Loading library storage settings…"
                  : "Library storage: Unavailable — could not load config from the API."}
              </p>
            </div>
          </div>
        )}
        {compact && (
          <p className="text-xs text-cinema-muted">
            {q.isLoading
              ? "Loading…"
              : "Library storage: Unavailable — could not load config from the API."}
          </p>
        )}
        {!q.isLoading && (
          <button
            type="button"
            onClick={() => q.refetch()}
            className="rounded-lg border border-cinema-border px-2.5 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/30 hover:text-white"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const override = archiveId ? draft.archives?.[archiveId] || {} : null;
  const maxEdge = override?.max_edge ?? draft.max_edge;
  const jpegQ = override?.jpeg_quality ?? draft.jpeg_quality;
  const upscale = override?.export_upscale ?? draft.export_upscale;
  const edgePresets = q.data?.presets?.max_edge || [];
  const upPresets = q.data?.presets?.export_upscale || [];

  const patchGlobal = (partial: Partial<LibraryConfig>) => {
    setDraft((d) => (d ? { ...d, ...partial } : d));
  };

  const patchArchive = (partial: {
    max_edge?: number | null;
    jpeg_quality?: number | null;
    export_upscale?: number | null;
  }) => {
    if (!archiveId) return;
    setDraft((d) => {
      if (!d) return d;
      const prev = { ...(d.archives?.[archiveId] || {}) };
      for (const [k, v] of Object.entries(partial)) {
        if (v === null || v === undefined) delete (prev as Record<string, unknown>)[k];
        else (prev as Record<string, unknown>)[k] = v;
      }
      return {
        ...d,
        archives: {
          ...d.archives,
          [archiveId]: prev,
        },
      };
    });
  };

  const onSave = () => {
    if (archiveId) {
      const ov = draft.archives?.[archiveId];
      save.mutate({
        archives: {
          [archiveId]: ov && Object.keys(ov).length ? ov : null,
        },
      });
      return;
    }
    save.mutate({
      max_edge: draft.max_edge,
      jpeg_quality: draft.jpeg_quality,
      export_upscale: draft.export_upscale,
      realesrgan_enabled: draft.realesrgan_enabled,
      realesrgan_bin: draft.realesrgan_bin,
      dedupe_on_ingest: draft.dedupe_on_ingest,
      dedupe_global: draft.dedupe_global,
    });
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {!compact && (
        <div className="flex items-start gap-2">
          <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-cinema-cyan" />
          <div>
            <h3 className="text-sm font-medium text-white">
              {archiveId ? "This archive · storage" : "Library storage"}
            </h3>
            <p className="mt-0.5 text-[11px] text-cinema-muted">
              Keep keyframes lean on disk. Export can Real-ESRGAN upscale when you need print/high-res.
              {archiveId ? " Blank / inherit uses global Settings." : ""}
            </p>
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
          Max long edge
        </div>
        <div className="flex flex-wrap gap-1.5">
          {edgePresets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() =>
                archiveId ? patchArchive({ max_edge: p.value }) : patchGlobal({ max_edge: p.value })
              }
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                maxEdge === p.value
                  ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                  : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/30 hover:text-white"
              )}
            >
              {p.label}
            </button>
          ))}
          {archiveId && (
            <button
              type="button"
              onClick={() => patchArchive({ max_edge: null })}
              className="rounded-lg border border-cinema-border px-2.5 py-1.5 text-[11px] text-cinema-muted hover:text-white"
            >
              Inherit global
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] text-cinema-muted">
          JPEG quality
          <input
            type="range"
            min={60}
            max={95}
            value={jpegQ}
            onChange={(e) => {
              const v = Number(e.target.value);
              archiveId ? patchArchive({ jpeg_quality: v }) : patchGlobal({ jpeg_quality: v });
            }}
            className="w-28 accent-cinema-cyan"
          />
          <span className="font-mono text-cinema-cyan">{jpegQ}</span>
        </label>
      </div>

      <div>
        <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
          <ImageUpscale className="h-3 w-3" />
          Export upscale
        </div>
        <div className="flex flex-wrap gap-1.5">
          {upPresets.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() =>
                archiveId
                  ? patchArchive({ export_upscale: p.value })
                  : patchGlobal({ export_upscale: p.value })
              }
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-[11px] transition",
                upscale === p.value
                  ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
                  : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/30 hover:text-white"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-cinema-muted">
          Real-ESRGAN:{" "}
          {q.data?.realesrgan_available ? (
            <span className="text-cinema-cyan">found · {q.data.realesrgan_path}</span>
          ) : (
            <span>
              not on PATH — install{" "}
              <code className="text-cinema-cyan/80">realesrgan-ncnn-vulkan</code> for 2×/4× export
            </span>
          )}
        </p>
      </div>

      {!archiveId && (
        <div className="space-y-2 rounded-lg bg-cinema-black/30 p-3">
          <div className="text-[10px] uppercase tracking-widest text-cinema-muted">Dedupe</div>
          <p className="text-[10px] leading-relaxed text-cinema-muted">
            New installs default on. Existing libraries keep their previous setting until you change
            it here — never flipped silently on upgrade.
          </p>
          <label className="flex items-center gap-2 text-[11px] text-cinema-muted">
            <input
              type="checkbox"
              checked={Boolean(draft.dedupe_on_ingest)}
              onChange={(e) => patchGlobal({ dedupe_on_ingest: e.target.checked })}
              className="accent-cinema-cyan"
            />
            Dedupe after ingest
          </label>
          <label className="flex items-center gap-2 text-[11px] text-cinema-muted">
            <input
              type="checkbox"
              checked={Boolean(draft.dedupe_global)}
              onChange={(e) => patchGlobal({ dedupe_global: e.target.checked })}
              className="accent-cinema-cyan"
            />
            Cross-archive global dedupe
            <span className="rounded border border-cinema-cyan/30 px-1 text-[9px] text-cinema-cyan">
              Pro
            </span>
          </label>
        </div>
      )}

      {!archiveId && (
        <label className="flex items-center gap-2 text-[11px] text-cinema-muted">
          <input
            type="checkbox"
            checked={draft.realesrgan_enabled}
            onChange={(e) => patchGlobal({ realesrgan_enabled: e.target.checked })}
            className="accent-cinema-cyan"
          />
          Enable Real-ESRGAN on export
        </label>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={save.isPending}
          onClick={onSave}
          className="rounded-lg border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-[11px] text-cinema-cyan disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-[10px] text-cinema-cyan">Saved</span>}
        {save.isError && (
          <span className="text-[10px] text-cinema-magenta">
            {(save.error as Error)?.message || "Failed"}
          </span>
        )}
      </div>
    </div>
  );
}
