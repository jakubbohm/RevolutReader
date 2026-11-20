import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";
import { errorBanner } from "../test/banners";
import {
  MINUTE,
  SECOND,
  startTestClock,
  timePasses,
  userOnTheTestClock,
} from "../test/clock";
import { installPushStandIns, type PushStandIns } from "../test/push";
import { renderApp, type RenderedApp } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  answerWith,
  balance,
  bodiesSent,
  leaveApp,
  nobodySignedIn,
  pushKey,
  returnToApp,
  serverError,
  signedIn,
  signedOut,
  type ServerAnswers,
} from "../test/server";

// The device's side of its push registration (c013 design.md D1–D7): at every opening the phone's subscription is sent
// to the server again, made again or replaced; a sign-out asks the server to forget it and unsubscribes it once
// confirmed; a login that has ended unsubscribes it. The phone's push is the test kit's stand-ins (src/test/push.ts),
// the server the fake one (src/test/server.ts). Every key and push address here is made up.

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");
const SIGN_IN_BUTTON = "Přihlásit se účtem Microsoft";
const SIGNED_OUT_NOTE = "Odhlášení proběhlo. Pro návrat se znovu přihlas.";

/** The push address of Lucie's phone at Apple's push service. */
const LUCIES_PHONE = "https://web.push.apple.com/lucies-phone";
/** The push address of a subscription her phone made with an old key. */
const LUCIES_OLD_SUBSCRIPTION =
  "https://web.push.apple.com/lucies-old-subscription";

/**
 * The server's push key: 65 bytes starting 0x04 (a public key's form), then 3i + 1. It differs from the fake server's
 * `DEFAULT_PUSH_KEY`, so a key that never came from the server cannot pass.
 */
const SERVER_KEY =
  "BAQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW15hZGdqbXBzdnl8f4KFiIuOkZSXmp2go6aprK-ytbi7vsE";
/** An old key of the same form: 0x04, then 250 − 2i. */
const OLD_KEY =
  "BPj29PLw7uzq6Obk4uDe3NrY1tTS0M7MysjGxMLAvry6uLa0srCurKqopqSioJ6cmpiWlJKQjoyKiIaEgoB-fHo";

/** The server while Lucie is signed in: her balance, and its push key. */
const LUCIES_SERVER: ServerAnswers = {
  whoIsSignedIn: LUCIE,
  balance: balance(286.4),
  pushKey: pushKey(SERVER_KEY),
};

scenario(
  "push-devices",
  "The subscription is sent to the server again when the app opens",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    const held = phone.subscription()!;

    renderApp("iPhone Home Screen", LUCIES_SERVER);
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(subscriptionsSent(), "the subscription sent to the server").toEqual([
      held.toJSON(),
    ]);
    expect(phone.subscription(), "the phone keeps it").toBe(held);
    expect(phone.subscribeRequests(), "no subscribing again").toEqual([]);
    expect(phone.permissionRequests(), "nothing asked").toBe(0);
  },
);

scenario(
  "push-devices",
  "The subscription is sent to the server again on every return to the app",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    const held = phone.subscription()!;
    renderApp("iPhone Home Screen", LUCIES_SERVER);
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    const sentAtOpening = subscriptionsSent().length;

    leaveApp();
    await timePasses(MINUTE);
    returnToApp();
    await timePasses(0);

    expect(
      subscriptionsSent().slice(sentAtOpening),
      "sent again on the first return",
    ).toEqual([held.toJSON()]);

    leaveApp();
    await timePasses(MINUTE);
    returnToApp();
    await timePasses(0);

    expect(
      subscriptionsSent().slice(sentAtOpening),
      "sent again on the second return too",
    ).toEqual([held.toJSON(), held.toJSON()]);
  },
);

