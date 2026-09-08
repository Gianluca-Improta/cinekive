"use client";

import Link from "next/link";
import { Archive, Trash2 } from "lucide-react";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  project: Project;
  active: boolean;
  onDelete: () => void;
  shotLabel: string;
};

/** Compact archive row — name + count only (no preview thumbs). */
export function SidebarArchivePill({ project, active, onDelete, shotLabel }: Props) {
  const label = project.name.replace(/\s*Archive\s*$/i, "") || project.name;

  return (
    <div
      className={cn(
        "group mb-0.5 flex items-center rounded-md",
        active ? "bg-cinema-cyan/10" : "hover:bg-cinema-panel"
      )}
    >
      <Link
        href={`/projects/${project.id}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm",
          active ? "text-cinema-cyan" : "text-cinema-muted group-hover:text-white"
        )}
      >
        <Archive className="h-3.5 w-3.5 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-cinema-muted">
          {shotLabel.replace(/[^0-9]/g, "") || "0"}
        </span>
      </Link>
      <button
        type="button"
        title="Delete"
        onClick={onDelete}
        className="mr-1 hidden rounded p-1 text-cinema-muted hover:text-cinema-magenta group-hover:block"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
