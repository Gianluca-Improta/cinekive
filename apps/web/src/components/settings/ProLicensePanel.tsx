"use client";

import { useMutation } from "@tanstack/react-query";
import { Crown, KeyRound, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  PRO_UPGRADE_URL,
  useEntitlements,
  useRefreshEntitlements,
} from "@/hooks/useEntitlements";

function apiBase(): string {
  const fallback = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  if (typeof window === "undefined") return fallback;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return fallback;
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${host}:8000`;
}

export function ProLicensePanel() {
  const { data, isLoading } = useEntitlements();
  const refresh = useRefreshEntitlements();
  const [key, setKey] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const activate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${apiBase()}/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key.trim(), email: email.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.message || data.detail || "Activation failed");
      }
      return data;
    },
    onSuccess: () => {
      setMsg("Pro activated. Enjoy the studio tools.");
      setKey("");
      refresh();
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const deactivate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${apiBase()}/license/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      return res.json();
    },
    onSuccess: () => {
      setMsg("Back to Free tier.");
      refresh();
    },
  });

  const price = data?.price_usd ?? 19;
  const url = data?.upgrade_url || PRO_UPGRADE_URL;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Crown className="h-4 w-4 text-cinema-cyan" />
        <h2 className="text-sm font-medium text-white">Cinekive Pro</h2>
        {data?.is_pro && (
          <span className="rounded border border-cinema-cyan/40 px-1.5 py-0.5 text-[10px] text-cinema-cyan">
            ACTIVE
          </span>
        )}
      </div>
      <p className="text-xs text-cinema-muted">
        One-time ${price}. Archive mirrors, batch export, continuous craft enrich, share tunnel,
        unlimited projects. No ads. Local forever.
      </p>

      {isLoading ? (
        <p className="text-xs text-cinema-muted">Checking license…</p>
      ) : data?.is_pro ? (
        <div className="rounded-xl border border-cinema-cyan/30 bg-cinema-cyan/5 px-4 py-3 text-xs">
          <p className="text-white">
            Licensed{data.license?.email ? ` · ${data.license.email}` : ""}
            {data.license?.key_hint ? ` · ${data.license.key_hint}` : ""}
          </p>
          {data.support_email && (
            <p className="mt-1 text-cinema-muted">
              Support:{" "}
              <a className="text-cinema-cyan hover:underline" href={`mailto:${data.support_email}`}>
                {data.support_email}
              </a>
            </p>
          )}
          <button
            type="button"
            onClick={() => deactivate.mutate()}
            className="mt-2 text-[11px] text-cinema-muted hover:text-white"
          >
            Deactivate on this machine
          </button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-cinema-border bg-cinema-surface/50 p-4">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-lg bg-cinema-cyan px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90"
          >
            Buy Pro on Gumroad — ${price}
          </a>
          <p className="text-[11px] text-cinema-muted">Already bought? Paste your license key:</p>
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="License key"
            className="w-full rounded border border-cinema-border bg-black px-3 py-2 text-xs text-white outline-none focus:border-cinema-cyan/50"
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email (optional)"
            className="w-full rounded border border-cinema-border bg-black px-3 py-2 text-xs text-white outline-none focus:border-cinema-cyan/50"
          />
          <button
            type="button"
            disabled={!key.trim() || activate.isPending}
            onClick={() => {
              setMsg(null);
              activate.mutate();
            }}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/10 disabled:opacity-40"
          >
            {activate.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <KeyRound className="h-3.5 w-3.5" />
            )}
            Activate
          </button>
        </div>
      )}
      {msg && <p className="text-[11px] text-cinema-muted">{msg}</p>}
    </section>
  );
}
