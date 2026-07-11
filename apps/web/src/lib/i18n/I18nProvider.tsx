"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_META,
  detectBrowserLocale,
  isLocaleCode,
  t as translateKey,
  type LocaleCode,
} from "@/lib/i18n";
import { LOCALE_STORAGE_KEY } from "@/lib/i18n/types";

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  /** Translate UI catalog keys. English is always the fallback. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** When true, freeform shot text (mood, notes, dialogue) is auto-translated. */
  autoTranslateContent: boolean;
  setAutoTranslateContent: (v: boolean) => void;
  locales: typeof LOCALE_META;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const AUTO_KEY = "cinekive.autoTranslateContent";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(DEFAULT_LOCALE);
  const [autoTranslateContent, setAutoState] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored && isLocaleCode(stored)) setLocaleState(stored);
      else setLocaleState(detectBrowserLocale());
      const auto = localStorage.getItem(AUTO_KEY);
      if (auto === "0") setAutoState(false);
      if (auto === "1") setAutoState(true);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale === "zh" ? "zh-Hans" : locale;
    }
  }, [locale, ready]);

  const setLocale = useCallback((code: LocaleCode) => {
    setLocaleState(code);
  }, []);

  const setAutoTranslateContent = useCallback((v: boolean) => {
    setAutoState(v);
    try {
      localStorage.setItem(AUTO_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translateKey(locale, key, vars),
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      autoTranslateContent,
      setAutoTranslateContent,
      locales: LOCALE_META,
    }),
    [locale, setLocale, t, autoTranslateContent, setAutoTranslateContent]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // Safe fallback for components rendered outside provider (shouldn't happen)
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => undefined,
      t: (key, vars) => translateKey(DEFAULT_LOCALE, key, vars),
      autoTranslateContent: false,
      setAutoTranslateContent: () => undefined,
      locales: LOCALE_META,
    };
  }
  return ctx;
}
