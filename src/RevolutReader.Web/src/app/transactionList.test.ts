import { expect, test } from "vitest";
import {
  KORUNA_RATE,
  RATE_DATE,
  transaction,
  type TransactionInApi,
} from "../test/server";
import { inTimeZone } from "../test/timeZone";
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

test("A day's totals count euro amounts only, never an amount in another currency", () => {
  // The heading's totals are in euros (c010 design.md D4, D14): an amount in another currency is not added to them.
  const totals = dayTotals([
    transaction("card", -10, "2026-11-19", {
      counterparty: "Pekárna U Lípy",
    }),
    transaction("card", -12.3, "2026-11-19", {
      counterparty: "Book Depot",
      currency: "USD",
    }),
    transaction("topup", 20, "2026-11-19"),
    transaction("refund", 7.5, "2026-11-19", {
      counterparty: "Book Depot",
      currency: "USD",
    }),
  ]);

  // Received 20.00 EUR, not 27.50; spent 10.00 EUR, not 22.30.
  expect(totals).toEqual({ incoming: 2000, outgoing: 1000 });
});

// The list by the transaction's day (c018 design.md D6): a transaction with an approximate time is listed under the
// phone's local date of that time, which can be the day after the bank's `date` (a UTC date). These run on a phone set
// to Prague time, where 23:20 UTC in November is 0:20 the next day.

test("`byDay` groups by `transactionDay`, newest day first", () => {
  inTimeZone("Europe/Prague", () => {
    const cafe = transaction("card", -8.9, "2026-11-15", {
      counterparty: "Kavárna Na Rohu",
    });
    // 0:30 on 16 November in Prague, though the bank dates it the 15th and lists it after the café.
    const lateTopUp = transaction("topup", 20, "2026-11-15", {
      seenAt: "2026-11-15T23:30:00+00:00",
    });
    const bakery = transaction("card", -12.3, "2026-11-14", {
      counterparty: "Pekárna U Lípy",
    });

    expect(byDay([cafe, lateTopUp, bakery])).toEqual([
      {
        date: "2026-11-16",
        transactions: [lateTopUp],
        totals: dayTotals([lateTopUp]),
      },
      { date: "2026-11-15", transactions: [cafe], totals: dayTotals([cafe]) },
      {
        date: "2026-11-14",
        transactions: [bakery],
        totals: dayTotals([bakery]),
      },
    ]);
  });
});

test("Within a day, newer dates come first, each date's transactions in the order given", () => {
  inTimeZone("Europe/Prague", () => {
    // Both dated the 14th, both after midnight in Prague: 0:20 and 0:45 on the 15th.
    const transferFromDad = transaction("transfer", 30, "2026-11-14", {
      counterparty: "Táta",
      seenAt: "2026-11-14T23:20:00+00:00",
    });
    const pocketMoney = transaction("transfer", 5, "2026-11-14", {
      counterparty: "Táta",
      seenAt: "2026-11-14T23:45:00+00:00",
    });
    const kiosk = transaction("card", -3.8, "2026-11-15", {
      counterparty: "Trafika Můstek",
    });
    const cafe = transaction("card", -8.9, "2026-11-15", {
      counterparty: "Kavárna Na Rohu",
    });

    const [fifteenth, ...others] = byDay([
      transferFromDad,
      kiosk,
      pocketMoney,
      cafe,
    ]);

    expect(others, "one day only").toEqual([]);
    expect(fifteenth?.date).toBe("2026-11-15");
    // The 15th's own first, then those moved in from the 14th; each date's in the order given.
    expect(fifteenth?.transactions).toEqual([
      kiosk,
      cafe,
      transferFromDad,
      pocketMoney,
    ]);
  });
});

