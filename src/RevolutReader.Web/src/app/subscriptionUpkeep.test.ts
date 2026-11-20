import { expect, test } from "vitest";
import { startTestClock, timePasses } from "../test/clock";
import {
  installPushStandIns,
  type PushFeature,
  type PushStandInOptions,
  type PushStandIns,
  type SubscriptionInit,
} from "../test/push";
import {
  answerWith,
  bodiesSent,
  goOffline,
  hostingErrorPage,
  jsonBody,
  noAnswerYet,
  noConnection,
  pushKey,
  requests,
  serverError,
  stored,
  subscriptionRefused,
  timeline,
  unreadable,
  wifiLoginPage,
  type PushKeyAnswer,
  type ServerAnswers,
  type SubscriptionAnswer,
} from "../test/server";
import {
  keepSubscriptionUp,
  pushRegistration,
  type UpkeepOutcome,
} from "./subscriptionUpkeep";

// Keeping this device's push subscription right (c013 design.md D1–D6). The browser's push is the test kit's stand-ins
// (src/test/push.ts), installed per test and removed after it; without them the browser cannot push, as jsdom as it
// is. A browser of the test's own, given instead of the window, is a plain object. The server is the fake one
// (src/test/server.ts): what it answered and what the app sent it. Every key and address here is made up.

/** A registration of the test's own, known by its identity. */
function aRegistrationOfItsOwn(): ServiceWorkerRegistration {
  return {
    scope: `${location.origin}/`,
  } as unknown as ServiceWorkerRegistration;
}

/**
 * A browser of the test's own, given to the function instead of the window: a service worker that answers
 * `getRegistration` as the test says, `Notification`, and `PushManager` unless left out.
 */
function aBrowserOfItsOwn(options: {
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  withoutPushManager?: boolean;
}): Window {
  return {
    navigator: { serviceWorker: { getRegistration: options.getRegistration } },
    ...(options.withoutPushManager === true ? {} : { PushManager: class {} }),
    Notification: class {},
  } as unknown as Window;
}

// ---- 2.1 ----

test("The registration is the one the browser has registered", async () => {
  const browser = installPushStandIns({ permission: "granted" });

  expect(await pushRegistration()).toBe(browser.registration);
});

test("The registration is the one the browser has registered: the browser given, not the window", async () => {
  installPushStandIns({ permission: "granted" });
  const theirs = aRegistrationOfItsOwn();

  expect(
    await pushRegistration(
      aBrowserOfItsOwn({ getRegistration: () => Promise.resolve(theirs) }),
    ),
  ).toBe(theirs);
});

// ---- 2.2 ----

test("There is no registration where the browser cannot push: none of push's features (jsdom as it is)", async () => {
  expect(await pushRegistration()).toBeNull();
});

const missingFeatures: { feature: PushFeature }[] = [
  { feature: "service worker" },
  { feature: "PushManager" },
  { feature: "Notification" },
];

test.each(missingFeatures)(
  "There is no registration where the browser cannot push: without $feature",
  async ({ feature }) => {
    installPushStandIns({ permission: "granted", without: [feature] });

    expect(await pushRegistration()).toBeNull();
  },
);

test("There is no registration where the browser cannot push: the browser given, though the window can", async () => {
  installPushStandIns({ permission: "granted" });
  const theirs = aRegistrationOfItsOwn();

  expect(
    await pushRegistration(
      aBrowserOfItsOwn({
        getRegistration: () => Promise.resolve(theirs),
        withoutPushManager: true,
      }),
    ),
  ).toBeNull();
});

// ---- 2.3 ----

test("There is no registration when no worker is registered, and nothing waits for one", async () => {
  startTestClock();
  // A service worker, but none registered (Vite's dev server): `ready` would never settle.
  installPushStandIns({ permission: "granted", registered: false });

  const asking = pushRegistration();
  // What is due now happens; the clock does not move.
  const nothingMoves = timePasses(0);
  const first = await Promise.race([
    asking,
    nothingMoves.then(() => "still waiting" as const),
  ]);
  await nothingMoves;

  expect(first).toBeNull();
});

// ---- 2.4 ----

test("A failure to ask for the registration reads as none: the browser refuses to answer", async () => {
  installPushStandIns({
    permission: "granted",
    registrationFails: new DOMException(
      "The operation is insecure.",
      "SecurityError",
    ),
  });

  expect(await pushRegistration()).toBeNull();
});

test("A failure to ask for the registration reads as none: asking throws at once", async () => {
  const browser = aBrowserOfItsOwn({
    getRegistration: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });

  expect(await pushRegistration(browser)).toBeNull();
});

// ---- keepSubscriptionUp: Lucie's phone, the server, and one upkeep ----

/** The push address of Lucie's phone at Apple's push service. */
const LUCIES_PHONE = "https://web.push.apple.com/lucies-phone";

