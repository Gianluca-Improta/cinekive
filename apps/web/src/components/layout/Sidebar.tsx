"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Clapperboard,
  Compass,
  Crown,
  ExternalLink,
  Film,
  Plus,
  Settings,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArchiveCreateModal } from "@/components/archives/ArchiveCreateModal";
import { CraftChatPanel } from "@/components/chat/CraftChatPanel";
import { SidebarArchivePill } from "@/components/layout/SidebarArchivePill";
import { ProjectManagerModal } from "@/components/projects/ProjectManagerModal";
import { ProjectSetupModal } from "@/components/projects/ProjectSetupModal";
import { PRO_UPGRADE_URL, useEntitlements } from "@/hooks/useEntitlements";
import { api } from "@/lib/api-client";
import { CREATOR_LINKS } from "@/lib/creator-links";
import { useI18n } from "@/lib/i18n/I18nProvider";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const SIDEBAR_W_KEY = "cinekive.sidebarWidth";
const SIDEBAR_MIN = 56;
const SIDEBAR_MAX = 440;
const SIDEBAR_DEFAULT = 256;
const SIDEBAR_SLIM = 72;

function projectKind(p: Project): string {
  return (p.kind || "commercial").toLowerCase();
}

function isArchiveProject(p: Project): boolean {
  const k = projectKind(p);
  if (k === "archive") return true;
  const slug = (p.slug || "").toLowerCase();
  return (
    slug.includes("archive") ||
    slug === "filmgrab" ||
    slug === "eyecandy" ||
    slug === "shotdeck" ||
    slug === "moviestillsdb" ||
    slug === "stillslab"
  );
}

function kindIcon(kind: string) {
  const k = kind.toLowerCase();
  if (k === "narrative" || k === "video") return Clapperboard;
  if (k === "stills" || k === "mixed") return Film;
  return Clapperboard;
}

