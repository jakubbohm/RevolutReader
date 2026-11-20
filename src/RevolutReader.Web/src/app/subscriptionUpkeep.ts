/**
 * Keeping this device's push subscription right (c013 design.md D1–D6): at every opening, send it again, make it again
 * or replace it; before a sign-out, ask the server to forget it; wherever the login ends, unsubscribe it. Composes C8a's
 * push module (`./push`) as it is.
 */

import {
  currentSubscription,
  forgetSubscription,
  madeWith,
  pushSupported,
  readPushKey,
  sendSubscription,
  subscribe,
  unsubscribe,
} from "./push";

/**
 * The service worker registration push needs (D1): `null` when the browser cannot push (`pushSupported`), when no
 * worker is registered (Vite's dev server), when asking fails, or when the limit gave up on it. Asks
 * `navigator.serviceWorker.getRegistration()`, never `ready`, which never settles without a worker. `signal` is the
 * 60 s limit: asking is one of the browser's own calls (`attempt`), which take none. Never throws.
 */
export async function pushRegistration(
  browser: Window = window,
  signal?: AbortSignal,
): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported(browser)) return null;
  // Whether it rejects, throws at once or meets the limit: no registration this time, and the next opening asks again.
  const registration = await attempt(
    () => browser.navigator.serviceWorker.getRegistration(),
    signal,
  );
  return registration === FAILED ? null : (registration ?? null);
}

/** What one upkeep came to (D1, D6). Only "login ended" changes the screen. */
export type UpkeepOutcome =
  /** Step 3: made with the server's key, or with a key not named. */
  | { kind: "sent again" }
  /** Step 4: the phone had none. */
  | { kind: "subscribed again" }
  /** Step 5: made with another key. */
  | { kind: "replaced" }
  /** No push, no registration (`pushRegistration`), or the permission not granted: nothing done. */
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
const REPLACED = { kind: "replaced" } as const;
const STOPPED = { kind: "stopped" } as const;
const NOT_ALLOWED = { kind: "not allowed" } as const;
const DROPPED = { kind: "dropped" } as const;

/** What a browser call that failed, or that the limit gave up on, comes to (`attempt`). */
const FAILED = Symbol("failed");

/** What an upkeep runs with once it has the server's key (D1, D6). */
interface Run {
  registration: ServiceWorkerRegistration;
  /** The server's push key, base64url. */
  key: string;
  /** The 60 s limit. */
  signal: AbortSignal | undefined;
  /** Whether the login the upkeep started under is still on (D6). */
  stillSignedIn: () => boolean;
}

/**
 * One upkeep (D1): the key, the phone's subscription, then send it again, subscribe again or replace it. Never asks for
 * the permission, never throws. `stillSignedIn` is checked after every step (D6); `signal` is the 60 s limit, passed to
 * every request; the browser's own calls take none, asking for the registration among them, so the upkeep stops
 * waiting for one when it fires.
 */
export async function keepSubscriptionUp(options: {
  stillSignedIn: () => boolean;
  signal?: AbortSignal;
  browser?: Window;
}): Promise<UpkeepOutcome> {
  const { stillSignedIn, signal, browser = window } = options;

  // When (D1): the browser can push, a worker is registered, and notifications are allowed; otherwise nothing is asked,
  // subscribed or sent. The registration first: only a browser that can push is sure to have `Notification`.
  const registration = await pushRegistration(browser, signal);
  if (registration === null || !notificationsAllowed(browser))
    return NOT_ALLOWED;
  if (!stillSignedIn()) return DROPPED;

  // Step 1: the server's key, read afresh at every upkeep (S7).
  const read = await readPushKey({ signal });
  if (!stillSignedIn()) return DROPPED;
  if (read.kind === "signed out" || read.kind === "refused")
    return loginEnded(read);
  if (read.kind !== "key") return STOPPED;
  const run: Run = { registration, key: read.key, signal, stillSignedIn };

  // Step 2: the phone's subscription; a failure of the browser, or the limit, waits for the next opening.
  const held = await attempt(() => currentSubscription(registration), signal);
  if (!stillSignedIn()) return DROPPED;
  if (held === FAILED) return STOPPED;

  // Step 4: none held: subscribe with the server's key, then send the new one.
  if (held === null) return subscribedAndSent(run, SUBSCRIBED_AGAIN);

  // Step 5: made with a key the browser names, not the server's: replaced.
  if (namesItsKey(held) && !madeWith(held, run.key)) return replaced(run, held);

  // Step 3: made with the server's key, or with a key the browser does not name: sent again as it is, never replaced.
  return sentAs(run, held, SENT_AGAIN, null);
}

/**
 * Step 5 (D1): the server forgets the old push address first. Only once it has answered that it forgot it, the phone
 * unsubscribes the old subscription, then subscribes with the server's key and sends the new one. A forget that does not
 * answer so leaves the phone untouched, and the next opening tries the whole replacement again; an unsubscribe that
 * fails, answers that it did not unsubscribe, or that the limit gave up on, stops before subscribing.
 */
async function replaced(
  run: Run,
  old: PushSubscription,
): Promise<UpkeepOutcome> {
  const forgot = await forgetSubscription(old.endpoint, { signal: run.signal });
  if (!run.stillSignedIn()) return DROPPED;
  if (forgot.kind === "signed out" || forgot.kind === "refused")
    return loginEnded(forgot);
  if (forgot.kind !== "done") return STOPPED;

  const unsubscribed = await attempt(() => unsubscribe(old), run.signal);
  if (!run.stillSignedIn()) return DROPPED;
  if (unsubscribed !== true) return STOPPED;

  return subscribedAndSent(run, REPLACED);
}

