import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import {
  after,
  answerWith,
  goOffline,
  goOnline,
  noAnswerYet,
  requests,
  serverError,
  timeline,
  transaction,
  transactionsPage,
} from "../test/server";
import { useTransactionList } from "./useTransactionList";

// The list's sequence (c010 design.md D7; § Rule ownership: useTransactionList), driven through the hook on the fake
// server and the test clock, and observed in what the list shows and the requests it sends.

// D7: the newest page has a 60 s cap, through `setTimeout` and an `AbortController`; with no answer by then it is
// aborted and ends as offline, the list's note and no banner.

test("A newest page with no answer within 60 s ends as offline", async () => {
  startTestClock();
  answerWith({ transactions: noAnswerYet });
  const { result } = renderHook(() => useTransactionList({ enabled: true }));

  await timePasses(59 * SECOND);
  expect(result.current, "at 59 s, still reading").toMatchObject({
    shown: { body: "placeholder" },
    banner: null,
  });
  await timePasses(SECOND);

  expect(result.current, "at 60 s, offline").toMatchObject({
    shown: { body: "offline note" },
    banner: null,
  });
  expect(timeline(), "the read is aborted").toContain(
    "aborted GET /api/transactions",
  );
});

// D1: the next older page is asked by itself when the list's end comes near (`loadOlder`, from the marker's observer),
// one at a time, before the `olderBefore` of the last page loaded. After a failed one only "Zkusit znovu" (`retryOlder`)
// asks again, never scrolling or the phone coming back online. The transactions are made up.

/** A settled card payment on 2026-11-18, on the newest page. */
const BAKERY = transaction("card", -12.3, "2026-11-18", {
  counterparty: "Pekárna U Lípy",
});

/** A settled card payment on 2026-10-15, on the first older page. */
const BOOKSHOP = transaction("card", -7.5, "2026-10-15", {
  counterparty: "Knihkupectví Luxor",
});

/** A settled card payment on 2026-09-25, on the second older page. */
const STATIONERY = transaction("card", -2.4, "2026-09-25", {
  counterparty: "Papírnictví Tužka",
});

/** The newest page: older transactions are kept before 2026-10-20. */
const NEWEST_PAGE = transactionsPage([BAKERY], { olderBefore: "2026-10-20" });

/** The request for the older page before 2026-10-20, the newest page's `olderBefore`. */
const OLDER_BEFORE_OCTOBER_20 = "GET /api/transactions/older?before=2026-10-20";

test("The next older page is asked before the last page's `olderBefore`", async () => {
  startTestClock();
  answerWith({
    transactions: NEWEST_PAGE,
    olderTransactions: {
      "2026-10-20": transactionsPage([BOOKSHOP], { olderBefore: "2026-09-28" }),
      "2026-09-28": transactionsPage([STATIONERY]),
    },
  });
  const { result } = renderHook(() => useTransactionList({ enabled: true }));
  await timePasses(0);

  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);

  expect(olderRequests()).toEqual([
    OLDER_BEFORE_OCTOBER_20,
    "GET /api/transactions/older?before=2026-09-28",
  ]);
});

test("No second older page is asked while one is loading", async () => {
  startTestClock();
  answerWith({
    transactions: NEWEST_PAGE,
    olderTransactions: {
      "2026-10-20": after(5 * SECOND, transactionsPage([BOOKSHOP])),
    },
  });
  const { result } = renderHook(() => useTransactionList({ enabled: true }));
  await timePasses(0);

  // The list's end shows twice in one turn, then again a second later, while the page is still on its way.
  act(() => {
    result.current.loadOlder();
    result.current.loadOlder();
  });
  await timePasses(SECOND);
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(4 * SECOND);

  expect(olderRequests()).toEqual([OLDER_BEFORE_OCTOBER_20]);
});

test('After a failed older page, nothing is asked until "Zkusit znovu", whatever the scrolling or the network does', async () => {
  startTestClock();
  answerWith({
    transactions: NEWEST_PAGE,
    olderTransactions: {
      "2026-10-20": [serverError, transactionsPage([BOOKSHOP])],
    },
  });
  const { result } = renderHook(() => useTransactionList({ enabled: true }));
  await timePasses(0);
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);
  expect(result.current.shown, "the older page failed").toMatchObject({
    body: "list",
    list: { older: "error" },
  });

  // The list's end shows again; the phone goes offline and the end shows; it comes back online and the end shows.
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);
  goOffline();
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);
  goOnline();
  await timePasses(0);
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);
  expect(olderRequests(), "nothing asked after the failure").toEqual([
    OLDER_BEFORE_OCTOBER_20,
  ]);

  act(() => {
    result.current.retryOlder();
  });
  await timePasses(0);

  expect(olderRequests(), '"Zkusit znovu" asks again').toEqual([
    OLDER_BEFORE_OCTOBER_20,
    OLDER_BEFORE_OCTOBER_20,
  ]);
  expect(result.current.shown, "the page joins the list").toMatchObject({
    body: "list",
    list: { days: [{ date: "2026-11-18" }, { date: "2026-10-15" }] },
  });
});

// D8: a failed older page stays in its own row (the list's end) and never takes the banner, before the join and after.
test("A failed older page never takes the banner", async () => {
  startTestClock();
  answerWith({
    transactions: NEWEST_PAGE,
    olderTransactions: { "2026-10-20": serverError },
  });
  const { result } = renderHook(() => useTransactionList({ enabled: true }));
  await timePasses(0);
  act(() => {
    result.current.loadOlder();
  });
  await timePasses(0);

  expect(result.current.shown, "the older page failed").toMatchObject({
    body: "list",
    list: { older: "error" },
  });
  expect(result.current.banner).toBeNull();
});

/** The older pages the app asked for, in order. */
function olderRequests(): string[] {
  return requests().filter((sent) =>
    sent.startsWith("GET /api/transactions/older"),
  );
}
