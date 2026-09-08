"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Film, Layers, Lock, Sparkles } from "lucide-react";
import { api, artifactUrl } from "@/lib/api-client";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

function relativeUpdated(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 14) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sourceMeta(p: Project): {
  label: string;
  hint: string;
  Icon: typeof Film;
  accent: string;
} {
  const slug = (p.slug || "").toLowerCase();
  const name = (p.name || "").toLowerCase();
  if (slug.includes("filmgrab") || name.includes("filmgrab")) {
    return {
      label: "FilmGrab",
      hint: "Curated film stills by title",
      Icon: Film,
      accent: "text-cinema-cyan",
    };
  }
  if (slug.includes("eyecandy") || name.includes("eyecandy")) {
    return {
      label: "EyeCandy",
      hint: "Technique-tagged motion / GIFs",
      Icon: Layers,
      accent: "text-violet-300",
    };
  }
  if (slug.includes("shotdeck") || name.includes("shotdeck")) {
    return {
      label: "ShotDeck",
      hint: "Searchable HD movie frames",
      Icon: Lock,
      accent: "text-amber-300",
    };
  }
  if (slug.includes("moviestills") || name.includes("moviestills")) {
    return {
      label: "MovieStillsDB",
      hint: "Still database mirror",
      Icon: Film,
      accent: "text-sky-300",
    };
  }
  if (slug.includes("stillslab") || name.includes("stills")) {
    return {
      label: "StillsLab",
      hint: "Production stills mirror",
      Icon: Lock,
      accent: "text-rose-300",
    };
  }
  return {
    label: "Custom",
    hint: p.description?.trim() || "Your still dump",
    Icon: Film,
    accent: "text-cinema-muted",
  };
}

type Props = {
  project: Project;
  /** Drop stills onto the card to ingest into this archive */
  onDropFiles?: (files: File[]) => void;
  dropActive?: boolean;
  selected?: boolean;
  /** Click selects for the details pane (does not navigate) */
  onSelect?: () => void;
  layout?: "card" | "row";
};

export function ArchiveLibraryCard({
  project,
  onDropFiles,
  dropActive,
  selected,
  onSelect,
  layout = "card",
}: Props) {
  const meta = sourceMeta(project);
  const Icon = meta.Icon;
  const title = project.name.replace(/\s*Archive\s*$/i, "") || project.name;
  const [over, setOver] = useState(false);
  const isRow = layout === "row";

  const previews = useQuery({
    queryKey: ["archive-previews", project.id],
    queryFn: () =>
      api.listShots({
        project_id: project.id,
        hide_duplicates: true,
        limit: 6,
      }),
    enabled: project.shot_count > 0,
    staleTime: 120_000,
  });

  const frames = previews.data?.items || [];
  const updated = relativeUpdated(project.updated_at);

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-cinema-surface/60 transition",
        isRow ? "flex flex-row items-stretch" : "flex flex-col",
        over || dropActive
          ? "border-cinema-cyan ring-1 ring-cinema-cyan/40"
          : selected
            ? "border-cinema-cyan/50 ring-1 ring-cinema-cyan/45"
            : "border-cinema-border/70 hover:border-cinema-cyan/40 hover:bg-cinema-surface"
      )}
      onDragOver={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!onDropFiles) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = [...(e.dataTransfer.files || [])];
        if (files.length) onDropFiles(files);
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        className={cn("flex min-w-0 flex-1 text-left", isRow ? "flex-row" : "flex-col")}
      >
        <div
          className={cn(
            "relative overflow-hidden bg-cinema-black",
            isRow ? "aspect-square w-36 shrink-0 sm:w-44" : "aspect-[2.2/1] w-full"
          )}
        >
          {frames.length > 0 ? (
            <div className="absolute inset-0 grid grid-cols-3 gap-px bg-cinema-border/40">
              {frames.slice(0, 6).map((s) => (
                <div key={s.id} className="relative overflow-hidden bg-cinema-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artifactUrl(s.thumb_md_url || s.thumb_url || s.keyframe_url)}
                    alt=""
                    className="h-full w-full object-cover opacity-90 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-100"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-cinema-panel to-cinema-black text-cinema-muted">
              <Icon className={cn("h-7 w-7 opacity-60", meta.accent)} />
              <span className="text-[11px]">
                {project.shot_count === 0 ? "Empty — drop stills here" : "Loading frames…"}
              </span>
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-cinema-black/90 to-transparent" />
          <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded border border-white/10 bg-black/55 px-1.5 py-0.5 text-[10px] uppercase tracking-wide backdrop-blur-sm",
                meta.accent
              )}
            >
              <Icon className="h-3 w-3" />
              {meta.label}
            </span>
            <span className="rounded border border-white/10 bg-black/55 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
              {project.shot_count.toLocaleString()} frames
            </span>
          </div>
          {(over || dropActive) && (
            <div className="absolute inset-0 flex items-center justify-center bg-cinema-cyan/15 text-xs font-medium text-cinema-cyan backdrop-blur-[1px]">
              Drop to add stills
            </div>
          )}
        </div>

        <div
          className={cn(
            "flex flex-1 flex-col gap-2",
            isRow ? "justify-center p-4" : "p-4"
          )}
        >
          <div className="min-w-0">
            <h2 className="truncate text-base font-medium text-white group-hover:text-cinema-cyan">
              {title}
            </h2>
            <p
              className={cn(
                "mt-0.5 text-[11px] leading-snug text-cinema-muted",
                isRow ? "line-clamp-3" : "line-clamp-2"
              )}
            >
              {meta.hint}
              {project.description &&
              project.description !== meta.hint &&
              !project.description.toLowerCase().includes("custom still")
                ? ` · ${project.description}`
                : ""}
            </p>
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cinema-border/50 pt-2 text-[10px] text-cinema-muted">
            {updated ? <span>Updated {updated}</span> : null}
            {project.vlm_enrichment ? (
              <span className="inline-flex items-center gap-0.5 text-cinema-cyan/80">
                <Sparkles className="h-3 w-3" /> Gemi Local AI
              </span>
            ) : (
              <span>Tags manual</span>
            )}
          </div>
        </div>
      </button>
      <div
        className={cn(
          "flex items-center border-cinema-border/50",
          isRow ? "border-l px-3" : "absolute bottom-3 right-3"
        )}
      >
        <Link
          href={`/projects/${project.id}`}
          onClick={(e) => e.stopPropagation()}
          className="rounded border border-cinema-cyan/35 bg-cinema-cyan/10 px-2.5 py-1 text-[11px] text-cinema-cyan hover:bg-cinema-cyan/20"
        >
          Open →
        </Link>
      </div>
    </div>
  );
}