/**
 * Subscribes with the server's key, then sends the new subscription as `outcome` (steps 4 and 5). A failed subscribe, or
 * one the limit gave up on, stops the upkeep with nothing sent. A subscription the browser makes after the limit is still
 * the upkeep's own: kept while the login is on, and the next opening sends it again; unsubscribed if the login has ended
 * by then (D6).
 */
async function subscribedAndSent(
  run: Run,
  outcome: UpkeepOutcome,
): Promise<UpkeepOutcome> {
  // Never started once the limit has fired, as no browser call is (`beforeTheLimit`); watched apart from the waiting for
  // it, which the limit ends, so that a subscription made later is still unsubscribed if the login has ended (D6).
  const subscribing: Promise<PushSubscription | typeof FAILED> =
    run.signal?.aborted === true
      ? Promise.resolve(FAILED)
      : attempt(() => subscribe(run.registration, run.key), undefined);
  const made = await attempt(() => subscribing, run.signal);
  if (made === FAILED) void unsubscribedIfMadeLate(subscribing, run);
  if (!run.stillSignedIn())
    return dropped(made === FAILED ? null : made, run.signal);
  if (made === FAILED) return STOPPED;

  return sentAs(run, made, outcome, made);
}

/**
 * A subscribe the limit gave up on (D6): a subscription the browser makes later is unsubscribed if the login the upkeep
 * started under has ended by then, so a signed-out phone never keeps one, whatever the timing; one made while it is still
 * on is kept. A subscribe the browser failed comes to nothing here, and a failed unsubscribe is ignored. Never rejects.
 */
async function unsubscribedIfMadeLate(
  subscribing: Promise<PushSubscription | typeof FAILED>,
  run: Run,
): Promise<void> {
  const late = await subscribing;
  if (late === FAILED || run.stillSignedIn()) return;
  await attempt(() => unsubscribe(late), undefined);
}

/**
 * Sends the subscription to the server: `outcome` once it is stored; a 401 or 403 ends the login, and anything else
 * stops the upkeep. `made` is the subscription this upkeep made, if it made one, unsubscribed if the login ended
 * elsewhere meanwhile (D6). One the server refused with a 401 or 403 is left to the screen, whose end of the login
 * unsubscribes the phone (D4).
 */
async function sentAs(
  run: Run,
  subscription: PushSubscription,
  outcome: UpkeepOutcome,
  made: PushSubscription | null,
): Promise<UpkeepOutcome> {
  const sent = await sendSubscription(subscription, { signal: run.signal });
  if (!run.stillSignedIn()) return dropped(made, run.signal);
  if (sent.kind === "signed out" || sent.kind === "refused")
    return loginEnded(sent);
  return sent.kind === "done" ? outcome : STOPPED;
}

/**
 * The login ended elsewhere while the upkeep ran (D6): a subscription it made is unsubscribed, so a signed-out phone
 * never keeps one; one it did not make is left to the screen. The unsubscribe starts even past the limit, which only
 * ends the waiting for it; its failure is ignored.
 */
async function dropped(
  made: PushSubscription | null,
  signal: AbortSignal | undefined,
): Promise<UpkeepOutcome> {
  if (made !== null) {
    const unsubscribing = attempt(() => unsubscribe(made), undefined);
    await attempt(() => unsubscribing, signal);
  }
  return DROPPED;
}

/** A 401 or 403 to one of the upkeep's requests (D1, D4), named as the screen's reads name it. */
function loginEnded(
  answer: { kind: "signed out" } | { kind: "refused"; email: string | null },
): UpkeepOutcome {
  return {
    kind: "login ended",
    ended:
      answer.kind === "signed out"
        ? { kind: "signed out" }
        : { kind: "refused", email: answer.email },
  };
}

/** One of the browser's own calls with the limit (`beforeTheLimit`): its answer, or `FAILED`; never throws. */
async function attempt<T>(
  call: () => Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T | typeof FAILED> {
  try {
    return await beforeTheLimit(call, signal);
  } catch {
    return FAILED;
  }
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
export async function forgetThisDevice(
  options: { signal?: AbortSignal; browser?: Window } = {},
): Promise<void> {
  const { signal, browser } = options;
  const held = await subscriptionHeld(browser, signal);
  if (held === null) return;

  // Whatever the server answers, the sign-out goes on: a device it keeps is deleted once a push to it is reported gone.
  await forgetSubscription(held.endpoint, { signal });
}

/** Wherever the login ends (D2 step 4, D4): unsubscribes the phone's subscription, if there is one; never throws. */
export async function unsubscribeThisDevice(
  options: { browser?: Window } = {},
): Promise<void> {
  const held = await subscriptionHeld(options.browser, undefined);
  if (held === null) return;

  // A failure is ignored, as an answer that it did not unsubscribe is: nothing more can be done from here.
  await attempt(() => unsubscribe(held), undefined);
}

/**
 * The subscription the phone holds, whatever the permission or its key (D2, D4): `null` when there is none, no
 * registration, the browser fails to say, or the limit gave up on it. Never throws.
 */
async function subscriptionHeld(
  browser: Window | undefined,
  signal: AbortSignal | undefined,
): Promise<PushSubscription | null> {
  const registration = await pushRegistration(browser, signal);
  if (registration === null) return null;

  const held = await attempt(() => currentSubscription(registration), signal);
  return held === FAILED ? null : held;
}
