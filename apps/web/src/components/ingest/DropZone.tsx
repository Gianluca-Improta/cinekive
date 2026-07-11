"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { FolderOpen, Link2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  onFiles?: (files: File[], kind: "video" | "image") => void;
  onImportUrl?: (url: string) => void | Promise<void>;
  disabled?: boolean;
  /** Compact strip for panels / headers (default true). */
  compact?: boolean;
  className?: string;
};

const VIDEO_EXTS = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"];

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (ok: (f: File) => void, err?: (e: Error) => void) => void;
  createReader?: () => {
    readEntries: (ok: (entries: FsEntry[]) => void, err?: (e: Error) => void) => void;
  };
};

function withRelativeNames(files: File[]): File[] {
  return files.map((f) => {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (rel && (rel.includes("/") || rel.includes("\\"))) {
      return new File([f], rel.replace(/\\/g, "/"), {
        type: f.type,
        lastModified: f.lastModified,
      });
    }
    return f;
  });
}

function extOf(name: string): string {
  const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  const i = base.lastIndexOf(".");
  return i >= 0 ? base.slice(i).toLowerCase() : "";
}

function classify(files: File[]): { videos: File[]; images: File[] } {
  const videos: File[] = [];
  const images: File[] = [];
  for (const f of files) {
    const ext = extOf(f.name);
    if (VIDEO_EXTS.includes(ext) || f.type.startsWith("video/")) videos.push(f);
    else if (
      IMAGE_EXTS.includes(ext) ||
      f.type.startsWith("image/") ||
      f.type === "image/gif"
    ) {
      images.push(f);
    }
  }
  return { videos, images };
}

function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

function readAllEntries(reader: {
  readEntries: (ok: (entries: FsEntry[]) => void, err?: (e: Error) => void) => void;
}): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (!batch.length) {
          resolve(all);
          return;
        }
        all.push(...batch);
        pump();
      }, reject);
    };
    pump();
  });
}

async function walkEntry(entry: FsEntry, prefix = ""): Promise<File[]> {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    return new Promise((resolve, reject) => {
      entry.file?.(
        (f) => {
          const named =
            rel.includes("/") || rel.includes("\\")
              ? new File([f], rel.replace(/\\/g, "/"), {
                  type: f.type,
                  lastModified: f.lastModified,
                })
              : f;
          resolve([named]);
        },
        (e) => reject(e)
      );
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const kids = await readAllEntries(entry.createReader());
    const nested = await Promise.all(kids.map((k) => walkEntry(k, rel)));
    return nested.flat();
  }
  return [];
}

async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries: FsEntry[] = [];
  for (const item of [...dt.items]) {
    if (item.kind !== "file") continue;
    const entry = (
      item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }
    ).webkitGetAsEntry?.();
    if (entry) entries.push(entry);
  }
  if (entries.length) {
    const nested = await Promise.all(entries.map((e) => walkEntry(e)));
    return nested.flat();
  }
  return [...dt.files];
}

