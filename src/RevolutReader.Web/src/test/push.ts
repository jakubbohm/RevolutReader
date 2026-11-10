/**
 * The phone's notifications and push, as the app's tests see them (c011 design.md D7, D8): jsdom has no `Notification`,
 * no `PushManager` and no service worker, so a test that needs them installs these stand-ins (`installPushStandIns`),
 * and `setup.ts` removes them after every test (`removePushStandIns`). Without them the browser supports no push, as a
 * browser without these features (an iPhone's Safari outside the Home Screen app).
 *
 * What they stand in for, as the browsers behave:
 * - `Notification`: its `permission` (`default`, `granted`, `denied`) and `requestPermission()`, which answers the
 *   test's `permissionAnswer` and keeps it as the permission from then on.
 * - `PushManager`, on a service worker registration (`navigator.serviceWorker.ready` resolves to it):
 *   - `subscribe(options)` records what it was asked (`subscribeRequests`), then: fails with the test's
 *     `subscribeFails`; asks for permission first while it is `default`; fails with `NotAllowedError` unless the
 *     permission is `granted` and `userVisibleOnly` is true; fails with `AbortError` without an `applicationServerKey`;
 *     answers the subscription it already holds when that one was made with the same key, and fails with
 *     `InvalidStateError` when it was made with another; otherwise makes a new subscription and holds it.
 *   - `getSubscription()` answers the subscription it holds, or `null`.
 *   - `permissionState()` answers the notification permission as push names it (`default` is `prompt`).
 * - A `PushSubscription` (`madeUpSubscription`, or one `subscribe` made): its `endpoint`, `expirationTime` (`null`),
 *   `options` (`userVisibleOnly`, and `applicationServerKey` as an `ArrayBuffer`, or `null`), `getKey`, `toJSON()`
 *   (`{ endpoint, expirationTime, keys: { p256dh, auth } }`, the keys in base64url without padding) and
 *   `unsubscribe()`, which answers the test's `unsubscribeAnswers` (true by default; the registration then holds none)
 *   or fails with its `unsubscribeFails`.
 *
 * Keys given as text are base64url, as browsers take them; every key and push address here is made up.
 */

/** A browser feature push needs, which a test can leave out. */
export type PushFeature = "service worker" | "PushManager" | "Notification";

/** A made-up subscription: what differs from the defaults. */
export interface SubscriptionInit {
  /** Its push address; by default a made-up one at Apple's push service, different for each subscription. */
  endpoint?: string;
  /** The key it was made with, as bytes or base64url text; by default none (`null`). */
  applicationServerKey?: BufferSource | string | null;
  /** The device's public key in base64url; by default a made-up 65 bytes starting `0x04`. */
  p256dh?: string;
  /** The device's secret in base64url; by default a made-up 16 bytes. */
  auth?: string;
  /** What `unsubscribe()` answers; by default true. */
  unsubscribeAnswers?: boolean;
  /** `unsubscribe()` fails with this error instead. */
  unsubscribeFails?: Error;
}

/** How the phone's push and notifications stand for this test. */
export interface PushStandInOptions {
  /** The notification permission; by default `default` (never asked). */
  permission?: NotificationPermission;
  /** What `Notification.requestPermission()` answers; by default `granted`. */
  permissionAnswer?: NotificationPermission;
  /** The subscription the registration already holds; by default none. */
  subscription?: SubscriptionInit;
  /** `subscribe` fails with this error; `true`: a `NotAllowedError`, as when the browser refuses. */
  subscribeFails?: Error | true;
  /** Features this browser does not have. */
  without?: readonly PushFeature[];
}

/** What `subscribe` was asked: `userVisibleOnly` as given, the key as bytes when given as bytes, as text when text. */
export interface SubscribeRequest {
  userVisibleOnly: boolean | undefined;
  applicationServerKey: Uint8Array | string | null | undefined;
}

