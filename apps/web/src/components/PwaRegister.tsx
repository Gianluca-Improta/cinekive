"use client";

import { useEffect } from "react";

/** Registers the installable PWA service worker (UI shell only). */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const ready = () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* ignore — http localhost / unsupported */
      });
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready);
    return () => window.removeEventListener("load", ready);
  }, []);
  return null;
}
