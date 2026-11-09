import { expect, test } from "vitest";
import { realTurn } from "../test/clock";
import {
  installPushStandIns,
  madeUpSubscription,
  type PushFeature,
} from "../test/push";
import {
  answerWith,
  bodiesSent,
  forgotten,
  goOffline,
  hostingErrorPage,
  jsonBody,
  noAnswerYet,
  noConnection,
  nobodySignedIn,
  pushKey,
  refused,
  requests,
  serverError,
  stored,
  subscriptionRefused,
  timeline,
  unreadable,
  wifiLoginPage,
  type ForgetAnswer,
  type PushKeyAnswer,
  type ServerAnswers,
  type SubscriptionAnswer,
  type Trouble,
} from "../test/server";
import {
  currentSubscription,
  forgetSubscription,
  fromBase64Url,
  keyOf,
  madeWith,
  pushSupported,
  readPushKey,
  sendSubscription,
  subscribe,
  toBase64Url,
  unsubscribe,
  type PushKeyRead,
  type SubscriptionSent,
} from "./push";

// The shared push pieces (c011 design.md D8): reading the server's push key, sending and forgetting this device's
// subscription, which never throw and answer a kind as every read of the API does (`askTheApi`); and the browser's own
// push calls, which pass their failures on as they come. The fake server (src/test/server.ts) answers the API client;
// the browser's push is the test kit's stand-ins (src/test/push.ts). Every key and push address here is made up.

/** The server's push key: made up, 65 bytes starting 0x04 (D5's form), then 1, 2, …, 64. */
const SERVER_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) =>
  i === 0 ? 4 : i,
);
const SERVER_KEY =
  "BAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-P0A";

/** Another made-up key of the same form: 0x04, then 199, 198, …, 136. */
const OTHER_KEY =
  "BMfGxcTDwsHAv769vLu6ubi3trW0s7KxsK-urayrqqmop6alpKOioaCfnp2cm5qZmJeWlZSTkpGQj46NjIuKiYg";

/** A made-up device: its push address at Apple's push service, its key (0x04, then 101 … 164) and secret (1 … 16). */
const PUSH_ADDRESS = "https://web.push.apple.com/made-up-device-token-7Q2f";
const DEVICE_KEY =
  "BGVmZ2hpamtsbW5vcHFyc3R1dnd4eXp7fH1-f4CBgoOEhYaHiImKi4yNjo-QkZKTlJWWl5iZmpucnZ6foKGio6Q";
const DEVICE_SECRET = "AQIDBAUGBwgJCgsMDQ4PEA";

function theDevice(): PushSubscription {
  return madeUpSubscription({
    endpoint: PUSH_ADDRESS,
    applicationServerKey: SERVER_KEY,
    p256dh: DEVICE_KEY,
    auth: DEVICE_SECRET,
  });
}

// ---- 52.1 ----

test("Reading the push key answers the key", async () => {
  answerWith({ pushKey: pushKey(SERVER_KEY) });

  expect(await readPushKey()).toEqual({ kind: "key", key: SERVER_KEY });
  expect(requests()).toEqual(["GET /api/push/key"]);
});

// ---- 52.2 ----

const otherKeyAnswers: {
  label: string;
  answer: PushKeyAnswer;
  read: PushKeyRead;
}[] = [
  {
    label: "401 signed out",
    answer: nobodySignedIn,
    read: { kind: "signed out" },
  },
  {
    label: "403 refused, with the email its problem names",
    answer: refused("cizi.ucet@example.com"),
    read: { kind: "refused", email: "cizi.ucet@example.com" },
  },
  {
    label: "403 refused, naming no email",
    answer: refused(null),
    read: { kind: "refused", email: null },
  },
  {
    label: "a server error unexpected",
    answer: serverError,
    read: { kind: "unexpected" },
  },
  {
    label: "a hosting error page unexpected",
    answer: hostingErrorPage,
    read: { kind: "unexpected" },
  },
  {
    label: "a body without the key unexpected",
    answer: unreadable,
    read: { kind: "unexpected" },
  },
  {
    label: "a key that is not text unexpected",
    answer: jsonBody({ publicKey: 42 }),
    read: { kind: "unexpected" },
  },
  {
    label: "a Wi-Fi login page unexpected",
    answer: wifiLoginPage,
    read: { kind: "unexpected" },
  },
  {
    label: "no answer offline",
    answer: noConnection,
    read: { kind: "offline" },
  },
];

