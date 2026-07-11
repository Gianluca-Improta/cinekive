"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal, X } from "lucide-react";
import { api } from "@/lib/api-client";

export type DialFilters = {
  shotType: string;
  technique: string;
  composition: string;
  era: string;
  origin: string;
  ism: string;
  director: string;
  visualStyle: string;
  theme: string;
  genre: string;
  shape: string;
  emotion: string;
  contentFormat: string;
  mood: string;
};

type Props = {
  value: DialFilters;
  onChange: (patch: Partial<DialFilters>) => void;
  onOpenChange?: (open: boolean) => void;
};

const QUICK_KEY = "cinearchive.quickFilters";

function labelize(slug: string) {
  return slug.replace(/-/g, " ");
}

function loadQuick(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(QUICK_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

function bumpQuick(key: string) {
  if (typeof window === "undefined" || !key) return;
  const prev = loadQuick().filter((k) => k !== key);
  const next = [key, ...prev].slice(0, 12);
  localStorage.setItem(QUICK_KEY, JSON.stringify(next));
}

export function FilterDial({ value, onChange, onOpenChange }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState<string[]>([]);

  useEffect(() => setQuick(loadQuick()), [open, value]);

  const { data: taxonomy } = useQuery({
    queryKey: ["taxonomy"],
    queryFn: () => api.getTaxonomy(),
    staleTime: 60 * 60 * 1000,
  });

  const activeCount = [
    value.shotType,
    value.technique,
    value.composition,
    value.era,
    value.origin,
    value.ism,
    value.director,
    value.visualStyle,
    value.theme,
    value.genre,
    value.shape,
    value.emotion,
    value.contentFormat,
    value.mood,
  ].filter(Boolean).length;

  const sections = useMemo(() => {
    if (!taxonomy) return [] as { title: string; key: keyof DialFilters; items: string[] }[];
    const needle = q.trim().toLowerCase();
    const filt = (items: string[]) =>
      needle ? items.filter((i) => i.includes(needle) || labelize(i).includes(needle)) : items;
    return [
      { title: "Shot type", key: "shotType" as const, items: filt(taxonomy.shot_types || []) },
      { title: "Composition", key: "composition" as const, items: filt(taxonomy.compositions || []) },
      { title: "Techniques", key: "technique" as const, items: filt(taxonomy.techniques || []) },
      { title: "Era", key: "era" as const, items: filt(taxonomy.eras || []) },
      { title: "Origin", key: "origin" as const, items: filt(taxonomy.origins || []) },
      { title: "Ism / movement", key: "ism" as const, items: filt(taxonomy.isms || []) },
      { title: "Style", key: "visualStyle" as const, items: filt(taxonomy.visual_styles || []) },
      { title: "Theme", key: "theme" as const, items: filt(taxonomy.themes || []) },
      { title: "Genre", key: "genre" as const, items: filt(taxonomy.genres || []) },
      { title: "Shape", key: "shape" as const, items: filt(taxonomy.shapes || []) },
      { title: "Emotion", key: "emotion" as const, items: filt(taxonomy.emotions || []) },
      { title: "Format", key: "contentFormat" as const, items: filt(taxonomy.content_formats || []) },
    ].filter((s) => s.items.length > 0);
  }, [taxonomy, q]);

  const setOpenSafe = (v: boolean) => {
    setOpen(v);
    onOpenChange?.(v);
  };

  const pick = (key: keyof DialFilters, item: string) => {
    const cur = value[key];
    const next = cur === item ? "" : item;
    onChange({ [key]: next });
    if (next) {
      bumpQuick(`${key}:${next}`);
      setQuick(loadQuick());
    }
  };

  const applyQuick = (token: string) => {
    const [key, ...rest] = token.split(":");
    const item = rest.join(":");
    if (key && item) onChange({ [key]: item } as Partial<DialFilters>);
  };

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpenSafe(!open)}
          className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1.5 text-xs ${
            activeCount || open
              ? "border-cinema-cyan/60 text-cinema-cyan"
              : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Dial in{activeCount ? ` · ${activeCount}` : ""}
        </button>
        {quick.slice(0, 6).map((token) => {
          const label = token.split(":").slice(1).join(":") || token;
          return (
            <button
              key={token}
              type="button"
              onClick={() => applyQuick(token)}
              className="rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
            >
              {labelize(label)}
            </button>
          );
        })}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() =>
              onChange({
                shotType: "",
                technique: "",
                composition: "",
                era: "",
                origin: "",
                ism: "",
                director: "",
                visualStyle: "",
                theme: "",
                genre: "",
                shape: "",
                emotion: "",
                contentFormat: "",
                mood: "",
              })
            }
            className="text-[11px] text-cinema-muted hover:text-white"
          >
            Clear all
          </button>
        )}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 z-40 mt-2 max-h-[70vh] w-[min(920px,92vw)] overflow-hidden rounded-lg border border-cinema-border bg-cinema-surface shadow-2xl">
          <div className="flex items-center gap-2 border-b border-cinema-border px-3 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search era, ism, origin, style…"
              className="min-w-0 flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
            />
            <button
              type="button"
              onClick={() => setOpenSafe(false)}
              className="rounded border border-cinema-border p-1 text-cinema-muted hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-4 overflow-y-auto p-3">
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">Mood</p>
              <input
                value={value.mood}
                onChange={(e) => onChange({ mood: e.target.value })}
                placeholder="Free mood phrase…"
                className="w-full max-w-sm rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </div>
            <div>
              <p className="mb-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                Director
              </p>
              <input
                value={value.director}
                onChange={(e) => onChange({ director: e.target.value })}
                placeholder="e.g. Fincher, Wong Kar-wai…"
                className="w-full max-w-sm rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </div>
            {sections.map((sec) => (
              <div key={sec.title}>
                <p className="mb-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                  {sec.title}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sec.items.map((item) => {
                    const active = value[sec.key] === item;
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => pick(sec.key, item)}
                        className={`rounded border px-2 py-0.5 text-[11px] transition ${
                          active
                            ? "border-cinema-cyan bg-cinema-cyan/10 text-cinema-cyan"
                            : "border-cinema-border text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
                        }`}
                      >
                        {labelize(item)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
