import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { JSX } from "react";
import type { Transaction } from "../app/transactions";

export interface TransactionIconProps {
  /** The transaction, as the API answers it. */
  tx: Transaction;
}

/**
 * A transaction's icon disc, 40 pt and decorative (c010 design.md D14, design system TransactionRow and
 * TransactionSheet), the same in the row and in its sheet: by direction, `arrow-down-left` on `color-incoming-soft` for
 * money received, `arrow-up-right` on `color-surface-muted` for money spent.
 */
export function TransactionIcon({ tx }: TransactionIconProps): JSX.Element {
  const incoming = tx.amount > 0;

  return (
    <span
      aria-hidden="true"
      className={`flex size-10 flex-none items-center justify-center rounded-full ${incoming ? "bg-incoming-soft text-incoming" : "bg-surface-muted text-outgoing"}`}
    >
      {incoming ? <ArrowDownLeft size={20} /> : <ArrowUpRight size={20} />}
    </span>
  );
}
