import { expect, test, vi } from "vitest";
import { realTurn } from "../test/clock";
import {
  balanceAddress,
  PHONE_SECRET,
  secretBytes,
  wrongCode,
} from "../test/notificationBalance";
import {
  keptBalance,
  phoneKeeps,
  phoneStorageBusy,
  phoneStorageFails,
} from "../test/server";
import {
  installServiceWorkerStandIn,
  ORIGIN,
  type ServiceWorkerStandIn,
} from "../test/serviceWorker";
import type { Balance } from "./balance";
import {
  declarativeMessage,
  listenForPushes,
  pushedBalance,
  type PushLike,
} from "./pushDisplay";

// What the service worker does with a push (c012 design.md D9). Every value here is made up.

/** The page a message opens, on a made-up address of the app. */
const PAGE = "https://reader.example/";

/** A push's JSON as the server sends it (c011 design.md D2): Declarative Web Push, changed by `notification`. */
function pushJson(notification: Record<string, unknown>): unknown {
  return {
    web_push: 8030,
    notification: { title: "Ahoj", navigate: PAGE, ...notification },
  };
}

// ---- Reading a push: declarativeMessage ----

test("A Declarative Web Push message gives its title, its text and the page it opens", () => {
  expect(declarativeMessage(pushJson({ body: "Zkušební zpráva" }))).toEqual({
    title: "Ahoj",
    body: "Zkušební zpráva",
    navigate: PAGE,
  });
});

test("A message without text gives no text", () => {
  const message = declarativeMessage(pushJson({}));

  expect(message).toEqual({ title: "Ahoj", navigate: PAGE });
  expect(message?.body).toBeUndefined();
});

test("Anything else is no message: not an object, web_push other than 8030, no or an empty title, no navigate", () => {
  const notification = { title: "Ahoj", navigate: PAGE };
  const cases: [string, unknown][] = [
    ["not an object: null", null],
    ["not an object: undefined", undefined],
    ["not an object: a string", "Ahoj"],
    ["not an object: a number", 8030],
    ["no web_push", { notification }],
    ["web_push 8031", { web_push: 8031, notification }],
    ["web_push the string 8030", { web_push: "8030", notification }],
    ["no notification", { web_push: 8030 }],
    ["a null notification", { web_push: 8030, notification: null }],
    ["a string notification", { web_push: 8030, notification: "Ahoj" }],
    ["no title", { web_push: 8030, notification: { navigate: PAGE } }],
    ["an empty title", pushJson({ title: "" })],
    ["a title that is not a string", pushJson({ title: 42 })],
    ["no navigate", { web_push: 8030, notification: { title: "Ahoj" } }],
    ["a navigate that is not a string", pushJson({ navigate: 42 })],
  ];

  for (const [name, json] of cases) {
    expect(declarativeMessage(json), name).toBeNull();
  }
});

// ---- Showing a push: listenForPushes (group 41) ----

/** The page a pushed message opens: the start page on the stand-in service worker's own (made-up) origin. */
const APP_PAGE = `${ORIGIN}/`;

test("A push without the browser's own notification shows the message's title and text, keeping the page it opens", async () => {
  // The stand-in's default browser does not read Declarative Web Push (as Chrome on a computer): no proposed notification.
  const serviceWorker = installServiceWorkerStandIn();
  listenForPushes(serviceWorker.worker);

  await serviceWorker.deliverPush({
    web_push: 8030,
    notification: {
      title: "Ahoj",
      body: "Zkušební zpráva",
      navigate: APP_PAGE,
    },
  });

  // The page it opens is kept in the notification's data, for the tap (design.md D9).
  expect(serviceWorker.shownNotifications()).toEqual([
    { title: "Ahoj", body: "Zkušební zpráva", data: APP_PAGE },
  ]);
});

