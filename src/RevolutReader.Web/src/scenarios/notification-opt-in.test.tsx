import { screen, within } from "@testing-library/react";
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
import { installPushStandIns, type PushStandInOptions } from "../test/push";
import { renderApp, type Opened } from "../test/renderApp";
import { scenario } from "../test/scenario";
import {
  after,
  balance,
  bodiesSent,
  goOffline,
  leaveApp,
  phoneRemembersNotNow,
  pushKey,
  returnToApp,
  serverError,
  signedIn,
  stored,
  type ServerAnswers,
} from "../test/server";
import { watchPermissionQuestions } from "../test/taps";

const LUCIE = signedIn("Lucie Nováková", "lucie@example.com");

const OFFER_TITLE = "Chceš vědět o každé platbě?";
const OFFER_SENTENCE =
  "Hned uvidíš, když přijdou peníze nebo když zaplatíš kartou.";
const TURN_ON = "Zapnout upozornění";
const NOT_NOW = "Teď ne";
const ENABLED_TITLE = "Upozornění jsou zapnutá";
const ENABLED_SENTENCE = "Když se na účtu něco změní, přijde ti upozornění.";
const DENIED_TITLE = "Upozornění jsou vypnutá";
const DENIED_SENTENCE = "Zapneš je v Nastavení → Oznámení → Tarjeta Papá.";
const FAILED_TITLE = "Upozornění se nepodařilo zapnout";
const ACCOUNT_MENU = "Účet a odhlášení";
const SIGN_OUT = "Odhlásit se";

const SEND_SUBSCRIPTION = "PUT /api/push/subscription";
const PUSH_KEY = "GET /api/push/key";

/**
 * The server's push key in these scenarios (made up: 65 bytes starting `0x04`, the others `0x11`), different from the
 * fake server's default, so a subscription made with any other key shows.
 */
const SERVER_KEY =
  "BBERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERERE";

/**
 * Lucie, signed in, opens the app where it is opened, with the phone's push as `push` says; the server answers her
 * balance of 286,40 € and the push key `SERVER_KEY`, and whatever `answers` adds. Ends with the account screen showing
 * her balance.
 */
async function lucieOpensTheApp(
  options: {
    opened?: Opened;
    push?: PushStandInOptions;
    answers?: ServerAnswers;
  } = {},
) {
  startTestClock();
  const phone = installPushStandIns(options.push);
  const app = renderApp(options.opened ?? "iPhone Home Screen", {
    whoIsSignedIn: LUCIE,
    balance: balance(286.4),
    pushKey: pushKey(SERVER_KEY),
    ...options.answers,
  });
  const user = userOnTheTestClock();
  await timePasses(0);
  expect(screen.getByText("286,40 €")).toBeInTheDocument();
  return { phone, app, user };
}

scenario(
  "notification-opt-in",
  "The card offers notifications under the balance",
  async () => {
    const { user } = await lucieOpensTheApp({
      opened: "iPhone Home Screen",
      push: { permission: "default" },
    });

    const title = screen.getByText(OFFER_TITLE);
    expect(screen.getByText(OFFER_SENTENCE)).toBeInTheDocument();
    expect(
      isAfter(screen.getByText("286,40 €"), title),
      "the card stands under the balance",
    ).toBe(true);
    expect(
      isAfter(title, screen.getByText("Papírnictví Tužka")),
      "the card stands above the transactions",
    ).toBe(true);
    expect(screen.getByRole("button", { name: TURN_ON })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: NOT_NOW })).toBeInTheDocument();

    const menu = await openAccountMenu(user);
    expect(
      within(menu).queryByRole("menuitem", { name: TURN_ON }),
    ).not.toBeInTheDocument();
  },
);

scenario(
  "notification-opt-in",
  "The card also shows in a computer's browser",
  async () => {
    await lucieOpensTheApp({
      opened: "computer browser",
      push: { permission: "default" },
    });

    const title = screen.getByText(OFFER_TITLE);
    expect(
      isAfter(screen.getByText("286,40 €"), title),
      "the card stands under the balance",
    ).toBe(true);
  },
);

scenario(
  "notification-opt-in",
  "Nothing offers notifications where the browser cannot have them",
  async () => {
    // A browser with notifications and a service worker, but no push: it cannot subscribe.
    const { user } = await lucieOpensTheApp({
      opened: "computer browser",
      push: { permission: "default", without: ["PushManager"] },
    });

    expectNoCard();
    expect(
      screen.queryByRole("button", { name: TURN_ON }),
    ).not.toBeInTheDocument();
    const menu = await openAccountMenu(user);
    expect(
      within(menu).queryByRole("menuitem", { name: TURN_ON }),
    ).not.toBeInTheDocument();
  },
);

