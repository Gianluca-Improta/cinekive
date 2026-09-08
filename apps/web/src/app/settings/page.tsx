"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  HardDrive,
  HelpCircle,
  Info,
  Link2,
  MonitorSmartphone,
  Share2,
  Terminal,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { startTour } from "@/components/layout/TopBar";
import { LanguageSwitcher } from "@/components/layout/LanguageSwitcher";
import { LibraryDoctorPanel } from "@/components/settings/LibraryDoctorPanel";
import { LibraryQualityPanel } from "@/components/settings/LibraryQualityPanel";
import { ProLicensePanel } from "@/components/settings/ProLicensePanel";
import { VlmSettingsPanel } from "@/components/settings/VlmSettingsPanel";
import { ProGateBanner } from "@/components/pro/ProGateBanner";
import { useEntitlements } from "@/hooks/useEntitlements";
import { api } from "@/lib/api-client";
import { useAppearance, type AppearanceTheme } from "@/lib/appearance";
import { CREATOR_LINKS } from "@/lib/creator-links";
import { desktopBridge } from "@/lib/desktop-bridge";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

function discoverLanWebUrl(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const host = window.location.hostname;
  if (host !== "localhost" && host !== "127.0.0.1") {
    return Promise.resolve(window.location.origin);
  }
  return new Promise((resolve) => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel("");
    pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => resolve(null));
    pc.onicecandidate = (event) => {
      if (!event.candidate?.candidate) return;
      const match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(event.candidate.candidate);
      if (match && !match[1].startsWith("127.")) {
        resolve(`http://${match[1]}:3000`);
        pc.close();
      }
    };
    setTimeout(() => {
      pc.close();
      resolve(null);
    }, 2500);
  });
}

type SettingsTab = "general" | "ai" | "license" | "share" | "advanced";

