import { EURO } from "./format";
import type { Transaction, TransactionPage } from "./transactions";

/** One day of the list (c010 design.md D1, D14): its transactions in the answer's order, and its totals in whole cents. */
export interface Day {
  date: string;
  transactions: Transaction[];
  totals: { incoming: number; outgoing: number };
}

/** The list as it is shown (c010 design.md D1): its days, the day the next older page is asked before, and that page's state. */
export interface ListState {
  days: Day[];
  nextBefore: string | null;
  older: "idle" | "loading" | "error";
}

/**
 * The transactions by their date (c010 design.md D1, D14), the days and each day's transactions in the answer's order,
 * each day with its totals. The answer lists a day's transactions together, newest day first; should a day come back
 * further down, its transactions still join the day where it first came.
 */
export function byDay(transactions: Transaction[]): Day[] {
  const days = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const day = days.get(transaction.date);
    if (day === undefined) days.set(transaction.date, [transaction]);
    else day.push(transaction);
  }

  return Array.from(days, ([date, ofTheDay]) => ({
    date,
    transactions: ofTheDay,
    totals: dayTotals(ofTheDay),
  }));
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
 * The list with a newest page read (c010 design.md D1): the first read is the page alone. A later one replaces the
 * newest page only: the list holds the new page's days and every day already shown that is older than its
 * `olderBefore`, and the next older page and its state stay as they were, so a failed older page stays failed. A page
 * that says nothing older is kept stands alone.
 */
export function withNewestPage(
  state: ListState | null,
  page: TransactionPage,
): ListState {
  const newest = byDay(page.transactions);
  const { olderBefore } = page;
  if (state === null || olderBefore === null)
    return { days: newest, nextBefore: olderBefore, older: "idle" };

  return {
    // Dates are `yyyy-MM-dd`, so they compare as text.
    days: [...newest, ...state.days.filter((day) => day.date < olderBefore)],
    nextBefore: state.nextBefore,
    older: state.older,
  };
}

/**
 * The list with an older page at its end (c010 design.md D1, D14): the page's days join the end of the list, and a first
 * day the list already shows takes the page's transactions of that day after its own, its totals over all of them, so
 * no date has two headings. The next older page is asked before the page's `olderBefore`, none being loaded now.
 */
export function withOlderPage(
  state: ListState,
  page: TransactionPage,
): ListState {
  const days = [...state.days];
  for (const day of byDay(page.transactions)) {
    const last = days.at(-1);
    if (last?.date === day.date) {
      const transactions = [...last.transactions, ...day.transactions];
      days[days.length - 1] = {
        date: day.date,
        transactions,
        totals: dayTotals(transactions),
      };
    } else days.push(day);
  }

  return { days, nextBefore: page.olderBefore, older: "idle" };
}
