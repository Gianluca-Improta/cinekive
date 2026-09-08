"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";

export type Entitlements = {
  tier: "free" | "pro" | string;
  is_pro: boolean;
  features: string[];
  limits: { max_projects: number | null };
  upgrade_url: string;
  price_usd: number;
  early_bird_usd?: number;
  support_email?: string;
  source?: string;
  license?: {
    email?: string;
    key_hint?: string;
    activated_at?: number;
    verified_at?: number;
    uses_count?: number;
    device_limit?: number;
  };
  needs_reverify?: boolean;
  grace_expired?: boolean;
  grace_sec?: number;
  reverify_interval_sec?: number;
  device_limit?: number;
};

function apiBase(): string {
  const fallback = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  if (typeof window === "undefined") return fallback;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return fallback;
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${host}:8000`;
}

async function fetchEntitlements(): Promise<Entitlements> {
  const res = await fetch(`${apiBase()}/license/entitlements`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load entitlements");
  return res.json();
}

export function useEntitlements() {
  return useQuery({
    queryKey: ["entitlements"],
    queryFn: fetchEntitlements,
    staleTime: 30_000,
    retry: 1,
  });
}

export function useHasFeature(feature: string): boolean {
  const { data } = useEntitlements();
  if (!data) return true; // fail-open while loading so UI doesn't flash locks
  if (data.is_pro) return true;
  return (data.features || []).includes(feature);
}

export function useRefreshEntitlements() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["entitlements"] });
}

export const PRO_UPGRADE_URL =
  process.env.NEXT_PUBLIC_PRO_URL || "https://gianlucaimprota.gumroad.com/l/cinekive-pro";
