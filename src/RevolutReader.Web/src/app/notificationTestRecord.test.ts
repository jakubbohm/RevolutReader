import { expect, test } from "vitest";
import {
  realTurn,
  SECOND,
  startTestClock,
  TEST_CLOCK_START,
  timePasses,
} from "../test/clock";
import { timeline } from "../test/server";
import {
  clearRecord,
  isNotificationTestPage,
  MOST_ENTRIES,
  readRecord,
  RECORD_CHANGED,
  RECORD_KEY,
  recordNotifications,
  type NotificationLike,
  type RecordedPage,
} from "./notificationTestRecord";

// Temporary, for the iPhone test of #113 (reverted with it). Every value here is made up.

/** A test notification as the owner's test message makes it: its made-up balance under `data.test`. */
const TEST_NOTIFICATION: NotificationLike = {
  title: "Test 1",
  body: "Vymyšlený zůstatek",
  data: {
    test: {
      amount: 101.01,
      readAt: "2026-11-26T14:03:21+00:00",
      czkPerEur: 25.5,
    },
  },
};

/** A notification of the account check, as the phone lists it: a real balance in its data. */
const BALANCE_NOTIFICATION: NotificationLike = {
  title: "Odešlo 3,80 €",
  body: "Zůstatek 282,60 € (≈ 6 867 Kč)",
  data: {
    balance: {
      amount: 282.6,
      readAt: "2026-11-10T08:59:00+00:00",
      czkPerEur: 24.3,
    },
  },
};

/** The owner's plain message, with no data. */
const OWNERS_MESSAGE: NotificationLike = {
  title: "Ahoj",
  body: "Zkušební zpráva",
  data: null,
};

/** A notification a computer's service worker showed itself: its data is the page it opens. */
const SHOWN_BY_THE_SERVICE_WORKER: NotificationLike = {
  title: "Odešlo 12,00 €",
  body: "Zůstatek 270,60 € (≈ 6 575 Kč)",
  data: "https://reader.example/",
};

interface StandInOptions {
  path?: string;
  fragment?: string;
  visibility?: "visible" | "hidden";
  loadedBy?: string;
  /** What `getNotifications()` answers, or a function giving its promise; by default none listed. */
  notifications?:
    readonly NotificationLike[] | (() => Promise<readonly NotificationLike[]>);
  /** A page without a service worker, or whose registration has no `getNotifications`. */
  without?: "service worker" | "getNotifications";
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}

interface StandIn {
  page: RecordedPage;
  /** Sets the fragment and fires `hashchange`, as a same-document navigation does. */
  changeFragment(fragment: string): void;
  /** Sets the visibility and fires `visibilitychange`. */
  turn(visibility: "visible" | "hidden"): void;
  /** Fires `pageshow`, restored from the back-forward cache or not. */
  show(persisted: boolean): void;
  /** How many times the page was told the record changed. */
  changesTold(): number;
}

/** A page that stands in for `window`: the phone's own `localStorage` (jsdom's, emptied before every test) by default. */
function standInPage(options: StandInOptions = {}): StandIn {
  const location = {
    pathname: options.path ?? "/test/notifications",
    hash: options.fragment ?? "",
  };
  let visibility: string = options.visibility ?? "visible";
  const events = new EventTarget();
  const documentEvents = new EventTarget();
  let told = 0;
  events.addEventListener(RECORD_CHANGED, () => {
    told += 1;
  });
  const listed = options.notifications ?? [];
  const getNotifications = (): Promise<readonly NotificationLike[]> =>
    typeof listed === "function" ? listed() : Promise.resolve(listed);
  const registration =
    options.without === "getNotifications" ? {} : { getNotifications };

  const page: RecordedPage = {
    location,
    document: {
      get visibilityState() {
        return visibility;
      },
      addEventListener: (type, listener) => {
        documentEvents.addEventListener(type, listener);
      },
    },
    navigator:
      options.without === "service worker"
        ? {}
        : { serviceWorker: { ready: Promise.resolve(registration) } },
    performance: {
      getEntriesByType: (type) =>
        type === "navigation" && options.loadedBy !== undefined
          ? [{ type: options.loadedBy }]
          : [],
    },
    localStorage: options.storage ?? globalThis.localStorage,
    addEventListener: (type, listener) => {
      events.addEventListener(type, listener);
    },
    dispatchEvent: (event) => events.dispatchEvent(event),
  };

  return {
    page,
    changeFragment: (fragment) => {
      location.hash = fragment;
      events.dispatchEvent(new Event("hashchange"));
    },
    turn: (state) => {
      visibility = state;
      documentEvents.dispatchEvent(new Event("visibilitychange"));
    },
    show: (persisted) => {
      const event = new Event("pageshow");
      Object.defineProperty(event, "persisted", { value: persisted });
      events.dispatchEvent(event);
    },
    changesTold: () => told,
  };
}