test.each(otherKeyAnswers)(
  "Reading the push key answers signed out, refused, unexpected or offline as every read does: $label",
  async ({ answer, read }) => {
    answerWith({ pushKey: answer });

    expect(await readPushKey()).toEqual(read);
  },
);

test("Reading the push key answers signed out, refused, unexpected or offline as every read does: the phone says it is offline, nothing sent", async () => {
  answerWith({ pushKey: pushKey(SERVER_KEY) });
  goOffline();

  expect(await readPushKey()).toEqual({ kind: "offline" });
  expect(requests()).toEqual([]);
});

test("Reading the push key answers signed out, refused, unexpected or offline as every read does: an aborted read offline", async () => {
  answerWith({ pushKey: noAnswerYet });
  const read = new AbortController();

  const reading = readPushKey({ signal: read.signal });
  await realTurn();
  read.abort();

  expect(await reading).toEqual({ kind: "offline" });
  expect(timeline()).toContain("aborted GET /api/push/key");
});

// ---- 52.3 ----

test("Sending a subscription sends the browser's own subscription JSON and answers done on 204", async () => {
  answerWith({ subscription: stored });

  expect(await sendSubscription(theDevice())).toEqual({ kind: "done" });
  expect(requests()).toEqual(["PUT /api/push/subscription"]);
  expect(bodiesSent()).toEqual([
    {
      request: "PUT /api/push/subscription",
      contentType: "application/json",
      body: {
        endpoint: PUSH_ADDRESS,
        expirationTime: null,
        keys: { p256dh: DEVICE_KEY, auth: DEVICE_SECRET },
      },
    },
  ]);
});

// ---- 52.4 ----

const refusedSubscriptions: {
  label: string;
  answer: SubscriptionAnswer;
  sent: SubscriptionSent;
}[] = [
  {
    label: "the push address refused",
    answer: subscriptionRefused("endpoint"),
    sent: { kind: "refused subscription" },
  },
  {
    label: "the device key refused",
    answer: subscriptionRefused("keys.p256dh"),
    sent: { kind: "refused subscription" },
  },
  {
    label: "the secret refused",
    answer: subscriptionRefused("keys.auth"),
    sent: { kind: "refused subscription" },
  },
  {
    label: "nobody signed in is signed out, as every read",
    answer: nobodySignedIn,
    sent: { kind: "signed out" },
  },
  {
    label: "the account refused is refused, as every read",
    answer: refused("cizi.ucet@example.com"),
    sent: { kind: "refused", email: "cizi.ucet@example.com" },
  },
  {
    label: "a server error is unexpected",
    answer: serverError,
    sent: { kind: "unexpected" },
  },
  {
    label: "a hosting error page is unexpected",
    answer: hostingErrorPage,
    sent: { kind: "unexpected" },
  },
];

test.each(refusedSubscriptions)(
  "Sending a subscription the server refuses answers refused subscription: $label",
  async ({ answer, sent }) => {
    answerWith({ subscription: answer });

    expect(await sendSubscription(theDevice())).toEqual(sent);
  },
);

// ---- 52.5 ----

test("Forgetting a subscription sends its push address in the body and answers done on 204", async () => {
  answerWith({ forgetSubscription: forgotten });

  expect(await forgetSubscription(PUSH_ADDRESS)).toEqual({ kind: "done" });
  expect(requests()).toEqual(["DELETE /api/push/subscription"]);
  expect(bodiesSent()).toEqual([
    {
      request: "DELETE /api/push/subscription",
      contentType: "application/json",
      body: { endpoint: PUSH_ADDRESS },
    },
  ]);
});

const otherForgetAnswers: {
  label: string;
  answer: ForgetAnswer;
  sent: SubscriptionSent;
}[] = [
  {
    label: "nobody signed in is signed out",
    answer: nobodySignedIn,
    sent: { kind: "signed out" },
  },
  {
    label: "the account refused is refused",
    answer: refused(null),
    sent: { kind: "refused", email: null },
  },
  {
    label: "a server error is unexpected",
    answer: serverError,
    sent: { kind: "unexpected" },
  },
];

