import { act, renderHook } from "@testing-library/react";
import { expect, test } from "vitest";
import { SECOND, startTestClock, timePasses } from "../test/clock";
import { installPushStandIns } from "../test/push";
import {
  after,
  answerWith,
  goOffline,
  goOnline,
  leaveApp,
  phoneRemembersNotNow,
  requests,
  returnToApp,
  serverError,
  stored,
} from "../test/server";
import { notNowRemembered } from "./notNow";
import { useNotificationOptIn } from "./useNotificationOptIn";

// The opt-in's sequence (c012 design.md D3–D8; § Rule ownership: useNotificationOptIn), driven through the hook on the
// test clock, with C8a's push stand-ins (src/test/push.ts) as the phone and the fake server (src/test/server.ts). An
// opening (D4) is a launch or a return to the app (`visibilitychange` to visible); a result goes at the first opening
// after the app was left while it showed. Every key here is made up.

/** How long the server takes to keep the subscription, so the card is seen while it turns on. */
const KEEP_TIME = 2 * SECOND;

/** The hook on the account screen of a signed-in user, with the balance header on screen. */
function theOptIn() {
  return renderHook(() =>
    useNotificationOptIn({
      signedIn: true,
      underBalance: true,
      onFailed: () => {},
      onRetried: () => {},
    }),
  );
}

/**
 * The phone's Settings change the notification permission while the app is away: `Notification.permission` reads
 * `permission` from now on. Only what the page reads changes; the stand-in's own answers stay as they were.
 */
function settingsChangePermissionTo(permission: NotificationPermission): void {
  Object.defineProperty(Notification, "permission", {
    configurable: true,
    get: () => permission,
  });
}

/** The phone, never asked, allows notifications when asked; the server keeps the subscription after `KEEP_TIME`. */
function aPhoneThatAllows(): void {
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  answerWith({ subscription: after(KEEP_TIME, stored) });
}

// ---- group 15: openings ----

test("A return to the app after it was left while the enabled card showed clears the card", async () => {
  startTestClock();
  aPhoneThatAllows();
  const { result } = theOptIn();
  act(() => {
    result.current.turnOn();
  });
  await timePasses(KEEP_TIME);
  expect(result.current.card, "the card says they are on").toBe("enabled");

  leaveApp();
  await timePasses(0);
  returnToApp();
  await timePasses(0);

  expect(result.current.card, "no card").toBeNull();
  expect(result.current.menuItem, "no menu item").toBe(false);
});

// The iOS prompt may hide the page and show it again (D4): that return comes while turning on, so the result it is
// about to show stays; the first opening after the app was left while the result showed is the one that clears it.
test.each([
  { label: "back before the result", awayFor: 0 },
  { label: "the result came while away", awayFor: KEEP_TIME },
])(
  "A return to the app that comes while turning on leaves the result to show when it comes (the iOS prompt, D4): $label",
  async ({ awayFor }) => {
    startTestClock();
    aPhoneThatAllows();
    const { result } = theOptIn();
    act(() => {
      result.current.turnOn();
    });
    await timePasses(0);
    expect(result.current.card, "turning on").toBe("enabling");

    leaveApp();
    await timePasses(awayFor);
    returnToApp();
    await timePasses(KEEP_TIME);

    expect(result.current.card, "the result shows").toBe("enabled");

    leaveApp();
    await timePasses(0);
    returnToApp();
    await timePasses(0);

    expect(
      result.current.card,
      "gone at the next opening after it showed",
    ).toBeNull();
  },
);

// Coming back online repeats the screen's reads (C7a), but it is not an opening (D4). The return at the end shows the
// result does go at a real opening, so its staying is the rule, not a watch that never runs.
test("Coming back online is not an opening: the result stays", async () => {
  startTestClock();
  aPhoneThatAllows();
  const { result } = theOptIn();
  act(() => {
    result.current.turnOn();
  });
  await timePasses(KEEP_TIME);
  expect(result.current.card, "the card says they are on").toBe("enabled");

  goOffline();
  await timePasses(0);
  goOnline();
  await timePasses(0);

  expect(result.current.card, "the result stays").toBe("enabled");

  leaveApp();
  await timePasses(0);
  returnToApp();
  await timePasses(0);

  expect(result.current.card, "gone at the next opening").toBeNull();
});

