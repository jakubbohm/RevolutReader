import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIST_OFFLINE,
  listShown,
  type ListProblem,
  type ListShown,
} from "./listState";
import { byDay, type ListState } from "./transactionList";
import {
  readNewestTransactions,
  type TransactionPage,
  type TransactionsRead,
} from "./transactions";

/** How long the newest page may go unanswered before it is aborted and counts as offline (c010 design.md D7). */
const NEWEST_PAGE_LIMIT_MS = 60_000;

/**
 * What the account screen needs from the list's sequence: what the list's place shows, the banner with it, and "Zkusit
 * znovu" in that banner.
 */
export interface TransactionListModel {
  shown: ListShown;
  banner: ListProblem | null;
  /** "Zkusit znovu": reads the newest page again, unless a read is under way. */
  retry: () => void;
}

/** The list a page makes, with the koruna rate and its date the page carried. */
interface ShownPage {
  list: ListState;
  rate: number;
  rateDate: string;
}

/**
 * The list's sequence (c010 design.md D2, D7): the newest page (`GET /api/transactions`), read once `enabled` says the
 * session is signed in, so nothing is read at the bank for a visitor who is not; its placeholders while it is read, its
 * days once it is. A read with no answer within 60 s is aborted and ends as offline. Its outcome replaces the problem
 * the one before left; a failed read keeps a list already shown.
 *
 * Offline, before the join with C7a's screen (D7, D8): opened while the phone says it is offline, the list says so and
 * sends nothing, even with the session unknown; a read the phone finds offline sends nothing either. Coming back online
 * reads the newest page again for a signed-in session; with the session unknown, the note goes, and the read follows
 * once the screen has asked who is signed in.
 *
 * One read at a time: a read asked for while one is under way is ignored, not queued, so the page is read once even
 * when its effect runs twice (React's strict mode). An answer that comes after the screen left is dropped. What the list
 * shows is what `listShown` makes of what is known.
 */
export function useTransactionList(options: {
  enabled: boolean;
}): TransactionListModel {
  const { enabled } = options;
  const [reading, setReading] = useState(false);
  const [page, setPage] = useState<ShownPage | null>(null);
  // Opened while the phone says it is offline: the list says so at once, whether or not the session is known, and
  // nothing is sent (D7).
  const [problem, setProblem] = useState<ListProblem | null>(() =>
    navigator.onLine ? null : LIST_OFFLINE,
  );
  /** Set the moment a read starts, so a second one asked for in the same turn sees it (state would not yet). */
  const readUnderWay = useRef(false);
  /** Whether the screen is on the page, for answers that come after it left. */
  const onPage = useRef(false);

  /**
   * Reads the newest page, with the 60 s cap: a timer of the page's own and an `AbortController`, not
   * `AbortSignal.timeout`, so the tests' clock drives it too. The problem goes the moment the read starts; its outcome
   * sets the next.
   */
  const readNewest = useCallback(async (): Promise<void> => {
    if (readUnderWay.current) return;
    readUnderWay.current = true;
    setReading(true);
    setProblem(null);

    const limit = new AbortController();
    const limitTimer = setTimeout(() => {
      limit.abort();
    }, NEWEST_PAGE_LIMIT_MS);

    const read = await readNewestTransactions({ signal: limit.signal }).finally(
      () => {
        clearTimeout(limitTimer);
        readUnderWay.current = false;
      },
    );
    if (!onPage.current) return;

    setReading(false);
    if (read.kind === "read") setPage(shownPageOf(read.page));
    else setProblem(problemOf(read));
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

  useEffect(() => {
    function onOnline(): void {
      if (enabled) void readNewest();
      // The phone no longer says it is offline; the read follows once the session is known.
      else setProblem((now) => (now?.kind === "offline" ? null : now));
    }

    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [enabled, readNewest]);

  const retry = useCallback((): void => {
    void readNewest();
  }, [readNewest]);

  return {
    ...listShown(
      page === null
        ? { list: null, reading, problem }
        : { ...page, reading, problem },
    ),
    retry,
  };
}

/** The newest page as the list shows it: its days, the day the next older page is asked before, nothing loading yet. */
function shownPageOf(page: TransactionPage): ShownPage {
  return {
    list: {
      days: byDay(page.transactions),
      nextBefore: page.olderBefore,
      older: "idle",
    },
    rate: page.czkPerEur,
    rateDate: page.rateDate,
  };
}

/**
 * The list's problem for a read that brought no page (D7): offline (nothing sent, no answer, or the cap's abort) and
 * the three bank problems as they are; any other answer, 401 and 403 among them until the join (D8), is unexpected.
 */
function problemOf(
  read: Exclude<TransactionsRead, { kind: "read" }>,
): ListProblem {
  switch (read.kind) {
    case "offline":
      return LIST_OFFLINE;
    case "bank access expired":
    case "bank rate limited":
    case "bank unavailable":
      return { kind: read.kind };
    case "unexpected":
    case "signed out":
    case "refused":
      return { kind: "unexpected" };
  }
}
