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