export default function SettingsPage() {
  const { theme, setTheme } = useAppearance();
  const { t } = useI18n();
  const { data: entitlements } = useEntitlements();
  const isPro = Boolean(entitlements?.is_pro);
  const [copied, setCopied] = useState<string | null>(null);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [libraryMsg, setLibraryMsg] = useState<string | null>(null);
  const [libraryBusy, setLibraryBusy] = useState(false);

  useEffect(() => {
    discoverLanWebUrl().then(setLanUrl);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = new URLSearchParams(window.location.search).get("tab");
    if (raw === "general" || raw === "ai" || raw === "license" || raw === "share" || raw === "advanced") {
      setTab(raw);
    }
  }, []);

  const themes: { id: AppearanceTheme; label: string; hint: string }[] = [
    { id: "dark", label: t("topbar.themeDark"), hint: t("settings.themeDarkHint") },
    { id: "light", label: t("topbar.themeLight"), hint: t("settings.themeLightHint") },
    { id: "slate", label: t("topbar.themeSlate"), hint: t("settings.themeSlateHint") },
  ];

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
  const phoneUrl = health.data?.lan_web_url || lanUrl;
  const phoneApiUrl = phoneUrl?.replace(":3000", ":8000") ?? null;
  const desktop = desktopBridge();
  const canBrowseLibrary = Boolean(desktop?.chooseLibraryFolder || desktop?.pickLibraryFolder);

  const modules: { id: SettingsTab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "ai", label: "Gemi Local AI" },
    { id: "license", label: "License" },
    { id: "share", label: "Share" },
    { id: "advanced", label: "Advanced" },
  ];

  const goModule = (id: SettingsTab) => {
    setTab(id);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", id);
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
  };

  const browseLibrary = async () => {
    if (!desktop) {
      setLibraryMsg("Change the library folder from the Cinekive desktop app menu.");
      return;
    }
    setLibraryBusy(true);
    setLibraryMsg(null);
    try {
      if (desktop.chooseLibraryFolder) {
        const res = await desktop.chooseLibraryFolder();
        if (!res) {
          setLibraryMsg(null);
          return;
        }
        if (res.ok && res.path) {
          setLibraryMsg(
            res.restarted
              ? `Library set to ${res.path} (stack restarted).`
              : `Library saved: ${res.path}. Restart the stack when ready (Cinekive menu).`
          );
          await info.refetch();
        }
      } else if (desktop.pickLibraryFolder) {
        const path = await desktop.pickLibraryFolder();
        if (path) {
          setLibraryMsg(
            `Selected ${path}. Use Cinekive → Choose library folder… to apply and restart.`
          );
        }
      }
    } catch (e) {
      setLibraryMsg(e instanceof Error ? e.message : "Could not change library folder");
    } finally {
      setLibraryBusy(false);
    }
  };

  const embedLine =
    health.data?.embedding_model_loaded == null
      ? null
      : health.data.embedding_model_loaded
        ? "Embeddings: ready"
        : "Embeddings: loading (search improves when ready)";

  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-44 shrink-0 flex-col border-r border-white/[0.06] bg-cinema-surface/40 py-5 md:flex lg:w-52">
        <div className="px-4 pb-4">
          <h1 className="text-sm font-semibold tracking-tight text-white">{t("settings.title")}</h1>
          <p className="mt-1 text-[11px] leading-snug text-cinema-muted">{t("settings.subtitle")}</p>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {modules.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => goModule(item.id)}
              className={cn(
                "rounded-lg px-3 py-2 text-left text-xs transition",
                tab === item.id
                  ? "bg-cinema-cyan/12 text-cinema-cyan"
                  : "text-cinema-muted hover:bg-cinema-panel hover:text-white"
              )}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="space-y-1 px-2 pt-3">
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Help
          </button>
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white"
          >
            <Info className="h-3.5 w-3.5" />
            About
          </button>
          <p className="px-3 pt-1 text-[10px] text-cinema-muted">
            Cinekive {data?.version || "…"}
            {isPro ? " · Pro" : " · Free"}
          </p>
        </div>
      </aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-white/[0.06] bg-cinema-black/90 px-5 py-3 backdrop-blur md:hidden">
          <h1 className="text-base font-semibold text-white">{t("settings.title")}</h1>
          <div className="mt-2 flex flex-wrap gap-1">
            {modules.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goModule(item.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-[11px]",
                  tab === item.id
                    ? "bg-cinema-cyan/15 text-cinema-cyan"
                    : "text-cinema-muted hover:bg-cinema-panel"
                )}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="rounded px-2.5 py-1 text-[11px] text-cinema-muted hover:bg-cinema-panel"
            >
              Help
            </button>
            <button
              type="button"
              onClick={() => setAboutOpen(true)}
              className="rounded px-2.5 py-1 text-[11px] text-cinema-muted hover:bg-cinema-panel"
            >
              About
            </button>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl space-y-10 px-5 py-6 lg:px-8 lg:py-8">
          {tab === "general" && (
            <section id="settings-general" className="scroll-mt-4 space-y-6">
              <div>
                <h2 className="text-base font-medium text-white">General</h2>
                <p className="mt-0.5 text-xs text-cinema-muted">Appearance, language, and engine health</p>
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-white">{t("settings.appearance")}</h3>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {themes.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTheme(item.id)}
                        className={cn(
                          "rounded-xl border px-4 py-3 text-left transition",
                          theme === item.id
                            ? "border-cinema-cyan/50 bg-cinema-cyan/10"
                            : "border-cinema-border bg-cinema-surface/40 hover:border-cinema-cyan/30"
                        )}
                      >
                        <div className="text-sm text-white">{item.label}</div>
                        <div className="text-[11px] text-cinema-muted">{item.hint}</div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-white">{t("settings.language")}</h3>
                  <p className="text-xs text-cinema-muted">{t("language.sectionHint")}</p>
                  <div className="flex items-center gap-3 rounded-xl bg-cinema-surface/40 px-4 py-3">
                    <LanguageSwitcher placement="bottom" />
                    <span className="text-xs text-cinema-muted">{t("language.core")}</span>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-medium text-white">{t("settings.engine")}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl bg-cinema-surface/40 px-4 py-3">
                      <div className="text-sm text-white">API / search</div>
                      <p className="mt-1 text-[11px] text-cinema-muted">
                        Engine: {health.data?.status || "…"}
                      </p>
                      {embedLine && (
                        <p className="mt-0.5 text-[11px] text-cinema-muted">{embedLine}</p>
                      )}
                    </div>
                    <div className="rounded-xl bg-cinema-surface/40 px-4 py-3">
                      <div className="text-sm text-white">VLM enrichment</div>
                      <p className="mt-1 text-[11px] text-cinema-muted">
                        {health.data?.vlm_enabled
                          ? health.data.vlm_reachable
                            ? `On · ${health.data.enrich?.model || "model"}`
                            : "On but provider unreachable"
                          : "Off — configure in Gemi Local AI"}
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-cinema-muted">
                    Mirror logins & pull filters:{" "}
                    <Link href="/archives" className="text-cinema-cyan hover:underline">
                      Archive of Archives
                    </Link>
                  </p>
                </section>

                <section className="space-y-3 sm:col-span-2">
                  <LibraryQualityPanel />
                </section>

                <section className="space-y-3">
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4 text-cinema-cyan" />
                    <h3 className="text-sm font-medium text-white">{t("settings.archiveLocation")}</h3>
                  </div>
                  <div className="rounded-xl bg-cinema-surface/50 p-4">
                    <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                      Current path (API)
                    </div>
                    <code className="mt-1 block break-all font-mono text-xs text-cinema-cyan">
                      {info.isLoading ? "…" : data?.library_dir || "—"}
                    </code>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {canBrowseLibrary ? (
                        <button
                          type="button"
                          disabled={libraryBusy}
                          onClick={() => void browseLibrary()}
                          className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-40"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          {libraryBusy ? "…" : "Browse…"}
                        </button>
                      ) : (
                        <p className="text-[11px] text-cinema-muted">
                          Desktop:{" "}
                          <span className="text-white">Cinekive → Choose library folder…</span>
                        </p>
                      )}
                    </div>
                    {libraryMsg && (
                      <p className="mt-2 text-[11px] text-cinema-muted">{libraryMsg}</p>
                    )}
                  </div>
                </section>
              </div>
            </section>
          )}

          {tab === "ai" && (
            <section id="settings-ai" className="scroll-mt-4 space-y-4">
              <div>
                <h2 className="text-base font-medium text-white">Gemi Local AI</h2>
                <p className="mt-0.5 text-xs text-cinema-muted">
                  Craft tags for camera, lighting, and mood. Local Ollama is free; cloud keys need Pro.
                </p>
              </div>
              <VlmSettingsPanel />
              <section className="space-y-3 rounded-xl bg-cinema-surface/40 p-4">
                <h3 className="text-sm font-medium text-white">Gemi AI Assistant</h3>
                <p className="text-[11px] text-cinema-muted">
                  Left sidebar → Gemi AI Assistant. Dock, resize, or float the panel. Talks to your
                  configured local / Pro model, can summarize archives, search frames, and build
                  moodboards on the open project.
                </p>
                <details className="group pt-2">
                  <summary className="cursor-pointer list-none text-sm font-medium text-white marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-2">
                      For developers
                      <span className="text-[10px] font-normal text-cinema-muted group-open:hidden">
                        (MCP · collapsed)
                      </span>
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3">
                    <h4 className="text-xs font-medium text-white">MCP for agents (Pro)</h4>
                    <p className="text-[11px] text-cinema-muted">
                      Install the bundled server so Cursor / Claude / OpenClaw can call your library:
                    </p>
                    <pre className="overflow-x-auto rounded bg-cinema-black/60 p-3 font-mono text-[10px] text-cinema-cyan">{`pip install -e packages/cinekive-mcp

# mcp.json
{
  "mcpServers": {
    "cinekive": {
      "command": "cinekive-mcp",
      "env": { "CINEKIVE_API_URL": "http://127.0.0.1:8000" }
    }
  }
}`}</pre>
                    <p className="text-[10px] text-cinema-muted">
                      Docs: docs/MCP.md · requires Pro entitlement{" "}
                      <code className="text-cinema-cyan">mcp_server</code>
                    </p>
                  </div>
                </details>
              </section>
            </section>
          )}

          {tab === "license" && (
            <section id="settings-license" className="scroll-mt-4 space-y-4">
              <div>
                <h2 className="text-base font-medium text-white">License</h2>
                <p className="mt-0.5 text-xs text-cinema-muted">Activate Pro · device seats · Enterprise</p>
              </div>
              <ProLicensePanel />
            </section>
          )}

          {tab === "share" && (
            <section id="settings-share" className="scroll-mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-cinema-cyan" />
                <h2 className="text-base font-medium text-white">{t("settings.share")}</h2>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl bg-cinema-surface/40 p-5">
                  <div className="flex items-center gap-2 text-sm text-white">
                    <MonitorSmartphone className="h-4 w-4 text-cinema-cyan" />
                    {t("settings.lanWifi")}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-cinema-muted">
                    {t("settings.lanWifiHint")}
                  </p>
                  {phoneUrl ? (
                    <div className="mt-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copy(phoneUrl, "lan")}
                          className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copied === "lan" ? "Copied" : t("settings.copyLanUrl")}
                        </button>
                        <a
                          href={phoneUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-cinema-muted hover:text-white"
                        >
                          Open on this device <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <code className="block break-all rounded bg-cinema-black/50 px-2 py-1.5 font-mono text-[10px] text-cinema-cyan">
                        {phoneUrl}
                      </code>
                      {phoneApiUrl && (
                        <p className="text-[10px] text-cinema-muted">
                          API (same WiFi): <code className="text-cinema-cyan/80">{phoneApiUrl}</code>
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-3 text-[11px] text-cinema-muted">{t("settings.lanWifiUnavailable")}</p>
                  )}
                </div>
                <div className="rounded-xl bg-cinema-cyan/5 p-5">
                  <p className="text-sm text-white">Locally host a live browse link</p>
                  <p className="mt-1 text-xs leading-relaxed text-cinema-muted">
                    Temporary public URL while Cinekive runs on your machine.
                    {!isPro ? " Pro unlocks the share tunnel." : ""}
                  </p>
                  {!isPro ? (
                    <div className="mt-4">
                      <ProGateBanner
                        feature="share_tunnel"
                        title="Share tunnel is Pro"
                        detail="LAN phone URL stays free. Public tunnel unlocks with Pro."
                        compact
                      />
                    </div>
                  ) : (
                    <>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => copy(tunnelCmd, "tunnel")}
                          className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copied === "tunnel" ? "Copied" : "Copy tunnel command"}
                        </button>
                      </div>
                      <div className="mt-3 flex items-center gap-2 rounded bg-cinema-black/50 px-2 py-1.5">
                        <Terminal className="h-3 w-3 shrink-0 text-cinema-muted" />
                        <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-cinema-cyan">
                          {tunnelCmd}
                        </code>
                      </div>
                    </>
                  )}
                </div>
                <div className="rounded-xl bg-cinema-surface/40 px-4 py-3 lg:col-span-2">
                  <p className="text-sm text-white">Batch export</p>
                  <p className="mt-1 text-[11px] text-cinema-muted">
                    Select shots on{" "}
                    <Link href="/" className="text-cinema-cyan hover:underline">
                      Discovery
                    </Link>{" "}
                    → Export ZIP from the selection bar.
                  </p>
                </div>
              </div>
            </section>
          )}

          {tab === "advanced" && (
            <section id="settings-advanced" className="scroll-mt-4 space-y-6 pb-16">
              <div>
                <h2 className="text-base font-medium text-white">Advanced</h2>
                <p className="mt-0.5 text-xs text-cinema-muted">Library integrity and download tooling</p>
              </div>
              <LibraryDoctorPanel />
              <div className="rounded-xl bg-cinema-surface/50 p-4">
                <div className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-cinema-cyan" />
                  <h3 className="text-sm font-medium text-white">URL / video download</h3>
                </div>
                <p className="mt-2 text-[11px] text-cinema-muted">
                  yt-dlp:{" "}
                  <span className="text-white">
                    {seek.isLoading ? "…" : seek.data?.yt_dlp ? "available" : "missing"}
                  </span>
                  {" · "}
                  <button
                    type="button"
                    onClick={() => setHelpOpen(true)}
                    className="text-cinema-cyan hover:underline"
                  >
                    How to paste URLs & run modes
                  </button>
                </p>
              </div>
            </section>
          )}
        </div>
      </div>

      {helpOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-help-title"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-cinema-border bg-cinema-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="settings-help-title" className="text-base font-medium text-white">
                  Help
                </h2>
                <p className="mt-0.5 text-xs text-cinema-muted">How to run Cinekive and ingest URLs</p>
              </div>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="rounded p-1 text-cinema-muted hover:bg-cinema-panel hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 text-sm text-white">
                  <Link2 className="h-3.5 w-3.5 text-cinema-cyan" />
                  URL / video download
                </div>
                <p className="mt-1 text-xs text-cinema-muted">
                  Paste any http(s) video URL into a project. Downloads, then ingest runs. yt-dlp:{" "}
                  {seek.isLoading ? "…" : seek.data?.yt_dlp ? "available" : "missing"}.
                </p>
              </div>
              <div>
                <div className="text-sm text-white">{t("settings.howToRun")}</div>
                <p className="mt-1 text-[11px] text-cinema-muted">
                  See <code className="text-cinema-cyan/80">docs/DESKTOP.md</code> for packaging.
                </p>
                <div className="mt-2 space-y-2">
                  <div className="rounded-xl bg-cinema-black/30 px-4 py-3">
                    <div className="text-sm text-white">Desktop</div>
                    <p className="mt-1 text-[11px] text-cinema-muted">
                      Installer or portable — wizard, window, Share menu.
                    </p>
                  </div>
                  <div className="rounded-xl bg-cinema-black/30 px-4 py-3">
                    <div className="text-sm text-white">Web app</div>
                    <p className="mt-1 text-[11px] text-cinema-muted">
                      Browser after Docker / desktop start. LAN URL on the same WiFi.
                    </p>
                  </div>
                  <div className="rounded-xl bg-cinema-black/30 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-white">
                      <Globe className="h-3.5 w-3.5 text-cinema-cyan" />
                      Hosted server
                    </div>
                    <p className="mt-1 text-[11px] text-cinema-muted">
                      Same compose on a VPS/GPU box for a shared team machine.
                    </p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHelpOpen(false);
                  startTour();
                }}
                className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan hover:bg-cinema-cyan/20"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Open product tour
              </button>
            </div>
          </div>
        </div>
      )}

      {aboutOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-about-title"
          onClick={() => setAboutOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-cinema-border bg-cinema-surface p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="settings-about-title" className="text-base font-medium text-white">
                  About
                </h2>
                <p className="mt-0.5 text-xs text-cinema-muted">
                  Cinekive {data?.version || "…"}
                  {isPro ? " · Pro" : " · Free"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAboutOpen(false)}
                className="rounded p-1 text-cinema-muted hover:bg-cinema-panel hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-3 text-xs text-cinema-muted">
              Built by Gianluca Improta. Donations keep the project alive.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {(Object.keys(CREATOR_LINKS) as (keyof typeof CREATOR_LINKS)[]).map((key) => {
                const item = CREATOR_LINKS[key];
                return (
                  <a
                    key={key}
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-cinema-black/30 px-4 py-3 transition hover:bg-cinema-panel"
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
          </div>
        </div>
      )}
    </div>
  );
}
