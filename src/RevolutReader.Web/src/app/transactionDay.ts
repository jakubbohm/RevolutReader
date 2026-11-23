import type { Transaction } from "./transactions";

/** `seenAt` as a Date, or null when there is none or it does not parse (c018 design.md D6; the design system's approxTime). */
export function approxTime(
  _transaction: Pick<Transaction, "seenAt">,
): Date | null {
  throw new Error("Not implemented: c018 tasks.md 36.1");
}

/**
 * The transaction's day, `yyyy-MM-dd`: the phone's local date of approxTime when there is one, else `date` (c018
 * design.md D6; the design system's txDay).
 */
export function transactionDay(
  _transaction: Pick<Transaction, "date" | "seenAt">,
): string {
  throw new Error("Not implemented: c018 tasks.md 36.1");
}
