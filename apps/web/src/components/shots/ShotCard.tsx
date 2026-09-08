"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, Star, X } from "lucide-react";
import type { Shot } from "@/lib/types";
import { api, artifactUrl } from "@/lib/api-client";
import { shotArtifactFilename } from "@/lib/download";
import { formatTimecode } from "@/lib/utils";
import { AddToProjectMenu } from "@/components/shots/AddToProjectMenu";
import { ArtifactDownloadButton } from "@/components/shots/ArtifactDownloadButton";
import { applyShotDragData, prefetchShotDragFile } from "@/lib/shot-drag";

type Props = {
  shot: Shot;
  onClick: (e: MouseEvent) => void;
  onDoubleClick?: (e: MouseEvent) => void;
  selected?: boolean;
  onDelete?: (shot: Shot) => void;
  onColorClick?: (hex: string) => void;
  showAddTo?: boolean;
};

/** Cursor dwell before a preview auto-plays — long enough to ignore pass-through motion. */
const HOVER_PLAY_DELAY_MS = 1000;

function isVideoUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() || "";
  return path.endsWith(".mp4") || path.endsWith(".webm") || path.endsWith(".mov");
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
  /** User pinned preview via play — survives mouse leave */
  const [pinned, setPinned] = useState(false);
  /** After pause while hovering, don't auto-resume until mouse leaves */
  const [hoverMuted, setHoverMuted] = useState(false);
  /** Dwell-triggered playback: only after the cursor rests, so scrubbing the grid stays calm */
  const [hoverPlay, setHoverPlay] = useState(false);
  const [fav, setFav] = useState(shot.is_favorite);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragFileRef = useRef<File | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumb = artifactUrl(shot.thumb_md_url || shot.thumb_url);
  const preview = shot.preview_url ? artifactUrl(shot.preview_url) : null;
  const videoPreview = Boolean(preview && isVideoUrl(preview));
  const showLoop = Boolean(preview && (pinned || (hoverPlay && !hoverMuted)));

  useEffect(() => {
    setFav(shot.is_favorite);
  }, [shot.is_favorite, shot.id]);

  useEffect(() => {
    setPinned(false);
    setHoverMuted(false);
    setHoverPlay(false);
    dragFileRef.current = null;
  }, [shot.id]);

  // Clear any pending dwell timer on unmount so a scrolled-away card can't start playing
  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  // Mount / pin: ensure video actually plays (ref may be null on first paint)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !videoPreview || !showLoop) return;
    if (pinned || (hoverPlay && !hoverMuted)) {
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [showLoop, pinned, hoverPlay, hoverMuted, videoPreview, preview]);

  const favMutation = useMutation({
    mutationFn: (is_favorite: boolean) => api.updateShot(shot.id, { is_favorite }),
    onMutate: (is_favorite) => setFav(is_favorite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
    onError: () => setFav(shot.is_favorite),
  });

  const togglePlayback = () => {
    if (!preview) return;
    if (pinned || hoverPlay) {
      setPinned(false);
      setHoverPlay(false);
      setHoverMuted(true);
      videoRef.current?.pause();
    } else {
      setPinned(true);
      setHoverMuted(false);
      void videoRef.current?.play().catch(() => {});
    }
  };

  const togglePlay = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    togglePlayback();
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      draggable
      title="Drag to PowerPoint, Finder, or Explorer"
      onDragStart={(e) => {
        applyShotDragData(e, shot, dragFileRef.current);
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        // Space = play/pause the preview; Enter stays "open".
        if (e.key === " " || e.key === "Spacebar") {
          if (preview) {
            e.preventDefault();
            e.stopPropagation();
            togglePlayback();
            return;
          }
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onClick(e as unknown as MouseEvent);
        }
      }}
      onMouseEnter={() => {
        if (preview && !hoverMuted) {
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          hoverTimer.current = setTimeout(() => setHoverPlay(true), HOVER_PLAY_DELAY_MS);
        }
        void prefetchShotDragFile(shot).then((f) => {
          dragFileRef.current = f;
        });
      }}
      onMouseLeave={() => {
        setHoverMuted(false);
        if (hoverTimer.current) {
          clearTimeout(hoverTimer.current);
          hoverTimer.current = null;
        }
        setHoverPlay(false);
        if (!pinned && videoRef.current) videoRef.current.pause();
      }}
      className={`group relative h-full w-full cursor-pointer overflow-hidden rounded-md border bg-cinema-panel text-left transition hover:border-cinema-cyan/40 hover:shadow-glow ${
        selected ? "border-cinema-cyan shadow-glow" : "border-cinema-border"
      }`}
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
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white/80">
          gif
        </span>
      )}
      {fav && (
        <Star className="absolute left-2 top-2 h-3.5 w-3.5 fill-cinema-cyan text-cinema-cyan" />
      )}

      {preview && (
        <button
          type="button"
          title={showLoop ? "Pause preview (space)" : "Play preview (space)"}
          aria-label={showLoop ? "Pause preview" : "Play preview"}
          onClick={togglePlay}
          className={`absolute bottom-2 right-2 z-10 rounded border border-cinema-border bg-black/75 p-1.5 text-white opacity-0 transition hover:border-cinema-cyan/50 hover:text-cinema-cyan group-hover:opacity-100 ${
            showLoop ? "opacity-100 border-cinema-cyan/50 text-cinema-cyan" : ""
          }`}
        >
          {showLoop ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
        </button>
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
          <ArtifactDownloadButton
            url={preview}
            filename={shotArtifactFilename(shot, "loop", preview)}
            iconOnly
            title="Download loop / GIF"
            className="rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          />
        )}
        <ArtifactDownloadButton
          url={artifactUrl(shot.keyframe_url)}
          filename={shotArtifactFilename(shot, "frame")}
          iconOnly
          title="Download hero frame (JPG)"
          className="rounded border border-cinema-border bg-black/75 p-1 text-white hover:border-cinema-cyan/50 hover:text-cinema-cyan"
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
        <div className="flex items-center justify-between gap-2 pr-10">
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
    </div>
  );
}
