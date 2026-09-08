"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Download,
  Plus,
} from "lucide-react";
import {
  emptyShotlistRow,
  normalizeShotlistRow,
  SHOTLIST_CSV_HEADERS,
  type CanvasShotlistRow,
} from "@/lib/canvas-types";
import type { Shot } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  rows: CanvasShotlistRow[];
  shots: Shot[];
  onChange: (rows: CanvasShotlistRow[]) => void;
  onFocusShot?: (shotId: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
};

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function rowToCsv(r: CanvasShotlistRow): string {
  return [
    r.done ? "✓" : "",
    r.setupNumber,
    r.number,
    r.subject,
    r.description,
    r.reference,
    r.shotSizeStart,
    r.shotSizeEnd,
    r.angleStart,
    r.angleEnd,
    r.moveStart,
    r.moveEnd,
    r.composition,
    r.dialogVo,
    r.soundDesign,
    r.scriptTimeSec,
  ]
    .map((x) => csvEscape(String(x ?? "")))
    .join(",");
}

function parsePaste(text: string): CanvasShotlistRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (line: string) => {
    if (line.includes("\t")) return line.split("\t").map((p) => p.trim());
    // naive CSV split respecting quotes
    const out: string[] = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (q && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = !q;
      } else if (ch === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const first = split(lines[0]!).map((h) => h.toLowerCase());
  const looksHeader =
    first.some((h) => h.includes("shot")) ||
    first.some((h) => h.includes("setup")) ||
    first.some((h) => h.includes("subject"));
  const dataLines = looksHeader ? lines.slice(1) : lines;
  return dataLines.map((line, i) => {
    const p = split(line);
    // Support both commercial template order and legacy short paste
    if (p.length >= 8 || looksHeader) {
      const offset = looksHeader && first[0]?.includes("done") ? 0 : 0;
      return normalizeShotlistRow({
        done: Boolean(p[offset] && p[offset] !== "0" && p[offset] !== "false"),
        setupNumber: p[1 + offset] || "",
        number: p[2 + offset] || String(i + 1),
        subject: p[3 + offset] || "",
        description: p[4 + offset] || "",
        reference: p[5 + offset] || "",
        shotSizeStart: p[6 + offset] || "",
        shotSizeEnd: p[7 + offset] || "",
        angleStart: p[8 + offset] || "",
        angleEnd: p[9 + offset] || "",
        moveStart: p[10 + offset] || "",
        moveEnd: p[11 + offset] || "",
        composition: p[12 + offset] || "",
        dialogVo: p[13 + offset] || "",
        soundDesign: p[14 + offset] || "",
        scriptTimeSec: p[15 + offset] || "",
      });
    }
    return normalizeShotlistRow({
      number: p[0] || String(i + 1),
      description: p[1] || "",
      shotSizeStart: p[2] || "",
      subject: p[3] || "",
    });
  });
}

const COLS: { key: keyof CanvasShotlistRow; label: string; w: string }[] = [
  { key: "done", label: "✓", w: "w-8" },
  { key: "setupNumber", label: "Setup #", w: "w-16" },
  { key: "number", label: "Shot #", w: "w-14" },
  { key: "subject", label: "Subject", w: "w-28" },
  { key: "description", label: "Description", w: "min-w-[12rem] flex-1" },
  { key: "reference", label: "Reference", w: "w-28" },
  { key: "shotSizeStart", label: "Size ↓", w: "w-20" },
  { key: "shotSizeEnd", label: "Size ↑", w: "w-20" },
  { key: "angleStart", label: "Angle ↓", w: "w-20" },
  { key: "angleEnd", label: "Angle ↑", w: "w-20" },
  { key: "moveStart", label: "Move ↓", w: "w-24" },
  { key: "moveEnd", label: "Move ↑", w: "w-24" },
  { key: "composition", label: "Comp", w: "w-24" },
  { key: "dialogVo", label: "Dialog/VO", w: "w-28" },
  { key: "soundDesign", label: "Sound", w: "w-24" },
  { key: "scriptTimeSec", label: "Sec", w: "w-14" },
];

export function CanvasShotlistPanel({
  rows,
  shots,
  onChange,
  onFocusShot,
  collapsed,
  onToggle,
}: Props) {
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const shotMap = useMemo(() => new Map(shots.map((s) => [s.id, s])), [shots]);

  const update = (id: string, patch: Partial<CanvasShotlistRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    onChange([
      ...rows,
      emptyShotlistRow({ number: String(rows.length + 1) }),
    ]);
  };

  const removeRow = (id: string) => onChange(rows.filter((r) => r.id !== id));

  const applyPaste = () => {
    const parsed = parsePaste(pasteText);
    if (!parsed.length) return;
    onChange([...rows, ...parsed]);
    setPasteText("");
    setPasteOpen(false);
  };

  const downloadCsv = () => {
    const body = [SHOTLIST_CSV_HEADERS.join(","), ...rows.map(rowToCsv)].join("\n");
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "shotlist.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-cinema-surface/95">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="flex flex-1 items-center gap-1.5 text-left text-[11px] text-white"
        >
          {collapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Shotlist
          <span className="text-cinema-muted">{rows.length ? `· ${rows.length}` : " · commercial template"}</span>
        </button>
        {!collapsed && (
          <>
            <button
              type="button"
              onClick={() => setPasteOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-cinema-muted hover:text-cinema-cyan"
              title="Paste CSV / TSV (Excel columns OK)"
            >
              <ClipboardPaste className="h-3 w-3" />
              Paste
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-cinema-muted hover:text-cinema-cyan"
              title="Download CSV"
            >
              <Download className="h-3 w-3" />
              CSV
            </button>
            <button
              type="button"
              onClick={addRow}
              className="inline-flex items-center gap-1 rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-cinema-muted hover:text-cinema-cyan"
            >
              <Plus className="h-3 w-3" />
              Row
            </button>
          </>
        )}
      </div>

      {!collapsed && pasteOpen && (
        <div className="space-y-1 border-t border-white/[0.05] px-3 py-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={
              "Paste from Excel — columns: Done, Setup #, Shot #, Subject, Description, Reference, sizes, angles, moves…"
            }
            className="h-20 w-full rounded border border-white/[0.08] bg-cinema-black px-2 py-1.5 font-mono text-[10px] text-white outline-none focus:border-cinema-cyan/40"
          />
          <button
            type="button"
            onClick={applyPaste}
            className="rounded border border-cinema-cyan/40 px-2 py-1 text-[10px] text-cinema-cyan"
          >
            Add pasted rows
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="max-h-52 overflow-auto">
          <table className="w-max min-w-full border-collapse text-left text-[10px]">
            <thead className="sticky top-0 z-10 bg-cinema-surface">
              <tr className="text-cinema-muted">
                {COLS.map((c) => (
                  <th key={c.key} className={cn("px-1.5 py-1 font-medium", c.w)}>
                    {c.label}
                  </th>
                ))}
                <th className="w-28 px-1.5 py-1">Link</th>
                <th className="w-10 px-1.5 py-1" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/[0.04] hover:bg-cinema-panel/40">
                  {COLS.map((c) => (
                    <td key={c.key} className="px-1 py-0.5">
                      {c.key === "done" ? (
                        <input
                          type="checkbox"
                          checked={Boolean(r.done)}
                          onChange={(e) => update(r.id, { done: e.target.checked })}
                          className="accent-cinema-cyan"
                        />
                      ) : (
                        <input
                          value={String(r[c.key] ?? "")}
                          onChange={(e) => update(r.id, { [c.key]: e.target.value })}
                          className={cn(
                            "w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-white outline-none focus:border-cinema-cyan/30",
                            c.w
                          )}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-1 py-0.5">
                    <select
                      value={r.shotId || ""}
                      onChange={(e) => {
                        const shotId = e.target.value || null;
                        update(r.id, { shotId });
                        if (shotId) onFocusShot?.(shotId);
                      }}
                      className="max-w-[7rem] rounded border border-white/[0.08] bg-cinema-black px-1 py-0.5 text-[10px] text-cinema-muted outline-none"
                    >
                      <option value="">—</option>
                      {shots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.source_title || s.source_filename || s.id.slice(0, 6)}
                        </option>
                      ))}
                    </select>
                    {r.shotId && shotMap.get(r.shotId) && (
                      <button
                        type="button"
                        className="ml-1 text-cinema-cyan hover:underline"
                        onClick={() => onFocusShot?.(r.shotId!)}
                      >
                        go
                      </button>
                    )}
                  </td>
                  <td className="px-1 py-0.5">
                    <button
                      type="button"
                      className="text-cinema-muted hover:text-cinema-magenta"
                      onClick={() => removeRow(r.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={COLS.length + 2} className="px-3 py-4 text-cinema-muted">
                    Empty shotlist — Add row or paste from your Excel template (Setup #, Shot #,
                    Subject, Description…).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
