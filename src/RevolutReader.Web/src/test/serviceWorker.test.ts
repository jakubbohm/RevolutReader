import { expect, test } from "vitest";
import { PHONE_SECRET } from "./notificationBalance";
import { installServiceWorkerStandIn } from "./serviceWorker";

// The test kit's own checks: the service worker's push subscription (./serviceWorker.ts, c019 design.md D7).

/** Bytes as base64url without padding, the test's own reading. */
function asText(key: ArrayBuffer | null): string | null {
  if (key === null) return null;
  return btoa(String.fromCharCode(...new Uint8Array(key)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

test("The service worker's subscription holds the phone's secret by default", async () => {
  const { worker } = installServiceWorkerStandIn();

  const subscription = await worker.registration.pushManager.getSubscription();

  expect(asText(subscription?.getKey("auth") ?? null)).toBe(PHONE_SECRET);
});

test("The service worker's subscription holds the secret the test gives, and no other key", async () => {
  const { worker } = installServiceWorkerStandIn({
    subscription: { auth: "AAECAwQFBgcICQoLDA0ODw" },
  });

  const subscription = await worker.registration.pushManager.getSubscription();

  expect(asText(subscription?.getKey("auth") ?? null)).toBe(
    "AAECAwQFBgcICQoLDA0ODw",
  );
  expect(
    (subscription as { getKey(name: string): ArrayBuffer | null }).getKey(
      "p256dh",
    ),
  ).toBeNull();
});

test("A service worker with no subscription answers none", async () => {
  const { worker } = installServiceWorkerStandIn({ subscription: null });

  expect(await worker.registration.pushManager.getSubscription()).toBeNull();
});
