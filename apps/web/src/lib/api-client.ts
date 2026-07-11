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
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Resolve API base URL at runtime (LAN phone access uses same host, port 8000). */
export function getApiUrl(): string {
  const fallback = API_URL;
  if (typeof window === "undefined") return fallback;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return fallback;
  const proto = window.location.protocol === "https:" ? "https:" : "http:";
  return `${proto}//${host}:8000`;
}

export function artifactUrl(path: string | null | undefined): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  const base = getApiUrl();
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
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

export const api = {
  health: () =>
    request<{
      status: string;
      sqlite?: boolean;
      qdrant?: boolean;
      embedding_model_loaded?: boolean;
      vlm_enabled?: boolean;
      vlm_reachable?: boolean;
      lan_web_url?: string | null;
      enrich?: {
        tier?: string;
        model?: string;
        vram_gb?: number | null;
        continuous?: boolean;
        gpu?: string | null;
      };
    }>("/health"),

  systemInfo: () =>
    request<{
      app: string;
      version: string;
      library_dir: string;
      videos_dir: string;
      artifacts_dir: string;
      models_dir: string;
      database_url: string;
      packaging: {
        modes: { id: string; label: string; summary: string }[];
      };
      share: {
        options: {
          id: string;
          label: string;
          summary: string;
          commands?: string[];
        }[];
      };
      how_to_move_library: string[];
    }>("/system"),

  enrichTiers: () =>
    request<{
      vram_gb: number | null;
      gpu_hint: string | null;
      active_tier: string;
      active_model: string;
      recommended_tier: string;
      provider?: string;
      vlm_enabled?: boolean;
      continuous: {
        enabled: boolean;
        interval_sec: number;
        batch_size: number;
        quality_min: number;
        last_pass_at?: number | null;
      };
      tiers: {
        key: string;
        label: string;
        model: string;
        blurb: string;
        available: boolean;
        recommended: boolean;
      }[];
      config?: Record<string, unknown>;
    }>("/enrich/tiers"),

  enrichConfig: () =>
    request<{
      enabled: boolean;
      provider: "ollama" | "openai_compatible";
      ollama_url: string;
      ollama_model: string;
      openai_base_url: string;
      openai_api_key_set: boolean;
      openai_api_key_masked: string;
      openai_model: string;
      openai_site_url?: string | null;
      openai_app_name?: string;
      enrich_tier: string;
      enrich_continuous: boolean;
      enrich_interval_sec: number;
      enrich_batch_size: number;
      vlm_timeout_sec: number;
      active_model: string;
      presets: {
        id: string;
        label: string;
        provider: string;
        hint?: string;
        ollama_url?: string;
        openai_base_url?: string;
        openai_model?: string;
      }[];
    }>("/enrich/config"),

  updateEnrichConfig: (body: Record<string, unknown>) =>
    request<{ ok: boolean; config: Record<string, unknown> }>("/enrich/config", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  enrichModels: () =>
    request<{
      provider: string;
      models: string[];
      active_model: string;
      error?: string | null;
    }>("/enrich/models"),

  enrichTick: () =>
    request<{ queued: boolean; message: string }>("/enrich/tick", { method: "POST" }),

  shotQuality: (shotId: string) =>
    request<{
      shot_id: string;
      enrichment_version: number;
      live: {
        score: number;
        pass: boolean;
        issues: string[];
        strengths: string[];
        needs_reenrich: boolean;
      };
      stored: Record<string, unknown> | null;
    }>(`/shots/${shotId}/quality`),

  listProjects: async () => {
    const data = await request<{ items: Project[]; total: number }>("/projects");
    return data.items;
  },

  createProject: (body: {
    name: string;
    description?: string;
    kind?: "commercial" | "social" | "archive" | "general" | "narrative";
    form_factor?: "long_form" | "short_form" | "mixed";
    aspect_ratio?: string;
    brief?: string;
    feeling?: string;
    references_text?: string;
    sampling_mode?: "fast" | "full" | "heroes" | "moments";
    generate_previews?: boolean;
    vlm_enrichment?: boolean;
  }) =>
    request<Project>("/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateProject: (
    id: string,
    body: Partial<{
      name: string;
      description: string | null;
      kind: "commercial" | "social" | "archive" | "general" | "narrative";
      form_factor: "long_form" | "short_form" | "mixed" | null;
      aspect_ratio: string | null;
      brief: string | null;
      feeling: string | null;
      references_text: string | null;
      sampling_mode: "fast" | "full" | "heroes" | "moments";
      generate_previews: boolean;
      vlm_enrichment: boolean;
      watch_folder: string | null;
      watch_enabled: boolean;
    }>
  ) =>
    request<Project>(`/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  getProject: (id: string) => request<Project>(`/projects/${id}`),

  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: "DELETE" }),

  importLink: (body: {
    url: string;
    project_id?: string;
    project_slug?: string;
    title?: string;
    ingest?: boolean;
  }) =>
    request<{ path: string; message: string }>("/seek/import-link", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listShots: (params?: {
    project_id?: string;
    has_preview?: boolean;
    is_favorite?: boolean;
    is_hero?: boolean;
    is_moving?: boolean;
    hide_duplicates?: boolean;
    group_sequences?: boolean;
    shot_type?: string;
    content_format?: string;
    emotion?: string;
    technique?: string;
    randomize?: boolean;
    offset?: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.project_id) q.set("project_id", params.project_id);
    if (params?.has_preview !== undefined) q.set("has_preview", String(params.has_preview));
    if (params?.is_favorite !== undefined) q.set("is_favorite", String(params.is_favorite));
    if (params?.is_hero !== undefined) q.set("is_hero", String(params.is_hero));
    if (params?.is_moving !== undefined) q.set("is_moving", String(params.is_moving));
    if (params?.hide_duplicates !== undefined)
      q.set("hide_duplicates", String(params.hide_duplicates));
    if (params?.group_sequences !== undefined)
      q.set("group_sequences", String(params.group_sequences));
    if (params?.shot_type) q.set("shot_type", params.shot_type);
    if (params?.content_format) q.set("content_format", params.content_format);
    if (params?.emotion) q.set("emotion", params.emotion);
    if (params?.technique) q.set("technique", params.technique);
    if (params?.randomize) q.set("randomize", "true");
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ items: Shot[]; total: number; offset: number; limit: number }>(
      `/shots${qs ? `?${qs}` : ""}`
    );
  },

  getShot: (id: string) => request<Shot>(`/shots/${id}`),

  getTaxonomy: () => request<Taxonomy>("/taxonomy"),

  updateShot: (
    id: string,
    body: Partial<{
      tags: string[];
      techniques: string[];
      notes: string | null;
      is_favorite: boolean;
      is_hero: boolean;
      shot_type: string | null;
      camera_movement: string | null;
      camera_angle: string | null;
      lighting_style: string | null;
      composition: string | null;
      subject: string | null;
      lens_look: string | null;
      color_grade: string | null;
      mood_vibe: string | null;
      creative_intent: string | null;
      content_format: string | null;
      emotion: string | null;
    }>
  ) =>
    request<Shot>(`/shots/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  bulkDeleteShots: (shot_ids: string[]) =>
    request<{ affected: number; message: string }>("/shots/bulk/delete", {
      method: "POST",
      body: JSON.stringify({ shot_ids }),
    }),

  listBin: (params?: { project_id?: string; offset?: number; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.project_id) q.set("project_id", params.project_id);
    if (params?.offset != null) q.set("offset", String(params.offset));
    if (params?.limit != null) q.set("limit", String(params.limit));
    const qs = q.toString();
    return request<{ items: Shot[]; total: number; offset: number; limit: number }>(
      `/shots/bin${qs ? `?${qs}` : ""}`
    );
  },

  bulkRestoreShots: (shot_ids: string[]) =>
    request<{ affected: number; message: string }>("/shots/bulk/restore", {
      method: "POST",
      body: JSON.stringify({ shot_ids }),
    }),

  bulkPurgeShots: (shot_ids: string[]) =>
    request<{ affected: number; message: string }>("/shots/bulk/purge", {
      method: "POST",
      body: JSON.stringify({ shot_ids }),
    }),

  purgeExpiredBin: () =>
    request<{ affected: number; message: string }>("/shots/bin/purge-expired", {
      method: "POST",
    }),

  bulkMoveShots: (body: {
    shot_ids: string[];
    target_project_id: string;
    mode?: "move" | "copy";
  }) =>
    request<{ affected: number; message: string }>("/shots/bulk/move", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  bulkAddToCollection: (body: { shot_ids: string[]; collection_id: string }) =>
    request<{ affected: number; message: string }>("/shots/bulk/collection", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  seekStatus: () =>
    request<{
      enabled: boolean;
      download_dir: string;
      providers: string[];
      yt_dlp?: boolean;
      note: string;
    }>("/seek/status"),

  seekSearch: (body: { query: string; limit?: number }) =>
    request<{
      enabled: boolean;
      results: {
        title: string;
        source: string;
        url: string;
        thumb_url: string | null;
        tags: string[] | null;
        license_note: string | null;
      }[];
    }>("/seek/search", { method: "POST", body: JSON.stringify(body) }),

  seekDownload: (body: {
    url: string;
    title?: string;
    source?: string;
    project_slug?: string;
  }) =>
    request<{ path: string; message: string }>("/seek/download", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  search: (body: SearchFilters) =>
    request<SearchResponse>("/search", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  searchPalette: (body: { shot_id?: string; colors?: string[]; project_id?: string; limit?: number }) =>
    request<SearchResponse>("/search/palette", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  searchSimilar: (body: { shot_id: string; project_id?: string; limit?: number }) =>
    request<SearchResponse>("/search/similar", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  searchSameSource: (body: { shot_id: string; limit?: number }) =>
    request<SearchResponse>("/search/same-source", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  translate: (body: { text: string; source_lang?: string; target_lang: string }) =>
    request<{
      translated_text: string;
      source_lang: string;
      target_lang: string;
      provider: string;
    }>("/translate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  translateBatch: (body: {
    texts: string[];
    source_lang?: string;
    target_lang: string;
  }) =>
    request<{
      items: { text: string; translated_text: string; provider: string }[];
      source_lang: string;
      target_lang: string;
    }>("/translate/batch", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listLanguages: () =>
    request<{
      core: string;
      languages: { code: string; name: string }[];
      note: string;
    }>("/languages"),

  moodboard: (body: {
    text: string;
    project_id?: string;
    limit?: number;
    shot_type?: string;
    mood_vibe?: string;
  }) =>
    request<MoodboardResponse>("/moodboard", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  agentQuery: (body: { prompt: string; project_id?: string; limit?: number }) =>
    request<{
      interpretation: Record<string, unknown>;
      results: { shot: Shot; score: number }[];
      message: string;
    }>("/agent/query", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  enrichProject: (
    projectId: string,
    body?: { shot_ids?: string[]; force?: boolean; tier?: string; model?: string }
  ) =>
    request<{ job: Job; message: string }>(`/projects/${projectId}/enrich`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),

  searchCraft: (body: { shot_id: string; limit?: number }) =>
    request<SearchResponse>("/search/craft", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  dialogueProject: (
    projectId: string,
    body?: { shot_ids?: string[]; force?: boolean; model?: string }
  ) =>
    request<{ job: Job; message: string }>(`/projects/${projectId}/dialogue`, {
      method: "POST",
      body: JSON.stringify(body || {}),
    }),

  asrStatus: () =>
    request<{ available: boolean; backends: string[]; enabled: boolean; model: string }>(
      "/asr/status"
    ),

  dedupeProject: (projectId: string) =>
    request<{ job: Job; message: string }>(`/projects/${projectId}/dedupe`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getJob: (id: string) => request<Job>(`/jobs/${id}`),

  listRecentJobs: (limit = 40) =>
    request<{ items: Job[]; total: number }>(`/jobs?limit=${limit}`),

  listProjectJobs: (projectId: string) =>
    request<{ items: Job[]; total: number }>(`/projects/${projectId}/jobs`),

  ingestVideos: async (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return request<{ job: Job; message: string }>(
      `/projects/${projectId}/ingest/videos/upload`,
      { method: "POST", body: form }
    );
  },

  ingestImages: async (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => {
      form.append("files", f, f.name.includes("/") ? f.name.split("/").pop() || f.name : f.name);
      form.append("relative_paths", f.name.replace(/\\/g, "/"));
    });
    return request<{ job: Job; message: string }>(
      `/projects/${projectId}/ingest/images/upload`,
      { method: "POST", body: form }
    );
  },

  sourcesStatus: () =>
    request<{
      sources: {
        key: string;
        label: string;
        path: string;
        ingest_path: string;
        exists: boolean;
        image_count: number;
        manifest_updated_at?: string;
        mirror_available?: boolean;
        mirror_run?: { running?: boolean; pid?: number };
        archive_slug?: string;
        archive_name?: string;
        description?: string;
        site_url?: string;
        access?: string;
        credentials_configured?: boolean;
        db_stats?: { tasks?: Record<string, number>; shots?: Record<string, number> };
      }[];
      custom_archives?: {
        id: string;
        name: string;
        slug: string;
        description: string | null;
        shot_count: number;
        folder: string;
      }[];
      suggestions?: {
        key: string;
        label: string;
        site_url: string;
        blurb: string;
        fit: string;
      }[];
      mirror_runs?: Record<string, { running?: boolean; pid?: number }>;
      credentials?: Record<string, { configured?: boolean; user_hint?: string }>;
      shotdeck_mirror_run?: { running?: boolean; pid?: number };
      shotdeck_credentials_configured?: boolean;
      note?: string;
    }>("/sources/status"),

  createCustomArchive: (body: {
    name: string;
    description?: string;
    site_url?: string;
    source_note?: string;
  }) =>
    request<Project>("/archives", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  uploadToArchive: async (projectId: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => {
      form.append("files", f, f.name.includes("/") ? f.name.split("/").pop() || f.name : f.name);
      // Explicit relative path — browsers/Starlette strip slashes from File.name
      form.append("relative_paths", f.name.replace(/\\/g, "/"));
    });
    return request<{ job: Job; message: string }>(`/archives/${projectId}/upload`, {
      method: "POST",
      body: form,
    });
  },

  ingestArchiveFolder: (projectId: string) =>
    request<{ job: Job; message: string }>(`/archives/${projectId}/ingest-folder`, {
      method: "POST",
    }),

  ingestArchiveSource: (
    source: "shotdeck" | "filmgrab" | "eyecandy" | "moviestillsdb" | "stillslab"
  ) =>
    request<{ job: Job; message: string }>(`/sources/${source}/ingest`, {
      method: "POST",
    }),

  ingestSource: (
    projectId: string,
    source: "shotdeck" | "filmgrab" | "eyecandy" | "moviestillsdb" | "stillslab"
  ) =>
    request<{ job: Job; message: string }>(`/projects/${projectId}/sources/ingest`, {
      method: "POST",
      body: JSON.stringify({ source, recursive: true }),
    }),

  saveSourceCredentials: (body: { source: string; user: string; password: string }) =>
    request<{ source: string; configured: boolean; user_hint: string; message: string }>(
      "/sources/credentials",
      { method: "POST", body: JSON.stringify(body) }
    ),

  runSourceMirror: (body: {
    source: string;
    user?: string;
    password?: string;
    limit_tasks?: number;
    limit_pages?: number;
    limit_shots?: number;
    limit_films?: number;
    limit_per_tech?: number;
    max_clips?: number;
    discover_only?: boolean;
  }) =>
    request<{ message: string; pid?: number; running?: boolean }>("/sources/mirror/run", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  listCollections: (params?: { project_id?: string; kind?: string }) => {
    const q = new URLSearchParams();
    if (params?.project_id) q.set("project_id", params.project_id);
    if (params?.kind) q.set("kind", params.kind);
    const qs = q.toString();
    return request<Collection[]>(`/collections${qs ? `?${qs}` : ""}`);
  },

  getCollection: (id: string) => request<CollectionDetail>(`/collections/${id}`),

  createCollection: (body: {
    name: string;
    description?: string;
    project_id?: string;
    kind?: string;
    year?: number;
    content_format?: string;
    sampling_mode?: string;
    meta?: Record<string, unknown>;
  }) =>
    request<Collection>("/collections", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateCollection: (
    id: string,
    body: { name?: string; description?: string | null; meta?: Record<string, unknown> }
  ) =>
    request<Collection>(`/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  removeFromCollection: (collectionId: string, shotIds: string[]) =>
    request(`/collections/${collectionId}/shots/remove`, {
      method: "POST",
      body: JSON.stringify({ shot_ids: shotIds }),
    }),

  ingestIntoCollection: (
    collectionId: string,
    body: {
      paths: string[];
      project_id: string;
      recursive?: boolean;
      sampling_mode?: string;
      generate_previews?: boolean;
    }
  ) =>
    request<{ job: Job; message: string }>(`/collections/${collectionId}/ingest`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  addToCollection: (collectionId: string, shotIds: string[]) =>
    request(`/collections/${collectionId}/shots`, {
      method: "POST",
      body: JSON.stringify({ shot_ids: shotIds }),
    }),

  exportShotClip: async (shotId: string, handlesSec = 0) => {
    const res = await fetch(`${getApiUrl()}/shots/${shotId}/clip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handles_sec: handlesSec, copy_streams: false }),
    });
    if (!res.ok) throw new Error("Clip export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clip_${shotId.slice(0, 8)}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
  },

  exportShots: async (
    shotIds: string[],
    format: "zip" | "json" | "framechain" | "edl" = "zip"
  ) => {
    const res = await fetch(`${getApiUrl()}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shot_ids: shotIds, format, include_previews: false }),
    });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = format === "zip" ? "zip" : format === "edl" ? "edl" : "json";
    a.download = `cinearchive_export.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export { API_URL };