scenario(
  "notification-opt-in",
  "Nothing offers notifications once they are on",
  async () => {
    const { app, user } = await lucieOpensTheApp();
    // Lucie turns notifications on, on this phone, from the card.
    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);
    expect(screen.getByText(ENABLED_TITLE)).toBeInTheDocument();

    app.reopen();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();

    expectNoCard();
    const menu = await openAccountMenu(user);
    expect(
      within(menu).queryByRole("menuitem", { name: TURN_ON }),
    ).not.toBeInTheDocument();
  },
);

scenario(
  "notification-opt-in",
  "Turning notifications on from the card asks the phone and says they are on",
  async () => {
    const { phone, user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "granted" },
      // The server takes 2 seconds to keep the subscription, so the card is seen while it waits.
      answers: { subscription: after(2 * SECOND, stored) },
    });
    const questions = watchPermissionQuestions();

    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);

    expect(questions.askedInTap(), "the phone was asked from her tap").toEqual([
      true,
    ]);
    expect(phone.permission()).toBe("granted");
    expect(
      screen.getByRole("button", { name: TURN_ON }),
      "the button spins while turning on",
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: NOT_NOW })).toBeDisabled();

    await timePasses(2 * SECOND);

    const subscription = phone.subscription();
    expect(subscription, "the phone holds a subscription").not.toBeNull();
    expect(
      keyBytesOf(subscription!),
      "the subscription was made with the server's push key",
    ).toEqual(fromBase64Url(SERVER_KEY));
    expect(subscriptionsSent()).toEqual([subscription!.toJSON()]);
    expect(screen.getByText(ENABLED_TITLE)).toBeInTheDocument();
    expect(screen.getByText(ENABLED_SENTENCE)).toBeInTheDocument();
    expect(screen.queryByText(OFFER_TITLE)).not.toBeInTheDocument();
  },
);

scenario(
  "notification-opt-in",
  '"Upozornění jsou zapnutá" is gone at the next opening',
  async () => {
    const { user } = await lucieOpensTheApp();
    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);
    expect(screen.getByText(ENABLED_TITLE)).toBeInTheDocument();

    leaveApp();
    await timePasses(MINUTE);
    returnToApp();
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expectNoCard();
  },
);

scenario(
  "notification-opt-in",
  "Declining the phone's question says where to turn notifications on",
  async () => {
    const { app, phone, user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "denied" },
    });

    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);

    expect(phone.permissionRequests()).toBe(1);
    const card = cardTitled(DENIED_TITLE);
    expect(within(card).getByText(DENIED_SENTENCE)).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: TURN_ON }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: NOT_NOW }),
    ).not.toBeInTheDocument();
    expect(app.timesSent(PUSH_KEY), "no push key read").toBe(0);
    expect(app.timesSent(SEND_SUBSCRIPTION), "no subscription sent").toBe(0);
    expect(phone.subscription()).toBeNull();
  },
);

scenario(
  "notification-opt-in",
  "The card saying notifications are off is gone at the next opening",
  async () => {
    const { app, user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "denied" },
    });
    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);
    expect(screen.getByText(DENIED_TITLE)).toBeInTheDocument();

    app.reopen();
    await timePasses(0);

    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expectNoCard();
  },
);

scenario(
  "notification-opt-in",
  '"Teď ne" hides the card for good on this device',
  async () => {
    const { app, phone, user } = await lucieOpensTheApp();

    await user.click(screen.getByRole("button", { name: NOT_NOW }));
    await timePasses(0);

    expectNoCard();
    expect(phone.permissionRequests(), "the phone was not asked").toBe(0);

    app.reopen();
    await timePasses(0);
    expect(screen.getByText("286,40 €")).toBeInTheDocument();
    expectNoCard();
  },
);

scenario(
  "notification-opt-in",
  'The account menu offers notifications after "Teď ne"',
  async () => {
    phoneRemembersNotNow();
    const { user } = await lucieOpensTheApp();

    const menu = await openAccountMenu(user);

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent?.trim()),
    ).toEqual([TURN_ON, SIGN_OUT]);
  },
);

