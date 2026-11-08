import type { Network } from "./updates";

// Keeping the server awake while the app is on screen (c009 design.md D9; ADR-0006): the container app scales to zero
// after a 300 s cool-down, and a wake takes about 20 s, so the app asks the health check (anonymous, no bank, no storage)
// often enough to keep it up while someone is looking at it, and stops when nobody is.

/** How often the app asks the health check while on screen: under the container app's 300 s cool-down. */
export const PING_EVERY_MS = 240_000;

/** How long without a tap or key press before the app stops asking. */
export const IDLE_LIMIT_MS = 1_800_000;

/** The server's health check, anonymous and touching neither the bank nor storage. */
const HEALTH = "/health";

/**
 * Asks `ping` on coming on screen (at the start, and on every return to the screen) and every 4 minutes while on screen
 * and online; nothing while off screen or while the phone says it is offline. After 30 minutes without a tap or key
 * press (`pointerdown`, `keydown` on the page) it stops; the next one asks at once and starts the 4-minute rhythm again,
 * as a return to the screen does. Timers are `setTimeout` and `setInterval`, so the tests' clock drives them. Returns
 * the stop function, which removes every listener and timer.
 */
export function keepServerAwake(
  ping: () => void,
  page: Document = document,
  network: Network = navigator,
): () => void {
  let rhythm: ReturnType<typeof setInterval> | undefined;
  let idleLimit: ReturnType<typeof setTimeout> | undefined;
  /** Stopped after the idle limit, until the next tap or key press, or a return to the screen. */
  let resting = false;

  function onScreen(): boolean {
    return page.visibilityState === "visible";
  }

  function ask(): void {
    if (onScreen() && network.onLine) ping();
  }

  /** Asks now, then every `PING_EVERY_MS`. */
  function startRhythm(): void {
    clearInterval(rhythm);
    ask();
    rhythm = setInterval(ask, PING_EVERY_MS);
  }

  function stopRhythm(): void {
    clearInterval(rhythm);
    rhythm = undefined;
  }

  /** The idle limit counts again from now. */
  function restartIdleLimit(): void {
    clearTimeout(idleLimit);
    idleLimit = setTimeout(() => {
      resting = true;
      stopRhythm();
    }, IDLE_LIMIT_MS);
  }

  function onUse(): void {
    restartIdleLimit();
    if (!resting) return;

    resting = false;
    if (onScreen()) startRhythm();
  }

  function onVisibilityChange(): void {
    if (!onScreen()) {
      stopRhythm();
      return;
    }

    resting = false;
    restartIdleLimit();
    startRhythm();
  }

  page.addEventListener("visibilitychange", onVisibilityChange);
  page.addEventListener("pointerdown", onUse);
  page.addEventListener("keydown", onUse);
  restartIdleLimit();
  if (onScreen()) startRhythm();

  return () => {
    page.removeEventListener("visibilitychange", onVisibilityChange);
    page.removeEventListener("pointerdown", onUse);
    page.removeEventListener("keydown", onUse);
    stopRhythm();
    clearTimeout(idleLimit);
  };
}

/** Asks the server's health check, fire and forget: never awaited, never shown, a failure ignored (D9). */
export function pingServer(): void {
  void fetch(HEALTH).catch(ignoreFailedPing);
}

function ignoreFailedPing(): void {}
