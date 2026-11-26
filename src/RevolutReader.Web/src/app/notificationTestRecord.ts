/**
 * Temporary, for the iPhone test of #113 (reverted with it). A record, in the phone's own storage only, of what the app
 * sees at every start, whenever it comes back to the front, whenever its address's fragment changes, and when the
 * browser restores it from its back-forward cache: the event, the time, the address's path and fragment, whether the
 * page was visible, how it was loaded (at a start), and what `registration.getNotifications()` lists. The owner's test
 * notifications are recorded in full, their `data` and their `navigate` address as they came, whatever iOS made of them
 * (WebKit gives a listed notification its `navigate`, but not the `data` of one iOS showed itself). A test notification is one titled
 * `Test <number>`, as the owner's test messages are (the account check's titles start with "Odešlo" or "Přišlo"), or one
 * whose `data` carries `test`, the made-up balance. Every other notification is only counted, so nothing of a real
 * notification, its balance above all, is recorded. It sends nothing anywhere and never throws: the app starts as before
 * whatever happens here.
 */

/** Where the record lives in the phone's `localStorage`. */
export const RECORD_KEY = "tarjeta-papa.notification-test.record";

/** The event the page hears after every change of the record (`RecordedPage.dispatchEvent`). */
export const RECORD_CHANGED = "tarjeta-papa:notification-test-record";

/** The newest entries kept. */
export const MOST_ENTRIES = 100;

/** The test page's path, which nothing links to. */
export const TEST_PAGE = "/test/notifications";

/** What made an entry: a start, a return to the front, a change of the fragment, a restore from the back-forward cache. */
export type RecordEvent = "start" | "front" | "fragment" | "restored";

/** A test notification as recorded: its title, its text, its `data` and its `navigate` address, as they came. */
export interface TestNotification {
  title: string;
  body: string;
  data: RawData;
  /** Absent in the entries the previous version recorded, which did not read it. */
  navigate?: RawData;
}

/**
 * A member of a notification (`data`, `navigate`) as `getNotifications()` gave it: its kind (`typeof`, with null and
 * arrays told apart) and its value, a string as it is and anything else as JSON; null when JSON cannot hold it
 * (undefined, a cycle, a bigint).
 */
export interface RawData {
  kind:
    | "undefined"
    | "null"
    | "array"
    | "object"
    | "string"
    | "number"
    | "boolean"
    | "bigint"
    | "symbol"
    | "function";
  value: string | null;
}

/** The title of the owner's test messages: `Test` and their number. */
const TEST_TITLE = /^Test \d+$/;

/** What `getNotifications()` came to, or why it could not be asked; `afterMs` from the entry's time to the answer. */
export type Listed =
  | {
      kind: "listed";
      afterMs: number;
      test: TestNotification[];
      others: number;
    }
  | { kind: "failed"; afterMs: number; error: string }
  | {
      kind: "unavailable";
      reason: "no service worker" | "no getNotifications";
    };

/** One entry; `listed` is null until the notifications answer. */
export interface RecordEntry {
  id: number;
  /** When the page this entry belongs to started (ISO 8601). */
  startedAt: string;
  event: RecordEvent;
  /** When it happened (ISO 8601). */
  at: string;
  path: string;
  fragment: string;
  visibility: string;
  /** How the page was loaded (`PerformanceNavigationTiming.type`), at a start; null otherwise or when not known. */
  loadedBy: string | null;
  listed: Listed | null;
}

/** A notification as `getNotifications()` lists it, in the members read here. */
export interface NotificationLike {
  title: string;
  body: string;
  data: unknown;
  /** The address a tap opens (Declarative Web Push); absent where the browser does not give it. */
  navigate?: unknown;
}

/** The members of the page (`window`) the record uses, so the tests can stand in for them. */
export interface RecordedPage {
  location: { pathname: string; hash: string };
  document: {
    visibilityState: string;
    addEventListener(type: string, listener: () => void): void;
  };
  navigator: {
    serviceWorker?: {
      ready: Promise<{
        getNotifications?: () => Promise<readonly NotificationLike[]>;
      }>;
    };
  };
  performance: { getEntriesByType(type: string): readonly unknown[] };
  localStorage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  addEventListener(type: string, listener: (event: Event) => void): void;
  dispatchEvent(event: Event): boolean;
}

