import type {
  NotificationClickLike,
  PushLike,
  PushWorker,
  WindowLike,
} from "../app/pushDisplay";

/**
 * The service worker's side, as the app's tests see it (c012 design.md D9, D10): jsdom runs no service worker, so the
 * push handling (`listenForPushes`) is tested as plain functions against this stand-in for the members of the
 * service worker's scope it uses (`PushWorker`), and the test fires its events.
 *
 * What it stands in for, as the browsers behave:
 * - `location.origin`: the service worker's own origin, by default `ORIGIN`.
 * - `registration.showNotification(title, options)`: shows a notification of the service worker's own, recorded in
 *   `shownNotifications()` with its title, body and data.
 * - `clients`: the windows open now (`openWindows`, by default none; and `uncontrolledWindows`, which `matchAll` answers
 *   only with `includeUncontrolled: true`). `matchAll` answers them, whatever their origin, so a test can check that
 *   the handler counts only its own origin's as the app;
 *   `focus()` on one brings it to the front (`focusedWindows()`); `openWindow(url)` opens a new one
 *   (`openedWindows()`), which then counts as open.
 * - A push: `deliverPush(json)` with data whose `json()` gives the JSON; `deliverPushWithoutData()` with no data
 *   (`null`); `deliverPushOfText(text)` with data whose `json()` parses the text and throws a `SyntaxError` when it is
 *   not JSON, as the browser's `PushMessageData.json()` does. What the event carries depends on the browser:
 *   - by default, one that does not read Declarative Web Push (as Chrome on a computer): the push's data, and no
 *     `notification` member at all;
 *   - `declarative: true`, one that reads it (as Safari): for a declarative message (`"web_push": 8030` with a
 *     notification that has a title), as JSON or as text that parses to one, the notification it proposes
 *     (`notification`) and no data of its own (`data` `null`); for any other push, `notification` `null` and the push's
 *     data;
 *   - `proposesNull: true`, one that has the member but proposes nothing (it overrides `declarative`): `notification`
 *     `null` on every push, and the push's data.
 * - The proposed notification (c015 design.md D2, D8, from the W3C Push API draft's "Receiving a push message"): the
 *   message's title, body and the page it opens, and as its `data` a copy of the message's `notification.data` (`null`
 *   when the message has none, as a `Notification`'s `data`), so that is where the push's own data reaches the handler.
 *   The event fires for a message without `"mutable": true` too (C8b's model: the draft and WebKit's post differ there).
 * - A tap (`tapNotification(index)`) on a notification the service worker showed: the event carries it, with its data
 *   and `close()`, recorded in `closedNotifications()`.
 * - `fetch(input, init)` (c016 design.md D7): the service worker's own requests, handed to the fake server
 *   (`globalThis.fetch`, which `setup.ts` installs from `./server.ts`), so each shows in its timeline and, with a body,
 *   in `bodiesSent()`, and gets the answer the test set there (offline too, `goOffline()`). The service worker and the
 *   page are one app on one origin, but this stand-in's origin and the fake server's page are made up apart: an address
 *   on the service worker's own origin (or a path, resolved against it) reaches the fake server as the same path on the
 *   page's origin; any other address goes as it is, which the fake server writes in full and answers 404.
 * Each event's handlers run, and the helper waits for the work they passed to `waitUntil`, so a failure there fails
 * the test. Every origin and address here is made up.
 */

/** The service worker's own origin when a test names none (made up). */
export const ORIGIN = "https://tarjeta-papa.example";

