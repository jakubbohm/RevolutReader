import { expect, test } from "vitest";
import { realTurn, SECOND, startTestClock, timePasses } from "./clock";
import {
  after,
  answerWith,
  closeApp,
  leaveApp,
  noAnswerYet,
  openPageAt,
  pageAddress,
  refused,
  resetFakeServer,
  serverError,
  stored,
  subscriptionRefused,
  tapNotificationInTheBackground,
  timeline,
} from "./server";

// The test kit's own checks: the fake server (./server.ts) behaves as the app's tests rely on, also where Node and a
// browser differ.

// Why this test exists (#97): the app's API client wraps every call in a `Request` that follows the app's abort signal.
// In Node that link lasts only while something keeps the `Request` itself: a garbage collection that finds nothing
// keeping it cuts the link, and the app's later abort (its 60 s limit) never reaches the request, which then never ends.
// A browser keeps the link. So the fake server must keep every open request until it ends. This test leaves a request
// open, keeps nothing of it but the app's abort controller, forces a garbage collection, aborts, and expects the request
// to end as aborted.
test("An open request the app aborts still ends after a garbage collection", async () => {
  answerWith({ balance: noAnswerYet });
  const controller = new AbortController();

  // As the API client sends it: a `Request` made on the spot and kept by nobody here, only by the fake server.
  const ended = fetch(
    new Request(new URL("/api/balance", location.href), {
      signal: controller.signal,
    }),
  ).then(
    () => "answered",
    (error: unknown) => (error as Error).name,
  );
  await realTurns(5);
  expect(timeline()).toEqual(["request GET /api/balance"]);

  await collectGarbage();
  controller.abort();

  expect(await Promise.race([ended, stillWaitingAfter(50)])).toBe("AbortError");
  expect(timeline()).toEqual([
    "request GET /api/balance",
    "aborted GET /api/balance",
  ]);
});

// Why the next three tests exist (#97): a request takes its answer when it is sent, with a body or without: the server
// answered it, and after the app is closed (`closeApp`, as `renderApp`'s `reopen` does) only the answer never arrives.
// Once the app is closed, nothing more about its requests appears in the timeline. A request with a body reads it before
// anything else, which takes at least a microtask, so the app can be closed in between; that must change neither which
// answer the reopened app's requests get nor the timeline.

test("A request with a body sent just before a close takes its answer from the answers set before the close", async () => {
  answerWith({ subscription: [stored, refused(null)] });
  // The closed app's request: its answer never arrives.
  void sendSubscription();
  closeApp();
  answerWith({
    subscription: [subscriptionRefused("endpoint"), serverError],
  });
  // The reopened app sends the same request a little later.
  await realTurns(5);

  // 400: the first of the answers set after the close, `subscriptionRefused`.
  expect(await statusOf(sendSubscription())).toBe(400);
});

test("A closed app's request adds nothing to the timeline after the close", async () => {
  startTestClock();
  answerWith({ subscription: after(SECOND, stored) });
  const controller = new AbortController();
  const ended = endingOf(sendSubscription(controller.signal));
  // As `renderApp`'s `reopen` closes the app: the unmounted app aborts its request, then the app is closed.
  controller.abort();
  closeApp();

  await timePasses(5 * SECOND);

  expect(timeline()).toEqual(["request PUT /api/push/subscription"]);
  expect(await Promise.race([ended, stillWaitingAfter(50)])).toBe(
    "still waiting",
  );
});

test("A request with a body sent just before a close still takes its answer, so the next request gets the next one", async () => {
  answerWith({ subscription: [stored, serverError] });
  // The closed app's request: the server answered it, though its answer never arrives.
  void sendSubscription();
  closeApp();
  // The reopened app sends the same request a little later.
  await realTurns(5);

  // 500: the second answer, `serverError`.
  expect(await statusOf(sendSubscription())).toBe(500);
});

/**
 * The device's subscription, sent as the API client sends it: a `Request` made on the spot, with a JSON body (made-up
 * values) and the app's abort signal, if any.
 */
function sendSubscription(signal?: AbortSignal): Promise<Response> {
  return fetch(
    new Request(new URL("/api/push/subscription", location.href), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://web.push.apple.com/made-up-device",
        expirationTime: null,
        keys: { p256dh: "made-up-device-key", auth: "made-up-secret" },
      }),
      signal: signal ?? null,
    }),
  );
}

