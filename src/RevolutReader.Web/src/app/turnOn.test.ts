import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import { installPushStandIns } from "../test/push";
import {
  after,
  answerWith,
  bodiesSent,
  goOffline,
  hostingErrorPage,
  navigations,
  noAnswerYet,
  noConnection,
  nobodySignedIn,
  pushKey,
  refused,
  requests,
  serverError,
  stored,
  subscriptionRefused,
  timeline,
  unreadable,
} from "../test/server";
import { serviceWorkerNeverReady } from "../test/serviceWorkerReady";
import { turnNotificationsOn, type TurnOnOutcome } from "./turnOn";

// Turning notifications on (c012 design.md D3): the phone is asked right from the tap, and once it allows them the app
// subscribes with the server's key and sends the subscription. The phone's notifications and push are the test kit's
// stand-ins (src/test/push.ts), the server the fake server (src/test/server.ts). Every key here is made up. The
// offline failures and the 60 s limit (group 33) and the "later" failures (group 37) are below.

/** The server's push key: made up, 65 bytes starting 0x04 (c011 D5's form), then 1, 2, …, 64. */
const SERVER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) =>
  i === 0 ? 4 : i,
);
const SERVER_KEY =
  "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

test("The phone is asked for permission before anything is awaited", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });

  const turning = turnNotificationsOn();

  expect(
    phone.permissionRequests(),
    "asked before the call returned, so within the tap",
  ).toBe(1);
  expect(requests(), "nothing asked of the server before the phone").toEqual(
    [],
  );
  await turning;
});

test("Once allowed, the app subscribes with the server's key, for visible pushes only, and sends the subscription", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });
  answerWith({ pushKey: pushKey(SERVER_KEY), subscription: stored });

  await turnNotificationsOn();

  expect(phone.subscribeRequests()).toEqual([
    { userVisibleOnly: true, applicationServerKey: SERVER_KEY_BYTES },
  ]);
  const subscription = phone.subscription();
  expect(subscription, "the phone holds the subscription").not.toBeNull();
  expect(requests()).toEqual([
    "GET /api/push/key",
    "PUT /api/push/subscription",
  ]);
  expect(bodiesSent()).toEqual([
    {
      request: "PUT /api/push/subscription",
      contentType: "application/json",
      body: subscription?.toJSON(),
    },
  ]);
});

test('The server keeping the subscription is "on"', async () => {
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  answerWith({ pushKey: pushKey(SERVER_KEY), subscription: stored });

  expect(await turnNotificationsOn()).toEqual({ kind: "on" });
});

test('A declined question is "declined", and nothing is sent to the server', async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "denied",
  });

  expect(await turnNotificationsOn()).toEqual({ kind: "declined" });
  expect(requests(), "no key read, no subscription sent").toEqual([]);
  expect(phone.subscribeRequests(), "no subscription made").toEqual([]);
});

test('A question closed without an answer is "undecided", and nothing is sent to the server', async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "default",
  });

  expect(await turnNotificationsOn()).toEqual({ kind: "undecided" });
  expect(requests(), "no key read, no subscription sent").toEqual([]);
  expect(phone.subscribeRequests(), "no subscription made").toEqual([]);
});

// ---- group 33: failing offline (D8) ----
// Offline when a request found the phone offline or got no answer (C8a's kinds), or when the browser's `subscribe`
// failed while `navigator.onLine` is false. Everything after the phone's answer shares one 60 s limit, on the test
// clock: an unanswered request then ends as offline, a service worker still not ready as "later".

/** The limit on everything after the phone's answer (D8). */
const LIMIT = 60 * SECOND;

/** Turns notifications on, keeping the outcome once it comes, so a test can see it has not come yet. */
function turningOn(): { outcome(): TurnOnOutcome | undefined } {
  let outcome: TurnOnOutcome | undefined;
  void turnNotificationsOn().then((value) => {
    outcome = value;
  });
  return { outcome: () => outcome };
}

test("With the phone offline after the answer, nothing is sent and turning on fails as offline", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });
  goOffline();

  const outcome = await turnNotificationsOn();

  expect(phone.permissionRequests(), "the phone answered").toBe(1);
  expect(outcome).toEqual({ kind: "failed", offline: true });
  expect(requests(), "nothing sent").toEqual([]);
  expect(phone.subscription(), "no subscription held").toBeNull();
});

test.each([
  { request: "the key read", answers: { pushKey: noConnection } },
  {
    request: "the subscription sent",
    answers: { pushKey: pushKey(SERVER_KEY), subscription: noConnection },
  },
])(
  "A request with no answer makes turning on fail as offline: $request",
  async ({ answers }) => {
    installPushStandIns({ permission: "default", permissionAnswer: "granted" });
    answerWith(answers);

    expect(await turnNotificationsOn()).toEqual({
      kind: "failed",
      offline: true,
    });
  },
);

// One limit for all the requests, from the phone's answer: a key that took 30 s leaves the subscription 30 s.
test.each([
  {
    request: "the key read",
    answers: { pushKey: noAnswerYet },
    givenUp: "aborted GET /api/push/key",
  },
  {
    request: "the subscription sent, after the key took 30 s",
    answers: {
      pushKey: after(30 * SECOND, pushKey(SERVER_KEY)),
      subscription: noAnswerYet,
    },
    givenUp: "aborted PUT /api/push/subscription",
  },
])(
  "With no outcome 60 seconds after the phone's answer, the requests are given up and turning on fails as offline: $request",
  async ({ answers, givenUp }) => {
    startTestClock();
    installPushStandIns({ permission: "default", permissionAnswer: "granted" });
    answerWith(answers);

    const turning = turningOn();
    await timePasses(LIMIT - 1);

    expect(turning.outcome(), "still turning on just before 60 s").toBe(
      undefined,
    );

    await timePasses(1);

    expect(turning.outcome()).toEqual({ kind: "failed", offline: true });
    expect(timeline(), "the request given up").toContain(givenUp);
  },
);

