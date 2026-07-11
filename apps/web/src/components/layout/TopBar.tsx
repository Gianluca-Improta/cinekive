"use client";

import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Palette, RefreshCw, HelpCircle } from "lucide-react";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { openIngestPanel } from "@/components/ingest/IngestPanel";
import { useAppearance, type AppearanceTheme } from "@/lib/appearance";
import { useState } from "react";
import { cn } from "@/lib/utils";

function projectIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/\/projects\/([^/]+)/);
  return m?.[1];
}

const THEMES: { id: AppearanceTheme; label: string }[] = [
  { id: "dark", label: "Dark" },
  { id: "light", label: "Light" },
  { id: "slate", label: "Slate" },
];

const TOUR_EVENT = "cinekive:start-tour";

export function startTour() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUR_EVENT));
}

/** Thin top chrome — ingest + refresh + appearance + tour + language. */
export function TopBar() {
  const pathname = usePathname();
  const qc = useQueryClient();
  const { theme, setTheme } = useAppearance();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["shots"] }),
      qc.invalidateQueries({ queryKey: ["search"] }),
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["jobs"] }),
      qc.invalidateQueries({ queryKey: ["sources-status"] }),
      qc.invalidateQueries({ queryKey: ["collections"] }),
    ]);
    setTimeout(() => setRefreshing(false), 600);
  };

  return (
    <div className="flex h-10 shrink-0 items-center justify-end gap-2 border-b border-cinema-border bg-cinema-surface/80 px-4">
      <button
        type="button"
        onClick={() => openIngestPanel(projectIdFromPath(pathname))}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title="Ingest files or URL"
      >
        <Upload className="h-3.5 w-3.5" />
        Ingest
      </button>
      <button
        type="button"
        onClick={refresh}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title="Refresh library"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        Refresh
      </button>
      <button
        type="button"
        onClick={startTour}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title="Take a quick tour"
      >
        <HelpCircle className="h-3.5 w-3.5" />
        Tour
      </button>
      <label className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1 text-xs text-cinema-muted">
        <Palette className="h-3.5 w-3.5" />
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as AppearanceTheme)}
          className="bg-transparent outline-none"
          title="Appearance"
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id} className="bg-cinema-surface text-cinema-body">
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <LanguageSwitcher placement="bottom" />
    </div>
  );
}
