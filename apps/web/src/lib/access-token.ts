/**
 * Access token for Cinekive running on another device.
 *
 * The desktop app binds the API to this machine only. When LAN access is
 * turned on, every other device on the network must present the token that
 * the desktop app shows. The "Copy phone URL" link carries it in the URL
 * fragment so a phone can pair in one tap.
 */

const STORAGE_KEY = "cinekive.accessToken";
const COOKIE_NAME = "cinekive_token";

let cached: string | null = null;

/** True when this page is served from another machine (not loopback). */
export function isRemoteHost(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host !== "" && host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
}

function writeCookie(token: string) {
  if (typeof document === "undefined") return;
  try {
    // Cookies ignore the port, so the same cookie reaches the API on :8000.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(token)}; path=/; SameSite=Lax; max-age=31536000`;
  } catch {
    /* private mode — the header path still works for XHR */
  }
}

export function setAccessToken(token: string) {
  const value = (token || "").trim();
  cached = value;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
  writeCookie(value);
}

export function clearAccessToken() {
  setAccessToken("");
}

export function readAccessToken(): string {
  if (cached !== null) return cached;
  if (typeof window === "undefined") return "";

  // A #token=... fragment wins on first load and is then stripped from the URL.
  const raw = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  if (raw) {
    try {
      const fromHash = new URLSearchParams(raw).get("token");
      if (fromHash) {
        setAccessToken(fromHash);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        return fromHash;
      }
    } catch {
      /* malformed fragment */
    }
  }

  try {
    cached = window.localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    cached = "";
  }
  return cached;
}

export const ACCESS_TOKEN_STORAGE_KEY = STORAGE_KEY;
export const ACCESS_TOKEN_COOKIE = COOKIE_NAME;
