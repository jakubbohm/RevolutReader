import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { KORUNA_RATE, RATE_DATE, transaction } from "../test/server";
import { inTimeZone } from "../test/timeZone";
import type { Transaction } from "../app/transactions";
import { TransactionSheet } from "./TransactionSheet";

// The sheet's "Datum" (c018 design.md D6, design system TransactionSheet): the transaction's day, as the list groups it,
// then, when it has an approximate time, ", kolem" and that time in the phone's local time. The expected text is exact:
// the date holds together with no-break spaces after its dots, as does "kolem" with its time; the comma is followed by
// a plain space. The transactions are made up; `seenAt` is an instant the API answers in UTC.

const NO_BREAK_SPACE = " ";

test("The sheet's `Datum` is the transaction's day followed by \", kolem\" and the time when there is one", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
    seenAt: "2026-11-18T13:05:12+00:00",
  });
  // Dated the 14th by the bank; 0:20 on the 15th in Prague.
  const transferFromDad = transaction("transfer", 30, "2026-11-14", {
    counterparty: "Táta",
    seenAt: "2026-11-14T23:20:00+00:00",
  });

  inTimeZone("Europe/Prague", () => {
    expect(datumOf(bakery)).toBe(
      `18.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026, kolem${NO_BREAK_SPACE}14:05`,
    );
    expect(datumOf(transferFromDad)).toBe(
      `15.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026, kolem${NO_BREAK_SPACE}0:20`,
    );
  });
  inTimeZone("America/Los_Angeles", () => {
    // 5:05 on the 18th and 15:20 on the 14th there: the day and the time are the phone's.
    expect(datumOf(bakery)).toBe(
      `18.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026, kolem${NO_BREAK_SPACE}5:05`,
    );
    expect(datumOf(transferFromDad)).toBe(
      `14.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026, kolem${NO_BREAK_SPACE}15:20`,
    );
  });
});

test("Without a time, `Datum` is the date alone, as before", () => {
  inTimeZone("Europe/Prague", () => {
    // No time from the API.
    expect(
      datumOf(
        transaction("card", -12.3, "2026-11-18", {
          counterparty: "Pekárna U Lípy",
        }),
      ),
    ).toBe(`18.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026`);
    // A time that does not parse shows none (design.md D6).
    expect(
      datumOf(
        transaction("card", -12.3, "2026-11-18", {
          counterparty: "Pekárna U Lípy",
          seenAt: "kolem poledne",
        }),
      ),
    ).toBe(`18.${NO_BREAK_SPACE}11.${NO_BREAK_SPACE}2026`);
  });
});

/**
 * The text of the open sheet's "Datum" for `tx`, as the sheet shows it: the definition that follows the term "Datum".
 * Renders the sheet in the time zone of the moment, then removes it.
 */
function datumOf(tx: Transaction): string | null {
  const { unmount } = render(
    <TransactionSheet
      tx={tx}
      rate={KORUNA_RATE}
      rateDate={RATE_DATE}
      open
      onOpenChange={() => {}}
    />,
  );
  try {
    const sheet = screen.getByRole("dialog");
    const terms = within(sheet).getAllByRole("term");
    const definitions = within(sheet).getAllByRole("definition");
    const datum = terms.findIndex((term) => term.textContent === "Datum");
    expect(datum, 'the sheet has a "Datum"').toBeGreaterThanOrEqual(0);

    return definitions[datum]?.textContent ?? null;
  } finally {
    unmount();
  }
}
