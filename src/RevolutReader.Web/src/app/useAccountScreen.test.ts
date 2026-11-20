import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { ago, HOUR, SECOND, startTestClock, timePasses } from "../test/clock";
import {
  installPushStandIns,
  type PushStandInOptions,
  type PushStandIns,
} from "../test/push";
import {
  after,
  answerWith,
  balance,
  bankAccessExpired,
  bankRateLimited,
  bankUnavailable,
  bodiesSent,
  closeApp,
  emptyThePhone,
  goOffline,
  goOnline,
  kept,
  keptBalance,
  leaveApp,
  noAnswerYet,
  noConnection,
  nobodySignedIn,
  phoneKeeps,
  pushKey,
  refused,
  requests,
  returnToApp,
  serverError,
  signedIn,
  signedOut,
  stored,
  subscriptionRefused,
  timeline,
  type BalanceAnswer,
  type ServerAnswers,
  type WhoIsSignedIn,
} from "../test/server";
import type { Problem } from "./screenState";
import { useAccountScreen, type AccountScreenModel } from "./useAccountScreen";

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

// The 60 s cap (D3): a refresh with no answer after 60 s is aborted and ends as offline, the balance kept; the first
// load has no cap, it shows the waking-up screens instead (D2).

test("A refresh with no answer after 60 s ends as offline, the balance kept", async () => {
  startTestClock();
  answerWith({ whoIsSignedIn: LUCIE, balance: [balance(286.4), noAnswerYet] });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);

  act(() => {
    result.current.refresh();
  });
  await timePasses(59 * SECOND);
  expect(result.current.shown, "at 59 s, still reading").toMatchObject({
    header: { balance: { amount: 286.4 }, refreshing: true },
    banner: null,
  });
  await timePasses(SECOND);

  expect(result.current.shown, "at 60 s, offline").toMatchObject({
    header: { balance: { amount: 286.4 }, refreshing: false },
    banner: { kind: "offline" },
  });
  expect(timeline(), "the read is aborted").toContain(
    "aborted GET /api/balance",
  );
});

const firstLoadsWithNoAnswer: { label: string; answers: ServerAnswers }[] = [
  {
    label: "who is signed in has no answer",
    answers: { whoIsSignedIn: noAnswerYet },
  },
  {
    label: "the first balance read has no answer",
    answers: { whoIsSignedIn: LUCIE, balance: noAnswerYet },
  },
];

test.each(firstLoadsWithNoAnswer)(
  "The first load has no 60 s limit: $label",
  async ({ answers }) => {
    startTestClock();
    answerWith(answers);
    const { result } = renderHook(() => useAccountScreen());

    await timePasses(61 * SECOND);

    expect(
      timeline().filter((entry) => entry.startsWith("aborted ")),
      "nothing aborted",
    ).toEqual([]);
    expect(result.current.shown, "no offline banner").not.toMatchObject({
      banner: { kind: "offline" },
    });
  },
);

// D4: a device without a login holds no bank data. A read still under way when the server confirms a sign-out lands
// after the sign-out's forgetting; it must neither come back on the screen nor be kept on the phone.
test("A balance read that lands after a sign-out the server confirmed is neither shown nor kept on the phone", async () => {
  startTestClock();
  answerWith({
    whoIsSignedIn: LUCIE,
    balance: [balance(286.4), after(5 * SECOND, balance(301.9))],
    signOut: signedOut,
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);
  act(() => {
    result.current.refresh();
  });
  await timePasses(0);

  act(() => {
    result.current.signOut();
  });
  await timePasses(0);
  expect(result.current.shown, "signed out").toMatchObject({
    screen: "sign-in",
  });
  await timePasses(5 * SECOND);

  // The late read ended after the server confirmed the sign-out: answered then (or aborted by the sign-out).
  const entries = timeline();
  const signedOutAt = entries.indexOf("answer POST /api/auth/logout");
  const lateReadEndedAt = entries.findLastIndex(
    (entry) =>
      entry === "answer GET /api/balance" ||
      entry === "aborted GET /api/balance",
  );
  expect(signedOutAt, "the server confirmed the sign-out").not.toBe(-1);
  expect(lateReadEndedAt, "the late read ended after it").toBeGreaterThan(
    signedOutAt,
  );
  expect(result.current.shown, "not shown").toMatchObject({
    screen: "sign-in",
  });
  expect(await keptBalance(), "not kept").toBeNull();
});

// D6: a failed sign-out keeps the visitor signed in on the account screen, with the balance shown and kept, and says so
// in its banner, offline or not.
const failedSignOuts: { label: string; offline: boolean }[] = [
  { label: "the phone is offline", offline: true },
  { label: "the server fails it", offline: false },
];

test.each(failedSignOuts)(
  "A failed sign-out keeps the screen and the stored balance and gives its banner, offline or not: $label",
  async ({ offline }) => {
    startTestClock();
    answerWith({
      whoIsSignedIn: LUCIE,
      balance: balance(286.4),
      signOut: serverError,
    });
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);
    if (offline) goOffline();

    act(() => {
      result.current.signOut();
    });
    await timePasses(0);

    expect(result.current.shown).toMatchObject({
      screen: "account",
      account: { name: "Lucie Nováková", email: "lucie@example.com" },
      header: { balance: { amount: 286.4 } },
      banner: { kind: "sign-out failed", offline },
    });
    expect(await keptBalance(), "still kept").toMatchObject({
      amount: 286.4,
    });
  },
);

