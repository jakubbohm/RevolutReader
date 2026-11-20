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
  subscribe,
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

const SENT_AGAIN = { kind: "sent again" } as const;
const SUBSCRIBED_AGAIN = { kind: "subscribed again" } as const;
const STOPPED = { kind: "stopped" } as const;
const NOT_ALLOWED = { kind: "not allowed" } as const;

/**
 * One upkeep (D1): the key, the phone's subscription, then send it again, subscribe again or replace it. Never asks for
 * the permission, never throws. `stillSignedIn` is checked after every step (D6); `signal` is the 60 s limit, passed to
 * every request; the browser's own calls take none, so the upkeep stops waiting for one when it fires.
 */
export async function keepSubscriptionUp(options: {
  stillSignedIn: () => boolean;
  signal?: AbortSignal;
  browser?: Window;
}): Promise<UpkeepOutcome> {
  const { signal, browser = window } = options;

  // When (D1): the browser can push, a worker is registered, and notifications are allowed; otherwise nothing is asked,
  // subscribed or sent. The registration first: only a browser that can push is sure to have `Notification`.
  const registration = await pushRegistration(browser);
  if (registration === null || !notificationsAllowed(browser))
    return NOT_ALLOWED;

  // Step 1: the server's key, read afresh at every upkeep (S7).
  const read = await readPushKey({ signal });
  if (read.kind !== "key") return STOPPED;

  // Step 2: the phone's subscription; a failure of the browser, or the limit, waits for the next opening.
  let held: PushSubscription | null;
  try {
    held = await beforeTheLimit(
      () => currentSubscription(registration),
      signal,
    );
  } catch {
    return STOPPED;
  }

  // Step 4: none held: subscribe with the server's key, then send the new one. A failed subscribe, or one the limit
  // gave up on, waits for the next opening; a subscription that settles after the limit is kept, and sent again then.
  if (held === null) {
    let made: PushSubscription;
    try {
      made = await beforeTheLimit(
        () => subscribe(registration, read.key),
        signal,
      );
    } catch {
      return STOPPED;
    }
    return sentAs(made, SUBSCRIBED_AGAIN, signal);
  }

  // Step 5, one made with another key, is not built yet: the upkeep stops.
  if (namesItsKey(held) && !madeWith(held, read.key)) return STOPPED;

  // Step 3: made with the server's key, or with a key the browser does not name: sent again as it is, never replaced.
  return sentAs(held, SENT_AGAIN, signal);
}

/** Sends the subscription to the server: `outcome` once it is stored; anything else stops the upkeep. */
async function sentAs(
  subscription: PushSubscription,
  outcome: UpkeepOutcome,
  signal: AbortSignal | undefined,
): Promise<UpkeepOutcome> {
  const sent = await sendSubscription(subscription, { signal });
  return sent.kind === "done" ? outcome : STOPPED;
}

/**
 * One of the browser's own calls, given up when the limit fires (D1): they take no signal, so the upkeep stops waiting
 * for one then, and the call is left to settle on its own. Rejects with the call's failure, whether it rejects or throws
 * at once, or when the limit fires first; a call is never started once it has.
 */
function beforeTheLimit<T>(
  call: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason);
      return;
    }
    const giveUp = (): void => {
      reject(signal?.reason);
    };
    // Started before the limit is watched, so a call that throws at once leaves no listener behind.
    call().then(
      (answer) => {
        signal?.removeEventListener("abort", giveUp);
        resolve(answer);
      },
      (failure: unknown) => {
        signal?.removeEventListener("abort", giveUp);
        reject(failure);
      },
    );
    signal?.addEventListener("abort", giveUp, { once: true });
  });
}

/**
 * Whether the user has allowed this browser's notifications (D1): its own `Notification.permission` is `granted`. Read,
 * never asked for (`requestPermission` only ever from a tap). Only for a browser that can push (`pushSupported`).
 */
function notificationsAllowed(browser: Window): boolean {
  return (
    (browser as Window & typeof globalThis).Notification.permission ===
    "granted"
  );
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
