import { expect, test } from "vitest";
import { NavigationRoute } from "workbox-routing";
import { SERVER_ONLY } from "./serverOnly";

/** A stand-in for the service worker's page fallback: the same Workbox route and list, with a dummy handler. */
const pageFallback = new NavigationRoute(
  () => Promise.resolve(new Response()),
  { denylist: SERVER_ONLY },
);

/** What Workbox hands a route's match callback. */
type MatchOptions = Parameters<NavigationRoute["match"]>[0];

/**
 * Whether the service worker leaves a navigation to the server: asks Workbox's own NavigationRoute, built with the
 * same list the service worker passes in sw.ts (the test builds its own route because sw.ts exports nothing).
 */
function leftToServer(address: string): boolean {
  const navigation: MatchOptions = {
    url: new URL(address, "https://app.example"),
    request: { mode: "navigate" } as Request,
    event: {} as MatchOptions["event"],
    sameOrigin: true,
  };
  return !pageFallback.match(navigation);
}

test.each([
  "/api",
  "/api/",
  "/api/balance",
  "/api?x=1",
  "/API/balance",
  "/Api",
])(
  "A navigation to %s stays the server's, as the page fallback skips /api in any case",
  (address) => expect(leftToServer(address)).toBe(true),
);

test.each(["/health", "/health/", "/health?x=1", "/Health", "/HEALTH?x=1"])(
  "A navigation to %s stays the server's, as routing matches the health probe",
  (address) => expect(leftToServer(address)).toBe(true),
);

test.each([
  "/",
  "/?x=1",
  "/no-such-page",
  "/deep/link?x=1",
  "/apix",
  "/api-docs",
  "/healthz",
  "/health/check",
])(
  "A navigation to %s opens the app, as the server's page fallback does",
  (address) => expect(leftToServer(address)).toBe(false),
);
