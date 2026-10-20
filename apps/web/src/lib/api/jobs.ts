/** Job and activity status. */

import { request } from "./client";
import type { Job } from "../types";

  const getJob = (id: string) => request<Job>(`/jobs/${id}`);

  const listRecentJobs = (limit = 40) =>
      request<{ items: Job[]; total: number }>(`/jobs?limit=${limit}`);

  const listActivity = (limit = 40) =>
      request<{
        items: Job[];
        total: number;
        enrich: {
          enabled: boolean;
          continuous: boolean;
          busy: boolean;
          vlm_reachable: boolean;
          pending_shots: number;
          last_pass_at: number | null;
          last_processed: number;
          last_model: string | null;
          current_step: string | null;
          interval_sec?: number;
        } | null;
      }>(`/activity?limit=${limit}`);

  const enrichStatus = () =>
      request<{
        enabled: boolean;
        continuous: boolean;
        busy: boolean;
        vlm_reachable: boolean;
        pending_shots: number;
        current_step: string | null;
        last_pass_at: number | null;
        last_processed: number;
        last_model: string | null;
      }>("/enrich/status");

  const listProjectJobs = (projectId: string) =>
      request<{ items: Job[]; total: number }>(`/projects/${projectId}/jobs`);

export const jobsApi = {
  getJob,
  listRecentJobs,
  listActivity,
  enrichStatus,
  listProjectJobs,
};