test("A day's totals count the transactions moved into it, and not those moved out", () => {
  inTimeZone("Europe/Prague", () => {
    const kiosk = transaction("card", -3.8, "2026-11-15", {
      counterparty: "Trafika Můstek",
    });
    // Dated the 14th, listed under the 15th.
    const transferFromDad = transaction("transfer", 30, "2026-11-14", {
      counterparty: "Táta",
      seenAt: "2026-11-14T23:20:00+00:00",
    });
    const bakery = transaction("card", -12.3, "2026-11-14", {
      counterparty: "Pekárna U Lípy",
    });

    const days = byDay([kiosk, transferFromDad, bakery]);

    expect(days.map(({ date, totals }) => ({ date, totals }))).toEqual([
      { date: "2026-11-15", totals: { incoming: 3000, outgoing: 380 } },
      { date: "2026-11-14", totals: { incoming: 0, outgoing: 1230 } },
    ]);
  });
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

test("An older page whose transaction moves into a day already shown gives that day one heading", () => {
  inTimeZone("Europe/Prague", () => {
    const bakery = transaction("card", -12.3, "2026-11-18", {
      counterparty: "Pekárna U Lípy",
    });
    const kiosk = transaction("card", -3.8, "2026-10-21", {
      counterparty: "Trafika Můstek",
    });
    // Dated the 20th, on the older page; 0:20 on 21 October in Prague (UTC+2 in October), a day already shown.
    const transferFromDad = transaction("transfer", 30, "2026-10-20", {
      counterparty: "Táta",
      seenAt: "2026-10-20T22:20:00+00:00",
    });
    const bookshop = transaction("card", -7.5, "2026-10-15", {
      counterparty: "Knihkupectví Luxor",
    });
    const shown = withNewestPage(
      null,
      newestPage([bakery, kiosk], "2026-10-21"),
    );

    const next = withOlderPage(
      shown,
      olderPage([transferFromDad, bookshop], "2026-09-30"),
    );

    expect(next.days).toEqual([
      {
        date: "2026-11-18",
        transactions: [bakery],
        totals: dayTotals([bakery]),
      },
      {
        date: "2026-10-21",
        transactions: [kiosk, transferFromDad],
        totals: dayTotals([kiosk, transferFromDad]),
      },
      {
        date: "2026-10-15",
        transactions: [bookshop],
        totals: dayTotals([bookshop]),
      },
    ]);
    expect(next.olderLoaded, "the older page's, in its order").toEqual([
      transferFromDad,
      bookshop,
    ]);
    expect(next.nextBefore).toBe("2026-09-30");
  });
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
    newest: [CINEMA_PENDING, BAKERY_PENDING, KIOSK_OCTOBER_21],
    olderLoaded: [BOOKSHOP_OCTOBER_15],
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

test("A newest page read again replaces the newest transactions and keeps the older pages' transactions dated before its `olderBefore`", () => {
  // The list read on 2026-11-20 (`olderBefore` 2026-10-20) with one older page loaded, then refreshed two days later
  // (`olderBefore` 2026-10-22), on a phone set to Prague time (UTC+2 in October, UTC+1 in November).
  inTimeZone("Europe/Prague", () => {
    // Dated the 21st, 0:20 on 22 October in Prague: by its date older than the refresh's `olderBefore`, so it stays,
    // though it is listed under the 22nd.
    const kioskLate = transaction("card", -3.8, "2026-10-21", {
      counterparty: "Trafika Můstek",
      seenAt: "2026-10-21T22:20:00+00:00",
    });
    // On the older page: dated the 19th, 0:40 on 20 October in Prague.
    const transferFromDad = transaction("transfer", 30, "2026-10-19", {
      counterparty: "Táta",
      seenAt: "2026-10-19T22:40:00+00:00",
    });
    const shown = withOlderPage(
      withNewestPage(
        null,
        newestPage([CINEMA_PENDING, BAKERY_PENDING, kioskLate], "2026-10-20"),
      ),
      olderPage([transferFromDad, BOOKSHOP_OCTOBER_15], "2026-09-28"),
    );
    const refreshed = [NEWSAGENT_NOVEMBER_22, BAKERY_SETTLED];

    const next = withNewestPage(shown, newestPage(refreshed, "2026-10-22"));

    expect(next.newest, "the new page's transactions").toEqual(refreshed);
    // The dropped pending payment and the pending bakery are gone with the old newest page; the rest stays.
    expect(next.days).toEqual([
      {
        date: "2026-11-22",
        transactions: [NEWSAGENT_NOVEMBER_22],
        totals: dayTotals([NEWSAGENT_NOVEMBER_22]),
      },
      {
        date: "2026-11-18",
        transactions: [BAKERY_SETTLED],
        totals: dayTotals([BAKERY_SETTLED]),
      },
      {
        date: "2026-10-22",
        transactions: [kioskLate],
        totals: dayTotals([kioskLate]),
      },
      {
        date: "2026-10-20",
        transactions: [transferFromDad],
        totals: dayTotals([transferFromDad]),
      },
      {
        date: "2026-10-15",
        transactions: [BOOKSHOP_OCTOBER_15],
        totals: dayTotals([BOOKSHOP_OCTOBER_15]),
      },
    ]);
    expect(next.nextBefore).toBe("2026-09-28");
  });
});

/** The list as shown while the next older page, the one before `nextBefore`, is read. */
function listOf(
  transactions: TransactionInApi[],
  nextBefore: string,
): ListState {
  return {
    days: byDay(transactions),
    newest: transactions,
    olderLoaded: [],
    nextBefore,
    older: "loading",
  };
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
