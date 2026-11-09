import type { JSX } from "react";
import { formatAmount } from "../app/format";
import type { Transaction } from "../app/transactions";
import { korunaValue, rowLabel, rowLines } from "../app/transactionText";
import { TransactionIcon } from "./TransactionIcon";

export interface TransactionRowProps {
  /** The transaction, as the API answers it. */
  tx: Transaction;
  /** Koruna per euro, for the koruna line. */
  rate: number;
  /** A tap on the row: opens the transaction's details, with the row to give the focus back to when they close. */
  onSelect: (tx: Transaction, row: HTMLButtonElement) => void;
}

/**
 * One transaction in the list (c010 design.md D4, D14, design system TransactionRow), at least 64 pt high: the icon disc
 * by direction, the two lines (each cut with an ellipsis; the first alone sits centred), and on the right the amount with
 * its sign over its koruna line, none for another currency. A button whose label reads what the row shows, in order,
 * without a time; a tap opens the transaction's details. The hairline above every row but the first is inset to the
 * text. Laid out as `Skeleton`'s list placeholder, so nothing jumps when the transactions arrive.
 */
export function TransactionRow({
  tx,
  rate,
  onSelect,
}: TransactionRowProps): JSX.Element {
  const { first, second } = rowLines(tx);
  const koruna = korunaValue(tx, rate);
  const incoming = tx.amount > 0;

  return (
    <button
      type="button"
      aria-label={rowLabel(tx, rate)}
      onClick={(event) => {
        onSelect(tx, event.currentTarget);
      }}
      className="flex min-h-16 w-full items-stretch text-left transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus active:bg-surface-muted"
    >
      <span className="flex flex-none items-center pr-3 pl-gutter">
        <TransactionIcon tx={tx} />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-3 py-row pr-gutter border-border [li+li_&]:border-t">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-strong text-ink">{first}</span>
          {second !== null ? (
            <span className="truncate text-subhead text-ink-muted">
              {second}
            </span>
          ) : null}
        </span>
        <span className="flex flex-none flex-col items-end tabular-nums">
          <span
            className={`text-body-strong ${incoming ? "text-incoming" : "text-outgoing"}`}
          >
            {formatAmount(tx.amount, tx.currency)}
          </span>
          {koruna !== null ? (
            <span className="text-footnote text-ink-muted">{koruna.shown}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}