test("A push that is not a Declarative Web Push message shows nothing", async () => {
  const json =
    (value: unknown) =>
    (serviceWorker: ServiceWorkerStandIn): Promise<void> =>
      serviceWorker.deliverPush(value);
  const cases: [
    string,
    (serviceWorker: ServiceWorkerStandIn) => Promise<void>,
  ][] = [
    [
      "no data at all",
      (serviceWorker) => serviceWorker.deliverPushWithoutData(),
    ],
    [
      "data that is not JSON",
      (serviceWorker) => serviceWorker.deliverPushOfText("Ahoj"),
    ],
    ["not an object", json("Ahoj")],
    [
      "no web_push",
      json({ notification: { title: "Ahoj", navigate: APP_PAGE } }),
    ],
    [
      "web_push other than 8030",
      json({
        web_push: 8031,
        notification: { title: "Ahoj", navigate: APP_PAGE },
      }),
    ],
    ["no notification", json({ web_push: 8030 })],
    [
      "an empty title",
      json({ web_push: 8030, notification: { title: "", navigate: APP_PAGE } }),
    ],
    ["no navigate", json({ web_push: 8030, notification: { title: "Ahoj" } })],
  ];

  for (const [name, deliver] of cases) {
    const serviceWorker = installServiceWorkerStandIn();
    listenForPushes(serviceWorker.worker);

    // The handler does not throw out of the event, nor fail the work it passes to waitUntil.
    await expect(deliver(serviceWorker), name).resolves.toBeUndefined();

    expect(serviceWorker.shownNotifications(), name).toEqual([]);
  }
});

// ---- The browser's own notification: listenForPushes (group 44) ----

/** A Declarative Web Push message as the server sends it, opening the start page. */
const DECLARATIVE_PUSH = {
  web_push: 8030,
  notification: { title: "Ahoj", body: "Zkušební zpráva", navigate: APP_PAGE },
};

test("A push that carries the browser's own notification shows nothing of the service worker's", async () => {
  // A browser that reads Declarative Web Push (as Safari) proposes its own notification on the event and shows it.
  const serviceWorker = installServiceWorkerStandIn({ declarative: true });
  listenForPushes(serviceWorker.worker);

  await serviceWorker.deliverPush(DECLARATIVE_PUSH);

  expect(serviceWorker.shownNotifications()).toEqual([]);
});

test("A push whose browser's own notification is null carries none: the service worker shows the message", async () => {
  // The boundary of "carries" (design.md D9): `null` is missing, as `undefined` is (41.1); the browser shows nothing itself.
  const serviceWorker = installServiceWorkerStandIn({ proposesNull: true });
  listenForPushes(serviceWorker.worker);

  await serviceWorker.deliverPush(DECLARATIVE_PUSH);

  expect(
    serviceWorker
      .shownNotifications()
      .map(({ title, body }) => ({ title, body })),
  ).toEqual([{ title: "Ahoj", body: "Zkušební zpráva" }]);
});

// ---- A tap opening the app, with no window of it open: listenForPushes (group 46) ----

/** A Declarative Web Push message opening `navigate`. */
function pushOpening(navigate: string): unknown {
  return { web_push: 8030, notification: { title: "Ahoj", navigate } };
}

test("A tap closes the notification", async () => {
  const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
  listenForPushes(serviceWorker.worker);
  await serviceWorker.deliverPush(pushOpening(APP_PAGE));

  await serviceWorker.tapNotification();

  expect(serviceWorker.closedNotifications()).toEqual([0]);
});

test("With no window of the app open, a tap opens the message's page on the service worker's own origin", async () => {
  const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
  listenForPushes(serviceWorker.worker);
  await serviceWorker.deliverPush(
    pushOpening(`${ORIGIN}/?z=upozorneni#zustatek`),
  );

  await serviceWorker.tapNotification();

  expect(serviceWorker.openedWindows()).toEqual([
    `${ORIGIN}/?z=upozorneni#zustatek`,
  ]);
});