scenario(
  "push-devices",
  "A subscription the phone has lost is replaced quietly",
  async () => {
    startTestClock();
    const phone = installPushStandIns({ permission: "granted" });

    renderApp("iPhone Home Screen", LUCIES_SERVER);
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(
      keysSubscribedWith(phone),
      "the phone subscribes with the server's key",
    ).toEqual([SERVER_KEY]);
    expect(phone.permissionRequests(), "without asking her").toBe(0);
    const made = phone.subscription();
    expect(made, "the phone holds the new subscription").not.toBeNull();
    expect(
      subscriptionsSent(),
      "the new subscription sent to the server",
    ).toEqual([made?.toJSON()]);
  },
);

scenario(
  "push-devices",
  "A subscription made with another key is replaced quietly",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_OLD_SUBSCRIPTION, OLD_KEY);
    const old = phone.subscription();

    const app = renderApp("iPhone Home Screen", LUCIES_SERVER);
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(
      addressesForgotten(),
      "the server is asked to forget the old push address",
    ).toEqual([LUCIES_OLD_SUBSCRIPTION]);
    const made = phone.subscription();
    expect(made, "the phone holds a subscription").not.toBeNull();
    expect(made, "the phone unsubscribed the old one").not.toBe(old);
    expect(made?.endpoint).not.toBe(LUCIES_OLD_SUBSCRIPTION);
    expect(
      keysSubscribedWith(phone),
      "the phone subscribes with the server's key",
    ).toEqual([SERVER_KEY]);
    expect(phone.permissionRequests(), "without asking her").toBe(0);
    expect(
      subscriptionsSent(),
      "only the new subscription sent to the server",
    ).toEqual([made?.toJSON()]);
    const requests = app.requests();
    expect(
      requests.indexOf("DELETE /api/push/subscription"),
      "the old address forgotten before the new subscription is sent",
    ).toBeLessThan(requests.indexOf("PUT /api/push/subscription"));
  },
);

scenario(
  "push-devices",
  "Nothing is subscribed while notifications are not allowed",
  async () => {
    startTestClock();
    const phone = installPushStandIns({ permission: "default" });

    renderApp("iPhone Home Screen", LUCIES_SERVER);
    await timePasses(0);

    expect(
      screen.getByText("286,40 €"),
      "Lucie is signed in, on the account screen",
    ).toBeInTheDocument();
    expect(
      phone.permissionRequests(),
      "the app does not ask to allow notifications",
    ).toBe(0);
    expect(phone.permission()).toBe("default");
    expect(phone.subscribeRequests(), "nothing is subscribed").toEqual([]);
    expect(phone.subscription()).toBeNull();
    expect(
      subscriptionsSent(),
      "no subscription is sent to the server",
    ).toEqual([]);
  },
);

scenario(
  "push-devices",
  "Signing out asks the server to forget the phone and unsubscribes it",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    const held = phone.subscription();
    const app = renderApp("iPhone Home Screen", {
      ...LUCIES_SERVER,
      signOut: after(5 * SECOND, signedOut),
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await signOutFromTheMenu(user);
    await timePasses(0);

    expect(
      addressesForgotten(),
      "the server is asked to forget the phone's push address",
    ).toEqual([LUCIES_PHONE]);
    const requests = app.requests();
    expect(
      requests.indexOf("DELETE /api/push/subscription"),
      "asked before the app signs out",
    ).toBeLessThan(requests.indexOf("POST /api/auth/logout"));
    expect(phone.subscription(), "kept until the sign-out is confirmed").toBe(
      held,
    );

    await timePasses(5 * SECOND);

    expect(screen.getByText(SIGNED_OUT_NOTE)).toBeInTheDocument();
    expect(
      phone.subscription(),
      "once the sign-out is confirmed, the phone holds no subscription",
    ).toBeNull();
  },
);

scenario(
  "push-devices",
  "A failed request to forget the phone does not fail the sign-out",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    renderApp("iPhone Home Screen", {
      ...LUCIES_SERVER,
      forgetSubscription: serverError,
    });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await signOutFromTheMenu(user);
    await timePasses(0);

    expect(screen.getByText(SIGNED_OUT_NOTE)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();
    expect(phone.subscription(), "the phone holds no subscription").toBeNull();
    expect(
      addressesForgotten(),
      "the request to forget it, which the server failed",
    ).toEqual([LUCIES_PHONE]);
  },
);

scenario(
  "push-devices",
  "A failed sign-out keeps the subscription",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    const held = phone.subscription();
    renderApp("iPhone Home Screen", { ...LUCIES_SERVER, signOut: serverError });
    const user = userOnTheTestClock();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    await signOutFromTheMenu(user);
    await timePasses(0);

    expect(errorBanner("Odhlášení se nepovedlo")).toBeInTheDocument();
    expect(phone.subscription(), "the phone still holds its subscription").toBe(
      held,
    );
  },
);

