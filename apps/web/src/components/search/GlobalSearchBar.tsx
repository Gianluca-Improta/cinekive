"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/I18nProvider";

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
};

export function GlobalSearchBar({ value, onChange, placeholder }: Props) {
  const { t } = useI18n();
  const [local, setLocal] = useState(value);

  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    const timer = setTimeout(() => onChange(local), 300);
    return () => clearTimeout(timer);
  }, [local, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        document.getElementById("global-search")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cinema-muted" />
      <input
        id="global-search"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder || t("search.placeholder")}
        className="w-full rounded-md border border-cinema-border bg-cinema-black py-1.5 pl-8 pr-3 text-sm text-white outline-none placeholder:text-cinema-muted focus:border-cinema-cyan focus:shadow-glow"
      />
    </div>
  );
}
