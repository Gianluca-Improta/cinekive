"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadArtifact } from "@/lib/download";
import { cn } from "@/lib/utils";

type Props = {
  url: string;
  filename: string;
  label?: ReactNode;
  title?: string;
  iconOnly?: boolean;
  className?: string;
};

export function ArtifactDownloadButton({
  url,
  filename,
  label,
  title,
  iconOnly = false,
  className,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy || !url) return;
    setBusy(true);
    try {
      await downloadArtifact(url, filename);
    } catch (err) {
      // Never navigate the app away — keep the user on the grid/detail view.
      console.warn("Artifact download failed:", err);
      window.alert("Download failed. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  };

  const Icon = busy ? Loader2 : Download;

  return (
    <button
      type="button"
      title={title || (typeof label === "string" ? label : "Download")}
      disabled={busy || !url}
      onClick={handleClick}
      className={cn(className, busy && "opacity-80")}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", busy && "animate-spin")} />
      {!iconOnly && label ? <span>{label}</span> : null}
    </button>
  );
}
