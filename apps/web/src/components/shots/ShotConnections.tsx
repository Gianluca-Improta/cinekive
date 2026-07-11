"use client";

import { useQuery } from "@tanstack/react-query";
import { GitBranch, Palette, Film, Aperture, Clapperboard, Landmark } from "lucide-react";
import type { ReactNode } from "react";
import { api, artifactUrl } from "@/lib/api-client";
import type { Shot } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  shot: Shot;
  onSelect: (shot: Shot) => void;
};

function ConnectionRow({
  title,
  icon,
  items,
  loading,
  empty,
  onSelect,
}: {
  title: string;
  icon: ReactNode;
  items: { shot: Shot; score: number }[];
  loading?: boolean;
  empty?: string;
  onSelect: (shot: Shot) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
        {icon}
        {title}
        {!loading && items.length > 0 && (
          <span className="normal-case tracking-normal text-cinema-muted/70">
            · {items.length}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex gap-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 w-24 shrink-0 animate-pulse rounded border border-cinema-border bg-cinema-panel"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="text-[11px] text-cinema-muted">{empty || "Nothing close yet"}</p>
      ) : (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {items.map(({ shot, score }) => (
            <button
              key={shot.id}
              type="button"
              title={`${shot.source_title || shot.source_filename || "Shot"} · ${(score * 100).toFixed(0)}%`}
              onClick={() => onSelect(shot)}
              className="group relative h-16 w-24 shrink-0 overflow-hidden rounded border border-cinema-border bg-cinema-panel transition hover:border-cinema-cyan/60 hover:shadow-glow"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={artifactUrl(shot.thumb_md_url || shot.thumb_url)}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 font-mono text-[9px] text-cinema-cyan opacity-0 transition group-hover:opacity-100">
                {(score * 100).toFixed(0)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function directorOf(shot: Shot): string {
  const d = shot.director || (shot.source_meta?.director as string | undefined);
  return typeof d === "string" ? d.trim() : "";
}

export function ShotConnections({ shot, onSelect }: Props) {
  const { t } = useI18n();
  const director = directorOf(shot);

  const similar = useQuery({
    queryKey: ["similar", shot.id],
    queryFn: () => api.searchSimilar({ shot_id: shot.id, limit: 14 }),
    staleTime: 60_000,
  });

  const palette = useQuery({
    queryKey: ["palette-conn", shot.id],
    queryFn: () => api.searchPalette({ shot_id: shot.id, limit: 12 }),
    staleTime: 60_000,
  });

  const sameSource = useQuery({
    queryKey: ["same-source", shot.id],
    queryFn: () => api.searchSameSource({ shot_id: shot.id, limit: 16 }),
    staleTime: 60_000,
    enabled: Boolean(shot.source_title),
  });

  const craft = useQuery({
    queryKey: ["craft-conn", shot.id],
    queryFn: () => api.searchCraft({ shot_id: shot.id, limit: 12 }),
    staleTime: 60_000,
    enabled: Boolean(
      shot.composition || shot.lighting_style || shot.emotion || shot.visual_style
    ),
  });

  const sameDirector = useQuery({
    queryKey: ["same-director", director],
    queryFn: () =>
      api.search({
        director,
        limit: 16,
        group_sequences: true,
      }),
    staleTime: 60_000,
    enabled: Boolean(director),
  });

  const sameIsm = useQuery({
    queryKey: ["same-ism", shot.ism],
    queryFn: () =>
      api.search({
        ism: shot.ism || undefined,
        limit: 16,
        group_sequences: true,
      }),
    staleTime: 60_000,
    enabled: Boolean(shot.ism && shot.ism !== "other"),
  });

  const directorItems = (sameDirector.data?.results ?? [])
    .filter((r) => r.shot.id !== shot.id)
    .slice(0, 14);
  const ismItems = (sameIsm.data?.results ?? [])
    .filter((r) => r.shot.id !== shot.id)
    .slice(0, 14);

  return (
    <section className="space-y-4 rounded-lg border border-cinema-border/80 bg-cinema-panel/40 p-3">
      <div>
        <h3 className="text-[10px] uppercase tracking-widest text-cinema-muted">
          {t("detail.connections")}
        </h3>
        <p className="mt-0.5 text-[11px] text-cinema-muted/80">{t("detail.connectionsHint")}</p>
      </div>

      <ConnectionRow
        title={t("detail.looksLike")}
        icon={<GitBranch className="h-3 w-3" />}
        items={similar.data?.results ?? []}
        loading={similar.isFetching}
        empty={t("connections.noVisual")}
        onSelect={onSelect}
      />

      <ConnectionRow
        title={t("detail.sameCraft")}
        icon={<Aperture className="h-3 w-3" />}
        items={craft.data?.results ?? []}
        loading={craft.isFetching}
        empty={t("connections.noCraft")}
        onSelect={onSelect}
      />

      {director ? (
        <ConnectionRow
          title={`Same director · ${director}`}
          icon={<Clapperboard className="h-3 w-3" />}
          items={directorItems}
          loading={sameDirector.isFetching}
          empty="No other frames from this director yet"
          onSelect={onSelect}
        />
      ) : null}

      {shot.ism && shot.ism !== "other" ? (
        <ConnectionRow
          title={`Same ism · ${shot.ism.replace(/-/g, " ")}`}
          icon={<Landmark className="h-3 w-3" />}
          items={ismItems}
          loading={sameIsm.isFetching}
          empty="No other frames in this movement yet"
          onSelect={onSelect}
        />
      ) : null}

      <ConnectionRow
        title={t("detail.samePalette")}
        icon={<Palette className="h-3 w-3" />}
        items={palette.data?.results ?? []}
        loading={palette.isFetching}
        empty={t("connections.noPalette")}
        onSelect={onSelect}
      />

      <ConnectionRow
        title={t("detail.sameFilm")}
        icon={<Film className="h-3 w-3" />}
        items={sameSource.data?.results ?? []}
        loading={sameSource.isFetching}
        empty={t("connections.noFilm")}
        onSelect={onSelect}
      />
    </section>
  );
}
