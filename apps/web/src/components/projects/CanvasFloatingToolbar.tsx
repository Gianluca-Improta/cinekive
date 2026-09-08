"use client";

import {
  AlignLeft,
  Frame,
  Link2,
  Redo2,
  Rows3,
  Scan,
  Sparkles,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  ArrowUpToLine,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  canUndo: boolean;
  canRedo: boolean;
  showFrameBorder: boolean;
  linkMode: boolean;
  zoomPct: number;
  hasSelection: boolean;
  hasShotSelection: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onBringForward: () => void;
  onDelete: () => void;
  onToggleFrameBorders: () => void;
  onAlignLeft: () => void;
  onRow: () => void;
  onToggleLink: () => void;
  onAddText: () => void;
  onAddSticky: () => void;
  onAddGenerate: () => void;
  className?: string;
};

function ToolBtn({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors",
        "hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400",
        active && "bg-cinema-cyan/15 text-cinema-cyan"
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-white/10" aria-hidden />;
}

/** Framechain-style dock pill — bottom-center over the canvas viewport. */
export function CanvasFloatingToolbar({
  canUndo,
  canRedo,
  showFrameBorder,
  linkMode,
  zoomPct,
  hasSelection,
  hasShotSelection,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onFit,
  onBringForward,
  onDelete,
  onToggleFrameBorders,
  onAlignLeft,
  onRow,
  onToggleLink,
  onAddText,
  onAddSticky,
  onAddGenerate,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "pointer-events-auto absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5",
        "rounded-full border border-white/[0.1] bg-[#141414]/95 px-2 py-1.5 shadow-[0_8px_32px_rgba(0,0,0,0.55)] backdrop-blur-md",
        className
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <ToolBtn title="Add text" onClick={onAddText}>
        <Type className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Add sticky" onClick={onAddSticky}>
        <StickyNote className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Add generate node" onClick={onAddGenerate}>
        <Sparkles className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Link mode" onClick={onToggleLink} active={linkMode}>
        <Link2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <Sep />
      <ToolBtn title="Undo (Ctrl/⌘Z)" onClick={onUndo} disabled={!canUndo}>
        <Undo2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Redo (Ctrl/⌘⇧Z)" onClick={onRedo} disabled={!canRedo}>
        <Redo2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <Sep />
      <ToolBtn title="Zoom out" onClick={onZoomOut}>
        <ZoomOut className="h-3.5 w-3.5" />
      </ToolBtn>
      <span className="min-w-[2.25rem] text-center font-mono text-[10px] text-zinc-500">
        {zoomPct}%
      </span>
      <ToolBtn title="Zoom in" onClick={onZoomIn}>
        <ZoomIn className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Fit" onClick={onFit}>
        <Scan className="h-3.5 w-3.5" />
      </ToolBtn>
      <Sep />
      <ToolBtn title="Bring forward" onClick={onBringForward} disabled={!hasSelection}>
        <ArrowUpToLine className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Delete selection" onClick={onDelete} disabled={!hasSelection}>
        <Trash2 className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn
        title="Frame borders"
        onClick={onToggleFrameBorders}
        active={showFrameBorder}
      >
        <Frame className="h-3.5 w-3.5" />
      </ToolBtn>
      <Sep />
      <ToolBtn title="Align left" onClick={onAlignLeft} disabled={!hasShotSelection}>
        <AlignLeft className="h-3.5 w-3.5" />
      </ToolBtn>
      <ToolBtn title="Row" onClick={onRow} disabled={!hasShotSelection}>
        <Rows3 className="h-3.5 w-3.5" />
      </ToolBtn>
    </div>
  );
}
