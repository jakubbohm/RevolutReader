import { useId, type JSX } from "react";
import type { Day } from "../app/transactionList";
import type { Transaction } from "../app/transactions";
import { DayHeader } from "./DayHeader";
import { TransactionRow } from "./TransactionRow";

export interface DayGroupProps {
  /** The day: its date, its transactions in the bank's order, and its totals. */
  day: Day;
  /** Now, for "Dnes" and "Včera". */
  now: Date;
  /** Koruna per euro, for the rows' koruna lines. */
  rate: number;
  /** A tap on a row: the transaction, and the row to give the focus back to. */
  onSelect: (tx: Transaction, row: HTMLButtonElement) => void;
}

/**
 * One day of the list (c010 design.md D14, design system DayGroup): its sticky heading with the day's totals over the
 * day's rows in a `color-surface` card, as a region named by the heading's label alone. The rows keep the bank's order;
 * there is no time to sort them by.
 */
export function DayGroup({
  day,
  now,
  rate,
  onSelect,
}: DayGroupProps): JSX.Element {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <DayHeader id={headingId} date={day.date} now={now} totals={day.totals} />
      {/* The role keeps the list a list for VoiceOver, which drops it from a list drawn without bullets. */}
      <ul
        role="list"
        className="mx-gutter flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card"
      >
        {day.transactions.map((tx, index) => (
          // A transaction has no identity of its own on the screen; its place in the day is its key.
          <li key={index}>
            <TransactionRow tx={tx} rate={rate} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </section>
  );
}
