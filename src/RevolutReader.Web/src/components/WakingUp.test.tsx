import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { documentTimeIs } from "../test/documentTimeline";
import { WakingUp } from "./WakingUp";

// The waking-up screen (design system WakingUp, c009 design.md D10): "Server se probouzí" and its sentence, announced as
// a status, with an indeterminate bar (Radix Progress with no value). Read by role and text, as a screen reader meets it.

test("The waking-up screen is announced as a status, with an indeterminate bar", () => {
  render(<WakingUp slow={false} onRetry={() => {}} />);

  const status = screen.getByRole("status");
  expect(within(status).getByText("Server se probouzí")).toBeInTheDocument();
  expect(
    within(status).getByText(
      "Když ho chvíli nikdo nepoužívá, usne. První načtení trvá asi 20 sekund.",
    ),
  ).toBeInTheDocument();
  const bar = within(status).getByRole("progressbar");
  expect(
    bar,
    "the bar shows no amount: it waits, it does not count",
  ).not.toHaveAttribute("aria-valuenow");
});

// The slow variant (D2, spec app-shell: a slow wake offers to try again), from 30 s without an answer: its sentence, and
// "Zkusit znovu", which asks the server again. The button's secondary look is the design's, not tested here.
test('The slow waking-up screen offers "Zkusit znovu" as a secondary button', async () => {
  let retries = 0;
  render(
    <WakingUp
      slow={true}
      onRetry={() => {
        retries += 1;
      }}
    />,
  );
  const user = userEvent.setup();

  expect(screen.getByText("Server se probouzí")).toBeInTheDocument();
  expect(
    screen.getByText(
      "Trvá to déle než obvykle. Zkontroluj připojení, nebo to zkus znovu.",
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Zkusit znovu" }));
  expect(retries).toBe(1);
});

// c019 design.md D9: the bar runs on the one wait clock (./waitClock.ts), `animate-wait-bar` with the document
// timeline's phase set as its delay when it mounts, kept while it runs; the time is the kit's stand-in.
test("WakingUp's bar runs animate-wait-bar with the delay set at mount", () => {
  documentTimeIs(4200);
  const { rerender } = render(<WakingUp slow={false} onRetry={() => {}} />);
  const bar = screen.getByRole("progressbar").firstElementChild;
  expect(bar, "the bar's moving part").toBeInstanceOf(HTMLElement);
  expect(bar).toHaveClass("animate-wait-bar");
  expect((bar as HTMLElement).style.animationDelay, "at mount").toBe("-1200ms");

  documentTimeIs(5000);
  rerender(<WakingUp slow={true} onRetry={() => {}} />);
  expect(
    (bar as HTMLElement).style.animationDelay,
    "kept through a render",
  ).toBe("-1200ms");
});
