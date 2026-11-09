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
  withNewestPage,
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

// A refresh at the join (c010 design.md D1, D8): it replaces the newest page only; the older pages already loaded stay,
// because the boundary between them is a fixed date. The list shown here was read on 2026-11-20: its newest page held
// 2026-10-20 to 2026-11-20 (`olderBefore` 2026-10-20), and one older page has loaded since (`olderBefore` 2026-09-28).
// The refresh comes two days later, so its newest page starts on 2026-10-22.

/** A payment on the first newest page's first day: older than the refresh's window. */
const KIOSK_OCTOBER_21 = transaction("card", -3.8, "2026-10-21", {
  counterparty: "Trafika Můstek",
});
/** A card payment still pending when the list was first read. */
const BAKERY_PENDING = transaction("card", -12.3, "2026-11-18", {
  counterparty: "Pekárna U Lípy",
  pending: true,
});
/** A payment that was pending on 2026-11-19 when the list was first read, and that the bank has since dropped. */
const CINEMA_PENDING = transaction("card", -9.5, "2026-11-19", {
  counterparty: "Kino Lucerna",
  pending: true,
});
/** The first older page's day. */
const BOOKSHOP_OCTOBER_15 = transaction("card", -7.5, "2026-10-15", {
  counterparty: "Knihkupectví Luxor",
});
/** The same bakery payment, settled by the time of the refresh. */
const BAKERY_SETTLED = { ...BAKERY_PENDING, pending: false };
/** A payment made since the list was first read. */
const NEWSAGENT_NOVEMBER_22 = transaction("card", -2.4, "2026-11-22", {
  counterparty: "Papírnictví Tužka",
});

/** The list as shown before the refresh, with the first older page loaded. */
function shownBeforeTheRefresh(): ListState {
  return {
    days: byDay([
      CINEMA_PENDING,
      BAKERY_PENDING,
      KIOSK_OCTOBER_21,
      BOOKSHOP_OCTOBER_15,
    ]),
    nextBefore: "2026-09-28",
    older: "idle",
  };
}

test("After a refresh, the list holds the new newest page and every day already shown that is older than its `olderBefore`", () => {
  const next = withNewestPage(
    shownBeforeTheRefresh(),
    newestPage([NEWSAGENT_NOVEMBER_22, BAKERY_SETTLED], "2026-10-22"),
  );

  // 2026-11-19 is gone with the newest page it was on; 2026-10-21 fell out of the live window and stays as shown.
  expect(next.days).toEqual(
    byDay([
      NEWSAGENT_NOVEMBER_22,
      BAKERY_SETTLED,
      KIOSK_OCTOBER_21,
      BOOKSHOP_OCTOBER_15,
    ]),
  );
});

test("A refresh whose page says nothing older is kept leaves the new page alone", () => {
  const next = withNewestPage(
    shownBeforeTheRefresh(),
    newestPage([NEWSAGENT_NOVEMBER_22, BAKERY_SETTLED], null),
  );

  expect(next.days).toEqual(byDay([NEWSAGENT_NOVEMBER_22, BAKERY_SETTLED]));
  expect(next.nextBefore, "no older page to ask").toBeNull();
});

test("The next older page after a refresh is asked before the last older page loaded", () => {
  const next = withNewestPage(
    shownBeforeTheRefresh(),
    newestPage([NEWSAGENT_NOVEMBER_22, BAKERY_SETTLED], "2026-10-22"),
  );

  expect(next.nextBefore).toBe("2026-09-28");
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

/** A newest page of these transactions, at C13's rate and its date: the same shape as an older page. */
function newestPage(
  transactions: TransactionInApi[],
  olderBefore: string | null,
): TransactionPage {
  return olderPage(transactions, olderBefore);
}
