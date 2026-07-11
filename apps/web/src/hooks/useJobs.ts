"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import type { Job } from "@/lib/types";

export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed" || status === "cancelled") {
        return false;
      }
      return 1500;
    },
  });
}

export function useProjectJobs(projectId: string | null) {
  return useQuery({
    queryKey: ["project-jobs", projectId],
    queryFn: async () => {
      const data = await api.listProjectJobs(projectId!);
      return data.items;
    },
    enabled: !!projectId,
    refetchInterval: (query) => {
      const items = query.state.data as Job[] | undefined;
      const active = items?.some((j) => j.status === "pending" || j.status === "running");
      return active ? 2000 : false;
    },
  });
}
