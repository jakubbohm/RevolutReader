import {
  ArrowDownLeft,
  ArrowUpRight,
  Clock,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import type { JSX } from "react";
import type { Transaction } from "../app/transactions";

export interface TransactionIconProps {
  /** The transaction, as the API answers it. */
  tx: Transaction;
}

/**
 * A transaction's icon disc, 40 pt and decorative (c010 design.md D4c, D14, design system TransactionRow and
 * TransactionSheet), the same in the row and in its sheet: `clock` in `color-pending` on `color-pending-soft` while
 * pending, whatever its kind; else `undo-2` on `color-incoming-soft` for a refund; else by direction, `arrow-down-left`
 * on `color-incoming-soft` for money received, `arrow-up-right` on `color-surface-muted` for money spent.
 */
export function TransactionIcon({ tx }: TransactionIconProps): JSX.Element {
  const { Icon, colours } = discOf(tx);

  return (
    <span
      aria-hidden="true"
      className={`flex size-10 flex-none items-center justify-center rounded-full ${colours}`}
    >
      <Icon size={20} />
    </span>
  );
}

/** The disc's icon and its colours, by status, then kind, then direction. */
function discOf(tx: Transaction): {
  Icon: LucideIcon;
  colours: string;
} {
  if (tx.pending)
    return { Icon: Clock, colours: "bg-pending-soft text-pending" };
  if (tx.kind === "refund")
    return { Icon: Undo2, colours: "bg-incoming-soft text-incoming" };
  if (tx.amount > 0)
    return { Icon: ArrowDownLeft, colours: "bg-incoming-soft text-incoming" };

  return { Icon: ArrowUpRight, colours: "bg-surface-muted text-outgoing" };
}
