/**
 * What the service worker does with a push and a tap on its notification (c012 design.md D9). Imported by `sw.ts` and by
 * the tests; compiled under both `tsconfig.app.json` (`DOM`) and `tsconfig.sw.json` (`WebWorker`), so it names the few
 * members of the service worker's scope it uses as its own small interfaces.
 */

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

/** The members of the service worker's global scope this module uses (both ServiceWorkerGlobalScope and the stand-in fit). */
export interface PushWorker {
  location: { origin: string };
  registration: {
    showNotification(
      title: string,
      options?: { body?: string; data?: unknown },
    ): Promise<void>;
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
 * Listens for pushes and taps (D9): a push with the browser's own notification is left alone; otherwise its
 * declarative message is shown (title, body, navigate in data). A tap closes the notification and focuses an open
 * window of the app on the worker's origin, or opens navigate's path, query and fragment on that origin.
 */
export function listenForPushes(worker: PushWorker): void {
  worker.addEventListener("push", (event) => {
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
