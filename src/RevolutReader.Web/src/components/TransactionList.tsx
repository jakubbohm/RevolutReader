import type { JSX } from "react";
import type { ListState } from "../app/transactionList";
import { useNow } from "../app/useNow";
import { DayGroup } from "./DayGroup";

/** How often the days' "Dnes" and "Včera" are read against the clock again, as C7a's freshness line counts. */
const MINUTE_MS = 60_000;

export interface TransactionListProps {
  /** The list as it is shown: its days, newest first. */
  list: ListState;
  /** Koruna per euro, for the rows' koruna lines. */
  rate: number;
}

/**
 * The transactions on the account screen (c010 design.md D14): the days, newest first, each a `DayGroup`. "Dnes" and
 * "Včera" are read against the clock again every minute while the list is on screen, so they move on at midnight.
 */
export function TransactionList({
  list,
  rate,
}: TransactionListProps): JSX.Element {
  const now = useNow(MINUTE_MS);

  return (
    <div className="flex flex-col">
      {list.days.map((day) => (
        <DayGroup key={day.date} day={day} now={now} rate={rate} />
      ))}
    </div>
  );
}
