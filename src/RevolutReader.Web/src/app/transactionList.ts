import { EURO } from "./format";
import { transactionDay } from "./transactionDay";
import type { Transaction, TransactionPage } from "./transactions";

/** One day of the list (c010 design.md D1, D14): its transactions in the answer's order, and its totals in whole cents. */
export interface Day {
  date: string;
  transactions: Transaction[];
  totals: { incoming: number; outgoing: number };
}

/** The list as it is shown (c010 design.md D1): its days, the day the next older page is asked before, and that page's state. */
export interface ListState {
  /** `byDay([...newest, ...olderLoaded])` (c018 design.md D6). */
  days: Day[];
  /** The newest page's transactions (c018 design.md D6). */
  newest: Transaction[];
  /**
   * The older transactions loaded: every older page's, in the order they came, and after a refresh, the earlier newest
   * page's kept ones before them (c018 design.md D6).
   */
  olderLoaded: Transaction[];
  nextBefore: string | null;
  older: "idle" | "loading" | "error";
}

/**
 * The transactions by their day (c018 design.md D6; the design system's groupByDay): grouped by `transactionDay`, newest
 * day first. Within a day, newer bank dates first, each date's transactions in the order given, so a payment moved in
 * from the bank's previous day comes last in its day. Each day's totals are over its own group.
 */
export function byDay(transactions: Transaction[]): Day[] {
  const days = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const date = transactionDay(transaction);
    const day = days.get(date);
    if (day === undefined) days.set(date, [transaction]);
    else day.push(transaction);
  }

  // Dates are `yyyy-MM-dd`, so they compare as text; the sort is stable, so equal dates keep the order given.
  return Array.from(days, ([date, ofTheDay]) => {
    const transactions = ofTheDay.toSorted((a, b) =>
      newerFirst(a.date, b.date),
    );
    return { date, transactions, totals: dayTotals(transactions) };
  }).sort((a, b) => newerFirst(a.date, b.date));
}

/** Orders `yyyy-MM-dd` dates newest first. */
function newerFirst(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/**
 * A day's euro totals in whole cents (c010 design.md D4, D14): money received, refunds among it, and money spent as its
 * size; pending transactions counted. The sign decides, not the kind. Euro amounts only: the heading shows the totals in
 * euros, so an amount in another currency is left out of both. Each amount becomes whole cents before it is added, so
 * no floating-point drift reaches the sums.
 */
export function dayTotals(transactions: Transaction[]): {
  incoming: number;
  outgoing: number;
} {
  let incoming = 0;
  let outgoing = 0;
  for (const { amount, currency } of transactions) {
    if (currency !== EURO) continue;

    const cents = Math.round(Math.abs(amount) * 100);
    if (amount < 0) outgoing += cents;
    else incoming += cents;
  }

  return { incoming, outgoing };
}

/**
 * The list with a newest page read (c010 design.md D1; c018 design.md D6): the first read is the page alone. A later one
 * replaces the newest transactions only: every transaction already loaded whose bank date is older than the page's
 * `olderBefore` stays, and the next older page and its state stay as they were, so a failed older page stays failed. A
 * page that says nothing older is kept stands alone.
 */
export function withNewestPage(
  state: ListState | null,
  page: TransactionPage,
): ListState {
  const newest = page.transactions;
  const { olderBefore } = page;
  if (state === null || olderBefore === null)
    return listOf(newest, [], olderBefore, "idle");

  // The kept ones of the old newest page are older than the new page, so they come before the older pages' own.
  const kept = [...state.newest, ...state.olderLoaded].filter(
    // Dates are `yyyy-MM-dd`, so they compare as text.
    (transaction) => transaction.date < olderBefore,
  );
  return listOf(newest, kept, state.nextBefore, state.older);
}

/**
 * The list with an older page at its end (c010 design.md D1; c018 design.md D6): the page's transactions join the older
 * ones loaded, and the days are regrouped over all loaded, so a day shows one heading also when the page brings
 * transactions of a day already shown. The next older page is asked before the page's `olderBefore`, none being loaded
 * now.
 */
export function withOlderPage(
  state: ListState,
  page: TransactionPage,
): ListState {
  return listOf(
    state.newest,
    [...state.olderLoaded, ...page.transactions],
    page.olderBefore,
    "idle",
  );
}

/** The list of these loaded transactions, its days regrouped over all of them (c018 design.md D6). */
function listOf(
  newest: Transaction[],
  olderLoaded: Transaction[],
  nextBefore: string | null,
  older: ListState["older"],
): ListState {
  return {
    days: byDay([...newest, ...olderLoaded]),
    newest,
    olderLoaded,
    nextBefore,
    older,
  };
}
