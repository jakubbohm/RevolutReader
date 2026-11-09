import { act } from "@testing-library/react";

/**
 * The phone's scrolling, as the app's tests see it (c010 design.md D12): jsdom lays nothing out and has no
 * `IntersectionObserver`, so `setup.ts` installs this stand-in once, before any module of the app loads, and
 * `resetIntersectionObservers` forgets its observers after every test.
 *
 * An observer the app makes keeps the elements it observes, and reports nothing by itself: an observed element counts
 * as out of view until the test scrolls (`scrollToEnd`). Then every observed element comes into view at once, as the end
 * of a short list does, and each observer hears of its own elements in one call, inside `act`. The options the app gives
 * (`rootMargin`, `threshold`) are kept as given and change nothing.
 */

/** Every observer the app made in this test, in the order made. */
let observers: StandInIntersectionObserver[] = [];

/**
 * The user scrolls to the end of the list: every element an observer watches comes into view, and each observer hears
 * of its own elements as intersecting. An observer that watches nothing (disconnected, or never told to observe) hears
 * nothing. On the test clock (./clock.ts), `timePasses(0)` then lets the app's requests be answered.
 */
export function scrollToEnd(): void {
  act(() => {
    for (const observer of [...observers]) observer.reportAllInView();
  });
}

/** Puts the stand-in in place of the environment's `IntersectionObserver`. Called once, by `setup.ts`. */
export function installIntersectionObserver(): void {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: StandInIntersectionObserver,
  });
}

/** Forgets this test's observers. Called by `setup.ts` after every test. */
export function resetIntersectionObservers(): void {
  observers = [];
}

class StandInIntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];
  private readonly callback: IntersectionObserverCallback;
  private readonly targets = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px 0px 0px 0px";
    const threshold = options.threshold ?? 0;
    this.thresholds = Array.isArray(threshold) ? [...threshold] : [threshold];
    observers.push(this);
  }

  observe(target: Element): void {
    this.targets.add(target);
  }

  unobserve(target: Element): void {
    this.targets.delete(target);
  }

  disconnect(): void {
    this.targets.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  /** Reports every observed element as fully in view, in one call; nothing when it observes none. */
  reportAllInView(): void {
    if (this.targets.size === 0) return;

    const entries = [...this.targets].map((target) => inView(target));
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

/** An entry for `target`, fully in view now. */
function inView(target: Element): IntersectionObserverEntry {
  const bounds = target.getBoundingClientRect();

  return {
    target,
    isIntersecting: true,
    intersectionRatio: 1,
    boundingClientRect: bounds,
    intersectionRect: bounds,
    rootBounds: null,
    time: performance.now(),
  } as IntersectionObserverEntry;
}
