/**
 * Turning notifications on (c012 design.md D3, D8): the phone's question from the tap, then the subscription the server
 * keeps.
 */

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

/**
 * Turns notifications on (D3): asks Notification.requestPermission() as its first statement, so a tap that calls it
 * asks within the gesture; once allowed, waits for the service worker's registration, reads the key (readPushKey),
 * subscribes (subscribe) and sends the subscription (sendSubscription), all within TURN_ON_LIMIT_MS on one
 * AbortController (a setTimeout, so the test clock drives it). Never throws: every failure is an outcome.
 */
export function turnNotificationsOn(browser?: Window): Promise<TurnOnOutcome> {
  void browser;
  throw new Error("Not implemented");
}
