import { screen } from "@testing-library/react";
import { expect } from "vitest";
import { listenForPushes } from "../app/pushDisplay";
import {
  ago,
  HOUR,
  MINUTE,
  SECOND,
  startTestClock,
  timePasses,
} from "../test/clock";
import { renderApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  answerWith,
  bodiesSent,
  goOffline,
  kept,
  KORUNA_RATE,
  phoneKeeps,
  recorded,
  requests,
  serverError,
  signedIn,
  timeline,
} from "../test/server";
import { installServiceWorkerStandIn, ORIGIN } from "../test/serviceWorker";

// The service worker's report of a push's arrival (c016 design.md D1-D5, D7): `listenForPushes` fed a push through the
// service worker's stand-in, as push-display's scenarios do; the reports read from the fake server, which the stand-in's
// `fetch` reaches; the notification from the stand-in; the kept balance by opening the app offline. Each push is
// delivered in full, its `waitUntil` work done, except where the scenario is about not waiting.

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const OFFLINE = "Jsi offline";

/** A report of a push's arrival, as the fake server's timeline writes it (design.md D3): on the app's own origin. */
const REPORT = "POST /api/push/arrivals";

/** The reports' address, in any request the timeline writes, whatever its method or origin. */
const REPORT_PATH = "/api/push/arrivals";

/** A push as the owner's messages are (c011 design.md D2): Declarative Web Push, no "mutable", no data. */
function message(title: string): unknown {
  return {
    web_push: 8030,
    notification: { title, navigate: `${ORIGIN}/` },
  };
}

/**
 * A balance a push carries: `amount` EUR read at `readAt`, a time (written as the API writes one) or the text exactly as
 * the push gives it; without `readAt`, a balance with no read time (the wrong shape).
 */
interface PushedBalance {
  amount: number;
  readAt?: Date | string;
}

/** The title of a push whose title no scenario names (made up, unlike every title a scenario names). */
const SOME_PAYMENT = "Odešlo 1,00 €";

/**
 * A push as the account check sends it (c015 design.md D1, c014 design.md D14): Declarative Web Push with
 * `"mutable": true`, opening the start page, and in its notification's data only `balance`, exactly as
 * `GET /api/balance` answers it (`amount`, `readAt` as the API writes a time, `czkPerEur` at C13's rate). A balance
 * given no `readAt` goes without it. The title is `SOME_PAYMENT` unless `title` names one; no text unless `body` gives it.
 */
function pushWithBalance(
  pushed: PushedBalance,
  options: { title?: string; body?: string } = {},
): unknown {
  const balance =
    pushed.readAt === undefined
      ? { amount: pushed.amount, czkPerEur: KORUNA_RATE }
      : typeof pushed.readAt === "string"
        ? {
            amount: pushed.amount,
            readAt: pushed.readAt,
            czkPerEur: KORUNA_RATE,
          }
        : kept(pushed.amount, pushed.readAt);
  return {
    web_push: 8030,
    mutable: true,
    notification: {
      title: options.title ?? SOME_PAYMENT,
      ...(options.body === undefined ? {} : { body: options.body }),
      navigate: `${ORIGIN}/`,
      data: { balance },
    },
  };
}

/** Every report of a push's arrival that reached the fake server, as its timeline writes the request, in order. */
function reportsReceived(): string[] {
  return requests().filter((request) => request.includes(REPORT_PATH));
}

/** The body of every report of a push's arrival on the app's own origin, parsed as JSON, in order. */
function reportBodies(): unknown[] {
  return bodiesSent()
    .filter(({ request }) => request === REPORT)
    .map(({ body }) => body);
}

/**
 * The app opened on the iPhone's Home Screen with the phone offline, so nothing but what the phone keeps can show; on
 * the test clock, it has read the phone's storage when this returns.
 */
async function openTheAppOffline(): Promise<void> {
  goOffline();
  renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
  await timePasses(0);
  expect(
    screen.getByText(OFFLINE),
    "the app opened offline",
  ).toBeInTheDocument();
}

scenario(
  "push-arrivals",
  "A push with a balance reports its arrival with the balance's read time",
  async () => {
    const readAt = "2026-11-21T09:14:03+00:00";
    // Two seconds after the read, as a push on time arrives.
    startTestClock(new Date("2026-11-21T09:14:05Z"));
    await phoneKeeps(kept(250, new Date("2026-11-21T07:14:03Z")));
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(pushWithBalance({ amount: 286.4, readAt }));

    expect(reportsReceived(), "reports of the push's arrival").toEqual([
      REPORT,
    ]);
    expect(reportBodies(), "what the report carries").toEqual([{ readAt }]);
  },
);

scenario(
  "push-arrivals",
  "A push with a balance reports its arrival on a phone that keeps no balance",
  async () => {
    startTestClock();
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
    );

    expect(reportsReceived(), "reports of the push's arrival").toEqual([
      REPORT,
    ]);
  },
);

scenario(
  "push-arrivals",
  "A push without a balance reports nothing",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(message("Ahoj"));

    expect(reportsReceived(), "reports of the push's arrival").toEqual([]);
  },
);

scenario(
  "push-arrivals",
  "A push with a balance of the wrong shape reports nothing",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(pushWithBalance({ amount: 250 }));

    expect(reportsReceived(), "reports of the push's arrival").toEqual([]);
  },
);

scenario(
  "push-arrivals",
  "A failed report still keeps the push's balance",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    answerWith({ arrivals: serverError });
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    // Fails the test if the push's work fails (the stand-in waits for it).
    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
    );

    await openTheAppOffline();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-arrivals",
  "A failed report still shows the notification",
  async () => {
    startTestClock();
    goOffline();
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    // Fails the test if the push's work fails (the stand-in waits for it).
    await serviceWorker.deliverPush(
      pushWithBalance(
        { amount: 282.6, readAt: ago(MINUTE) },
        {
          title: "Odešlo 3,80 €",
          body: "Zůstatek 282,60 € (≈ 6 867 Kč)",
        },
      ),
    );

    expect(
      serviceWorker
        .shownNotifications()
        .map(({ title, body }) => ({ title, body })),
    ).toEqual([
      { title: "Odešlo 3,80 €", body: "Zůstatek 282,60 € (≈ 6 867 Kč)" },
    ]);
  },
);

scenario(
  "push-arrivals",
  "The notification is shown without waiting for the report",
  async () => {
    startTestClock();
    // The server is waking up: it answers the report only 20 s later.
    answerWith({ arrivals: after(20 * SECOND, recorded) });
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    // Not awaited: the stand-in resolves only once the event's work, the report among it, is done.
    const delivery = serviceWorker.deliverPush(
      pushWithBalance(
        { amount: 282.6, readAt: ago(MINUTE) },
        { title: "Odešlo 3,80 €" },
      ),
    );
    await timePasses(0);

    expect(
      timeline(),
      "the server has not answered the report yet",
    ).not.toContain(`answer ${REPORT}`);
    expect(
      serviceWorker.shownNotifications().map(({ title }) => title),
    ).toEqual(["Odešlo 3,80 €"]);

    // The server wakes and answers: the push's work ends.
    await timePasses(20 * SECOND);
    await delivery;
  },
);
