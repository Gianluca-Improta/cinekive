"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Shuffle, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  taxonomyLabel,
  taxonomyMatches,
  techniqueGroupLabel,
} from "@/lib/i18n/taxonomy-labels";
import { cn } from "@/lib/utils";

type Props = {
  shotType: string;
  composition?: string;
  mood: string;
  contentFormat: string;
  emotion: string;
  technique: string;
  favoritesOnly: boolean;
  hasPreviewOnly: boolean;
  heroesOnly: boolean;
  movingOnly: boolean;
  onShotType: (v: string) => void;
  onComposition?: (v: string) => void;
  onMood: (v: string) => void;
  onContentFormat: (v: string) => void;
  onEmotion: (v: string) => void;
  onTechnique: (v: string) => void;
  onFavoritesOnly: (v: boolean) => void;
  onHasPreviewOnly: (v: boolean) => void;
  onHeroesOnly: (v: boolean) => void;
  onMovingOnly: (v: boolean) => void;
  onRandomize: () => void;
};

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] transition",
        active
          ? "border-cinema-cyan/50 bg-cinema-cyan/15 text-cinema-cyan"
          : "border-cinema-border/70 text-cinema-muted hover:border-cinema-cyan/35 hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

/** Compact quick filters — taxonomy depth lives in Dial-in; this is only browse toggles. */
export function AdvancedFilters({
  shotType,
  composition = "",
  mood,
  contentFormat,
  emotion,
  technique,
  favoritesOnly,
  hasPreviewOnly,
  heroesOnly,
  movingOnly,
  onShotType,
  onComposition,
  onMood,
  onContentFormat,
  onEmotion,
  onTechnique,
  onFavoritesOnly,
  onHasPreviewOnly,
  onHeroesOnly,
  onMovingOnly,
  onRandomize,
}: Props) {
  const { t, locale } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [techQuery, setTechQuery] = useState("");

  const { data: taxonomy } = useQuery({
    queryKey: ["taxonomy"],
    queryFn: () => api.getTaxonomy(),
    staleTime: 60 * 60 * 1000,
  });

  const shotTypes = taxonomy?.shot_types ?? [];
  const compositions = taxonomy?.compositions ?? [];
  const formats = taxonomy?.content_formats ?? [];
  const emotions = taxonomy?.emotions ?? [];

  const moreCount = [
    shotType,
    composition,
    contentFormat,
    emotion,
    technique,
    mood,
    hasPreviewOnly,
  ].filter(Boolean).length;

  const filteredGroups = useMemo(() => {
    const groups = taxonomy?.technique_groups ?? {};
    const q = techQuery.trim().toLowerCase();
    if (!q) return groups;
    const out: Record<string, string[]> = {};
    for (const [group, items] of Object.entries(groups)) {
      const hit = items.filter((slug) => taxonomyMatches(slug, q, locale));
      if (hit.length) out[group] = hit;
    }
    return out;
  }, [taxonomy, techQuery, locale]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill active={heroesOnly} onClick={() => onHeroesOnly(!heroesOnly)}>
          {t("filters.heroes")}
        </Pill>
        <Pill active={movingOnly} onClick={() => onMovingOnly(!movingOnly)}>
          {t("filters.movingGif")}
        </Pill>
        <Pill active={favoritesOnly} onClick={() => onFavoritesOnly(!favoritesOnly)}>
          {t("filters.favoritesOnly")}
        </Pill>
        <button
          type="button"
          onClick={onRandomize}
          className="inline-flex items-center gap-1 rounded-full border border-cinema-border/70 px-2.5 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/35 hover:text-white"
          title={t("filters.randomize")}
        >
          <Shuffle className="h-3 w-3" />
          {t("filters.randomize")}
        </button>
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition",
            moreOpen || moreCount
              ? "border-cinema-cyan/50 bg-cinema-cyan/10 text-cinema-cyan"
              : "border-cinema-border/70 text-cinema-muted hover:border-cinema-cyan/35 hover:text-white"
          )}
        >
          <SlidersHorizontal className="h-3 w-3" />
          More filters
          {moreCount ? ` · ${moreCount}` : ""}
          <ChevronDown className={cn("h-3 w-3 transition", moreOpen && "rotate-180")} />
        </button>
      </div>

      {moreOpen ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-cinema-border/60 bg-cinema-black/40 px-3 py-2.5">
          <select
            value={shotType}
            onChange={(e) => onShotType(e.target.value)}
            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-[11px] text-cinema-muted outline-none focus:border-cinema-cyan"
          >
            <option value="">{t("filters.allShotTypes")}</option>
            {shotTypes.map((slug) => (
              <option key={slug} value={slug}>
                {taxonomyLabel(slug, locale)}
              </option>
            ))}
          </select>
          {onComposition ? (
            <select
              value={composition}
              onChange={(e) => onComposition(e.target.value)}
              className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-[11px] text-cinema-muted outline-none focus:border-cinema-cyan"
            >
              <option value="">{t("filters.allCompositions")}</option>
              {compositions.map((slug) => (
                <option key={slug} value={slug}>
                  {taxonomyLabel(slug, locale)}
                </option>
              ))}
            </select>
          ) : null}
          <select
            value={contentFormat}
            onChange={(e) => onContentFormat(e.target.value)}
            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-[11px] text-cinema-muted outline-none focus:border-cinema-cyan"
          >
            <option value="">{t("filters.allFormats")}</option>
            {formats.map((slug) => (
              <option key={slug} value={slug}>
                {taxonomyLabel(slug, locale)}
              </option>
            ))}
          </select>
          <select
            value={emotion}
            onChange={(e) => onEmotion(e.target.value)}
            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-[11px] text-cinema-muted outline-none focus:border-cinema-cyan"
          >
            <option value="">{t("filters.allEmotions")}</option>
            {emotions.map((slug) => (
              <option key={slug} value={slug}>
                {taxonomyLabel(slug, locale)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setTechOpen((o) => !o)}
            className={cn(
              "rounded border px-2 py-1.5 text-[11px]",
              technique
                ? "border-cinema-cyan/60 text-cinema-cyan"
                : "border-cinema-border text-cinema-muted hover:text-cinema-cyan"
            )}
          >
            {technique
              ? t("filters.techniqueLabeled", { name: taxonomyLabel(technique, locale) })
              : t("filters.techniquesEllipsis")}
          </button>
          <input
            value={mood}
            onChange={(e) => onMood(e.target.value)}
            placeholder={t("filters.moodFilterPlaceholder")}
            className="w-32 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-[11px] text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan"
          />
          <Pill active={hasPreviewOnly} onClick={() => onHasPreviewOnly(!hasPreviewOnly)}>
            {t("filters.hasPreview")}
          </Pill>
          {technique ? (
            <button
              type="button"
              onClick={() => onTechnique("")}
              className="text-[11px] text-cinema-muted hover:text-white"
            >
              {t("filters.clearTechnique")}
            </button>
          ) : null}
        </div>
      ) : null}

      {techOpen ? (
        <div className="rounded border border-cinema-border bg-cinema-black/80 p-3">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={techQuery}
              onChange={(e) => setTechQuery(e.target.value)}
              placeholder={t("filters.searchTechniques")}
              className="min-w-[240px] flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan"
            />
            <span className="text-[10px] text-cinema-muted">
              {t("filters.techniquesCount", { n: taxonomy?.techniques?.length ?? 0 })}
            </span>
          </div>
          <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
            {Object.entries(filteredGroups).map(([group, items]) => (
              <div key={group}>
                <p className="mb-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                  {techniqueGroupLabel(group, locale)}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {items.map((slug) => {
                    const active = technique === slug;
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => {
                          onTechnique(active ? "" : slug);
                          if (!active) setTechOpen(false);
                        }}
                        className={`rounded border px-2 py-0.5 text-[11px] transition ${
                          active
                            ? "border-cinema-cyan bg-cinema-cyan/10 text-cinema-cyan"
                            : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
                        }`}
                      >
                        {taxonomyLabel(slug, locale)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {!Object.keys(filteredGroups).length ? (
              <p className="text-xs text-cinema-muted">{t("filters.noTechniquesMatch")}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
