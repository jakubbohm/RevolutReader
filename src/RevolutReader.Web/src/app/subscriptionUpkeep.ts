/**
 * Keeping this device's push subscription right (c013 design.md D1–D6): at every opening, send it again, make it again
 * or replace it; before a sign-out, ask the server to forget it; wherever the login ends, unsubscribe it. Composes C8a's
 * push module (`./push`) as it is.
 */

/**
 * The service worker registration push needs (D1): `null` when the browser cannot push (`pushSupported`), when no
 * worker is registered (Vite's dev server), or when asking fails. Asks `navigator.serviceWorker.getRegistration()`,
 * never `ready`, which never settles without a worker. Never throws.
 */
export function pushRegistration(
  browser?: Window,
): Promise<ServiceWorkerRegistration | null> {
  void browser;
  throw new Error("Not implemented yet: pushRegistration (c013 design.md D1).");
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

/**
 * One upkeep (D1): the key, the phone's subscription, then send it again, subscribe again or replace it. Never asks for
 * the permission, never throws. `stillSignedIn` is checked after every step (D6); `signal` is the 60 s limit, passed to
 * every request.
 */
export function keepSubscriptionUp(options: {
  stillSignedIn: () => boolean;
  signal?: AbortSignal;
  browser?: Window;
}): Promise<UpkeepOutcome> {
  void options;
  throw new Error(
    "Not implemented yet: keepSubscriptionUp (c013 design.md D1, D6).",
  );
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
