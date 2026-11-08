/**
 * The addresses the server answers itself, never with the app's page (spec app-delivery, c003 design.md D5, D9): the
 * API and the health probe. The service worker leaves navigations to them to the network. Workbox tests these
 * patterns against the path plus the query string, so they allow a query, and they ignore letter case as the server
 * does: its page fallback skips `/api` case-insensitively (src/RevolutReader.Api/Pages/PagesExtensions.cs), and its
 * routing matches `/health` in any case and with a trailing slash.
 * C6 kept every sign-in address under `/api/auth/` (c007 design.md D2), so the `/api` pattern covers them; a later
 * address outside `/api` that the browser navigates to and the server must answer joins this list.
 */
export const SERVER_ONLY: RegExp[] = [
  /^\/api(\/|\?|$)/i,
  /^\/health\/?(\?|$)/i,
];
