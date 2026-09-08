"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Crown,
  Download,
  FileArchive,
  FileImage,
  Presentation,
  Share2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { exportProjectPdf } from "@/lib/project-export";
import type { Project, Shot } from "@/lib/types";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import { cn } from "@/lib/utils";

type Props = {
  project: Project;
  shots: Shot[];
  className?: string;
};

export function ProjectShareMenu({ project, shots, className }: Props) {
  const canExport = useHasFeature("batch_export");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const openMenu = () => {
    if (!canExport) {
      window.open(PRO_UPGRADE_URL, "_blank", "noopener,noreferrer");
      return;
    }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuW = 260;
      setPos({
        top: rect.bottom + 4,
        left: Math.min(Math.max(8, rect.right - menuW), window.innerWidth - menuW - 8),
      });
    }
    setOpen((v) => !v);
    setErr(null);
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message || "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const items = [
    {
      key: "gallery",
      label: "Share package (ZIP + gallery)",
      hint: "index.html + stills/ — flick through offline",
      Icon: Share2,
      action: () => api.exportProject(project.id, "gallery"),
    },
    {
      key: "zip",
      label: "Stills ZIP",
      hint: "Filesystem of reference JPGs",
      Icon: FileArchive,
      action: () => api.exportProject(project.id, "zip"),
    },
    {
      key: "pptx",
      label: "PowerPoint (.pptx)",
      hint: "One slide per still",
      Icon: Presentation,
      action: () => api.exportProject(project.id, "pptx"),
    },
    {
      key: "pdf",
      label: "Lookbook PDF",
      hint: "Contact sheet for email / print",
      Icon: FileImage,
      action: () =>
        exportProjectPdf(shots, project.name, {
          feeling: project.feeling,
        }),
    },
  ] as const;

  return (
    <div className={cn("relative", className)}>
      <button
        ref={btnRef}
        type="button"
        onClick={openMenu}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/50 hover:text-cinema-cyan"
        title={canExport ? "Share / export project" : "Project export is Pro"}
      >
        {canExport ? (
          <Download className="h-3.5 w-3.5" />
        ) : (
          <Crown className="h-3.5 w-3.5 text-cinema-cyan" />
        )}
        <span className="hidden lg:inline">Share</span>
      </button>

      {open &&
        canExport &&
        pos &&
        createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[80] cursor-default"
              aria-label="Close"
              onClick={() => setOpen(false)}
            />
            <div
              className="fixed z-[90] w-[16.25rem] overflow-hidden rounded-lg border border-cinema-border bg-cinema-surface shadow-xl"
              style={{ top: pos.top, left: pos.left }}
            >
              <div className="border-b border-cinema-border px-2.5 py-1.5 text-[10px] uppercase tracking-widest text-cinema-muted">
                Save & share
              </div>
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => run(item.key, item.action)}
                  className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-cinema-panel disabled:opacity-50"
                >
                  <item.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cinema-cyan" />
                  <span className="min-w-0">
                    <span className="block text-[11px] text-white">
                      {busy === item.key ? "Working…" : item.label}
                    </span>
                    <span className="block text-[10px] text-cinema-muted">{item.hint}</span>
                  </span>
                </button>
              ))}
              {err && (
                <p className="border-t border-cinema-border px-2.5 py-1.5 text-[10px] text-cinema-magenta">
                  {err}
                </p>
              )}
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
