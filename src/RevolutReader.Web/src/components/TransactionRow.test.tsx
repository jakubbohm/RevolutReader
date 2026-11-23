import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { transaction } from "../test/server";
import { inTimeZone } from "../test/timeZone";
import { TransactionRow } from "./TransactionRow";

// A transaction's row (c018 design.md D6): the approximate time shows in the sheet only; the row and its spoken label
// stay as they were (the owner, 2026-11-22). The transaction is made up; the rate is C13's.

const RATE = 24.3;

/** A time of day as the app writes one (`0:20`, `14:05`), or the word that leads the approximate time. */
const A_TIME = /kolem|\d:\d\d/;

test("The row and its spoken label show no time", () => {
  inTimeZone("Europe/Prague", () => {
    const bakery = transaction("card", -12.3, "2026-11-18", {
      counterparty: "Pekárna U Lípy",
      details: ["Praha 2"],
      seenAt: "2026-11-18T13:05:12+00:00",
    });

    render(<TransactionRow tx={bakery} rate={RATE} onSelect={() => {}} />);

    // 12.30 × 24.3 = 298.89; the label is the row's sentence as without a time, every kind of space read as one.
    const row = screen.getByRole("button", {
      name: (name) =>
        name.replace(/\s+/g, " ") ===
        "Pekárna U Lípy, Praha 2, −12,30 €, přibližně 299 Kč",
    });
    expect(row.textContent, "what the row shows").not.toMatch(A_TIME);
  });
});
