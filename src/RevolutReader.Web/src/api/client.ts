import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * The app's one API client (c007 design.md D9), typed from the API's OpenAPI document. It calls the page's own origin,
 * which serves the API under `/api`: in production the same server, locally Vite, which forwards `/api` to the API.
 */
export const api = createClient<paths>({ baseUrl: window.location.origin });

/**
 * Whether a request the client rejected still got an answer (c009 design.md D2, D5): the client rejects with a
 * `SyntaxError` when a success's body is not JSON (a public Wi-Fi's login page, say), which is an answer, only not the
 * one expected; every other rejection means none came: the request failed, broke off, or was aborted.
 */
export function wasAnswered(failure: unknown): boolean {
  return failure instanceof SyntaxError;
}