// D2, D3 (code review of PR #59, finding 5): the waking-up screen stays after a wake only until that first read ends,
// and belongs to the first load only. Once the server has woken and answered, a later read is on an awake server: the
// stored header reads as refreshing ("Obnovuji…"), never the waking-up screen again.
test("Once the woken server has answered, reading again shows the stored balance refreshing, not the waking-up screen", async () => {
  startTestClock();
  await phoneKeeps(kept(286.4, ago(2 * HOUR)));
  answerWith({
    whoIsSignedIn: after(20 * SECOND, LUCIE),
    balance: [bankUnavailable, after(READ_TIME, balance(301.9))],
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(20 * SECOND);
  expect(
    result.current.shown,
    "the woken server's first read failed",
  ).toMatchObject({
    banner: { kind: "bank unavailable" },
  });

  // "Zkusit znovu" on the bank's banner.
  act(() => {
    result.current.retry();
  });
  await timePasses(0);

  expect(result.current.shown, "while the read runs").toMatchObject({
    screen: "account",
    header: { balance: { amount: 286.4 }, refreshing: true },
  });
  expect(result.current.shown, "no waking-up screen").not.toMatchObject({
    body: "waking",
  });
});

// Spec app-shell "A refresh with no answer counts as offline", D3 (code review of PR #59, finding 7): a read the user
// asks for after the first load is a refresh, whether or not a read has succeeded yet, so it has the 60 s cap too.
test("A refresh after a failed first read with no answer for 60 s ends as offline, the stored balance kept", async () => {
  startTestClock();
  await phoneKeeps(kept(286.4, ago(2 * HOUR)));
  answerWith({
    whoIsSignedIn: LUCIE,
    balance: [bankUnavailable, noAnswerYet, balance(301.9)],
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(result.current.shown, "the first read failed").toMatchObject({
    banner: { kind: "bank unavailable" },
  });

  // "Obnovit", and the network stalls.
  act(() => {
    result.current.refresh();
  });
  await timePasses(60 * SECOND);

  expect(result.current.shown, "at 60 s, offline").toMatchObject({
    screen: "account",
    header: { balance: { amount: 286.4 } },
    banner: { kind: "offline" },
  });
  act(() => {
    result.current.refresh();
  });
  await timePasses(0);
  expect(
    balanceReadsSent(),
    "the stalled read is over: a new one goes out",
  ).toBe(3);
});

// D2 (code review of PR #59, finding 9): the server woke only when its first answer took 1.5 s or more. A first
// question that got no answer at all, however long it took, is offline, not a woken server: back online, an awake
// server's read shows the stored header refreshing ("Obnovuji…"), never the waking-up screen.
test("A first question that fails with no answer after 1.5 s does not count as a woken server", async () => {
  startTestClock();
  await phoneKeeps(kept(286.4, ago(2 * HOUR)));
  answerWith({
    whoIsSignedIn: [after(5 * SECOND, noConnection), LUCIE],
    balance: after(READ_TIME, balance(301.9)),
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(5 * SECOND);
  expect(result.current.shown, "no answer: offline").toMatchObject({
    banner: { kind: "offline" },
  });

  // The phone's network comes back; who is signed in answers at once, and the balance read runs.
  goOffline();
  goOnline();
  await timePasses(0);

  expect(result.current.shown, "while the read runs").toMatchObject({
    screen: "account",
    header: { balance: { amount: 286.4 }, refreshing: true },
  });
  expect(result.current.shown, "no waking-up screen").not.toMatchObject({
    body: "waking",
  });
});

// D3, "Asking again who is signed in" (code review of PR #59, finding 8; the owner's choice, 2026-11-09): the moment
// the repeated question starts, the screen's problem goes, and the screen shows what it has (the stored balance in its
// default state) with no waking-up screen; the question has the 60 s cap, then ends as offline again.
test("Asking again who is signed in clears the offline banner while it runs, and ends as offline after 60 s", async () => {
  startTestClock();
  await phoneKeeps(kept(286.4, ago(2 * HOUR)));
  answerWith({
    whoIsSignedIn: [noConnection, noAnswerYet, LUCIE],
    balance: balance(301.9),
  });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(result.current.shown, "the first question: offline").toMatchObject({
    banner: { kind: "offline" },
  });

  // Back online: who is signed in is asked again, and the server does not answer.
  goOffline();
  goOnline();
  await timePasses(0);
  expect(result.current.shown, "the moment it is asked again").toMatchObject({
    banner: null,
  });
  await timePasses(59 * SECOND);
  expect(result.current.shown, "at 59 s, still asking").toMatchObject({
    screen: "account",
    header: { balance: { amount: 286.4 }, refreshing: false },
    banner: null,
  });
  expect(result.current.shown, "no waking-up screen").not.toMatchObject({
    body: "waking",
  });
  expect(result.current.shown, "no slow waking-up screen").not.toMatchObject({
    body: "waking slow",
  });

  await timePasses(SECOND);
  expect(result.current.shown, "at 60 s, offline again").toMatchObject({
    banner: { kind: "offline" },
  });

  // "Zkusit znovu" on the offline banner: the stalled question no longer blocks a new one.
  act(() => {
    result.current.retry();
  });
  await timePasses(0);
  expect(timesSent("GET /api/me"), "asked a third time").toBe(3);
});

// ---- c013: the upkeep of the phone's push subscription at a launch (design.md D1) ----
// The launch's upkeep starts the moment the screen learns that a user is signed in: the first answer to who is signed
// in, or a repeated one after the phone was offline or got an unexpected answer. It goes out with the balance read,
// never for a visitor, never on "Obnovit" or coming back online, and nothing it comes to shows on the screen. It is
// observed in what reaches the server (the push key read, the subscription sent); the phone's push is the test kit's
// stand-ins (src/test/push.ts). Every key and push address here is made up.

/** The push address of Lucie's phone at Apple's push service. */
const LUCIES_PHONE = "https://web.push.apple.com/lucies-phone";

/** The server's push key: 65 bytes starting 0x04, then 5i + 1; not the fake server's default. */
const SERVER_KEY =
  "BAYLEBUaHyQpLjM4PUJHTFFWW2Blam90eX6DiI2Sl5yhpquwtbq_xMnO09jd4ufs8fb7AAUKDxQZHiMoLTI3PEE";

/** The server while Lucie is signed in: her balance, and its push key. */
const LUCIES_SERVER: ServerAnswers = {
  whoIsSignedIn: LUCIE,
  balance: balance(286.4),
  pushKey: pushKey(SERVER_KEY),
};

const KEY_READ = "GET /api/push/key";
const SUBSCRIPTION_SENT = "PUT /api/push/subscription";

/**
 * Lucie's phone with notifications allowed, holding a subscription made with the server's key, so an upkeep sends it
 * again.
 */
function phoneSubscribed(more: PushStandInOptions = {}): PushStandIns {
  return installPushStandIns({
    permission: "granted",
    subscription: { endpoint: LUCIES_PHONE, applicationServerKey: SERVER_KEY },
    ...more,
  });
}

/** The requests the screen sent for push, in order. */
function pushRequestsSent(): string[] {
  return requests().filter((sent) => sent.includes(" /api/push/"));
}

/** The subscriptions sent to the server, in order, as their bodies. */
function subscriptionsSent(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === SUBSCRIPTION_SENT)
    .map((sent) => sent.body);
}

// ---- 4.1 ----

test("An upkeep starts once the server names a signed-in user, together with the balance read", async () => {
  startTestClock();
  const phone = phoneSubscribed();
  const held = phone.subscription()!;
  answerWith({
    ...LUCIES_SERVER,
    whoIsSignedIn: after(READ_TIME, LUCIE),
    balance: after(READ_TIME, balance(286.4)),
  });
  renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(pushRequestsSent(), "nothing before the server names her").toEqual([]);

  // The server names her: the balance read goes out, and the upkeep runs while it is under way.
  await timePasses(READ_TIME);
  expect(balanceReadsSent(), "the balance read under way").toBe(1);
  expect(timeline(), "the balance not answered yet").not.toContain(
    "answer GET /api/balance",
  );
  expect(subscriptionsSent(), "the subscription sent again").toEqual([
    held.toJSON(),
  ]);

  await timePasses(READ_TIME);
  expect(pushRequestsSent(), "one upkeep").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);
});

test("An upkeep starts once the server names a signed-in user, together with the balance read: the balance does not wait for it", async () => {
  startTestClock();
  phoneSubscribed();
  answerWith({ ...LUCIES_SERVER, pushKey: noAnswerYet });
  const { result } = renderHook(() => useAccountScreen());
  await timePasses(0);

  expect(pushRequestsSent(), "the upkeep waits for the key").toEqual([
    KEY_READ,
  ]);
  expect(result.current.shown, "the balance read and shown").toMatchObject({
    screen: "account",
    header: { balance: { amount: 286.4 }, refreshing: false },
  });
});

// ---- 4.2 ----

const visitors: {
  label: string;
  whoIsSignedIn: WhoIsSignedIn;
  screen: "sign-in" | "no access";
}[] = [
  {
    label: "the sign-in screen",
    whoIsSignedIn: nobodySignedIn,
    screen: "sign-in",
  },
  {
    label: "the no-access screen",
    whoIsSignedIn: refused("cizi.ucet@example.com"),
    screen: "no access",
  },
];

test.each(visitors)(
  "No upkeep starts for a visitor on the sign-in or the no-access screen: $label",
  async ({ whoIsSignedIn, screen }) => {
    startTestClock();
    phoneSubscribed();
    answerWith({ ...LUCIES_SERVER, whoIsSignedIn });
    const visit = renderHook(() => useAccountScreen());
    await timePasses(0);

    expect(visit.result.current.shown).toMatchObject({ screen });
    expect(pushRequestsSent(), "nothing for push").toEqual([]);

    // Then Lucie signs in, and the app opens for her (a new launch): the same phone's upkeep runs now.
    visit.unmount();
    closeApp();
    answerWith(LUCIES_SERVER);
    renderHook(() => useAccountScreen());
    await timePasses(0);
    expect(pushRequestsSent(), "for Lucie, signed in").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
  },
);

// ---- 4.3 ----

const repeatedQuestions: {
  label: string;
  first: WhoIsSignedIn;
  repeat: (screen: AccountScreenModel) => void;
}[] = [
  {
    label: "no answer at first, then the phone back online",
    first: noConnection,
    repeat: () => {
      goOffline();
      goOnline();
    },
  },
  {
    label: 'an unexpected answer at first, then "Zkusit znovu"',
    first: serverError,
    repeat: (screen) => {
      act(() => {
        screen.retry();
      });
    },
  },
];

test.each(repeatedQuestions)(
  "A repeated question that finds a signed-in user starts an upkeep: $label",
  async ({ first, repeat }) => {
    startTestClock();
    const phone = phoneSubscribed();
    const held = phone.subscription()!;
    answerWith({ ...LUCIES_SERVER, whoIsSignedIn: [first, LUCIE] });
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);
    expect(pushRequestsSent(), "who is signed in unanswered").toEqual([]);

    repeat(result.current);
    await timePasses(0);

    expect(timesSent("GET /api/me"), "asked again").toBe(2);
    expect(subscriptionsSent(), "the subscription sent again").toEqual([
      held.toJSON(),
    ]);
    expect(pushRequestsSent(), "one upkeep").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
  },
);

// ---- 4.4 ----

const repeatsThatAreNoOpening: {
  label: string;
  repeat: (screen: AccountScreenModel) => void;
}[] = [
  {
    label: '"Obnovit"',
    repeat: (screen) => {
      act(() => {
        screen.refresh();
      });
    },
  },
  {
    label: "the phone back online",
    repeat: () => {
      goOffline();
      goOnline();
    },
  },
];

test.each(repeatsThatAreNoOpening)(
  '"Obnovit" and coming back online start no upkeep: $label',
  async ({ repeat }) => {
    startTestClock();
    phoneSubscribed();
    answerWith(LUCIES_SERVER);
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);
    expect(pushRequestsSent(), "the launch's upkeep").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);

    repeat(result.current);
    await timePasses(0);

    expect(balanceReadsSent(), "the balance read again").toBe(2);
    expect(pushRequestsSent(), "no upkeep more").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
  },
);

// ---- 4.5 ----

/** What the screen shows: the screen itself, and the list in its slot. */
function onScreen(screen: AccountScreenModel): unknown {
  return { shown: screen.shown, list: screen.list.shown };
}

/**
 * What the screen shows after a launch on this server where no upkeep can run, with the same permission: notifications
 * allowed, but no service worker registered. The app is then closed and the phone emptied, for the launch compared with
 * it.
 */
async function onScreenWithNoUpkeep(server: ServerAnswers): Promise<unknown> {
  phoneSubscribed({ registered: false });
  answerWith(server);
  const { result, unmount } = renderHook(() => useAccountScreen());
  await timePasses(0);
  const seen = onScreen(result.current);
  unmount();
  closeApp();
  await emptyThePhone();
  return seen;
}

const upkeepOutcomes: {
  label: string;
  answers: ServerAnswers;
  pushRequests: string[];
}[] = [
  {
    label: "sent again",
    answers: { subscription: stored },
    pushRequests: [KEY_READ, SUBSCRIPTION_SENT],
  },
  {
    label: "stopped on a server error to the subscription sent",
    answers: { subscription: serverError },
    pushRequests: [KEY_READ, SUBSCRIPTION_SENT],
  },
  {
    label: "stopped on a refused subscription",
    answers: { subscription: subscriptionRefused("endpoint") },
    pushRequests: [KEY_READ, SUBSCRIPTION_SENT],
  },
  {
    label: "stopped on a server error to the key",
    answers: { pushKey: serverError },
    pushRequests: [KEY_READ],
  },
  {
    label: "still waiting for the key",
    answers: { pushKey: noAnswerYet },
    pushRequests: [KEY_READ],
  },
];

test.each(upkeepOutcomes)(
  "The upkeep's outcome changes nothing on the screen: $label",
  async ({ answers, pushRequests }) => {
    startTestClock();
    const server = { ...LUCIES_SERVER, ...answers };
    const withNoUpkeep = await onScreenWithNoUpkeep(server);

    phoneSubscribed();
    answerWith(server);
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);

    expect(pushRequestsSent(), "the upkeep ran").toEqual(pushRequests);
    expect(onScreen(result.current), "the same screen").toEqual(withNoUpkeep);
    expect(result.current.shown, "no banner").toMatchObject({ banner: null });
  },
);

