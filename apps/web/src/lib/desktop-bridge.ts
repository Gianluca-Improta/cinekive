/** Electron preload bridge (`window.cinekive`) — absent in plain browser. */

export type CinekiveDesktopBridge = {
  pickLibraryFolder?: () => Promise<string | null>;
  chooseLibraryFolder?: () => Promise<{ ok: boolean; path?: string; restarted?: boolean } | null>;
  openExternal?: (url: string) => Promise<void>;
  getHealthStatus?: () => Promise<{
    lanAccess?: boolean;
    apiToken?: string | null;
    lan?: { ip?: string | null; webUrl?: string | null; apiUrl?: string | null };
  }>;
  setLanAccess?: (enabled: boolean) => Promise<{
    ok: boolean;
    lanAccess: boolean;
    apiToken?: string;
    lan?: { ip?: string | null; webUrl?: string | null; apiUrl?: string | null };
  }>;
};

export function desktopBridge(): CinekiveDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { cinekive?: CinekiveDesktopBridge };
  return w.cinekive ?? null;
}
