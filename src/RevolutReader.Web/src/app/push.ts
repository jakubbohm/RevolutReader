// The shared push pieces (c011 design.md D8). Stub: the test-writer's signatures from the design's API sketch; the
// implementer fills them in.

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

export function readPushKey(_options?: {
  signal?: AbortSignal;
}): Promise<PushKeyRead> {
  throw new Error("not implemented");
}

export function sendSubscription(
  _subscription: PushSubscription,
  _options?: { signal?: AbortSignal },
): Promise<SubscriptionSent> {
  throw new Error("not implemented");
}

export function forgetSubscription(
  _endpoint: string,
  _options?: { signal?: AbortSignal },
): Promise<SubscriptionSent> {
  throw new Error("not implemented");
}

export function pushSupported(_browser?: Window): boolean {
  throw new Error("not implemented");
}

export function currentSubscription(
  _registration: ServiceWorkerRegistration,
): Promise<PushSubscription | null> {
  throw new Error("not implemented");
}

export function subscribe(
  _registration: ServiceWorkerRegistration,
  _key: string,
): Promise<PushSubscription> {
  throw new Error("not implemented");
}

export function unsubscribe(_subscription: PushSubscription): Promise<boolean> {
  throw new Error("not implemented");
}

export function keyOf(_subscription: PushSubscription): string | null {
  throw new Error("not implemented");
}

export function madeWith(
  _subscription: PushSubscription,
  _key: string,
): boolean {
  throw new Error("not implemented");
}

export function fromBase64Url(_text: string): Uint8Array {
  throw new Error("not implemented");
}

export function toBase64Url(_bytes: ArrayBuffer | Uint8Array): string {
  throw new Error("not implemented");
}
