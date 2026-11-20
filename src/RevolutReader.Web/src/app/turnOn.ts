/**
 * Turning notifications on (c012 design.md D3, D8): the phone's question from the tap, then the subscription the server
 * keeps.
 */

import { readPushKey, sendSubscription, subscribe } from "./push";

export type TurnOnOutcome =
  /** The server keeps the subscription (204). */
  | { kind: "on" }
  /** The phone said no: "denied". */
  | { kind: "declined" }
  /** The prompt closed without an answer: "default". */
  | { kind: "undecided" }
  /** D8: offline, or "later". */
  | { kind: "failed"; offline: boolean };

/** How long everything after the phone's answer may take (D8). */
export const TURN_ON_LIMIT_MS = 60_000;

const LATER: TurnOnOutcome = { kind: "failed", offline: false };

/**
 * Turns notifications on (D3): asks Notification.requestPermission() as its first statement, so a tap that calls it
 * asks within the gesture; once allowed, waits for the service worker's registration, reads the key (readPushKey),
 * subscribes (subscribe) and sends the subscription (sendSubscription), all within TURN_ON_LIMIT_MS on one
 * AbortController (a setTimeout, so the test clock drives it). Never throws: every failure is an outcome.
 */
export async function turnNotificationsOn(
  browser: Window = window,
): Promise<TurnOnOutcome> {
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return LATER;
  }

  if (permission === "denied") return { kind: "declined" };
  if (permission !== "granted") return { kind: "undecided" };

  const limit = new AbortController();
  const timer = setTimeout(() => limit.abort(), TURN_ON_LIMIT_MS);
  try {
    return await subscribeAndSend(browser, limit.signal);
  } catch {
    return LATER;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Once allowed (D3): the service worker's registration, the server's key, the subscription, then sending it; every
 * request on `signal`, so the limit (D8) ends whichever is under way.
 */
async function subscribeAndSend(
  browser: Window,
  signal: AbortSignal,
): Promise<TurnOnOutcome> {
  const registration = await untilAborted(
    browser.navigator.serviceWorker.ready,
    signal,
  );
  if (registration === null) return LATER;

  const key = await readPushKey({ signal });
  if (key.kind !== "key") return failed(key.kind === "offline");

  let subscription: PushSubscription;
  try {
    subscription = await subscribe(registration, key.key);
  } catch {
    return failed(!browser.navigator.onLine);
  }

  const sent = await sendSubscription(subscription, { signal });
  return sent.kind === "done"
    ? { kind: "on" }
    : failed(sent.kind === "offline");
}

/** A failure (D8): offline, or "later". */
function failed(offline: boolean): TurnOnOutcome {
  return { kind: "failed", offline };
}

/** What `work` answers, or `null` once `signal` is aborted first. */
function untilAborted<T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise<T | null>((resolve, reject) => {
    const aborted = (): void => resolve(null);
    signal.addEventListener("abort", aborted, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}
