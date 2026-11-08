import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { ago, HOUR, SECOND, startTestClock, timePasses } from "../test/clock";
import {
  after,
  answerWith,
  balance,
  bankAccessExpired,
  bankRateLimited,
  bankUnavailable,
  goOffline,
  goOnline,
  kept,
  phoneKeeps,
  requests,
  signedIn,
  type BalanceAnswer,
} from "../test/server";
import type { Problem } from "./screenState";
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

// The bank's failures on the screen (D5, D7 c; spec account-balance): a read that fails at the bank keeps the balance
// shown and records its problem as the screen's one banner; the next read clears it.

const bankFailures: {
  label: string;
  /** The balance shown is a stored one, and the first read fails; otherwise a read one, and a refresh fails. */
  stored: boolean;
  failure: BalanceAnswer;
  banner: Problem;
}[] = [
  {
    label: "a refresh, the bank does not answer",
    stored: false,
    failure: bankUnavailable,
    banner: { kind: "bank unavailable" },
  },
  {
    label: "a refresh, the bank's limit is reached",
    stored: false,
    failure: bankRateLimited,
    banner: { kind: "bank rate limited" },
  },
  {
    label: "a refresh, the bank's access has expired",
    stored: false,
    failure: bankAccessExpired,
    banner: { kind: "bank access expired" },
  },
  {
    label: "the first read, over a stored balance",
    stored: true,
    failure: bankUnavailable,
    banner: { kind: "bank unavailable" },
  },
];

test.each(bankFailures)(
  "A bank failure keeps the balance shown and adds its banner: $label",
  async ({ stored, failure, banner }) => {
    startTestClock();
    if (stored) await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    answerWith({
      whoIsSignedIn: LUCIE,
      balance: stored ? failure : [balance(286.4), failure],
    });
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);

    if (!stored) {
      act(() => {
        result.current.refresh();
      });
      await timePasses(0);
    }

    expect(result.current.shown).toMatchObject({
      screen: "account",
      header: { balance: { amount: 286.4 }, refreshing: false },
      banner,
    });
  },
);

test("A new read clears the banner of the one before", async () => {
  startTestClock();
  answerWith({
    whoIsSignedIn: LUCIE,
    balance: [
      balance(286.4),
      bankUnavailable,
      after(READ_TIME, balance(301.9)),
    ],
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);
  act(() => {
    result.current.refresh();
  });
  await timePasses(0);
  expect(result.current.shown, "the failed read's banner").toMatchObject({
    banner: { kind: "bank unavailable" },
  });

  act(() => {
    result.current.refresh();
  });
  await timePasses(0);
  expect(result.current.shown, "while the new read runs").toMatchObject({
    banner: null,
  });
  await timePasses(READ_TIME);
  expect(result.current.shown, "once it has read").toMatchObject({
    header: { balance: { amount: 301.9 } },
    banner: null,
  });
});