test("A page on another origin opens as its path on the service worker's own origin", async () => {
  const cases: [string, { origin: string; navigate: string; opens: string }][] =
    [
      [
        "another site",
        {
          origin: ORIGIN,
          navigate: "https://jinde.example/ucet?z=upozorneni#zustatek",
          opens: `${ORIGIN}/ucet?z=upozorneni#zustatek`,
        },
      ],
      [
        // Locally the server's address is https://localhost (c011 design.md D5), the dev server's another (D9).
        "the server's local address on the dev server's origin",
        {
          origin: "https://localhost:5173",
          navigate: "https://localhost/",
          opens: "https://localhost:5173/",
        },
      ],
    ];

  for (const [name, { origin, navigate, opens }] of cases) {
    const serviceWorker = installServiceWorkerStandIn({
      origin,
      openWindows: [],
    });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(pushOpening(navigate));

    await serviceWorker.tapNotification();

    expect(serviceWorker.openedWindows(), name).toEqual([opens]);
  }
});

test("A page that cannot be read opens the start page", async () => {
  // A notification's data that is not a string (as one shown by an older service worker), or a string that is no
  // address even on the service worker's origin, is shown here through the stand-in's own showNotification.
  const cases: [string, unknown][] = [
    ["no data", undefined],
    ["a number", 42],
    ["an object", { navigate: APP_PAGE }],
    ["a string that is no address", "http://"],
  ];

  for (const [name, data] of cases) {
    const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.worker.registration.showNotification("Ahoj", { data });

    await expect(
      serviceWorker.tapNotification(),
      name,
    ).resolves.toBeUndefined();

    expect(serviceWorker.openedWindows(), name).toEqual([`${ORIGIN}/`]);
  }

  // An empty page is accepted (declarativeMessage) and opens the origin's root, the start page too.
  const emptyPage = installServiceWorkerStandIn({ openWindows: [] });
  listenForPushes(emptyPage.worker);
  await emptyPage.deliverPush(pushOpening(""));

  await emptyPage.tapNotification();

  expect(emptyPage.openedWindows(), "an empty page").toEqual([`${ORIGIN}/`]);
});

// Review finding (PR #78): a scheme other than http or https has a path that does not start with "/", so joined after
// the origin it ran on into the host or the port. The tap opens a page on the app's own address only (D9).
test("A page whose address has no path of the app's opens the start page, never another host or port", async () => {
  const cases: [string, string][] = [
    ["a user name ending the origin", "a:@evil.example/x"],
    ["a longer host", "javascript:.evil.example/"],
    ["letters run on into the host", "mailto:x"],
    ["another port", "a::8080/x"],
  ];

  for (const [name, navigate] of cases) {
    const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(pushOpening(navigate));

    await serviceWorker.tapNotification();

    expect(serviceWorker.openedWindows(), name).toEqual([`${ORIGIN}/`]);
  }
});

// ---- A tap with the app open: listenForPushes (group 48) ----

test("With a window of the app open, a tap focuses it and opens no other", async () => {
  const cases: [
    string,
    { openWindows?: string[]; uncontrolledWindows?: string[]; focused: string },
  ][] = [
    ["at the start page", { openWindows: [APP_PAGE], focused: APP_PAGE }],
    [
      // Focused as it is, not taken to the message's page: the app has one page (design.md D9).
      "at another address of the app",
      {
        openWindows: [`${ORIGIN}/?z=jinde#nahore`],
        focused: `${ORIGIN}/?z=jinde#nahore`,
      },
    ],
    [
      "not yet controlled by the service worker",
      { uncontrolledWindows: [APP_PAGE], focused: APP_PAGE },
    ],
    [
      "next to a window on another site",
      {
        openWindows: ["https://jinde.example/", APP_PAGE],
        focused: APP_PAGE,
      },
    ],
  ];

  for (const [name, { focused, ...windows }] of cases) {
    const serviceWorker = installServiceWorkerStandIn(windows);
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(pushOpening(APP_PAGE));

    await serviceWorker.tapNotification();

    expect(serviceWorker.focusedWindows(), name).toEqual([focused]);
    expect(serviceWorker.openedWindows(), name).toEqual([]);
  }

  // With two windows of the app open, one of them comes to the front (D9 does not say which).
  const twoWindows = [APP_PAGE, `${ORIGIN}/?z=druhe`];
  const withTwo = installServiceWorkerStandIn({ openWindows: twoWindows });
  listenForPushes(withTwo.worker);
  await withTwo.deliverPush(pushOpening(APP_PAGE));

  await withTwo.tapNotification();

  const focusedOfTwo = withTwo.focusedWindows();
  expect(focusedOfTwo, "two windows").toHaveLength(1);
  expect(twoWindows, "two windows").toContain(focusedOfTwo[0]);
  expect(withTwo.openedWindows(), "two windows").toEqual([]);
});

