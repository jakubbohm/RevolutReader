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

type StoredBalanceModule = typeof import("./storedBalance");

const failingStores: {
  label: string;
  module: () => Promise<StoredBalanceModule>;
}[] = [
  {
    // Used once while it works, as the app does at start, so a storage that keeps its connection has one open.
    label: "a store used before, its connection open",
    module: async () => {
      await loadStoredBalance();
      return { loadStoredBalance, storeBalance, forgetStoredBalance };
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
