"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cpu, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

/**
 * Settings → VLM / craft AI — pick local Ollama or any OpenAI-compatible
 * endpoint (OpenRouter, Kimi, LM Studio, OpenClaw gateways…).
 */
export function VlmSettingsPanel() {
  const qc = useQueryClient();
  const cfgQuery = useQuery({
    queryKey: ["enrich-config"],
    queryFn: () => api.enrichConfig(),
    staleTime: 10_000,
  });
  const modelsQuery = useQuery({
    queryKey: ["enrich-models"],
    queryFn: () => api.enrichModels(),
    staleTime: 30_000,
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    staleTime: 15_000,
  });

  const cfg = cfgQuery.data;
  const [provider, setProvider] = useState<"ollama" | "openai_compatible">("ollama");
  const [enabled, setEnabled] = useState(false);
  const [continuous, setContinuous] = useState(true);
  const [tier, setTier] = useState("auto");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("");
  const [openaiUrl, setOpenaiUrl] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("");
  const [dirtyKey, setDirtyKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg) return;
    setProvider(cfg.provider);
    setEnabled(cfg.enabled);
    setContinuous(cfg.enrich_continuous);
    setTier(cfg.enrich_tier || "auto");
    setOllamaUrl(cfg.ollama_url || "");
    setOllamaModel(cfg.ollama_model || "");
    setOpenaiUrl(cfg.openai_base_url || "");
    setOpenaiModel(cfg.openai_model || "");
    setOpenaiKey("");
    setDirtyKey(false);
  }, [cfg]);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        enabled,
        provider,
        enrich_continuous: continuous,
        enrich_tier: tier,
        ollama_url: ollamaUrl,
        ollama_model: ollamaModel,
        openai_base_url: openaiUrl,
        openai_model: openaiModel,
      };
      if (dirtyKey) body.openai_api_key = openaiKey;
      return api.updateEnrichConfig(body);
    },
    onSuccess: async () => {
      setMsg("Saved — enrichment uses this config live (no restart).");
      setDirtyKey(false);
      setOpenaiKey("");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["enrich-config"] }),
        qc.invalidateQueries({ queryKey: ["enrich-models"] }),
        qc.invalidateQueries({ queryKey: ["enrich-tiers"] }),
        qc.invalidateQueries({ queryKey: ["health"] }),
      ]);
    },
    onError: (e: Error) => setMsg(e.message || "Save failed"),
  });

  const applyPreset = useMutation({
    mutationFn: (preset: string) => api.updateEnrichConfig({ preset }),
    onSuccess: async () => {
      setMsg("Preset applied");
      await qc.invalidateQueries({ queryKey: ["enrich-config"] });
      await qc.invalidateQueries({ queryKey: ["enrich-models"] });
    },
  });

  const tick = useMutation({
    mutationFn: () => api.enrichTick(),
    onSuccess: () => setMsg("Enrich drip queued"),
  });

  const models = modelsQuery.data?.models || [];
  const reachable = health.data?.vlm_reachable;
  const active = health.data?.enrich?.model || cfg?.active_model;

  return (
    <section className="space-y-3" data-no-translate>
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-cinema-cyan" />
        <h2 className="text-sm font-medium text-white">Craft AI (VLM)</h2>
      </div>
      <p className="text-xs text-cinema-muted">
        Tags shots with craft DNA. Use local Ollama, or paste any OpenAI-compatible URL
        (OpenRouter, Kimi/Moonshot, LM Studio, OpenClaw, vLLM…). Changes apply live.
      </p>

      <div className="rounded-xl border border-cinema-border bg-cinema-surface/50 p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          <label className="inline-flex items-center gap-2 text-cinema-muted">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-cinema-cyan"
            />
            <span className="text-white">Enabled</span>
          </label>
          <label className="inline-flex items-center gap-2 text-cinema-muted">
            <input
              type="checkbox"
              checked={continuous}
              onChange={(e) => setContinuous(e.target.checked)}
              className="accent-cinema-cyan"
            />
            <span className="text-white">Always-on drip</span>
          </label>
          <span
            className={cn(
              "rounded border px-2 py-0.5",
              reachable
                ? "border-cinema-cyan/40 text-cinema-cyan"
                : "border-cinema-border text-cinema-muted"
            )}
          >
            {reachable ? `Reachable · ${active || "model"}` : "Unreachable / off"}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {(cfg?.presets || []).map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              onClick={() => applyPreset.mutate(p.id)}
              className="rounded border border-cinema-border px-2 py-1 text-[11px] text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-cinema-muted">Provider</span>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "ollama" | "openai_compatible")}
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
            >
              <option value="ollama">Ollama (local)</option>
              <option value="openai_compatible">OpenAI-compatible URL</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-cinema-muted">Tier</span>
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 text-xs text-white outline-none focus:border-cinema-cyan"
            >
              <option value="auto">Auto (VRAM)</option>
              <option value="fast">Fast</option>
              <option value="balanced">Balanced</option>
              <option value="quality">Quality</option>
            </select>
          </label>
        </div>

        {provider === "ollama" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                Ollama URL
              </span>
              <input
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://host.docker.internal:11434"
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </label>
            <label className="block space-y-1 sm:col-span-2">
              <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                Model
              </span>
              <input
                list="cinekive-vlm-models"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="qwen3-vl:8b"
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </label>
          </div>
        ) : (
          <div className="grid gap-3">
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                Base URL (…/v1)
              </span>
              <input
                value={openaiUrl}
                onChange={(e) => setOpenaiUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                API key {cfg?.openai_api_key_set ? `(set ${cfg.openai_api_key_masked})` : ""}
              </span>
              <input
                type="password"
                value={openaiKey}
                onChange={(e) => {
                  setOpenaiKey(e.target.value);
                  setDirtyKey(true);
                }}
                placeholder={cfg?.openai_api_key_set ? "Leave blank to keep" : "sk-…"}
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-cinema-muted">
                Model id
              </span>
              <input
                list="cinekive-vlm-models"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                placeholder="google/gemini-2.5-flash"
                className="w-full rounded border border-cinema-border bg-cinema-black px-2 py-1.5 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
              />
            </label>
          </div>
        )}

        <datalist id="cinekive-vlm-models">
          {models.slice(0, 200).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>

        {modelsQuery.data?.error && (
          <p className="text-[11px] text-cinema-magenta">Model list: {modelsQuery.data.error}</p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-cyan/40 bg-cinema-cyan/10 px-3 py-1.5 text-xs text-cinema-cyan hover:bg-cinema-cyan/20 disabled:opacity-50"
          >
            <Cpu className="h-3.5 w-3.5" />
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              void modelsQuery.refetch();
              void health.refetch();
            }}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh models
          </button>
          <button
            type="button"
            disabled={!enabled || tick.isPending}
            onClick={() => tick.mutate()}
            className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-3 py-1.5 text-xs text-cinema-muted hover:text-cinema-cyan disabled:opacity-40"
          >
            Run one enrich pass
          </button>
        </div>

        {msg && <p className="text-[11px] text-cinema-muted">{msg}</p>}
      </div>
    </section>
  );
}
