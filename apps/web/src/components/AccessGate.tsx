"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { isRemoteHost, readAccessToken, setAccessToken } from "@/lib/access-token";

/**
 * Shown when Cinekive runs on another device (phone on the same WiFi) and the
 * API asks for the access token shown in the desktop app.
 */
export function AccessGate() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const show = useCallback(() => {
    setToken(readAccessToken());
    setOpen(true);
  }, []);

  useEffect(() => {
    const onRequired = () => show();
    window.addEventListener("cinekive:auth-required", onRequired);
    // A remote host without a token cannot talk to the API at all.
    if (isRemoteHost() && !readAccessToken()) show();
    return () => window.removeEventListener("cinekive:auth-required", onRequired);
  }, [show]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const value = token.trim();
      if (!value) {
        setError("Paste the access token from the desktop app.");
        return;
      }
      setBusy(true);
      setError("");
      setAccessToken(value);
      // Re-request everything with the token in place.
      window.location.reload();
    },
    [token]
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-white/10 bg-cinema-panel p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2 text-cinema-cyan">
          <KeyRound size={18} />
          <h2 className="text-sm font-semibold text-white">Connect to Cinekive</h2>
        </div>
        <p className="mb-3 text-xs leading-relaxed text-cinema-muted">
          This device is outside the computer running Cinekive. Enter the access token shown in
          the desktop app (Share → Copy phone URL) to continue.
        </p>
        <input
          autoFocus
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Access token"
          spellCheck={false}
          autoComplete="off"
          className="mb-2 w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white outline-none focus:border-cinema-cyan"
        />
        {error ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-cinema-cyan px-3 py-2 text-xs font-semibold text-black disabled:opacity-60"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Connect
        </button>
      </form>
    </div>
  );
}