test.each(otherForgetAnswers)(
  "Forgetting a subscription sends its push address in the body and answers done on 204: otherwise as every read, $label",
  async ({ answer, sent }) => {
    answerWith({ forgetSubscription: answer });

    expect(await forgetSubscription(PUSH_ADDRESS)).toEqual(sent);
  },
);

// ---- 52.6 ----

const sendingAndForgetting: {
  label: string;
  request: string;
  answers: (answer: Trouble) => ServerAnswers;
  run: (signal?: AbortSignal) => Promise<SubscriptionSent>;
}[] = [
  {
    label: "sending",
    request: "PUT /api/push/subscription",
    answers: (answer) => ({ subscription: answer }),
    run: (signal) => sendSubscription(theDevice(), { signal }),
  },
  {
    label: "forgetting",
    request: "DELETE /api/push/subscription",
    answers: (answer) => ({ forgetSubscription: answer }),
    run: (signal) => forgetSubscription(PUSH_ADDRESS, { signal }),
  },
];

test.each(sendingAndForgetting)(
  "Sending or forgetting answers offline without sending while the phone says it is offline: $label",
  async ({ run }) => {
    goOffline();

    expect(await run()).toEqual({ kind: "offline" });
    expect(requests()).toEqual([]);
  },
);

test.each(sendingAndForgetting)(
  "Sending or forgetting answers offline without sending while the phone says it is offline: $label with no answer is offline too",
  async ({ answers, run }) => {
    answerWith(answers(noConnection));

    expect(await run()).toEqual({ kind: "offline" });
  },
);

test.each(sendingAndForgetting)(
  "Sending or forgetting answers offline without sending while the phone says it is offline: $label aborted is offline too",
  async ({ request, answers, run }) => {
    answerWith(answers(noAnswerYet));
    const sending = new AbortController();

    const sent = run(sending.signal);
    await realTurn();
    sending.abort();

    expect(await sent).toEqual({ kind: "offline" });
    expect(timeline()).toContain(`aborted ${request}`);
  },
);

// ---- 52.7 ----

test("Push is supported only with a service worker, PushManager and Notification: all three", () => {
  installPushStandIns();

  expect(pushSupported()).toBe(true);
});

test("Push is supported only with a service worker, PushManager and Notification: none of them (jsdom as it is)", () => {
  expect(pushSupported()).toBe(false);
});

const missingFeatures: { feature: PushFeature }[] = [
  { feature: "service worker" },
  { feature: "PushManager" },
  { feature: "Notification" },
];

test.each(missingFeatures)(
  "Push is supported only with a service worker, PushManager and Notification: without $feature",
  ({ feature }) => {
    installPushStandIns({ without: [feature] });

    expect(pushSupported()).toBe(false);
  },
);

test("Push is supported only with a service worker, PushManager and Notification: the browser given, not the window", () => {
  const withAllThree = {
    navigator: { serviceWorker: {} },
    PushManager: class {},
    Notification: class {},
  } as unknown as Window;
  const withoutPushManager = {
    navigator: { serviceWorker: {} },
    Notification: class {},
  } as unknown as Window;

  expect(pushSupported(withAllThree)).toBe(true);

  installPushStandIns();
  expect(pushSupported(withoutPushManager)).toBe(false);
});

// ---- 52.8 ----

test("Subscribing asks for visible pushes only, with the server's key as bytes", async () => {
  const browser = installPushStandIns({ permission: "granted" });

  const subscription = await subscribe(browser.registration, SERVER_KEY);

  expect(browser.subscribeRequests()).toEqual([
    { userVisibleOnly: true, applicationServerKey: SERVER_KEY_BYTES },
  ]);
  expect(subscription).toBe(browser.subscription());
});

test("Subscribing asks for visible pushes only, with the server's key as bytes: the browser's failure passes on as it comes", async () => {
  const failure = new DOMException(
    "Registration failed - permission denied",
    "NotAllowedError",
  );
  const browser = installPushStandIns({
    permission: "granted",
    subscribeFails: failure,
  });

  await expect(subscribe(browser.registration, SERVER_KEY)).rejects.toBe(
    failure,
  );
});

