/** Canvas UI preferences — shortcuts + default look (localStorage). */

export type CanvasShortcutMap = {
  fit: string;
  zoomIn: string;
  zoomOut: string;
  captions: string;
  shotlist: string;
  selectAll: string;
  style: string;
};

export type CanvasThemePrefs = {
  bg: string;
  accent: string;
  cardRadius: number;
  exportTitleColor: string;
  exportMutedColor: string;
};

export const DEFAULT_SHORTCUTS: CanvasShortcutMap = {
  fit: "f",
  zoomIn: "=",
  zoomOut: "-",
  captions: "c",
  shotlist: "l",
  selectAll: "a",
  style: "t",
};

export const DEFAULT_THEME: CanvasThemePrefs = {
  bg: "#111111",
  accent: "#66FCF1",
  cardRadius: 6,
  exportTitleColor: "#66FCF1",
  exportMutedColor: "#8B98A8",
};

const SHORTCUTS_KEY = "cinekive.canvas.shortcuts.v1";
const THEME_KEY = "cinekive.canvas.theme.v1";

export function loadShortcuts(): CanvasShortcutMap {
  try {
    const raw = localStorage.getItem(SHORTCUTS_KEY);
    if (!raw) return { ...DEFAULT_SHORTCUTS };
    return { ...DEFAULT_SHORTCUTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

export function saveShortcuts(map: CanvasShortcutMap) {
  localStorage.setItem(SHORTCUTS_KEY, JSON.stringify(map));
}

export function loadThemePrefs(): CanvasThemePrefs {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return { ...DEFAULT_THEME };
    return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveThemePrefs(theme: CanvasThemePrefs) {
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
}

export function matchShortcut(e: KeyboardEvent, key: string): boolean {
  const k = (key || "").toLowerCase();
  if (!k) return false;
  if (k === "=" || k === "+") return e.key === "=" || e.key === "+";
  if (k === "-") return e.key === "-" || e.key === "_";
  return e.key.toLowerCase() === k;
}
