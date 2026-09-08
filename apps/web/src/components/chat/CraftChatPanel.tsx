"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  PanelBottom,
  Sparkles,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

const STORAGE_OPEN = "cinekive.craftChat.open";
const STORAGE_AUTO = "cinekive.craftChat.autoHide";
const STORAGE_MODE = "cinekive.craftChat.mode";
const STORAGE_DOCK_H = "cinekive.craftChat.dockH";
const STORAGE_FLOAT = "cinekive.craftChat.float";

type ChatMode = "dock" | "float";
type ChatMsg = { role: "user" | "assistant"; content: string };
type ChatAction = {
  type: string;
  label: string;
  href?: string | null;
  query?: string | null;
  prompt?: string | null;
  collection_id?: string | null;
  project_id?: string | null;
  shot_ids?: string[];
};

const OPEN_GENERATE_EVENT = "cinekive:open-generate";
const OPEN_MOODBOARD_EVENT = "cinekive:open-moodboard";

const SUGGESTIONS = [
  { label: "Library pulse", prompt: "summary" },
  { label: "Neon night wides", prompt: "find neon wet night wide" },
  { label: "Make a moodboard", prompt: "moodboard: rain courier" },
  { label: "Variant from craft", prompt: "generate: warmer practicals, rainy street" },
];

const WELCOME =
  "I'm Gemi Local AI — I search your archive, build moodboards, and kick Generate nodes. Try a chip below, or type freely.";

function dispatchGenerate(action: ChatAction) {
  if (typeof window === "undefined") return;
  if (action.project_id) {
    window.dispatchEvent(
      new CustomEvent(OPEN_MOODBOARD_EVENT, {
        detail: { projectId: action.project_id, collectionId: null },
      })
    );
  }
  const detail = {
    prompt: action.prompt || action.query || "",
    projectId: action.project_id || null,
  };
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent(OPEN_GENERATE_EVENT, { detail }));
  }, 120);
}

function projectIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/projects\/([0-9a-f-]{36})/i);
  return m?.[1];
}

type FloatRect = { x: number; y: number; w: number; h: number };

function clampFloat(r: FloatRect): FloatRect {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const w = Math.max(280, Math.min(r.w, vw - 16));
  const h = Math.max(220, Math.min(r.h, vh - 16));
  const x = Math.max(8, Math.min(r.x, vw - w - 8));
  const y = Math.max(8, Math.min(r.y, vh - h - 8));
  return { x, y, w, h };
}

function snapFloat(corner: "bl" | "br" | "tl" | "tr"): FloatRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(380, vw - 24);
  const h = Math.min(480, vh - 24);
  const pad = 12;
  if (corner === "bl") return { x: pad, y: vh - h - pad, w, h };
  if (corner === "br") return { x: vw - w - pad, y: vh - h - pad, w, h };
  if (corner === "tl") return { x: pad, y: pad, w, h };
  return { x: vw - w - pad, y: pad, w, h };
}

