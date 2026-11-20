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
