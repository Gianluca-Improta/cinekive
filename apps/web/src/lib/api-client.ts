/**
 * Public API surface.
 *
 * The implementation lives in ./api/* (one module per domain). This file keeps
 * the historical import path working: `import { api } from "@/lib/api-client"`.
 */
export { api } from "./api";
export { API_URL, artifactUrl, getApiUrl, isPrivateHost } from "./api/client";
export { ApiAuthError, isAuthError } from "./api/client";
export type { ModeListResponse, ModePack } from "./api/client";