test("A window on another origin does not count as the app", async () => {
  const cases: [string, string][] = [
    ["another site", "https://jinde.example/"],
    ["another port of the same host", "https://tarjeta-papa.example:8443/"],
    ["a host that begins with the app's", `${ORIGIN}.jinde.example/`],
    ["the same host over http", "http://tarjeta-papa.example/"],
  ];

  for (const [name, otherWindow] of cases) {
    const serviceWorker = installServiceWorkerStandIn({
      openWindows: [otherWindow],
    });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(pushOpening(APP_PAGE));

    await serviceWorker.tapNotification();

    expect(serviceWorker.focusedWindows(), name).toEqual([]);
    expect(serviceWorker.openedWindows(), name).toEqual([APP_PAGE]);
  }
});

// ---- c015: the balance a push carries, kept (group 2; design.md D1, D2, D4); since c019 in navigate's fragment ----

/** A balance as a push carries it, exactly as `GET /api/balance` answers it (c015 design.md D1). Made up. */
const PUSHED: Balance = {
  amount: 282.6,
  readAt: "2026-11-10T08:59:00+00:00",
  czkPerEur: 24.3,
};

/** Another balance, so a test can tell which of two a push's balance came from. Made up. */
const OTHER: Balance = {
  amount: 250,
  readAt: "2026-11-10T08:30:00+00:00",
  czkPerEur: 24.3,
};

/** The balance the phone keeps before a push, read earlier than `PUSHED`. Made up. */
const KEPT_EARLIER: Balance = {
  amount: 286.4,
  readAt: "2026-11-10T07:00:00+00:00",
  czkPerEur: 24.3,
};

/** The title and text of a push of the account check (c015 design.md D1, N4). Made up. */
const PAYMENT_TITLE = "Odešlo 3,80 €";
const PAYMENT_TEXT = "Zůstatek 282,60 € (≈ 6 867 Kč)";

/** This phone's secret as its push subscription's `getKey("auth")` answers it: the stand-in's by default. Made up. */
const SECRET = secretBytes(PHONE_SECRET);

/** Another device's secret (16 zero bytes, base64url), so the stand-in's subscription is not this phone's. Made up. */
const ANOTHER_SECRET = "AAAAAAAAAAAAAAAAAAAAAA";

/**
 * The page a push of the account check opens since c019 (design.md D2): the start page on the stand-in's origin with
 * `balance` (any JSON value) in its fragment, its check code made for this phone (`PHONE_SECRET`).
 */
function pageWith(balance: unknown): Promise<string> {
  return balanceAddress(balance, PHONE_SECRET, { origin: ORIGIN });
}

/** A push of the account check opening `navigate` (c019 design.md D1): plain Declarative Web Push, no `mutable`, no `data`. */
function paymentPush(navigate: string): unknown {
  return {
    web_push: 8030,
    notification: { title: PAYMENT_TITLE, body: PAYMENT_TEXT, navigate },
  };
}

