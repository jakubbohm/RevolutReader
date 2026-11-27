import { screen } from "@testing-library/react";
import { expect } from "vitest";
import { listenForPushes } from "../app/pushDisplay";
import { warningBanner } from "../test/banners";
import {
  ago,
  HOUR,
  MINUTE,
  SECOND,
  startTestClock,
  timePasses,
} from "../test/clock";
import {
  balanceAddress,
  PHONE_SECRET,
  wrongCode,
} from "../test/notificationBalance";
import {
  installPushStandIns,
  type PushStandIns,
  type ShownNotification,
} from "../test/push";
import { renderApp, type RenderedApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  balance,
  goOffline,
  kept,
  KORUNA_RATE,
  leaveApp,
  phoneKeeps,
  phoneStorageFails,
  returnToApp,
  signedIn,
  tapNotificationInTheBackground,
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
const SOME_PAYMENT_TEXT = "Zůstatek 1,00 € (≈ 24 Kč)";

/** The balance's JSON as `GET /api/balance` answers it (`amount`, `readAt` as the API writes a time, `czkPerEur` at C13's rate); without `readAt`, none. */
function asTheApiAnswers(pushed: PushedBalance): unknown {
  return pushed.readAt === undefined
    ? { amount: pushed.amount, czkPerEur: KORUNA_RATE }
    : kept(pushed.amount, pushed.readAt);
}

/**
 * A push as the account check sends it since c019 (design.md D1, D2): a plain Declarative Web Push, no `mutable`, no
 * `data`, opening the start page of the service worker's origin with the balance in its fragment, its check code made
 * for this phone (`PHONE_SECRET`, the service worker stand-in's subscription). The title is `SOME_PAYMENT` unless
 * `title` names one; no text unless `body` gives it.
 */
async function pushWithBalance(
  pushed: PushedBalance,
  options: { title?: string; body?: string } = {},
): Promise<unknown> {
  return {
    web_push: 8030,
    notification: {
      title: options.title ?? SOME_PAYMENT,
      ...(options.body === undefined ? {} : { body: options.body }),
      navigate: await balanceAddress(asTheApiAnswers(pushed), PHONE_SECRET, {
        origin: ORIGIN,
      }),
    },
  };
}

/**
 * A notification of the account check's, as the phone shows it and lists it (c019 design.md D5): its title and text,
 * and the address a tap opens, the app's start page with `amount` EUR read at `readAt` in its fragment, its check code
 * made for this phone.
 */
async function notificationWithBalance(
  amount: number,
  readAt: Date,
): Promise<ShownNotification> {
  return {
    title: SOME_PAYMENT,
    body: SOME_PAYMENT_TEXT,
    navigate: await balanceAddress(kept(amount, readAt), PHONE_SECRET),
  };
}

/**
 * The phone's Home Screen app with notifications on: allowed, subscribed with this phone's secret (`PHONE_SECRET`),
 * and showing `notifications` (by default none: the tapped one is never listed, c019 design.md D5).
 */
function phoneWithNotifications(
  notifications: readonly ShownNotification[] = [],
): PushStandIns {
  return installPushStandIns({
    permission: "granted",
    subscription: { auth: PHONE_SECRET },
    notifications,
  });
}

/**
 * The next opening of the app, offline, from its icon: whatever notifications are still shown are cleared first, so
 * only the balance the phone keeps can show. On the test clock, the app has read the phone's storage when this returns.
 * Returns that opening.
 */
async function nextOpeningOffline(
  app: RenderedApp,
  phone: PushStandIns,
): Promise<RenderedApp> {
  phone.dismissNotifications();
  goOffline();
  const opening = app.reopen();
  await timePasses(0);
  expect(
    screen.getByText(OFFLINE),
    "the app opened offline",
  ).toBeInTheDocument();
  return opening;
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

// ---- c019: the balance a notification brings (design.md D5, D6, D12) ----
// On the iPhone no service worker runs for the account's notifications any more (design.md D1): the balance is in the
// notification's address, and the page takes it in from there (a tap opens the app at that address, or, in the
// background, goes to its fragment) and from the notifications the phone still shows (`getNotifications()`). Each
// scenario's phone is subscribed with `PHONE_SECRET`, the secret its notifications' check codes are made for. "The next
// time the app is opened offline" is an opening from the icon with every notification cleared first, so only what the
// phone keeps can show. The first opening is given a second, so whatever it takes in is kept before the app closes.

scenario(
  "push-display",
  "A tap on a notification with a balance replaces the balance the phone keeps",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    goOffline();
    // The app is closed: nothing of it runs until the tap opens it.
    const phone = phoneWithNotifications();

    const app = renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: LUCIE },
      { address: await balanceAddress(kept(286.4, ago(MINUTE)), PHONE_SECRET) },
    );
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A tap on a notification while the app is in the background replaces the balance the phone keeps",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    goOffline();
    const phone = phoneWithNotifications();
    const app = renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
    await timePasses(SECOND);
    expect(screen.getByText("250,00 €"), "the app opened").toBeInTheDocument();
    leaveApp();
    await timePasses(MINUTE);

    tapNotificationInTheBackground(
      await balanceAddress(kept(286.4, ago(MINUTE)), PHONE_SECRET),
    );
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "Opening the app from its icon takes the balance of a notification still shown",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    goOffline();
    const phone = phoneWithNotifications([
      await notificationWithBalance(286.4, ago(MINUTE)),
    ]);

    const app = renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "Coming back to the app takes the balance of a notification still shown",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    goOffline();
    const phone = phoneWithNotifications();
    const app = renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
    await timePasses(SECOND);
    expect(screen.getByText("250,00 €"), "the app opened").toBeInTheDocument();
    leaveApp();
    await timePasses(MINUTE);
    phone.notificationArrives(
      await notificationWithBalance(286.4, ago(MINUTE)),
    );

    returnToApp();
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "Of several notifications, the balance read last is kept",
  async () => {
    startTestClock();
    const readLast = await notificationWithBalance(286.4, ago(MINUTE));
    const readEarlier = await notificationWithBalance(280, ago(10 * MINUTE));
    // Two phones in turn, the same two notifications listed in either order, so neither taking the first one listed nor
    // the last one listed passes (design.md § Ports and contracts: the list's order is not relied on).
    const lists = {
      "read last listed first": [readLast, readEarlier],
      "read last listed last": [readEarlier, readLast],
    };

    for (const [order, notifications] of Object.entries(lists)) {
      await phoneKeeps(kept(250, ago(2 * HOUR)));
      goOffline();
      const phone = phoneWithNotifications(notifications);

      const app = renderApp("iPhone Home Screen", { whoIsSignedIn: LUCIE });
      await timePasses(SECOND);

      const opening = await nextOpeningOffline(app, phone);
      expect(screen.getByText("286,40 €"), order).toBeInTheDocument();
      expect(screen.queryByText("280,00 €"), order).not.toBeInTheDocument();
      expect(screen.queryByText("250,00 €"), order).not.toBeInTheDocument();
      // This phone's app closes before the next phone's opens.
      opening.unmount();
    }
  },
);