/** How the service worker's side stands for this test. */
export interface ServiceWorkerStandInOptions {
  /** Whether the browser reads Declarative Web Push and proposes its own notification on the push event; by default not. */
  declarative?: boolean;
  /**
   * Whether the browser has the push event's `notification` member but leaves it `null` on every push, a declarative
   * message too (it proposes no notification of its own); by default not. Not combined with `declarative`, which it overrides.
   */
  proposesNull?: boolean;
  /** The addresses of the windows open now, controlled by the service worker; by default none. */
  openWindows?: readonly string[];
  /**
   * The addresses of windows open now that the service worker does not control (e.g. opened before it took over);
   * `matchAll` answers them only with `includeUncontrolled: true`, as the browser does; by default none.
   */
  uncontrolledWindows?: readonly string[];
  /** The service worker's own origin; by default `ORIGIN`. */
  origin?: string;
}

/** A notification the service worker showed. */
export interface ShownNotification {
  title: string;
  body?: string;
  data: unknown;
}

/** The service worker's own `fetch`, as the stand-in gives it (c016 design.md D7; see the module's description). */
export interface WorkerFetch {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** The installed stand-in, and what was done with it. */
export interface ServiceWorkerStandIn {
  /** The service worker's scope, to hand to `listenForPushes`. */
  worker: PushWorker & WorkerFetch;
  /** A push with this JSON arrives; resolves once the handlers' `waitUntil` work is done. */
  deliverPush(json: unknown): Promise<void>;
  /** A push with no data at all arrives (`data` is `null`); resolves once the handlers' `waitUntil` work is done. */
  deliverPushWithoutData(): Promise<void>;
  /** A push whose data is this text arrives: its `json()` parses it, throwing a `SyntaxError` when it is not JSON; resolves once the handlers' `waitUntil` work is done. */
  deliverPushOfText(text: string): Promise<void>;
  /** The notification the service worker showed at `index` (by default the first) is tapped; resolves once the handlers' work is done. */
  tapNotification(index?: number): Promise<void>;
  /** The notifications the service worker showed, in order. */
  shownNotifications(): ShownNotification[];
  /** The indexes of the shown notifications that were closed, in order. */
  closedNotifications(): number[];
  /** The addresses of the windows opened, in order. */
  openedWindows(): string[];
  /** The addresses of the windows brought to the front, in order. */
  focusedWindows(): string[];
}

/** Sets up the service worker's side for this test, as the options say (see the module's description). */
export function installServiceWorkerStandIn(
  options: ServiceWorkerStandInOptions = {},
): ServiceWorkerStandIn {
  const origin = options.origin ?? ORIGIN;
  const shown: ShownNotification[] = [];
  const closed: number[] = [];
  const opened: string[] = [];
  const focused: string[] = [];
  const pushListeners: ((event: PushLike) => void)[] = [];
  const clickListeners: ((event: NotificationClickLike) => void)[] = [];

  const windowAt = (url: string): WindowLike => ({
    url,
    focus: () => {
      focused.push(url);
      return Promise.resolve(windowAt(url));
    },
  });
  const windows: WindowLike[] = (options.openWindows ?? []).map(windowAt);
  const uncontrolled: WindowLike[] = (options.uncontrolledWindows ?? []).map(
    windowAt,
  );

  const worker: PushWorker & WorkerFetch = {
    location: { origin },
    fetch: (input, init) => globalThis.fetch(onTheServer(input, origin), init),
    registration: {
      showNotification: (title, notificationOptions) => {
        shown.push({
          title,
          ...(notificationOptions?.body === undefined
            ? {}
            : { body: notificationOptions.body }),
          data: notificationOptions?.data,
        });
        return Promise.resolve();
      },
    },
    clients: {
      matchAll: (matchOptions) =>
        Promise.resolve([
          ...windows,
          ...(matchOptions.includeUncontrolled ? uncontrolled : []),
        ]),
      openWindow: (url) => {
        opened.push(url);
        const newWindow = windowAt(url);
        windows.push(newWindow);
        return Promise.resolve(newWindow);
      },
    },
    addEventListener: (
      type: "push" | "notificationclick",
      listener:
        ((event: PushLike) => void) | ((event: NotificationClickLike) => void),
    ) => {
      if (type === "push")
        pushListeners.push(listener as (event: PushLike) => void);
      else
        clickListeners.push(listener as (event: NotificationClickLike) => void);
    },
  };

  /**
   * A push with this data arrives; a browser that reads Declarative Web Push puts `proposed()` on the event (see
   * `proposesNull`) and, when it proposes a notification, hands the event no data of its own (the W3C draft).
   */
  const firePush = async (
    data: PushLike["data"],
    proposed: () => unknown,
  ): Promise<void> => {
    const work: Promise<unknown>[] = [];
    const notification =
      options.proposesNull === true
        ? null
        : options.declarative === true
          ? proposed()
          : undefined;
    const declarative = notification !== undefined && notification !== null;
    const event: PushLike = {
      data: declarative ? null : data,
      waitUntil: (promise) => {
        work.push(promise);
      },
    };
    if (notification !== undefined) event.notification = notification;
    for (const listener of pushListeners) listener(event);
    await Promise.all(work);
  };

  return {
    worker,
    deliverPush: (json) =>
      firePush({ json: () => structuredClone(json) }, () =>
        proposedNotification(json),
      ),
    deliverPushWithoutData: () => firePush(null, () => null),
    deliverPushOfText: (text) =>
      firePush({ json: () => JSON.parse(text) as unknown }, () => {
        try {
          return proposedNotification(JSON.parse(text));
        } catch {
          return null;
        }
      }),
    tapNotification: async (index = 0) => {
      const notification = shown[index];
      if (notification === undefined)
        throw new Error(
          `The service worker showed no notification at ${index} (it showed ${shown.length}), so none can be tapped.`,
        );
      const work: Promise<unknown>[] = [];
      const event: NotificationClickLike = {
        notification: {
          data: notification.data,
          close: () => {
            closed.push(index);
          },
        },
        waitUntil: (promise) => {
          work.push(promise);
        },
      };
      for (const listener of clickListeners) listener(event);
      await Promise.all(work);
    },
    shownNotifications: () => shown.map((each) => ({ ...each })),
    closedNotifications: () => [...closed],
    openedWindows: () => [...opened],
    focusedWindows: () => [...focused],
  };
}

/**
 * The address the fake server gets for a request the service worker on `origin` sends to `input`: `input` resolved
 * against `origin`; on that origin, its path, query and fragment on the page's origin (the fake server's), since the
 * service worker and the page are one app; elsewhere, as it is.
 */
function onTheServer(input: string, origin: string): string {
  const own = new URL(origin);
  const address = new URL(input, own);
  if (address.origin !== own.origin) return address.href;
  return new URL(
    `${address.pathname}${address.search}${address.hash}`,
    globalThis.location.href,
  ).href;
}

/**
 * The notification a browser that reads Declarative Web Push proposes for this JSON: its title, body, the page it
 * opens and its data (the message's `notification.data`, a copy, as a `Notification` hands out its `data`; `null` when
 * the message has none), when the JSON is a declarative message (`"web_push": 8030` with a notification that has a
 * title); `null` otherwise. The stand-in's own reading, independent of the app's.
 */
function proposedNotification(
  json: unknown,
): { title: string; body?: string; navigate?: string; data: unknown } | null {
  if (typeof json !== "object" || json === null) return null;
  const message = json as { web_push?: unknown; notification?: unknown };
  if (message.web_push !== 8030) return null;
  if (typeof message.notification !== "object" || message.notification === null)
    return null;
  const notification = message.notification as {
    title?: unknown;
    body?: unknown;
    navigate?: unknown;
    data?: unknown;
  };
  if (typeof notification.title !== "string") return null;
  return {
    title: notification.title,
    ...(typeof notification.body === "string"
      ? { body: notification.body }
      : {}),
    ...(typeof notification.navigate === "string"
      ? { navigate: notification.navigate }
      : {}),
    data:
      notification.data === undefined
        ? null
        : structuredClone(notification.data),
  };
}