/** Lets the notifications answer and the record be completed. */
async function answered(): Promise<void> {
  await realTurn();
  await realTurn();
}

test("A start records its event, time, path, fragment, visibility and how the page was loaded, and each test notification in full", async () => {
  startTestClock();
  const { page } = standInPage({
    path: "/test/notifications",
    fragment: "#t1",
    visibility: "hidden",
    loadedBy: "navigate",
    notifications: [TEST_NOTIFICATION],
  });

  recordNotifications(page);
  await answered();

  expect(readRecord(localStorage)).toEqual([
    {
      id: 1,
      startedAt: TEST_CLOCK_START.toISOString(),
      event: "start",
      at: TEST_CLOCK_START.toISOString(),
      path: "/test/notifications",
      fragment: "#t1",
      visibility: "hidden",
      loadedBy: "navigate",
      listed: {
        kind: "listed",
        afterMs: 0,
        test: [
          {
            title: "Test 1",
            body: "Vymyšlený zůstatek",
            data: {
              kind: "object",
              value:
                '{"test":{"amount":101.01,"readAt":"2026-11-26T14:03:21+00:00","czkPerEur":25.5}}',
            },
          },
        ],
        others: 0,
      },
    },
  ]);
});

test("A notification titled Test and a number is a test notification whatever its data, recorded as the data came", async () => {
  const sent = {
    test: {
      amount: 111.11,
      readAt: "2026-11-26T14:03:21+00:00",
      czkPerEur: 25.5,
    },
  };
  const titled = (number: number, data: unknown): NotificationLike => ({
    title: `Test ${number}`,
    body: "Vymyšlený zůstatek",
    data,
  });
  const { page } = standInPage({
    notifications: [
      titled(11, null),
      titled(12, undefined),
      titled(13, JSON.stringify(sent)),
      titled(14, { notification: { title: "Test 14" } }),
      titled(15, [sent]),
      titled(16, 42),
    ],
  });

  recordNotifications(page);
  await answered();

  const [entry] = readRecord(localStorage);
  expect(entry?.listed).toEqual({
    kind: "listed",
    afterMs: expect.any(Number),
    others: 0,
    test: [
      { kind: "null", value: "null" },
      { kind: "undefined", value: null },
      { kind: "string", value: JSON.stringify(sent) },
      { kind: "object", value: '{"notification":{"title":"Test 14"}}' },
      { kind: "array", value: `[${JSON.stringify(sent)}]` },
      { kind: "number", value: "42" },
    ].map((data, index) => ({
      title: `Test ${11 + index}`,
      body: "Vymyšlený zůstatek",
      data,
    })),
  });
});

test("A test notification's data that JSON cannot hold is recorded by its kind, with no value", async () => {
  const cyclic: Record<string, unknown> = { test: { amount: 101.01 } };
  cyclic.itself = cyclic;
  const { page } = standInPage({
    notifications: [
      { title: "Test 17", body: "Vymyšlený zůstatek", data: cyclic },
      { title: "Test 18", body: "Vymyšlený zůstatek", data: 10n },
    ],
  });

  expect(() => recordNotifications(page)).not.toThrow();
  await answered();

  const [entry] = readRecord(localStorage);
  expect(entry?.listed).toHaveProperty("test", [
    {
      title: "Test 17",
      body: "Vymyšlený zůstatek",
      data: { kind: "object", value: null },
    },
    {
      title: "Test 18",
      body: "Vymyšlený zůstatek",
      data: { kind: "bigint", value: null },
    },
  ]);
});

