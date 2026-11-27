import { expect, test } from "vitest";
import {
  installPushStandIns,
  madeUpSubscription,
  type ListedNotification,
} from "./push";

// The test kit's own checks: the phone's notification list (./push.ts, c019 design.md § Ports and contracts) as the
// app's tests rely on it.

const PAYMENT = {
  title: "Odešlo 3,80 €",
  body: "Zůstatek 282,60 €",
  navigate: "http://localhost:3000/#balance=made-up",
};
const MESSAGE = { title: "Ahoj" };

/** What `getNotifications()` lists now, as plain values. */
async function listed(
  registration: ServiceWorkerRegistration,
): Promise<object[]> {
  const notifications =
    (await registration.getNotifications()) as unknown as ListedNotification[];
  return notifications.map(({ title, body, navigate, data }) => ({
    title,
    body,
    navigate,
    data,
  }));
}

test("The registration lists the notifications the phone shows, those that arrive later after them", async () => {
  const phone = installPushStandIns({ notifications: [PAYMENT] });

  phone.notificationArrives(MESSAGE);

  expect(await listed(phone.registration)).toEqual([
    { ...PAYMENT, data: null },
    { title: "Ahoj", body: "", navigate: undefined, data: null },
  ]);
});

test("A dismissed or closed notification is no longer listed", async () => {
  const phone = installPushStandIns({ notifications: [PAYMENT, MESSAGE] });
  const [first] =
    (await phone.registration.getNotifications()) as unknown as ListedNotification[];

  first!.close();
  expect(await listed(phone.registration)).toEqual([
    { title: "Ahoj", body: "", navigate: undefined, data: null },
  ]);
  phone.dismissNotifications();
  expect(await listed(phone.registration)).toEqual([]);
});

test("Listing fails with the test's error", async () => {
  const refused = new DOMException("Not allowed", "NotAllowedError");
  const phone = installPushStandIns({
    notifications: [PAYMENT],
    getNotificationsFails: refused,
  });

  await expect(phone.registration.getNotifications()).rejects.toBe(refused);
});

test("A listing left waiting lists what is shown once the test lets it go", async () => {
  const phone = installPushStandIns({ getNotificationsWaits: true });
  let answer: object[] | null = null;
  void listed(phone.registration).then((notifications) => {
    answer = notifications;
  });

  await Promise.resolve();
  phone.notificationArrives(PAYMENT);
  expect(answer).toBeNull();
  phone.letWaitingCallsSettle();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  expect(answer).toEqual([{ ...PAYMENT, data: null }]);
});

test("A subscription's secret is the bytes its auth names, and a subscription without one answers none", () => {
  const withSecret = madeUpSubscription({ auth: "AAECAwQFBgcICQoLDA0ODw" });
  const without = madeUpSubscription({ auth: null });

  expect([...new Uint8Array(withSecret.getKey("auth")!)]).toEqual(
    Array.from({ length: 16 }, (_, i) => i),
  );
  expect(without.getKey("auth")).toBeNull();
  expect(without.getKey("p256dh")).not.toBeNull();
  expect(without.toJSON().keys).not.toHaveProperty("auth");
});
