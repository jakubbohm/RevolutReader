import { api, askTheApi, type ApiAnswer } from "../api/client";

/**
 * The shared push pieces (c011 design.md D8): reading the server's push key, sending and forgetting this device's
 * subscription, and the browser's own push calls. The calls to the API never throw and answer a kind, as every read
 * does (`askTheApi`); the browser's calls pass their failures on as they come, since only the screens know what to show.
 */

/** What reading the push key came to. */
export type PushKeyRead =
  /** The server's push key, base64url, as served. */
  | { kind: "key"; key: string }
  | { kind: "signed out" }
  | { kind: "refused"; email: string | null }
  | { kind: "unexpected" }
  | { kind: "offline" };

/** What sending or forgetting a subscription came to. */
export type SubscriptionSent =
  /** 204. */
  | { kind: "done" }
  /** 400: the server will not keep it. */
  | { kind: "refused subscription" }
  | { kind: "signed out" }
  | { kind: "refused"; email: string | null }
  | { kind: "unexpected" }
  | { kind: "offline" };

const UNEXPECTED = { kind: "unexpected" } as const;

/** The server's push key (`GET /api/push/key`); never throws. A 200 without the key as text is unexpected. */
export async function readPushKey(options?: {
  signal?: AbortSignal;
}): Promise<PushKeyRead> {
  const answer = await askTheApi(() =>
    api.GET("/api/push/key", { signal: options?.signal }),
  );
  if (answer.kind !== "answer") return answer;

  if (answer.status !== 200) return UNEXPECTED;
  const key = publicKeyOf(answer.data);
  return key === null ? UNEXPECTED : { kind: "key", key };
}

/** The key the body names, when it names one as text. */
function publicKeyOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("publicKey" in body))
    return null;
  return typeof body.publicKey === "string" ? body.publicKey : null;
}

/** Sends this device's subscription, the browser's own `toJSON()` (`PUT /api/push/subscription`); never throws. */
export async function sendSubscription(
  subscription: PushSubscription,
  options?: { signal?: AbortSignal },
): Promise<SubscriptionSent> {
  const answer = await askTheApi(() =>
    api.PUT("/api/push/subscription", {
      body: subscription.toJSON(),
      signal: options?.signal,
    }),
  );
  return subscriptionSentOf(answer);
}

/**
 * Forgets the device with this push address (`DELETE /api/push/subscription`); never throws. The address travels in
 * the body, never in the URL (D9).
 */
export async function forgetSubscription(
  endpoint: string,
  options?: { signal?: AbortSignal },
): Promise<SubscriptionSent> {
  const answer = await askTheApi(() =>
    api.DELETE("/api/push/subscription", {
      body: { endpoint },
      signal: options?.signal,
    }),
  );
  return subscriptionSentOf(answer);
}

/** What a write of a subscription came to: 204 done, 400 refused; any other answer unexpected. */
function subscriptionSentOf(answer: ApiAnswer): SubscriptionSent {
  if (answer.kind !== "answer") return answer;
  if (answer.status === 204) return { kind: "done" };
  if (answer.status === 400) return { kind: "refused subscription" };
  return UNEXPECTED;
}

/** Whether the browser has what push needs: a service worker, `PushManager` and `Notification`. */
export function pushSupported(browser: Window = window): boolean {
  return (
    "serviceWorker" in browser.navigator &&
    "PushManager" in browser &&
    "Notification" in browser
  );
}

/** The subscription the registration holds, or `null`; the browser's failure passes on. */
export function currentSubscription(
  registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  return registration.pushManager.getSubscription();
}

/** Subscribes for visible pushes only, with the server's key (base64url) as bytes; the browser's failure passes on. */
export function subscribe(
  registration: ServiceWorkerRegistration,
  key: string,
): Promise<PushSubscription> {
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromBase64Url(key),
  });
}

/** Whether the browser unsubscribed; its failure passes on. */
export function unsubscribe(subscription: PushSubscription): Promise<boolean> {
  return subscription.unsubscribe();
}

/** The key the subscription was made with, base64url; `null` when it was made with none. */
export function keyOf(subscription: PushSubscription): string | null {
  const key = subscription.options.applicationServerKey;
  return key === null ? null : toBase64Url(key);
}

/** Whether the subscription was made with this key (base64url). */
export function madeWith(subscription: PushSubscription, key: string): boolean {
  return keyOf(subscription) === key;
}

/** The bytes of base64url text, with or without padding. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** The bytes as base64url text, without padding. */
export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
