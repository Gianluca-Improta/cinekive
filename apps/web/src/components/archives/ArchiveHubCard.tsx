"use client";

import { Crown, ExternalLink, Film, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  badge?: string;
  previewUrls: string[];
  /** Offline PD stills shipped in the installer, used when a remote preview 404s */
  bundledUrls?: string[];
  /** Previews are illustrative (not from the local mirror yet) */
  illustrative?: boolean;
  locked?: boolean;
  selected?: boolean;
  accentClass?: string;
  onClick?: () => void;
  footer?: React.ReactNode;
  /** denser row for details view */
  layout?: "card" | "row";
};

/** Shared collage card for mirrors + curated sources on Archive of Archives. */
export function ArchiveHubCard({
  title,
  subtitle,
  badge,
  previewUrls,
  bundledUrls,
  illustrative,
  locked,
  selected,
  accentClass,
  onClick,
  footer,
  layout = "card",
}: Props) {
  const frames = [...previewUrls].slice(0, 6);
  while (frames.length < 6) frames.push("");
  const isRow = layout === "row";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked && !onClick}
      className={cn(
        "group relative overflow-hidden rounded-xl border text-left transition",
        isRow ? "flex flex-row items-stretch" : "flex flex-col",
        locked
          ? "border-amber-400/35 bg-cinema-surface/40"
          : accentClass || "border-cinema-border/70 bg-cinema-surface/50 hover:border-cinema-cyan/40",
        selected && "ring-1 ring-cinema-cyan/55",
        locked && "cursor-pointer"
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden bg-cinema-black",
          isRow ? "aspect-square w-36 shrink-0 sm:w-44" : "aspect-[2.2/1]"
        )}
      >
        <div className="absolute inset-0 grid grid-cols-3 gap-px bg-cinema-border/40">
          {frames.map((src, i) => (
            <div key={i} className="relative overflow-hidden bg-cinema-panel/80">
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  className={cn(
                    "h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]",
                    locked && "opacity-40 grayscale"
                  )}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    // Remote preview unreachable (offline / hotlink blocked):
                    // swap once to a bundled PD still instead of an empty tile.
                    const img = e.target as HTMLImageElement;
                    const fallback = bundledUrls?.[i % (bundledUrls.length || 1)];
                    if (fallback && img.dataset.fellBack !== "1") {
                      img.dataset.fellBack = "1";
                      img.src = fallback;
                      return;
                    }
                    img.style.opacity = "0";
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center bg-gradient-to-br from-cinema-panel to-cinema-black">
                  <Film className="h-4 w-4 text-cinema-muted/40" />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-cinema-black/90 to-transparent" />
        <div className="absolute bottom-2 left-3 right-3 flex items-end justify-between gap-2">
          {badge ? (
            <span className="rounded border border-white/10 bg-black/55 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/80 backdrop-blur-sm">
              {badge}
            </span>
          ) : (
            <span />
          )}
          {locked ? (
            <span className="inline-flex items-center gap-1 rounded border border-amber-400/40 bg-black/60 px-1.5 py-0.5 text-[10px] uppercase text-amber-200 backdrop-blur-sm">
              <Lock className="h-3 w-3" /> Pro
            </span>
          ) : null}
        </div>
        {locked && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/45 text-center backdrop-blur-[1px]">
            <Crown className="h-5 w-5 text-cinema-cyan" />
            <span className="text-[11px] font-medium text-white">Pro to unlock</span>
          </div>
        )}
      </div>
      <div className={cn("flex flex-1 flex-col gap-1", isRow ? "justify-center p-4" : "p-3")}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-medium text-white group-hover:text-cinema-cyan">
            {title}
          </h3>
          {!locked && badge === "source" ? (
            <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-cinema-muted opacity-60" />
          ) : null}
        </div>
        {subtitle ? (
          <p
            className={cn(
              "text-[11px] leading-snug text-cinema-muted",
              isRow ? "line-clamp-3" : "line-clamp-2"
            )}
          >
            {subtitle}
          </p>
        ) : null}
        {illustrative ? (
          <span className="text-[10px] text-cinema-muted/80">Sample look · pull for real frames</span>
        ) : null}
        {footer}
      </div>
    </button>
  );
}
