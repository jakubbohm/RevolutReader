import { useLayoutEffect, useRef, type RefObject } from "react";

// The one clock of every motion that says the app is waiting for the server (c019 design.md D9): the waking-up bar and
// the waiting balance's shine, each in the document timeline's phase of `--duration-wait`.

/** `--duration-wait` in `theme.css`: one cycle of the wait clock. */
const WAIT_CYCLE_MS = 1500;

/**
 * The negative delay that puts a `--duration-wait` animation starting now in the document timeline's phase:
 * `-(now mod 1500) ms`, `now` being `document.timeline.currentTime` when not given. Every such animation then starts at
 * the timeline's zero, whichever mounted first (D9: a delay rather than the design's pinned `startTime`, which WebKit
 * settles only on the next frame).
 */
export function waitClockDelay(now: number = documentTime()): string {
  return `${-(now % WAIT_CYCLE_MS)}ms`;
}

/** The document timeline's current time in milliseconds; 0 while it has none (an inactive timeline). */
function documentTime(): number {
  const time = document.timeline.currentTime;
  return typeof time === "number" ? time : 0;
}

/**
 * A ref whose element gets `waitClockDelay()` as its animation delay each time `active` turns on (a layout effect, so
 * before the animation's first frame), never recomputed while it stays on, since a changed delay would shift a running
 * animation. When `active` turns off the delay goes, so the element's next animation (e.g. `amount-live`'s settle)
 * runs from its start.
 */
export function useWaitClock<T extends HTMLElement>(
  active: boolean,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    element.style.animationDelay = active ? waitClockDelay() : "";
  }, [active]);

  return ref;
}