// ---- c013: the upkeep at a return (design.md D1) ----
// A return to the screen (`watchReturns`) is an opening too: while a user is signed in, every return starts an upkeep,
// unless one is under way; then nothing is asked, and nothing is queued. Each upkeep has the 60 s limit, so one with no
// answer cannot block the next opening's. The kit's `leaveApp` and `returnToApp` turn the page hidden and visible.

/** The user leaves the app and comes back to it. */
function leavesAndReturns(): void {
  leaveApp();
  returnToApp();
}

// ---- 9.1 ----

test("Every return while a user is signed in starts an upkeep", async () => {
  startTestClock();
  const phone = phoneSubscribed();
  const held = phone.subscription()!;
  answerWith(LUCIES_SERVER);
  renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(pushRequestsSent(), "the launch's upkeep").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);

  leavesAndReturns();
  await timePasses(0);
  leavesAndReturns();
  await timePasses(0);

  expect(pushRequestsSent(), "one upkeep per return").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
    KEY_READ,
    SUBSCRIPTION_SENT,
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);
  expect(subscriptionsSent(), "sent again each time").toEqual([
    held.toJSON(),
    held.toJSON(),
    held.toJSON(),
  ]);
});

const loginsThatEnd: {
  label: string;
  ended: BalanceAnswer;
  screen: "sign-in" | "no access";
}[] = [
  {
    label: "the sign-in screen",
    ended: nobodySignedIn,
    screen: "sign-in",
  },
  {
    label: "the no-access screen",
    ended: refused("cizi.ucet@example.com"),
    screen: "no access",
  },
];

