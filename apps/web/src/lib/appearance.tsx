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

export type AppearanceTheme = "dark" | "light" | "slate";

type AppearanceContextValue = {
  theme: AppearanceTheme;
  setTheme: (t: AppearanceTheme) => void;
};

const STORAGE_KEY = "cinekive.appearance";
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function applyTheme(theme: AppearanceTheme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme !== "light");
  const color =
    theme === "light" ? "#f3f1ec" : theme === "slate" ? "#0b1220" : "#000000";
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", color);
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppearanceTheme>("dark");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) as AppearanceTheme | null;
      if (raw === "dark" || raw === "light" || raw === "slate") {
        setThemeState(raw);
        applyTheme(raw);
        return;
      }
    } catch {
      /* ignore */
    }
    applyTheme("dark");
  }, []);

  const setTheme = useCallback((t: AppearanceTheme) => {
    setThemeState(t);
    applyTheme(t);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return (
    <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
  );
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance must be used within AppearanceProvider");
  return ctx;
}
