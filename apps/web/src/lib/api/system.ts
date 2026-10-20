/** System, settings, enrichment configuration and modes. */

import { request } from "./client";
import type { Job, Taxonomy } from "../types";
import type { ModeListResponse, ModePack } from "./client";

  const health = () =>
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
      }>("/health");

  const systemInfo = () =>
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
      }>("/system");

  const enrichTiers = () =>
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
      }>("/enrich/tiers");

  const enrichConfig = () =>
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
          cloud?: boolean;
          ollama_url?: string;
          openai_base_url?: string;
          openai_model?: string;
        }[];
      }>("/enrich/config");

  const updateEnrichConfig = (body: Record<string, unknown>) =>
      request<{ ok: boolean; config: Record<string, unknown> }>("/enrich/config", {
        method: "PUT",
        body: JSON.stringify(body),
      });

  const getLibraryConfig = () =>
      request<{
        config: {
          max_edge: number;
          jpeg_quality: number;
          export_upscale: number;
          realesrgan_enabled: boolean;
          realesrgan_bin: string | null;
          dedupe_on_ingest?: boolean;
          dedupe_global?: boolean;
          dedupe_prefs_initialized?: boolean;
          archives: Record<
            string,
            { max_edge?: number; jpeg_quality?: number; export_upscale?: number }
          >;
        };
        realesrgan_available: boolean;
        realesrgan_path: string | null;
        presets: {
          max_edge: { value: number; label: string }[];
          export_upscale: { value: number; label: string }[];
        };
      }>("/system/library");

  const updateLibraryConfig = (body: Record<string, unknown>) =>
      request<{
        ok: boolean;
        config: Record<string, unknown>;
        realesrgan_available: boolean;
        realesrgan_path: string | null;
      }>("/system/library", {
        method: "PUT",
        body: JSON.stringify(body),
      });

  const verifyLibrary = () =>
      request<{
        ok: boolean;
        sqlite: {
          projects: number;
          shots_active: number;
          shots_trashed: number;
          ids_sampled: number;
        };
        qdrant: {
          collection: string;
          points: number;
          vector_size: number | null;
          expected_dim: number;
          embedding_model: string;
          ids_sampled: number;
        };
        issues: { code: string; severity: string; message: string }[];
        warnings: { code: string; severity: string; message: string }[];
      }>("/system/verify-library");

  const rebuildIndex = () =>
      request<{
        ok: boolean;
        projects: number;
        job_ids: string[];
        message: string;
      }>("/system/rebuild-index", { method: "POST" });

  const enrichModels = () =>
      request<{
        provider: string;
        models: string[];
        active_model: string;
        error?: string | null;
      }>("/enrich/models");

  const enrichTick = () =>
      request<{ queued: boolean; message: string }>("/enrich/tick", { method: "POST" });

  const shotQuality = (shotId: string) =>
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
      }>(`/shots/${shotId}/quality`);

  const getModes = () => request<ModeListResponse>("/modes");

  const getMode = (modeId: string) => request<ModePack>(`/modes/${modeId}`);

  const listLanguages = () =>
      request<{
        core: string;
        languages: { code: string; name: string }[];
        note: string;
      }>("/languages");

export const systemApi = {
  health,
  systemInfo,
  enrichTiers,
  enrichConfig,
  updateEnrichConfig,
  getLibraryConfig,
  updateLibraryConfig,
  verifyLibrary,
  rebuildIndex,
  enrichModels,
  enrichTick,
  shotQuality,
  getModes,
  getMode,
  listLanguages,
};
