/**
 * The phone's notifications and push, as the app's tests see them (c011 design.md D7, D8): jsdom has no `Notification`,
 * no `PushManager` and no service worker, so a test that needs them installs these stand-ins (`installPushStandIns`),
 * and `setup.ts` removes them after every test (`removePushStandIns`). Without them the browser supports no push, as a
 * browser without these features (an iPhone's Safari outside the Home Screen app).
 *
 * What they stand in for, as the browsers behave:
 * - `Notification`: its `permission` (`default`, `granted`, `denied`) and `requestPermission()`, which answers the
 *   test's `permissionAnswer` and keeps it as the permission from then on.
 * - The service worker (c013 design.md D1): `navigator.serviceWorker.getRegistration()` settles with the registration,
 *   and `navigator.serviceWorker.ready` resolves to it. Under `registered: false` the browser has a service worker but
 *   none is registered, as on Vite's dev server: `getRegistration()` settles with `undefined`, and `ready` never settles.
 *   Under `registrationFails`, `getRegistration()` fails with the test's error instead, and `ready` is as without it.
 * - `PushManager`, on that registration:
 *   - `subscribe(options)` records what it was asked (`subscribeRequests`), then: under `subscribeWaits`, waits until
 *     the test lets it go (`letWaitingCallsSettle`); fails with the test's `subscribeFails` (only the first
 *     `subscribeFailures` times, when the test gives that number); asks for permission first
 *     while it is `default`; fails with `NotAllowedError` unless the permission is `granted` and `userVisibleOnly` is
 *     true; fails with `AbortError` without an `applicationServerKey`; answers the subscription it already holds when
 *     that one was made with the same key, and fails with `InvalidStateError` when it was made with another; otherwise
 *     makes a new subscription and holds it.
 *   - `getSubscription()` answers the subscription it holds, or `null`; it fails with the test's `getSubscriptionFails`.
 *     Under `getSubscriptionWaits` it waits until the test lets it go, then answers as without it.
 *   - `permissionState()` answers the notification permission as push names it (`default` is `prompt`).
 * - The notifications the phone shows now (c019 design.md D5, § Ports and contracts: the browser's notification list,
 *   as the spike saw it on the iPhone): `registration.getNotifications()` lists those the test shows (`notifications`,
 *   and those that arrive later, `notificationArrives`), each with its `title`, `body` (`""` when it has none),
 *   `navigate` (when it has one, its fragment included) and `data` `null`, as iOS lists the ones its push daemon
 *   showed; the tapped one is never listed, so a test lists only the others. Under `getNotificationsFails` it fails
 *   with the test's error; under `getNotificationsWaits` it waits until the test lets it go
 *   (`letWaitingCallsSettle`), then lists what is shown then. `dismissNotifications()` clears them all, as the user
 *   clearing Notification Center.
 * - A `PushSubscription` (`madeUpSubscription`, or one `subscribe` made): its `endpoint`, `expirationTime` (`null`),
 *   `options` (`userVisibleOnly`, and `applicationServerKey` as an `ArrayBuffer`, or `null`), `getKey`, `toJSON()`
 *   (`{ endpoint, expirationTime, keys: { p256dh, auth } }`, the keys in base64url without padding) and
 *   `unsubscribe()`, which answers the test's `unsubscribeAnswers` (true by default; the registration then holds none)
 *   or fails with its `unsubscribeFails`; under `unsubscribeWaits` it first waits until the test lets it go
 *   (`letWaitingCallsSettle` of the phone holding it; a made-up subscription no phone holds waits for good). Under
 *   `leavesOut`, a browser that does not say which key made it (c013):
 *   `options` without `applicationServerKey`, or no `options` at all; `subscribe` still knows the key, as the browser
 *   does.
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
  /**
   * `unsubscribe()` waits, as a browser that leaves it hanging (c013 design.md D1, the limit), until the test lets it go
   * (`letWaitingCallsSettle` of the phone holding it); then it goes on as without it. By default it does not wait.
   */
  unsubscribeWaits?: boolean;
  /**
   * What the browser leaves out, though the subscription was made with `applicationServerKey` (c013): the key from its
   * `options` (`undefined` there), or `options` itself. By default nothing.
   */
  leavesOut?: "applicationServerKey" | "options";
}

/** A notification the phone shows, as the test gives it: its title, its text and the address a tap opens. */
export interface ShownNotification {
  title: string;
  body?: string;
  navigate?: string;
}

/** A notification as `registration.getNotifications()` lists it (c019 design.md § Ports and contracts). */
export interface ListedNotification {
  readonly title: string;
  readonly body: string;
  readonly navigate?: string;
  readonly data: null;
  close(): void;
}