/** A push as the account check sends it since c019: `balance` in its page's fragment, made for this phone. */
async function pushWithBalance(balance: unknown): Promise<unknown> {
  return paymentPush(await pageWith(balance));
}

/**
 * The notification a browser that reads Declarative Web Push proposes for a push of the account check opening
 * `navigate` (W3C draft): the message's title, text and page, and no data (the push carries none since c019).
 */
function proposedOpening(navigate: unknown): unknown {
  return { title: PAYMENT_TITLE, body: PAYMENT_TEXT, navigate, data: null };
}

/** The notification proposed for a push of the account check with `balance` in its page's fragment, made for this phone. */
async function proposedFor(balance: unknown): Promise<unknown> {
  return proposedOpening(await pageWith(balance));
}

/** A push event with this data and this proposed notification (left out: a browser without the member). */
function pushEvent(fields: Pick<PushLike, "data" | "notification">): PushLike {
  return { ...fields, waitUntil: () => {} };
}

/** Push data whose `json()` gives this value. */
function dataOf(json: unknown): PushLike["data"] {
  return { json: () => structuredClone(json) };
}

// c019 (group 35; design.md D7): the balance is in `navigate`'s fragment, checked with the worker's subscription secret.

test("pushedBalance reads the balance in navigate's fragment from the push's JSON, checked with the subscription's secret", async () => {
  // 35.1. A browser that proposes no notification (as a computer's Chrome): the push's own JSON.
  const cases: [string, PushLike][] = [
    [
      "a browser that does not read Declarative Web Push (no proposed notification)",
      pushEvent({ data: dataOf(await pushWithBalance(PUSHED)) }),
    ],
    [
      "a browser whose proposed notification is null",
      pushEvent({
        data: dataOf(await pushWithBalance(PUSHED)),
        notification: null,
      }),
    ],
  ];

  for (const [name, event] of cases) {
    expect(await pushedBalance(event, SECRET), name).toEqual(PUSHED);
  }
});

test("With the browser's proposed notification, pushedBalance reads its navigate first", async () => {
  // 35.2. As the W3C draft has it: the event carries no data of its own, only the proposed notification.
  expect(
    await pushedBalance(
      pushEvent({ data: null, notification: await proposedFor(PUSHED) }),
      SECRET,
    ),
    "no data of the event's own",
  ).toEqual(PUSHED);
  // A browser that also hands over the push's own JSON (c015 design.md D2's order): the proposed notification's first.
  expect(
    await pushedBalance(
      pushEvent({
        data: dataOf(await pushWithBalance(OTHER)),
        notification: await proposedFor(PUSHED),
      }),
      SECRET,
    ),
    "the push's own JSON too, with another balance",
  ).toEqual(PUSHED);
});

/**
 * The two places a push's balance is found (design.md D7), each with nothing in the other: the proposed notification,
 * with no data of the event's own (the W3C draft); and the push's own JSON, with no proposed notification.
 */
const PLACES: [string, (navigate: string) => PushLike][] = [
  [
    "in the proposed notification",
    (navigate) =>
      pushEvent({ data: null, notification: proposedOpening(navigate) }),
  ],
  [
    "in the push's JSON",
    (navigate) => pushEvent({ data: dataOf(paymentPush(navigate)) }),
  ],
];

test("No subscription gives no balance", async () => {
  // 35.3. The same push with this phone's secret gives its balance, so the null below is the missing secret's.
  for (const [place, eventWith] of PLACES) {
    const event = eventWith(await pageWith(PUSHED));
    expect(
      await pushedBalance(event, SECRET),
      `with this phone's secret, ${place}`,
    ).toEqual(PUSHED);
    expect(await pushedBalance(event, null), `no secret, ${place}`).toBeNull();
  }
});

