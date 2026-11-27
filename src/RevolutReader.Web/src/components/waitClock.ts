import type { RefObject } from "react";

// The one clock of every motion that says the app is waiting for the server (c019 design.md D9): the waking-up bar and
// the waiting balance's shine, each in the document timeline's phase of `--duration-wait`.

/** The negative delay that puts a `--duration-wait` animation starting now in the document timeline's phase. */
export function waitClockDelay(now?: number): string {
  void now;
  throw new Error("Not implemented: waitClockDelay (c019 design.md D9)");
}

/** A ref whose element gets `waitClockDelay()` as its animation delay each time `active` turns on (a layout effect). */
export function useWaitClock<T extends HTMLElement>(
  active: boolean,
): RefObject<T | null> {
  void active;
  throw new Error("Not implemented: useWaitClock (c019 design.md D9)");
}
