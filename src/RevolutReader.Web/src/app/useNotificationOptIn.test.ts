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
