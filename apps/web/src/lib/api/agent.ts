/** Agent API. */

import { request } from "./client";
import type { Shot } from "../types";

  const agentQuery = (body: { prompt: string; project_id?: string; limit?: number }) =>
      request<{
        interpretation: Record<string, unknown>;
        results: { shot: Shot; score: number }[];
        message: string;
      }>("/agent/query", {
        method: "POST",
        body: JSON.stringify(body),
      });

  const agentChat = (body: {
      message: string;
      project_id?: string;
      history?: { role: "user" | "assistant" | "system"; content: string }[];
      create_board?: boolean;
    }) =>
      request<{
        reply: string;
        intent: string;
        actions: {
          type: string;
          label: string;
          href?: string | null;
          query?: string | null;
          prompt?: string | null;
          collection_id?: string | null;
          project_id?: string | null;
          shot_ids?: string[];
        }[];
        shot_ids: string[];
        used_vlm: boolean;
        model_online?: boolean;
      }>("/agent/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });

export const agentApi = {
  agentQuery,
  agentChat,
};