/** How the phone's push and notifications stand for this test. */
export interface PushStandInOptions {
  /** The notifications the phone shows when the test starts; by default none. */
  notifications?: readonly ShownNotification[];
  /** `getNotifications()` fails with this error, as when the browser refuses to list them. */
  getNotificationsFails?: Error;
  /**
   * `getNotifications()` waits, as a browser that leaves it hanging, until the test lets it go
   * (`letWaitingCallsSettle`); then it lists what is shown then. By default it does not wait.
   */
  getNotificationsWaits?: boolean;
  /** The notification permission; by default `default` (never asked). */
  permission?: NotificationPermission;
  /** What `Notification.requestPermission()` answers; by default `granted`. */
  permissionAnswer?: NotificationPermission;
  /** The subscription the registration already holds; by default none. */
  subscription?: SubscriptionInit;
  /** `subscribe` fails with this error; `true`: a `NotAllowedError`, as when the browser refuses. */
  subscribeFails?: Error | true;
  /**
   * Under `subscribeFails`, only the first this many subscribes fail, and the later ones go on as without it; by default
   * every one fails.
   */
  subscribeFailures?: number;
  /** `getSubscription()` fails with this error, as when the browser cannot say which subscription it holds. */
  getSubscriptionFails?: Error;
  /**
   * `subscribe` waits, as a browser that leaves it hanging (c013 design.md D1, the limit), until the test lets it go
   * (`letWaitingCallsSettle`); then it goes on as without it. By default it does not wait.
   */
  subscribeWaits?: boolean;
  /**
   * `getSubscription()` waits, as a browser that leaves it hanging (c013 design.md D1, the limit), until the test lets
   * it go (`letWaitingCallsSettle`); then it answers as without it. By default it does not wait.
   */
  getSubscriptionWaits?: boolean;
  /** Features this browser does not have. */
  without?: readonly PushFeature[];
  /**
   * Whether a service worker is registered; by default true. `false`: the browser has a service worker but none is
   * registered, as on Vite's dev server (c013 design.md D1): `getRegistration()` settles with `undefined`, and `ready`
   * never settles.
   */
  registered?: boolean;
  /**
   * `navigator.serviceWorker.getRegistration()` fails with this error, as when the browser refuses to answer (c013
   * design.md D1); `ready` is as without it.
   */
  registrationFails?: Error;
}

/** What `subscribe` was asked: `userVisibleOnly` as given, the key as bytes when given as bytes, as text when text. */
export interface SubscribeRequest {
  userVisibleOnly: boolean | undefined;
  applicationServerKey: Uint8Array | string | null | undefined;
}

/** The installed stand-ins, and what was asked of them. */
export interface PushStandIns {
  /**
   * The service worker registration, as `navigator.serviceWorker.getRegistration()` settles with it and
   * `navigator.serviceWorker.ready` resolves to it (unless `registered: false`; `getRegistration()` neither under
   * `registrationFails`).
   */
  registration: ServiceWorkerRegistration;
  /** What each `subscribe` was asked, in order. */
  subscribeRequests(): SubscribeRequest[];
  /** How many times the app asked for the notification permission. */
  permissionRequests(): number;
  /** The notification permission now. */
  permission(): NotificationPermission;
  /** The subscription the registration holds now, or `null`. */
  subscription(): PushSubscription | null;
  /**
   * Lets every call left waiting (`subscribeWaits`, `getSubscriptionWaits`, `getNotificationsWaits`, a held
   * subscription's `unsubscribeWaits`) go on, each as it would have without waiting.
   */
  letWaitingCallsSettle(): void;
  /** A notification arrives and is shown from now on, after those shown already. */
  notificationArrives(notification: ShownNotification): void;
  /** Every notification the phone shows is cleared, as the user clearing Notification Center. */
  dismissNotifications(): void;
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
  /**
   * The calls left waiting (`subscribeWaits`, `getSubscriptionWaits`, a held subscription's `unsubscribeWaits`), each
   * settling once the test lets it go.
   */
  let waiting: (() => void)[] = [];
  const untilLetGo = (): Promise<void> =>
    new Promise((letGo) => {
      waiting.push(letGo);
    });
  /** How many more subscribes fail under `subscribeFails`. */
  let subscribeFailuresLeft = options.subscribeFailures ?? Infinity;

  const hold = (init: SubscriptionInit): StandInPushSubscription => {
    const subscription = new StandInPushSubscription(
      init,
      () => {
        if (held === subscription) held = null;
      },
      untilLetGo,
    );
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

      if (options.subscribeWaits === true) await untilLetGo();
      if (options.subscribeFails !== undefined && subscribeFailuresLeft > 0) {
        subscribeFailuresLeft -= 1;
        throw options.subscribeFails === true
          ? new DOMException(
              "Registration failed - permission denied",
              "NotAllowedError",
            )
          : options.subscribeFails;
      }
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
      // What it holds when it answers, so a call left waiting answers what it holds once let go.
      const answer = (): Promise<PushSubscription | null> =>
        options.getSubscriptionFails !== undefined
          ? Promise.reject(options.getSubscriptionFails)
          : Promise.resolve(held);
      return options.getSubscriptionWaits === true
        ? untilLetGo().then(answer)
        : answer();
    }

