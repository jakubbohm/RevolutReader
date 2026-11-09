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
 * each day with its totals. A stub until c010 tasks.md task 41.1 is implemented; `void` keeps the unused-parameter check
 * quiet until then.
 */
export function byDay(transactions: Transaction[]): Day[] {
  void transactions;
  throw new Error("not implemented");
}

/**
 * A day's totals in whole cents (c010 design.md D14): money received, refunds among it, and money spent as its size;
 * pending transactions counted. A stub until c010 tasks.md task 41.1 is implemented.
 */
export function dayTotals(transactions: Transaction[]): {
  incoming: number;
  outgoing: number;
} {
  void transactions;
  throw new Error("not implemented");
}
