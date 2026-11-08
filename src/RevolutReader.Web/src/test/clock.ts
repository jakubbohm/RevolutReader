import userEvent, { type UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";

/**
 * The test's clock (c009 design.md D8, § Risks), for scenarios that wait: the 1.5 s, 30 s and 60 s marks, the 4-minute
 * keep-alive, the 30 idle minutes, and times shown relative to now ("před 2 min"). Vitest's fake timers drive
 * `setTimeout`, `setInterval` and `Date`; nothing else is faked, so React's own scheduling, the fake IndexedDB and the
 * fake server's immediate answers keep running on the real event loop (`realTurn`) without the clock moving.
 *
 * Using it:
 * - `startTestClock()` first in the test; `setup.ts` stops it after every test.
 * - `timePasses(ms)` moves the clock on and lets the app answer in between; `timePasses(0)` lets what is due now
 *   happen (answers already on their way, renders) without moving the clock.
 * - Read the screen with `getBy…`/`queryBy…` after `timePasses`. `findBy…` and `waitFor` move the clock themselves on
 *   it, in 50 ms steps, so a scenario that states a time does not use them.
 * - Tap with `userOnTheTestClock()`.
 */

/** The instant every test clock starts at: a fixed day, so a test never depends on when it runs. */
export const TEST_CLOCK_START = new Date("2026-11-10T09:00:00Z");

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** Real turns of the event loop that `timePasses` gives the app after each step: enough for a render, its effects and an answer. */
const TURNS_TO_SETTLE = 50;

/** Node's `setImmediate`, taken before any test fakes timers; the test clock never fakes it. */
const nodeSetImmediate = (
  globalThis as unknown as {
    setImmediate: (callback: () => void) => unknown;
  }
).setImmediate;

/**
 * One turn of the real event loop, which the test clock does not move: the fake server delivers an immediate answer on
 * one, so it reaches the app later than at once, whether the test clock runs or not.
 */
export function realTurn(): Promise<void> {
  return new Promise((resolve) => {
    nodeSetImmediate(resolve);
  });
}

/**
 * Starts the test's clock at `start`: fake `setTimeout`, `setInterval` and `Date`. Testing Library learns of it through
 * the `jest` object it looks for, so its event wrapper (and `userOnTheTestClock`'s taps) can finish on a stopped
 * clock; without it, a tap would wait forever for a timer of its own.
 */
export function startTestClock(start: Date = TEST_CLOCK_START): void {
  vi.useFakeTimers({
    now: start,
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  testingLibraryGlobals().jest = {
    advanceTimersByTime: (ms: number) => {
      vi.advanceTimersByTime(ms);
    },
  };
}

/** Stops the test's clock, if it runs. `setup.ts` calls it after every test. */
export function stopTestClock(): void {
  vi.useRealTimers();
  delete testingLibraryGlobals().jest;
}

/**
 * The test's clock moves on by `ms`, one timer at a time: each timer due on the way fires at its own time, and the app
 * gets real turns after each (its renders, effects, storage and the fake server's answers), so a timer the app starts in
 * response starts at the right time. Ends exactly `ms` later, after the timers due then. Only on the test clock.
 */
export async function timePasses(ms: number): Promise<void> {
  if (!vi.isFakeTimers())
    throw new Error(
      "timePasses needs the test clock: call startTestClock() first.",
    );

  const reactGlobals = globalThis as unknown as {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const actEnvironment = reactGlobals.IS_REACT_ACT_ENVIRONMENT;
  // As Testing Library's own waiting does: React renders on its own schedule, not inside act(), while time passes.
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const until = Date.now() + ms;
    // A timer of the clock's own at the end, so stepping to the next timer never steps past it.
    const end = setTimeout(() => {}, ms);
    await settle();
    while (Date.now() < until) {
      await vi.advanceTimersToNextTimerAsync();
      await settle();
    }
    clearTimeout(end);
    // What became due at the end, also through what the app did in its last turns.
    for (let round = 0; round < 3; round += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await settle();
    }
  } finally {
    reactGlobals.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
  }
}

/** A moment `ms` before now on the test clock (or the real one, without it). */
export function ago(ms: number): Date {
  return new Date(Date.now() - ms);
}

/**
 * A user who taps and types on the test clock: user-event's own pauses move it (`advanceTimers`), so a tap never waits
 * on a stopped clock. Only after `startTestClock()`.
 */
export function userOnTheTestClock(): UserEvent {
  return userEvent.setup({
    advanceTimers: (ms) => {
      vi.advanceTimersByTime(ms);
    },
  });
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < TURNS_TO_SETTLE; turn += 1) await realTurn();
}

/** The global Testing Library checks for Jest's fake timers (`jest.advanceTimersByTime`), which Vitest's equal. */
function testingLibraryGlobals(): {
  jest?: { advanceTimersByTime: (ms: number) => void };
} {
  return globalThis as unknown as {
    jest?: { advanceTimersByTime: (ms: number) => void };
  };
}
