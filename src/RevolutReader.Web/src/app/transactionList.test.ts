import { expect, test } from "vitest";
import { transaction } from "../test/server";
import { byDay, dayTotals } from "./transactionList";

// The list by day (c010 design.md D1, D14): the transactions grouped by their date in the answer's order, each day with
// its totals in whole cents. Amounts are signed euros as the API answers them (negative for money spent); the
// transactions are made up.

test("Transactions group by their date, in the answer's order", () => {
  // Within a day the answer's order is the bank's; nothing here sorts by amount or name.
  const pocketMoney = transaction("transfer", 50, "2026-11-20", {
    counterparty: "Táta",
  });
  const kiosk = transaction("card", -3.8, "2026-11-20", {
    counterparty: "Trafika Můstek",
  });
  const topUp = transaction("topup", 20, "2026-11-19");
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
  });

  expect(byDay([pocketMoney, kiosk, topUp, bakery])).toEqual([
    {
      date: "2026-11-20",
      transactions: [pocketMoney, kiosk],
      totals: dayTotals([pocketMoney, kiosk]),
    },
    { date: "2026-11-19", transactions: [topUp], totals: dayTotals([topUp]) },
    {
      date: "2026-11-18",
      transactions: [bakery],
      totals: dayTotals([bakery]),
    },
  ]);
});

test("A day's totals sum money received and refunds as received, payments as spent, pending ones included, in whole cents", () => {
  const totals = dayTotals([
    transaction("card", -12.3, "2026-11-19", {
      counterparty: "Pekárna U Lípy",
    }),
    transaction("card", -3.8, "2026-11-19", {
      counterparty: "Trafika Můstek",
      pending: true,
    }),
    transaction("topup", 50, "2026-11-19"),
    transaction("refund", 5.95, "2026-11-19", {
      counterparty: "Lékárna Benu",
    }),
    transaction("transfer", 0.1, "2026-11-19", { counterparty: "Táta" }),
    transaction("transfer", 0.2, "2026-11-19", { counterparty: "Táta" }),
  ]);

  // Received 50.00 + 5.95 + 0.10 + 0.20 = 56.25 (56.25000000000001 when added up as euros); spent 12.30 + 3.80 = 16.10.
  expect(totals).toEqual({ incoming: 5625, outgoing: 1610 });
});
