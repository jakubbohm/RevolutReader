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
  goOffline,
  kept,
  KORUNA_RATE,
  phoneKeeps,
  phoneStorageFails,
  signedIn,
} from "../test/server";
import { installServiceWorkerStandIn, ORIGIN } from "../test/serviceWorker";

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const OFFLINE = "Jsi offline";
const OFFLINE_NOTHING_STORED =
  "Zůstatek a pohyby se načtou, jakmile budeš online.";

/** A push as the server sends it (c011 design.md D2): Declarative Web Push, opening `page` on the app's own address. */
function message(
  title: string,
  options: { body?: string; page?: string } = {},
): unknown {
  return {
    web_push: 8030,
    notification: {
      title,
      ...(options.body === undefined ? {} : { body: options.body }),
      navigate: `${ORIGIN}${options.page ?? "/"}`,
    },
  };
}

/** A balance a push carries: `amount` EUR read at `readAt`; without `readAt`, a balance with no read time (the wrong shape). */
interface PushedBalance {
  amount: number;
  readAt?: Date;
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
  "push-display",
  "A push shows as a notification where the browser does not show it itself",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      message("Ahoj", { body: "Zkušební zpráva", page: "/" }),
    );

    expect(
      serviceWorker
        .shownNotifications()
        .map(({ title, body }) => ({ title, body })),
    ).toEqual([{ title: "Ahoj", body: "Zkušební zpráva" }]);
  },
);

scenario(
  "push-display",
  "A push the browser shows itself shows once",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(message("Ahoj"));

    expect(serviceWorker.shownNotifications()).toEqual([]);
  },
);

scenario(
  "push-display",
  "A tap on a notification opens the app at its page",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(message("Ahoj", { page: "/" }));
    expect(serviceWorker.shownNotifications()).toHaveLength(1);

    await serviceWorker.tapNotification();

    expect(serviceWorker.openedWindows()).toEqual([`${ORIGIN}/`]);
  },
);

scenario(
  "push-display",
  "A tap on a notification brings the open app to the front",
  async () => {
    const serviceWorker = installServiceWorkerStandIn({
      openWindows: [`${ORIGIN}/`],
    });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(message("Ahoj"));
    expect(serviceWorker.shownNotifications()).toHaveLength(1);

    await serviceWorker.tapNotification();

    expect(serviceWorker.focusedWindows()).toEqual([`${ORIGIN}/`]);
    expect(serviceWorker.openedWindows()).toEqual([]);
  },
);

// ---- c015: the balance a push brings (design.md D8) ----
// The scenarios that write run where the browser reads Declarative Web Push (the iPhone), where the balance comes from
// the notification it proposes; the storage failure and the tap run where the service worker shows the notification.
// Each push is delivered in full, its `waitUntil` work done, before the app opens.

scenario(
  "push-display",
  "A push with a balance replaces the balance the phone keeps",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
    );

    await openTheAppOffline();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A push with a balance read earlier than the kept one leaves it as it was",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(MINUTE)));
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 250, readAt: ago(10 * MINUTE) }),
    );

    await openTheAppOffline();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A push with a balance stores none on a phone that keeps none",
  async () => {
    startTestClock();
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
    );

    await openTheAppOffline();
    expect(screen.getByText(OFFLINE_NOTHING_STORED)).toBeInTheDocument();
    // Only these two under the top bar: a balance stored by the push would show there too.
    expect(textOf(screen.getByRole("main"))).toBe(
      textOf(OFFLINE, OFFLINE_NOTHING_STORED),
    );
  },
);

scenario(
  "push-display",
  "A push without a balance leaves the kept balance as it was",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    // As the owner's messages: no "mutable", no data (c015 design.md D1).
    await serviceWorker.deliverPush(message("Ahoj"));

    await openTheAppOffline();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A push with a balance of the wrong shape leaves the kept balance as it was",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    const serviceWorker = installServiceWorkerStandIn({ declarative: true });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(pushWithBalance({ amount: 250 }));

    await openTheAppOffline();
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A push still shows its notification when the phone's storage fails",
  async () => {
    startTestClock();
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);
    const restoreStorage = phoneStorageFails();

    try {
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
    } finally {
      restoreStorage();
    }

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
  "push-display",
  "The app opened from a push's notification shows its balance while the server wakes",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    const serviceWorker = installServiceWorkerStandIn({ openWindows: [] });
    listenForPushes(serviceWorker.worker);
    await serviceWorker.deliverPush(
      pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
    );
    expect(serviceWorker.shownNotifications()).toHaveLength(1);

    await serviceWorker.tapNotification();
    expect(serviceWorker.openedWindows()).toEqual([`${ORIGIN}/`]);
    renderApp("iPhone Home Screen", {
      whoIsSignedIn: after(20 * SECOND, LUCIE),
    });

    // At once: no time passes, the app only reads what the phone keeps.
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.getByText("Aktualizováno před 1 min")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

/** Text as one reads it, with no regard to how it is spaced or split into elements. */
function textOf(...parts: (HTMLElement | string)[]): string {
  return parts
    .map((part) => (typeof part === "string" ? part : (part.textContent ?? "")))
    .join("")
    .replace(/\s+/g, "");
}
