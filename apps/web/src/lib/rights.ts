/** Infer display rights / provenance badges for stills (trust layer, not legal advice). */

import type { Shot } from "@/lib/types";

export type RightsTone = "cyan" | "amber" | "muted" | "violet" | "rose";

export type RightsBadge = {
  code: "cleared" | "subscription" | "reference" | "generated" | "personal" | "unknown";
  label: string;
  /** Short tooltip */
  hint: string;
  tone: RightsTone;
};

const TONE_CLASS: Record<RightsTone, string> = {
  cyan: "border-cinema-cyan/40 text-cinema-cyan bg-cinema-cyan/10",
  amber: "border-amber-400/40 text-amber-200 bg-amber-400/10",
  muted: "border-cinema-border text-cinema-muted bg-black/40",
  violet: "border-violet-400/40 text-violet-200 bg-violet-400/10",
  rose: "border-rose-400/40 text-rose-200 bg-rose-400/10",
};

export function rightsToneClass(tone: RightsTone): string {
  return TONE_CLASS[tone];
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Prefer explicit sidecar / source_meta.rights, else infer from provenance tags. */
export function inferRights(shot: Shot): RightsBadge {
  const meta = shot.source_meta || {};
  const explicit = meta.rights;
  if (explicit && typeof explicit === "object" && !Array.isArray(explicit)) {
    const o = explicit as Record<string, unknown>;
    const code = String(o.code || o.status || "unknown").toLowerCase();
    const label = String(o.label || code);
    const hint = String(o.hint || o.note || "User-declared rights on this still.");
    const mapped = mapCode(code, label, hint);
    if (mapped) return mapped;
  }
  const rightsStr = metaString(meta, "rights") || metaString(meta, "license");
  if (rightsStr) {
    const lower = rightsStr.toLowerCase();
    if (/clear|own|commission|buyout|work.?for.?hire/.test(lower)) {
      return {
        code: "cleared",
        label: "Cleared",
        hint: rightsStr,
        tone: "cyan",
      };
    }
    if (/cc0|public.?domain/.test(lower)) {
      return {
        code: "cleared",
        label: "Public domain",
        hint: rightsStr,
        tone: "cyan",
      };
    }
  }

  const tags = (shot.tags || []).map((t) => t.toLowerCase());
  const origin = (shot.origin || "").toLowerCase();
  const blob = `${tags.join(" ")} ${JSON.stringify(meta).toLowerCase()} ${origin}`;

  if (origin === "generated" || tags.includes("generated") || meta.origin === "generated") {
    return {
      code: "generated",
      label: "AI generated",
      hint: "Synthetic still — check your model / platform terms before commercial use.",
      tone: "violet",
    };
  }
  if (/shotdeck|stillslab/.test(blob)) {
    return {
      code: "subscription",
      label: "Subscription ref",
      hint: "Mirrored under your account access — not a redistribution license.",
      tone: "amber",
    };
  }
  if (/filmgrab|eyecandy|moviestills/.test(blob)) {
    return {
      code: "reference",
      label: "Study reference",
      hint: "Curated reference still — for craft study / boards; clear rights before publish.",
      tone: "muted",
    };
  }
  if (meta.custom_archive || meta.user_upload || shot.source_type === "video") {
    return {
      code: "personal",
      label: "Your media",
      hint: "From your library / ingest — you control clearance.",
      tone: "cyan",
    };
  }
  return {
    code: "unknown",
    label: "Rights unknown",
    hint: "Add rights in sidecar JSON or source_meta.rights when you clear commercial use.",
    tone: "rose",
  };
}

function mapCode(code: string, label: string, hint: string): RightsBadge | null {
  if (/clear|own|pd|cc0/.test(code)) {
    return { code: "cleared", label: label || "Cleared", hint, tone: "cyan" };
  }
  if (/sub|shotdeck|licensed.?access/.test(code)) {
    return { code: "subscription", label: label || "Subscription", hint, tone: "amber" };
  }
  if (/ref|study|fair.?use/.test(code)) {
    return { code: "reference", label: label || "Reference", hint, tone: "muted" };
  }
  if (/gen|ai|synth/.test(code)) {
    return { code: "generated", label: label || "Generated", hint, tone: "violet" };
  }
  if (/personal|own.?upload|user/.test(code)) {
    return { code: "personal", label: label || "Personal", hint, tone: "cyan" };
  }
  return null;
}
