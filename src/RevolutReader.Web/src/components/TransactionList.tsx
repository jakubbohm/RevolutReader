import { useState, type JSX } from "react";
import type { ListState } from "../app/transactionList";
import type { Transaction } from "../app/transactions";
import { useNow } from "../app/useNow";
import { DayGroup } from "./DayGroup";
import { TransactionSheet } from "./TransactionSheet";

/** How often the days' "Dnes" and "Včera" are read against the clock again, as C7a's freshness line counts. */
const MINUTE_MS = 60_000;

export interface TransactionListProps {
  /** The list as it is shown: its days, newest first. */
  list: ListState;
  /** Koruna per euro, for the koruna lines and the details' rate line. */
  rate: number;
  /** The day of the koruna rate (`yyyy-MM-dd`), for the details' rate line. */
  rateDate: string;
}

/** The transaction whose details were last opened, the row that opened them, and whether they are still open. */
interface Selection {
  tx: Transaction;
  row: HTMLButtonElement;
  open: boolean;
}

/**
 * The transactions on the account screen (c010 design.md D14): the days, newest first, each a `DayGroup`. "Dnes" and
 * "Včera" are read against the clock again every minute while the list is on screen, so they move on at midnight.
 *
 * A tap on a row opens its details in the one `TransactionSheet`, which gives the focus back to that row when it closes.
 * The sheet keeps its transaction while it slides away.
 */
export function TransactionList({
  list,
  rate,
  rateDate,
}: TransactionListProps): JSX.Element {
  const now = useNow(MINUTE_MS);
  const [selection, setSelection] = useState<Selection | null>(null);

  function select(tx: Transaction, row: HTMLButtonElement): void {
    setSelection({ tx, row, open: true });
  }

  function openChange(open: boolean): void {
    setSelection((current) => (current === null ? null : { ...current, open }));
  }

  return (
    <div className="flex flex-col">
      {list.days.map((day) => (
        <DayGroup
          key={day.date}
          day={day}
          now={now}
          rate={rate}
          onSelect={select}
        />
      ))}
      {selection !== null ? (
        <TransactionSheet
          tx={selection.tx}
          rate={rate}
          rateDate={rateDate}
          open={selection.open}
          onOpenChange={openChange}
          returnFocusTo={selection.row}
        />
      ) : null}
    </div>
  );
}
