/** Electron preload bridge (`window.cinekive`) — absent in plain browser. */

export type CinekiveDesktopBridge = {
  pickLibraryFolder?: () => Promise<string | null>;
  chooseLibraryFolder?: () => Promise<{ ok: boolean; path?: string; restarted?: boolean } | null>;
  openExternal?: (url: string) => Promise<void>;
};

export function desktopBridge(): CinekiveDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { cinekive?: CinekiveDesktopBridge };
  return w.cinekive ?? null;
}
