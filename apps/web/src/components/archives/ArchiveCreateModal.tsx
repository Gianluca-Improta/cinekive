"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Archive, X } from "lucide-react";
import { DropZone } from "@/components/ingest/DropZone";
import { api } from "@/lib/api-client";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Prefill from Discover / seed */
  prefill?: { name?: string; url?: string; note?: string };
};

export function ArchiveCreateModal({ open, onClose, prefill }: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [note, setNote] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(prefill?.name || "");
    setSiteUrl(prefill?.url || "");
    setNote(prefill?.note || "");
    setPendingFiles(null);
    setError(null);
  }, [open, prefill?.name, prefill?.url, prefill?.note]);

  const createAndUpload = useMutation({
    mutationFn: async (files?: File[]) => {
      const project = await api.createCustomArchive({
        name: name.trim() || (files?.length ? "Dropped stills" : "Untitled archive"),
        site_url: siteUrl.trim() || undefined,
        source_note: note.trim() || undefined,
      });
      if (files?.length) {
        await api.uploadToArchive(project.id, files);
      }
      return project;
    },
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      onClose();
      router.push(`/projects/${project.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-cinema-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-cinema-cyan" />
            <div>
              <div className="text-sm font-medium text-white">New archive</div>
              <p className="text-[11px] text-cinema-muted">Name it or just drop stills</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Archive name"
            autoFocus
            className="w-full rounded border border-cinema-border bg-cinema-black px-3 py-2 text-sm text-white outline-none focus:border-cinema-cyan"
          />
          <input
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
            placeholder="Optional site URL"
            className="w-full rounded border border-cinema-border bg-cinema-black px-3 py-2 text-xs text-white outline-none focus:border-cinema-cyan"
          />
          <DropZone
            compact
            onFiles={(files, kind) => {
              if (kind !== "image") {
                setError("Drop stills / GIFs / image folders (not video).");
                return;
              }
              setPendingFiles(files);
              setError(null);
            }}
            disabled={createAndUpload.isPending}
          />
          {pendingFiles && (
            <p className="text-[11px] text-cinema-cyan">
              {pendingFiles.length} file{pendingFiles.length === 1 ? "" : "s"} ready
            </p>
          )}
          {error && <p className="text-[11px] text-cinema-magenta">{error}</p>}
        </div>
        <div className="flex gap-2 border-t border-cinema-border p-4">
          <button
            type="button"
            disabled={createAndUpload.isPending || (!name.trim() && !pendingFiles?.length)}
            onClick={() => createAndUpload.mutate(pendingFiles || undefined)}
            className="flex-1 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-40"
          >
            {createAndUpload.isPending
              ? "Creating…"
              : pendingFiles?.length
                ? "Create & ingest"
                : "Create empty"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-2 text-xs text-cinema-muted hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
