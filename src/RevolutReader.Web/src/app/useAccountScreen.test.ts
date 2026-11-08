import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import {
  after,
  answerWith,
  balance,
  goOffline,
  goOnline,
  requests,
  signedIn,
} from "../test/server";
import { useAccountScreen } from "./useAccountScreen";

// The account screen's sequence (c009 design.md D2, D3; § Rule ownership: useAccountScreen), driven through the hook on
// the fake server and the test clock, and observed in the requests it sends. The balances and the user are made up.

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const READ_TIME = 2 * SECOND;

/** How many times the screen has sent this request (`METHOD /path`). */
function timesSent(request: string): number {
  return requests().filter((sent) => sent === request).length;
}

/** How many balance reads the screen has sent. */
function balanceReadsSent(): number {
  return timesSent("GET /api/balance");
}

test("A refresh asked for while a read is under way sends no second request", async () => {
  startTestClock();
  answerWith({
    whoIsSignedIn: LUCIE,
    balance: [
      after(READ_TIME, balance(286.4)),
      after(READ_TIME, balance(301.9)),
    ],
  });
  const { result } = renderHook(() => useAccountScreen());

  // While the first read is under way.
  await timePasses(0);
  act(() => {
    result.current.refresh();
  });
  await timePasses(READ_TIME);
  expect(balanceReadsSent(), "during the first read, none more").toBe(1);

  // A refresh, then another while it is under way.
  act(() => {
    result.current.refresh();
  });
  await timePasses(0);
  act(() => {
    result.current.refresh();
  });
  await timePasses(READ_TIME);
  expect(balanceReadsSent(), "the refresh, and no second one").toBe(2);
});

test("Back online while who is signed in was unanswered asks it again, not the balance", async () => {
  startTestClock();
  answerWith({
    whoIsSignedIn: after(READ_TIME, LUCIE),
    balance: balance(286.4),
  });
  goOffline();
  renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(timesSent("GET /api/me"), "nothing sent while offline").toBe(0);

  goOnline();
  await timePasses(0);

  expect(timesSent("GET /api/me"), "who is signed in, asked again").toBe(1);
  expect(balanceReadsSent(), "no balance before it answers").toBe(0);
});
