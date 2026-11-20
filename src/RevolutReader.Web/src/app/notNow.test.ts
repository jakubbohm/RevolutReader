import { expect, test } from "vitest";
import { NOT_NOW_KEY, notNowRemembered, rememberNotNow } from "./notNow";

// The remembered "Teď ne" (c012 design.md D5; § Error model): kept on the device in `localStorage` (jsdom's, emptied
// before every test by setup.ts), under a key that is hard to change once shipped. A failing storage (a private window,
// storage blocked) reads as not remembered, and a failed write is ignored.

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
  return new DOMException("The storage failed.", "QuotaExceededError");
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

test('"Teď ne" remembered on the device reads back as remembered', () => {
  expect(notNowRemembered(), "nothing remembered at first").toBe(false);

  rememberNotNow();

  expect(notNowRemembered()).toBe(true);
  expect(
    localStorage.getItem(NOT_NOW_KEY),
    "kept on the device under its key (D5)",
  ).toBe("1");
});

test("A storage that fails to read counts as not remembered", () => {
  expect(notNowRemembered(new FailingStorage()), "a failing storage").toBe(
    false,
  );

  localStorage.setItem(NOT_NOW_KEY, "1");
  withStorageBlocked(() => {
    expect(notNowRemembered(), "storage blocked").toBe(false);
  });
});

test("A storage that fails to write is ignored", () => {
  expect(() => {
    rememberNotNow(new FailingStorage());
  }, "a failing storage").not.toThrow();

  withStorageBlocked(() => {
    expect(() => {
      rememberNotNow();
    }, "storage blocked").not.toThrow();
  });
});
