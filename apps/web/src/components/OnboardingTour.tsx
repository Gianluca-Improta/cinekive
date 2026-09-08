"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  Clapperboard,
  LayoutTemplate,
  Search,
  Sparkles,
  Tags,
  Upload,
  Wand2,
  X,
  Activity,
} from "lucide-react";
import { openIngestPanel } from "@/components/ingest/IngestPanel";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const ONBOARD_KEY = "cinekive.onboarding.v2";
const TOUR_EVENT = "cinekive:start-tour";
const PAD = 8;

type StepMeta = {
  id: string;
  icon: typeof Search;
  titleKey: string;
  bodyKey: string;
  /** CSS selector for spotlight target */
  target?: string;
  href?: string;
  action?: "ingest";
};

const STEP_META: StepMeta[] = [
  { id: "welcome", icon: Search, titleKey: "tour.welcomeTitle", bodyKey: "tour.welcomeBody" },
  {
    id: "shelves",
    icon: Clapperboard,
    titleKey: "tour.shelvesTitle",
    bodyKey: "tour.shelvesBody",
    target: '[data-tour="projects"]',
  },
  {
    id: "ingest",
    icon: Upload,
    titleKey: "tour.ingestTitle",
    bodyKey: "tour.ingestBody",
    target: '[data-tour="ingest"]',
    action: "ingest",
  },
  {
    id: "tagging",
    icon: Tags,
    titleKey: "tour.taggingTitle",
    bodyKey: "tour.taggingBody",
    href: "/settings?tab=ai",
    target: '[data-tour="settings-nav"]',
  },
  {
    id: "gemi",
    icon: Sparkles,
    titleKey: "tour.gemiTitle",
    bodyKey: "tour.gemiBody",
    target: '[data-tour="gemi"]',
  },
  {
    id: "dial",
    icon: Search,
    titleKey: "tour.dialTitle",
    bodyKey: "tour.dialBody",
    href: "/",
    target: '[data-tour="search"]',
  },
  {
    id: "archives",
    icon: Archive,
    titleKey: "tour.archivesTitle",
    bodyKey: "tour.archivesBody",
    href: "/archives",
    target: '[data-tour="archives-hub"], [data-tour="archives"]',
  },
  {
    id: "boards",
    icon: LayoutTemplate,
    titleKey: "tour.boardsTitle",
    bodyKey: "tour.boardsBody",
    target: '[data-tour="projects"]',
  },
  {
    id: "generate",
    icon: Wand2,
    titleKey: "tour.generateTitle",
    bodyKey: "tour.generateBody",
    target: '[data-tour="gemi"]',
  },
  {
    id: "activity",
    icon: Activity,
    titleKey: "tour.activityTitle",
    bodyKey: "tour.activityBody",
    target: '[data-tour="activity"]',
  },
];

type Rect = { top: number; left: number; width: number; height: number };

function readTargetRect(selector: string | undefined): Rect | null {
  if (!selector || typeof document === "undefined") return null;
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 4 && r.height < 4) return null;
  el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  const r2 = el.getBoundingClientRect();
  return {
    top: Math.max(0, r2.top - PAD),
    left: Math.max(0, r2.left - PAD),
    width: Math.min(window.innerWidth - 8, r2.width + PAD * 2),
    height: Math.min(window.innerHeight - 8, r2.height + PAD * 2),
  };
}

export function OnboardingTour() {
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [hole, setHole] = useState<Rect | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARD_KEY) !== "done") {
        setOpen(true);
        setStep(0);
      }
    } catch {
      /* ignore */
    }
    const onTour = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, onTour);
    return () => window.removeEventListener(TOUR_EVENT, onTour);
  }, []);

  const current = STEP_META[step];

  const measure = useCallback(() => {
    if (!open || !current) {
      setHole(null);
      return;
    }
    setHole(readTargetRect(current.target));
  }, [open, current]);

  useLayoutEffect(() => {
    if (!open || !current) return;
    // Navigate first so targets exist, then measure after paint
    if (current.href) {
      router.push(current.href);
    }
    const t1 = window.setTimeout(measure, 80);
    const t2 = window.setTimeout(measure, 320);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, current, measure, router]);

  const finish = () => {
    try {
      localStorage.setItem(ONBOARD_KEY, "done");
      localStorage.setItem("cinekive.onboarding.v1", "done");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  if (!open || !current) return null;
  const Icon = current.icon;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;

  // Place tooltip below hole when space, else above / centered
  let tipStyle: React.CSSProperties;
  if (hole) {
    const below = hole.top + hole.height + 12;
    const tipH = 220;
    const placeBelow = below + tipH < vh - 16;
    tipStyle = {
      position: "fixed",
      left: Math.min(Math.max(16, hole.left), vw - 360),
      top: placeBelow ? below : Math.max(16, hole.top - tipH - 12),
      width: "min(22rem, calc(100vw - 2rem))",
      zIndex: 72,
    };
  } else {
    tipStyle = {
      position: "fixed",
      left: "50%",
      top: "50%",
      transform: "translate(-50%, -50%)",
      width: "min(22rem, calc(100vw - 2rem))",
      zIndex: 72,
    };
  }

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label={t("tour.label")}>
      {hole ? (
        <div
          className="pointer-events-none absolute rounded-xl ring-2 ring-cinema-cyan"
          style={{
            top: hole.top,
            left: hole.left,
            width: hole.width,
            height: hole.height,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.64)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
      )}

      <div
        style={{ ...tipStyle, zIndex: 73, pointerEvents: "auto" }}
        className="overflow-hidden rounded-2xl border border-cinema-border bg-cinema-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-cinema-border px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
            {t("tour.label")} · {step + 1}/{STEP_META.length}
          </div>
          <button
            type="button"
            onClick={finish}
            className="rounded p-1 text-cinema-muted hover:text-white"
            title={t("tour.skip")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cinema-cyan/15 text-cinema-cyan">
            <Icon className="h-5 w-5" />
          </div>
          <h2 className="text-base font-semibold text-white">{t(current.titleKey)}</h2>
          <p className="text-sm leading-relaxed text-cinema-muted">{t(current.bodyKey)}</p>
          <div className="flex gap-1.5 pt-0.5">
            {STEP_META.map((s, i) => (
              <div
                key={s.id}
                className={cn(
                  "h-1 flex-1 rounded-full",
                  i <= step ? "bg-cinema-cyan" : "bg-cinema-border"
                )}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-cinema-border px-4 py-2.5">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-cinema-muted hover:text-white"
          >
            {t("tour.skip")}
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-white"
              >
                {t("tour.back")}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                if (current.action === "ingest") {
                  openIngestPanel();
                }
                if (step >= STEP_META.length - 1) finish();
                else setStep((s) => s + 1);
              }}
              className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
            >
              {step >= STEP_META.length - 1 ? t("tour.finish") : t("tour.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