test("A code that does not verify gives no balance", async () => {
  // 35.3. A code made under another secret than this phone's, as a link's author or another device's notification
  // would carry it; this phone's own code over the same balance gives it, so the null is the code's.
  for (const [place, eventWith] of PLACES) {
    expect(
      await pushedBalance(eventWith(await pageWith(PUSHED)), SECRET),
      `this phone's code, ${place}`,
    ).toEqual(PUSHED);
    expect(
      await pushedBalance(
        eventWith(await wrongCode(PUSHED, PHONE_SECRET, { origin: ORIGIN })),
        SECRET,
      ),
      `another secret's code, ${place}`,
    ).toBeNull();
  }
});

test("The service worker checks a push's balance with its own subscription's secret", async () => {
  // 35.1 and 35.3, through the listener: the secret is the one `registration.pushManager.getSubscription()` answers.
  await phoneKeeps(KEPT_EARLIER);
  const push = await pushWithBalance(PUSHED);
  const workers: [string, ServiceWorkerStandIn][] = [
    [
      "a subscription with another device's secret",
      installServiceWorkerStandIn({ subscription: { auth: ANOTHER_SECRET } }),
    ],
    ["no subscription", installServiceWorkerStandIn({ subscription: null })],
  ];

  for (const [name, serviceWorker] of workers) {
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(push);
    expect(await keptBalance(), name).toEqual(KEPT_EARLIER);
  }

  // The stand-in's default subscription is this phone's (`PHONE_SECRET`), the one the push was made for.
  const thisPhone = installServiceWorkerStandIn();
  listenForPushes(thisPhone.worker);
  await thisPhone.deliverPush(push);
  expect(await keptBalance(), "this phone's subscription").toEqual(PUSHED);
});

test("A push with a balance is kept also where the service worker shows the notification itself, and the message still shows", async () => {
  // 35.4.
  await phoneKeeps(KEPT_EARLIER);
  // The stand-in's default browser does not read Declarative Web Push (as Chrome on a computer): the service worker shows it.
  const serviceWorker = installServiceWorkerStandIn();
  listenForPushes(serviceWorker.worker);
  const page = await pageWith(PUSHED);

  // Resolves once the event's waitUntil work is done.
  await serviceWorker.deliverPush(paymentPush(page));

  expect(await keptBalance(), "the balance the phone keeps").toEqual(PUSHED);
  expect(serviceWorker.shownNotifications()).toEqual([
    { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: page },
  ]);
});

test("The notification starts in the same turn as the push, never waiting for its balance", async () => {
  // 35.4. The subscription's secret, the check and the write all come later; the notification is asked for at once.
  const serviceWorker = installServiceWorkerStandIn();
  listenForPushes(serviceWorker.worker);
  const page = await pageWith(PUSHED);

  // Not awaited: the stand-in resolves only once the event's work is done.
  const delivery = serviceWorker.deliverPush(paymentPush(page));

  expect(serviceWorker.shownNotifications()).toEqual([
    { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: page },
  ]);
  await delivery;
});

// ---- c015: a balance of the wrong shape (group 9; design.md D2: `balanceOf` is the one shape check) ----
// Since c019 each balance below is in the page's fragment with this phone's own check code, so only its shape is wrong.

/**
 * Each balance below, in each place (`PLACES`): no balance is found; the balance of the right shape, in the same place,
 * is found, so each null is the shape's.
 */
async function expectNoBalance(balances: [string, unknown][]): Promise<void> {
  for (const [place, eventWith] of PLACES) {
    expect(
      await pushedBalance(eventWith(await pageWith(PUSHED)), SECRET),
      `the right shape, ${place}`,
    ).toEqual(PUSHED);
  }
  for (const [shape, balance] of balances) {
    for (const [place, eventWith] of PLACES) {
      expect(
        await pushedBalance(eventWith(await pageWith(balance)), SECRET),
        `${shape}, ${place}`,
      ).toBeNull();
    }
  }
}

