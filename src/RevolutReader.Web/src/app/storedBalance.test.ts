import { IDBFactory } from "fake-indexeddb";
import { expect, test, vi } from "vitest";
import {
  keptBalance,
  phoneKeeps,
  phoneKeepsRecord,
  phoneStorageFails,
} from "../test/server";
import type { Balance } from "./balance";
import {
  forgetStoredBalance,
  keepNotificationBalance,
  loadStoredBalance,
  storeBalance,
} from "./storedBalance";

// The balance the phone keeps (c009 design.md D4): one record `{ amount, readAt, czkPerEur }` in the app's own database
// `tarjeta-papa`, store `balance`, key `last`. A record of the wrong shape and a failing store both read as none, and
// storing or forgetting never throws. The storage is the kit's fake IndexedDB, emptied before every test; the balances
// are made up.

const EARLIER: Balance = {
  amount: 250,
  readAt: "2026-11-10T07:00:00+00:00",
  czkPerEur: 24.3,
};

const LATER: Balance = {
  amount: 286.4,
  readAt: "2026-11-10T08:58:00+00:00",
  czkPerEur: 24.3,
};

test("With nothing stored, loading gives none", async () => {
  expect(await loadStoredBalance()).toBeNull();
});

test("A stored balance loads back as it was stored", async () => {
  await storeBalance(LATER);

  expect(await loadStoredBalance()).toEqual(LATER);
  expect(await keptBalance(), "kept where D4 names it").toEqual(LATER);
});

test("Storing replaces the balance stored before", async () => {
  await storeBalance(EARLIER);

  await storeBalance(LATER);

  expect(await loadStoredBalance()).toEqual(LATER);
});

const wrongShapes: { label: string; record: unknown }[] = [
  {
    label: "the amount as text",
    record: {
      amount: "286.40",
      readAt: "2026-11-10T08:58:00+00:00",
      czkPerEur: 24.3,
    },
  },
  { label: "no read time", record: { amount: 286.4, czkPerEur: 24.3 } },
  {
    label: "a read time that is not a date",
    record: { amount: 286.4, readAt: "včera", czkPerEur: 24.3 },
  },
  { label: "no rate", record: { amount: 286.4, readAt: LATER.readAt } },
  { label: "not a record", record: "286,40 €" },
];

test.each(wrongShapes)(
  "A stored record of the wrong shape loads as none: $label",
  async ({ record }) => {
    await phoneKeepsRecord(record);

    expect(await loadStoredBalance()).toBeNull();
  },
);

type StoredBalanceModule = Pick<
  typeof import("./storedBalance"),
  | "loadStoredBalance"
  | "storeBalance"
  | "forgetStoredBalance"
  | "keepNotificationBalance"
>;

const failingStores: {
  label: string;
  module: () => Promise<StoredBalanceModule>;
}[] = [
  {
    // Used once while it works, as the app does at start, so a storage that keeps its connection has one open.
    label: "a store used before, its connection open",
    module: async () => {
      await loadStoredBalance();
      return {
        loadStoredBalance,
        storeBalance,
        forgetStoredBalance,
        keepNotificationBalance,
      };
    },
  },
  {
    // A fresh copy of the module (and of its storage library), which has opened nothing yet: opening the database fails
    // at once, which idb-keyval passes on as a thrown error, not a rejected promise.
    label: "a store never opened",
    module: async () => {
      vi.resetModules();
      return import("./storedBalance");
    },
  },
];

test.each(failingStores)(
  "A store that fails loads as none, and storing or forgetting into it does not throw: $label",
  async ({ module }) => {
    await phoneKeeps(LATER);
    const stored = await module();
    const restore = phoneStorageFails();
    try {
      expect(await stored.loadStoredBalance()).toBeNull();
      await expect(stored.storeBalance(EARLIER)).resolves.toBeUndefined();
      await expect(stored.forgetStoredBalance()).resolves.toBeUndefined();
    } finally {
      restore();
    }
  },
);

