import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import {
  installPushStandIns,
  type PushFeature,
  type PushStandInOptions,
  type PushStandIns,
  type SubscriptionInit,
} from "../test/push";
import {
  after,
  answerWith,
  bodiesSent,
  forgotten,
  goOffline,
  hostingErrorPage,
  jsonBody,
  noAnswerYet,
  nobodySignedIn,
  noConnection,
  problemOf,
  pushKey,
  refused,
  requests,
  serverError,
  stored,
  subscriptionRefused,
  timeline,
  unreadable,
  wifiLoginPage,
  type ForgetAnswer,
  type PushKeyAnswer,
  type ServerAnswers,
  type SubscriptionAnswer,
} from "../test/server";
import {
  forgetThisDevice,
  keepSubscriptionUp,
  pushRegistration,
  unsubscribeThisDevice,
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
 * `getRegistration` as the test says, `Notification` with its `permission` (by default `default`), and `PushManager`
 * unless left out.
 */
function aBrowserOfItsOwn(options: {
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  withoutPushManager?: boolean;
  permission?: NotificationPermission;
}): Window {
  return {
    navigator: { serviceWorker: { getRegistration: options.getRegistration } },
    ...(options.withoutPushManager === true ? {} : { PushManager: class {} }),
    Notification: { permission: options.permission ?? "default" },
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
 * Where a running upkeep (or forget) stands once what is due now has happened, the test clock not moving: what it came
 * to, or still running.
 */
async function whereItStands<Outcome>(
  running: Promise<Outcome>,
): Promise<Outcome | "still running"> {
  const nothingMoves = timePasses(0);
  try {
    return await Promise.race([
      running,
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
 * Another key of the same form, 0x04 then 200 − 3i: a key the server had before, which made the phone's subscription.
 * Here the browser does not say so, so nothing on the phone tells the app it is another key; in group 13's tests it
 * does.
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

test("The upkeep never asks for the notification permission and never throws: the browser does not say which subscription it holds before the limit", async () => {
  startTestClock();
  // The browser's own call takes no signal: the upkeep stops waiting for it when the limit fires (D1).
  const phone = phoneSubscribedWith(SERVER_KEY, { getSubscriptionWaits: true });
  const held = phone.subscription()!;
  answerWith(THE_SERVER);
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the browser").toBe(
    "still running",
  );

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(requests(), "nothing sent after the key").toEqual([KEY_READ]);

  phone.letWaitingCallsSettle();
  await timePasses(0);

  expect(requests(), "nothing sent once the browser answers late").toEqual([
    KEY_READ,
  ]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
  expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

// ---- Only while notifications are allowed (D1, "When") ----

/** Lucie's phone with this permission, holding a subscription made with the server's key, or none. */
function phoneWithPermission(
  permission: NotificationPermission,
  holds: boolean,
): PushStandIns {
  return installPushStandIns({
    permission,
    ...(holds
      ? {
          subscription: {
            endpoint: LUCIES_PHONE,
            applicationServerKey: SERVER_KEY,
          },
        }
      : {}),
  });
}

/**
 * Nothing was asked of the server or the phone: no request at all, not even the key read; no permission asked; nothing
 * subscribed; the subscription it held (or none) still held.
 */
function expectNothingDone(
  phone: PushStandIns,
  held: PushSubscription | null,
): void {
  expect(requests(), "nothing sent, not even the key read").toEqual([]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(phone.subscription(), "the phone's subscription untouched").toBe(held);
}

const heldOrNot: { label: string; holds: boolean }[] = [
  { label: "a subscription held", holds: true },
  { label: "none held", holds: false },
];

// ---- 6.1 ----

test.each(heldOrNot)(
  "Nothing is asked, subscribed or sent while the permission is `default`, even with a subscription held: $label",
  async ({ holds }) => {
    const phone = phoneWithPermission("default", holds);
    const held = phone.subscription();
    answerWith(THE_SERVER);

    expect(await anUpkeep()).toEqual({ kind: "not allowed" });
    expectNothingDone(phone, held);
  },
);

test("Nothing is asked, subscribed or sent while the permission is `default`, even with a subscription held: the browser given, not the window", async () => {
  // The window's permission is granted; the browser given says `default`.
  const phone = phoneWithPermission("granted", true);
  const held = phone.subscription();
  answerWith(THE_SERVER);
  const browser = aBrowserOfItsOwn({
    getRegistration: () => Promise.resolve(phone.registration),
    permission: "default",
  });

  expect(
    await keepSubscriptionUp({ stillSignedIn: () => true, browser }),
  ).toEqual({ kind: "not allowed" });
  expectNothingDone(phone, held);
});

// ---- 6.2 ----

test.each(heldOrNot)(
  "Nothing is asked, subscribed or sent while the permission is `denied`: $label",
  async ({ holds }) => {
    const phone = phoneWithPermission("denied", holds);
    const held = phone.subscription();
    answerWith(THE_SERVER);

    expect(await anUpkeep()).toEqual({ kind: "not allowed" });
    expectNothingDone(phone, held);
  },
);

// ---- 6.3 ----

test("Nothing is done where the browser cannot push, or no worker is registered: none of push's features (jsdom as it is)", async () => {
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "not allowed" });
  expect(requests(), "nothing sent, not even the key read").toEqual([]);
});

test.each(missingFeatures)(
  "Nothing is done where the browser cannot push, or no worker is registered: without $feature",
  async ({ feature }) => {
    const phone = phoneSubscribedWith(SERVER_KEY, { without: [feature] });
    const held = phone.subscription();
    answerWith(THE_SERVER);

    expect(await anUpkeep()).toEqual({ kind: "not allowed" });
    expectNothingDone(phone, held);
  },
);

test("Nothing is done where the browser cannot push, or no worker is registered: no worker registered", async () => {
  // A service worker, but none registered (Vite's dev server).
  const phone = phoneSubscribedWith(SERVER_KEY, { registered: false });
  const held = phone.subscription();
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "not allowed" });
  expectNothingDone(phone, held);
});

test("Nothing is done where the browser cannot push, or no worker is registered: the browser given cannot push, though the window can", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription();
  answerWith(THE_SERVER);
  const browser = aBrowserOfItsOwn({
    getRegistration: () => Promise.resolve(phone.registration),
    withoutPushManager: true,
    permission: "granted",
  });

  expect(
    await keepSubscriptionUp({ stillSignedIn: () => true, browser }),
  ).toEqual({ kind: "not allowed" });
  expectNothingDone(phone, held);
});

// ---- Subscribing again (D1, step 4): the phone holds none ----

/**
 * Lucie's phone with notifications allowed, holding no subscription: the browser dropped it, or she signed out and in
 * again.
 */
function phoneHoldingNone(more: PushStandInOptions = {}): PushStandIns {
  return installPushStandIns({ permission: "granted", ...more });
}

/**
 * What the phone was asked to subscribe with, in order: `userVisibleOnly` as given, and the key as base64url text,
 * whether the app gave it as bytes or as text.
 */
function subscribedWith(
  phone: PushStandIns,
): { userVisibleOnly: boolean | undefined; key: string | null | undefined }[] {
  return phone
    .subscribeRequests()
    .map(({ userVisibleOnly, applicationServerKey: key }) => ({
      userVisibleOnly,
      key: key instanceof Uint8Array ? base64url(key) : key,
    }));
}

/** Bytes as base64url text without padding: the test's own, independent of the app's. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Once, with the server's key, for visible pushes only, as C8a's `subscribe` asks. */
const WITH_THE_SERVERS_KEY = [{ userVisibleOnly: true, key: SERVER_KEY }];

// ---- 11.1 ----

test("A phone with no subscription subscribes with the server's key, visible pushes only, and sends the new one", async () => {
  const phone = phoneHoldingNone();
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "subscribed again" });
  expect(
    subscribedWith(phone),
    "with the server's key, visible pushes only",
  ).toEqual(WITH_THE_SERVERS_KEY);
  const made = phone.subscription();
  expect(made, "the phone holds the new subscription").not.toBeNull();
  expect(subscriptionsSent(), "the new one sent").toEqual([made?.toJSON()]);
  expect(
    requests(),
    "the key first, then the new subscription; nothing forgotten",
  ).toEqual([KEY_READ, SUBSCRIPTION_SENT]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

// ---- 11.2 ----

const subscribesThatFail: { label: string; fails: Error | true }[] = [
  { label: "the browser refuses it without a tap", fails: true },
  {
    label: "the push service cannot be reached",
    fails: new DOMException(
      "Registration failed - push service error",
      "AbortError",
    ),
  },
  {
    label: "the browser fails in a way of its own",
    fails: new TypeError("Something went wrong."),
  },
];

test.each(subscribesThatFail)(
  "A failed subscribe stops the upkeep quietly, and nothing is sent: $label",
  async ({ fails }) => {
    const phone = phoneHoldingNone({ subscribeFails: fails });
    answerWith(THE_SERVER);

    await expect(anUpkeep()).resolves.toEqual({ kind: "stopped" });
    expect(subscribedWith(phone), "it tried, with the server's key").toEqual(
      WITH_THE_SERVERS_KEY,
    );
    expect(requests(), "nothing sent after the key").toEqual([KEY_READ]);
    expect(phone.subscription(), "the phone holds none").toBeNull();
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test("A failed subscribe stops the upkeep quietly, and nothing is sent: one with no answer, ended by the limit", async () => {
  startTestClock();
  // The browser's own call takes no signal: the upkeep stops waiting for it when the limit fires (D1).
  const phone = phoneHoldingNone({ subscribeWaits: true });
  answerWith(THE_SERVER);
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the browser").toBe(
    "still running",
  );
  expect(subscribedWith(phone), "asked, with the server's key").toEqual(
    WITH_THE_SERVERS_KEY,
  );

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(requests(), "nothing sent after the key").toEqual([KEY_READ]);

  phone.letWaitingCallsSettle();
  await timePasses(0);

  const made = phone.subscription();
  expect(made, "the phone keeps the one that settled late").not.toBeNull();
  expect(requests(), "nothing sent once it settles").toEqual([KEY_READ]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);

  expect(await whereItStands(anUpkeep()), "the next opening").toEqual({
    kind: "sent again",
  });
  expect(subscriptionsSent(), "the next opening sends it").toEqual([
    made?.toJSON(),
  ]);
  expect(subscribedWith(phone), "subscribed only the once").toEqual(
    WITH_THE_SERVERS_KEY,
  );
});

// ---- 11.3 ----

const sendsNotStored: { label: string; answer: SubscriptionAnswer }[] = [
  { label: "a server error", answer: serverError },
  { label: "a hosting error page", answer: hostingErrorPage },
  { label: "no answer, offline", answer: noConnection },
];

test.each(sendsNotStored)(
  "A new subscription the server did not get is sent again at the next opening: $label",
  async ({ answer }) => {
    const phone = phoneHoldingNone();
    answerWith({
      pushKey: pushKey(SERVER_KEY),
      subscription: [answer, stored],
    });

    expect(await anUpkeep(), "the first opening").toEqual({ kind: "stopped" });
    const made = phone.subscription();
    expect(made, "the phone keeps the new subscription").not.toBeNull();
    expect(subscriptionsSent(), "sent, but not stored").toEqual([
      made?.toJSON(),
    ]);

    expect(await anUpkeep(), "the next opening").toEqual({
      kind: "sent again",
    });
    expect(subscriptionsSent(), "sent again, as it is").toEqual([
      made?.toJSON(),
      made?.toJSON(),
    ]);
    expect(phone.subscription(), "the phone keeps it").toBe(made);
    expect(
      subscribedWith(phone),
      "subscribed at the first opening only",
    ).toEqual(WITH_THE_SERVERS_KEY);
  },
);

test("A new subscription the server did not get is sent again at the next opening: the send with no answer, ended by the limit", async () => {
  startTestClock();
  const phone = phoneHoldingNone();
  answerWith({
    pushKey: pushKey(SERVER_KEY),
    subscription: [noAnswerYet, stored],
  });
  const limit = new AbortController();

  const first = anUpkeep(limit.signal);
  expect(await whereItStands(first), "waiting for the server").toBe(
    "still running",
  );
  const made = phone.subscription();
  expect(made, "the phone holds the new subscription").not.toBeNull();

  limit.abort();

  expect(await whereItStands(first), "the first opening").toEqual({
    kind: "stopped",
  });
  expect(timeline()).toContain(`aborted ${SUBSCRIPTION_SENT}`);
  expect(phone.subscription(), "the phone keeps it").toBe(made);

  expect(await whereItStands(anUpkeep()), "the next opening").toEqual({
    kind: "sent again",
  });
  expect(subscriptionsSent(), "sent again, as it is").toEqual([
    made?.toJSON(),
    made?.toJSON(),
  ]);
  expect(phone.subscription(), "the phone keeps it").toBe(made);
  expect(subscribedWith(phone), "subscribed at the first opening only").toEqual(
    WITH_THE_SERVERS_KEY,
  );
});

// ---- Replacing a subscription made with another key (D1, step 5) ----

/** The push address of the subscription Lucie's phone made with the old key. */
const LUCIES_OLD_SUBSCRIPTION =
  "https://web.push.apple.com/lucies-old-subscription";

const FORGET_ASKED = "DELETE /api/push/subscription";

/** The old push address, once, as C8a's forget sends it: in the body, never in the URL. */
const THE_OLD_ADDRESS = [{ endpoint: LUCIES_OLD_SUBSCRIPTION }];

/**
 * Lucie's phone with notifications allowed, holding a subscription at her old push address made with the old key, which
 * the browser names; `subscription` and `more` say what differs.
 */
function phoneSubscribedWithTheOldKey(
  subscription: Omit<
    SubscriptionInit,
    "endpoint" | "applicationServerKey"
  > = {},
  more: PushStandInOptions = {},
): PushStandIns {
  return installPushStandIns({
    permission: "granted",
    subscription: {
      endpoint: LUCIES_OLD_SUBSCRIPTION,
      applicationServerKey: OLD_KEY,
      ...subscription,
    },
    ...more,
  });
}

/** What the app asked the server to forget, in order, as the bodies it sent. */
function forgetsSent(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === FORGET_ASKED)
    .map((sent) => sent.body);
}

// ---- 13.1 ----

test("A subscription made with another key: the server forgets its push address first, then the phone unsubscribes it, subscribes with the server's key and sends the new one", async () => {
  const phone = phoneSubscribedWithTheOldKey();
  const old = phone.subscription()!;
  answerWith(THE_SERVER);

  expect(await anUpkeep()).toEqual({ kind: "replaced" });
  expect(
    forgetsSent(),
    "the server asked to forget the old push address",
  ).toEqual(THE_OLD_ADDRESS);
  const made = phone.subscription();
  expect(made, "the phone holds a new subscription").not.toBeNull();
  expect(made, "not the old one").not.toBe(old);
  expect(
    subscribedWith(phone),
    "with the server's key, visible pushes only",
  ).toEqual(WITH_THE_SERVERS_KEY);
  expect(subscriptionsSent(), "the new one sent, never the old").toEqual([
    made?.toJSON(),
  ]);
  expect(requests(), "the key, the forget, then the new subscription").toEqual([
    KEY_READ,
    FORGET_ASKED,
    SUBSCRIPTION_SENT,
  ]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

test("A subscription made with another key: the server forgets its push address first, then the phone unsubscribes it, subscribes with the server's key and sends the new one: the phone is untouched until the server has forgotten the old address", async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey();
  const old = phone.subscription()!;
  answerWith({ ...THE_SERVER, forgetSubscription: after(SECOND, forgotten) });

  const upkeep = anUpkeep();
  expect(
    await whereItStands(upkeep),
    "waiting for the server to forget it",
  ).toBe("still running");
  expect(requests()).toEqual([KEY_READ, FORGET_ASKED]);
  expect(phone.subscription(), "the phone still holds the old one").toBe(old);
  expect(phone.subscribeRequests(), "nothing subscribed yet").toEqual([]);

  await timePasses(SECOND);

  expect(await whereItStands(upkeep)).toEqual({ kind: "replaced" });
  const made = phone.subscription();
  expect(made, "the phone holds a new subscription").not.toBeNull();
  expect(made, "not the old one").not.toBe(old);
  expect(subscriptionsSent(), "then the new one sent").toEqual([
    made?.toJSON(),
  ]);
  expect(requests()).toEqual([KEY_READ, FORGET_ASKED, SUBSCRIPTION_SENT]);
});

test("A subscription made with another key: the server forgets its push address first, then the phone unsubscribes it, subscribes with the server's key and sends the new one: a subscribe that fails once the old one is gone stops the upkeep, and the next opening subscribes again", async () => {
  const phone = phoneSubscribedWithTheOldKey(
    {},
    { subscribeFails: true, subscribeFailures: 1 },
  );
  answerWith(THE_SERVER);

  expect(await anUpkeep(), "the opening").toEqual({ kind: "stopped" });
  expect(forgetsSent(), "the old address forgotten").toEqual(THE_OLD_ADDRESS);
  expect(phone.subscription(), "the old one gone, and no new one").toBeNull();
  expect(subscribedWith(phone), "it tried, with the server's key").toEqual(
    WITH_THE_SERVERS_KEY,
  );
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);

  expect(await anUpkeep(), "the next opening").toEqual({
    kind: "subscribed again",
  });
  const made = phone.subscription();
  expect(made, "the phone holds a new subscription").not.toBeNull();
  expect(subscriptionsSent(), "the new one sent").toEqual([made?.toJSON()]);
  expect(forgetsSent(), "nothing more to forget").toEqual(THE_OLD_ADDRESS);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

// ---- 13.2 ----

const forgetsNotForgotten: { label: string; answer: ForgetAnswer }[] = [
  { label: "a server error", answer: serverError },
  { label: "a hosting error page", answer: hostingErrorPage },
  { label: "a 200 the app does not expect", answer: unreadable },
  { label: "a Wi-Fi login page", answer: wifiLoginPage },
  { label: "no answer, offline", answer: noConnection },
];

test.each(forgetsNotForgotten)(
  'A forget that does not answer "forgotten" leaves the phone\'s subscription untouched and sends nothing more: $label',
  async ({ answer }) => {
    const phone = phoneSubscribedWithTheOldKey();
    const old = phone.subscription()!;
    answerWith({ ...THE_SERVER, forgetSubscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "stopped" });
    expect(forgetsSent(), "asked to forget the old address").toEqual(
      THE_OLD_ADDRESS,
    );
    expect(requests(), "nothing sent after the forget").toEqual([
      KEY_READ,
      FORGET_ASKED,
    ]);
    expect(phone.subscription(), "the phone keeps the old one").toBe(old);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test('A forget that does not answer "forgotten" leaves the phone\'s subscription untouched and sends nothing more: no answer, ended by the limit', async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey();
  const old = phone.subscription()!;
  answerWith({ ...THE_SERVER, forgetSubscription: noAnswerYet });
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the server").toBe(
    "still running",
  );
  expect(requests()).toEqual([KEY_READ, FORGET_ASKED]);

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(timeline(), "the forget carries the signal").toContain(
    `aborted ${FORGET_ASKED}`,
  );
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);
  expect(phone.subscription(), "the phone keeps the old one").toBe(old);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
});

test('A forget that does not answer "forgotten" leaves the phone\'s subscription untouched and sends nothing more: the next opening tries the whole replacement again', async () => {
  const phone = phoneSubscribedWithTheOldKey();
  const old = phone.subscription()!;
  answerWith({ ...THE_SERVER, forgetSubscription: [serverError, forgotten] });

  expect(await anUpkeep(), "the opening").toEqual({ kind: "stopped" });
  expect(phone.subscription(), "the phone keeps the old one").toBe(old);

  expect(await anUpkeep(), "the next opening").toEqual({ kind: "replaced" });
  expect(forgetsSent(), "the old address asked again").toEqual([
    ...THE_OLD_ADDRESS,
    ...THE_OLD_ADDRESS,
  ]);
  const made = phone.subscription();
  expect(made, "the phone holds a new subscription").not.toBeNull();
  expect(made, "not the old one").not.toBe(old);
  expect(subscriptionsSent(), "the new one sent").toEqual([made?.toJSON()]);
});

// ---- 13.3 ----

const unsubscribesThatFail: {
  label: string;
  subscription: Pick<
    SubscriptionInit,
    "unsubscribeFails" | "unsubscribeAnswers"
  >;
}[] = [
  {
    label: "the browser fails to unsubscribe it",
    subscription: {
      unsubscribeFails: new DOMException("Unsubscribing failed.", "AbortError"),
    },
  },
  {
    label: "the browser fails in a way of its own",
    subscription: { unsubscribeFails: new TypeError("Something went wrong.") },
  },
  {
    label: "the browser answers that it did not unsubscribe it",
    subscription: { unsubscribeAnswers: false },
  },
];

test.each(unsubscribesThatFail)(
  "A failed unsubscribe stops the upkeep before it subscribes: $label",
  async ({ subscription }) => {
    const phone = phoneSubscribedWithTheOldKey(subscription);
    const old = phone.subscription()!;
    answerWith(THE_SERVER);

    await expect(anUpkeep()).resolves.toEqual({ kind: "stopped" });
    expect(forgetsSent(), "the old address forgotten first").toEqual(
      THE_OLD_ADDRESS,
    );
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
    expect(requests(), "nothing sent after the forget").toEqual([
      KEY_READ,
      FORGET_ASKED,
    ]);
    expect(phone.subscription(), "the phone still holds the old one").toBe(old);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test("A failed unsubscribe stops the upkeep before it subscribes: one with no answer, ended by the limit", async () => {
  startTestClock();
  // The browser's own call takes no signal: the upkeep stops waiting for it when the limit fires (D1).
  const phone = phoneSubscribedWithTheOldKey({ unsubscribeWaits: true });
  const old = phone.subscription()!;
  answerWith(THE_SERVER);
  const limit = new AbortController();

  const upkeep = anUpkeep(limit.signal);
  expect(await whereItStands(upkeep), "waiting for the browser").toBe(
    "still running",
  );
  expect(forgetsSent(), "the old address forgotten first").toEqual(
    THE_OLD_ADDRESS,
  );
  expect(phone.subscription(), "still held while it waits").toBe(old);

  limit.abort();

  expect(await whereItStands(upkeep)).toEqual({ kind: "stopped" });
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);

  phone.letWaitingCallsSettle();
  await timePasses(0);

  expect(
    phone.subscription(),
    "the old one gone once the browser settles",
  ).toBeNull();
  expect(
    phone.subscribeRequests(),
    "nothing subscribed once it settles either",
  ).toEqual([]);
  expect(requests(), "nothing sent once it settles").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);

  expect(await whereItStands(anUpkeep()), "the next opening").toEqual({
    kind: "subscribed again",
  });
  const made = phone.subscription();
  expect(made, "the phone holds a new subscription").not.toBeNull();
  expect(subscriptionsSent(), "the next opening sends the new one").toEqual([
    made?.toJSON(),
  ]);
  expect(forgetsSent(), "nothing more to forget").toEqual(THE_OLD_ADDRESS);
});

// ---- Forgetting and unsubscribing this device (D2, D4) ----

/** The phone's push address, once, as C8a's forget sends it: in the body, never in the URL. */
const THE_PHONES_ADDRESS = [{ endpoint: LUCIES_PHONE }];

/** A forget or an unsubscribe, seen only as whether it has ended: it answers nothing (D2, D4). */
function ended(call: Promise<void>): Promise<"ended"> {
  return call.then(() => "ended" as const);
}

/**
 * The subscription Lucie's phone holds, whatever the permission and the key: neither the forget nor the unsubscribe
 * checks them.
 */
const whateverItHolds: {
  label: string;
  key: string | null;
  permission: NotificationPermission;
}[] = [
  {
    label: "notifications denied since it was made",
    key: SERVER_KEY,
    permission: "denied",
  },
  {
    label: "the permission back to never asked",
    key: SERVER_KEY,
    permission: "default",
  },
  { label: "made with another key", key: OLD_KEY, permission: "granted" },
  { label: "its key not named", key: null, permission: "granted" },
];

/**
 * A browser of the test's own whose registration is Lucie's phone, while the window's is another phone holding none:
 * so only the browser given can reach her subscription.
 */
function herPhoneAsTheBrowserGiven(): { phone: PushStandIns; browser: Window } {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const browser = aBrowserOfItsOwn({
    getRegistration: () => Promise.resolve(phone.registration),
    permission: "granted",
  });
  // The window's own stand-ins: another phone, holding none. Hers keeps working through its registration.
  installPushStandIns({ permission: "granted" });
  return { phone, browser };
}

// ---- 15.1 ----

test("Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith(THE_SERVER);

  await forgetThisDevice();

  expect(forgetsSent(), "the phone's push address").toEqual(THE_PHONES_ADDRESS);
  expect(requests(), "the forget alone, no key read").toEqual([FORGET_ASKED]);
  expect(
    phone.subscription(),
    "the phone keeps it until the sign-out is confirmed",
  ).toBe(held);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

test.each(whateverItHolds)(
  "Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal: $label",
  async ({ key, permission }) => {
    const phone = phoneSubscribedWith(key, { permission });
    const held = phone.subscription()!;
    answerWith(THE_SERVER);

    await forgetThisDevice();

    expect(forgetsSent(), "the phone's push address").toEqual(
      THE_PHONES_ADDRESS,
    );
    expect(requests(), "the forget alone").toEqual([FORGET_ASKED]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test("Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal: the browser given, not the window", async () => {
  const { browser } = herPhoneAsTheBrowserGiven();
  answerWith(THE_SERVER);

  await forgetThisDevice({ browser });

  expect(forgetsSent(), "her phone's push address").toEqual(THE_PHONES_ADDRESS);
});

test("Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal: the forget with no answer ends with the signal", async () => {
  startTestClock();
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription()!;
  answerWith({ ...THE_SERVER, forgetSubscription: noAnswerYet });
  const limit = new AbortController();

  const forgetting = ended(forgetThisDevice({ signal: limit.signal }));
  expect(await whereItStands(forgetting), "waiting for the server").toBe(
    "still running",
  );
  expect(requests()).toEqual([FORGET_ASKED]);

  limit.abort();

  expect(await whereItStands(forgetting)).toBe("ended");
  expect(timeline()).toContain(`aborted ${FORGET_ASKED}`);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
});

test("Forgetting this device sends the push address of the phone's subscription, and its requests carry the given signal: reading the phone's subscription left hanging ends with the signal too, and nothing is sent", async () => {
  startTestClock();
  // The browser's own call takes no signal: the forget stops waiting for it when the limit fires (D1, D2).
  const phone = phoneSubscribedWith(SERVER_KEY, { getSubscriptionWaits: true });
  answerWith(THE_SERVER);
  const limit = new AbortController();

  const forgetting = ended(forgetThisDevice({ signal: limit.signal }));
  expect(await whereItStands(forgetting), "waiting for the browser").toBe(
    "still running",
  );

  limit.abort();

  expect(await whereItStands(forgetting)).toBe("ended");
  expect(requests(), "nothing sent").toEqual([]);

  phone.letWaitingCallsSettle();
  await timePasses(0);

  expect(requests(), "nothing sent once the browser answers late").toEqual([]);
});

// Review finding 1 (PR 81): asking the browser for its registration is one of the browser's own calls too, and takes no
// signal, so an upkeep and the forget before a sign-out stop waiting for it when the limit fires (D1; D2: the forget
// "has the 60 s limit"). Left waiting for good, an upkeep would never end, so no later opening would start one, and a
// sign-out would never reach its sign-out request. What the upkeep answers then is not pinned: nothing is done either
// way, and an upkeep's outcome is never shown (D1, "Quietly").

/** What asks the browser for its registration first: an upkeep, or the forget before a sign-out (D1, D2). */
const askersOfTheRegistration: {
  label: string;
  start: (signal: AbortSignal, browser: Window) => Promise<unknown>;
}[] = [
  {
    label: "an upkeep",
    start: (signal, browser) =>
      keepSubscriptionUp({ stillSignedIn: () => true, signal, browser }),
  },
  {
    label: "the forget before a sign-out",
    start: (signal, browser) => forgetThisDevice({ signal, browser }),
  },
];

test.each(askersOfTheRegistration)(
  "Asking the browser for its registration with no answer ends with the limit, and nothing is sent: $label",
  async ({ start }) => {
    startTestClock();
    // Lucie's phone, with notifications allowed and a subscription made with the server's key: had the browser
    // answered, the upkeep would send it again and the forget would send its push address.
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription()!;
    let answerLate: (() => void) | undefined;
    const browser = aBrowserOfItsOwn({
      getRegistration: () =>
        new Promise<ServiceWorkerRegistration | undefined>((resolve) => {
          answerLate = () => {
            resolve(phone.registration);
          };
        }),
      permission: "granted",
    });
    answerWith(THE_SERVER);
    const limit = new AbortController();

    const running = start(limit.signal, browser).then(() => "ended" as const);
    expect(await whereItStands(running), "waiting for the browser").toBe(
      "still running",
    );
    expect(answerLate, "the browser was asked").toBeDefined();

    limit.abort();

    expect(await whereItStands(running), "ended by the limit").toBe("ended");
    expect(requests(), "nothing sent").toEqual([]);

    answerLate?.();
    await timePasses(0);

    expect(requests(), "nothing sent once the browser answers late").toEqual(
      [],
    );
    expect(phone.subscription(), "the phone keeps it").toBe(held);
  },
);

// ---- 15.2 ----

test("Forgetting sends nothing without a registration or a subscription: none of push's features (jsdom as it is)", async () => {
  answerWith(THE_SERVER);

  await forgetThisDevice();

  expect(requests(), "nothing sent").toEqual([]);
});

const nothingToReach: { label: string; phone: PushStandInOptions }[] = [
  { label: "no subscription held", phone: { permission: "granted" } },
  {
    // A service worker, but none registered (Vite's dev server): the subscription cannot be reached.
    label: "no worker registered",
    phone: {
      permission: "granted",
      registered: false,
      subscription: {
        endpoint: LUCIES_PHONE,
        applicationServerKey: SERVER_KEY,
      },
    },
  },
];

test.each(nothingToReach)(
  "Forgetting sends nothing without a registration or a subscription: $label",
  async ({ phone: stands }) => {
    const phone = installPushStandIns(stands);
    const held = phone.subscription();
    answerWith(THE_SERVER);

    await forgetThisDevice();

    expect(requests(), "nothing sent").toEqual([]);
    expect(phone.subscription(), "the phone untouched").toBe(held);
  },
);

test("Forgetting sends nothing without a registration or a subscription: the browser given has none registered, though the window has", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  answerWith(THE_SERVER);
  const browser = aBrowserOfItsOwn({
    getRegistration: () => Promise.resolve(undefined),
    permission: "granted",
  });

  await forgetThisDevice({ browser });

  expect(requests(), "nothing sent").toEqual([]);
  expect(phone.subscription(), "the window's phone untouched").not.toBeNull();
});

// ---- 15.3 ----

test("Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  answerWith(THE_SERVER);

  await unsubscribeThisDevice();

  expect(phone.subscription(), "the phone holds none").toBeNull();
  expect(requests(), "nothing asked of the server").toEqual([]);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(phone.permissionRequests(), "nothing asked").toBe(0);
});

test.each(whateverItHolds)(
  "Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one: $label",
  async ({ key, permission }) => {
    const phone = phoneSubscribedWith(key, { permission });
    answerWith(THE_SERVER);

    await unsubscribeThisDevice();

    expect(phone.subscription(), "the phone holds none").toBeNull();
    expect(requests(), "nothing asked of the server").toEqual([]);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test("Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one: the browser given, not the window", async () => {
  const { phone, browser } = herPhoneAsTheBrowserGiven();

  await unsubscribeThisDevice({ browser });

  expect(phone.subscription(), "her phone holds none").toBeNull();
});

test("Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one: none of push's features (jsdom as it is)", async () => {
  answerWith(THE_SERVER);

  await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
  expect(requests(), "nothing asked of the server").toEqual([]);
});

test.each(nothingToReach)(
  "Unsubscribing this device unsubscribes the phone's subscription, and does nothing without one: $label",
  async ({ phone: stands }) => {
    const phone = installPushStandIns(stands);
    const held = phone.subscription();
    answerWith(THE_SERVER);

    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
    expect(phone.subscription(), "the phone untouched").toBe(held);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
    expect(requests(), "nothing asked of the server").toEqual([]);
  },
);

// ---- 15.4 ----

test.each(unsubscribesThatFail)(
  "Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: unsubscribing, $label",
  async ({ subscription }) => {
    const phone = installPushStandIns({
      permission: "granted",
      subscription: {
        endpoint: LUCIES_PHONE,
        applicationServerKey: SERVER_KEY,
        ...subscription,
      },
    });
    const held = phone.subscription();
    answerWith(THE_SERVER);

    await expect(unsubscribeThisDevice()).resolves.toBeUndefined();
    expect(phone.subscription(), "the phone still holds it").toBe(held);
    expect(requests(), "nothing asked of the server").toEqual([]);
  },
);

/** Forgetting and unsubscribing this device, each with the browser given (`undefined`: the window). */
const forgettingAndUnsubscribing: {
  label: string;
  call: (browser?: Window) => Promise<void>;
}[] = [
  { label: "forgetting", call: (browser) => forgetThisDevice({ browser }) },
  {
    label: "unsubscribing",
    call: (browser) => unsubscribeThisDevice({ browser }),
  },
];

test.each(forgettingAndUnsubscribing)(
  "Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: $label, the browser refuses to say which registration it has",
  async ({ call }) => {
    const phone = phoneSubscribedWith(SERVER_KEY, {
      registrationFails: new DOMException(
        "The operation is insecure.",
        "SecurityError",
      ),
    });
    const held = phone.subscription();
    answerWith(THE_SERVER);

    await expect(call()).resolves.toBeUndefined();
    expect(requests(), "nothing sent").toEqual([]);
    expect(phone.subscription(), "the phone untouched").toBe(held);
  },
);

test.each(forgettingAndUnsubscribing)(
  "Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: $label, asking for the registration throws at once",
  async ({ call }) => {
    answerWith(THE_SERVER);
    const browser = aBrowserOfItsOwn({
      getRegistration: () => {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
      permission: "granted",
    });

    await expect(call(browser)).resolves.toBeUndefined();
    expect(requests(), "nothing sent").toEqual([]);
  },
);

test.each(forgettingAndUnsubscribing)(
  "Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: $label, the browser fails to say which subscription it holds",
  async ({ call }) => {
    const phone = phoneSubscribedWith(SERVER_KEY, {
      getSubscriptionFails: new DOMException(
        "Getting the subscription failed.",
        "AbortError",
      ),
    });
    const held = phone.subscription();
    answerWith(THE_SERVER);

    await expect(call()).resolves.toBeUndefined();
    expect(requests(), "nothing sent").toEqual([]);
    expect(phone.subscription(), "the phone untouched").toBe(held);
  },
);

const forgetsTheServerFails: { label: string; answer: ForgetAnswer }[] = [
  { label: "a server error", answer: serverError },
  { label: "a hosting error page", answer: hostingErrorPage },
  { label: "the login has ended (401)", answer: nobodySignedIn },
  {
    label: "the account is refused (403)",
    answer: refused("lucie@example.com"),
  },
  { label: "no answer, offline", answer: noConnection },
];

test.each(forgetsTheServerFails)(
  "Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: forgetting, the server answers $label",
  async ({ answer }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription();
    answerWith({ ...THE_SERVER, forgetSubscription: answer });

    await expect(forgetThisDevice()).resolves.toBeUndefined();
    expect(forgetsSent(), "the phone's push address sent").toEqual(
      THE_PHONES_ADDRESS,
    );
    expect(requests(), "nothing more").toEqual([FORGET_ASKED]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
  },
);

test("Neither ever throws: a failed unsubscribe and a failure to ask for the registration are ignored: forgetting, the phone says it is offline", async () => {
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription();
  answerWith(THE_SERVER);
  goOffline();

  await expect(forgetThisDevice()).resolves.toBeUndefined();
  expect(requests(), "nothing sent").toEqual([]);
  expect(phone.subscription(), "the phone keeps it").toBe(held);
});

// ---- 18.2 ----
// 15.4 covers a server error, a hosting error page, 401, 403, no connection and the phone offline; 15.1 the forget with
// no answer, ended by the signal. These are the rest of what the server may answer.

const otherForgetAnswers: { label: string; answer: ForgetAnswer }[] = [
  { label: "a 200 the app does not expect", answer: unreadable },
  { label: "a Wi-Fi login page", answer: wifiLoginPage },
  {
    label: "the address refused (400)",
    answer: problemOf(
      400,
      "One or more errors occurred!",
      "https://www.rfc-editor.org/rfc/rfc9110#section-15.5.1",
    ),
  },
];

test.each(otherForgetAnswers)(
  "Forgetting this device never throws, whatever the server answers: $label",
  async ({ answer }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription();
    answerWith({ ...THE_SERVER, forgetSubscription: answer });

    await expect(forgetThisDevice()).resolves.toBeUndefined();
    expect(forgetsSent(), "the phone's push address sent").toEqual(
      THE_PHONES_ADDRESS,
    );
    expect(requests(), "nothing more").toEqual([FORGET_ASKED]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
  },
);

// ---- The upkeep and the login's end (D1, D4, D6) ----
// A 401 or 403 to any of the upkeep's requests ends the login: the upkeep says so, naming the refused account, and
// leaves the phone's subscription to the screen, whose end of the login unsubscribes it (D4). A login that ends
// elsewhere while the upkeep runs (`stillSignedIn`, checked after every step) stops it, and a subscription it made is
// unsubscribed (D6).

/** How the upkeep names a login the server ended. */
type LoginEnded = Extract<UpkeepOutcome, { kind: "login ended" }>["ended"];

/** The server's answers that the login has ended, and how the upkeep names each. */
const answersThatEndTheLogin: {
  label: string;
  answer: typeof nobodySignedIn | ReturnType<typeof refused>;
  ended: LoginEnded;
}[] = [
  { label: "401", answer: nobodySignedIn, ended: { kind: "signed out" } },
  {
    label: "403 naming the account",
    answer: refused("lucie@example.com"),
    ended: { kind: "refused", email: "lucie@example.com" },
  },
  {
    label: "403 naming none",
    answer: refused(null),
    ended: { kind: "refused", email: null },
  },
];

/** The login an upkeep starts under, which the test ends while the upkeep runs (D6). */
function aLogin(): { stillSignedIn: () => boolean; ends: () => void } {
  let on = true;
  return {
    stillSignedIn: () => on,
    ends: () => {
      on = false;
    },
  };
}

/** One upkeep under this login, as the screen starts it. */
function anUpkeepUnder(login: {
  stillSignedIn: () => boolean;
}): Promise<UpkeepOutcome> {
  return keepSubscriptionUp({ stillSignedIn: login.stillSignedIn });
}

const DROPPED = { kind: "dropped" };

// ---- 23.1 ----

test.each(answersThatEndTheLogin)(
  'A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account: the key read, $label',
  async ({ answer, ended }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription();
    answerWith({ ...THE_SERVER, pushKey: answer });

    expect(await anUpkeep()).toEqual({ kind: "login ended", ended });
    expect(requests(), "nothing more sent").toEqual([KEY_READ]);
    expect(phone.subscription(), "left to the screen").toBe(held);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  },
);

test.each(answersThatEndTheLogin)(
  'A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account: the subscription sent again, $label',
  async ({ answer, ended }) => {
    const phone = phoneSubscribedWith(SERVER_KEY);
    const held = phone.subscription();
    answerWith({ ...THE_SERVER, subscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "login ended", ended });
    expect(requests(), "nothing more sent").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
    expect(phone.subscription(), "left to the screen").toBe(held);
  },
);

test.each(answersThatEndTheLogin)(
  'A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account: the new subscription sent, the phone had none, $label',
  async ({ answer, ended }) => {
    const phone = phoneHoldingNone();
    answerWith({ ...THE_SERVER, subscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "login ended", ended });
    expect(requests(), "nothing more sent").toEqual([
      KEY_READ,
      SUBSCRIPTION_SENT,
    ]);
    expect(subscribedWith(phone), "subscribed once").toEqual(
      WITH_THE_SERVERS_KEY,
    );
  },
);

test.each(answersThatEndTheLogin)(
  'A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account: the old address forgotten, $label',
  async ({ answer, ended }) => {
    const phone = phoneSubscribedWithTheOldKey();
    const old = phone.subscription();
    answerWith({ ...THE_SERVER, forgetSubscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "login ended", ended });
    expect(requests(), "nothing more sent").toEqual([KEY_READ, FORGET_ASKED]);
    expect(phone.subscription(), "left to the screen").toBe(old);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  },
);

test.each(answersThatEndTheLogin)(
  'A 401 or 403 to the key, to the subscription it sends or to the forget answers "login ended", naming the refused account: the replacement sent, $label',
  async ({ answer, ended }) => {
    phoneSubscribedWithTheOldKey();
    answerWith({ ...THE_SERVER, subscription: answer });

    expect(await anUpkeep()).toEqual({ kind: "login ended", ended });
    expect(requests(), "nothing more sent").toEqual([
      KEY_READ,
      FORGET_ASKED,
      SUBSCRIPTION_SENT,
    ]);
  },
);

// ---- 23.2 ----

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the phone subscribed, holding none before", async () => {
  startTestClock();
  const phone = phoneHoldingNone({ subscribeWaits: true });
  answerWith(THE_SERVER);
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "the phone subscribing").toBe(
    "still running",
  );
  expect(subscribedWith(phone)).toEqual(WITH_THE_SERVERS_KEY);

  login.ends();
  phone.letWaitingCallsSettle();

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "the one it made unsubscribed").toBeNull();
  expect(requests(), "nothing sent").toEqual([KEY_READ]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the phone subscribed in place of one made with another key", async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey({}, { subscribeWaits: true });
  answerWith(THE_SERVER);
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "the phone subscribing").toBe(
    "still running",
  );
  expect(subscribedWith(phone)).toEqual(WITH_THE_SERVERS_KEY);

  login.ends();
  phone.letWaitingCallsSettle();

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "the one it made unsubscribed").toBeNull();
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the new subscription was sent", async () => {
  startTestClock();
  const phone = phoneHoldingNone();
  answerWith({ ...THE_SERVER, subscription: after(SECOND, stored) });
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "sending the new one").toBe(
    "still running",
  );
  const made = phone.subscription();
  expect(made, "the one it made").not.toBeNull();

  login.ends();
  await timePasses(SECOND);

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "the one it made unsubscribed").toBeNull();
  expect(subscriptionsSent(), "sent once, nothing more").toEqual([
    made?.toJSON(),
  ]);
  expect(requests()).toEqual([KEY_READ, SUBSCRIPTION_SENT]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the replacement was sent", async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey();
  answerWith({ ...THE_SERVER, subscription: after(SECOND, stored) });
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "sending the replacement").toBe(
    "still running",
  );
  const made = phone.subscription();
  expect(made, "the one it made").not.toBeNull();

  login.ends();
  await timePasses(SECOND);

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "the one it made unsubscribed").toBeNull();
  expect(requests()).toEqual([KEY_READ, FORGET_ASKED, SUBSCRIPTION_SENT]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the subscription was sent again, the one it did not make left alone", async () => {
  startTestClock();
  const phone = phoneSubscribedWith(SERVER_KEY);
  const held = phone.subscription();
  answerWith({ ...THE_SERVER, subscription: after(SECOND, stored) });
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "sending it again").toBe("still running");

  login.ends();
  await timePasses(SECOND);

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "left to the screen").toBe(held);
  expect(requests()).toEqual([KEY_READ, SUBSCRIPTION_SENT]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the server forgot the old address, nothing subscribed", async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey();
  const old = phone.subscription();
  answerWith({ ...THE_SERVER, forgetSubscription: after(SECOND, forgotten) });
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "the server forgetting it").toBe(
    "still running",
  );

  login.ends();
  await timePasses(SECOND);

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscription(), "the old one left to the screen").toBe(old);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);
});

test("An upkeep whose login ended while it ran stops at its next step, and unsubscribes a subscription it made: ended while the old one was unsubscribed, nothing subscribed", async () => {
  startTestClock();
  const phone = phoneSubscribedWithTheOldKey({ unsubscribeWaits: true });
  answerWith(THE_SERVER);
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "the phone unsubscribing").toBe(
    "still running",
  );

  login.ends();
  phone.letWaitingCallsSettle();

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(requests(), "nothing sent after the forget").toEqual([
    KEY_READ,
    FORGET_ASKED,
  ]);
});

// ---- 23.3 ----

/** What the phone may hold when an upkeep starts: each leads to another request once the key is read. */
const phonesAtTheStart: { label: string; phone: () => PushStandIns }[] = [
  {
    label: "a subscription made with the server's key",
    phone: () => phoneSubscribedWith(SERVER_KEY),
  },
  { label: "none", phone: () => phoneHoldingNone() },
  {
    label: "a subscription made with another key",
    phone: () => phoneSubscribedWithTheOldKey(),
  },
];

test.each(phonesAtTheStart)(
  "An upkeep whose login ended before it sends anything sends nothing: ended before it started, the phone holding $label",
  async ({ phone: phoneHolding }) => {
    const phone = phoneHolding();
    const held = phone.subscription();
    answerWith(THE_SERVER);

    expect(await keepSubscriptionUp({ stillSignedIn: () => false })).toEqual(
      DROPPED,
    );
    expect(requests(), "nothing sent, not even the key read").toEqual([]);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
    expect(phone.subscription(), "the phone untouched").toBe(held);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

test.each(phonesAtTheStart)(
  "An upkeep whose login ended before it sends anything sends nothing: ended while the key was read, the phone holding $label",
  async ({ phone: phoneHolding }) => {
    startTestClock();
    const phone = phoneHolding();
    const held = phone.subscription();
    answerWith({ ...THE_SERVER, pushKey: after(SECOND, pushKey(SERVER_KEY)) });
    const login = aLogin();

    const upkeep = anUpkeepUnder(login);
    expect(await whereItStands(upkeep), "reading the key").toBe(
      "still running",
    );

    login.ends();
    await timePasses(SECOND);

    expect(await whereItStands(upkeep)).toEqual(DROPPED);
    expect(requests(), "nothing sent after the key").toEqual([KEY_READ]);
    expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
    expect(phone.subscription(), "the phone untouched").toBe(held);
  },
);

test("An upkeep whose login ended before it sends anything sends nothing: ended while the phone said which subscription it holds", async () => {
  startTestClock();
  const phone = phoneHoldingNone({ getSubscriptionWaits: true });
  answerWith(THE_SERVER);
  const login = aLogin();

  const upkeep = anUpkeepUnder(login);
  expect(await whereItStands(upkeep), "the phone answering").toBe(
    "still running",
  );

  login.ends();
  phone.letWaitingCallsSettle();

  expect(await whereItStands(upkeep)).toEqual(DROPPED);
  expect(requests(), "nothing sent after the key").toEqual([KEY_READ]);
  expect(phone.subscribeRequests(), "nothing subscribed").toEqual([]);
  expect(phone.subscription(), "the phone holds none still").toBeNull();
});
