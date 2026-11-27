import { expect, test } from "vitest";
import { removeSpikeLeftovers } from "./leftovers";
import { NOT_NOW_KEY } from "./notNow";

// The spike's leftover record (c019 design.md D11): `localStorage["tarjeta-papa.notification-test.record"]`, removed at
// every start, and nothing else; a storage that fails is ignored. The storage is jsdom's, emptied before every test by
// setup.ts. The record's contents are made up.

const SPIKE_RECORD = "tarjeta-papa.notification-test.record";

/** A storage that fails at everything, as a full or blocked one does. */
class FailingStorage implements Storage {
  get length(): number {
    throw failure();
  }

  clear(): void {
    throw failure();
  }

  getItem(): string | null {
    throw failure();
  }

  key(): string | null {
    throw failure();
  }

  removeItem(): void {
    throw failure();
  }

  setItem(): void {
    throw failure();
  }
}

function failure(): DOMException {
  return new DOMException("The storage failed.", "SecurityError");
}

/**
 * Runs `work` while the page cannot reach `localStorage` at all: reading `window.localStorage` throws, as a browser
 * with storage blocked does; restored afterwards.
 */
function withStorageBlocked(work: () => void): void {
  const own = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("Access is denied.", "SecurityError");
    },
  });
  try {
    work();
  } finally {
    if (own === undefined)
      delete (globalThis as { localStorage?: Storage }).localStorage;
    else Object.defineProperty(globalThis, "localStorage", own);
  }
}

test("removeSpikeLeftovers removes tarjeta-papa.notification-test.record and nothing else", () => {
  localStorage.setItem(
    SPIKE_RECORD,
    '{"notifications":[{"at":"2026-11-26T10:00:00Z"}]}',
  );
  localStorage.setItem(NOT_NOW_KEY, "remembered");
  localStorage.setItem("tarjeta-papa.notification-test.other", "kept");

  removeSpikeLeftovers();

  expect(localStorage.getItem(SPIKE_RECORD), "the spike's record").toBeNull();
  expect(localStorage.getItem(NOT_NOW_KEY), '"Teď ne"').toBe("remembered");
  expect(
    localStorage.getItem("tarjeta-papa.notification-test.other"),
    "another key",
  ).toBe("kept");
  expect(localStorage.length, "only the record gone").toBe(2);

  // On a phone without the record: nothing changes, and nothing fails.
  removeSpikeLeftovers();
  expect(localStorage.length, "nothing more removed").toBe(2);
});

test("A localStorage that throws is ignored", () => {
  expect(
    () => removeSpikeLeftovers(new FailingStorage()),
    "a storage that fails",
  ).not.toThrow();

  withStorageBlocked(() => {
    expect(
      () => removeSpikeLeftovers(),
      "a browser that blocks the storage",
    ).not.toThrow();
  });
});
