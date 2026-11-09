import { expect, test } from "vitest";
import { transaction } from "../test/server";
import { formatAmount } from "./format";
import { rowLabel, rowLines } from "./transactionText";
import type { TransactionKind } from "./transactions";

// What a transaction's row says (c010 design.md D4, D6, D14): its two lines, its amount and the sentence a screen reader
// reads. `details` are the bank's lines as the API answers them, already without the one that repeats the counterparty.
// Amounts are written as on the screen, with U+2212 for a minus sign; every kind of space reads as one. The
// transactions are made up; the rate is C13's.

const RATE = 24.3;

/** The text with every run of spaces, no-break ones included, read as one plain space. */
function spaced(text: string): string {
  return text.replace(/\s+/g, " ");
}

test("A row's first line is the counterparty", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
    details: ["Praha 2"],
  });
  const pocketMoney = transaction("transfer", 20, "2026-11-18", {
    counterparty: "Táta",
    details: ["Kapesné na listopad"],
  });

  expect(rowLines(bakery).first).toBe("Pekárna U Lípy");
  expect(rowLines(pocketMoney).first).toBe("Táta");
});

test(`A row's second line is the details joined by " · "`, () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
    details: ["Praha 2"],
  });
  const course = transaction("transfer", -180, "2026-11-18", {
    counterparty: "Jazyková škola Polyglot",
    details: ["Kurz angličtiny B1", "1. pololetí 2026/27", "Ref. 2026-1147"],
  });

  expect(rowLines(bakery).second).toBe("Praha 2");
  expect(rowLines(course).second).toBe(
    "Kurz angličtiny B1 · 1. pololetí 2026/27 · Ref. 2026-1147",
  );
});

test("An amount in another currency shows with its code and no koruna value", () => {
  const coffee = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Coffee Corner",
    details: ["New York"],
    currency: "USD",
  });

  expect(spaced(formatAmount(-12.3, "USD"))).toBe("−12,30 USD");
  // The row says what it shows: the amount with its code, and no koruna value after it.
  expect(spaced(rowLabel(coffee, RATE))).toBe(
    "Coffee Corner, New York, −12,30 USD",
  );
});

test("A row's spoken label is its whole sentence, without a time", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
    details: ["Praha 2"],
  });

  // 12.30 × 24.3 = 298.89
  expect(spaced(rowLabel(bakery, RATE))).toBe(
    "Pekárna U Lípy, Praha 2, −12,30 €, přibližně 299 Kč",
  );
});

// ---- The kind's words (D4b) ----

test(`Each known kind has its word: "Platba kartou", "Dobití účtu", "Převod", "Výběr z bankomatu", "Směna měny", "Vrácení peněz"`, () => {
  // A transaction without a counterparty shows its kind's word as its first line; the detail keeps the second line the
  // bank's.
  const firstLineOf = (kind: TransactionKind, amount: number) =>
    rowLines(
      transaction(kind, amount, "2026-11-18", { details: ["Ref. 2026-0042"] }),
    ).first;

  expect({
    card: firstLineOf("card", -4.5),
    topup: firstLineOf("topup", 50),
    transfer: firstLineOf("transfer", -20),
    atm: firstLineOf("atm", -40),
    exchange: firstLineOf("exchange", -100),
    refund: firstLineOf("refund", 5.95),
  }).toEqual({
    card: "Platba kartou",
    topup: "Dobití účtu",
    transfer: "Převod",
    atm: "Výběr z bankomatu",
    exchange: "Směna měny",
    refund: "Vrácení peněz",
  });
});

test("Without details, a row's second line is the kind's word", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
  });
  const pocketMoney = transaction("transfer", 20, "2026-11-18", {
    counterparty: "Táta",
  });

  expect(rowLines(bakery)).toEqual({
    first: "Pekárna U Lípy",
    second: "Platba kartou",
  });
  expect(rowLines(pocketMoney)).toEqual({ first: "Táta", second: "Převod" });
});

test("Without a counterparty, a row's first line is the kind's word", () => {
  const cash = transaction("atm", -40, "2026-11-18", {
    details: ["Bankomat Anděl"],
  });

  expect(rowLines(cash)).toEqual({
    first: "Výběr z bankomatu",
    second: "Bankomat Anděl",
  });
});

test("Without a counterparty or details, the kind's word is not repeated on the second line", () => {
  const payment = transaction("card", -4.5, "2026-11-18");

  // The first line alone; the spoken label says the word once too. 4.50 × 24.3 = 109.35
  expect(rowLines(payment)).toEqual({ first: "Platba kartou", second: null });
  expect(spaced(rowLabel(payment, RATE))).toBe(
    "Platba kartou, −4,50 €, přibližně 109 Kč",
  );
});

test(`The kind other is "Příchozí platba" for money received and "Odchozí platba" for money spent`, () => {
  const received = transaction("other", 20, "2026-11-18");
  const spent = transaction("other", -15, "2026-11-18", {
    details: ["Ref. 2026-0043"],
  });

  expect(rowLines(received).first).toBe("Příchozí platba");
  expect(rowLines(spent).first).toBe("Odchozí platba");
});
