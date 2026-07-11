"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Clapperboard, Search, Upload, X, LayoutTemplate } from "lucide-react";
import { openIngestPanel } from "@/components/ingest/IngestPanel";
import { cn } from "@/lib/utils";

const ONBOARD_KEY = "cinekive.onboarding.v1";
const TOUR_EVENT = "cinekive:start-tour";

const STEPS = [
  {
    id: "welcome",
    title: "Welcome to Cinekive",
    body: "Your cinematic archive — local, searchable, yours. Nothing leaves your machine unless you share it.",
    icon: Search,
  },
  {
    id: "shelves",
    title: "Shelves for different work",
    body: "Narrative, Commercials, and Social are for footage you ingest. Archives are still libraries (FilmGrab, EyeCandy, ShotDeck…). Keep them separate.",
    icon: Clapperboard,
  },
  {
    id: "ingest",
    title: "Drop media or paste a URL",
    body: "Use Ingest to add videos, stills, or any yt-dlp URL into a project. Progress shows in Activity.",
    icon: Upload,
    action: "ingest",
  },
  {
    id: "archives",
    title: "Build an archive",
    body: "Mirrors pull public or login-gated still sites. Discover lists more sources you can save into a custom archive.",
    icon: Archive,
    href: "/archives",
  },
  {
    id: "boards",
    title: "Moodboards live on a project",
    body: "Open a project → Moodboard. Select shots in the grid → Send to board. Boards stay with that project.",
    icon: LayoutTemplate,
  },
];

export function OnboardingTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

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

  const finish = () => {
    try {
      localStorage.setItem(ONBOARD_KEY, "done");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const current = STEPS[step];
  if (!open || !current) return null;
  const Icon = current.icon;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--cinema-overlay)] p-4 backdrop-blur-md">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-cinema-border bg-cinema-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-cinema-border px-5 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
            Tour · {step + 1}/{STEPS.length}
          </div>
          <button
            type="button"
            onClick={finish}
            className="rounded p-1 text-cinema-muted hover:text-white"
            title="Skip"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cinema-cyan/15 text-cinema-cyan">
            <Icon className="h-5 w-5" />
          </div>
          <h2 className="text-lg font-semibold text-white">{current.title}</h2>
          <p className="text-sm leading-relaxed text-cinema-muted">{current.body}</p>
          <div className="flex gap-1.5 pt-1">
            {STEPS.map((s, i) => (
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
        <div className="flex items-center justify-between gap-2 border-t border-cinema-border px-5 py-3">
          <button
            type="button"
            onClick={finish}
            className="text-xs text-cinema-muted hover:text-white"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-white"
              >
                Back
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => {
                  if (current.action === "ingest") openIngestPanel();
                  if (current.href) router.push(current.href);
                  setStep((s) => s + 1);
                }}
                className="rounded bg-cinema-cyan/20 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/30"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={finish}
                className="rounded bg-cinema-cyan px-3 py-1.5 text-xs font-medium text-black hover:opacity-90"
              >
                Start exploring
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