test("A balance without its read time is no balance, in the proposed notification and in the push's JSON", async () => {
  await expectNoBalance([
    ["no read time", { amount: PUSHED.amount, czkPerEur: PUSHED.czkPerEur }],
    ["a null read time", { ...PUSHED, readAt: null }],
  ]);
});

test("A balance whose amount or rate is not a number, or whose read time is no date, is no balance", async () => {
  await expectNoBalance([
    ["the amount as text", { ...PUSHED, amount: "282.60" }],
    ["no amount", { readAt: PUSHED.readAt, czkPerEur: PUSHED.czkPerEur }],
    ["the rate as text", { ...PUSHED, czkPerEur: "24.3" }],
    ["no rate", { amount: PUSHED.amount, readAt: PUSHED.readAt }],
    ["a read time that is no date", { ...PUSHED, readAt: "včera" }],
    [
      "a read time as a number, not a date and time",
      { ...PUSHED, readAt: Date.parse(PUSHED.readAt) },
    ],
  ]);
});

// ---- c015: a push without a balance (group 11; design.md D2, § Error model: `pushedBalance` never throws) ----
// A throw from `pushedBalance` fails each of these tests as surely as a balance found would.

test("A declarative message whose page has no balance fragment carries no balance, as the owner's messages", async () => {
  // The owner's message (c011 design.md D2): no "mutable", no data, the start page. Proposed, its `data` is null.
  const proposed = {
    ...DECLARATIVE_PUSH.notification,
    data: null,
  };
  const cases: [string, PushLike][] = [
    [
      "a browser that reads Declarative Web Push: the proposed notification, no data of the event's own",
      pushEvent({ data: null, notification: proposed }),
    ],
    [
      "a browser that reads Declarative Web Push and also hands over the push's own JSON",
      pushEvent({ data: dataOf(DECLARATIVE_PUSH), notification: proposed }),
    ],
    [
      "a browser that does not: the push's own JSON",
      pushEvent({ data: dataOf(DECLARATIVE_PUSH) }),
    ],
  ];

  for (const [name, event] of cases) {
    expect(await pushedBalance(event, SECRET), name).toBeNull();
  }
});

test("A proposed notification whose page carries no balance carries none, and the push's own JSON is read then", async () => {
  const unusable: [string, unknown][] = [
    ["no page", undefined],
    ["a page of null", null],
    ["a page that is a number", 282.6],
    ["the start page, no fragment", APP_PAGE],
    ["a fragment of another kind", `${ORIGIN}/#zustatek`],
  ];

  for (const [name, navigate] of unusable) {
    const notification = proposedOpening(navigate);
    // With no data of the event's own (null, as the W3C draft has it): no balance at all.
    expect(
      await pushedBalance(pushEvent({ data: null, notification }), SECRET),
      `${name}, no data of the event's own`,
    ).toBeNull();
    // With a balance in the push's own JSON, the balance is taken from there (c015 design.md D2's order: first, then).
    expect(
      await pushedBalance(
        pushEvent({
          data: dataOf(await pushWithBalance(PUSHED)),
          notification,
        }),
        SECRET,
      ),
      `${name}, a balance in the push's own JSON`,
    ).toEqual(PUSHED);
  }
});

test("A push with no data at all, or of text that is not JSON, carries no balance", async () => {
  // As the browser's `PushMessageData.json()` does: it throws a SyntaxError for text that is not JSON.
  const notJson: PushLike["data"] = {
    json: () => JSON.parse("Ahoj") as unknown,
  };
  const cases: [string, PushLike][] = [
    ["no data, no proposed notification", pushEvent({ data: null })],
    [
      "no data, a proposed notification of null",
      pushEvent({ data: null, notification: null }),
    ],
    [
      "text that is not JSON, no proposed notification",
      pushEvent({ data: notJson }),
    ],
    [
      "text that is not JSON, a proposed notification of null",
      pushEvent({ data: notJson, notification: null }),
    ],
  ];

  for (const [name, event] of cases) {
    expect(await pushedBalance(event, SECRET), name).toBeNull();
  }
});

