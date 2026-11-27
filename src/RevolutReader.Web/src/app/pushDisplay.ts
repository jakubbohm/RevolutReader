/**
 * What the service worker does with a push and a tap on its notification (c012 design.md D9), the balance a push
 * brings (c015 design.md D2-D4; in its page's fragment since c019 design.md D7). Imported by `sw.ts` and by the tests; compiled under both `tsconfig.app.json` (`DOM`) and `tsconfig.sw.json` (`WebWorker`), so it names the few
 * members of the service worker's scope it uses as its own small interfaces, and imports nothing that needs `window`
 * (c015 design.md D5).
 */

import type { Balance } from "./balanceRecord";
import { balanceInAddress } from "./notificationBalance";
import { keepNotificationBalance } from "./storedBalance";

/** A Declarative Web Push message as the service worker shows it. */
export interface DeclarativeMessage {
  title: string;
  body?: string;
  navigate: string;
}

/** The message in a push's JSON: "web_push": 8030, a notification with a non-empty title and a navigate string; else null. */
export function declarativeMessage(json: unknown): DeclarativeMessage | null {
  if (!isRecord(json) || json.web_push !== 8030) return null;
  const notification = json.notification;
  if (!isRecord(notification)) return null;
  const { title, body, navigate } = notification;
  if (typeof title !== "string" || title === "") return null;
  // Any string is a page: the tap opens its path, query and fragment on the worker's own origin.
  if (typeof navigate !== "string") return null;
  // A body that is not a string is no text.
  return typeof body === "string"
    ? { title, body, navigate }
    : { title, navigate };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The members of the service worker's global scope this module uses (both ServiceWorkerGlobalScope and the stand-in
 * fit).
 */
export interface PushWorker {
  location: { origin: string };
  registration: {
    showNotification(
      title: string,
      options?: { body?: string; data?: unknown },
    ): Promise<void>;
    pushManager: {
      getSubscription(): Promise<{
        getKey(name: "auth"): ArrayBuffer | null;
      } | null>;
    };
  };
  clients: {
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<readonly WindowLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "push", listener: (event: PushLike) => void): void;
  addEventListener(
    type: "notificationclick",
    listener: (event: NotificationClickLike) => void,
  ): void;
}

export interface WindowLike {
  url: string;
  focus(): Promise<unknown>;
}

export interface PushLike {
  data: { json(): unknown } | null;
  /** The browser's proposed notification (Declarative Web Push), when it reads the format; undefined or null otherwise. */
  notification?: unknown;
  waitUntil(work: Promise<unknown>): void;
}

export interface NotificationClickLike {
  notification: { data: unknown; close(): void };
  waitUntil(work: Promise<unknown>): void;
}

/**
 * The balance in the fragment of a push's `navigate` (c019 design.md D7), checked with `secret` as the page checks it
 * (`balanceInAddress`): first the browser's proposed notification's, when the event carries one (a Declarative Web Push
 * may give the event no data of its own, W3C draft), else, when that gives none, the push's own JSON's, which also
 * covers a browser that hands over both (c015 design.md D2's order). Null when neither gives one, or `secret` is null.
 * Never rejects.
 */
export async function pushedBalance(
  event: PushLike,
  secret: ArrayBuffer | null,
): Promise<Balance | null> {
  const proposed = event.notification;
  if (proposed !== undefined && proposed !== null) {
    const fromProposed = await balanceIn(navigateOf(proposed), secret);
    if (fromProposed !== null) return fromProposed;
  }
  const json = pushJson(event);
  return balanceIn(
    isRecord(json) ? navigateOf(json.notification) : undefined,
    secret,
  );
}

/** A notification's `navigate`, proposed or in the push's JSON, when it is a string; else undefined. */
function navigateOf(notification: unknown): string | undefined {
  if (!isRecord(notification)) return undefined;
  const { navigate } = notification;
  return typeof navigate === "string" ? navigate : undefined;
}

