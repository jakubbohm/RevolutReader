import type { Transaction } from "./transactions";

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
 * A day's totals in whole cents (c010 design.md D14): money received, refunds among it, and money spent as its size;
 * pending transactions counted. The sign decides, not the kind. Each amount becomes whole cents before it is added, so
 * no floating-point drift reaches the sums.
 */
export function dayTotals(transactions: Transaction[]): {
  incoming: number;
  outgoing: number;
} {
  let incoming = 0;
  let outgoing = 0;
  for (const { amount } of transactions) {
    const cents = Math.round(Math.abs(amount) * 100);
    if (amount < 0) outgoing += cents;
    else incoming += cents;
  }

  return { incoming, outgoing };
}
