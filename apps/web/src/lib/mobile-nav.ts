/**
 * Mobile navigation drawer.
 *
 * Below the `md` breakpoint the sidebar becomes an overlay drawer so the
 * content gets the whole screen. The toggle lives in the top bar; the drawer
 * closes on navigation, on backdrop tap, and on Escape.
 */

const OPEN_EVENT = "cinekive:nav-open";
const CLOSE_EVENT = "cinekive:nav-close";
const TOGGLE_EVENT = "cinekive:nav-toggle";

export const MOBILE_NAV_BREAKPOINT = "(max-width: 767px)";

export function isMobileViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(MOBILE_NAV_BREAKPOINT).matches;
}

export function openMobileNav() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
}

export function closeMobileNav() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CLOSE_EVENT));
}

export function toggleMobileNav() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
}