/** Starts the record on `page`: an entry now, and one at every later event the module describes. Never throws. */
export function recordNotifications(page: RecordedPage): void {
  try {
    const startedAt = new Date().toISOString();
    record(page, startedAt, "start");
    page.document.addEventListener("visibilitychange", () => {
      if (page.document.visibilityState === "visible")
        record(page, startedAt, "front");
    });
    page.addEventListener("hashchange", () => {
      record(page, startedAt, "fragment");
    });
    page.addEventListener("pageshow", (event) => {
      if (isRecord(event) && event.persisted === true)
        record(page, startedAt, "restored");
    });
  } catch {
    // Never in the app's way.
  }
}

/** The record `storage` holds, oldest first; empty when it holds none it can read. Never throws. */
export function readRecord(
  storage: Pick<Storage, "getItem">,
): readonly RecordEntry[] {
  try {
    const stored: unknown = JSON.parse(storage.getItem(RECORD_KEY) ?? "[]");
    return Array.isArray(stored) ? (stored as RecordEntry[]) : [];
  } catch {
    return [];
  }
}

/** Empties the record and tells the page. Never throws. */
export function clearRecord(
  page: Pick<RecordedPage, "localStorage" | "dispatchEvent">,
): void {
  try {
    page.localStorage.removeItem(RECORD_KEY);
    page.dispatchEvent(new Event(RECORD_CHANGED));
  } catch {
    // Never in the app's way.
  }
}

/** Whether `path` is the test page's. */
export function isNotificationTestPage(path: string): boolean {
  return path === TEST_PAGE || path === `${TEST_PAGE}/`;
}

/** Adds an entry for `event` now, then completes it with what the notifications list. Never throws. */
function record(
  page: RecordedPage,
  startedAt: string,
  event: RecordEvent,
): void {
  try {
    const at = Date.now();
    const entries = readRecord(page.localStorage);
    const id = Math.max(0, ...entries.map((entry) => entry.id)) + 1;
    const entry: RecordEntry = {
      id,
      startedAt,
      event,
      at: new Date(at).toISOString(),
      path: page.location.pathname,
      fragment: page.location.hash,
      visibility: page.document.visibilityState,
      loadedBy: event === "start" ? loadedBy(page) : null,
      listed: null,
    };
    write(page, [...entries, entry].slice(-MOST_ENTRIES));
    void listedNotifications(page, at).then((listed) => {
      write(
        page,
        readRecord(page.localStorage).map((each) =>
          each.id === id ? { ...each, listed } : each,
        ),
      );
    });
  } catch {
    // Never in the app's way.
  }
}

/** What `getNotifications()` lists: the test notifications in full, every other one counted. Never rejects. */
async function listedNotifications(
  page: RecordedPage,
  since: number,
): Promise<Listed> {
  try {
    const container = page.navigator.serviceWorker;
    if (container === undefined)
      return { kind: "unavailable", reason: "no service worker" };
    const registration = await container.ready;
    if (typeof registration.getNotifications !== "function")
      return { kind: "unavailable", reason: "no getNotifications" };
    const notifications = await registration.getNotifications();
    const test: TestNotification[] = [];
    let others = 0;
    for (const notification of notifications) {
      const { data } = notification;
      if (
        TEST_TITLE.test(notification.title) ||
        (isRecord(data) && "test" in data)
      )
        test.push({
          title: notification.title,
          body: notification.body,
          data: rawData(data),
          navigate: rawData(notification.navigate),
        });
      else others += 1;
    }
    return { kind: "listed", afterMs: Date.now() - since, test, others };
  } catch (error) {
    // The error's name only, never its message.
    const name =
      isRecord(error) && typeof error.name === "string"
        ? error.name
        : "unknown";
    return { kind: "failed", afterMs: Date.now() - since, error: name };
  }
}

/** A member as it came (`RawData`). Never throws. */
function rawData(data: unknown): RawData {
  const kind: RawData["kind"] =
    data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
  if (typeof data === "string") return { kind, value: data };
  try {
    const value: unknown = JSON.stringify(data);
    return { kind, value: typeof value === "string" ? value : null };
  } catch {
    return { kind, value: null };
  }
}

/** How the page was loaded, from its navigation entry; null when not known. */
function loadedBy(page: RecordedPage): string | null {
  const [navigation] = page.performance.getEntriesByType("navigation");
  return isRecord(navigation) && typeof navigation.type === "string"
    ? navigation.type
    : null;
}

/** Stores `entries` and tells the page. Never throws. */
function write(page: RecordedPage, entries: readonly RecordEntry[]): void {
  try {
    page.localStorage.setItem(RECORD_KEY, JSON.stringify(entries));
    page.dispatchEvent(new Event(RECORD_CHANGED));
  } catch {
    // Never in the app's way.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