/** The installed stand-ins, and what was asked of them. */
export interface PushStandIns {
  /** The service worker registration, as `navigator.serviceWorker.ready` resolves to it. */
  registration: ServiceWorkerRegistration;
  /** What each `subscribe` was asked, in order. */
  subscribeRequests(): SubscribeRequest[];
  /** How many times the app asked for the notification permission. */
  permissionRequests(): number;
  /** The notification permission now. */
  permission(): NotificationPermission;
  /** The subscription the registration holds now, or `null`. */
  subscription(): PushSubscription | null;
}

/** What `installPushStandIns` put in place, to remove it after the test. */
let installed: { target: object; name: string }[] = [];
let madeUp = 0;

/**
 * Puts the stand-ins for `Notification`, `PushManager` and the service worker registration in place for this test, as
 * the options say (see the module's description). `setup.ts` removes them after every test.
 */
export function installPushStandIns(
  options: PushStandInOptions = {},
): PushStandIns {
  removePushStandIns();

  const without = new Set(options.without ?? []);
  let permission: NotificationPermission = options.permission ?? "default";
  let permissionRequests = 0;
  const subscribeRequests: SubscribeRequest[] = [];
  let held: StandInPushSubscription | null = null;

  const askPermission = (): NotificationPermission => {
    permissionRequests += 1;
    permission = options.permissionAnswer ?? "granted";
    return permission;
  };
  const hold = (init: SubscriptionInit): StandInPushSubscription => {
    const subscription = new StandInPushSubscription(init, () => {
      if (held === subscription) held = null;
    });
    held = subscription;
    return subscription;
  };
  if (options.subscription !== undefined) hold(options.subscription);

  class StandInNotification {
    static get permission(): NotificationPermission {
      return permission;
    }

    static requestPermission(
      callback?: NotificationPermissionCallback,
    ): Promise<NotificationPermission> {
      const answer = askPermission();
      callback?.(answer);
      return Promise.resolve(answer);
    }
  }

  class StandInPushManager {
    static readonly supportedContentEncodings = ["aes128gcm"];

    async subscribe(
      subscribeOptions: PushSubscriptionOptionsInit = {},
    ): Promise<PushSubscription> {
      const key = subscribeOptions.applicationServerKey;
      subscribeRequests.push({
        userVisibleOnly: subscribeOptions.userVisibleOnly,
        applicationServerKey:
          key === undefined || key === null || typeof key === "string"
            ? key
            : bytesOf(key),
      });

      if (options.subscribeFails !== undefined)
        throw options.subscribeFails === true
          ? new DOMException(
              "Registration failed - permission denied",
              "NotAllowedError",
            )
          : options.subscribeFails;
      if (permission === "default") askPermission();
      if (permission !== "granted" || subscribeOptions.userVisibleOnly !== true)
        throw new DOMException(
          "Registration failed - permission denied",
          "NotAllowedError",
        );
      if (key === undefined || key === null)
        throw new DOMException(
          "Registration failed - missing applicationServerKey",
          "AbortError",
        );

      if (held !== null) {
        if (sameBytes(held.keyBytes(), keyBytesOf(key))) return held;
        throw new DOMException(
          "A subscription with a different applicationServerKey already exists",
          "InvalidStateError",
        );
      }
      return hold({ applicationServerKey: key });
    }

    getSubscription(): Promise<PushSubscription | null> {
      return Promise.resolve(held);
    }

    permissionState(): Promise<PermissionState> {
      return Promise.resolve(permission === "default" ? "prompt" : permission);
    }
  }

  const registration = {
    scope: `${globalThis.location.origin}/`,
    pushManager: new StandInPushManager(),
  } as unknown as ServiceWorkerRegistration;

  if (!without.has("Notification"))
    put(globalThis, "Notification", StandInNotification);
  if (!without.has("PushManager"))
    put(globalThis, "PushManager", StandInPushManager);
  if (!without.has("service worker"))
    put(navigator, "serviceWorker", {
      ready: Promise.resolve(registration),
      controller: null,
    });

  return {
    registration,
    subscribeRequests: () => [...subscribeRequests],
    permissionRequests: () => permissionRequests,
    permission: () => permission,
    subscription: () => held,
  };
}

