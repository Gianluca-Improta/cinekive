"use client";

import { useEffect, useRef, useState } from "react";
import {
  X,
  Download,
  Star,
  DownloadCloud,
  Pause,
  Play,
  PanelRight,
  Maximize2,
  Filter,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Shot } from "@/lib/types";
import { api, artifactUrl } from "@/lib/api-client";
import { formatTimecode } from "@/lib/utils";
import { AddToProjectMenu } from "@/components/shots/AddToProjectMenu";
import { SendToBoardMenu } from "@/components/shots/SendToBoardMenu";
import { ShotConnections } from "@/components/shots/ShotConnections";
import { TranslatedText } from "@/components/i18n/TranslatedText";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { taxonomyLabel } from "@/lib/i18n/taxonomy-labels";

export type DetailMode = "popup" | "inspector";

type Props = {
  shot: Shot | null;
  mode?: DetailMode;
  onModeChange?: (mode: DetailMode) => void;
  onClose: () => void;
  onColorClick?: (hex: string) => void;
  onSimilarPalette?: (shotId: string) => void;
  onFilterClick?: (kind: string, value: string) => void;
  /** Apply this shot's craft as archive filters (shift grid to alike). */
  onShiftAlike?: (shot: Shot) => void;
  onSelectShot?: (shot: Shot) => void;
  /** @deprecated use mode="popup" */
  defaultExpanded?: boolean;
};

type CraftDraft = {
  subject: string;
  mood_vibe: string;
  creative_intent: string;
  shot_type: string;
  camera_movement: string;
  camera_angle: string;
  lighting_style: string;
  composition: string;
  lens_look: string;
  color_grade: string;
  emotion: string;
  content_format: string;
  techniques: string;
};

function draftFromShot(s: Shot): CraftDraft {
  return {
    subject: s.subject || "",
    mood_vibe: s.mood_vibe || "",
    creative_intent: s.creative_intent || "",
    shot_type: s.shot_type || "",
    camera_movement: s.camera_movement || "",
    camera_angle: s.camera_angle || "",
    lighting_style: s.lighting_style || "",
    composition: s.composition || "",
    lens_look: s.lens_look || "",
    color_grade: s.color_grade || "",
    emotion: s.emotion || "",
    content_format: s.content_format || "",
    techniques: (s.techniques || []).join(", "),
  };
}

