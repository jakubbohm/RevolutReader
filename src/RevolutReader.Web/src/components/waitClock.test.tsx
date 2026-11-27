import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { expect, test } from "vitest";
import { documentTimeIs } from "../test/documentTimeline";
import { useWaitClock, waitClockDelay } from "./waitClock";

// The one wait clock (c019 design.md D9): a waiting animation of `--duration-wait` (1500 ms) is put in the document
// timeline's phase by a negative `animation-delay`, `-(t mod 1500) ms`, set on its element once when it turns on and
// never recomputed while it runs, since a changed delay would shift a running animation. The document timeline's time is
// the kit's stand-in (../test/documentTimeline.ts), set per test.

test("waitClockDelay(t) is -(t mod 1500)ms, with document.timeline.currentTime as t by default", () => {
  expect(waitClockDelay(700), "within the first cycle").toBe("-700ms");
  expect(waitClockDelay(4200), "in a later cycle").toBe("-1200ms");
  expect(waitClockDelay(3100.5), "a fraction of a millisecond").toBe(
    "-100.5ms",
  );

  documentTimeIs(6400);
  expect(waitClockDelay(), "the document timeline's time").toBe("-400ms");
});

/** An element that waits while `active`, on the wait clock. */
function Waiting({ active }: { active: boolean }): JSX.Element {
  const ref = useWaitClock<HTMLParagraphElement>(active);
  return <p ref={ref}>Čekám</p>;
}

test("useWaitClock sets the delay on its element when active turns on, and keeps it through renders while it stays on", () => {
  documentTimeIs(3100.5);
  const { unmount } = render(<Waiting active={true} />);
  expect(
    screen.getByText("Čekám").style.animationDelay,
    "on from the mount",
  ).toBe("-100.5ms");
  unmount();

  documentTimeIs(1000);
  const { rerender } = render(<Waiting active={false} />);
  documentTimeIs(4200);
  rerender(<Waiting active={true} />);
  const element = screen.getByText("Čekám");
  expect(element.style.animationDelay, "turned on").toBe("-1200ms");

  documentTimeIs(5000);
  rerender(<Waiting active={true} />);
  expect(element.style.animationDelay, "a render while it stays on").toBe(
    "-1200ms",
  );

  rerender(<Waiting active={false} />);
  documentTimeIs(5300);
  rerender(<Waiting active={true} />);
  expect(element.style.animationDelay, "turned on again").toBe("-800ms");
});
