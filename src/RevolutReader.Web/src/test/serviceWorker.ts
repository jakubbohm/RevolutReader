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
 * - `clients`: the windows of the app open now (`openWindows`, by default none). `matchAll` answers them;
 *   `focus()` on one brings it to the front (`focusedWindows()`); `openWindow(url)` opens a new one
 *   (`openedWindows()`), which then counts as open.
 * - A push (`deliverPush(json)`): the event carries the push's data as JSON. A browser that reads Declarative Web Push
 *   (`declarative: true`, as Safari) also puts its proposed notification on the event (`notification`) when the JSON is
 *   a declarative message, and `null` when it is not; a browser that does not (by default, as Chrome on a computer) puts
 *   nothing there.
 * - A tap (`tapNotification(index)`) on a notification the service worker showed: the event carries it, with its data
 *   and `close()`, recorded in `closedNotifications()`.
 * Each event's handlers run, and the helper waits for the work they passed to `waitUntil`, so a failure there fails
 * the test. Every origin and address here is made up.
 */

/** The service worker's own origin when a test names none (made up). */
export const ORIGIN = "https://tarjeta-papa.example";

/** How the service worker's side stands for this test. */
export interface ServiceWorkerStandInOptions {
  /** Whether the browser reads Declarative Web Push and proposes its own notification on the push event; by default not. */
  declarative?: boolean;
  /** The addresses of the app's windows open now; by default none. */
  openWindows?: readonly string[];
  /** The service worker's own origin; by default `ORIGIN`. */
  origin?: string;
}

/** A notification the service worker showed. */
export interface ShownNotification {
  title: string;
  body?: string;
  data: unknown;
}

/** The installed stand-in, and what was done with it. */
export interface ServiceWorkerStandIn {
  /** The service worker's scope, to hand to `listenForPushes`. */
  worker: PushWorker;
  /** A push with this JSON arrives; resolves once the handlers' `waitUntil` work is done. */
  deliverPush(json: unknown): Promise<void>;
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

  const worker: PushWorker = {
    location: { origin },
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
      matchAll: () => Promise.resolve([...windows]),
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

  return {
    worker,
    deliverPush: async (json) => {
      const work: Promise<unknown>[] = [];
      const event: PushLike = {
        data: { json: () => structuredClone(json) },
        waitUntil: (promise) => {
          work.push(promise);
        },
      };
      if (options.declarative === true)
        event.notification = proposedNotification(json);
      for (const listener of pushListeners) listener(event);
      await Promise.all(work);
    },
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
 * The notification a browser that reads Declarative Web Push proposes for this JSON: its title, body and the page it
 * opens, when the JSON is a declarative message (`"web_push": 8030` with a notification that has a title); `null`
 * otherwise. The stand-in's own reading, independent of the app's.
 */
function proposedNotification(
  json: unknown,
): { title: string; body?: string; navigate?: string } | null {
  if (typeof json !== "object" || json === null) return null;
  const message = json as { web_push?: unknown; notification?: unknown };
  if (message.web_push !== 8030) return null;
  if (typeof message.notification !== "object" || message.notification === null)
    return null;
  const notification = message.notification as {
    title?: unknown;
    body?: unknown;
    navigate?: unknown;
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
  };
}