scenario(
  "push-display",
  "A push with a balance replaces the balance the phone keeps",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    // A browser that fires the push event for every push and does not show the message itself (a computer's Chrome,
    // design.md D7); its subscription's secret is `PHONE_SECRET`.
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(
      await pushWithBalance({ amount: 286.4, readAt: ago(MINUTE) }),
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
    goOffline();
    const phone = phoneWithNotifications();

    const app = renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: LUCIE },
      {
        address: await balanceAddress(
          kept(250, ago(10 * MINUTE)),
          PHONE_SECRET,
        ),
      },
    );
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("250,00 €")).not.toBeInTheDocument();
  },
);

scenario(
  "push-display",
  "A push with a balance stores none on a phone that keeps none",
  async () => {
    startTestClock();
    goOffline();
    const phone = phoneWithNotifications();

    const app = renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: LUCIE },
      { address: await balanceAddress(kept(286.4, ago(MINUTE)), PHONE_SECRET) },
    );
    await timePasses(SECOND);

    await nextOpeningOffline(app, phone);
    expect(screen.getByText(OFFLINE_NOTHING_STORED)).toBeInTheDocument();
    // Only these two under the top bar: a balance stored by the notification would show there too.
    expect(textOf(screen.getByRole("main"))).toBe(
      textOf(OFFLINE, OFFLINE_NOTHING_STORED),
    );
  },
);

scenario(
  "push-display",
  "The app's address carries no balance once the app has read it",
  async () => {
    startTestClock();
    await phoneKeeps(kept(250, ago(2 * HOUR)));
    phoneWithNotifications();

    const app = renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: LUCIE, balance: balance(286.4) },
      { address: await balanceAddress(kept(286.4, ago(MINUTE)), PHONE_SECRET) },
    );
    await timePasses(SECOND);

    expect(app.address()).toBe("/");
  },
);

scenario(
  "push-display",
  "A balance without this phone's check code leaves the kept balance as it was",
  async () => {
    startTestClock();
    await phoneKeeps(kept(286.4, ago(2 * HOUR)));
    goOffline();
    phoneWithNotifications();

    // A link whose address carries a balance with a code made under another secret than this phone's.
    renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: LUCIE },
      { address: await wrongCode(kept(0, ago(MINUTE)), PHONE_SECRET) },
    );
    await timePasses(SECOND);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(screen.queryByText("0,00 €")).not.toBeInTheDocument();
    expect(warningBanner(OFFLINE)).toBeInTheDocument();
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
    // Where the service worker keeps a push's balance (design.md D7): the code is this phone's, the payload has no readAt.
    const serviceWorker = installServiceWorkerStandIn({ declarative: false });
    listenForPushes(serviceWorker.worker);

    await serviceWorker.deliverPush(await pushWithBalance({ amount: 250 }));

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
        await pushWithBalance(
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
    phoneWithNotifications();
    const notification = await notificationWithBalance(286.4, ago(MINUTE));

    // The tap opens the app at the notification's address (design.md D5), on a server that wakes.
    renderApp(
      "iPhone Home Screen",
      { whoIsSignedIn: after(20 * SECOND, LUCIE) },
      { address: notification.navigate },
    );

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