/**
 * The server's push key: 65 bytes starting 0x04 (a public key's form), then 5i + 1. It differs from the fake server's
 * `DEFAULT_PUSH_KEY`, so a key that never came from the server cannot pass.
 */
const SERVER_KEY =
  "BAYLEBUaHyQpLjM4PUJHTFFWW2Blam90eX6DiI2Sl5yhpquwtbq_xMnO09jd4ufs8fb7AAUKDxQZHiMoLTI3PEE";

/** The server while Lucie is signed in: its push key, and the device stored when sent. */
const THE_SERVER: ServerAnswers = {
  pushKey: pushKey(SERVER_KEY),
  subscription: stored,
};

const KEY_READ = "GET /api/push/key";
const SUBSCRIPTION_SENT = "PUT /api/push/subscription";

/**
 * Lucie's phone with notifications allowed, holding a subscription at her push address made with `key` (`null`: a key
 * the browser does not name).
 */
function phoneSubscribedWith(
  key: string | null,
  more: PushStandInOptions = {},
): PushStandIns {
  return installPushStandIns({
    permission: "granted",
    subscription: { endpoint: LUCIES_PHONE, applicationServerKey: key },
    ...more,
  });
}

/** One upkeep while the login stays on, as the screen starts it, with the given limit. */
function anUpkeep(signal?: AbortSignal): Promise<UpkeepOutcome> {
  return keepSubscriptionUp({ stillSignedIn: () => true, signal });
}

/** The subscriptions the app sent to the server, in order, as their bodies. */
function subscriptionsSent(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === SUBSCRIPTION_SENT)
    .map((sent) => sent.body);
}

/**
 * Where a running upkeep stands once what is due now has happened, the test clock not moving: what it came to, or
 * still running.
 */
async function whereItStands(
  upkeep: Promise<UpkeepOutcome>,
): Promise<UpkeepOutcome | "still running"> {
  const nothingMoves = timePasses(0);
  try {
    return await Promise.race([
      upkeep,
      nothingMoves.then(() => "still running" as const),
    ]);
  } finally {
    await nothingMoves;
  }
}

// ---- 3.1 ----

test("A subscription made with the server's key is sent again, and the phone keeps it", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "sent again" });
  expect(subscriptionsSent(), "sent again, as it is").toEqual([held.toJSON()]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
  expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
});

// ---- 3.2 ----

test("A subscription whose key the browser does not name is sent again as it is, never replaced", async () => {
  const phone = phoneSubscribedWith(null);
  const held = phone.subscription()!;
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "sent again" });
  expect(subscriptionsSent(), "sent again, as it is").toEqual([held.toJSON()]);
  expect(requests(), "the server never asked to forget it").not.toContain(
    "DELETE /api/push/subscription",
  );
  expect(phone.subscription(), "the phone keeps it").toBe(held);
  expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
});

/**
 * Another key of the same form, 0x04 then 200 − 3i: here it made the subscription, but the browser does not say so, so
 * nothing on the phone tells the app it is another key.
 */
const OLD_KEY =
  "BMXCv7y5trOwraqnpKGem5iVko-MiYaDgH16d3RxbmtoZWJfXFlWU1BNSkdEQT47ODUyLywpJiMgHRoXFBEOCwg";

const keysLeftOut: {
  label: string;
  leavesOut: NonNullable<SubscriptionInit["leavesOut"]>;
}[] = [
  {
    label: "the browser leaves the key out of the subscription's options",
    leavesOut: "applicationServerKey",
  },
  {
    label: "the browser gives the subscription no options at all",
    leavesOut: "options",
  },
];

test.each(keysLeftOut)(
  "A subscription whose key the browser does not name is sent again as it is, never replaced: $label",
  async ({ leavesOut }) => {
    const phone = installPushStandIns({
      permission: "granted",
      subscription: {
        endpoint: LUCIES_PHONE,
        applicationServerKey: OLD_KEY,
        leavesOut,
      },
    });
    const held = phone.subscription()!;
    answerWith(THE_SERVER);

    expect(await anUpkeep()).toEqual({ kind: "sent again" });
    expect(subscriptionsSent(), "sent again, as it is").toEqual([
      held.toJSON(),
    ]);
    expect(requests(), "the server never asked to forget it").not.toContain(
      "DELETE /api/push/subscription",
    );
    expect(phone.subscription(), "the phone keeps it").toBe(held);
    expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
  },
);

// ---- 3.3 ----

test("The upkeep reads the server's key before it compares, and its requests carry the given signal: the key first, then the subscription", async () => {
  phoneSubscribedWith(SERVER_KEY);
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "sent again" });
  expect(requests()).toEqual([KEY_READ, SUBSCRIPTION_SENT]);
});