test("Every other notification is only counted: nothing of its title, text or data is recorded", async () => {
  // Titles close to the test messages' "Test <number>", on a real balance: none of them is a test notification.
  const nearMisses = [
    "Test",
    "Test 1a",
    "test 1",
    "Test  1",
    " Test 1",
    "Test 1 ",
    "Test 1\nOdešlo 3,80 €",
    "Odešlo Test 1",
  ].map((title): NotificationLike => ({ ...BALANCE_NOTIFICATION, title }));
  const { page } = standInPage({
    notifications: [
      BALANCE_NOTIFICATION,
      OWNERS_MESSAGE,
      SHOWN_BY_THE_SERVICE_WORKER,
      ...nearMisses,
      TEST_NOTIFICATION,
    ],
  });

  recordNotifications(page);
  await answered();

  const [entry] = readRecord(localStorage);
  expect(entry?.listed).toMatchObject({
    kind: "listed",
    others: 3 + nearMisses.length,
  });
  expect(entry?.listed).toHaveProperty("test", [
    expect.objectContaining({ title: "Test 1" }),
  ]);
  const stored = localStorage.getItem(RECORD_KEY) ?? "";
  for (const part of [
    "Odešlo",
    "Zůstatek",
    "282",
    "270",
    "24.3",
    "2026-11-10",
    "6 867",
    "Ahoj",
    "Zkušební",
    "reader.example",
    "balance",
  ]) {
    expect(stored, part).not.toContain(part);
  }
});

test("Coming back to the front, a change of the fragment and a restore from the back-forward cache each add an entry of the same start", async () => {
  startTestClock();
  let listed: readonly NotificationLike[] = [];
  const standIn = standInPage({
    fragment: "#t1",
    notifications: () => Promise.resolve(listed),
  });
  recordNotifications(standIn.page);
  await answered();

  listed = [TEST_NOTIFICATION];
  standIn.turn("hidden");
  await timePasses(10 * SECOND);
  standIn.turn("visible");
  await answered();
  await timePasses(10 * SECOND);
  standIn.changeFragment("#t2");
  await answered();
  await timePasses(10 * SECOND);
  standIn.show(true);
  await answered();

  const record = readRecord(localStorage);
  expect(
    record.map(({ id, event, at, fragment, startedAt }) => ({
      id,
      event,
      at,
      fragment,
      startedAt,
    })),
  ).toEqual([
    {
      id: 1,
      event: "start",
      at: "2026-11-10T09:00:00.000Z",
      fragment: "#t1",
      startedAt: "2026-11-10T09:00:00.000Z",
    },
    {
      id: 2,
      event: "front",
      at: "2026-11-10T09:00:10.000Z",
      fragment: "#t1",
      startedAt: "2026-11-10T09:00:00.000Z",
    },
    {
      id: 3,
      event: "fragment",
      at: "2026-11-10T09:00:20.000Z",
      fragment: "#t2",
      startedAt: "2026-11-10T09:00:00.000Z",
    },
    {
      id: 4,
      event: "restored",
      at: "2026-11-10T09:00:30.000Z",
      fragment: "#t2",
      startedAt: "2026-11-10T09:00:00.000Z",
    },
  ]);
  expect(record.map((entry) => entry.loadedBy)).toEqual([
    null,
    null,
    null,
    null,
  ]);
  expect(
    record.map((entry) =>
      entry.listed?.kind === "listed" ? entry.listed.test.length : null,
    ),
    "each entry lists the notifications as they were at its time",
  ).toEqual([0, 1, 1, 1]);
});

test("Going to the background, and a page shown fresh rather than restored, add nothing", async () => {
  const standIn = standInPage();
  recordNotifications(standIn.page);
  await answered();

  standIn.turn("hidden");
  standIn.show(false);
  await answered();

  expect(readRecord(localStorage).map((entry) => entry.event)).toEqual([
    "start",
  ]);
});

test("A start is recorded at once, before the notifications answer, and completed when they do", async () => {
  startTestClock();
  let answer: (listed: readonly NotificationLike[]) => void = () => {};
  const { page } = standInPage({
    notifications: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  });

  recordNotifications(page);

  expect(readRecord(localStorage)).toEqual([
    expect.objectContaining({ event: "start", listed: null }),
  ]);

  await timePasses(2 * SECOND);
  answer([TEST_NOTIFICATION]);
  await answered();

  expect(readRecord(localStorage)[0]?.listed).toMatchObject({
    kind: "listed",
    afterMs: 2 * SECOND,
    others: 0,
  });
});