scenario(
  "push-devices",
  "A login that has ended unsubscribes the phone",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);

    renderApp("iPhone Home Screen", { whoIsSignedIn: nobodySignedIn });
    await timePasses(0);

    expect(
      screen.getByRole("button", { name: SIGN_IN_BUTTON }),
    ).toBeInTheDocument();
    expect(phone.subscription(), "the phone holds no subscription").toBeNull();
  },
);

scenario(
  "push-devices",
  "After signing in again, the phone subscribes without a tap",
  async () => {
    startTestClock();
    const phone = phoneSubscribed(LUCIES_PHONE, SERVER_KEY);
    const app = renderApp("iPhone Home Screen", LUCIES_SERVER);
    const user = userOnTheTestClock();
    await timePasses(0);
    await signOutFromTheMenu(user);
    await timePasses(0);
    expect(screen.getByText(SIGNED_OUT_NOTE)).toBeInTheDocument();
    const subscribedBefore = phone.subscribeRequests().length;
    const sentBefore = subscriptionsSent().length;

    signsInAgain(app, LUCIES_SERVER);
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expect(
      keysSubscribedWith(phone).slice(subscribedBefore),
      "the phone subscribes with the server's key",
    ).toEqual([SERVER_KEY]);
    expect(phone.permissionRequests(), "without asking her").toBe(0);
    const made = phone.subscription();
    expect(made, "the phone holds the new subscription").not.toBeNull();
    expect(made?.endpoint, "a new subscription").not.toBe(LUCIES_PHONE);
    expect(
      subscriptionsSent().slice(sentBefore),
      "the new subscription sent to the server",
    ).toEqual([made?.toJSON()]);
  },
);

/** Lucie allowed notifications on her phone, and it holds a subscription at `endpoint`, made with `key`. */
function phoneSubscribed(endpoint: string, key: string): PushStandIns {
  return installPushStandIns({
    permission: "granted",
    subscription: { endpoint, applicationServerKey: key },
  });
}

/** Lucie signs out from the account menu: she opens it and taps "Odhlásit se". */
async function signOutFromTheMenu(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Účet a odhlášení" }));
  await user.click(screen.getByRole("menuitem", { name: "Odhlásit se" }));
}

/**
 * Lucie signs in again: the server knows her login again (`answerWith` clears the ended one), and the app opens on the
 * way back from Microsoft's pages, which is a launch (c013 design.md D5). The phone keeps its permission.
 */
function signsInAgain(app: RenderedApp, server: ServerAnswers): RenderedApp {
  answerWith(server);
  return app.reopen();
}

/** The subscriptions the app sent to the server, in order, each as it sent it. */
function subscriptionsSent(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === "PUT /api/push/subscription")
    .map((sent) => sent.body);
}

/** The push addresses the app asked the server to forget, in order. */
function addressesForgotten(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === "DELETE /api/push/subscription")
    .map((sent) =>
      typeof sent.body === "object" && sent.body !== null
        ? (sent.body as { endpoint?: unknown }).endpoint
        : sent.body,
    );
}

/** The keys the phone was asked to subscribe with, in order, as base64url text, whether the app gave bytes or text. */
function keysSubscribedWith(
  phone: PushStandIns,
): (string | null | undefined)[] {
  return phone
    .subscribeRequests()
    .map(({ applicationServerKey: key }) =>
      key instanceof Uint8Array ? base64url(key) : key,
    );
}

/** Bytes as base64url text without padding: the test's own, independent of the app's. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