test("The upkeep reads the server's key before it compares, and its requests carry the given signal: every upkeep reads it afresh", async () => {
  phoneSubscribedWith(SERVER_KEY);
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "sent again" });
  expect(await anUpkeep()).toEqual({ kind: "sent again" });
  expect(requests()).toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);
});

test("The upkeep reads the server's key before it compares, and its requests carry the given signal: the key read with no answer ends with the signal, and nothing more is sent", async () => {
  startTestClock();
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith({ pushKey: noAnswerYet });
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the key").toBe(
    "still running",
  );

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(timeline()).toContain(`aborted ${KEY_READ}`);
  expect(requests(), "nothing more sent").toEqual([KEY_READ]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
});

test("The upkeep reads the server's key before it compares, and its requests carry the given signal: the subscription sent with no answer ends with the signal", async () => {
  startTestClock();
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith({ pushKey: pushKey(SERVER_KEY), subscription: noAnswerYet });
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the server").toBe(
    "still running",
  );
  expect(requests()).toEqual([KEY_READ, SUBSCRIPTION_SENT]);

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(timeline()).toContain(`aborted ${SUBSCRIPTION_SENT}`);
  expect(requests(), "nothing more sent").toEqual([
    KEY_READ,
    SUBSCRIPTION_SENT,
  ]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
});

// ---- 3.4 ----

const keysItCannotRead: { label: string; answer: PushKeyAnswer }[] = [
  { label: "a server error", answer: serverError },
  { label: "a hosting error page", answer: hostingErrorPage },
  { label: "a body without the key", answer: unreadable },
  { label: "a key that is not text", answer: jsonBody({ publicKey: 42 }) },
  { label: "a Wi-Fi login page", answer: wifiLoginPage },
  { label: "no answer, offline", answer: noConnection },
];

test.each(keysItCannotRead)(
  "An answer the app cannot read, offline, or a refused subscription stops the upkeep quietly: the key read, $label",
  async ({ answer }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription()!;
    answerWith({ pushKey: answer });

    expect(await anUpkeep()).toEqual({ kind: "stopped" });
    expect(requests(), "nothing more sent").toEqual([KEY_READ]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
    expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
  },
);

test("An answer the app cannot read, offline, or a refused subscription stops the upkeep quietly: the phone says it is offline, nothing sent", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith(THE_SERVER);
  goOffline();

  expect(await anUpkeep()).toEqual({ kind: "stopped" });
  expect(requests()).toEqual([]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
  expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
});

const subscriptionsNotStored: { label: string; answer: SubscriptionAnswer }[] =
  [
    { label: "refused by the server", answer: subscriptionRefused("endpoint") },
    { label: "a server error", answer: serverError },
    { label: "a hosting error page", answer: hostingErrorPage },
    { label: "a 200 the app does not expect", answer: unreadable },
    { label: "a Wi-Fi login page", answer: wifiLoginPage },
    { label: "no answer, offline", answer: noConnection },
  ];

test.each(subscriptionsNotStored)(
  "An answer the app cannot read, offline, or a refused subscription stops the upkeep quietly: the subscription sent, $label",
  async ({ answer }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription()!;
    answerWith({ pushKey: pushKey(SERVER_KEY), subscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "stopped" });
    expect(requests(), "sent once, nothing more").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
    expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
  },
);

// ---- 3.5 ----

const upkeepsThatEnd: {
  label: string;
  key: string | null;
  answers: ServerAnswers;
  outcome: UpkeepOutcome;
}[] = [
  {
    label: "sent again",
    key: SERVER_KEY,
    answers: THE_SERVER,
    outcome: { kind: "sent again" },
  },
  {
    label: "sent again, its key not named",
    key: null,
    answers: THE_SERVER,
    outcome: { kind: "sent again" },
  },
  {
    label: "stopped on a key it cannot read",
    key: SERVER_KEY,
    answers: { pushKey: unreadable },
    outcome: { kind: "stopped" },
  },
  {
    label: "stopped on a refused subscription",
    key: SERVER_KEY,
    answers: {
      pushKey: pushKey(SERVER_KEY),
      subscription: subscriptionRefused("keys.p256dh"),
    },
    outcome: { kind: "stopped" },
  },
];

test.each(upkeepsThatEnd)(
  "The upkeep never asks for the notification permission and never throws: $label",
  async ({ key, answers, outcome }) => {
    const phone = phoneSubscribedWith(key);
    answerWith(answers);

    await expect(anUpkeep()).resolves.toEqual(outcome);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test("The upkeep never asks for the notification permission and never throws: the browser fails to say which subscription it holds", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY, {
    getSubscriptionFails: new DOMException(
      "Getting the subscription failed.",
      "AbortError",
    ),
  });
  answerWith(THE_SERVER);

  await expect(anUpkeep()).resolves.toEqual({ kind: "stopped" });
  expect(bodiesSent(), "nothing sent or forgotten").toEqual([]);
  expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});