test("Without a service worker, without getNotifications, or when getNotifications fails, the entry says so, the error by its name only", async () => {
  const cases: [string, StandInOptions, unknown][] = [
    [
      "no service worker",
      { without: "service worker" },
      { kind: "unavailable", reason: "no service worker" },
    ],
    [
      "no getNotifications",
      { without: "getNotifications" },
      { kind: "unavailable", reason: "no getNotifications" },
    ],
    [
      "getNotifications fails",
      {
        notifications: () =>
          Promise.reject(
            new DOMException(
              "Zůstatek 282,60 € secret detail",
              "InvalidStateError",
            ),
          ),
      },
      { kind: "failed", afterMs: 0, error: "InvalidStateError" },
    ],
  ];

  for (const [name, options, listed] of cases) {
    localStorage.clear();
    startTestClock();
    const { page } = standInPage(options);

    expect(() => recordNotifications(page), name).not.toThrow();
    await answered();

    expect(readRecord(localStorage)[0]?.listed, name).toEqual(listed);
    expect(localStorage.getItem(RECORD_KEY), name).not.toContain("282");
  }
});

test("Storage that fails, or holds no record it can read, never stops the start", async () => {
  const failing = {
    getItem: (): string | null => {
      throw new Error("storage failed");
    },
    setItem: (): void => {
      throw new Error("quota exceeded");
    },
    removeItem: (): void => {
      throw new Error("storage failed");
    },
  };
  const { page } = standInPage({ storage: failing });

  expect(() => recordNotifications(page)).not.toThrow();
  await answered();
  expect(() => clearRecord(page)).not.toThrow();
  expect(() => readRecord(failing)).not.toThrow();
  expect(readRecord(failing)).toEqual([]);

  for (const unreadable of ["{", "null", '{"id":1}', "42"]) {
    localStorage.setItem(RECORD_KEY, unreadable);
    expect(readRecord(localStorage), unreadable).toEqual([]);
    recordNotifications(standInPage().page);
    await answered();
    expect(
      readRecord(localStorage).map((entry) => entry.id),
      unreadable,
    ).toEqual([1]);
  }
});

test("The record keeps the newest 100 entries, numbered on", async () => {
  const standIn = standInPage();
  recordNotifications(standIn.page);
  for (let fragment = 1; fragment <= MOST_ENTRIES + 4; fragment += 1)
    standIn.changeFragment(`#t${fragment}`);
  await answered();

  const record = readRecord(localStorage);
  expect(record).toHaveLength(MOST_ENTRIES);
  expect(record[0]?.id).toBe(6);
  expect(record.at(-1)?.id).toBe(MOST_ENTRIES + 5);
  expect(record.at(-1)?.fragment).toBe(`#t${MOST_ENTRIES + 4}`);
});

test("The record sends nothing to the server", async () => {
  const standIn = standInPage({
    notifications: [TEST_NOTIFICATION, BALANCE_NOTIFICATION],
  });

  recordNotifications(standIn.page);
  standIn.turn("visible");
  standIn.changeFragment("#t2");
  await answered();

  expect(timeline()).toEqual([]);
});

test("Every change of the record tells the page, and clearing it empties it and tells the page", async () => {
  const standIn = standInPage({ notifications: [TEST_NOTIFICATION] });

  recordNotifications(standIn.page);
  await answered();
  // The entry, then its notifications.
  expect(standIn.changesTold()).toBe(2);

  clearRecord(standIn.page);

  expect(readRecord(localStorage)).toEqual([]);
  expect(standIn.changesTold()).toBe(3);
});

test("The test page is its path alone, with or without a final slash", () => {
  expect(isNotificationTestPage("/test/notifications")).toBe(true);
  expect(isNotificationTestPage("/test/notifications/")).toBe(true);
  for (const path of [
    "/",
    "/test",
    "/test/",
    "/test/notifications/other",
    "/test/notificationsx",
    "/TEST/notifications",
    "/api/test/notifications",
  ]) {
    expect(isNotificationTestPage(path), path).toBe(false);
  }
});
