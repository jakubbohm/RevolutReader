import { expect, test } from "vitest";
import { installPushStandIns } from "../test/push";
import {
  answerWith,
  bodiesSent,
  pushKey,
  requests,
  stored,
} from "../test/server";
import { turnNotificationsOn } from "./turnOn";

// Turning notifications on (c012 design.md D3): the phone is asked right from the tap, and once it allows them the app
// subscribes with the server's key and sends the subscription. The phone's notifications and push are the test kit's
// stand-ins (src/test/push.ts), the server the fake server (src/test/server.ts). Every key here is made up. The
// failures (offline, later, the 60 s limit) are groups 33 and 37's.

/** The server's push key: made up, 65 bytes starting 0x04 (c011 D5's form), then 1, 2, …, 64. */
const SERVER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) =>
  i === 0 ? 4 : i,
);
const SERVER_KEY =
  "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

test("The phone is asked for permission before anything is awaited", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });

  const turning = turnNotificationsOn();

  expect(
    phone.permissionRequests(),
    "asked before the call returned, so within the tap",
  ).toBe(1);
  expect(requests(), "nothing asked of the server before the phone").toEqual(
    [],
  );
  await turning;
});

test("Once allowed, the app subscribes with the server's key, for visible pushes only, and sends the subscription", async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "granted",
  });
  answerWith({ pushKey: pushKey(SERVER_KEY), subscription: stored });

  await turnNotificationsOn();

  expect(phone.subscribeRequests()).toEqual([
    { userVisibleOnly: true, applicationServerKey: SERVER_KEY_BYTES },
  ]);
  const subscription = phone.subscription();
  expect(subscription, "the phone holds the subscription").not.toBeNull();
  expect(requests()).toEqual([
    "GET /api/push/key",
    "PUT /api/push/subscription",
  ]);
  expect(bodiesSent()).toEqual([
    {
      request: "PUT /api/push/subscription",
      contentType: "application/json",
      body: subscription?.toJSON(),
    },
  ]);
});

test('The server keeping the subscription is "on"', async () => {
  installPushStandIns({ permission: "default", permissionAnswer: "granted" });
  answerWith({ pushKey: pushKey(SERVER_KEY), subscription: stored });

  expect(await turnNotificationsOn()).toEqual({ kind: "on" });
});

test('A declined question is "declined", and nothing is sent to the server', async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "denied",
  });

  expect(await turnNotificationsOn()).toEqual({ kind: "declined" });
  expect(requests(), "no key read, no subscription sent").toEqual([]);
  expect(phone.subscribeRequests(), "no subscription made").toEqual([]);
});

test('A question closed without an answer is "undecided", and nothing is sent to the server', async () => {
  const phone = installPushStandIns({
    permission: "default",
    permissionAnswer: "default",
  });

  expect(await turnNotificationsOn()).toEqual({ kind: "undecided" });
  expect(requests(), "no key read, no subscription sent").toEqual([]);
  expect(phone.subscribeRequests(), "no subscription made").toEqual([]);
});
