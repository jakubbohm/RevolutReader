import type { Network } from "./updates";

// Keeping the server awake while the app is on screen (c009 design.md D9). Stubs until c009 tasks.md groups 71 and 74
// are implemented; `void` keeps the unused-parameter check quiet until then.

/** How often the app asks the health check while on screen: under the container app's 300 s cool-down. */
export const PING_EVERY_MS = 240_000;

/** How long without a tap or key press before the app stops asking. */
export const IDLE_LIMIT_MS = 1_800_000;

/**
 * Asks `ping` on coming on screen and every 4 minutes while on screen and online; stops after 30 minutes without use and
 * resumes on the next tap or key press. Returns the stop function.
 */
export function keepServerAwake(
  ping: () => void,
  page: Document = document,
  network: Network = navigator,
): () => void {
  void ping;
  void page;
  void network;
  throw new Error("not implemented");
}

/** Asks the server's health check, never awaited; a failure is ignored. */
export function pingServer(): void {
  throw new Error("not implemented");
}
