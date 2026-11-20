/**
 * Keeping this device's push subscription right (c013 design.md D1–D6): at every opening, send it again, make it again
 * or replace it; before a sign-out, ask the server to forget it; wherever the login ends, unsubscribe it. Composes C8a's
 * push module (`./push`) as it is.
 */

import {
  currentSubscription,
  madeWith,
  pushSupported,
  readPushKey,
  sendSubscription,
} from "./push";

/**
 * The service worker registration push needs (D1): `null` when the browser cannot push (`pushSupported`), when no
 * worker is registered (Vite's dev server), or when asking fails. Asks `navigator.serviceWorker.getRegistration()`,
 * never `ready`, which never settles without a worker. Never throws.
 */
export async function pushRegistration(
  browser: Window = window,
): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported(browser)) return null;
  try {
    return (await browser.navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    // Whether it rejects or throws at once: no registration this time, and the next opening asks again.
    return null;
  }
}

/** What one upkeep came to (D1, D6). Only "login ended" changes the screen. */
export type UpkeepOutcome =
  /** Step 3: made with the server's key, or with a key not named. */
  | { kind: "sent again" }
  /** Step 4: the phone had none. */
  | { kind: "subscribed again" }
  /** Step 5: made with another key. */
  | { kind: "replaced" }
  /** No push, no worker, or the permission not granted: nothing done. */
  | { kind: "not allowed" }
  /** A 401 or 403 (D4). */
  | {
      kind: "login ended";
      ended: { kind: "signed out" } | { kind: "refused"; email: string | null };
    }
  /** The login ended elsewhere while it ran (D6); what it made is unsubscribed. */
  | { kind: "dropped" }
  /** Offline, unexpected, a refused subscription, a browser failure, the limit. */
  | { kind: "stopped" };

const STOPPED = { kind: "stopped" } as const;

/**
 * One upkeep (D1): the key, the phone's subscription, then send it again, subscribe again or replace it. Never asks for
 * the permission, never throws. `stillSignedIn` is checked after every step (D6); `signal` is the 60 s limit, passed to
 * every request.
 */
export async function keepSubscriptionUp(options: {
  stillSignedIn: () => boolean;
  signal?: AbortSignal;
  browser?: Window;
}): Promise<UpkeepOutcome> {
  const { signal, browser } = options;

  const registration = await pushRegistration(browser);
  if (registration === null) return STOPPED;

  // Step 1: the server's key, read afresh at every upkeep (S7).
  const read = await readPushKey({ signal });
  if (read.kind !== "key") return STOPPED;

  // Step 2: the phone's subscription; a failure of the browser waits for the next opening.
  let held: PushSubscription | null;
  try {
    held = await currentSubscription(registration);
  } catch {
    return STOPPED;
  }

  // Steps 4 and 5, none held or one made with another key, are not built yet: the upkeep stops.
  if (held === null) return STOPPED;
  if (namesItsKey(held) && !madeWith(held, read.key)) return STOPPED;

  // Step 3: made with the server's key, or with a key the browser does not name: sent again as it is, never replaced.
  const sent = await sendSubscription(held, { signal });
  return sent.kind === "done" ? { kind: "sent again" } : STOPPED;
}

/**
 * Whether the browser names the key the subscription was made with (D1): only a key it names can be another one. The
 * DOM types say `options` and its `applicationServerKey` are always there, but a browser may leave out either, which
 * reads as `null` does, a key not named (`keyOf` reads only `null` so).
 */
function namesItsKey(subscription: PushSubscription): boolean {
  const options = subscription.options as
    Partial<PushSubscriptionOptions> | undefined;
  return (options?.applicationServerKey ?? null) !== null;
}

/**
 * Before the sign-out request (D2): asks the server to forget the push address of the phone's subscription, if there is
 * one. Its answer is ignored; never throws.
 */
export function forgetThisDevice(options?: {
  signal?: AbortSignal;
  browser?: Window;
}): Promise<void> {
  void options;
  throw new Error("Not implemented yet: forgetThisDevice (c013 design.md D2).");
}

/** Wherever the login ends (D2 step 4, D4): unsubscribes the phone's subscription, if there is one; never throws. */
export function unsubscribeThisDevice(options?: {
  browser?: Window;
}): Promise<void> {
  void options;
  throw new Error(
    "Not implemented yet: unsubscribeThisDevice (c013 design.md D2, D4).",
  );
}