test("After forgetting, loading gives none", async () => {
  await storeBalance(LATER);

  await forgetStoredBalance();

  expect(await loadStoredBalance()).toBeNull();
  expect(await keptBalance(), "nothing kept where D4 names it").toBeNull();
});

// ---- c015: a balance a push brought (design.md D3) ----

test("A pushed balance replaces the one the phone keeps, with only its three fields", async () => {
  // The phone keeps a balance read earlier than the pushed one.
  await phoneKeeps(EARLIER);
  // A balance with a field more than the three, which the phone must not keep.
  const pushed = { ...LATER, currency: "EUR" };

  await keepNotificationBalance(pushed);

  expect(await keptBalance(), "kept where D4 names it").toEqual(LATER);
  expect(await loadStoredBalance()).toEqual(LATER);
});

/** A balance of `amount` EUR read at `readAt` (as written, offset and all), at C13's rate. Made up. */
function readAtTime(amount: number, readAt: string): Balance {
  return { amount, readAt, czkPerEur: 24.3 };
}

test("A pushed balance read earlier than the kept one leaves the kept one", async () => {
  const cases: [string, { kept: Balance; pushed: Balance }][] = [
    [
      "two hours earlier",
      {
        kept: readAtTime(286.4, "2026-11-10T08:58:00+00:00"),
        pushed: readAtTime(250, "2026-11-10T06:58:00+00:00"),
      },
    ],
    [
      "a millisecond earlier",
      {
        kept: readAtTime(286.4, "2026-11-10T08:58:00+00:00"),
        pushed: readAtTime(250, "2026-11-10T08:57:59.999+00:00"),
      },
    ],
  ];

  for (const [name, { kept, pushed }] of cases) {
    await phoneKeeps(kept);

    await keepNotificationBalance(pushed);

    expect(await keptBalance(), name).toEqual(kept);
  }
});

test("A pushed balance read at the same moment as the kept one replaces it", async () => {
  // Another amount at the same read time, so the test can see which one the phone keeps.
  await phoneKeeps(readAtTime(286.4, "2026-11-10T08:58:00+00:00"));
  const pushed = readAtTime(301.9, "2026-11-10T08:58:00+00:00");

  await keepNotificationBalance(pushed);

  expect(await keptBalance()).toEqual(pushed);
});

test("Read times are compared as moments, whatever their offsets", async () => {
  // Which balance the phone keeps afterwards: the pushed one (replaced) or the one it kept (left).
  const cases: [
    string,
    { kept: Balance; pushed: Balance; keeps: "pushed" | "kept" },
  ][] = [
    [
      // 08:58 UTC both: the same moment, so it replaces (as at the same moment with one offset).
      "the same moment, two offsets",
      {
        kept: readAtTime(286.4, "2026-11-10T09:58:00+01:00"),
        pushed: readAtTime(301.9, "2026-11-10T08:58:00+00:00"),
        keeps: "pushed",
      },
    ],
    [
      // 08:58 UTC pushed against 08:30 UTC kept: read later, though its text sorts before the kept one's.
      "read later, its text sorting earlier",
      {
        kept: readAtTime(286.4, "2026-11-10T09:30:00+01:00"),
        pushed: readAtTime(301.9, "2026-11-10T08:58:00+00:00"),
        keeps: "pushed",
      },
    ],
    [
      // 08:30 UTC pushed against 08:58 UTC kept: read earlier, though its text sorts after the kept one's.
      "read earlier, its text sorting later",
      {
        kept: readAtTime(286.4, "2026-11-10T08:58:00+00:00"),
        pushed: readAtTime(250, "2026-11-10T09:30:00+01:00"),
        keeps: "kept",
      },
    ],
  ];

  for (const [name, { kept, pushed, keeps }] of cases) {
    await phoneKeeps(kept);

    await keepNotificationBalance(pushed);

    expect(await keptBalance(), name).toEqual(
      keeps === "pushed" ? pushed : kept,
    );
  }
});

// A push only replaces, never creates (design.md D3, D7 gap 1): each pushed balance below is read later than any read
// time the phone holds, so only that rule keeps it out.