scenario(
  "notification-opt-in",
  "Turning notifications on from the account menu shows the result in the card",
  async () => {
    phoneRemembersNotNow();
    const { phone, user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "granted" },
    });
    const questions = watchPermissionQuestions();
    expectNoCard();

    const menu = await openAccountMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: TURN_ON }));
    await timePasses(0);

    expect(questions.askedInTap(), "the phone was asked from her tap").toEqual([
      true,
    ]);
    const subscription = phone.subscription();
    expect(subscription, "the phone holds a subscription").not.toBeNull();
    expect(subscriptionsSent()).toEqual([subscription!.toJSON()]);
    expect(screen.getByText(ENABLED_TITLE)).toBeInTheDocument();
  },
);

scenario(
  "notification-opt-in",
  "The account menu, with notifications blocked, says where to turn them on",
  async () => {
    const { phone, user } = await lucieOpensTheApp({
      push: { permission: "denied" },
    });
    expectNoCard();

    const menu = await openAccountMenu(user);
    await user.click(within(menu).getByRole("menuitem", { name: TURN_ON }));
    await timePasses(0);

    const card = cardTitled(DENIED_TITLE);
    expect(within(card).getByText(DENIED_SENTENCE)).toBeInTheDocument();
    expect(phone.permissionRequests(), "the phone was not asked").toBe(0);
  },
);

scenario(
  "notification-opt-in",
  "Turning notifications on offline says to try again online",
  async () => {
    const { user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "granted" },
    });
    expect(screen.getByText(OFFER_TITLE)).toBeInTheDocument();
    goOffline();
    await timePasses(0);

    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);

    const error = errorBanner(FAILED_TITLE);
    expect(
      within(error).getByText("Zkus to znovu, až budeš online."),
    ).toBeInTheDocument();
    // The screen's one banner, in place of the offline one.
    expect(screen.queryByText("Jsi offline")).not.toBeInTheDocument();
    expectTheCardOffersAgain();
  },
);

scenario(
  "notification-opt-in",
  "Turning notifications on when the server fails says to try again later",
  async () => {
    const { user } = await lucieOpensTheApp({
      push: { permission: "default", permissionAnswer: "granted" },
      answers: { subscription: serverError },
    });

    await user.click(screen.getByRole("button", { name: TURN_ON }));
    await timePasses(0);

    const error = errorBanner(FAILED_TITLE);
    expect(
      within(error).getByText("Zkus to prosím za chvíli."),
    ).toBeInTheDocument();
    expectTheCardOffersAgain();
  },
);

/** Opens the account menu in the top bar and answers it. */
async function openAccountMenu(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("button", { name: ACCOUNT_MENU }));
  await timePasses(0);
  return screen.getByRole("menu");
}

/** No card about notifications is on the screen, in any of its states. */
function expectNoCard(): void {
  for (const title of [OFFER_TITLE, ENABLED_TITLE, DENIED_TITLE])
    expect(
      screen.queryByText(title),
      `no card reads "${title}"`,
    ).not.toBeInTheDocument();
}

/** The card offers "Zapnout upozornění" again: its default state, the button ready for a tap. */
function expectTheCardOffersAgain(): void {
  expect(screen.getByText(OFFER_TITLE)).toBeInTheDocument();
  const turnOn = screen.getByRole("button", { name: TURN_ON });
  expect(turnOn).toBeEnabled();
  expect(turnOn).not.toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: NOT_NOW })).toBeEnabled();
}

/**
 * The card that reads `title` after the phone answered, as assistive technology hears it: announced as a status
 * (c012 design.md D1, the enabled and denied states). Throws when there is none.
 */
function cardTitled(title: string): HTMLElement {
  const card = screen
    .queryAllByRole("status")
    .find((element) => within(element).queryByText(title) !== null);
  if (card === undefined)
    throw new Error(
      `No card titled "${title}" (an element with role "status" holding that text) is on the screen.`,
    );
  return card;
}

/** The subscriptions the app sent to the server, as their bodies. */
function subscriptionsSent(): unknown[] {
  return bodiesSent()
    .filter((sent) => sent.request === SEND_SUBSCRIPTION)
    .map((sent) => sent.body);
}

/** Whether `later` comes after `earlier` in the page. */
function isAfter(earlier: Node, later: Node): boolean {
  return (
    (earlier.compareDocumentPosition(later) &
      Node.DOCUMENT_POSITION_FOLLOWING) !==
    0
  );
}

/** The key a subscription was made with, as bytes. */
function keyBytesOf(subscription: PushSubscription): number[] {
  const key = subscription.options.applicationServerKey;
  return key === null ? [] : [...new Uint8Array(key)];
}

/** The bytes of base64url text: the test's own reading, independent of the app's. */
function fromBase64Url(text: string): number[] {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return [...atob(base64)].map((character) => character.charCodeAt(0));
}
