import { renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import { answerWith, noAnswerYet, timeline } from "../test/server";
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
