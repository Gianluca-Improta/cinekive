"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, Palette, RefreshCw, HelpCircle, Activity, Crown, UserRound, Menu } from "lucide-react";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { openIngestPanel } from "@/components/ingest/IngestPanel";
import { toggleActivityPanel } from "@/components/jobs/ActivityLogPanel";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAppearance, type AppearanceTheme } from "@/lib/appearance";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { toggleMobileNav } from "@/lib/mobile-nav";
import { useState } from "react";
import { cn } from "@/lib/utils";

function projectIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/\/projects\/([^/]+)/);
  return m?.[1];
}

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
  const { t } = useI18n();
  const { data: entitlements } = useEntitlements();
  const isPro = Boolean(entitlements?.is_pro);
  const [refreshing, setRefreshing] = useState(false);

  const themes: { id: AppearanceTheme; label: string }[] = [
    { id: "dark", label: t("topbar.themeDark") },
    { id: "light", label: t("topbar.themeLight") },
    { id: "slate", label: t("topbar.themeSlate") },
  ];

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
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-cinema-surface/80 px-2 sm:px-4">
      <button
        type="button"
        onClick={toggleMobileNav}
        className="-ml-1 inline-flex h-8 w-8 items-center justify-center rounded text-cinema-muted hover:bg-cinema-panel hover:text-cinema-cyan md:hidden"
        title="Menu"
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2">
      <button
        type="button"
        data-tour="ingest"
        onClick={() => openIngestPanel(projectIdFromPath(pathname))}
        className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title={t("topbar.ingestTitle")}
      >
        <Upload className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("topbar.ingest")}</span>
      </button>
      <button
        type="button"
        data-tour="activity"
        onClick={() => toggleActivityPanel()}
        className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title="Activity log"
      >
        <Activity className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Activity</span>
      </button>
      <button
        type="button"
        onClick={refresh}
        className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        title={t("topbar.refreshTitle")}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        <span className="hidden sm:inline">{t("topbar.refresh")}</span>
      </button>
      <button
        type="button"
        onClick={startTour}
        className="hidden min-h-[2.25rem] items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan sm:inline-flex"
        title={t("topbar.tourTitle")}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {t("topbar.tour")}
      </button>
      <label className="hidden min-h-[2.25rem] items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1 text-xs text-cinema-muted sm:inline-flex">
        <Palette className="h-3.5 w-3.5" />
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as AppearanceTheme)}
          className="bg-transparent outline-none"
          title={t("topbar.appearance")}
        >
          {themes.map((item) => (
            <option key={item.id} value={item.id} className="bg-cinema-surface text-cinema-body">
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <LanguageSwitcher placement="bottom" />
      <ModeSwitcher />
      <Link
        href="/settings?tab=license"
        className={cn(
          "inline-flex min-h-[2.25rem] items-center gap-1.5 rounded border px-2 py-1.5 text-xs",
          isPro
            ? "border-cinema-cyan/40 bg-cinema-cyan/10 text-cinema-cyan"
            : "border-white/[0.08] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
        )}
        title={isPro ? "Manage Pro license" : "Activate Pro license"}
      >
        {isPro ? <Crown className="h-3.5 w-3.5" /> : <UserRound className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">{isPro ? "Pro" : "Sign in"}</span>
      </Link>
      </div>
    </div>
  );
}
