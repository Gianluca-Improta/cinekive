"use client";

import { Layers } from "lucide-react";
import { useMode } from "@/lib/modes";
import { cn } from "@/lib/utils";

/**
 * Switches the archive vocabulary. One app, several ways of looking at it —
 * cinematic stills, architecture, fashion, product design.
 */
export function ModeSwitcher() {
  const { pack, modes, selectMode } = useMode();

  if (modes.length <= 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1 text-xs text-cinema-muted">
        <Layers className="h-3.5 w-3.5" />
        {pack.short_label}
      </span>
    );
  }

  return (
    <label className="inline-flex items-center gap-1.5 rounded border border-white/[0.08] px-2 py-1 text-xs text-cinema-muted hover:border-cinema-cyan/40">
      <Layers className="h-3.5 w-3.5" />
      <select
        value={pack.id}
        onChange={(e) => selectMode(e.target.value)}
        className={cn("bg-transparent outline-none", "max-w-[9rem] truncate")}
        title={`Archive mode: ${pack.label}`}
        aria-label="Archive mode"
      >
        {modes.map((mode) => (
          <option key={mode.id} value={mode.id} className="bg-cinema-surface text-cinema-body">
            {mode.label}
          </option>
        ))}
      </select>
    </label>
  );
}
