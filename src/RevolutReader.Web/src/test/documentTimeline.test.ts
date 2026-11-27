import { expect, test } from "vitest";
import { documentTimeIs, resetDocumentTimeline } from "./documentTimeline";

// The kit's own check of the document timeline's stand-in (./documentTimeline.ts): the page's `performance.now()` by
// default, as in a browser; the time a test sets, until the reset after the test.

test("The document timeline reads the page's performance.now() unless a test sets its time", () => {
  const before = performance.now();
  const read = document.timeline.currentTime;
  const after = performance.now();
  expect(typeof read, "a number of milliseconds").toBe("number");
  expect(read as number).toBeGreaterThanOrEqual(before);
  expect(read as number).toBeLessThanOrEqual(after);

  documentTimeIs(4200);
  expect(document.timeline.currentTime, "the time set").toBe(4200);
  documentTimeIs(5300.5);
  expect(document.timeline.currentTime, "set again").toBe(5300.5);

  resetDocumentTimeline();
  expect(
    document.timeline.currentTime,
    "after the reset, performance.now() again",
  ).not.toBe(5300.5);
});