export function ShotDetailSheet({
  shot,
  mode: modeProp,
  onModeChange,
  onClose,
  onColorClick,
  onSimilarPalette,
  onFilterClick,
  onShiftAlike,
  onSelectShot,
  defaultExpanded = false,
}: Props) {
  const qc = useQueryClient();
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<DetailMode>(
    modeProp || (defaultExpanded ? "popup" : "inspector")
  );
  const [playing, setPlaying] = useState(true);
  const [active, setActive] = useState<Shot | null>(shot);
  const [craft, setCraft] = useState<CraftDraft | null>(() =>
    shot ? draftFromShot(shot) : null
  );
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync shot → panel state during render so the inspector opens on the first paint
  // (useEffect-only sync caused a blank/"choked" flash).
  const [syncedId, setSyncedId] = useState<string | null>(shot?.id ?? null);
  if ((shot?.id ?? null) !== syncedId) {
    setSyncedId(shot?.id ?? null);
    setActive(shot);
    if (shot) {
      setNotes(shot.notes || "");
      setTagsInput((shot.tags || []).join(", "));
      setCraft(draftFromShot(shot));
      setEditing(false);
      setPlaying(true);
    } else {
      setCraft(null);
    }
  }

  useEffect(() => {
    if (modeProp) setMode(modeProp);
  }, [modeProp]);

  const setDetailMode = (next: DetailMode) => {
    setMode(next);
    onModeChange?.(next);
  };

  // notes/tags/craft already synced above when shot id changes
  useEffect(() => {
    /* keep active in sync if parent mutates same-id shot object */
    if (shot && active && shot.id === active.id && shot !== active) {
      setActive(shot);
    }
  }, [shot, active]);

  const taxonomy = useQuery({
    queryKey: ["taxonomy"],
    queryFn: () => api.getTaxonomy(),
    staleTime: 60 * 60 * 1000,
  });

  const favMutation = useMutation({
    mutationFn: (is_favorite: boolean) => api.updateShot(active!.id, { is_favorite }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
  });

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key.toLowerCase() === "f" && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        api.updateShot(active.id, { is_favorite: !active.is_favorite }).then(() => {
          qc.invalidateQueries({ queryKey: ["shots"] });
          qc.invalidateQueries({ queryKey: ["search"] });
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onClose, qc]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Parameters<typeof api.updateShot>[1] = {
        notes: notes || null,
        tags: tagsInput
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean),
      };
      if (craft) {
        body.subject = craft.subject || null;
        body.mood_vibe = craft.mood_vibe || null;
        body.creative_intent = craft.creative_intent || null;
        body.shot_type = craft.shot_type || null;
        body.camera_movement = craft.camera_movement || null;
        body.camera_angle = craft.camera_angle || null;
        body.lighting_style = craft.lighting_style || null;
        body.composition = craft.composition || null;
        body.lens_look = craft.lens_look || null;
        body.color_grade = craft.color_grade || null;
        body.emotion = craft.emotion || null;
        body.content_format = craft.content_format || null;
        body.techniques = craft.techniques
          .split(",")
          .map((x) => x.trim().toLowerCase().replace(/\s+/g, "-"))
          .filter(Boolean);
      }
      return api.updateShot(active!.id, body);
    },
    onSuccess: (updated) => {
      setActive(updated);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
    },
  });

  if (!active || !craft) return null;

  const isPopup = mode === "popup";
  const preview = active.preview_url ? artifactUrl(active.preview_url) : null;
  const keyframe = artifactUrl(active.keyframe_url);
  const isVideoPreview = Boolean(preview && (preview.endsWith(".mp4") || preview.endsWith(".webm")));
  const isAnimPreview = Boolean(
    preview && (preview.endsWith(".webp") || preview.endsWith(".gif") || isVideoPreview)
  );
  const frameName = `${(active.source_title || active.source_filename || "hero-frame")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)}.jpg`;

  const openConnected = (s: Shot) => {
    setActive(s);
    onSelectShot?.(s);
  };

  const togglePlay = () => {
    if (isVideoPreview && videoRef.current) {
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

  const compositions = taxonomy.data?.compositions ?? [];
  const shotTypes = taxonomy.data?.shot_types ?? [];
  const emotions = taxonomy.data?.emotions ?? [];
  const formats = taxonomy.data?.content_formats ?? [];

  const headerBar = (
    <div className="flex items-center justify-between border-b border-cinema-border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-white">
          {isPopup ? t("detail.stage") : t("detail.title")}
        </div>
        <div className="truncate font-mono text-[10px] text-cinema-muted">
          <TranslatedText
            text={active.source_title || active.source_filename || active.source_type}
            as="span"
            className="inline"
          />
          {" · "}scene {active.scene_index}
          {active.shot_type ? ` · ${taxonomyLabel(active.shot_type, locale)}` : ""}
          {active.frame_role ? ` · ${active.frame_role}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onShiftAlike && (
          <button
            type="button"
            title={t("detail.shiftAlike")}
            onClick={() => onShiftAlike(active)}
            className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          >
            <Filter className="h-3.5 w-3.5" />
            {isPopup ? t("detail.shiftAlike") : null}
          </button>
        )}
        <SendToBoardMenu shotIds={[active.id]} projectId={active.project_id} />
        {isPopup ? (
          <button
            type="button"
            title={t("detail.toInspector")}
            onClick={() => setDetailMode("inspector")}
            className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          >
            <PanelRight className="h-3.5 w-3.5" />
            {t("view.inspector")}
          </button>
        ) : (
          <button
            type="button"
            title={t("detail.toPopup")}
            onClick={() => setDetailMode("popup")}
            className="inline-flex items-center gap-1 rounded border border-cinema-border px-2 py-1.5 text-[11px] text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Full panel
          </button>
        )}
        <AddToProjectMenu
          shotIds={[active.id]}
          excludeProjectId={active.project_id}
          variant="button"
        />
        <button
          type="button"
          title={t("detail.favorite")}
          onClick={() => favMutation.mutate(!active.is_favorite)}
          className="rounded border border-cinema-border p-1.5 hover:border-cinema-cyan/50"
        >
          <Star
            className={`h-4 w-4 ${active.is_favorite ? "fill-cinema-cyan text-cinema-cyan" : "text-cinema-muted"}`}
          />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const panelInner = (
    <>
      {headerBar}
      <div
        className={
          isPopup
            ? "grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1.35fr_1fr]"
            : "flex min-h-0 flex-1 flex-col overflow-hidden"
        }
      >
          <div className="flex min-h-0 flex-col overflow-y-auto">
            <div
              className={`relative bg-black ${
                isPopup ? "min-h-[52vh] flex-1 lg:min-h-0" : "aspect-video cursor-zoom-in"
              }`}
              role={!isPopup ? "button" : undefined}
              tabIndex={!isPopup ? 0 : undefined}
              title={!isPopup ? t("detail.toPopup") : undefined}
              onClick={
                !isPopup
                  ? (e) => {
                      const el = e.target as HTMLElement;
                      if (el.closest("button,a")) return;
                      setDetailMode("popup");
                    }
                  : undefined
              }
              onKeyDown={
                !isPopup
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDetailMode("popup");
                      }
                    }
                  : undefined
              }
            >
              {isVideoPreview && playing ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  ref={videoRef}
                  src={preview!}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className="pointer-events-none h-full w-full object-contain"
                />
              ) : isAnimPreview && !isVideoPreview && playing ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview!} alt="" className="pointer-events-none h-full w-full object-contain" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={keyframe} alt="" className="pointer-events-none h-full w-full object-contain" />
              )}

              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
                {isAnimPreview && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePlay();
                    }}
                    className="inline-flex items-center gap-1.5 rounded border border-cinema-border bg-black/75 px-2.5 py-1.5 text-xs text-white hover:border-cinema-cyan/50"
                  >
                    {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {playing ? "Pause" : "Play"}
                  </button>
                )}
                {!isPopup && (
                  <span className="rounded border border-white/15 bg-black/55 px-2 py-1 text-[10px] text-cinema-muted">
                    Click for full panel
                  </span>
                )}
                <a
                  href={keyframe}
                  download={frameName}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-black/75 px-2.5 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10"
                  title={t("detail.downloadFrame")}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t("detail.downloadFrame")}
                </a>
              </div>
            </div>

            {isPopup && (
              <div className="border-t border-cinema-border p-3">
                <ShotConnections shot={active} onSelect={openConnected} />
              </div>
            )}
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto border-l border-cinema-border/60 p-4">
            <section>
              <h3 className="mb-2 text-[10px] uppercase tracking-widest text-cinema-muted">
                {t("detail.palette")}
              </h3>
              <div className="flex flex-wrap gap-2">
                {active.dominant_colors.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    title={`${c.hex} · ${c.percentage}%`}
                    onClick={() => onColorClick?.(c.hex)}
                    className="group flex items-center gap-2 rounded border border-cinema-border bg-cinema-panel px-2 py-1.5 hover:border-cinema-cyan/50"
                  >
                    <span
                      className="h-5 w-5 rounded-sm border border-white/10"
                      style={{ backgroundColor: c.hex }}
                    />
                    <span className="font-mono text-[10px] text-cinema-muted group-hover:text-cinema-cyan">
                      {c.hex}
                    </span>
                    <span className="text-[10px] text-cinema-muted">{c.percentage}%</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onSimilarPalette?.(active.id)}
                className="mt-2 text-[11px] text-cinema-cyan hover:underline"
              >
                {t("detail.expandPalette")}
              </button>
            </section>

            {!isPopup && <ShotConnections shot={active} onSelect={openConnected} />}

            {(() => {
              const qa =
                active.enrichment_quality ||
                (active.source_meta?.enrichment_quality as
                  | { score?: number; pass?: boolean; issues?: string[] }
                  | undefined);
              if (!qa && !(active.enrichment_version > 0)) return null;
              const score = typeof qa?.score === "number" ? qa.score : null;
              const passed = qa?.pass === true;
              const needsWork =
                qa?.pass === false || (Array.isArray(qa?.issues) && qa.issues.length > 0);
              return (
                <section className="rounded-lg border border-cinema-border/80 bg-cinema-panel/40 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[10px] uppercase tracking-widest text-cinema-muted">
                      {t("detail.tagQuality")}
                    </h3>
                    <span
                      className={`font-mono text-[11px] ${
                        passed
                          ? "text-emerald-400"
                          : needsWork
                            ? "text-amber-400"
                            : "text-cinema-muted"
                      }`}
                    >
                      {score != null ? `${Math.round(score)}/100` : "—"}
                      {passed ? " · pass" : needsWork ? " · polish" : ""}
                    </span>
                  </div>
                  {needsWork && Array.isArray(qa?.issues) && qa.issues.length > 0 && (
                    <p className="mt-1 text-[10px] text-cinema-muted/80">
                      {qa.issues.slice(0, 4).join(" · ").replace(/_/g, " ")}
                    </p>
                  )}
                </section>
              );
            })()}

            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[10px] uppercase tracking-widest text-cinema-muted">
                  {t("detail.shotDna")}
                </h3>
                <button
                  type="button"
                  onClick={() => setEditing((v) => !v)}
                  className="text-[11px] text-cinema-cyan hover:underline"
                >
                  {editing ? t("detail.cancelEdit") : t("detail.adaptMeta")}
                </button>
              </div>

              {editing ? (
                <div className="space-y-2">
                  <Field
                    label={t("craft.subject")}
                    value={craft.subject}
                    onChange={(v) => setCraft({ ...craft, subject: v })}
                  />
                  <Field
                    label={t("filters.mood")}
                    value={craft.mood_vibe}
                    onChange={(v) => setCraft({ ...craft, mood_vibe: v })}
                  />
                  <label className="block space-y-1">
                    <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                      {t("craft.intent")}
                    </span>
                    <textarea
                      value={craft.creative_intent}
                      onChange={(e) => setCraft({ ...craft, creative_intent: e.target.value })}
                      rows={3}
                      className="w-full resize-none rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField
                      label={t("craft.type")}
                      value={craft.shot_type}
                      options={shotTypes}
                      onChange={(v) => setCraft({ ...craft, shot_type: v })}
                      locale={locale}
                    />
                    <SelectField
                      label={t("craft.composition")}
                      value={craft.composition}
                      options={compositions}
                      onChange={(v) => setCraft({ ...craft, composition: v })}
                      locale={locale}
                    />
                    <Field
                      label={t("craft.movement")}
                      value={craft.camera_movement}
                      onChange={(v) => setCraft({ ...craft, camera_movement: v })}
                    />
                    <Field
                      label={t("craft.angle")}
                      value={craft.camera_angle}
                      onChange={(v) => setCraft({ ...craft, camera_angle: v })}
                    />
                    <Field
                      label={t("craft.lighting")}
                      value={craft.lighting_style}
                      onChange={(v) => setCraft({ ...craft, lighting_style: v })}
                    />
                    <Field
                      label={t("craft.lens")}
                      value={craft.lens_look}
                      onChange={(v) => setCraft({ ...craft, lens_look: v })}
                    />
                    <Field
                      label={t("craft.grade")}
                      value={craft.color_grade}
                      onChange={(v) => setCraft({ ...craft, color_grade: v })}
                    />
                    <SelectField
                      label={t("craft.emotion")}
                      value={craft.emotion}
                      options={emotions}
                      onChange={(v) => setCraft({ ...craft, emotion: v })}
                      locale={locale}
                    />
                    <SelectField
                      label={t("craft.format")}
                      value={craft.content_format}
                      options={formats}
                      onChange={(v) => setCraft({ ...craft, content_format: v })}
                      locale={locale}
                    />
                  </div>
                  <Field
                    label={t("craft.techniquesComma")}
                    value={craft.techniques}
                    onChange={(v) => setCraft({ ...craft, techniques: v })}
                  />
                </div>
              ) : (
                <>
                  {active.subject && (
                    <TranslatedText text={active.subject} className="text-sm text-white" />
                  )}
                  {active.mood_vibe && (
                    <TranslatedText text={active.mood_vibe} className="text-sm text-white/90" />
                  )}
                  {active.creative_intent && (
                    <TranslatedText
                      text={active.creative_intent}
                      className="text-xs leading-relaxed text-cinema-muted"
                    />
                  )}
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <Meta
                      label={t("craft.type")}
                      value={
                        active.shot_type ? taxonomyLabel(active.shot_type, locale) : "—"
                      }
                    />
                    <Meta
                      label={t("craft.movement")}
                      value={
                        active.camera_movement
                          ? taxonomyLabel(active.camera_movement, locale)
                          : "—"
                      }
                    />
                    <Meta
                      label={t("craft.angle")}
                      value={
                        active.camera_angle
                          ? taxonomyLabel(active.camera_angle, locale)
                          : "—"
                      }
                    />
                    <Meta
                      label={t("craft.lighting")}
                      value={
                        active.lighting_style
                          ? taxonomyLabel(active.lighting_style, locale)
                          : "—"
                      }
                    />
                    {active.composition ? (
                      <button
                        type="button"
                        onClick={() => onFilterClick?.("composition", active.composition!)}
                        className="rounded border border-cinema-border bg-cinema-panel px-3 py-2 text-left hover:border-cinema-cyan/40"
                      >
                        <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                          {t("craft.composition")}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-cinema-cyan">
                          {taxonomyLabel(active.composition, locale)}
                        </div>
                      </button>
                    ) : (
                      <Meta label={t("craft.composition")} value="—" />
                    )}
                    <Meta
                      label={t("craft.lens")}
                      value={active.lens_look ? taxonomyLabel(active.lens_look, locale) : "—"}
                    />
                    <Meta
                      label={t("craft.grade")}
                      value={
                        active.color_grade ? taxonomyLabel(active.color_grade, locale) : "—"
                      }
                    />
                    <Meta
                      label={t("craft.format")}
                      value={
                        active.content_format
                          ? taxonomyLabel(active.content_format, locale)
                          : "—"
                      }
                    />
                    <Meta
                      label={t("filters.era")}
                      value={active.era ? taxonomyLabel(active.era, locale) : "—"}
                    />
                    <Meta
                      label={t("filters.origin")}
                      value={active.origin ? taxonomyLabel(active.origin, locale) : "—"}
                    />
                    <Meta
                      label={t("filters.ism")}
                      value={active.ism ? taxonomyLabel(active.ism, locale) : "—"}
                    />
                    <Meta
                      label={t("filters.director")}
                      value={
                        active.director ||
                        (typeof active.source_meta?.director === "string"
                          ? active.source_meta.director
                          : "—")
                      }
                    />
                    <Meta
                      label={t("filters.style")}
                      value={
                        active.visual_style
                          ? taxonomyLabel(active.visual_style, locale)
                          : "—"
                      }
                    />
                    <Meta
                      label={t("filters.theme")}
                      value={active.theme ? taxonomyLabel(active.theme, locale) : "—"}
                    />
                    <Meta
                      label={t("filters.genre")}
                      value={active.genre ? taxonomyLabel(active.genre, locale) : "—"}
                    />
                  </div>
                  {active.techniques && active.techniques.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-widest text-cinema-muted">
                        {t("detail.techniques")}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {active.techniques.map((tech) => (
                          <button
                            key={tech}
                            type="button"
                            onClick={() => onFilterClick?.("technique", tech)}
                            className="rounded border border-cinema-cyan/40 px-1.5 py-0.5 text-[10px] text-cinema-cyan hover:bg-cinema-cyan/10"
                          >
                            {taxonomyLabel(tech, locale)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {active.shapes && active.shapes.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-[10px] uppercase tracking-widest text-cinema-muted">
                        {t("detail.shapes")}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {active.shapes.map((sh) => (
                          <button
                            key={sh}
                            type="button"
                            onClick={() => onFilterClick?.("shape", sh)}
                            className="rounded border border-cinema-border px-1.5 py-0.5 text-[10px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
                          >
                            {taxonomyLabel(sh, locale)}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-1">
                    {[
                      active.era ? { k: "era", v: active.era } : null,
                      active.origin ? { k: "origin", v: active.origin } : null,
                      active.ism ? { k: "ism", v: active.ism } : null,
                      (active.director ||
                      (typeof active.source_meta?.director === "string"
                        ? active.source_meta.director
                        : null))
                        ? {
                            k: "director",
                            v:
                              active.director ||
                              (active.source_meta.director as string),
                          }
                        : null,
                      active.theme ? { k: "theme", v: active.theme } : null,
                      active.genre ? { k: "genre", v: active.genre } : null,
                      active.visual_style ? { k: "visual_style", v: active.visual_style } : null,
                      active.emotion ? { k: "emotion", v: active.emotion } : null,
                      ...(active.tags || []).map((tag) => ({ k: "tag", v: tag })),
                    ]
                      .filter(Boolean)
                      .map((item) => (
                        <button
                          key={`${item!.k}-${item!.v}`}
                          type="button"
                          onClick={() => onFilterClick?.(item!.k, item!.v)}
                          className="rounded border border-cinema-border px-1.5 py-0.5 text-[10px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
                        >
                          <TranslatedText text={item!.v} as="span" className="inline" />
                        </button>
                      ))}
                  </div>
                </>
              )}
            </section>

            <section className="grid grid-cols-2 gap-3 text-sm">
              <MetaTrans
                label="Source"
                value={active.source_title || active.source_filename || "—"}
              />
              {typeof active.source_meta?.film_title === "string" &&
                active.source_meta.film_title && (
                  <MetaTrans label="Film" value={String(active.source_meta.film_title)} />
                )}
              {(Boolean(active.source_meta?.release_year) ||
                typeof active.source_meta?.director === "string") && (
                <Meta
                  label="Credits"
                  value={[
                    active.source_meta?.release_year
                      ? String(active.source_meta.release_year)
                      : null,
                    typeof active.source_meta?.director === "string"
                      ? active.source_meta.director
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                />
              )}
              {(() => {
                const title =
                  (typeof active.source_meta?.film_title === "string" &&
                    active.source_meta.film_title) ||
                  active.source_title;
                const year =
                  active.source_meta?.release_year != null
                    ? String(active.source_meta.release_year)
                    : "";
                if (!title) return null;
                const q = encodeURIComponent(`${title}${year ? ` ${year}` : ""}`);
                const links = [
                  {
                    label: "IMDb",
                    href: `https://www.imdb.com/find/?q=${q}`,
                  },
                  {
                    label: "Letterboxd",
                    href: `https://letterboxd.com/search/${q}/`,
                  },
                  {
                    label: "TMDB",
                    href: `https://www.themoviedb.org/search?query=${q}`,
                  },
                  {
                    label: "JustWatch",
                    href: `https://www.justwatch.com/us/search?q=${q}`,
                  },
                ];
                return (
                  <div className="col-span-2 rounded border border-cinema-border bg-cinema-panel px-3 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                      Watch / lookup
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-2">
                      {links.map((l) => (
                        <a
                          key={l.label}
                          href={l.href}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-cinema-border px-2 py-0.5 text-[11px] text-cinema-cyan hover:border-cinema-cyan/50"
                        >
                          {l.label}
                        </a>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {active.source_filename && active.source_filename !== active.source_title && (
                <Meta label="File" value={active.source_filename} />
              )}
              <Meta label="Resolution" value={`${active.width}×${active.height}`} />
              <Meta
                label="Duration"
                value={formatTimecode(active.duration_ms, active.source_fps)}
              />
              <Meta
                label="In"
                value={formatTimecode(active.start_timecode_ms, active.source_fps)}
              />
              <Meta
                label="Out"
                value={formatTimecode(active.end_timecode_ms, active.source_fps)}
              />
              <Meta
                label="Keyframe"
                value={formatTimecode(active.keyframe_ms, active.source_fps)}
              />
              <Meta
                label="FPS"
                value={active.source_fps ? String(Number(active.source_fps).toFixed(3)) : "—"}
              />
              <Meta
                label="Score"
                value={String(active.hero_score?.toFixed?.(2) ?? active.hero_score ?? 0)}
              />
            </section>

            {(active.dialogue_text ||
              (active.dialogue?.segments && active.dialogue.segments.length > 0)) && (
              <section className="space-y-2">
                <h3 className="text-[10px] uppercase tracking-widest text-cinema-muted">
                  Dialogue
                </h3>
                {active.dialogue_text ? (
                  <TranslatedText
                    text={active.dialogue_text}
                    className="text-sm leading-relaxed text-white/90"
                  />
                ) : null}
                <div className="max-h-40 space-y-1.5 overflow-y-auto">
                  {(active.dialogue?.segments || []).map((seg, i) => (
                    <div
                      key={`${seg.start_ms}-${i}`}
                      className="rounded border border-cinema-border bg-cinema-panel px-2 py-1.5"
                    >
                      <div className="font-mono text-[10px] text-cinema-muted">
                        {formatTimecode(seg.start_ms, active.source_fps)} →{" "}
                        {formatTimecode(seg.end_ms, active.source_fps)}
                      </div>
                      <TranslatedText text={seg.text} className="text-xs text-white/85" />
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h3 className="text-[10px] uppercase tracking-widest text-cinema-muted">
                {t("detail.edit")}
              </h3>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder={t("detail.tagsPlaceholder")}
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
              />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder={t("detail.notes")}
                className="w-full resize-none rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
              />
              {notes.trim() && !editing && (
                <TranslatedText text={notes} className="text-[11px] text-cinema-muted" />
              )}
              <button
                type="button"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="rounded bg-cinema-cyan/20 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/30"
              >
                {t("detail.save")}
              </button>
            </section>

            <section className="flex flex-wrap gap-2">
              <a
                href={keyframe}
                download={frameName}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-panel px-3 py-1.5 text-xs text-cinema-cyan hover:border-cinema-cyan/70"
              >
                <Download className="h-3.5 w-3.5" />
                {t("detail.downloadHero")}
              </a>
              {preview && <DownloadLink href={preview} label={t("detail.downloadLoop")} />}
              {active.source_type === "video" && active.start_timecode_ms != null && (
                <button
                  type="button"
                  onClick={() => api.exportShotClip(active.id, 0.25)}
                  className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-panel px-3 py-1.5 text-xs text-cinema-cyan hover:border-cinema-cyan/70"
                >
                  <DownloadCloud className="h-3.5 w-3.5" />
                  {t("detail.exportClip")}
                </button>
              )}
              <button
                type="button"
                onClick={() => api.exportShots([active.id], "edl")}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-border bg-cinema-panel px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
              >
                {t("detail.exportEdl")}
              </button>
              <button
                type="button"
                onClick={() => api.exportShots([active.id], "zip")}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-border bg-cinema-panel px-3 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
              >
                <DownloadCloud className="h-3.5 w-3.5" />
                {t("detail.exportZip")}
              </button>
            </section>
          </div>
        </div>
    </>
  );

  // Popup: large centered stage — click outside returns to the grid
  if (isPopup) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 md:p-8">
        <button
          type="button"
          aria-label="Close"
          className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <aside className="relative z-10 flex h-[min(94vh,980px)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl">
          {panelInner}
        </aside>
      </div>
    );
  }

  // Inspector: docks on the right — grid reserves space + drops to ≤3 cols
  return (
    <aside className="fixed bottom-0 right-0 top-10 z-[45] flex w-full max-w-md flex-col border-l border-cinema-border bg-cinema-surface shadow-[-12px_0_40px_rgba(0,0,0,0.45)]">
      {panelInner}
    </aside>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-widest text-cinema-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
  locale,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  locale: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] uppercase tracking-widest text-cinema-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-cinema-muted outline-none focus:border-cinema-cyan"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {taxonomyLabel(o, locale)}
          </option>
        ))}
        {value && !options.includes(value) ? (
          <option value={value}>{taxonomyLabel(value, locale)}</option>
        ) : null}
      </select>
    </label>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-cinema-border bg-cinema-panel px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-cinema-muted">{label}</div>
      <div className="mt-0.5 font-mono text-xs text-white">{value}</div>
    </div>
  );
}

function MetaTrans({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-cinema-border bg-cinema-panel px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-cinema-muted">{label}</div>
      <TranslatedText text={value} className="mt-0.5 font-mono text-xs text-white" as="div" />
    </div>
  );
}

function DownloadLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      download
      className="inline-flex items-center gap-1.5 rounded border border-cinema-border bg-cinema-panel px-3 py-1.5 text-xs text-cinema-cyan hover:border-cinema-cyan/50"
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