/** The balance in `navigate`'s fragment under `secret`; null when there is no page. */
function balanceIn(
  navigate: string | undefined,
  secret: ArrayBuffer | null,
): Promise<Balance | null> {
  return navigate === undefined
    ? Promise.resolve(null)
    : balanceInAddress(navigate, secret);
}

/**
 * The secret of the worker's push subscription (`getKey("auth")`, D7), or null: no subscription, no secret, or a
 * browser call that fails.
 */
async function subscriptionSecret(
  worker: PushWorker,
): Promise<ArrayBuffer | null> {
  try {
    const subscription =
      await worker.registration.pushManager.getSubscription();
    return subscription?.getKey("auth") ?? null;
  } catch {
    // The browser refused: no balance from this push (Error model).
    return null;
  }
}

/**
 * Keeps the balance a push carries by c015's rule (`keepNotificationBalance`), checked with the worker's own
 * subscription's secret. Never rejects: neither the secret's read, the check nor the write does.
 */
async function keepPushedBalance(
  worker: PushWorker,
  event: PushLike,
): Promise<void> {
  const balance = await pushedBalance(event, await subscriptionSecret(worker));
  if (balance !== null) await keepNotificationBalance(balance);
}

/**
 * Listens for pushes and taps (D9): a push's balance is kept (c015 design.md D4), checked with the worker's own
 * subscription's secret (c019 design.md D7); a push with the browser's own
 * notification is left alone; otherwise its declarative message is shown (title, body, navigate in data). A tap closes
 * the notification and focuses an open window of the app on the worker's origin, or opens navigate's path, query and
 * fragment on that origin.
 */
export function listenForPushes(worker: PushWorker): void {
  worker.addEventListener("push", (event) => {
    // The balance first, under the event's waitUntil so the worker lives until it is written (c015 design.md D4); the
    // work never rejects, and the message below starts in the same turn, so it never waits for it (c019 design.md D7).
    event.waitUntil(keepPushedBalance(worker, event));
    // The browser read the message and shows its own notification (Declarative Web Push): leave it, so it shows once.
    if (event.notification !== undefined && event.notification !== null) return;
    const message = declarativeMessage(pushJson(event));
    if (message === null) return;
    const { title, body, navigate } = message;
    event.waitUntil(
      worker.registration.showNotification(
        title,
        body === undefined ? { data: navigate } : { body, data: navigate },
      ),
    );
  });

  worker.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(openApp(worker, event.notification.data));
  });
}

/**
 * Focuses a window of the app open on the worker's origin, as it is (the app has one page), or else opens the page
 * `data` names on that origin.
 */
async function openApp(worker: PushWorker, data: unknown): Promise<void> {
  const { origin } = worker.location;
  const windows = await worker.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  const appWindow = windows.find((each) => originOf(each.url) === origin);
  if (appWindow !== undefined) await appWindow.focus();
  else await worker.clients.openWindow(pageOnOrigin(data, origin));
}

/** The origin of `url`; undefined when it is no address. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/**
 * The page a notification's data names, as its path, query and fragment joined onto `origin`, and the joined address
 * checked to be on `origin`, so it is always a page of the app (D9); the start page when the data is not a string, no
 * address, or its path would lead off the origin (an opaque path running into the host or port).
 */
function pageOnOrigin(data: unknown, origin: string): string {
  const startPage = `${origin}/`;
  if (typeof data !== "string") return startPage;
  try {
    const named = new URL(data, startPage);
    // Joined, not resolved against the start page: a path such as "//other.example/" stays a path on this host.
    const page = new URL(
      `${origin}${named.pathname}${named.search}${named.hash}`,
    );
    return page.origin === origin ? page.href : startPage;
  } catch {
    return startPage;
  }
}

/** The push's data as JSON; undefined when it has none or it is not JSON. */
function pushJson(event: PushLike): unknown {
  if (event.data === null) return undefined;
  try {
    return event.data.json();
  } catch {
    return undefined;
  }
}
