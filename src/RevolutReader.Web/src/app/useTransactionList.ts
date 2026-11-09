import { useCallback, useEffect, useRef, useState } from "react";
import {
  LIST_OFFLINE,
  listShown,
  type ListProblem,
  type ListShown,
} from "./listState";
import type { ListReport } from "./screenState";
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

/**
 * How long a page may go unanswered before it is aborted (c010 design.md D7, C7a's request rules): the newest page then
 * counts as offline, an older page as failed.
 */
const PAGE_LIMIT_MS = 60_000;

/** A newest page's read that found the login ended (c010 design.md D8): 401, or 403 with the email its problem names. */
export type LoginEnded = Extract<
  TransactionsRead,
  { kind: "signed out" } | { kind: "refused" }
>;

/** What the account screen tells the list (c010 design.md D8). */
export interface TransactionListOptions {
  /** The session is signed in: the newest page is read once it is, and never for a visitor who is not. */
  enabled: boolean;
  /**
   * A newest page's read found the login ended (401, 403): the account screen's sign-in or no-access screen takes it
   * (c009 design.md D4, D5 c). Without it, the list shows it as an unexpected answer.
   */
  onLoginEnded?: (ended: LoginEnded) => void;
  /** A newest page's read has landed, whatever it brought: a wake waits for it (c010 design.md D8). */
  onNewestLanded?: () => void;
}

/**
 * What the account screen needs from the list's sequence: what the list's place shows, the banner the list's own
 * problem makes, what the list reports to the screen's state, and the list's actions.
 */
export interface TransactionListModel {
  shown: ListShown;
  banner: ListProblem | null;
  /** What the list reports to the account screen's state (c010 design.md D8). */
  report: ListReport;
  /** The screen's refresh signal (c010 design.md D8): reads the newest page again, unless a read is under way. */
  refresh: () => void;
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
 * The list's sequence (c010 design.md D1, D2, D7, D8): the newest page (`GET /api/transactions`), read once `enabled`
 * says the session is signed in, so nothing is read at the bank for a visitor who is not, and again on the account
 * screen's refresh signal (`refresh`: "Obnovit", "Zkusit znovu", every return to the screen, back online); its
 * placeholders while it is read, its days once it is. A read with no answer within 60 s is aborted and ends as offline;
 * a read the phone finds offline sends nothing. Its outcome replaces the problem the one before left; a failed read
 * keeps a list already shown, and a newest page read again replaces only the newest page (`withNewestPage`). A read that
 * finds the login ended goes to the account screen (`onLoginEnded`).
 *
 * Older pages (D1): `loadOlder`, when the list's end comes near, asks the page before the last page's `olderBefore`,
 * one at a time, and its days join the end of the list. A failed one stays failed until "Zkusit znovu" (`retryOlder`):
 * neither the end coming near again nor the phone coming back online asks it again, so a dead connection never loops.
 * Offline, the read sends nothing and fails at once; with no answer within 60 s it is aborted and fails.
 *
 * One newest read at a time: a read asked for while one is under way is ignored, not queued, so the page is read once
 * even when its effect runs twice (React's strict mode). An answer that comes after the screen left is dropped. What the
 * list shows is what `listShown` makes of what is known; what it reports to the account screen, `report`.
 */
export function useTransactionList(
  options: TransactionListOptions,
): TransactionListModel {
  const { enabled } = options;
  const [reading, setReading] = useState(false);
  const [page, setPage] = useState<ShownPage | null>(null);
  const [problem, setProblem] = useState<ListProblem | null>(null);
  /** Set the moment a read starts, so a second one asked for in the same turn sees it (state would not yet). */
  const readUnderWay = useRef(false);
  /**
   * The list as last shown, set with it (`show`), so the older pages' guards see a page that started loading in the same
   * turn, and an answer joins the list as it is when the answer comes.
   */
  const shownPage = useRef<ShownPage | null>(null);
  /** Whether the screen is on the page, for answers that come after it left. */
  const onPage = useRef(false);
  /** The account screen's latest callbacks, for an answer that comes after it rendered again. */
  const callbacks = useRef(options);

  useEffect(() => {
    callbacks.current = options;
  });

  const show = useCallback((next: ShownPage): void => {
    shownPage.current = next;
    setPage(next);
  }, []);

  /**
   * Reads the newest page, with the 60 s cap (`withPageLimit`). The problem goes the moment the read starts; its outcome
   * sets the next, or goes to the account screen when it found the login ended.
   */
  const readNewest = useCallback(async (): Promise<void> => {
    if (readUnderWay.current) return;
    readUnderWay.current = true;
    setReading(true);
    setProblem(null);

    const read = await withPageLimit((signal) =>
      readNewestTransactions({ signal }),
    ).finally(() => {
      readUnderWay.current = false;
    });
    if (!onPage.current) return;

    setReading(false);
    const { onLoginEnded, onNewestLanded } = callbacks.current;
    onNewestLanded?.();
    if (read.kind === "read") show(withNewest(shownPage.current, read.page));
    else if (isLoginEnded(read) && onLoginEnded !== undefined)
      onLoginEnded(read);
    else setProblem(problemOf(read));
  }, [show]);

  /**
   * Reads the next older page, with the 60 s cap (`withPageLimit`), unless nothing older is kept or one is loading; the
   * list says it is loading from the moment it is asked. The answer joins the list as it is then, or marks the page
   * failed (an aborted read among them); it is dropped when the screen left, or when a newest page read meanwhile says
   * nothing older is kept.
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

    const read = await withPageLimit((signal) =>
      readOlderTransactions(before, { signal }),
    );
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

  const refresh = useCallback((): void => {
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
    report: { reading, problem, onScreen: page !== null },
    refresh,
    loadOlder,
    retryOlder,
  };
}

/**
 * A page's read with the 60 s cap (c010 design.md D7): a timer of the read's own and an `AbortController`, not
 * `AbortSignal.timeout`, so the tests' clock drives it too. An aborted read ends as offline (`askTheApi`); the timer goes
 * when the read ends.
 */
async function withPageLimit(
  read: (signal: AbortSignal) => Promise<TransactionsRead>,
): Promise<TransactionsRead> {
  const limit = new AbortController();
  const limitTimer = setTimeout(() => {
    limit.abort();
  }, PAGE_LIMIT_MS);

  try {
    return await read(limit.signal);
  } finally {
    clearTimeout(limitTimer);
  }
}

/** The list with a newest page read (`withNewestPage`), at the koruna rate and its date the page carried. */
function withNewest(shown: ShownPage | null, page: TransactionPage): ShownPage {
  return {
    list: withNewestPage(shown?.list ?? null, page),
    rate: page.czkPerEur,
    rateDate: page.rateDate,
  };
}

function isLoginEnded(read: TransactionsRead): read is LoginEnded {
  return read.kind === "signed out" || read.kind === "refused";
}

/**
 * The list's problem for a read that brought no page (D7): offline (nothing sent, no answer, or the cap's abort) and
 * the three bank problems as they are; any other answer is unexpected, 401 and 403 among them when no account screen
 * takes them (D8).
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
