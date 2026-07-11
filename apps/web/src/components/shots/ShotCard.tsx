"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, Star, X } from "lucide-react";
import type { Shot } from "@/lib/types";
import { api, artifactUrl } from "@/lib/api-client";
import { formatTimecode } from "@/lib/utils";
import { AddToProjectMenu } from "@/components/shots/AddToProjectMenu";

type Props = {
  shot: Shot;
  onClick: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
  selected?: boolean;
  onDelete?: (shot: Shot) => void;
  onColorClick?: (hex: string) => void;
  showAddTo?: boolean;
};

function isVideoUrl(url: string): boolean {
  return url.endsWith(".mp4") || url.endsWith(".webm");
}

function downloadName(shot: Shot): string {
  const base = (shot.source_title || shot.source_filename || "hero-frame")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
  const role = shot.frame_role && shot.frame_role !== "mid" ? `-${shot.frame_role}` : "";
  return `${base}${role}.jpg`;
}

export function ShotCard({
  shot,
  onClick,
  onDoubleClick,
  selected,
  onDelete,
  onColorClick,
  showAddTo = true,
}: Props) {
  const qc = useQueryClient();
  const [hover, setHover] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fav, setFav] = useState(shot.is_favorite);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLButtonElement>(null);
  const thumb = artifactUrl(shot.thumb_md_url || shot.thumb_url);
  const preview = shot.preview_url ? artifactUrl(shot.preview_url) : null;
  const videoPreview = Boolean(preview && isVideoUrl(preview));
  const showLoop = Boolean(preview && (playing || hover));
  const highScore = (shot.hero_score || 0) >= 0.78;

  useEffect(() => {
    setFav(shot.is_favorite);
  }, [shot.is_favorite, shot.id]);

  const favMutation = useMutation({
    mutationFn: (is_favorite: boolean) => api.updateShot(shot.id, { is_favorite }),
    onMutate: (is_favorite) => setFav(is_favorite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
    onError: () => setFav(shot.is_favorite),
  });

  const togglePlay = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!preview) return;
    if (videoPreview && videoRef.current) {
      if (playing) {
        videoRef.current.pause();
        setPlaying(false);
      } else {
        void videoRef.current.play();
        setPlaying(true);
      }
      return;
    }
    setPlaying((p) => !p);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        if (!playing && videoRef.current) videoRef.current.pause();
      }}
      className={`group relative w-full overflow-hidden rounded-md border bg-cinema-panel text-left transition hover:border-cinema-cyan/40 hover:shadow-glow ${
        selected ? "border-cinema-cyan shadow-glow" : "border-cinema-border"
      } ${highScore ? "ring-1 ring-cinema-cyan/30" : ""}`}
      style={{ aspectRatio: `${shot.width || 3} / ${shot.height || 2}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={thumb}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover transition-opacity"
        style={{ opacity: showLoop ? 0 : 1 }}
      />

      {preview &&
        showLoop &&
        (videoPreview ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            ref={videoRef}
            src={preview}
            autoPlay={playing || hover}
            loop
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ))}

      {shot.is_moving && !showLoop && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/80">
          gif
        </span>
      )}
      {fav && (
        <Star className="absolute left-2 top-2 h-3.5 w-3.5 fill-cinema-cyan text-cinema-cyan" />
      )}
      {shot.is_hero && !fav && (
        <span className="absolute left-2 top-2 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-cinema-cyan">
          hero
        </span>
      )}
      {highScore && (
        <span className="absolute bottom-2 left-2 rounded bg-cinema-cyan/20 px-1 py-0.5 font-mono text-[9px] text-cinema-cyan opacity-0 transition group-hover:opacity-100">
          {shot.hero_score.toFixed(2)}
        </span>
      )}

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
        <span
          role="button"
          tabIndex={0}
          title={fav ? "Unstar" : "Star / favorite"}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            favMutation.mutate(!fav);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              favMutation.mutate(!fav);
            }
          }}
          className="rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
        >
          <Star className={`h-3.5 w-3.5 ${fav ? "fill-cinema-cyan text-cinema-cyan" : ""}`} />
        </span>
        {showAddTo && (
          <AddToProjectMenu shotIds={[shot.id]} excludeProjectId={shot.project_id} />
        )}
        {onDelete && (
          <span
            role="button"
            tabIndex={0}
            title="Move to bin"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onDelete(shot);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onDelete(shot);
              }
            }}
            className="rounded border border-cinema-border bg-black/75 p-1 text-cinema-muted hover:border-cinema-magenta/60 hover:text-cinema-magenta"
          >
            <X className="h-3.5 w-3.5" />
          </span>
        )}
        {preview && (
          <span
            role="button"
            tabIndex={0}
            title={playing ? "Pause preview" : "Play preview"}
            onClick={togglePlay}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePlay(e as unknown as MouseEvent);
              }
            }}
            className="rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </span>
        )}
        <a
          href={artifactUrl(shot.keyframe_url)}
          download={downloadName(shot)}
          onClick={(e) => e.stopPropagation()}
          className="rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          title="Download hero frame (JPG)"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[10px] text-cinema-muted">
            {(shot.techniques && shot.techniques[0]) ||
              shot.theme ||
              shot.shot_type ||
              formatTimecode(shot.start_timecode_ms)}
            {shot.is_moving ? " · moving" : ""}
          </span>
          <div className="pointer-events-auto flex gap-1">
            {shot.dominant_colors.slice(0, 4).map((c) => (
              <span
                key={c.hex}
                role="button"
                tabIndex={0}
                title={`Find ${c.hex}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onColorClick?.(c.hex);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    onColorClick?.(c.hex);
                  }
                }}
                className="h-2.5 w-2.5 cursor-pointer rounded-sm border border-white/20 hover:scale-125"
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>
        </div>
      </div>
    </button>
  );
}
