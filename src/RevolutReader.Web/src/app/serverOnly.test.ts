import { expect, test } from "vitest";
import { SERVER_ONLY } from "./serverOnly";

/** Whether the service worker leaves a navigation to the server: Workbox's NavigationRoute tests path plus query. */
function leftToServer(address: string): boolean {
  const url = new URL(address, "https://app.example");
  return SERVER_ONLY.some((pattern) => pattern.test(url.pathname + url.search));
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
