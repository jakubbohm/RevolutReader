import { useEffect, useRef, useState, type JSX } from "react";
import type { ListState } from "../app/transactionList";
import type { Transaction } from "../app/transactions";
import { useNow } from "../app/useNow";
import { DayGroup } from "./DayGroup";
import { ListEnd } from "./ListEnd";
import { TransactionSheet } from "./TransactionSheet";

/** How often the days' "Dnes" and "Včera" are read against the clock again, as C7a's freshness line counts. */
const MINUTE_MS = 60_000;

/** The end counts as near one screen before it shows (design system ListEnd), so the next page is there in time. */
const NEAR_THE_END = "0px 0px 100% 0px";

export interface TransactionListProps {
  /** The list as it is shown: its days, newest first, and the state of the next older page. */
  list: ListState;
  /** Koruna per euro, for the koruna lines and the details' rate line. */
  rate: number;
  /** The day of the koruna rate (`yyyy-MM-dd`), for the details' rate line. */
  rateDate: string;
  /** The list's end comes near: asks the next older page. */
  onLoadOlder: () => void;
  /** "Zkusit znovu" under a failed older page. */
  onRetryOlder: () => void;
}

/** The transaction whose details were last opened, the row that opened them, and whether they are still open. */
interface Selection {
  tx: Transaction;
  row: HTMLButtonElement;
  open: boolean;
}

/**
 * The transactions on the account screen (c010 design.md D1, D14): the days, newest first, each a `DayGroup`, and the
 * list's end under the last day (`ListEnd`), `spacing-section` apart. "Dnes" and "Včera" are read against the clock
 * again every minute while the list is on screen, so they move on at midnight.
 *
 * Older pages load by themselves: while older pages may exist and none is loading, an `IntersectionObserver` watches
 * the end, and asks the next page when it comes within one screen of the viewport. A fresh observer for each page
 * reports at once whether the end is still near. A failed page shows its error at the end, and only its "Zkusit znovu"
 * asks again; where the history ends, the end says so, and nothing watches it.
 *
 * A tap on a row opens its details in the one `TransactionSheet`, which gives the focus back to that row when it closes.
 * The sheet keeps its transaction while it slides away.
 */
export function TransactionList({
  list,
  rate,
  rateDate,
  onLoadOlder,
  onRetryOlder,
}: TransactionListProps): JSX.Element {
  const now = useNow(MINUTE_MS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const watchesTheEnd = list.nextBefore !== null && list.older === "idle";

  useEffect(() => {
    const marker = end.current;
    if (!watchesTheEnd || marker === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadOlder();
      },
      { rootMargin: NEAR_THE_END },
    );
    observer.observe(marker);
    return () => {
      observer.disconnect();
    };
  }, [watchesTheEnd, onLoadOlder]);

  function select(tx: Transaction, row: HTMLButtonElement): void {
    setSelection({ tx, row, open: true });
  }

  function openChange(open: boolean): void {
    setSelection((current) => (current === null ? null : { ...current, open }));
  }

  return (
    <div className="flex flex-col gap-section">
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
      </div>
      <ListEnd
        ref={end}
        state={
          list.nextBefore === null
            ? "end"
            : list.older === "error"
              ? "error"
              : "loading"
        }
        onRetry={onRetryOlder}
      />
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
