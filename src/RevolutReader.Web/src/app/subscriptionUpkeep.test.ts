import { expect, test } from "vitest";
import { startTestClock, timePasses } from "../test/clock";
import { installPushStandIns, type PushFeature } from "../test/push";
import { pushRegistration } from "./subscriptionUpkeep";

// Keeping this device's push subscription right (c013 design.md D1–D6). The browser's push is the test kit's stand-ins
// (src/test/push.ts), installed per test and removed after it; without them the browser cannot push, as jsdom as it
// is. A browser of the test's own, given instead of the window, is a plain object. Every address here is made up.

/** A registration of the test's own, known by its identity. */
function aRegistrationOfItsOwn(): ServiceWorkerRegistration {
  return {
    scope: `${location.origin}/`,
  } as unknown as ServiceWorkerRegistration;
}

/**
 * A browser of the test's own, given to the function instead of the window: a service worker that answers
 * `getRegistration` as the test says, `Notification`, and `PushManager` unless left out.
 */
function aBrowserOfItsOwn(options: {
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  withoutPushManager?: boolean;
}): Window {
  return {
    navigator: { serviceWorker: { getRegistration: options.getRegistration } },
    ...(options.withoutPushManager === true ? {} : { PushManager: class {} }),
    Notification: class {},
  } as unknown as Window;
}

// ---- 2.1 ----

test("The registration is the one the browser has registered", async () => {
  const browser = installPushStandIns({ permission: "granted" });

  expect(await pushRegistration()).toBe(browser.registration);
});

test("The registration is the one the browser has registered: the browser given, not the window", async () => {
  installPushStandIns({ permission: "granted" });
  const theirs = aRegistrationOfItsOwn();

  expect(
    await pushRegistration(
      aBrowserOfItsOwn({ getRegistration: () => Promise.resolve(theirs) }),
    ),
  ).toBe(theirs);
});

// ---- 2.2 ----

test("There is no registration where the browser cannot push: none of push's features (jsdom as it is)", async () => {
  expect(await pushRegistration()).toBeNull();
});

const missingFeatures: { feature: PushFeature }[] = [
  { feature: "service worker" },
  { feature: "PushManager" },
  { feature: "Notification" },
];

test.each(missingFeatures)(
  "There is no registration where the browser cannot push: without $feature",
  async ({ feature }) => {
    installPushStandIns({ permission: "granted", without: [feature] });

    expect(await pushRegistration()).toBeNull();
  },
);

test("There is no registration where the browser cannot push: the browser given, though the window can", async () => {
  installPushStandIns({ permission: "granted" });
  const theirs = aRegistrationOfItsOwn();

  expect(
    await pushRegistration(
      aBrowserOfItsOwn({
        getRegistration: () => Promise.resolve(theirs),
        withoutPushManager: true,
      }),
    ),
  ).toBeNull();
});

// ---- 2.3 ----

test("There is no registration when no worker is registered, and nothing waits for one", async () => {
  startTestClock();
  // A service worker, but none registered (Vite's dev server): `ready` would never settle.
  installPushStandIns({ permission: "granted", registered: false });

  const asking = pushRegistration();
  // What is due now happens; the clock does not move.
  const nothingMoves = timePasses(0);
  const first = await Promise.race([
    asking,
    nothingMoves.then(() => "still waiting" as const),
  ]);
  await nothingMoves;

  expect(first).toBeNull();
});

// ---- 2.4 ----

test("A failure to ask for the registration reads as none: the browser refuses to answer", async () => {
  installPushStandIns({
    permission: "granted",
    registrationFails: new DOMException(
      "The operation is insecure.",
      "SecurityError",
    ),
  });

  expect(await pushRegistration()).toBeNull();
});

test("A failure to ask for the registration reads as none: asking throws at once", async () => {
  const browser = aBrowserOfItsOwn({
    getRegistration: () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });

  expect(await pushRegistration(browser)).toBeNull();
});
