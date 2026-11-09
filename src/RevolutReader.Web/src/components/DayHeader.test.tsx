import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { dayTotals } from "../app/transactionList";
import { transaction } from "../test/server";
import { DayHeader } from "./DayHeader";

// A day's heading with the day's totals (c010 design.md D14, design system DayHeader): each total shown and spoken
// ("Příchozí …", "Odchozí …"), and left out when it is zero. The totals are counted by `dayTotals`, as the list counts
// them. Amounts are written as on the screen; every kind of space reads as one. The transactions are made up; "now" is a
// wall-clock time on the phone (months from 0: 10 is November).

const NOW = new Date(2026, 10, 20, 10, 0);
const YESTERDAY = "2026-11-19";

/** An amount of zero, as a total would show it ("0,00"); "50,00" and "1 000,00" are not. */
const ZERO_AMOUNT = /(?<!\d)0,00/;

test("A total of zero is left out", () => {
  const received = render(
    <DayHeader
      date={YESTERDAY}
      now={NOW}
      totals={dayTotals([transaction("topup", 50, YESTERDAY)])}
    />,
  );

  expect(received.container).toHaveTextContent("Příchozí 50,00 €");
  expect(received.container).not.toHaveTextContent("Odchozí");
  expect(received.container.textContent).not.toMatch(ZERO_AMOUNT);
  received.unmount();

  const spent = render(
    <DayHeader
      date={YESTERDAY}
      now={NOW}
      totals={dayTotals([
        transaction("card", -3.8, YESTERDAY, {
          counterparty: "Trafika Můstek",
        }),
      ])}
    />,
  );

  expect(spent.container).toHaveTextContent("Odchozí 3,80 €");
  expect(spent.container).not.toHaveTextContent("Příchozí");
  expect(spent.container.textContent).not.toMatch(ZERO_AMOUNT);
});
