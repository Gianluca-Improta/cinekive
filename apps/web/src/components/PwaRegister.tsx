"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker and auto-activates updates.
 * You do NOT need to reinstall the PWA after code changes — network-first
 * SW + periodic update checks reload the shell when a new worker is ready.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    const onControllerChange = () => {
      // New SW took control — soft reload once
      if (sessionStorage.getItem("cinekive.swReloaded") === "1") return;
      sessionStorage.setItem("cinekive.swReloaded", "1");
      window.location.reload();
    };

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        if (cancelled) return;

        const askSkipWaiting = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.postMessage({ type: "SKIP_WAITING" });
        };

        if (reg.waiting) askSkipWaiting(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              askSkipWaiting(installing);
            }
          });
        });

        // Poll for updates while the tab is open (dev + long sessions)
        const tick = () => {
          void reg.update().catch(() => undefined);
        };
        tick();
        const id = window.setInterval(tick, 60_000);
        return () => window.clearInterval(id);
      } catch {
        /* http / unsupported */
      }
      return undefined;
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    let clearPoll: (() => void) | undefined;
    const ready = () => {
      void register().then((cleanup) => {
        clearPoll = cleanup;
      });
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready);

    // Clear one-shot reload flag after settle
    window.setTimeout(() => sessionStorage.removeItem("cinekive.swReloaded"), 5000);

    return () => {
      cancelled = true;
      clearPoll?.();
      window.removeEventListener("load", ready);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