    permissionState(): Promise<PermissionState> {
      return Promise.resolve(permission === "default" ? "prompt" : permission);
    }
  }

  /** The notifications the phone shows now, in the order they came. */
  let shown: ShownNotification[] = [...(options.notifications ?? [])];
  const listed = (notification: ShownNotification): ListedNotification => ({
    title: notification.title,
    body: notification.body ?? "",
    ...(notification.navigate === undefined
      ? {}
      : { navigate: notification.navigate }),
    data: null,
    close: () => {
      shown = shown.filter((each) => each !== notification);
    },
  });
  const getNotifications = (): Promise<ListedNotification[]> => {
    // What is shown when it answers, so a call left waiting lists what is shown once let go.
    const answer = (): Promise<ListedNotification[]> =>
      options.getNotificationsFails !== undefined
        ? Promise.reject(options.getNotificationsFails)
        : Promise.resolve(shown.map(listed));
    return options.getNotificationsWaits === true
      ? untilLetGo().then(answer)
      : answer();
  };

  const registration = {
    scope: `${globalThis.location.origin}/`,
    pushManager: new StandInPushManager(),
    getNotifications,
  } as unknown as ServiceWorkerRegistration;

  if (!without.has("Notification"))
    put(globalThis, "Notification", StandInNotification);
  if (!without.has("PushManager"))
    put(globalThis, "PushManager", StandInPushManager);
  const registered = options.registered ?? true;
  if (!without.has("service worker"))
    put(navigator, "serviceWorker", {
      // Without a registered worker, `ready` waits for one for good, as browsers do (c013 design.md D1).
      ready: registered
        ? Promise.resolve(registration)
        : new Promise<ServiceWorkerRegistration>(() => {}),
      getRegistration: (): Promise<ServiceWorkerRegistration | undefined> =>
        options.registrationFails !== undefined
          ? Promise.reject(options.registrationFails)
          : Promise.resolve(registered ? registration : undefined),
      controller: null,
    });

  return {
    registration,
    subscribeRequests: () => [...subscribeRequests],
    permissionRequests: () => permissionRequests,
    permission: () => permission,
    subscription: () => held,
    letWaitingCallsSettle: () => {
      const letGo = waiting;
      waiting = [];
      for (const go of letGo) go();
    },
    notificationArrives: (notification) => {
      shown = [...shown, { ...notification }];
    },
    dismissNotifications: () => {
      shown = [];
    },
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
  // No phone holds it, so nothing lets a waiting `unsubscribe()` go.
  return new StandInPushSubscription(
    init,
    () => {},
    () => new Promise<void>(() => {}),
  );
}

class StandInPushSubscription {
  readonly endpoint: string;
  readonly expirationTime = null;
  /** Declared only: under `leavesOut: "options"` the subscription has no `options` at all, as such a browser. */
  declare readonly options: PushSubscriptionOptions;
  /** The key it was made with, as the browser knows it, whatever `options` says. */
  private readonly madeWithKey: Uint8Array | null;
  private readonly p256dh: string;
  private readonly auth: string;
  private readonly init: SubscriptionInit;
  private readonly onUnsubscribed: () => void;
  /** Settles once the test lets a waiting `unsubscribe()` go (`unsubscribeWaits`). */
  private readonly untilLetGo: () => Promise<void>;

  constructor(
    init: SubscriptionInit,
    onUnsubscribed: () => void,
    untilLetGo: () => Promise<void>,
  ) {
    madeUp += 1;
    this.init = init;
    this.onUnsubscribed = onUnsubscribed;
    this.untilLetGo = untilLetGo;
    this.endpoint =
      init.endpoint ?? `https://web.push.apple.com/made-up-device-${madeUp}`;
    const key = init.applicationServerKey ?? null;
    this.madeWithKey = key === null ? null : keyBytesOf(key);
    if (init.leavesOut === "applicationServerKey")
      this.options = { userVisibleOnly: true } as PushSubscriptionOptions;
    else if (init.leavesOut !== "options")
      this.options = {
        userVisibleOnly: true,
        applicationServerKey:
          this.madeWithKey === null ? null : this.madeWithKey.slice().buffer,
      };
    this.p256dh = init.p256dh ?? MADE_UP_DEVICE_KEY;
    this.auth = init.auth ?? MADE_UP_SECRET;
  }

  keyBytes(): Uint8Array | null {
    return this.madeWithKey;
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
    const settle = (): Promise<boolean> => {
      if (this.init.unsubscribeFails !== undefined)
        return Promise.reject(this.init.unsubscribeFails);
      const answer = this.init.unsubscribeAnswers ?? true;
      if (answer) this.onUnsubscribed();
      return Promise.resolve(answer);
    };
    return this.init.unsubscribeWaits === true
      ? this.untilLetGo().then(settle)
      : settle();
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
