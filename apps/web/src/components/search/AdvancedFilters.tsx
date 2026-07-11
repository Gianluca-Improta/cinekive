"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/I18nProvider";
import {
  taxonomyLabel,
  taxonomyMatches,
  techniqueGroupLabel,
} from "@/lib/i18n/taxonomy-labels";

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
  const [techOpen, setTechOpen] = useState(false);
  const [techQuery, setTechQuery] = useState("");

  const { data: taxonomy } = useQuery({
    queryKey: ["taxonomy"],
    queryFn: () => api.getTaxonomy(),
    staleTime: 60 * 60 * 1000,
  });

  const shotTypes = taxonomy?.shot_types ?? [
    "wide",
    "medium",
    "close-up",
    "extreme-close-up",
    "aerial",
    "pov",
    "insert",
  ];
  const compositions = taxonomy?.compositions ?? [
    "rule-of-thirds",
    "centered",
    "symmetry",
    "leading-lines",
    "frame-within-frame",
    "negative-space",
    "golden-ratio",
    "diagonal",
  ];
  const formats = taxonomy?.content_formats ?? [
    "ad",
    "commercial",
    "film",
    "short-film",
    "music-video",
    "fashion",
    "trailer",
  ];
  const emotions = taxonomy?.emotions ?? [
    "melancholic",
    "tense",
    "hopeful",
    "lonely",
    "intimate",
    "serene",
    "nostalgic",
    "dreamy",
  ];

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
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={shotType}
          onChange={(e) => onShotType(e.target.value)}
          className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-cinema-muted outline-none focus:border-cinema-cyan"
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
            className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-cinema-muted outline-none focus:border-cinema-cyan"
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
          className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-cinema-muted outline-none focus:border-cinema-cyan"
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
          className="rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-cinema-muted outline-none focus:border-cinema-cyan"
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
          className={`rounded border px-2 py-1.5 outline-none ${
            technique
              ? "border-cinema-cyan/60 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          }`}
        >
          {technique
            ? t("filters.techniqueLabeled", { name: taxonomyLabel(technique, locale) })
            : t("filters.techniquesEllipsis")}
        </button>
        {technique ? (
          <button
            type="button"
            onClick={() => onTechnique("")}
            className="text-cinema-muted hover:text-white"
          >
            {t("filters.clearTechnique")}
          </button>
        ) : null}
        <input
          value={mood}
          onChange={(e) => onMood(e.target.value)}
          placeholder={t("filters.moodFilterPlaceholder")}
          className="w-36 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan"
        />
        <label className="flex items-center gap-1.5 text-cinema-muted">
          <input
            type="checkbox"
            checked={heroesOnly}
            onChange={(e) => onHeroesOnly(e.target.checked)}
            className="accent-cinema-cyan"
          />
          {t("filters.heroes")}
        </label>
        <label className="flex items-center gap-1.5 text-cinema-muted">
          <input
            type="checkbox"
            checked={movingOnly}
            onChange={(e) => onMovingOnly(e.target.checked)}
            className="accent-cinema-cyan"
          />
          {t("filters.movingGif")}
        </label>
        <label className="flex items-center gap-1.5 text-cinema-muted">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => onFavoritesOnly(e.target.checked)}
            className="accent-cinema-cyan"
          />
          {t("filters.favoritesOnly")}
        </label>
        <label className="flex items-center gap-1.5 text-cinema-muted">
          <input
            type="checkbox"
            checked={hasPreviewOnly}
            onChange={(e) => onHasPreviewOnly(e.target.checked)}
            className="accent-cinema-cyan"
          />
          {t("filters.hasPreview")}
        </label>
        <button
          type="button"
          onClick={onRandomize}
          className="rounded border border-cinema-border px-2 py-1.5 text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
        >
          {t("filters.randomize")}
        </button>
      </div>

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
