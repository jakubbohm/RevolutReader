import { expect, test } from "vitest";
import {
  watchForUpdates,
  type Network,
  type Page,
  type UpdatableRegistration,
} from "./updates";

/** A service worker registration that counts the update checks asked of it; a check fails while `failing` is set. */
class FakeRegistration implements UpdatableRegistration {
  checks = 0;
  failing = false;

  update(): Promise<unknown> {
    this.checks += 1;
    return this.failing
      ? Promise.reject(new Error("The update check failed"))
      : Promise.resolve(undefined);
  }
}

/** A page that is on the screen until the test sends the app to the background or brings it back. */
class FakePage implements Page {
  visibilityState: DocumentVisibilityState = "visible";
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.listeners.delete(listener);
  }

  goesToTheBackground(): void {
    this.becomes("hidden");
  }

  comesBackToTheScreen(): void {
    this.becomes("visible");
  }

  private becomes(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    for (const listener of [...this.listeners]) listener();
  }
}

/** The app leaves the screen and comes back, as when she switches to another app and returns. */
function leaveAndReturn(page: FakePage): void {
  page.goesToTheBackground();
  page.comesBackToTheScreen();
}

/** The part of Node's `process` that reports a rejected promise nobody handled. The app's types leave Node out. */
interface UnhandledRejections {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
}

/** Node's `process`, where Vitest runs the tests. */
const nodeProcess = (globalThis as unknown as { process: UnhandledRejections })
  .process;

/** One turn of the event loop, not a wait: by then, Node has reported every rejected promise nobody handled. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("An update check runs when the app comes back to the screen", () => {
  const registration = new FakeRegistration();
  const page = new FakePage();
  watchForUpdates(registration, page, { onLine: true });

  leaveAndReturn(page);
  expect(registration.checks).toBe(1);

  leaveAndReturn(page);
  expect(registration.checks).toBe(2);
});

test("No update check runs while the phone is offline", () => {
  const registration = new FakeRegistration();
  const page = new FakePage();
  const network: Network = { onLine: false };
  watchForUpdates(registration, page, network);

  leaveAndReturn(page);
  expect(registration.checks).toBe(0);

  network.onLine = true;
  leaveAndReturn(page);
  expect(registration.checks).toBe(1);
});

test("No update check runs when the app goes to the background", () => {
  const registration = new FakeRegistration();
  const page = new FakePage();
  watchForUpdates(registration, page, { onLine: true });

  page.goesToTheBackground();

  expect(registration.checks).toBe(0);
});

test("A failed update check is ignored until the next return", async () => {
  const registration = new FakeRegistration();
  const page = new FakePage();
  const unhandled: unknown[] = [];
  const recordUnhandled = (reason: unknown) => unhandled.push(reason);
  nodeProcess.on("unhandledRejection", recordUnhandled);
  try {
    watchForUpdates(registration, page, { onLine: true });

    registration.failing = true;
    expect(() => leaveAndReturn(page)).not.toThrow();
    await nextTurn();
    expect(unhandled).toEqual([]);
    expect(registration.checks).toBe(1);

    registration.failing = false;
    leaveAndReturn(page);
    expect(registration.checks).toBe(2);
  } finally {
    nodeProcess.off("unhandledRejection", recordUnhandled);
  }
});

test("No update check runs after the watch stops", () => {
  const registration = new FakeRegistration();
  const page = new FakePage();
  const stop = watchForUpdates(registration, page, { onLine: true });
  leaveAndReturn(page);
  expect(registration.checks).toBe(1);

  stop();
  leaveAndReturn(page);

  expect(registration.checks).toBe(1);
});
