import { expect, test } from "vitest";
import { balanceAddress, PHONE_SECRET } from "../test/notificationBalance";
import {
  installPushStandIns,
  removePushStandIns,
  type PushStandInOptions,
} from "../test/push";
import { kept, keptBalance, openPageAt, phoneKeeps } from "../test/server";
import { takeInNotificationBalances } from "./notificationIntake";

// The page's intake of a notification's balance (c019 design.md D5, D6): the page's own address, checked with the
// secret of the push subscription the phone holds (`getKey("auth")`), kept by c015's rule. The browser is the kit's
// stand-ins (../test/push.ts) and the page's address the fake server's (../test/server.ts); the fragments are the test
// kit's own (../test/notificationBalance.ts). Every secret and balance here is made up.

/** The balance the phone keeps before the notification: read at 07:00 UTC. */
const KEPT = kept(250, new Date("2026-11-10T07:00:00Z"));

/** The notification's balance: read later than the kept one. */
const NOTIFIED = kept(286.4, new Date("2026-11-10T08:59:00Z"));

/** The phone holds a subscription with the secret the notifications were made for. */
const SUBSCRIBED: PushStandInOptions = { subscription: { auth: PHONE_SECRET } };

test("takeInNotificationBalances({ fromAddress: true }) keeps the page address's valid balance and reports kept", async () => {
  await phoneKeeps(KEPT);
  installPushStandIns(SUBSCRIBED);
  openPageAt(await balanceAddress(NOTIFIED, PHONE_SECRET));

  const outcome = await takeInNotificationBalances({
    fromAddress: true,
    fromList: false,
  });

  expect(outcome).toEqual({ kept: true });
  expect(await keptBalance()).toEqual(NOTIFIED);
});

test("No registration, no subscription or no auth key means nothing is kept, and it never rejects", async () => {
  const browsers: { label: string; options: PushStandInOptions | "none" }[] = [
    { label: "a browser without push", options: "none" },
    {
      label: "no service worker registered",
      options: { ...SUBSCRIBED, registered: false },
    },
    {
      label: "the registration refused",
      options: { ...SUBSCRIBED, registrationFails: new Error("refused") },
    },
    { label: "no subscription", options: {} },
    {
      label: "the subscription refused",
      options: { ...SUBSCRIBED, getSubscriptionFails: new Error("refused") },
    },
    { label: "no auth key", options: { subscription: { auth: null } } },
  ];

  for (const { label, options } of browsers) {
    await phoneKeeps(KEPT);
    if (options === "none") removePushStandIns();
    else installPushStandIns(options);
    openPageAt(await balanceAddress(NOTIFIED, PHONE_SECRET));

    await expect(
      takeInNotificationBalances({ fromAddress: true, fromList: false }),
      label,
    ).resolves.toEqual({ kept: false });
    expect(await keptBalance(), label).toEqual(KEPT);
  }
});
