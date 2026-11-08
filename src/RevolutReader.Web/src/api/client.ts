import createClient from "openapi-fetch";

import type { paths } from "./schema";

/**
 * The app's one API client (c007 design.md D9), typed from the API's OpenAPI document. It calls the page's own origin,
 * which serves the API under `/api`: in production the same server, locally Vite, which forwards `/api` to the API.
 */
export const api = createClient<paths>({ baseUrl: window.location.origin });
