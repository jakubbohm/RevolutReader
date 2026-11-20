import { expect, test } from "vitest";
import {
  installServiceWorkerStandIn,
  ORIGIN,
  type ServiceWorkerStandIn,
} from "../test/serviceWorker";
import { declarativeMessage, listenForPushes } from "./pushDisplay";

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
