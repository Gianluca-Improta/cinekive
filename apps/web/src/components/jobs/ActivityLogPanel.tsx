"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, RefreshCw, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Job } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cinekive.activityLogOpen";
const DISMISS_KEY = "cinekive.activityDismissed";
/** Auto-hide completed/failed jobs from the badge after this many ms */
const AUTO_CLEAR_MS = 45_000;

function statusColor(status: Job["status"]) {
  if (status === "failed") return "text-cinema-magenta";
  if (status === "completed") return "text-emerald-400";
  if (status === "running" || status === "pending") return "text-cinema-cyan";
  return "text-cinema-muted";
}

function formatJobType(type: string) {
  if (type === "enrich_drip") return "craft enrich (background)";
  return type.replace(/_/g, " ");
}

function relativeTime(iso: string | null) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const sec = Math.round((Date.now() - t) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function readDismissed(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeDismissed(map: Record<string, number>) {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function ActivityLogPanel() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const prevActive = useRef(0);
  const prevEnrichBusy = useRef(false);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem(STORAGE_KEY) === "1");
      setDismissed(readDismissed());
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  const { data, refetch, isFetching } = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.listActivity(40),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const enrich = query.state.data?.enrich;
      const active = items.some((j) => j.status === "pending" || j.status === "running");
      const enrichLive =
        enrich?.continuous && (enrich.busy || (enrich.pending_shots ?? 0) > 0);
      return active || enrichLive ? 2000 : 8000;
    },
  });

  const jobs = data?.items ?? [];
  const enrich = data?.enrich;
  const now = Date.now();

  useEffect(() => {
    const terminal = jobs.filter(
      (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
    );
    if (!terminal.length) return;
    const next = { ...readDismissed() };
    let changed = false;
    for (const j of terminal) {
      if (next[j.id]) continue;
      const end = new Date(j.finished_at || j.created_at).getTime();
      if (!Number.isNaN(end) && now - end > AUTO_CLEAR_MS) {
        next[j.id] = now;
        changed = true;
      }
    }
    if (changed) {
      writeDismissed(next);
      setDismissed(next);
    }
  }, [jobs, now]);

  useEffect(() => {
    const active = jobs.filter((j) => j.status === "pending" || j.status === "running").length;
    const enrichBusy = Boolean(enrich?.busy);
    if ((prevActive.current > 0 && active === 0) || (prevEnrichBusy.current && !enrichBusy)) {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
    }
    prevActive.current = active;
    prevEnrichBusy.current = enrichBusy;
  }, [jobs, enrich?.busy, qc]);

  const visibleJobs = jobs.filter((j) => {
    if (j.status === "pending" || j.status === "running") return true;
    return !dismissed[j.id];
  });

  const activeCount = jobs.filter((j) => j.status === "pending" || j.status === "running").length;
  const failCount = visibleJobs.filter((j) => j.status === "failed").length;
  const enrichActive =
    enrich?.continuous &&
    enrich.enabled &&
    (enrich.busy || (enrich.pending_shots ?? 0) > 0 || !enrich.vlm_reachable);

  const clearFinished = () => {
    const next = { ...dismissed };
    const t = Date.now();
    for (const j of jobs) {
      if (j.status !== "pending" && j.status !== "running") next[j.id] = t;
    }
    writeDismissed(next);
    setDismissed(next);
  };

  const showFab = open || activeCount > 0 || failCount > 0 || enrichActive;

  return (
    <>
      {!open && showFab && (
        <button
          type="button"
          onClick={() => toggle(true)}
          title="Activity"
          className={cn(
            "fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs shadow-lg transition",
            activeCount || enrich?.busy
              ? "border-cinema-cyan/50 bg-cinema-surface text-cinema-cyan"
              : failCount
                ? "border-cinema-magenta/40 bg-cinema-surface text-cinema-magenta"
                : enrichActive
                  ? "border-cinema-cyan/40 bg-cinema-surface text-cinema-cyan/90"
                  : "border-cinema-border bg-cinema-surface text-cinema-muted hover:text-white"
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Activity
          {(activeCount > 0 || enrich?.busy) && (
            <span className="rounded-full bg-cinema-cyan/20 px-1.5 py-0.5 font-mono text-[10px]">
              {activeCount + (enrich?.busy ? 1 : 0)}
            </span>
          )}
          {failCount > 0 && activeCount === 0 && !enrich?.busy && (
            <span className="rounded-full bg-cinema-magenta/20 px-1.5 py-0.5 font-mono text-[10px]">
              {failCount}
            </span>
          )}
        </button>
      )}

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-80 flex-col border-l border-cinema-border bg-cinema-surface shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full pointer-events-none"
        )}
      >
        <div className="flex items-center justify-between border-b border-cinema-border px-3 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cinema-cyan" />
            <div>
              <div className="text-sm font-medium text-white">{t("activity.title")}</div>
              <div className="text-[10px] text-cinema-muted">{t("activity.subtitle")}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => refetch()}
              className="rounded p-1 text-cinema-muted hover:bg-cinema-panel hover:text-white"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={() => toggle(false)}
              className="rounded p-1 text-cinema-muted hover:bg-cinema-panel hover:text-white"
              title="Hide"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-cinema-border/60 px-3 py-1.5">
          <button
            type="button"
            onClick={clearFinished}
            className="text-[10px] text-cinema-muted hover:text-cinema-cyan"
          >
            {t("activity.clearFinished")}
          </button>
          <span className="text-[10px] text-cinema-muted">{t("activity.autoClear")}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {enrich?.continuous && enrich.enabled && (
            <div
              className={cn(
                "mb-2 rounded border px-2.5 py-2",
                enrich.busy
                  ? "border-cinema-cyan/40 bg-cinema-cyan/5"
                  : enrich.vlm_reachable
                    ? "border-cinema-border/60 bg-cinema-black/40"
                    : "border-amber-500/30 bg-amber-500/5"
              )}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-cinema-cyan" />
                <span className="text-[11px] font-medium text-white">{t("activity.craftEnrich")}</span>
                <span
                  className={cn(
                    "ml-auto text-[10px] capitalize",
                    enrich.busy
                      ? "text-cinema-cyan"
                      : enrich.vlm_reachable
                        ? "text-emerald-400"
                        : "text-amber-400"
                  )}
                >
                  {enrich.busy
                    ? t("activity.running")
                    : enrich.vlm_reachable
                      ? t("activity.background")
                      : t("activity.waitingVlm")}
                </span>
              </div>
              <p className="text-[10px] leading-relaxed text-cinema-muted">
                {enrich.current_step ||
                  (enrich.pending_shots
                    ? t("activity.shotsQueued", { count: enrich.pending_shots })
                    : t("activity.upToDate"))}
              </p>
              {(enrich.pending_shots ?? 0) > 0 && (
                <p className="mt-1 font-mono text-[10px] text-cinema-cyan/80">
                  {enrich.pending_shots} {t("activity.inQueue")}
                  {enrich.last_model ? ` · ${enrich.last_model}` : ""}
                </p>
              )}
            </div>
          )}

          {visibleJobs.length === 0 ? (
            <p className="px-2 py-6 text-xs leading-relaxed text-cinema-muted">
              {t("activity.empty")}
            </p>
          ) : (
            <ul className="space-y-1">
              {visibleJobs.map((job) => (
                <li
                  key={job.id}
                  className="rounded border border-cinema-border/60 bg-cinema-black/40 px-2.5 py-2"
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className={cn("text-[11px] font-medium capitalize", statusColor(job.status))}>
                      {job.status}
                    </span>
                    <span className="font-mono text-[10px] text-cinema-muted">
                      {relativeTime(job.finished_at || job.started_at || job.created_at)}
                    </span>
                  </div>
                  <div className="truncate text-xs text-white">{formatJobType(job.type)}</div>
                  {(job.status === "running" || job.status === "pending") && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded bg-cinema-black">
                      <div
                        className="h-full bg-cinema-cyan transition-all"
                        style={{ width: `${Math.min(100, job.progress_pct || 0)}%` }}
                      />
                    </div>
                  )}
                  <p className="mt-1 truncate text-[10px] text-cinema-muted">
                    {job.status === "failed"
                      ? job.error_message || "Failed"
                      : job.current_step ||
                        `${job.processed_items}/${job.total_items || "…"}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          onClick={() => toggle(false)}
          className="flex items-center justify-center gap-1 border-t border-cinema-border py-2 text-[11px] text-cinema-muted hover:text-white"
        >
          <ChevronRight className="h-3 w-3" />
          Hide
        </button>
      </aside>
    </>
  );
}
