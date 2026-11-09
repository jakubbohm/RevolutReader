import { expect, test } from "vitest";
import {
  KORUNA_RATE,
  RATE_DATE,
  transaction,
  type TransactionInApi,
} from "../test/server";
import {
  byDay,
  dayTotals,
  withOlderPage,
  type ListState,
} from "./transactionList";
import type { TransactionPage } from "./transactions";

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

// An older page at the list's end (c010 design.md D1): pages of whole days, the older page's days after the shown ones.

test("An older page's days join the end of the list", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
  });
  const bookshop = transaction("card", -7.5, "2026-10-15", {
    counterparty: "Knihkupectví Luxor",
  });
  const stationery = transaction("card", -2.4, "2026-10-12", {
    counterparty: "Papírnictví Tužka",
  });
  const shown = listOf([bakery], "2026-10-20");

  const next = withOlderPage(
    shown,
    olderPage([bookshop, stationery], "2026-09-30"),
  );

  expect(next.days).toEqual([
    {
      date: "2026-11-18",
      transactions: [bakery],
      totals: dayTotals([bakery]),
    },
    {
      date: "2026-10-15",
      transactions: [bookshop],
      totals: dayTotals([bookshop]),
    },
    {
      date: "2026-10-12",
      transactions: [stationery],
      totals: dayTotals([stationery]),
    },
  ]);
});

test("An older page whose first day is already shown adds its transactions to that day", () => {
  const bakery = transaction("card", -12.3, "2026-11-18", {
    counterparty: "Pekárna U Lípy",
  });
  const kiosk = transaction("card", -3.8, "2026-10-20", {
    counterparty: "Trafika Můstek",
  });
  const pocketMoney = transaction("transfer", 50, "2026-10-20", {
    counterparty: "Táta",
  });
  const bookshop = transaction("card", -7.5, "2026-10-15", {
    counterparty: "Knihkupectví Luxor",
  });
  const shown = listOf([bakery, kiosk], "2026-10-21");

  const next = withOlderPage(
    shown,
    olderPage([pocketMoney, bookshop], "2026-09-30"),
  );

  // The day shows once: the shown transactions first, then the page's, and its totals over all of them.
  expect(next.days).toEqual([
    {
      date: "2026-11-18",
      transactions: [bakery],
      totals: dayTotals([bakery]),
    },
    {
      date: "2026-10-20",
      transactions: [kiosk, pocketMoney],
      totals: dayTotals([kiosk, pocketMoney]),
    },
    {
      date: "2026-10-15",
      transactions: [bookshop],
      totals: dayTotals([bookshop]),
    },
  ]);
});

/** The list as shown while the next older page, the one before `nextBefore`, is read. */
function listOf(
  transactions: TransactionInApi[],
  nextBefore: string,
): ListState {
  return { days: byDay(transactions), nextBefore, older: "loading" };
}

/** An older page of these transactions, at C13's rate and its date. */
function olderPage(
  transactions: TransactionInApi[],
  olderBefore: string | null,
): TransactionPage {
  return {
    transactions,
    olderBefore,
    czkPerEur: KORUNA_RATE,
    rateDate: RATE_DATE,
  };
}