function loadSidebarWidth(): number {
  try {
    const n = Number(localStorage.getItem(SIDEBAR_W_KEY));
    if (Number.isFinite(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n;
  } catch {
    /* ignore */
  }
  return SIDEBAR_DEFAULT;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useI18n();
  const { data: entitlements } = useEntitlements();
  const isPro = Boolean(entitlements?.is_pro);
  const upgradeUrl = entitlements?.upgrade_url || PRO_UPGRADE_URL;
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [createArchiveOpen, setCreateArchiveOpen] = useState(false);
  const [managerOpen, setManagerOpen] = useState(false);
  const [managerFocusId, setManagerFocusId] = useState<string | null>(null);
  const [width, setWidth] = useState(SIDEBAR_DEFAULT);
  const widthRef = useRef(width);
  const projectClickTimer = useRef<number | null>(null);
  widthRef.current = width;

  const openProject = (id: string) => {
    if (projectClickTimer.current) window.clearTimeout(projectClickTimer.current);
    projectClickTimer.current = window.setTimeout(() => {
      projectClickTimer.current = null;
      router.push(`/projects/${id}`);
    }, 260);
  };

  const manageProject = (id: string) => {
    if (projectClickTimer.current) {
      window.clearTimeout(projectClickTimer.current);
      projectClickTimer.current = null;
    }
    setManagerFocusId(id);
    setManagerOpen(true);
  };

  useEffect(() => {
    setWidth(loadSidebarWidth());
  }, []);

  const slim = width < SIDEBAR_SLIM;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startW + (ev.clientX - startX)));
      setWidth(next);
    };
    const up = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(SIDEBAR_W_KEY, String(widthRef.current));
      } catch {
        /* ignore */
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const { jobProjects, emptyJobProjects, archiveProjects, emptyArchiveProjects } = useMemo(() => {
    const jobs: Project[] = [];
    const archives: Project[] = [];
    for (const p of projects) {
      if (isArchiveProject(p)) archives.push(p);
      else jobs.push(p);
    }
    const byShotsThenName = (a: Project, b: Project) => {
      const d = (b.shot_count || 0) - (a.shot_count || 0);
      if (d !== 0) return d;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    };
    jobs.sort(byShotsThenName);
    archives.sort(byShotsThenName);
    return {
      jobProjects: jobs.filter((p) => (p.shot_count || 0) > 0),
      emptyJobProjects: jobs.filter((p) => !(p.shot_count > 0)),
      archiveProjects: archives.filter((p) => (p.shot_count || 0) > 0),
      emptyArchiveProjects: archives.filter((p) => !(p.shot_count > 0)),
    };
  }, [projects]);

  const [showEmptyProjects, setShowEmptyProjects] = useState(false);
  const [showEmptyArchives, setShowEmptyArchives] = useState(false);
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.push("/");
    },
  });

  const navItem = (href: string, label: string, Icon: typeof Compass, exact = false) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        title={label}
        className={cn(
          "mb-0.5 flex items-center rounded-lg text-sm transition",
          slim ? "justify-center px-2 py-2" : "gap-2 px-3 py-2",
          active
            ? "bg-cinema-cyan/10 text-cinema-cyan"
            : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {!slim && label}
      </Link>
    );
  };

  return (
    <aside
      className="relative flex h-full shrink-0 flex-col border-r border-white/[0.04] bg-cinema-surface"
      style={{ width }}
    >
      <div
        className={cn(
          "flex items-center border-b border-white/[0.04]",
          slim ? "justify-center px-1 py-3" : "gap-2 px-4 py-4"
        )}
      >
        <Film className="h-5 w-5 shrink-0 text-cinema-cyan" />
        {!slim && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-wide text-white">
              {t("brand.name")}
            </div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
              {t("brand.tagline")}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <nav className={cn("shrink-0 py-2", slim ? "px-1" : "px-2")}>
          {navItem("/", t("nav.discovery"), Compass, true)}
          {navItem("/favorites", t("nav.favorites"), Star, true)}
          {navItem("/bin", t("nav.bin"), Trash2, true)}
          <span data-tour="settings-nav">{navItem("/settings", t("nav.settings"), Settings, true)}</span>
        </nav>

        {!slim && (
          <>
            <div
              data-tour="projects"
              className="flex items-center justify-between px-4 pb-2 pt-3"
              onDoubleClick={() => {
                setManagerFocusId(null);
                setManagerOpen(true);
              }}
              title="Double-click for project manager"
            >
              <span className="text-xs uppercase tracking-widest text-cinema-muted">Projects</span>
              <button
                type="button"
                onClick={() => setCreateProjectOpen(true)}
                className="rounded border border-white/[0.06] p-1 text-cinema-cyan hover:bg-cinema-panel"
                title="New project"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <nav className="max-h-[32%] min-h-0 overflow-y-auto px-2 pb-2">
              {jobProjects.map((p) => {
                const active = pathname === `/projects/${p.id}`;
                const Icon = kindIcon(projectKind(p));
                return (
                  <div
                    key={p.id}
                    className={cn(
                      "group mb-0.5 flex items-center rounded-lg",
                      active ? "bg-cinema-cyan/10" : "hover:bg-cinema-panel"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openProject(p.id)}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        manageProject(p.id);
                      }}
                      title="Click to open · double-click to manage"
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm",
                        active ? "text-cinema-cyan" : "text-cinema-muted group-hover:text-white"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{p.name}</span>
                        <span className="text-[10px] text-cinema-muted">
                          {t(p.shot_count === 1 ? "nav.shotCountOne" : "nav.shotCount", {
                            n: p.shot_count,
                          })}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t("common.delete")}
                      onClick={() => {
                        if (confirm(t("nav.deleteConfirm", { name: p.name }))) {
                          deleteMutation.mutate(p.id);
                        }
                      }}
                      className="mr-1.5 hidden rounded p-1 text-cinema-muted hover:text-cinema-magenta group-hover:block"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              {emptyJobProjects.length > 0 && (
                <div className="mb-0.5">
                  <button
                    type="button"
                    onClick={() => setShowEmptyProjects((v) => !v)}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white"
                  >
                    {showEmptyProjects ? "Hide" : "+"} {emptyJobProjects.length} empty
                  </button>
                  {showEmptyProjects &&
                    emptyJobProjects.map((p) => {
                      const active = pathname === `/projects/${p.id}`;
                      const Icon = kindIcon(projectKind(p));
                      return (
                        <div
                          key={p.id}
                          className={cn(
                            "group mb-0.5 flex items-center rounded-lg",
                            active ? "bg-cinema-cyan/10" : "hover:bg-cinema-panel"
                          )}
                        >
                          <Link
                            href={`/projects/${p.id}`}
                            className={cn(
                              "flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-sm",
                              active
                                ? "text-cinema-cyan"
                                : "text-cinema-muted group-hover:text-white"
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                            <span className="min-w-0 flex-1 truncate opacity-80">{p.name}</span>
                          </Link>
                          <button
                            type="button"
                            title={t("common.delete")}
                            aria-label={t("common.delete")}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (confirm(t("nav.deleteConfirm", { name: p.name }))) {
                                deleteMutation.mutate(p.id);
                              }
                            }}
                            className="mr-1.5 hidden rounded p-1 text-cinema-muted hover:text-cinema-magenta group-hover:block"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
              {jobProjects.length === 0 && emptyJobProjects.length === 0 && (
                <button
                  type="button"
                  onClick={() => setCreateProjectOpen(true)}
                  className="w-full rounded-lg border border-dashed border-white/[0.06] px-3 py-3 text-left text-[11px] leading-relaxed text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
                >
                  New project — name, vibe, and brief in one popup.
                </button>
              )}
            </nav>

            <div className="flex min-h-0 flex-1 flex-col pt-2" data-tour="archives">
              <div className="mb-1 flex items-center justify-between px-4">
                <Link
                  href="/archives"
                  className="text-xs uppercase tracking-widest text-cinema-muted hover:text-cinema-cyan"
                  title={t("nav.archivesHubHint")}
                >
                  Archives
                </Link>
                <button
                  type="button"
                  onClick={() => setCreateArchiveOpen(true)}
                  className="rounded border border-white/[0.06] p-1 text-cinema-cyan hover:bg-cinema-panel"
                  title="New archive"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {archiveProjects.map((p) => (
                  <SidebarArchivePill
                    key={p.id}
                    project={p}
                    active={pathname === `/projects/${p.id}`}
                    shotLabel={t(p.shot_count === 1 ? "nav.shotCountOne" : "nav.shotCount", {
                      n: p.shot_count,
                    })}
                    onDelete={() => {
                      if (confirm(t("nav.deleteConfirm", { name: p.name }))) {
                        deleteMutation.mutate(p.id);
                      }
                    }}
                  />
                ))}
                {emptyArchiveProjects.length > 0 && (
                  <div className="mb-0.5">
                    <button
                      type="button"
                      onClick={() => setShowEmptyArchives((v) => !v)}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white"
                    >
                      {showEmptyArchives ? "Hide" : "+"} {emptyArchiveProjects.length} empty
                    </button>
                    {showEmptyArchives &&
                      emptyArchiveProjects.map((p) => (
                        <SidebarArchivePill
                          key={p.id}
                          project={p}
                          active={pathname === `/projects/${p.id}`}
                          shotLabel={t(p.shot_count === 1 ? "nav.shotCountOne" : "nav.shotCount", {
                            n: p.shot_count,
                          })}
                          onDelete={() => {
                            if (confirm(t("nav.deleteConfirm", { name: p.name }))) {
                              deleteMutation.mutate(p.id);
                            }
                          }}
                        />
                      ))}
                  </div>
                )}
                {archiveProjects.length === 0 && emptyArchiveProjects.length === 0 && (
                  <button
                    type="button"
                    onClick={() => setCreateArchiveOpen(true)}
                    className="mb-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-white/[0.06] px-3 py-2.5 text-sm text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
                  >
                    <Archive className="h-3.5 w-3.5 shrink-0" />
                    Add an archive…
                  </button>
                )}
              </nav>
            </div>

            <div className="shrink-0 px-2 py-2" data-tour="pro">
              {isPro ? (
                <Link
                  href="/settings?tab=license"
                  className="mb-0.5 flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-cinema-muted hover:bg-cinema-panel hover:text-white"
                >
                  <Crown className="h-3.5 w-3.5 shrink-0 text-cinema-cyan" />
                  Pro license
                </Link>
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-white/[0.05] px-3 py-2">
                    <a
                      href={upgradeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm text-cinema-cyan hover:underline"
                    >
                      <Crown className="h-3.5 w-3.5 shrink-0" />
                      Upgrade to Pro
                    </a>
                    <Link
                      href="/settings?tab=license"
                      className="mt-1 block text-[11px] text-cinema-muted hover:text-white"
                    >
                      Have a license key?
                    </Link>
                  </div>
                  <div className="rounded-lg border border-white/[0.05] px-3 py-2">
                    <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                      More from us
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {(Object.keys(CREATOR_LINKS) as (keyof typeof CREATOR_LINKS)[]).map((key) => {
                        const item = CREATOR_LINKS[key];
                        return (
                          <a
                            key={key}
                            href={item.href}
                            target="_blank"
                            rel="noreferrer"
                            title={item.blurb}
                            className="flex items-center justify-between gap-1 rounded px-0.5 py-0.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
                          >
                            <span className="truncate">{item.label}</span>
                            <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
                          </a>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {slim && (
          <div className="mt-auto flex flex-col items-center gap-1 px-1 pb-2">
            <Link
              href="/archives"
              title={t("nav.archivesHub")}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-cinema-muted hover:bg-cinema-panel hover:text-cinema-cyan"
            >
              <Archive className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              title="New project"
              onClick={() => setCreateProjectOpen(true)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-cinema-cyan hover:bg-cinema-panel"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/settings?tab=license"
              title={isPro ? "Pro license" : "Activate Pro"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-cinema-muted hover:bg-cinema-panel hover:text-white"
            >
              <Crown className={cn("h-3.5 w-3.5", isPro && "text-cinema-cyan")} />
            </Link>
          </div>
        )}
      </div>

      <CraftChatPanel compact={slim} />

      <button
        type="button"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to slim/expand"
        onPointerDown={startDrag}
        onDoubleClick={() => {
          const next = slim ? SIDEBAR_DEFAULT : SIDEBAR_MIN;
          setWidth(next);
          try {
            localStorage.setItem(SIDEBAR_W_KEY, String(next));
          } catch {
            /* ignore */
          }
        }}
        className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize border-0 bg-transparent hover:bg-cinema-cyan/25 active:bg-cinema-cyan/40"
      />

      <ProjectSetupModal open={createProjectOpen} onClose={() => setCreateProjectOpen(false)} />
      <ArchiveCreateModal open={createArchiveOpen} onClose={() => setCreateArchiveOpen(false)} />
      <ProjectManagerModal
        open={managerOpen}
        focusId={managerFocusId}
        onClose={() => {
          setManagerOpen(false);
          setManagerFocusId(null);
        }}
      />
    </aside>
  );
}
