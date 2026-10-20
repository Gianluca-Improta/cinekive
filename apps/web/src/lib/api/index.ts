/**
 * The Cinekive API client.
 *
 * Split by domain so no single file holds every endpoint. The public shape
 * (the `api` object) is unchanged — lib/api-client.ts re-exports it.
 */
import { systemApi } from "./system";
import { projectsApi } from "./projects";
import { shotsApi } from "./shots";
import { searchApi } from "./search";
import { enrichApi } from "./enrich";
import { jobsApi } from "./jobs";
import { ingestApi } from "./ingest";
import { sourcesApi } from "./sources";
import { boardsApi } from "./boards";
import { collectionsApi } from "./collections";
import { exportApi } from "./export";
import { seekApi } from "./seek";
import { agentApi } from "./agent";

export const api = {
  ...systemApi,
  ...projectsApi,
  ...shotsApi,
  ...searchApi,
  ...enrichApi,
  ...jobsApi,
  ...ingestApi,
  ...sourcesApi,
  ...boardsApi,
  ...collectionsApi,
  ...exportApi,
  ...seekApi,
  ...agentApi,
};
