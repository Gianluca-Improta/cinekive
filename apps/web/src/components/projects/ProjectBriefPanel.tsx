"use client";

import { useState } from "react";
import { Settings2 } from "lucide-react";
import { ProjectSetupModal } from "@/components/projects/ProjectSetupModal";
import type { Project } from "@/lib/types";

type Props = {
  project: Project;
};

/** Opens project brief / management in a modal (replaces inline accordion). */
export function ProjectBriefPanel({ project }: Props) {
  const [open, setOpen] = useState(false);
  const hasBrief = Boolean(project.brief || project.feeling);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-cinema-border px-2 py-1.5 text-xs text-cinema-muted hover:border-cinema-cyan/40 hover:text-white"
        title="Project brief & management"
      >
        <Settings2 className="h-3.5 w-3.5" />
        <span className="hidden lg:inline">Brief</span>
        {hasBrief && <span className="h-1.5 w-1.5 rounded-full bg-cinema-cyan" />}
      </button>
      <ProjectSetupModal open={open} onClose={() => setOpen(false)} project={project} />
    </>
  );
}