// A change made in the phone's Settings while the app was away shows at once on the return (D4): once the phone allows
// notifications, nothing is offered (D8, "On").
test("Every opening reads the phone's permission again", async () => {
  startTestClock();
  installPushStandIns({ permission: "default" });
  const { result } = theOptIn();
  await timePasses(0);
  expect(result.current.card, "never asked: the default card").toBe("default");

  leaveApp();
  await timePasses(0);
  settingsChangePermissionTo("granted");
  returnToApp();
  await timePasses(0);

  expect(result.current.card, "allowed in Settings: no card").toBeNull();
  expect(result.current.menuItem, "and no menu item").toBe(false);
});

// ---- group 28: turning on from the account menu (D7) ----

// The menu's item asks the phone inside Radix's `onSelect`, so iOS sees the tap (D3, D7): the question goes out before
// `fromMenu` returns, and nothing is asked of the server before it.
test("Turning on from the menu asks the phone before anything is awaited", async () => {
  startTestClock();
  phoneRemembersNotNow();
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });
  answerWith({ subscription: after(KEEP_TIME, stored) });
  const { result } = theOptIn();
  expect(result.current.menuItem, "the menu offers notifications").toBe(true);

  let asked = 0;
  let serverRequests: string[] = [];
  act(() => {
    result.current.fromMenu();
    asked = phone.permissionRequests();
    serverRequests = requests();
  });

  expect(asked, "asked before the call returned, so within the tap").toBe(1);
  expect(
    serverRequests,
    "nothing asked of the server before the phone",
  ).toEqual([]);
  await timePasses(KEEP_TIME);
});

// After "Teď ne" the card comes back to show the result (D2, D7), and the choice stays: the menu does not undo it.
test('With "Teď ne" remembered, the result of a turn-on from the menu shows in the card, and "Teď ne" stays remembered', async () => {
  startTestClock();
  phoneRemembersNotNow();
  aPhoneThatAllows();
  const { result } = theOptIn();
  expect(result.current.card, 'no card after "Teď ne"').toBeNull();

  act(() => {
    result.current.fromMenu();
  });
  await timePasses(0);

  expect(result.current.card, "the card back, turning on").toBe("enabling");
  expect(result.current.menuItem, "and no menu item").toBe(false);

  await timePasses(KEEP_TIME);

  expect(result.current.card, "the card says they are on").toBe("enabled");
  expect(result.current.menuItem, "and no menu item").toBe(false);
  expect(notNowRemembered(), '"Teď ne" stays remembered').toBe(true);
});

// ---- group 31: the menu on a blocked phone (D7) ----

// The web cannot ask again once the phone blocks notifications, so the menu's item asks nothing and brings back the
// Denied card, which says where to turn them on (D6, D7); it goes at the first opening after it showed, as after a
// decline (D4), and the menu item offers again.
test("On a blocked phone, the menu's item asks nothing and gives the Denied card", async () => {
  startTestClock();
  const phone = installPushStandIns({
    permission: "denied",
    permissionAnswer: "denied",
  });
  const { result } = theOptIn();
  expect(result.current.card, "blocked: no card").toBeNull();
  expect(result.current.menuItem, "the menu offers notifications").toBe(true);

  act(() => {
    result.current.fromMenu();
  });
  await timePasses(0);

  expect(phone.permissionRequests(), "the phone was not asked").toBe(0);
  expect(result.current.card, "the Denied card").toBe("denied");
  expect(result.current.menuItem, "and no menu item").toBe(false);
  expect(requests(), "nothing sent to the server").toEqual([]);

  leaveApp();
  await timePasses(0);
  returnToApp();
  await timePasses(0);

  expect(
    result.current.card,
    "gone at the next opening after it showed",
  ).toBeNull();
  expect(result.current.menuItem, "the menu item again").toBe(true);
});