/** A pushed balance read later than every read time in these tests' records. Made up. */
const PUSHED_LATEST = readAtTime(301.9, "2026-11-10T09:00:00+00:00");

test("A pushed balance is not stored on a phone that keeps none", async () => {
  // A second push finds what the first left behind, which must read as nothing kept too (design.md D3).
  for (const push of ["the first push", "a second push"]) {
    await keepNotificationBalance(PUSHED_LATEST);

    expect(await keptBalance(), push).toBeNull();
    expect(await loadStoredBalance(), push).toBeNull();
  }
});

test.each(wrongShapes)(
  "A pushed balance is not stored over a kept record of the wrong shape: $label",
  async ({ record }) => {
    await phoneKeepsRecord(record);

    await keepNotificationBalance(PUSHED_LATEST);

    expect(await keptBalance(), "the record, exactly as it was").toEqual(
      record,
    );
  },
);

test("A balance forgotten when a login ended is not written back by a later push", async () => {
  // The page's read keeps a balance; the login ends and the app forgets it; then a push arrives (design.md D7 gap 1).
  await storeBalance(EARLIER);
  await forgetStoredBalance();

  await keepNotificationBalance(LATER);

  expect(await keptBalance()).toBeNull();
  expect(await loadStoredBalance()).toBeNull();
});

// Never rejects (design.md D3, D4): the push event's work is `keepNotificationBalance`'s promise, so on every failing store
// C7a's table builds it resolves, neither rejecting nor throwing at once.
test.each(failingStores)(
  "A failing store never makes the push event's work reject where the browser shows its own notification: keeping a pushed balance resolves, $label",
  async ({ module }) => {
    // The phone keeps a balance read earlier, so on a working store the push would replace it.
    await phoneKeeps(EARLIER);
    const stored = await module();
    const restore = phoneStorageFails();
    try {
      await expect(stored.keepNotificationBalance(LATER)).resolves.toBe(false);
    } finally {
      restore();
    }
  },
);

// ---- c019: a notification's balance, whatever brought it (design.md D6) ----

test("keepNotificationBalance resolves whether it replaced", async () => {
  const cases: {
    label: string;
    before: () => Promise<void>;
    keeping: Balance;
    replaced: boolean;
  }[] = [
    {
      label: "read later than the kept one",
      before: () => phoneKeeps(EARLIER),
      keeping: LATER,
      replaced: true,
    },
    {
      label: "read at the same moment as the kept one",
      before: () => phoneKeeps(readAtTime(286.4, "2026-11-10T08:58:00+00:00")),
      keeping: readAtTime(301.9, "2026-11-10T09:58:00+01:00"),
      replaced: true,
    },
    {
      label: "read earlier than the kept one",
      before: () => phoneKeeps(LATER),
      keeping: EARLIER,
      replaced: false,
    },
    {
      label: "a phone that keeps none",
      before: () => forgetStoredBalance(),
      keeping: LATER,
      replaced: false,
    },
    {
      label: "a kept record of the wrong shape",
      before: () =>
        phoneKeepsRecord({ amount: "250.00", readAt: EARLIER.readAt }),
      keeping: LATER,
      replaced: false,
    },
  ];

  for (const { label, before, keeping, replaced } of cases) {
    await before();

    expect(await keepNotificationBalance(keeping), label).toBe(replaced);
  }
});

// A new phone (code review of PR #59, finding 12): every other test starts with the kit's database already there
// (`emptyThePhone`), so here the storage starts from a phone with no database at all, and the app's own storage code
// creates it, as on a first launch. A fresh copy of the module (and of idb-keyval) opens against the new phone.
test("On a phone with no database yet, a stored balance loads back, kept where D4 names it", async () => {
  const phone = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    vi.resetModules();
    const stored = await import("./storedBalance");

    await stored.storeBalance(LATER);

    expect(await stored.loadStoredBalance()).toEqual(LATER);
    expect(await keptBalance(), "kept where D4 names it").toEqual(LATER);
  } finally {
    globalThis.indexedDB = phone;
  }
});
