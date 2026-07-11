"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Film,
  Plus,
  Settings,
  Smartphone,
  Star,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api-client";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/I18nProvider";

type CreateKind = "commercial" | "social" | "narrative";

function projectKind(p: Project): string {
  return (p.kind || "commercial").toLowerCase();
}

function formLabel(p: Project): string | null {
  if (p.form_factor === "short_form") return "short";
  if (p.form_factor === "long_form") return "long";
  if (p.aspect_ratio) return p.aspect_ratio;
  return null;
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { t } = useI18n();
  const [creatingKind, setCreatingKind] = useState<CreateKind | null>(null);
  const [name, setName] = useState("");
  const [formFactor, setFormFactor] = useState<"long_form" | "short_form" | "mixed" | "">("");
  const [aspect, setAspect] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.listProjects,
  });

  const narratives = projects.filter((p) => projectKind(p) === "narrative");
  const commercials = projects.filter((p) => {
    const k = projectKind(p);
    return k === "commercial" || k === "general";
  });
  const socials = projects.filter((p) => projectKind(p) === "social");
  const archives = projects.filter((p) => {
    const k = projectKind(p);
    if (k === "archive") return true;
    const slug = (p.slug || "").toLowerCase();
    return (
      !k &&
      (slug.includes("archive") ||
        slug === "filmgrab" ||
        slug === "eyecandy" ||
        slug === "shotdeck" ||
        slug === "moviestillsdb" ||
        slug === "stillslab")
    );
  });
  const archiveIds = new Set(archives.map((p) => p.id));
  const commercialList = [
    ...commercials,
    ...projects.filter(
      (p) =>
        !p.kind &&
        !archiveIds.has(p.id) &&
        projectKind(p) !== "social" &&
        projectKind(p) !== "narrative"
    ),
  ];

  const createMutation = useMutation({
    mutationFn: () =>
      api.createProject({
        name:
          name.trim() ||
          (creatingKind === "social"
            ? "Untitled Social"
            : creatingKind === "narrative"
              ? "Untitled Narrative"
              : "Untitled Commercial"),
        kind: creatingKind || "commercial",
        form_factor: formFactor || undefined,
        aspect_ratio: aspect || undefined,
        sampling_mode: creatingKind === "narrative" ? "moments" : "heroes",
        generate_previews: true,
        vlm_enrichment: true,
      }),
    onSuccess: (project) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setCreatingKind(null);
      setName("");
      setFormFactor("");
      setAspect("");
      router.push(`/projects/${project.id}`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      router.push("/");
    },
  });

  const renderProjectList = (items: Project[]) =>
    items.map((p) => {
      const active = pathname === `/projects/${p.id}`;
      const sub = formLabel(p);
      return (
        <div
          key={p.id}
          className={cn(
            "group mb-1 flex items-center rounded",
            active ? "bg-cinema-cyan/10" : "hover:bg-cinema-panel"
          )}
        >
          <Link
            href={`/projects/${p.id}`}
            className={cn(
              "flex-1 truncate px-3 py-2 text-sm",
              active ? "text-cinema-cyan" : "text-cinema-muted group-hover:text-white"
            )}
          >
            <span className="block truncate">{p.name}</span>
            <span className="text-[10px] text-cinema-muted">
              {p.shot_count} shots{sub ? ` · ${sub}` : ""}
            </span>
          </Link>
          <button
            type="button"
            title="Delete"
            onClick={() => {
              if (confirm(`Delete “${p.name}”?`)) deleteMutation.mutate(p.id);
            }}
            className="mr-2 hidden rounded p-1 text-cinema-muted hover:text-cinema-magenta group-hover:block"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      );
    });

  const createForm = (kind: CreateKind) => (
    <div className="space-y-2 border-b border-cinema-border px-3 pb-3">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") createMutation.mutate();
          if (e.key === "Escape") setCreatingKind(null);
        }}
        placeholder={
          kind === "social"
            ? "Campaign / channel name"
            : kind === "narrative"
              ? "Title name"
              : "Job / brand name"
        }
        className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-sm text-white outline-none focus:border-cinema-cyan"
      />
      {kind === "social" && (
        <div className="flex gap-2">
          <select
            value={formFactor}
            onChange={(e) => setFormFactor(e.target.value as typeof formFactor)}
            className="flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-cinema-muted outline-none"
          >
            <option value="">Form…</option>
            <option value="short_form">Short form</option>
            <option value="long_form">Long form</option>
            <option value="mixed">Mixed</option>
          </select>
          <select
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            className="flex-1 rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-cinema-muted outline-none"
          >
            <option value="">Aspect…</option>
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="4:5">4:5</option>
            <option value="16:9">16:9</option>
            <option value="mixed">Mixed</option>
          </select>
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="flex-1 rounded bg-cinema-cyan/20 px-2 py-1 text-xs text-cinema-cyan hover:bg-cinema-cyan/30"
        >
          Create
        </button>
        <button
          type="button"
          onClick={() => setCreatingKind(null)}
          className="rounded px-2 py-1 text-xs text-cinema-muted hover:text-white"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-cinema-border bg-cinema-surface">
      <div className="flex items-center gap-2 border-b border-cinema-border px-4 py-4">
        <Film className="h-5 w-5 text-cinema-cyan" />
        <div>
          <div className="text-sm font-semibold tracking-wide text-white">{t("brand.name")}</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-cinema-muted">
            {t("brand.tagline")}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Narrative */}
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <span className="text-xs uppercase tracking-widest text-cinema-muted">
              {t("nav.narrative")}
            </span>
            <p className="mt-0.5 text-[10px] leading-snug text-cinema-muted/80">
              {t("nav.narrativeHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingKind("narrative")}
            className="rounded border border-cinema-border p-1 text-cinema-cyan hover:bg-cinema-panel"
            title="New narrative title"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {creatingKind === "narrative" && createForm("narrative")}
        <nav className="max-h-40 overflow-y-auto px-2 pb-2">
          {renderProjectList(narratives)}
          {narratives.length === 0 && creatingKind !== "narrative" && (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-cinema-muted">
              Features, episodes, shorts — drop footage or paste a URL to ingest.
            </p>
          )}
        </nav>

        {/* Commercials */}
        <div className="flex items-center justify-between border-t border-cinema-border px-4 py-3">
          <div>
            <span className="text-xs uppercase tracking-widest text-cinema-muted">
              {t("nav.commercial")}
            </span>
            <p className="mt-0.5 text-[10px] leading-snug text-cinema-muted/80">
              {t("nav.commercialHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingKind("commercial")}
            className="rounded border border-cinema-border p-1 text-cinema-cyan hover:bg-cinema-panel"
            title="New commercial library"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {creatingKind === "commercial" && createForm("commercial")}
        <nav className="px-2 pb-2">
          {renderProjectList(commercialList)}
          {commercialList.length === 0 && creatingKind !== "commercial" && (
            <p className="px-3 py-2 text-[11px] text-cinema-muted">
              Spot libraries, brand decks, paid work.
            </p>
          )}
        </nav>

        {/* Social */}
        <div className="flex items-center justify-between border-t border-cinema-border px-4 py-3">
          <div>
            <span className="text-xs uppercase tracking-widest text-cinema-muted">
              {t("nav.social")}
            </span>
            <p className="mt-0.5 text-[10px] leading-snug text-cinema-muted/80">
              {t("nav.socialHint")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreatingKind("social")}
            className="rounded border border-cinema-border p-1 text-cinema-cyan hover:bg-cinema-panel"
            title="New social library"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {creatingKind === "social" && createForm("social")}
        <nav className="px-2 pb-2">
          {socials.map((p) => {
            const active = pathname === `/projects/${p.id}`;
            const sub = [p.form_factor?.replace("_", " "), p.aspect_ratio].filter(Boolean).join(" · ");
            return (
              <div
                key={p.id}
                className={cn(
                  "group mb-1 flex items-center rounded",
                  active ? "bg-cinema-cyan/10" : "hover:bg-cinema-panel"
                )}
              >
                <Link
                  href={`/projects/${p.id}`}
                  className={cn(
                    "flex flex-1 items-start gap-2 truncate px-3 py-2 text-sm",
                    active ? "text-cinema-cyan" : "text-cinema-muted group-hover:text-white"
                  )}
                >
                  <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.name}</span>
                    <span className="text-[10px] text-cinema-muted">
                      {p.shot_count} shots{sub ? ` · ${sub}` : ""}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  title="Delete"
                  onClick={() => {
                    if (confirm(`Delete “${p.name}”?`)) deleteMutation.mutate(p.id);
                  }}
                  className="mr-2 hidden rounded p-1 text-cinema-muted hover:text-cinema-magenta group-hover:block"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {socials.length === 0 && creatingKind !== "social" && (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-cinema-muted">
              Intention shelf. Tag short/long and aspect when useful — shots keep their own ratio
              in metadata.
            </p>
          )}
        </nav>

        {/* Archives — first-class category */}
        <div className="flex items-center justify-between border-t border-cinema-border px-4 py-3">
          <div>
            <span className="text-xs uppercase tracking-widest text-cinema-muted">
              {t("nav.archives")}
            </span>
            <p className="mt-0.5 text-[10px] leading-snug text-cinema-muted/80">
              {t("nav.archivesHint")}
            </p>
          </div>
          <Link
            href="/archives"
            className="rounded border border-cinema-border p-1 text-cinema-cyan hover:bg-cinema-panel"
            title="Archives hub — create / upload"
          >
            <Plus className="h-3.5 w-3.5" />
          </Link>
        </div>
        <nav className="max-h-36 overflow-y-auto px-2 pb-2">
          <Link
            href="/archives"
            className={cn(
              "mb-1 flex items-center gap-2 rounded px-3 py-2 text-sm transition",
              pathname === "/archives"
                ? "bg-cinema-cyan/10 text-cinema-cyan"
                : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
            )}
          >
            <Archive className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t("nav.archivesHub")}</span>
              <span className="text-[10px] text-cinema-muted">{t("nav.archivesHubHint")}</span>
            </span>
          </Link>
          {archives.map((p) => {
            const active = pathname === `/projects/${p.id}`;
            return (
              <Link
                key={p.id}
                href={`/projects/${p.id}`}
                className={cn(
                  "mb-1 flex items-center gap-2 rounded px-3 py-2 text-sm transition",
                  active
                    ? "bg-cinema-cyan/10 text-cinema-cyan"
                    : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
                )}
              >
                <Archive className="h-3.5 w-3.5 shrink-0 opacity-70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="text-[10px] text-cinema-muted">{p.shot_count} shots</span>
                </span>
              </Link>
            );
          })}
          {archives.length === 0 && (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-cinema-muted">
              FilmGrab / EyeCandy live here. Add your own dump or a new service from the hub.
            </p>
          )}
        </nav>

        {/* Global links */}
        <div className="border-t border-cinema-border px-2 py-3">
          <Link
            href="/"
            className={cn(
              "mb-1 block rounded px-3 py-2 text-sm transition",
              pathname === "/"
                ? "bg-cinema-cyan/10 text-cinema-cyan"
                : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
            )}
          >
            {t("nav.discovery")}
          </Link>
          <Link
            href="/favorites"
            className={cn(
              "mb-1 flex items-center gap-2 rounded px-3 py-2 text-sm transition",
              pathname === "/favorites"
                ? "bg-cinema-cyan/10 text-cinema-cyan"
                : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
            )}
          >
            <Star className="h-3.5 w-3.5 shrink-0" />
            {t("nav.favorites")}
          </Link>
          <Link
            href="/bin"
            className={cn(
              "mb-1 block rounded px-3 py-2 text-sm transition",
              pathname === "/bin"
                ? "bg-cinema-cyan/10 text-cinema-cyan"
                : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
            )}
          >
            {t("nav.bin")}
          </Link>
          <Link
            href="/settings"
            className={cn(
              "mb-1 flex items-center gap-2 rounded px-3 py-2 text-sm transition",
              pathname === "/settings"
                ? "bg-cinema-cyan/10 text-cinema-cyan"
                : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
            )}
          >
            <Settings className="h-3.5 w-3.5 shrink-0" />
            Settings
          </Link>
          <div className="mt-3 space-y-1 border-t border-cinema-border/60 pt-3">
            <a
              href="https://framechain.ai"
              target="_blank"
              rel="noreferrer"
              className="block rounded px-3 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
            >
              Framechain — AI video
            </a>
            <a
              href="https://gianlucaimprota.com"
              target="_blank"
              rel="noreferrer"
              className="block rounded px-3 py-1.5 text-[11px] text-cinema-muted hover:text-white"
            >
              gianlucaimprota.com
            </a>
            <a
              href="https://gemimedia.cn"
              target="_blank"
              rel="noreferrer"
              className="block rounded px-3 py-1.5 text-[11px] text-cinema-muted hover:text-white"
            >
              Gemi Media — production
            </a>
            <a
              href="https://github.com/sponsors/Gianluca-Improta"
              target="_blank"
              rel="noreferrer"
              className="block rounded px-3 py-1.5 text-[11px] text-cinema-muted hover:text-cinema-cyan"
            >
              Donate / sponsor
            </a>
          </div>
        </div>
      </div>
    </aside>
  );
}