test.each(loginsThatEnd)(
  "Every return while a user is signed in starts an upkeep: none on $label, once the login has ended",
  async ({ ended, screen }) => {
    startTestClock();
    phoneSubscribed();
    answerWith({
      ...LUCIES_SERVER,
      balance: [balance(286.4), balance(286.4), ended],
    });
    const { result } = renderHook(() => useAccountScreen());
    await timePasses(0);
    leavesAndReturns();
    await timePasses(0);
    expect(pushRequestsSent(), "the launch's, and a return's").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);

    // "Obnovit": the balance read finds the login ended.
    act(() => {
      result.current.refresh();
    });
    await timePasses(0);
    expect(result.current.shown).toMatchObject({ screen });

    leavesAndReturns();
    await timePasses(0);
    expect(pushRequestsSent(), "nothing more on that screen").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
  },
);

// ---- 9.2 ----

test("A return while an upkeep runs starts none", async () => {
  startTestClock();
  const phone = phoneSubscribed();
  const held = phone.subscription()!;
  answerWith({
    ...LUCIES_SERVER,
    pushKey: [after(5 * SECOND, pushKey(SERVER_KEY)), pushKey(SERVER_KEY)],
  });
  renderHook(() => useAccountScreen());
  await timePasses(0);
  expect(pushRequestsSent(), "the launch's upkeep waits for the key").toEqual([
    KEY_READ,
  ]);

  leavesAndReturns();
  await timePasses(0);
  expect(pushRequestsSent(), "a return while it runs: none").toEqual([
    KEY_READ,
  ]);

  await timePasses(5 * SECOND);
  expect(pushRequestsSent(), "the launch's upkeep ends; none queued").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);

  leavesAndReturns();
  await timePasses(0);
  expect(pushRequestsSent(), "the next return: exactly one").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);
  expect(subscriptionsSent()).toEqual([held.toJSON(), held.toJSON()]);
});

