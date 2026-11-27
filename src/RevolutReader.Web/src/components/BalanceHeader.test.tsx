import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX } from "react";
import { expect, test } from "vitest";
import type { BalanceState } from "../app/screenState";
import { documentTimeIs } from "../test/documentTimeline";
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

// The refreshing state, as the design system's BalanceHeader draws it (its README and the Screens board "Account /
// Detail / Refreshing"): the line under the koruna value reads "Obnovuji…" in the freshness line's polite live region;
// "Obnovit" keeps its label and is the busy button (Button's loading state: a spinner beside the label, `aria-busy`, taps
// ignored); the amount stays shown.
test('"Obnovit" in the refreshing state reads "Obnovuji…", spins and ignores taps', async () => {
  let refreshes = 0;
  render(
    <BalanceHeader
      amount={286.4}
      rate={24.3}
      readAt={READ_AT}
      now={TWO_MINUTES_LATER}
      refreshing={true}
      onRefresh={() => {
        refreshes += 1;
      }}
    />,
  );
  const user = userEvent.setup();

  expect(
    screen.getByText("Obnovuji…").closest('[aria-live="polite"]'),
    '"Obnovuji…" is announced politely, where the freshness line was',
  ).not.toBeNull();
  expect(screen.getByText("286,40 €")).toBeInTheDocument();
  const refresh = screen.getByRole("button", { name: "Obnovit" });
  expect(refresh, "the button spins: it is busy").toHaveAttribute(
    "aria-busy",
    "true",
  );
  await user.click(refresh);
  expect(refreshes, "the tap is ignored").toBe(0);
});

// c019 design.md D8, D9: whether the balance is live is the header's `state`, written as the amount's class
// (`amount-live`, `amount-waiting`, `amount-stale`) and as `data-balance` on the section, never as text; the koruna line
// and the freshness line stay as they are whatever the state (the design: the koruna line keeps its contrast and does
// not shine). The amount carries exactly one of the three classes.
const states: {
  label: string;
  state: BalanceState | undefined;
  marked: BalanceState;
}[] = [
  { label: "no state given", state: undefined, marked: "live" },
  { label: "live", state: "live", marked: "live" },
  { label: "waiting", state: "waiting", marked: "waiting" },
  { label: "stale", state: "stale", marked: "stale" },
];

/** The header over the made-up balance, with `state` when one is given. */
function headerIn(state: BalanceState | undefined): JSX.Element {
  return (
    <BalanceHeader
      amount={286.4}
      rate={24.3}
      readAt={READ_AT}
      now={TWO_MINUTES_LATER}
      refreshing={false}
      onRefresh={() => {}}
      {...(state === undefined ? {} : { state })}
    />
  );
}

test("BalanceHeader marks the amount and data-balance with its state (default live), and the koruna line and the freshness line do not change with it", () => {
  const lines: { koruna: string; freshness: string }[] = [];

  for (const { label, state, marked } of states) {
    const { unmount } = render(headerIn(state));

    expect(
      screen.getByRole("region", { name: "Na účtu máš" }),
      `${label}: the section's data-balance`,
    ).toHaveAttribute("data-balance", marked);
    const amountClasses = [...screen.getByText("286,40 €").classList].filter(
      (name) => name.startsWith("amount-"),
    );
    expect(amountClasses, `${label}: the amount's state class`).toEqual([
      `amount-${marked}`,
    ]);
    lines.push({
      koruna: screen.getByLabelText("přibližně 6 960 Kč").outerHTML,
      freshness: screen.getByText("Aktualizováno před 2 min").outerHTML,
    });

    unmount();
  }

  for (const [index, { label }] of states.entries())
    expect(
      lines[index],
      `${label}: the koruna line and the freshness line as with no state given`,
    ).toEqual(lines[0]);
});

// c019 design.md D9: the waiting amount's shine runs on the one wait clock (./waitClock.ts), the document timeline's
// phase set as its delay when `waiting` begins and kept while it lasts; the time is the kit's stand-in.
test("BalanceHeader's amount gets the delay when waiting begins", () => {
  documentTimeIs(4200);
  const { rerender } = render(headerIn("stale"));
  const amount = screen.getByText("286,40 €");

  documentTimeIs(5000);
  rerender(headerIn("waiting"));
  expect(amount.style.animationDelay, "waiting begins").toBe("-500ms");

  documentTimeIs(5600);
  rerender(headerIn("waiting"));
  expect(amount.style.animationDelay, "kept while it lasts").toBe("-500ms");
});