// ---- 52.9 ----

test("The current subscription is the registration's, or none: the registration's", async () => {
  const browser = installPushStandIns({
    permission: "granted",
    subscription: { endpoint: PUSH_ADDRESS, applicationServerKey: SERVER_KEY },
  });

  const current = await currentSubscription(browser.registration);

  expect(current).toBe(browser.subscription());
  expect(current?.endpoint).toBe(PUSH_ADDRESS);
});

test("The current subscription is the registration's, or none: none", async () => {
  const browser = installPushStandIns({ permission: "granted" });

  expect(await currentSubscription(browser.registration)).toBeNull();
});

// ---- 52.10 ----

test("A subscription's key reads back in base64url, and it was made with a key exactly when the two are equal", () => {
  const madeWithTheServerKey = madeUpSubscription({
    applicationServerKey: SERVER_KEY_BYTES,
  });
  const madeWithNoKey = madeUpSubscription({ applicationServerKey: null });

  expect(keyOf(madeWithTheServerKey)).toBe(SERVER_KEY);
  expect(keyOf(madeWithNoKey)).toBeNull();

  expect(madeWith(madeWithTheServerKey, SERVER_KEY)).toBe(true);
  expect(madeWith(madeWithTheServerKey, OTHER_KEY)).toBe(false);
  expect(madeWith(madeWithNoKey, SERVER_KEY)).toBe(false);
});

// ---- 52.11 ----

test("Unsubscribing answers whether the browser unsubscribed: it did", async () => {
  const browser = installPushStandIns({
    permission: "granted",
    subscription: { endpoint: PUSH_ADDRESS, applicationServerKey: SERVER_KEY },
  });

  expect(await unsubscribe(browser.subscription()!)).toBe(true);
  expect(browser.subscription()).toBeNull();
});

test("Unsubscribing answers whether the browser unsubscribed: it did not", async () => {
  expect(
    await unsubscribe(madeUpSubscription({ unsubscribeAnswers: false })),
  ).toBe(false);
});

test("Unsubscribing answers whether the browser unsubscribed: the browser's failure passes on as it comes", async () => {
  const failure = new DOMException("The subscription failed.", "AbortError");

  await expect(
    unsubscribe(madeUpSubscription({ unsubscribeFails: failure })),
  ).rejects.toBe(failure);
});

// ---- 52.12 ----

const pairs: { label: string; bytes: Uint8Array; text: string }[] = [
  { label: "nothing", bytes: new Uint8Array(), text: "" },
  { label: "one byte", bytes: Uint8Array.from([0x66]), text: "Zg" },
  { label: "two bytes", bytes: Uint8Array.from([0x66, 0x6f]), text: "Zm8" },
  {
    label: "three bytes",
    bytes: Uint8Array.from([0x66, 0x6f, 0x6f]),
    text: "Zm9v",
  },
  {
    label: "the URL-safe letters, - and _ for + and /",
    bytes: Uint8Array.from([0xfb, 0xff]),
    text: "-_8",
  },
  { label: "a push key", bytes: SERVER_KEY_BYTES, text: SERVER_KEY },
  {
    label: "a device secret",
    bytes: Uint8Array.from({ length: 16 }, (_, i) => i + 1),
    text: DEVICE_SECRET,
  },
];

test.each(pairs)(
  "base64url turns into bytes and back unchanged, without padding: $label",
  ({ bytes, text }) => {
    expect(toBase64Url(bytes)).toBe(text);
    expect(fromBase64Url(text)).toEqual(bytes);
    expect(toBase64Url(fromBase64Url(text))).toBe(text);
  },
);

test("base64url turns into bytes and back unchanged, without padding: an ArrayBuffer, and a view of part of one", () => {
  expect(toBase64Url(SERVER_KEY_BYTES.slice().buffer)).toBe(SERVER_KEY);

  const around = Uint8Array.from([0x00, 0xfb, 0xff, 0x00]);
  expect(toBase64Url(around.subarray(1, 3))).toBe("-_8");
});