// ---- 9.3 ----

const upkeepsWithNoAnswer: {
  label: string;
  request: string;
  answers: ServerAnswers;
}[] = [
  {
    label: "the key read",
    request: KEY_READ,
    answers: { pushKey: [noAnswerYet, pushKey(SERVER_KEY)] },
  },
  {
    label: "the subscription sent",
    request: SUBSCRIPTION_SENT,
    answers: { subscription: [noAnswerYet, stored] },
  },
];

test.each(upkeepsWithNoAnswer)(
  "An upkeep with no answer after 60 s is aborted, and the next opening starts a new one: $label",
  async ({ request, answers }) => {
    startTestClock();
    phoneSubscribed();
    answerWith({ ...LUCIES_SERVER, ...answers });
    renderHook(() => useAccountScreen());
    await timePasses(0);
    const launchs = pushRequestsSent();
    expect(launchs.at(-1), "the launch's upkeep waits").toBe(request);

    await timePasses(59 * SECOND);
    expect(timeline(), "at 59 s, still waiting").not.toContain(
      `aborted ${request}`,
    );
    await timePasses(SECOND);
    expect(timeline(), "at 60 s, aborted").toContain(`aborted ${request}`);

    leavesAndReturns();
    await timePasses(0);
    expect(pushRequestsSent(), "the next return starts a new one").toEqual([
      ...launchs,
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
    expect(
      timeline().filter((entry) => entry === `answer ${SUBSCRIPTION_SENT}`),
      "the new one's subscription stored",
    ).toHaveLength(1);
  },
);