// ---- c015: a failing store (group 13; design.md D3: the write never rejects; D4: it never stops the notification) ----

/**
 * The service worker's storage failing (`phoneStorageFails`) as C7a's tests break it: a store the worker used before,
 * whose connection idb-keyval keeps open, or one it never opened, where opening fails at once (idb-keyval then throws
 * rather than rejects). Each gives the `listenForPushes` to test.
 */
const FAILING_STORES: {
  label: string;
  listen: () => Promise<typeof listenForPushes>;
}[] = [
  {
    label: "a store used before, its connection open",
    listen: async () => {
      // An earlier push, while the store works: its write opens the connection.
      const earlier = installServiceWorkerStandIn();
      listenForPushes(earlier.worker);
      await earlier.deliverPush(await pushWithBalance(PUSHED));
      return listenForPushes;
    },
  },
  {
    label: "a store never opened",
    listen: async () => {
      // A fresh copy of the module, its storage and idb-keyval, which have opened nothing yet.
      vi.resetModules();
      return (await import("./pushDisplay")).listenForPushes;
    },
  },
];

test.each(FAILING_STORES)(
  "A failing store still lets the service worker show the message: $label",
  async ({ listen }) => {
    const listenHere = await listen();
    // The stand-in's default browser does not read Declarative Web Push (as Chrome on a computer): the service worker shows it.
    const serviceWorker = installServiceWorkerStandIn();
    listenHere(serviceWorker.worker);
    const page = await pageWith(PUSHED);
    const restoreStorage = phoneStorageFails();

    try {
      // Resolves once the event's waitUntil work is done; fails the test if that work fails.
      await serviceWorker.deliverPush(paymentPush(page));
    } finally {
      restoreStorage();
    }

    expect(serviceWorker.shownNotifications()).toEqual([
      { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: page },
    ]);
  },
);

test.each(FAILING_STORES)(
  "A failing store never makes the push event's work reject where the browser shows its own notification: $label",
  async ({ listen }) => {
    const listenHere = await listen();
    // A browser that reads Declarative Web Push and still fires the push event: the balance comes from its proposed
    // notification, and it shows that notification once the event's work has settled (c015 design.md D4).
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenHere(serviceWorker.worker);
    const push = await pushWithBalance(PUSHED);
    const restoreStorage = phoneStorageFails();

    try {
      // The stand-in waits for every promise given to waitUntil, and rejects as soon as one of them rejects.
      await expect(serviceWorker.deliverPush(push)).resolves.toBeUndefined();
    } finally {
      restoreStorage();
    }
  },
);

test("The message is shown without waiting for the balance to be written", async () => {
  await phoneKeeps(KEPT_EARLIER);
  // The stand-in's default browser does not read Declarative Web Push (as Chrome on a computer): the service worker shows it.
  const serviceWorker = installServiceWorkerStandIn();
  listenForPushes(serviceWorker.worker);
  const page = await pageWith(PUSHED);
  const freeStorage = await phoneStorageBusy();
  let delivery: Promise<void> | undefined;
  let workDone = false;

  try {
    // Not awaited: the stand-in resolves only once the event's work, the write among it, is done.
    delivery = serviceWorker.deliverPush(paymentPush(page));
    void delivery.then(
      () => {
        workDone = true;
      },
      () => {
        workDone = true;
      },
    );
    for (let turn = 0; turn < 20; turn += 1) await realTurn();

    expect(workDone, "the write is still waiting for the storage").toBe(false);
    expect(serviceWorker.shownNotifications()).toEqual([
      { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: page },
    ]);
  } finally {
    await freeStorage();
  }

  // Once the storage is free, the write goes through: the worker's work was waiting for it.
  await delivery;
  expect(await keptBalance(), "the balance the phone keeps").toEqual(PUSHED);
});
