"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronRight, RefreshCw, Sparkles, X } from "lucide-react";
import { api } from "@/lib/api-client";
import type { Job } from "@/lib/types";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cinekive.activityLogOpen";
const DISMISS_KEY = "cinekive.activityDismissed";
const OPEN_EVENT = "cinekive:activity-open";
const TOGGLE_EVENT = "cinekive:activity-toggle";
/** Auto-hide completed/failed jobs from the badge after this many ms */
const AUTO_CLEAR_MS = 45_000;
const PANEL_W = "22rem";

export function openActivityPanel() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function toggleActivityPanel() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
}

function statusColor(status: Job["status"]) {
  if (status === "failed") return "text-cinema-magenta";
  if (status === "completed") return "text-emerald-400";
  if (status === "running" || status === "pending") return "text-cinema-cyan";
  return "text-cinema-muted";
}

function formatJobType(type: string) {
  const map: Record<string, string> = {
    ingest: "Ingest media",
    enrich: "Craft enrichment",
    enrich_drip: "Background craft enrich",
    dedupe: "Deduplicate shots",
    dedupe_global: "Global dedupe",
    reindex: "Rebuild search index",
    dialogue: "Dialogue / speech",
    preview: "Preview generation",
    scrape: "Archive scrape",
    mirror: "Mirror sync",
    generate: "Generate still",
    export: "Export",
  };
  return map[type] || type.replace(/_/g, " ");
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

function formatClock(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function payloadHints(payload: Record<string, unknown> | null | undefined): string[] {
  if (!payload || typeof payload !== "object") return [];
  const out: string[] = [];
  const pick = (key: string, label?: string) => {
    const v = payload[key];
    if (v == null || v === "") return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out.push(label ? `${label}: ${v}` : String(v));
    }
  };
  pick("source_path", "Source");
  pick("path", "Path");
  pick("folder", "Folder");
  pick("url", "URL");
  pick("archive_slug", "Archive");
  pick("source_id", "Source");
  pick("provider");
  pick("query", "Query");
  pick("film_title", "Film");
  pick("title", "Title");
  pick("filename");
  pick("mode", "Mode");
  pick("sampling_mode", "Sampling");
  if (typeof payload.limit === "number") out.push(`Limit ${payload.limit}`);
  if (Array.isArray(payload.paths) && payload.paths.length) {
    out.push(`${payload.paths.length} path${payload.paths.length === 1 ? "" : "s"}`);
  }
  if (Array.isArray(payload.shot_ids) && payload.shot_ids.length) {
    out.push(`${payload.shot_ids.length} shot${payload.shot_ids.length === 1 ? "" : "s"}`);
  }
  return out.slice(0, 4);
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

function setActivityGutter(open: boolean) {
  try {
    document.documentElement.style.setProperty("--activity-rail", open ? PANEL_W : "0px");
    document.documentElement.dataset.activityOpen = open ? "1" : "0";
  } catch {
    /* ignore */
  }
}

export function ActivityLogPanel() {
  const qc = useQueryClient();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Record<string, number>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const prevActive = useRef(0);
  const prevEnrichBusy = useRef(false);
  const openRef = useRef(false);

  useEffect(() => {
    try {
      const next = localStorage.getItem(STORAGE_KEY) === "1";
      setOpen(next);
      openRef.current = next;
      setActivityGutter(next);
      setDismissed(readDismissed());
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = (next: boolean) => {
    setOpen(next);
    openRef.current = next;
    setActivityGutter(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    const onOpen = () => toggle(true);
    const onToggle = () => toggle(!openRef.current);
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(TOGGLE_EVENT, onToggle);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(TOGGLE_EVENT, onToggle);
    };
  }, []);

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

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
    staleTime: 60_000,
  });

  const projectName = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projects) map.set(p.id, p.name);
    return map;
  }, [projects]);

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

  const showFab = !open && (activeCount > 0 || failCount > 0 || enrichActive);

  return (
    <>
      {showFab && (
        <button
          type="button"
          onClick={() => toggle(true)}
          title="Activity"
          className={cn(
            "fixed bottom-4 z-40 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg transition",
            "right-4",
            activeCount || enrich?.busy
              ? "border-cinema-cyan/50 bg-cinema-surface text-cinema-cyan"
              : failCount
                ? "border-cinema-magenta/40 bg-cinema-surface text-cinema-magenta"
                : "border-white/[0.08] bg-cinema-surface text-cinema-muted hover:text-white"
          )}
        >
          <Activity className="h-3.5 w-3.5" />
          Activity
          {(activeCount > 0 || enrich?.busy) && (
            <span className="rounded bg-cinema-cyan/20 px-1.5 py-0.5 font-mono text-[10px]">
              {activeCount + (enrich?.busy ? 1 : 0)}
            </span>
          )}
          {failCount > 0 && activeCount === 0 && !enrich?.busy && (
            <span className="rounded bg-cinema-magenta/20 px-1.5 py-0.5 font-mono text-[10px]">
              {failCount}
            </span>
          )}
        </button>
      )}

      <aside
        aria-hidden={!open}
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden bg-cinema-surface transition-[width] duration-200 ease-out",
          open ? "w-[22rem] border-l border-white/[0.06]" : "w-0 border-l-0"
        )}
      >
        <div className="flex h-full w-[22rem] flex-col">
          <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-cinema-cyan" />
              <div>
                <div className="text-sm font-medium text-white">{t("activity.title")}</div>
                <div className="text-[10px] text-cinema-muted">
                  {activeCount > 0
                    ? `${activeCount} running`
                    : failCount > 0
                      ? `${failCount} need attention`
                      : t("activity.subtitle")}
                </div>
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

          <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-1.5">
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
                  "mb-2 rounded-lg px-2.5 py-2",
                  enrich.busy
                    ? "bg-cinema-cyan/5 ring-1 ring-cinema-cyan/25"
                    : enrich.vlm_reachable
                      ? "bg-cinema-black/40"
                      : "bg-amber-500/5 ring-1 ring-amber-500/20"
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
                <div className="mt-1.5 space-y-0.5 font-mono text-[10px] text-cinema-cyan/80">
                  {(enrich.pending_shots ?? 0) > 0 && (
                    <p>
                      {enrich.pending_shots} {t("activity.inQueue")}
                    </p>
                  )}
                  {enrich.last_model ? <p>Model · {enrich.last_model}</p> : null}
                  {enrich.last_pass_at ? (
                    <p className="text-cinema-muted">
                      Last pass · {relativeTime(new Date(enrich.last_pass_at * 1000).toISOString())}
                    </p>
                  ) : null}
                  {typeof enrich.last_processed === "number" && enrich.last_processed > 0 ? (
                    <p className="text-cinema-muted">Last batch · {enrich.last_processed} shots</p>
                  ) : null}
                </div>
              </div>
            )}

            {visibleJobs.length === 0 ? (
              <p className="px-2 py-6 text-xs leading-relaxed text-cinema-muted">
                {t("activity.empty")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {visibleJobs.map((job) => {
                  const proj = job.project_id ? projectName.get(job.project_id) : null;
                  const hints = payloadHints(job.payload_json);
                  const isOpen = Boolean(expanded[job.id]);
                  const pct = Math.min(100, Math.max(0, job.progress_pct || 0));
                  const step =
                    job.status === "failed"
                      ? job.error_message || "Failed"
                      : job.current_step || "Waiting…";
                  const counts =
                    job.total_items > 0
                      ? `${job.processed_items} / ${job.total_items}`
                      : job.processed_items > 0
                        ? `${job.processed_items} done`
                        : null;
                  return (
                    <li key={job.id} className="rounded-lg bg-cinema-black/45 px-2.5 py-2">
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() =>
                          setExpanded((m) => ({ ...m, [job.id]: !m[job.id] }))
                        }
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "text-[11px] font-medium capitalize",
                              statusColor(job.status)
                            )}
                          >
                            {job.status}
                            {(job.status === "running" || job.status === "pending") && pct > 0
                              ? ` · ${Math.round(pct)}%`
                              : ""}
                          </span>
                          <span className="font-mono text-[10px] text-cinema-muted">
                            {relativeTime(job.finished_at || job.started_at || job.created_at)}
                          </span>
                        </div>
                        <div className="text-xs text-white">{formatJobType(job.type)}</div>
                        {proj && (
                          <div className="mt-0.5 truncate text-[10px] text-cinema-cyan/80">
                            {proj}
                          </div>
                        )}
                        {(job.status === "running" || job.status === "pending") && (
                          <div className="mt-1.5 h-1 overflow-hidden rounded bg-cinema-black">
                            <div
                              className="h-full bg-cinema-cyan transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        )}
                        <p className="mt-1 text-[10px] leading-snug text-cinema-muted">{step}</p>
                        {counts && (
                          <p className="mt-0.5 font-mono text-[10px] text-cinema-muted/90">
                            {counts} items
                          </p>
                        )}
                      </button>

                      {isOpen && (
                        <div className="mt-2 space-y-1 border-t border-white/[0.05] pt-2 text-[10px] leading-relaxed text-cinema-muted">
                          {hints.map((h) => (
                            <p key={h} className="break-all">
                              {h}
                            </p>
                          ))}
                          {formatClock(job.started_at) && (
                            <p>Started · {formatClock(job.started_at)}</p>
                          )}
                          {formatClock(job.finished_at) && (
                            <p>Finished · {formatClock(job.finished_at)}</p>
                          )}
                          {job.error_message && job.status !== "failed" && (
                            <p className="text-cinema-magenta">{job.error_message}</p>
                          )}
                          <p className="font-mono text-cinema-muted/70">id {job.id.slice(0, 8)}</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => toggle(false)}
            className="flex items-center justify-center gap-1 border-t border-white/[0.06] py-2 text-[11px] text-cinema-muted hover:text-white"
          >
            <ChevronRight className="h-3 w-3" />
            Hide
          </button>
        </div>
      </aside>
    </>
  );
}