export function CraftChatPanel({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const projectId = projectIdFromPath(pathname);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [autoHide, setAutoHide] = useState(false);
  const [mode, setMode] = useState<ChatMode>("dock");
  const [dockH, setDockH] = useState(220);
  const [floatRect, setFloatRect] = useState<FloatRect>({ x: 24, y: 120, w: 360, h: 420 });
  const [showChips, setShowChips] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelNote, setModelNote] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: WELCOME },
  ]);
  const [actions, setActions] = useState<ChatAction[]>([]);
  const [mounted, setMounted] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef(false);
  const dragRef = useRef<{ ox: number; oy: number; sx: number; sy: number } | null>(null);
  const resizeRef = useRef<{ kind: "dock" | "float"; sx: number; sy: number; start: number | FloatRect } | null>(
    null
  );

  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => api.health(),
    refetchInterval: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!compact) return;
    // Slim sidebar: chat can't dock usefully — float it.
    setMode("float");
    setFloatRect((r) => (r.w < 280 ? snapFloat("bl") : r));
  }, [compact]);

  useEffect(() => {
    setMounted(true);
    try {
      const o = localStorage.getItem(STORAGE_OPEN);
      if (o === "0") setOpen(false);
      else if (o === "1") setOpen(true);
      setAutoHide(localStorage.getItem(STORAGE_AUTO) === "1");
      const m = localStorage.getItem(STORAGE_MODE);
      if (m === "float" || m === "dock") setMode(m);
      const h = Number(localStorage.getItem(STORAGE_DOCK_H));
      if (h >= 140 && h <= 520) setDockH(h);
      const fr = localStorage.getItem(STORAGE_FLOAT);
      if (fr) setFloatRect(clampFloat(JSON.parse(fr) as FloatRect));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_OPEN, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_AUTO, autoHide ? "1" : "0");
      localStorage.setItem(STORAGE_MODE, mode);
      localStorage.setItem(STORAGE_DOCK_H, String(dockH));
      localStorage.setItem(STORAGE_FLOAT, JSON.stringify(floatRect));
    } catch {
      /* ignore */
    }
  }, [autoHide, mode, dockH, floatRect]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, actions]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current;
        setFloatRect((prev) =>
          clampFloat({
            ...prev,
            x: d.sx + (e.clientX - d.ox),
            y: d.sy + (e.clientY - d.oy),
          })
        );
        return;
      }
      if (!resizeRef.current) return;
      const r = resizeRef.current;
      if (r.kind === "dock") {
        const startH = r.start as number;
        const next = Math.max(140, Math.min(520, startH - (e.clientY - r.sy)));
        setDockH(next);
      } else {
        const start = r.start as FloatRect;
        setFloatRect(
          clampFloat({
            ...start,
            w: start.w + (e.clientX - r.sx),
            h: start.h + (e.clientY - r.sy),
          })
        );
      }
    };
    const onUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const onMouseEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };

  const onMouseLeave = () => {
    if (!autoHide || !open || focused.current || busy || mode === "float") return;
    leaveTimer.current = setTimeout(() => setOpen(false), 2800);
  };

  const sendText = useCallback(
    async (textRaw: string) => {
      const text = textRaw.trim();
      if (!text || busy) return;
      setInput("");
      setError(null);
      setActions([]);
      setModelNote(null);
      const nextHistory = [...messages, { role: "user" as const, content: text }];
      setMessages(nextHistory);
      setBusy(true);
      setOpen(true);
      try {
        const history = nextHistory
          .filter((m) => m.content !== WELCOME)
          .slice(-12)
          .map((m) => ({ role: m.role, content: m.content }));
        const res = await api.agentChat({
          message: text,
          project_id: projectId,
          history,
          create_board: true,
        });
        setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
        setActions(res.actions || []);
        if (res.used_vlm) setModelNote("Local model answered");
        else setModelNote("Archive tools — start Ollama for freer chat");
        if (res.intent === "moodboard" && projectId) {
          qc.invalidateQueries({ queryKey: ["collections", "canvas", projectId] });
        }
        for (const a of res.actions || []) {
          if (a.type === "open_moodboard" && a.project_id) {
            window.dispatchEvent(
              new CustomEvent(OPEN_MOODBOARD_EVENT, {
                detail: { projectId: a.project_id, collectionId: a.collection_id },
              })
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Chat failed";
        if (/not found/i.test(msg)) {
          setError("Chat API missing — restart the Cinekive engine, then try again.");
        } else {
          setError(msg);
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, messages, projectId, qc]
  );

  const vlmOk = health.data?.vlm_reachable;
  const chipsVisible = showChips || (open && messages.length <= 2 && !busy);

  const transcript = open && (
    <div
      ref={scroller}
      className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 py-2.5"
      style={mode === "dock" ? { maxHeight: Math.max(80, dockH - 110) } : undefined}
    >
      {messages.map((m, i) => (
        <div
          key={`${m.role}-${i}`}
          className={cn(
            "whitespace-pre-wrap rounded-lg px-2.5 py-2 text-[11px] leading-relaxed",
            m.role === "user"
              ? "ml-5 bg-cinema-cyan/12 text-white"
              : "mr-3 bg-cinema-panel/90 text-cinema-muted"
          )}
        >
          {m.content}
        </div>
      ))}
      {!projectId && (
        <p className="text-[10px] leading-relaxed text-cinema-muted/80">
          Open a project for moodboard + Generate actions. Discovery search works from anywhere.
        </p>
      )}
      {busy && <p className="text-[10px] text-cinema-cyan/80">Working in your archive…</p>}
      {error && <p className="text-[10px] text-cinema-magenta">{error}</p>}
      {modelNote && !error && <p className="text-[9px] text-cinema-muted/70">{modelNote}</p>}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {actions.map((a) =>
            a.type === "open_generate" ? (
              <button
                key={`${a.type}-${a.label}`}
                type="button"
                onClick={() => dispatchGenerate(a)}
                className="rounded-md border border-cinema-cyan/40 bg-cinema-cyan/10 px-2.5 py-1 text-[10px] text-cinema-cyan hover:bg-cinema-cyan/20"
              >
                {a.label}
              </button>
            ) : a.href ? (
              <Link
                key={`${a.type}-${a.label}`}
                href={a.href}
                className="rounded-md border border-cinema-cyan/40 bg-cinema-cyan/10 px-2.5 py-1 text-[10px] text-cinema-cyan hover:bg-cinema-cyan/20"
              >
                {a.label}
              </Link>
            ) : null
          )}
        </div>
      )}
    </div>
  );

  const chips = chipsVisible && (
    <div className="flex flex-wrap gap-1.5 border-t border-white/[0.05] px-2.5 py-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.prompt}
          type="button"
          disabled={busy}
          onClick={() => void sendText(s.prompt)}
          className="rounded-full border border-white/[0.1] bg-cinema-black/50 px-2.5 py-1 text-[10px] text-cinema-muted transition hover:border-cinema-cyan/40 hover:text-cinema-cyan disabled:opacity-40"
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const composer = (
    <div className="border-t border-white/[0.05] p-2">
      <div className="flex items-end gap-1.5 rounded-lg border border-white/[0.1] bg-cinema-black/80 px-2 py-1.5 focus-within:border-cinema-cyan/40">
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => {
            focused.current = true;
            setShowChips(true);
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
          }}
          onBlur={() => {
            focused.current = false;
            window.setTimeout(() => {
              if (!focused.current) setShowChips(false);
            }, 180);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendText(input);
            }
          }}
          placeholder={
            projectId
              ? "Search craft, build a board, generate a variant…"
              : "Search the library…"
          }
          className="min-h-[1.75rem] max-h-20 min-w-0 flex-1 resize-none bg-transparent text-[11px] text-white outline-none placeholder:text-cinema-muted"
        />
        <button
          type="button"
          disabled={busy || !input.trim()}
          onClick={() => void sendText(input)}
          className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cinema-cyan/20 text-cinema-cyan hover:bg-cinema-cyan/30 disabled:opacity-40"
          title="Send"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  const headerBtns = (
    <>
      <button
        type="button"
        title={mode === "float" ? "Dock in sidebar" : "Float window"}
        onClick={() => {
          if (mode === "dock") {
            setMode("float");
            setOpen(true);
            setFloatRect((r) => clampFloat(r.w < 200 ? snapFloat("bl") : r));
          } else {
            setMode("dock");
          }
        }}
        className="rounded p-1 text-cinema-muted hover:text-white"
      >
        {mode === "float" ? <PanelBottom className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      </button>
      {mode === "float" && (
        <>
          <button
            type="button"
            title="Snap bottom-left"
            onClick={() => setFloatRect(snapFloat("bl"))}
            className="rounded px-1 text-[9px] text-cinema-muted hover:text-white"
          >
            BL
          </button>
          <button
            type="button"
            title="Snap bottom-right"
            onClick={() => setFloatRect(snapFloat("br"))}
            className="rounded px-1 text-[9px] text-cinema-muted hover:text-white"
          >
            BR
          </button>
        </>
      )}
      <button
        type="button"
        title={autoHide ? "Auto-hide on" : "Keep open"}
        onClick={() => setAutoHide((v) => !v)}
        className={cn(
          "rounded px-1.5 py-1 text-[10px]",
          autoHide ? "text-cinema-cyan" : "text-cinema-muted hover:text-white"
        )}
      >
        pin
      </button>
    </>
  );

  const docked = (
    <div
      data-tour="gemi"
      className="shrink-0 border-t border-white/[0.06] bg-cinema-surface"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {open && (
        <div
          className="flex h-1.5 cursor-ns-resize items-center justify-center border-b border-white/[0.04] hover:bg-cinema-cyan/10"
          title="Drag to resize"
          onPointerDown={(e) => {
            e.preventDefault();
            resizeRef.current = { kind: "dock", sx: e.clientX, sy: e.clientY, start: dockH };
          }}
        >
          <span className="h-0.5 w-8 rounded-full bg-white/20" />
        </div>
      )}
      <div className="flex items-center gap-0.5 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded bg-cinema-cyan/15">
            <Sparkles className="h-3 w-3 text-cinema-cyan" />
          </span>
          <span className="truncate font-medium text-white/90">Gemi AI Assistant</span>
          <span
            className={cn(
              "rounded px-1 py-0.5 text-[9px] uppercase tracking-wide",
              vlmOk ? "bg-cinema-cyan/15 text-cinema-cyan" : "bg-cinema-panel text-cinema-muted"
            )}
          >
            {vlmOk ? "live" : "tools"}
          </span>
          {open ? (
            <ChevronDown className="ml-auto h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="ml-auto h-3.5 w-3.5" />
          )}
        </button>
        {headerBtns}
      </div>
      {open && (
        <div className="flex flex-col border-t border-white/[0.05]" style={{ height: dockH }}>
          {transcript}
          {chips}
          {composer}
        </div>
      )}
      {!open && (
        <>
          {chips}
          {composer}
        </>
      )}
    </div>
  );

  const floating =
    mounted &&
    mode === "float" &&
    createPortal(
      <div
        className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-cinema-border bg-cinema-surface shadow-2xl"
        style={{
          left: floatRect.x,
          top: floatRect.y,
          width: floatRect.w,
          height: floatRect.h,
        }}
      >
        <div
          className="flex cursor-grab items-center gap-1 border-b border-white/[0.06] px-2 py-1.5 active:cursor-grabbing"
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            dragRef.current = {
              ox: e.clientX,
              oy: e.clientY,
              sx: floatRect.x,
              sy: floatRect.y,
            };
          }}
        >
          <Sparkles className="h-3.5 w-3.5 text-cinema-cyan" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white">
            Gemi AI Assistant
          </span>
          {headerBtns}
          <button
            type="button"
            title="Minimize"
            onClick={() => {
              setMode("dock");
              setOpen(false);
            }}
            className="rounded p-1 text-cinema-muted hover:text-white"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Close float"
            onClick={() => {
              setMode("dock");
              setOpen(false);
            }}
            className="rounded p-1 text-cinema-muted hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {transcript}
          {chips}
          {composer}
        </div>
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            resizeRef.current = {
              kind: "float",
              sx: e.clientX,
              sy: e.clientY,
              start: { ...floatRect },
            };
          }}
        />
      </div>,
      document.body
    );

  if (mode === "float") {
    return (
      <>
        <div
          data-tour="gemi"
          className={cn(
            "shrink-0 border-t border-white/[0.04] bg-cinema-surface",
            compact ? "px-1 py-1.5" : "px-2 py-1.5"
          )}
        >
          <button
            type="button"
            onClick={() => {
              if (compact) {
                setFloatRect(snapFloat("bl"));
                return;
              }
              setMode("dock");
            }}
            title={compact ? "Gemi floating — click to bring forward" : "Dock Gemi"}
            className={cn(
              "flex items-center rounded text-[11px] text-cinema-muted hover:bg-cinema-panel hover:text-white",
              compact ? "w-full justify-center px-1 py-1.5" : "w-full gap-1.5 px-1.5 py-1"
            )}
          >
            <Sparkles className="h-3.5 w-3.5 text-cinema-cyan" />
            {!compact && (
              <>
                Gemi floating…
                <PanelBottom className="ml-auto h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
        {floating}
      </>
    );
  }

  return docked;
}