test("A service worker not ready within 60 seconds makes turning on fail, not as offline", async () => {
  startTestClock();
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  serviceWorkerNeverReady();

  const turning = turningOn();
  await timePasses(LIMIT - 1);

  expect(turning.outcome(), "still turning on just before 60 s").toBe(
    undefined,
  );

  await timePasses(1);

  expect(turning.outcome()).toEqual({ kind: "failed", offline: false });
});

// The phone loses its network as the app subscribes, after the key was read, and the browser cannot reach its push
// service. The error is Chrome's when it cannot reach its push service (an `AbortError`, "push service error"); no
// specification names one for this case.
test("A subscription the browser refuses while the phone is offline fails as offline", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
    subscribeFails: new DOMException(
      "Registration failed - push service error",
      "AbortError",
    ),
  });
  const pushManager = phone.registration.pushManager;
  const subscribe = pushManager.subscribe.bind(pushManager);
  Object.defineProperty(pushManager, "subscribe", {
    configurable: true,
    value: (options?: PushSubscriptionOptionsInit) => {
      goOffline();
      return subscribe(options);
    },
  });
  answerWith({ pushKey: pushKey(SERVER_KEY) });

  const outcome = await turnNotificationsOn();

  expect(phone.subscribeRequests(), "the browser was asked").toHaveLength(1);
  expect(outcome).toEqual({ kind: "failed", offline: true });
  expect(requests(), "the key read, nothing sent after it").toEqual([
    "GET /api/push/key",
  ]);
});

// ---- group 37: failing later (D8) ----
// Every failure that is not offline is "later" ("Zkus to prosím za chvíli."): a 400, a 5xx, an unreadable answer, a
// 401 or 403 (a failure here, not an ended login: the next read on return routes it), a `subscribe` the browser refused
// while online, and a subscription made with another key (C8c replaces it).

const LATER = { kind: "failed", offline: false } as const;

test.each([
  { label: "the key read, a server error", answers: { pushKey: serverError } },
  {
    label: "the key read, the hosting's error page",
    answers: { pushKey: hostingErrorPage },
  },
  {
    label: "the key read, an unreadable answer",
    answers: { pushKey: unreadable },
  },
  {
    label: "the subscription sent, a server error",
    answers: { pushKey: pushKey(SERVER_KEY), subscription: serverError },
  },
  {
    label: "the subscription sent, refused by the server",
    answers: {
      pushKey: pushKey(SERVER_KEY),
      subscription: subscriptionRefused("keys.p256dh"),
    },
  },
  {
    label: "the subscription sent, an unreadable answer",
    answers: { pushKey: pushKey(SERVER_KEY), subscription: unreadable },
  },
])(
  "A server error, a refused subscription or an unreadable answer makes turning on fail, not as offline: $label",
  async ({ answers }) => {
    installPushStandIns({ permission: "default", permissionAnswer: "granted" });
    answerWith(answers);

    expect(await turnNotificationsOn()).toEqual(LATER);
  },
);

test.each([
  { label: "the key read, 401", answers: { pushKey: nobodySignedIn } },
  {
    label: "the key read, 403",
    answers: { pushKey: refused("lucie@example.com") },
  },
  {
    label: "the subscription sent, 401",
    answers: { pushKey: pushKey(SERVER_KEY), subscription: nobodySignedIn },
  },
  {
    label: "the subscription sent, 403",
    answers: {
      pushKey: pushKey(SERVER_KEY),
      subscription: refused("lucie@example.com"),
    },
  },
])(
  "A 401 or 403 while turning on fails, not as offline: $label",
  async ({ answers }) => {
    installPushStandIns({ permission: "default", permissionAnswer: "granted" });
    answerWith(answers);

    expect(await turnNotificationsOn()).toEqual(LATER);
    expect(navigations(), "not sent to sign in").toEqual([]);
  },
);

test("A subscription the browser refuses while online fails, not as offline", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
    subscribeFails: true,
  });
  answerWith({ pushKey: pushKey(SERVER_KEY) });

  expect(await turnNotificationsOn()).toEqual(LATER);
  expect(phone.subscribeRequests(), "the browser was asked").toHaveLength(1);
  expect(requests(), "the key read, nothing sent after it").toEqual([
    "GET /api/push/key",
  ]);
});

test("A subscription made with another key makes turning on fail, not as offline", async () => {
  // Another made-up key: 65 bytes starting 0x04, then 0x07 each.
  const anotherKey = Uint8Array.from({ length: 65 }, (_, i) =>
    i === 0 ? 4 : 7,
  );
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
    subscription: { applicationServerKey: anotherKey },
  });
  const old = phone.subscription();
  answerWith({ pushKey: pushKey(SERVER_KEY) });

  expect(await turnNotificationsOn()).toEqual(LATER);
  expect(requests(), "the key read, nothing sent after it").toEqual([
    "GET /api/push/key",
  ]);
  expect(phone.subscription(), "the old subscription left to C8c").toBe(old);
});