/** The status of the answer that reaches the app, or "still waiting" when none has after 50 real turns. */
async function statusOf(sent: Promise<Response>): Promise<number | string> {
  return Promise.race([
    sent.then((response) => response.status),
    stillWaitingAfter(50),
  ]);
}

/** How a request ends: "answered", or the name of the error it fails with. */
async function endingOf(sent: Promise<Response>): Promise<string> {
  return sent.then(
    () => "answered",
    (error: unknown) => (error as Error).name,
  );
}

// ---- c019: the page's address (design.md D5, D6, D12) ----
// The app reads its own address from `location` and cleans it with `history.replaceState`; a tap in the background goes
// to the notification's fragment while the page is hidden. The fake server's recording `location` must follow all of
// it, as a browser does, and start every test at the start page again.

const FRAGMENT = "#balance=made-up.code";

test("The page opens at the address the test gives, its fragment included", () => {
  openPageAt(`/${FRAGMENT}`);

  expect(location.hash).toBe(FRAGMENT);
  expect(location.pathname).toBe("/");
  expect(pageAddress()).toBe(`/${FRAGMENT}`);
});

test("history.replaceState changes the page's address and fires no hashchange", () => {
  openPageAt(`/${FRAGMENT}`);
  const heard: string[] = [];
  const hear = (): void => {
    heard.push("hashchange");
  };
  window.addEventListener("hashchange", hear);

  try {
    history.replaceState(null, "", "/");
  } finally {
    window.removeEventListener("hashchange", hear);
  }

  expect(location.hash).toBe("");
  expect(pageAddress()).toBe("/");
  expect(heard).toEqual([]);
});

test("Setting location.hash goes to the fragment and fires hashchange once, none when it is already there", () => {
  const heard: string[] = [];
  const hear = (event: HashChangeEvent): void => {
    heard.push(
      `${new URL(event.oldURL).hash} -> ${new URL(event.newURL).hash}`,
    );
  };
  window.addEventListener("hashchange", hear);

  try {
    location.hash = FRAGMENT;
    location.hash = FRAGMENT;
  } finally {
    window.removeEventListener("hashchange", hear);
  }

  expect(pageAddress()).toBe(`/${FRAGMENT}`);
  expect(heard).toEqual([` -> ${FRAGMENT}`]);
});

test("A tap in the background goes to the fragment while the page is hidden, then returns to the app", () => {
  leaveApp();
  const heard: string[] = [];
  const hearHash = (): void => {
    heard.push(`hashchange while ${document.visibilityState}`);
  };
  const hearReturn = (): void => {
    heard.push(`visibilitychange to ${document.visibilityState}`);
  };
  window.addEventListener("hashchange", hearHash);
  document.addEventListener("visibilitychange", hearReturn);

  try {
    tapNotificationInTheBackground(`${location.origin}/${FRAGMENT}`);
  } finally {
    window.removeEventListener("hashchange", hearHash);
    document.removeEventListener("visibilitychange", hearReturn);
  }

  expect(heard).toEqual([
    "hashchange while hidden",
    "visibilitychange to visible",
  ]);
  expect(pageAddress()).toBe(`/${FRAGMENT}`);
});

test("A tap in the background needs the app in the background", () => {
  expect(() => {
    tapNotificationInTheBackground(`/${FRAGMENT}`);
  }).toThrow(/leaveApp/);
});

test("The next test starts at the start page", () => {
  openPageAt(`/${FRAGMENT}`);

  resetFakeServer();

  expect(pageAddress()).toBe("/");
  expect(location.hash).toBe("");
});

async function realTurns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await realTurn();
}

/**
 * Two full garbage collections, each followed by a real turn, so the clean-ups a collection schedules (Node's
 * `FinalizationRegistry` callbacks) run before the next step, and what they free is collected too.
 */
async function collectGarbage(): Promise<void> {
  const { gc } = globalThis as unknown as { gc?: () => void };
  if (typeof gc !== "function")
    throw new Error(
      "No gc() in the test worker: vite.config.ts must pass --expose-gc to it (test.execArgv).",
    );
  for (let round = 0; round < 2; round += 1) {
    gc();
    await realTurn();
  }
}

/** "still waiting" after `turns` real turns, so a request that never ends fails the test at once, not on its timeout. */
async function stillWaitingAfter(turns: number): Promise<string> {
  await realTurns(turns);
  return "still waiting";
}
