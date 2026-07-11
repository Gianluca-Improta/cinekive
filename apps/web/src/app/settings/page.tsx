"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  Link2,
  MonitorSmartphone,
  Share2,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAppearance, type AppearanceTheme } from "@/lib/appearance";
import { CREATOR_LINKS } from "@/lib/creator-links";
import { cn } from "@/lib/utils";

const THEMES: { id: AppearanceTheme; label: string; hint: string }[] = [
  { id: "dark", label: "Dark", hint: "Cinema black" },
  { id: "light", label: "Light", hint: "Paper white UI" },
  { id: "slate", label: "Slate", hint: "Cool grey stone" },
];

export default function SettingsPage() {
  const { theme, setTheme } = useAppearance();
  const [copied, setCopied] = useState<string | null>(null);

  const info = useQuery({
    queryKey: ["system"],
    queryFn: () => api.systemInfo(),
    staleTime: 60_000,
  });

  const seek = useQuery({
    queryKey: ["seek-status"],
    queryFn: () => api.seekStatus(),
    staleTime: 30_000,
  });

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    staleTime: 30_000,
  });

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* ignore */
    }
  };

  const data = info.data;
  const tunnelCmd =
    data?.share?.options?.find((o) => o.id === "tunnel")?.commands?.[0] ||
    "cloudflared tunnel --url http://localhost:3000";

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-cinema-border px-6 py-5">
        <h1 className="text-xl font-semibold tracking-tight text-white">Settings</h1>
        <p className="mt-1 text-sm text-cinema-muted">
          Appearance, engine, archive location, share, and how you run Cinekive.
        </p>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-8 px-6 py-6">
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-white">Appearance</h2>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={cn(
                  "rounded-xl border px-4 py-3 text-left transition",
                  theme === t.id
                    ? "border-cinema-cyan/50 bg-cinema-cyan/10"
                    : "border-cinema-border bg-cinema-surface/40 hover:border-cinema-cyan/30"
                )}
              >
                <div className="text-sm text-white">{t.label}</div>
                <div className="text-[11px] text-cinema-muted">{t.hint}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-cinema-cyan" />
            <h2 className="text-sm font-medium text-white">URL / video download</h2>
          </div>
          <div className="rounded-xl border border-cinema-border bg-cinema-surface/50 p-4 space-y-2">
            <p className="text-xs text-cinema-muted">
              Paste any http(s) video URL into a project (YouTube, Vimeo, TikTok, Instagram, X,
              Facebook, Twitch, Reddit, direct .mp4, and most sites yt-dlp supports). Downloads into
              that project&apos;s folder, then ingest runs automatically.
            </p>
            <div className="flex flex-wrap gap-3 text-[11px]">
              <span className="text-cinema-muted">
                yt-dlp:{" "}
                <span className="text-white">
                  {seek.isLoading ? "…" : seek.data?.yt_dlp ? "available" : "missing"}
                </span>
              </span>
              <span className="text-cinema-muted">
                Catalog seek:{" "}
                <span className="text-white">{seek.data?.enabled ? "on" : "off (URL paste still works)"}</span>
              </span>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-medium text-white">Engine</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="text-sm text-white">API / search</div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                Status: {health.data?.status || "…"}
                {health.data?.embedding_model_loaded != null &&
                  ` · embeddings ${health.data.embedding_model_loaded ? "ready" : "loading"}`}
              </p>
            </div>
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="text-sm text-white">VLM enrichment</div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                {health.data?.vlm_enabled
                  ? health.data.vlm_reachable
                    ? `On · ${health.data.enrich?.model || "model"}`
                    : "On but Ollama unreachable"
                  : "Off — set VLM_ENABLED=true + Ollama for craft tags"}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-cinema-muted">
            Mirror logins (ShotDeck, StillsLab, MovieStillsDB):{" "}
            <Link href="/archives" className="text-cinema-cyan hover:underline">
              Archives → Mirrors
            </Link>
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Share2 className="h-4 w-4 text-cinema-cyan" />
            <h2 className="text-sm font-medium text-white">Share a view link</h2>
          </div>
          <div className="rounded-xl border border-cinema-cyan/30 bg-cinema-cyan/5 p-5">
            <p className="text-sm text-white">Locally host a live browse link</p>
            <p className="mt-1 text-xs leading-relaxed text-cinema-muted">
              Temporary public URL while Cinekive runs on your machine. No cloud upload.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(tunnelCmd, "tunnel")}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "tunnel" ? "Copied" : "Copy tunnel command"}
              </button>
              <a
                href="https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-cinema-muted hover:text-white"
              >
                Install cloudflared <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded border border-cinema-border bg-cinema-black/50 px-2 py-1.5">
              <Terminal className="h-3 w-3 shrink-0 text-cinema-muted" />
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-cinema-cyan">
                {tunnelCmd}
              </code>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-white">
                <Download className="h-3.5 w-3.5 text-cinema-cyan" />
                Export ZIP
              </div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                Select shots in the grid → Export.
              </p>
            </div>
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-white">
                <FolderOpen className="h-3.5 w-3.5 text-cinema-cyan" />
                Static gallery
              </div>
              <p className="mt-1 text-[11px] text-cinema-muted">Roadmap: HTML export for any host.</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-cinema-cyan" />
            <h2 className="text-sm font-medium text-white">Visual archive location</h2>
          </div>
          <div className="rounded-xl border border-cinema-border bg-cinema-surface/50 p-4">
            <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
              Current path (API)
            </div>
            <code className="mt-1 block break-all font-mono text-xs text-cinema-cyan">
              {info.isLoading ? "…" : data?.library_dir || "—"}
            </code>
            <p className="mt-3 text-[11px] text-cinema-muted">
              Desktop: <span className="text-white">Cinekive → Choose library folder…</span>
              {" · "}
              Or set <code className="text-cinema-cyan/80">LIBRARY_HOST_PATH</code> in{" "}
              <code className="text-cinema-cyan/80">.env</code> and restart.
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <MonitorSmartphone className="h-4 w-4 text-cinema-cyan" />
            <h2 className="text-sm font-medium text-white">How to run</h2>
          </div>
          <p className="text-xs text-cinema-muted">
            Same product three ways — pick what fits.{" "}
            <code className="text-cinema-cyan/80">docs/DESKTOP.md</code> ·{" "}
            <code className="text-cinema-cyan/80">docs/PACKAGING.md</code>
          </p>
          <div className="space-y-2">
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="text-sm text-white">Desktop (Windows / Mac / Linux)</div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                Installer or portable — wizard, window, Share menu. Needs Docker Desktop.
              </p>
              <code className="mt-2 block font-mono text-[10px] text-cinema-cyan">
                .\scripts\desktop.ps1 -Dist
              </code>
              <code className="mt-1 block font-mono text-[10px] text-cinema-muted">
                cd apps/desktop && npm run dist:mac | dist:linux
              </code>
            </div>
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="text-sm text-white">Web app</div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                Browser at localhost:3000 after Docker compose / desktop start. Optional PWA install
                (neutral chrome — no cyan banner).
              </p>
            </div>
            <div className="rounded-xl border border-cinema-border/70 bg-cinema-surface/40 px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-white">
                <Globe className="h-3.5 w-3.5 text-cinema-cyan" />
                Hosted server
              </div>
              <p className="mt-1 text-[11px] text-cinema-muted">
                Same compose on a VPS/GPU box for a shared team machine.
              </p>
            </div>
          </div>
        </section>

        <p className="pb-2 text-[10px] text-cinema-muted">
          Cinekive {data?.version || "…"} · local-first — media stays on your machine unless you
          share a view link or export.
        </p>

        <section className="space-y-3 pb-10">
          <h2 className="text-sm font-medium text-white">Creator & support</h2>
          <p className="text-xs text-cinema-muted">
            Built by Gianluca Improta. Need AI video gen, a portfolio look, or a production crew?
            Or just want to keep this project alive — donations are welcome.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CREATOR_LINKS) as (keyof typeof CREATOR_LINKS)[]).map((key) => {
              const item = CREATOR_LINKS[key];
              return (
                <a
                  key={key}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-cinema-border bg-cinema-surface/50 px-4 py-3 transition hover:border-cinema-cyan/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-white">{item.label}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-cinema-muted" />
                  </div>
                  <p className="mt-1 text-[11px] text-cinema-muted">{item.blurb}</p>
                </a>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
