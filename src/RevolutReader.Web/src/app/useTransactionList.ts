import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIST_OFFLINE,
  listShown,
  type ListProblem,
  type ListShown,
} from "./listState";
import {
  withNewestPage,
  withOlderPage,
  type ListState,
} from "./transactionList";
import {
  readNewestTransactions,
  readOlderTransactions,
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
  /**
   * The marker under the last day shows: asks the next older page (c010 design.md D1), unless one is loading, the last
   * one failed, or nothing older is kept.
   */
  loadOlder: () => void;
  /** "Zkusit znovu" under a failed older page: asks that page again (c010 design.md D1). */
  retryOlder: () => void;
}

/** The list a page makes, with the koruna rate and its date the newest page carried. */
interface ShownPage {
  list: ListState;
  rate: number;
  rateDate: string;
}

/**
 * The list's sequence (c010 design.md D1, D2, D7): the newest page (`GET /api/transactions`), read once `enabled` says
 * the session is signed in, so nothing is read at the bank for a visitor who is not; its placeholders while it is read,
 * its days once it is. A read with no answer within 60 s is aborted and ends as offline. Its outcome replaces the
 * problem the one before left; a failed read keeps a list already shown, and a newest page read again replaces only the
 * newest page (`withNewestPage`).
 *
 * Offline, before the join with C7a's screen (D7, D8): opened while the phone says it is offline, the list says so and
 * sends nothing, even with the session unknown; a read the phone finds offline sends nothing either. Coming back online
 * reads the newest page again for a signed-in session; with the session unknown, the note goes, and the read follows
 * once the screen has asked who is signed in.
 *
 * Older pages (D1): `loadOlder`, when the list's end comes near, asks the page before the last page's `olderBefore`,
 * one at a time, and its days join the end of the list. A failed one stays failed until "Zkusit znovu" (`retryOlder`):
 * neither the end coming near again nor the phone coming back online asks it again, so a dead connection never loops.
 * Offline, the read sends nothing and fails at once.
 *
 * One newest read at a time: a read asked for while one is under way is ignored, not queued, so the page is read once
 * even when its effect runs twice (React's strict mode). An answer that comes after the screen left is dropped. What the
 * list shows is what `listShown` makes of what is known.
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
  /**
   * The list as last shown, set with it (`show`), so the older pages' guards see a page that started loading in the same
   * turn, and an answer joins the list as it is when the answer comes.
   */
  const shownPage = useRef<ShownPage | null>(null);
  /** Whether the screen is on the page, for answers that come after it left. */
  const onPage = useRef(false);

  const show = useCallback((next: ShownPage): void => {
    shownPage.current = next;
    setPage(next);
  }, []);

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
    if (read.kind === "read") show(withNewest(shownPage.current, read.page));
    else setProblem(problemOf(read));
  }, [show]);

  /**
   * Reads the next older page, unless nothing older is kept or one is loading; the list says it is loading from the
   * moment it is asked. The answer joins the list as it is then, or marks the page failed; it is dropped when the
   * screen left, or when a newest page read meanwhile says nothing older is kept.
   */
  const readOlder = useCallback(async (): Promise<void> => {
    const asked = shownPage.current;
    if (
      asked === null ||
      asked.list.nextBefore === null ||
      asked.list.older === "loading"
    )
      return;
    const before = asked.list.nextBefore;
    show({ ...asked, list: { ...asked.list, older: "loading" } });

    const read = await readOlderTransactions(before);
    const answered = shownPage.current;
    if (
      !onPage.current ||
      answered === null ||
      answered.list.nextBefore !== before
    )
      return;

    show({
      ...answered,
      list:
        read.kind === "read"
          ? withOlderPage(answered.list, read.page)
          : { ...answered.list, older: "error" },
    });
  }, [show]);

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

  const loadOlder = useCallback((): void => {
    if (shownPage.current?.list.older === "idle") void readOlder();
  }, [readOlder]);

  const retryOlder = useCallback((): void => {
    if (shownPage.current?.list.older === "error") void readOlder();
  }, [readOlder]);

  return {
    ...listShown(
      page === null
        ? { list: null, reading, problem }
        : { ...page, reading, problem },
    ),
    retry,
    loadOlder,
    retryOlder,
  };
}

/** The list with a newest page read (`withNewestPage`), at the koruna rate and its date the page carried. */
function withNewest(shown: ShownPage | null, page: TransactionPage): ShownPage {
  return {
    list: withNewestPage(shown?.list ?? null, page),
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
