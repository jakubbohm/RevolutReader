import { expect, test, vi } from "vitest";
import { realTurn, SECOND, startTestClock, timePasses } from "../test/clock";
import {
  after,
  answerWith,
  bodiesSent,
  keptBalance,
  phoneKeeps,
  phoneStorageBusy,
  phoneStorageFails,
  recorded,
  requests,
  timeline,
} from "../test/server";
import {
  installServiceWorkerStandIn,
  ORIGIN,
  type ServiceWorkerStandIn,
  type ServiceWorkerStandInOptions,
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

// ---- c015: the balance a push carries, kept (group 2; design.md D1, D2, D4) ----

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

/**
 * A push as the account check sends it (c015 design.md D1): Declarative Web Push with `"mutable": true`, opening the
 * start page, with `balance` in its notification's data.
 */
function pushWithBalance(balance: unknown): unknown {
  return {
    web_push: 8030,
    mutable: true,
    notification: {
      title: PAYMENT_TITLE,
      body: PAYMENT_TEXT,
      navigate: APP_PAGE,
      data: { balance },
    },
  };
}

/**
 * The notification a browser that reads Declarative Web Push proposes for that push: the message's `notification.data`
 * becomes its `data` (W3C draft, c015 design.md D2).
 */
function proposedFor(balance: unknown): unknown {
  return proposedWithData({ balance });
}

/** The notification proposed for a push of the account check, with this as its `data`. */
function proposedWithData(data: unknown): unknown {
  return {
    title: PAYMENT_TITLE,
    body: PAYMENT_TEXT,
    navigate: APP_PAGE,
    data,
  };
}

/** A push event with this data and this proposed notification (left out: a browser without the member). */
function pushEvent(fields: Pick<PushLike, "data" | "notification">): PushLike {
  return { ...fields, waitUntil: () => {} };
}

/** Push data whose `json()` gives this value. */
function dataOf(json: unknown): PushLike["data"] {
  return { json: () => structuredClone(json) };
}

test("The balance comes from the data of the browser's proposed notification when the push event carries one", () => {
  // As the W3C draft has it: the event carries no data of its own, only the proposed notification.
  expect(
    pushedBalance(pushEvent({ data: null, notification: proposedFor(PUSHED) })),
    "no data of the event's own",
  ).toEqual(PUSHED);
  // A browser that also hands over the push's own JSON (design.md D2): the proposed notification's balance comes first.
  expect(
    pushedBalance(
      pushEvent({
        data: dataOf(pushWithBalance(OTHER)),
        notification: proposedFor(PUSHED),
      }),
    ),
    "the push's own JSON too, with another balance",
  ).toEqual(PUSHED);
});

test("The balance comes from the push's own JSON where the browser proposes no notification", () => {
  const cases: [string, PushLike][] = [
    [
      "a browser that does not read Declarative Web Push (no proposed notification)",
      pushEvent({ data: dataOf(pushWithBalance(PUSHED)) }),
    ],
    [
      "a browser whose proposed notification is null",
      pushEvent({ data: dataOf(pushWithBalance(PUSHED)), notification: null }),
    ],
  ];

  for (const [name, event] of cases) {
    expect(pushedBalance(event), name).toEqual(PUSHED);
  }
});

test("A push with a balance is kept also where the service worker shows the notification itself, and the message still shows", async () => {
  await phoneKeeps(KEPT_EARLIER);
  // The stand-in's default browser does not read Declarative Web Push (as Chrome on a computer): the service worker shows it.
  const serviceWorker = installServiceWorkerStandIn();
  listenForPushes(serviceWorker.worker);

  // Resolves once the event's waitUntil work is done.
  await serviceWorker.deliverPush(pushWithBalance(PUSHED));

  expect(await keptBalance(), "the balance the phone keeps").toEqual(PUSHED);
  expect(serviceWorker.shownNotifications()).toEqual([
    { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: APP_PAGE },
  ]);
});

// ---- c015: a balance of the wrong shape (group 9; design.md D2: `balanceOf` is the one shape check) ----

/**
 * The two places a push's balance is found (design.md D2), each with nothing valid in the other: the proposed
 * notification, with no data of the event's own (the W3C draft); and the push's own JSON, with no proposed notification.
 */
const PLACES: [string, (balance: unknown) => PushLike][] = [
  [
    "in the proposed notification",
    (balance) => pushEvent({ data: null, notification: proposedFor(balance) }),
  ],
  [
    "in the push's JSON",
    (balance) => pushEvent({ data: dataOf(pushWithBalance(balance)) }),
  ],
];

/** Each balance below, in each place: no balance is found. */
function expectNoBalance(balances: [string, unknown][]): void {
  for (const [shape, balance] of balances) {
    for (const [place, eventWith] of PLACES) {
      expect(
        pushedBalance(eventWith(balance)),
        `${shape}, ${place}`,
      ).toBeNull();
    }
  }
}

test("A balance without its read time is no balance, in the proposed notification and in the push's JSON", () => {
  expectNoBalance([
    ["no read time", { amount: PUSHED.amount, czkPerEur: PUSHED.czkPerEur }],
    ["a null read time", { ...PUSHED, readAt: null }],
  ]);
});

test("A balance whose amount or rate is not a number, or whose read time is no date, is no balance", () => {
  expectNoBalance([
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

test("A declarative message with no data in its notification carries no balance, as the owner's messages", () => {
  // The owner's message (c011 design.md D2): no "mutable", no data. Proposed, its notification's `data` is null.
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
    expect(pushedBalance(event), name).toBeNull();
  }
});

test("A proposed notification whose data is not an object, or has no balance, carries no balance", () => {
  const unusable: [string, unknown][] = [
    // As a Safari would give it if the message's data never reached its notification (design.md § Risks).
    ["no data (null)", null],
    ["data that is text", "282,60 €"],
    ["data that is a number", 282.6],
    ["data that is a list", [{ balance: PUSHED }]],
    ["data with no balance", {}],
    ["the balance's fields in the data itself, not under balance", PUSHED],
  ];

  for (const [name, data] of unusable) {
    const notification = proposedWithData(data);
    // With nothing usable in the event's own data (null, as the W3C draft has it): no balance at all.
    expect(
      pushedBalance(pushEvent({ data: null, notification })),
      `${name}, no data of the event's own`,
    ).toBeNull();
    // With a balance in the push's own JSON, the balance is taken from there (design.md D2: first, then).
    expect(
      pushedBalance(
        pushEvent({ data: dataOf(pushWithBalance(PUSHED)), notification }),
      ),
      `${name}, a balance in the push's own JSON`,
    ).toEqual(PUSHED);
  }
});

test("A push with no data at all, or of text that is not JSON, carries no balance", () => {
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
    expect(pushedBalance(event), name).toBeNull();
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
      await earlier.deliverPush(pushWithBalance(PUSHED));
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
    const restoreStorage = phoneStorageFails();

    try {
      // Resolves once the event's waitUntil work is done; fails the test if that work fails.
      await serviceWorker.deliverPush(pushWithBalance(PUSHED));
    } finally {
      restoreStorage();
    }

    expect(serviceWorker.shownNotifications()).toEqual([
      { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: APP_PAGE },
    ]);
  },
);

test.each(FAILING_STORES)(
  "A failing store never makes the push event's work reject where the browser shows its own notification: $label",
  async ({ listen }) => {
    const listenHere = await listen();
    // A browser that reads Declarative Web Push (as Safari): the balance comes from its proposed notification, and it
    // shows that notification once the event's work has settled (design.md D4).
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenHere(serviceWorker.worker);
    const restoreStorage = phoneStorageFails();

    try {
      // The stand-in waits for every promise given to waitUntil, and rejects as soon as one of them rejects.
      await expect(
        serviceWorker.deliverPush(pushWithBalance(PUSHED)),
      ).resolves.toBeUndefined();
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
  const freeStorage = await phoneStorageBusy();
  let delivery: Promise<void> | undefined;
  let workDone = false;

  try {
    // Not awaited: the stand-in resolves only once the event's work, the write among it, is done.
    delivery = serviceWorker.deliverPush(pushWithBalance(PUSHED));
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
      { title: PAYMENT_TITLE, body: PAYMENT_TEXT, data: APP_PAGE },
    ]);
  } finally {
    await freeStorage();
  }

  // Once the storage is free, the write goes through: the worker's work was waiting for it.
  await delivery;
  expect(await keptBalance(), "the balance the phone keeps").toEqual(PUSHED);
});

// ---- c016: a push's arrival, reported (group 10; design.md D1, D2, D5) ----
// The stand-in's `fetch` reaches the fake server (../test/server.ts), which answers the report 204 unless a test sets
// another answer; a report is read there.

/** A report of a push's arrival, as the fake server's timeline writes it: on the app's own origin (design.md D3). */
const REPORT = "POST /api/push/arrivals";

/** The bodies of the reports of a push's arrival the fake server received, in order. */
function reportsReceived(): unknown[] {
  return bodiesSent()
    .filter(({ request }) => request === REPORT)
    .map(({ body }) => body);
}

/** The two browsers that propose no notification of their own: the push's balance is in its own JSON (design.md D2). */
const PROPOSING_NONE: {
  label: string;
  options: ServiceWorkerStandInOptions;
}[] = [
  {
    label: "a browser that does not read Declarative Web Push",
    options: { declarative: false },
  },
  {
    label: "a browser whose proposed notification is null",
    options: { proposesNull: true },
  },
];

/** Both kinds of browser: one that shows its own notification (as Safari), one where the service worker shows it (as Chrome). */
const BOTH_KINDS: {
  label: string;
  options: ServiceWorkerStandInOptions;
}[] = [
  {
    label: "where the browser shows its own notification",
    options: { declarative: true },
  },
  {
    label: "where the service worker shows the notification",
    options: { declarative: false },
  },
];

test("A push's arrival is reported with the read time from the data of the browser's proposed notification", async () => {
  // As the W3C draft has it: the event carries no data of its own, only the proposed notification.
  const serviceWorker = installServiceWorkerStandIn({ declarative: true });
  listenForPushes(serviceWorker.worker);

  // Resolves once the event's waitUntil work is done.
  await serviceWorker.deliverPush(pushWithBalance(PUSHED));

  expect(reportsReceived(), "the reports received").toEqual([
    { readAt: PUSHED.readAt },
  ]);
});

test.each(PROPOSING_NONE)(
  "A push's arrival is reported with the read time from the push's own JSON where the browser proposes no notification: $label",
  async ({ options }) => {
    const serviceWorker = installServiceWorkerStandIn(options);
    listenForPushes(serviceWorker.worker);

    // Resolves once the event's waitUntil work is done.
    await serviceWorker.deliverPush(pushWithBalance(PUSHED));

    expect(reportsReceived(), "the reports received").toEqual([
      { readAt: PUSHED.readAt },
    ]);
  },
);

test.each(BOTH_KINDS)(
  "The report runs under the push event's waitUntil: $label",
  async ({ options }) => {
    startTestClock();
    // Read earlier than the push's balance, so the push's balance replaces it and the write shows when it is done.
    await phoneKeeps(KEPT_EARLIER);
    // The server is waking up: it answers the report only 20 s later.
    answerWith({ arrivals: after(20 * SECOND, recorded) });
    const serviceWorker = installServiceWorkerStandIn(options);
    listenForPushes(serviceWorker.worker);
    let workDone = false;

    // Not awaited: the stand-in resolves only once the work given to the event's waitUntil is done.
    const delivery = serviceWorker
      .deliverPush(pushWithBalance(PUSHED))
      .then(() => {
        workDone = true;
      });
    await timePasses(0);

    expect(requests(), "the report is under way").toContain(REPORT);
    // The balance is written, so nothing else of the push's is left to wait for.
    expect(await keptBalance(), "the balance the phone keeps").toEqual(PUSHED);
    await timePasses(0);
    expect(workDone, "the push's work, while the report has no answer").toBe(
      false,
    );

    await timePasses(20 * SECOND);
    expect(timeline(), "the server answered the report").toContain(
      `answer ${REPORT}`,
    );
    await delivery;
    expect(workDone, "the push's work, once the report has its answer").toBe(
      true,
    );
  },
);
