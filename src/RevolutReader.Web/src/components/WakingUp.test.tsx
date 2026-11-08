import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
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
