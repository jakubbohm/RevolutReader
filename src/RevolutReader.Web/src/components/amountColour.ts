import type { Transaction } from "../app/transactions";

/**
 * A transaction's amount colour, the same in its row and its sheet (c010 design.md D14, design system TransactionRow and
 * TransactionSheet): `color-ink-muted` while pending, its sign kept; else `color-incoming` for money received, refunds
 * included, and `color-outgoing` for money spent.
 */
export function amountColour(tx: Transaction): string {
  if (tx.pending) return "text-ink-muted";

  return tx.amount > 0 ? "text-incoming" : "text-outgoing";
}
