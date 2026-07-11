"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Film, MessageSquareText } from "lucide-react";
import { VirtualMasonryGrid } from "@/components/grid/VirtualMasonryGrid";
import { ViewControls, type ViewMode } from "@/components/grid/ViewControls";
import { ShotDetailSheet } from "@/components/shots/ShotDetailSheet";
import { DropZone } from "@/components/ingest/DropZone";
import { JobProgressBanner } from "@/components/jobs/JobProgressBanner";
import { api } from "@/lib/api-client";
import type { Shot } from "@/lib/types";

export default function CollectionPage() {
  const params = useParams<{ id: string }>();
  const collectionId = params.id;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Shot | null>(null);
  const [preferInspector, setPreferInspector] = useState(true);
  const [detailMode, setDetailMode] = useState<"popup" | "inspector">("inspector");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [columns, setColumns] = useState(4);
  const [heroesOnly, setHeroesOnly] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [pathsText, setPathsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: collection } = useQuery({
    queryKey: ["collection", collectionId],
    queryFn: () => api.getCollection(collectionId),
    enabled: !!collectionId,
  });

  const shots = useMemo(() => {
    const items = collection?.shots ?? [];
    if (!heroesOnly) return items;
    return items.filter((s) => s.is_hero);
  }, [collection, heroesOnly]);

  const isWork = collection?.kind === "work" || collection?.kind === "reel";

  const ingestMutation = useMutation({
    mutationFn: () => {
      if (!collection?.project_id) throw new Error("Narrative needs a library to ingest into");
      const paths = pathsText
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean);
      if (!paths.length) throw new Error("Paste at least one video path");
      return api.ingestIntoCollection(collectionId, {
        paths,
        project_id: collection.project_id,
        sampling_mode: collection.sampling_mode || "moments",
        generate_previews: true,
      });
    },
    onSuccess: (res) => {
      setError(null);
      setActiveJobId(res.job.id);
      setPathsText("");
    },
    onError: (err: Error) => setError(err.message),
  });

  const importUrlMutation = useMutation({
    mutationFn: async (url: string) => {
      if (!collection?.project_id) throw new Error("Narrative needs a library");
      return api.importLink({
        url,
        project_id: collection.project_id,
        ingest: true,
        title: collection.name,
      });
    },
    onSuccess: (res) => {
      setError(null);
      const m = res.message.match(/ingest queued \(([^)]+)\)/i);
      if (m?.[1]) setActiveJobId(m[1]);
    },
    onError: (err: Error) => setError(err.message),
  });

  const dialogueMutation = useMutation({
    mutationFn: () => {
      if (!collection?.project_id) throw new Error("No project linked");
      return api.dialogueProject(collection.project_id, { force: false });
    },
    onSuccess: (res) => setActiveJobId(res.job.id),
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-4 border-b border-cinema-border px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-cinema-muted">
              <Film className="h-3 w-3 text-cinema-cyan" />
              {isWork ? "Narrative" : collection?.kind || "collection"}
              {collection?.year ? ` · ${collection.year}` : ""}
            </div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              {collection?.name || "Collection"}
            </h1>
            <p className="text-xs text-cinema-muted">
              {collection
                ? `${collection.shot_count} moments · ${collection.sampling_mode} grading`
                : "Loading…"}
              {collection?.description ? ` · ${collection.description}` : ""}
            </p>
            {isWork && (
              <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-cinema-muted">
                Narrative = one title. Drop the source or paste a URL — moments stay under this
                name. Commercials and Social are separate intention shelves.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-cinema-muted">
              <input
                type="checkbox"
                checked={heroesOnly}
                onChange={(e) => setHeroesOnly(e.target.checked)}
                className="accent-cinema-cyan"
              />
              Heroes only
            </label>
            {collection?.project_id ? (
              <button
                type="button"
                onClick={() => dialogueMutation.mutate()}
                disabled={dialogueMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
                title="Map dialogue with Whisper (install faster-whisper first)"
              >
                <MessageSquareText className="h-3.5 w-3.5" />
                Map dialogue
              </button>
            ) : null}
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
            <Link href="/" className="text-xs text-cinema-muted hover:text-white">
              Discovery
            </Link>
          </div>
        </div>

        {isWork ? (
          <div className="space-y-3 rounded border border-cinema-border bg-cinema-black/40 p-3">
            <p className="text-[11px] text-cinema-muted">
              Add the source file (server path) or download from a URL into the linked project
              library, then grade moments into this film.
            </p>
            {collection?.project_id && (
              <DropZone
                compact
                onImportUrl={async (u) => {
                  await importUrlMutation.mutateAsync(u);
                }}
                disabled={importUrlMutation.isPending || ingestMutation.isPending}
              />
            )}
            <textarea
              value={pathsText}
              onChange={(e) => setPathsText(e.target.value)}
              rows={2}
              placeholder="/data/library/.../The.Matrix.1999.mp4"
              className="w-full resize-none rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
            />
            <button
              type="button"
              onClick={() => ingestMutation.mutate()}
              disabled={ingestMutation.isPending || !collection?.project_id}
              className="rounded bg-cinema-cyan/20 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/30 disabled:opacity-40"
            >
              Grade paths into narrative
            </button>
            {!collection?.project_id ? (
              <p className="text-[11px] text-cinema-magenta">
                Create this narrative with a library so ingest has a home.
              </p>
            ) : null}
          </div>
        ) : null}

        {error && <p className="text-xs text-cinema-magenta">{error}</p>}
        {activeJobId && (
          <JobProgressBanner
            jobId={activeJobId}
            onDone={() => {
              setActiveJobId(null);
              qc.invalidateQueries({ queryKey: ["collection", collectionId] });
            }}
          />
        )}
      </header>

      <div className="flex-1 px-6 py-4">
        <VirtualMasonryGrid
          shots={shots}
          onSelect={(shot) => {
            setDetailMode(preferInspector ? "inspector" : "popup");
            setSelected(shot);
          }}
          onOpenPopup={(shot) => {
            setDetailMode("popup");
            setSelected(shot);
          }}
          columns={columns}
          viewMode={viewMode}
          inspectorOpen={Boolean(selected) && detailMode === "inspector"}
        />
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
