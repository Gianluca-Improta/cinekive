import type {
  Collection,
  CollectionDetail,
  Job,
  MoodboardResponse,
  Project,
  SearchFilters,
  SearchResponse,
  Shot,
  Taxonomy,
} from "../types";
import { readAccessToken } from "../access-token";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Raised when the API asks for an access token (another device on the LAN). */
export class ApiAuthError extends Error {
  status = 401;

  constructor(message = "This Cinekive instance needs an access token.") {
    super(message);
    this.name = "ApiAuthError";
  }
}

export function isAuthError(err: unknown): err is ApiAuthError {
  return err instanceof ApiAuthError;
}

/** Vocabulary pack for one archive mode (cinematic, architecture, …). */
export interface ModePack {
  id: string;
  label: string;
  short_label: string;
  reference_noun: string;
  reference_noun_plural: string;
  creator_noun: string;
  creator_noun_plural: string;
  hero_line: string;
  search_placeholder: string;
  suggestions: string[];
  facets: string[];
  category_labels: Record<string, string>;
  interests: string[];
  sources: string[];
}

export interface ModeListResponse {
  modes: ModePack[];
  adapters: string[];
}

/** LAN and loopback keep a direct API port. Anything else is a public share link. */
export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Resolve API base URL. Public hosts use the same-origin read-only proxy. */
export function getApiUrl(): string {
  const fallback = API_URL;
  if (typeof window === "undefined") return fallback;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return fallback;
  if (isPrivateHost(host)) {
    const proto = window.location.protocol === "https:" ? "https:" : "http:";
    return `${proto}//${host}:8000`;
  }
  return `${window.location.origin}/cinekive-api`;
}

export function artifactUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = getApiUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...(init?.headers as Record<string, string> | undefined),
  };
  const token = readAccessToken();
  if (token) headers["X-Cinekive-Token"] = token;

  const res = await fetch(`${getApiUrl()}${path}`, { ...init, headers });
  if (res.status === 401) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("cinekive:auth-required"));
    }
    throw new ApiAuthError();
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || JSON.stringify(data);
    } catch {
      /* ignore */
    }
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}