// ---- group 34: a failure to turn on (D8) ----
// The hook tells the screen of a failure (`onFailed(offline)`), for its one banner, and of a new turn-on
// (`onRetried()`), which clears that failure. The card returns to its default state for the rest of this opening, a
// result of this opening as the others: it goes at the first opening after the app was left while it showed (D4).

/** The hook as `theOptIn`, with what it told the screen: the failures (offline or not) and the new turn-ons. */
function theOptInTellingTheScreen() {
  const failures: boolean[] = [];
  let retries = 0;
  const hook = renderHook(() =>
    useNotificationOptIn({
      signedIn: true,
      underBalance: true,
      onFailed: (offline) => {
        failures.push(offline);
      },
      onRetried: () => {
        retries += 1;
      },
    }),
  );
  return { ...hook, failures, retries: () => retries };
}

test.each([
  { label: "offline", offline: true },
  { label: "the server fails", offline: false },
])(
  "A failed turn-on tells the screen, for its one banner, offline or not: $label",
  async ({ offline }) => {
    startTestClock();
    installPushStandIns({ permission: "default", permissionAnswer: "granted" });
    answerWith({ subscription: serverError });
    if (offline) goOffline();
    const { result, failures } = theOptInTellingTheScreen();

    act(() => {
      result.current.turnOn();
    });
    await timePasses(0);

    expect(failures).toEqual([offline]);
  },
);

// The iOS prompt may hide the page and show it again (D4): that return, while turning on, reads the permission the
// phone now has, so the hook knows the phone allows notifications when the failure comes.
test("After a failure, the default card for the rest of this opening, even when the phone now allows notifications", async () => {
  startTestClock();
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });
  answerWith({ subscription: after(KEEP_TIME, serverError) });
  const { result } = theOptIn();
  act(() => {
    result.current.turnOn();
  });
  await timePasses(0);
  leaveApp();
  await timePasses(0);
  returnToApp();
  await timePasses(0);
  expect(phone.permission(), "the phone now allows them").toBe("granted");

  await timePasses(KEEP_TIME);

  expect(result.current.card, "the default card").toBe("default");
  expect(result.current.menuItem, "and no menu item").toBe(false);

  // Losing and regaining the network is not an opening (D4).
  goOffline();
  await timePasses(0);
  goOnline();
  await timePasses(0);
  expect(result.current.card, "still the default card").toBe("default");

  leaveApp();
  await timePasses(0);
  returnToApp();
  await timePasses(0);

  expect(
    result.current.card,
    "gone at the next opening after it showed",
  ).toBeNull();
  expect(result.current.menuItem, "on now: nothing offered").toBe(false);
});

test("A new turn-on tells the screen, so its earlier failure clears", async () => {
  startTestClock();
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  answerWith({ subscription: [serverError, after(KEEP_TIME, stored)] });
  const { result, failures, retries } = theOptInTellingTheScreen();
  act(() => {
    result.current.turnOn();
  });
  await timePasses(0);
  expect(failures, "the first turn-on failed").toEqual([false]);
  const retriesBefore = retries();

  act(() => {
    result.current.turnOn();
  });

  expect(retries(), "the new turn-on told the screen").toBeGreaterThan(
    retriesBefore,
  );
  await timePasses(KEEP_TIME);
  expect(result.current.card, "and turned them on").toBe("enabled");
  expect(failures, "no new failure").toEqual([false]);
});

// Review finding (PR #78): the default card after a failure is there so the user can try again (D8), not to outlast
// "Teď ne", which hides the card (spec: "Tapping 'Teď ne' SHALL hide the card"). The menu's item is left out: the phone
// already allows notifications after a failure, so whether it is offered is the spec's boundary, not this finding.
test('"Teď ne" on the default card after a failure hides the card, and is remembered', async () => {
  startTestClock();
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  answerWith({ subscription: serverError });
  const { result } = theOptIn();
  act(() => {
    result.current.turnOn();
  });
  await timePasses(0);
  expect(result.current.card, "the default card after the failure").toBe(
    "default",
  );

  act(() => {
    result.current.notNow();
  });
  await timePasses(0);

  expect(result.current.card, "the card hidden").toBeNull();
  expect(notNowRemembered(), '"Teď ne" remembered').toBe(true);
});