export function DropZone({
  onFiles,
  onImportUrl,
  disabled,
  compact = true,
  className,
}: Props) {
  const { t } = useI18n();
  const [over, setOver] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [urlBusy, setUrlBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const emit = useCallback(
    (files: File[]) => {
      if (!files.length || disabled || !onFiles) return;
      const named = withRelativeNames(files);
      const { videos, images } = classify(named);
      const total = videos.length + images.length;
      if (!total) {
        setStatus("No videos, stills, or GIFs found");
        return;
      }
      setStatus(
        `Queued ${total}` +
          (videos.length && images.length
            ? ` (${videos.length} video · ${images.length} still)`
            : "")
      );
      if (videos.length) onFiles(videos, "video");
      if (images.length) onFiles(images, "image");
    },
    [disabled, onFiles]
  );

  const submitUrl = useCallback(async () => {
    const u = url.trim();
    if (!u || !onImportUrl || disabled) return;
    if (!looksLikeUrl(u)) {
      setStatus("Paste a full http(s) URL");
      return;
    }
    setUrlBusy(true);
    setStatus("Downloading…");
    try {
      await onImportUrl(u);
      setUrl("");
      setStatus("Queued — check Activity");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Download failed");
    } finally {
      setUrlBusy(false);
    }
  }, [url, onImportUrl, disabled]);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setOver(false);
      if (disabled) return;

      const text =
        e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
      if (text && looksLikeUrl(text) && onImportUrl) {
        setStatus("Downloading…");
        setUrlBusy(true);
        try {
          await onImportUrl(text.trim().split(/\s+/)[0]);
          setStatus("Queued — check Activity");
        } catch (err) {
          setStatus(err instanceof Error ? err.message : "Download failed");
        } finally {
          setUrlBusy(false);
        }
        return;
      }

      setStatus("Reading…");
      try {
        const files = await filesFromDataTransfer(e.dataTransfer);
        emit(files);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Drop failed");
      }
    },
    [disabled, emit, onImportUrl]
  );

  if (compact) {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "rounded-md border border-dashed px-3 py-2.5 transition",
          over
            ? "border-cinema-cyan bg-cinema-cyan/5"
            : "border-cinema-border bg-cinema-black/40 hover:border-cinema-cyan/40",
          disabled && "pointer-events-none opacity-50",
          className
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Upload
            className={cn("h-3.5 w-3.5 shrink-0", over ? "text-cinema-cyan" : "text-cinema-muted")}
          />
          <span className="text-[11px] text-cinema-muted">
            {onFiles ? "Drop files / folders" : "Drop or paste URL"}
          </span>
          {onFiles && (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
                className="rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
              >
                Files
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => folderRef.current?.click()}
                className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
              >
                <FolderOpen className="h-3 w-3" />
                Folder
              </button>
            </>
          )}
          {status && (
            <span className="ml-auto truncate text-[10px] text-cinema-cyan">{status}</span>
          )}
        </div>

        {onImportUrl && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-cinema-muted" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitUrl();
                }}
                placeholder={t("ingest.pasteUrl")}
                disabled={disabled || urlBusy}
                className="w-full rounded border border-cinema-border bg-cinema-black py-1 pl-6 pr-2 text-[11px] text-white outline-none focus:border-cinema-cyan"
              />
            </div>
            <button
              type="button"
              disabled={disabled || urlBusy || !url.trim()}
              onClick={() => void submitUrl()}
              className="shrink-0 rounded border border-cinema-cyan/40 px-2 py-1 text-[11px] text-cinema-cyan hover:bg-cinema-cyan/10 disabled:opacity-40"
            >
              {urlBusy ? "…" : "Go"}
            </button>
          </div>
        )}

        {onFiles && (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={[...VIDEO_EXTS, ...IMAGE_EXTS, "image/gif"].join(",")}
              className="hidden"
              disabled={disabled}
              onChange={(e) => {
                emit(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              disabled={disabled}
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              onChange={(e) => {
                emit(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>
    );
  }

  // Legacy roomy layout (archives create flow)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-5 transition",
        over
          ? "border-cinema-cyan bg-cinema-cyan/5 shadow-glow"
          : "border-cinema-border bg-cinema-panel/50 hover:border-cinema-cyan/40",
        disabled && "pointer-events-none opacity-50",
        className
      )}
    >
      <Upload className="h-5 w-5 text-cinema-cyan" />
      <div className="text-sm text-white">
        {onFiles ? "Drop files, folders, or a URL" : "Paste or drop a URL"}
      </div>
      <div className="max-w-md text-center text-[11px] text-cinema-muted">
        Stills folders keep path titles. Videos · GIFs · any yt-dlp URL (YouTube, Vimeo, TikTok, Instagram, direct links…).
      </div>
      {status && <div className="text-[11px] text-cinema-cyan">{status}</div>}

      {onImportUrl && (
        <div className="mt-1 flex w-full max-w-xl flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cinema-muted" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitUrl();
              }}
              placeholder={t("ingest.pasteUrl")}
              disabled={disabled || urlBusy}
              className="w-full rounded border border-cinema-border bg-cinema-black py-1.5 pl-7 pr-2 text-xs text-white outline-none focus:border-cinema-cyan"
            />
          </div>
          <button
            type="button"
            disabled={disabled || urlBusy || !url.trim()}
            onClick={() => void submitUrl()}
            className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-40"
          >
            {urlBusy ? "Fetching…" : "Download"}
          </button>
        </div>
      )}

      {onFiles && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileRef.current?.click()}
            className="rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
          >
            Choose files
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => folderRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose folder
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={[...VIDEO_EXTS, ...IMAGE_EXTS, "image/gif"].join(",")}
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              emit(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            className="hidden"
            disabled={disabled}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            onChange={(e) => {
              emit(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
