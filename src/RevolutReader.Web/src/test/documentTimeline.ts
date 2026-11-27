/**
 * The document's animation timeline, as the app's tests see it (c019 design.md D9): jsdom has no Web Animations, so no
 * `document.timeline`, which every browser the app supports has. `setup.ts` installs this stand-in once, before any
 * module of the app loads, and `resetDocumentTimeline` puts it back after every test.
 *
 * Its `currentTime` is the page's `performance.now()`, as a browser's is for a page's own document, unless a test sets
 * it with `documentTimeIs`: the wait clock's phase (`components/waitClock.ts`) is then known exactly. The test clock
 * (./clock.ts) does not move it.
 */

/** The time a test set, in milliseconds; null for `performance.now()`. */
let setTime: number | null = null;

/** The document timeline's `currentTime` reads `ms` from now on in this test, until it is set again. */
export function documentTimeIs(ms: number): void {
  setTime = ms;
}

/** Puts the stand-in in place as `document.timeline`. Called once, by `setup.ts`. */
export function installDocumentTimeline(): void {
  Object.defineProperty(document, "timeline", {
    configurable: true,
    value: {
      get currentTime(): number {
        return setTime ?? performance.now();
      },
    },
  });
}

/** Forgets the time this test set. Called by `setup.ts` after every test. */
export function resetDocumentTimeline(): void {
  setTime = null;
}
