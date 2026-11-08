import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { expect, test } from "vitest";
import { BalanceHeader } from "./BalanceHeader";

// The balance header (design system BalanceHeader, c009 design.md D10): "Na účtu máš" as the page's heading, the amount
// in euros, its koruna value, spoken as "přibližně … Kč", and the freshness line, announced politely when it changes.
// Read by role and text, as a user and a screen reader meet it. The amount is made up; the rate is C13's; times are
// local wall-clock times (months count from 0: 10 is November).

const READ_AT = new Date(2026, 10, 10, 14, 3);
const TWO_MINUTES_LATER = new Date(2026, 10, 10, 14, 5);
const THREE_MINUTES_LATER = new Date(2026, 10, 10, 14, 6);

function header(now: Date = TWO_MINUTES_LATER): JSX.Element {
  return (
    <BalanceHeader
      amount={286.4}
      rate={24.3}
      readAt={READ_AT}
      now={now}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
}

test('The header shows "Na účtu máš" as the page\'s heading, the amount, the koruna value and the freshness line', () => {
  render(header());

  expect(
    screen.getByRole("heading", { level: 1, name: "Na účtu máš" }),
  ).toBeInTheDocument();
  expect(screen.getByText("286,40 €")).toBeInTheDocument();
  expect(screen.getByText("≈ 6 960 Kč")).toBeInTheDocument();
  expect(screen.getByText("Aktualizováno před 2 min")).toBeInTheDocument();
});

test("The koruna value is spoken as přibližně …", () => {
  render(header());

  expect(screen.getByLabelText("přibližně 6 960 Kč")).toHaveTextContent(
    "≈ 6 960 Kč",
  );
});

test("The freshness line is announced politely when it changes", () => {
  const { rerender } = render(header());
  const liveRegion = screen
    .getByText("Aktualizováno před 2 min")
    .closest('[aria-live="polite"]');
  expect(
    liveRegion,
    "the freshness line is in a polite live region",
  ).not.toBeNull();

  rerender(header(THREE_MINUTES_LATER));

  expect(liveRegion).toHaveTextContent("Aktualizováno před 3 min");
});
