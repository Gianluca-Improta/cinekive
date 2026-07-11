"use client";

import { useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Props = {
  compact?: boolean;
  className?: string;
  /** Dropdown opens below (topbar) or above (sidebar footer). */
  placement?: "top" | "bottom";
};

export function LanguageSwitcher({ compact, className, placement = "top" }: Props) {
  const { locale, setLocale, locales, t, autoTranslateContent, setAutoTranslateContent } =
    useI18n();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        title={t("language.label")}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-cinema-cyan",
          open && "border-cinema-cyan/50 text-cinema-cyan"
        )}
      >
        <Languages className="h-3.5 w-3.5" />
        {!compact && <span className="uppercase tracking-wide">{locale}</span>}
      </button>

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
          />
          <div
            className={cn(
              "absolute z-50 w-56 overflow-hidden rounded border border-cinema-border bg-cinema-surface shadow-xl",
              placement === "bottom"
                ? "right-0 top-full mt-1"
                : "bottom-full left-0 mb-1"
            )}
          >
            <div className="border-b border-cinema-border px-3 py-2">
              <div className="text-[10px] uppercase tracking-widest text-cinema-muted">
                {t("language.label")}
              </div>
              <div className="mt-0.5 text-[10px] text-cinema-muted/80">{t("language.core")}</div>
            </div>
            <ul className="max-h-56 overflow-y-auto py-1">
              {locales.map((m) => (
                <li key={m.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setLocale(m.code);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-cinema-panel",
                      locale === m.code ? "text-cinema-cyan" : "text-cinema-muted hover:text-white"
                    )}
                  >
                    <span>{m.nativeLabel}</span>
                    <span className="text-[10px] opacity-60">{m.code}</span>
                  </button>
                </li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-start gap-2 border-t border-cinema-border px-3 py-2 text-[11px] text-cinema-muted hover:bg-cinema-panel">
              <input
                type="checkbox"
                checked={autoTranslateContent}
                onChange={(e) => setAutoTranslateContent(e.target.checked)}
                className="mt-0.5 accent-cinema-cyan"
              />
              <span>
                <span className="block text-white/90">{t("language.autoTranslate")}</span>
                <span className="text-[10px] text-cinema-muted">{t("language.autoTranslateHint")}</span>
              </span>
            </label>
          </div>
        </>
      )}
    </div>
  );
}
