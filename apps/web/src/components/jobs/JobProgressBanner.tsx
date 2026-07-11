"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJob } from "@/hooks/useJobs";
import { cn } from "@/lib/utils";

type Props = {
  jobId: string | null;
  onDone?: () => void;
};

export function JobProgressBanner({ jobId, onDone }: Props) {
  const { data: job } = useJob(jobId);
  const qc = useQueryClient();

  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" || job.status === "failed") {
      qc.invalidateQueries({ queryKey: ["shots"] });
      qc.invalidateQueries({ queryKey: ["search"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      onDone?.();
    }
  }, [job, onDone, qc]);

  if (!job || job.status === "completed") return null;

  const failed = job.status === "failed";

  return (
    <div
      className={cn(
        "rounded-md border px-4 py-3",
        failed
          ? "border-cinema-magenta/40 bg-cinema-magenta/10"
          : "border-cinema-cyan/30 bg-cinema-cyan/5"
      )}
    >
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className={failed ? "text-cinema-magenta" : "text-cinema-cyan"}>
          {failed ? "Ingest failed" : "Processing"}
        </span>
        <span className="font-mono text-xs text-cinema-muted">
          {job.processed_items}/{job.total_items || "…"} · {Math.round(job.progress_pct)}%
        </span>
      </div>
      <div className="mb-2 h-1 overflow-hidden rounded bg-cinema-black">
        <div
          className={cn("h-full transition-all", failed ? "bg-cinema-magenta" : "bg-cinema-cyan")}
          style={{ width: `${Math.min(100, job.progress_pct)}%` }}
        />
      </div>
      <p className="truncate text-xs text-cinema-muted">
        {failed ? job.error_message || "Unknown error" : job.current_step}
      </p>
    </div>
  );
}
