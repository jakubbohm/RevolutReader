import type { Transaction } from "./transactions";

/** `seenAt` as a Date, or null when there is none or it does not parse (c018 design.md D6; the design system's approxTime). */
export function approxTime(
  transaction: Pick<Transaction, "seenAt">,
): Date | null {
  const { seenAt } = transaction;
  if (seenAt === null || seenAt === "") return null;

  const time = new Date(seenAt);
  return Number.isNaN(time.getTime()) ? null : time;
}

/**
 * The transaction's day, `yyyy-MM-dd`: the phone's local date of approxTime when there is one, else `date` (c018
 * design.md D6; the design system's txDay).
 */
export function transactionDay(
  transaction: Pick<Transaction, "date" | "seenAt">,
): string {
  const time = approxTime(transaction);
  if (time === null) return transaction.date;

  const month = String(time.getMonth() + 1).padStart(2, "0");
  const day = String(time.getDate()).padStart(2, "0");
  return `${time.getFullYear()}-${month}-${day}`;
}
