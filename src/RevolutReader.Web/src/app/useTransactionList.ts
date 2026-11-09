import { useCallback, useEffect, useRef, useState } from "react";
import { listShown, type ListProblem, type ListShown } from "./listState";
import { readNewestTransactions } from "./transactions";

/** What the account screen needs from the list's sequence: what the list's place shows, and the banner with it. */
export interface TransactionListModel {
  shown: ListShown;
  banner: ListProblem | null;
}

/**
 * The list's sequence (c010 design.md D7): the newest page (`GET /api/transactions`), read once `enabled` says the
 * session is signed in, so nothing is read at the bank for a visitor who is not; its placeholders while it is read. One
 * read at a time: a read asked for while one is under way is ignored, not queued, so the page is read once even when
 * its effect runs twice (React's strict mode). An answer that comes after the screen left is dropped. What the list
 * shows is what `listShown` makes of what is known.
 */
export function useTransactionList(options: {
  enabled: boolean;
}): TransactionListModel {
  const { enabled } = options;
  const [reading, setReading] = useState(false);
  /** Set the moment a read starts, so a second one asked for in the same turn sees it (state would not yet). */
  const readUnderWay = useRef(false);
  /** Whether the screen is on the page, for answers that come after it left. */
  const onPage = useRef(false);

  const readNewest = useCallback(async (): Promise<void> => {
    if (readUnderWay.current) return;
    readUnderWay.current = true;
    setReading(true);

    try {
      await readNewestTransactions();
    } finally {
      readUnderWay.current = false;
    }
    if (!onPage.current) return;

    setReading(false);
  }, []);

  useEffect(() => {
    onPage.current = true;

    return () => {
      onPage.current = false;
    };
  }, []);

  useEffect(() => {
    if (enabled) void readNewest();
  }, [enabled, readNewest]);

  return listShown({ list: null, reading, problem: null });
}
