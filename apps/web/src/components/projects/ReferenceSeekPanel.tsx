"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Crown, Download, ExternalLink, Search, X } from "lucide-react";
import { ProGateBanner } from "@/components/pro/ProGateBanner";
import { PRO_UPGRADE_URL, useHasFeature } from "@/hooks/useEntitlements";
import { api } from "@/lib/api-client";

type Props = {
  projectSlug?: string | null;
  open: boolean;
  onClose: () => void;
};

export function ReferenceSeekPanel({ projectSlug, open, onClose }: Props) {
  const canSeek = useHasFeature("agent_api");
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["seek-status"],
    queryFn: api.seekStatus,
    enabled: open && canSeek,
    staleTime: 30_000,
  });

  const search = useMutation({
    mutationFn: () => api.seekSearch({ query: query.trim(), limit: 18 }),
    onError: (e: Error) => setMsg(e.message),
  });

  const download = useMutation({
    mutationFn: (r: { url: string; title: string; source: string }) =>
      api.seekDownload({
        url: r.url,
        title: r.title,
        source: r.source,
        project_slug: projectSlug || undefined,
      }),
    onSuccess: (res) => setMsg(res.message),
    onError: (e: Error) => setMsg(e.message),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[min(88vh,36rem)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-cinema-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-cinema-cyan" />
            <div>
              <div className="text-sm font-medium text-white">Reference search</div>
              <p className="text-[11px] text-cinema-muted">
                Pro web seek — Brave / URL providers when configured
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-cinema-border p-1.5 text-cinema-muted hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!canSeek ? (
            <ProGateBanner
              feature="agent_api"
              title="Reference search is Pro"
              detail="Search the web for stills and pull them into your local seek inbox."
            />
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && query.trim().length >= 2) search.mutate();
                  }}
                  placeholder="neon rain street still · or paste an image URL"
                  className="min-w-0 flex-1 rounded border border-cinema-border bg-cinema-black px-3 py-2 text-sm text-white outline-none focus:border-cinema-cyan"
                />
                <button
                  type="button"
                  disabled={search.isPending || query.trim().length < 2}
                  onClick={() => search.mutate()}
                  className="rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-2 text-xs text-cinema-cyan disabled:opacity-40"
                >
                  {search.isPending ? "…" : "Search"}
                </button>
              </div>
              <p className="text-[11px] text-cinema-muted">
                {status.data?.enabled
                  ? `Providers: ${(status.data.providers || []).join(", ")}`
                  : "Seek is off — set SEEK_ENABLED=true and optionally BRAVE_SEARCH_API_KEY on the API."}
                {" · "}
                <a
                  href={PRO_UPGRADE_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cinema-cyan hover:underline"
                >
                  Docs
                </a>
              </p>
              {msg && <p className="text-[11px] text-cinema-cyan">{msg}</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(search.data?.results || []).map((r) => (
                  <div
                    key={`${r.source}-${r.url}`}
                    className="overflow-hidden rounded-lg border border-cinema-border bg-cinema-panel/40"
                  >
                    {r.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumb_url} alt="" className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="flex aspect-video items-center justify-center text-[10px] text-cinema-muted">
                        {r.source}
                      </div>
                    )}
                    <div className="space-y-1 p-2">
                      <div className="truncate text-[11px] text-white" title={r.title}>
                        {r.title}
                      </div>
                      <div className="truncate text-[10px] text-cinema-muted">{r.source}</div>
                      <div className="flex gap-1">
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 rounded border border-cinema-border px-1.5 py-0.5 text-[10px] text-cinema-muted hover:text-white"
                        >
                          <ExternalLink className="h-3 w-3" /> Open
                        </a>
                        <button
                          type="button"
                          disabled={download.isPending}
                          onClick={() =>
                            download.mutate({
                              url: r.url,
                              title: r.title,
                              source: r.source,
                            })
                          }
                          className="inline-flex items-center gap-0.5 rounded border border-cinema-cyan/30 px-1.5 py-0.5 text-[10px] text-cinema-cyan"
                        >
                          <Download className="h-3 w-3" /> Pull
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {search.isSuccess && (search.data?.results || []).length === 0 && (
                <p className="text-[11px] text-cinema-muted">
                  No results. Add a Brave API key, or paste a direct image URL as the query.
                </p>
              )}
            </>
          )}
          {!canSeek && (
            <a
              href={PRO_UPGRADE_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[11px] text-cinema-cyan hover:underline"
            >
              <Crown className="h-3 w-3" /> Unlock Pro
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