/** Removes the stand-ins: the browser has no `Notification`, `PushManager` or service worker again. Called by `setup.ts` after every test. */
export function removePushStandIns(): void {
  for (const { target, name } of installed)
    delete (target as Record<string, unknown>)[name];
  installed = [];
}

/** A made-up subscription, not held by any registration (see `SubscriptionInit` for its defaults). */
export function madeUpSubscription(
  init: SubscriptionInit = {},
): PushSubscription {
  return new StandInPushSubscription(init, () => {});
}

class StandInPushSubscription {
  readonly endpoint: string;
  readonly expirationTime = null;
  readonly options: PushSubscriptionOptions;
  private readonly p256dh: string;
  private readonly auth: string;
  private readonly init: SubscriptionInit;
  private readonly onUnsubscribed: () => void;

  constructor(init: SubscriptionInit, onUnsubscribed: () => void) {
    madeUp += 1;
    this.init = init;
    this.onUnsubscribed = onUnsubscribed;
    this.endpoint =
      init.endpoint ?? `https://web.push.apple.com/made-up-device-${madeUp}`;
    const key = init.applicationServerKey ?? null;
    this.options = {
      userVisibleOnly: true,
      applicationServerKey:
        key === null ? null : keyBytesOf(key).slice().buffer,
    };
    this.p256dh = init.p256dh ?? MADE_UP_DEVICE_KEY;
    this.auth = init.auth ?? MADE_UP_SECRET;
  }

  keyBytes(): Uint8Array | null {
    const key = this.options.applicationServerKey;
    return key === null ? null : new Uint8Array(key);
  }

  getKey(name: PushEncryptionKeyName): ArrayBuffer | null {
    return fromText(name === "p256dh" ? this.p256dh : this.auth).slice().buffer;
  }

  toJSON(): PushSubscriptionJSON {
    return {
      endpoint: this.endpoint,
      expirationTime: null,
      keys: { p256dh: this.p256dh, auth: this.auth },
    };
  }

  unsubscribe(): Promise<boolean> {
    if (this.init.unsubscribeFails !== undefined)
      return Promise.reject(this.init.unsubscribeFails);
    const answer = this.init.unsubscribeAnswers ?? true;
    if (answer) this.onUnsubscribed();
    return Promise.resolve(answer);
  }
}

/** Defines `name` on `target` for this test, to be removed after it. */
function put(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    configurable: true,
    writable: true,
    value,
  });
  installed.push({ target, name });
}

/** A copy of the bytes, from any `BufferSource`. */
function bytesOf(source: BufferSource): Uint8Array {
  return ArrayBuffer.isView(source)
    ? new Uint8Array(
        source.buffer.slice(
          source.byteOffset,
          source.byteOffset + source.byteLength,
        ),
      )
    : new Uint8Array(source.slice(0));
}

function keyBytesOf(key: BufferSource | string): Uint8Array {
  return typeof key === "string" ? fromText(key) : bytesOf(key);
}

function sameBytes(a: Uint8Array | null, b: Uint8Array): boolean {
  return a !== null && a.length === b.length && a.every((x, i) => x === b[i]);
}

/** The test kit's own base64url, independent of the app's: bytes to text without padding, and back. */
function toText(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromText(text: string): Uint8Array {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

/** A made-up device key: 65 bytes starting `0x04`, as a P-256 point's form (not a point on the curve). */
const MADE_UP_DEVICE_KEY = toText(
  Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : (i * 7) & 0xff)),
);
/** A made-up device secret: 16 bytes. */
const MADE_UP_SECRET = toText(
  Uint8Array.from({ length: 16 }, (_, i) => (i * 13) & 0xff),
);
