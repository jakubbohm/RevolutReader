import { expect, test } from "vitest";
import {
  balanceFragment,
  PHONE_SECRET,
  secretBytes,
  signedFragment,
} from "../test/notificationBalance";
import type { Balance } from "./balanceRecord";
import {
  balanceInAddress,
  carriesBalance,
  newest,
} from "./notificationBalance";

// The balance in a notification's address (c019 design.md D2, D3): `#balance=<payload>.<code>`, the payload the
// balance's JSON in base64url without padding, the code a 43-character base64url HMAC-SHA-256 under the key HKDF-SHA-256
// derives from the device's push subscription secret. The known-answer vector (design.md D12) was made once with Node's
// crypto.hkdfSync and crypto.createHmac, outside both implementations; the server's BalanceInAddressTests pins the same
// fragment. The other fragments come from the test kit's own construction (../test/notificationBalance.ts), never from
// this module. Every secret and balance here is made up.

/** design.md D12's made-up secret, bytes 0x00 to 0x0f, in base64url. */
const VECTOR_SECRET = "AAECAwQFBgcICQoLDA0ODw";

/** design.md D12's fragment, for the balance {"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}. */
const VECTOR_FRAGMENT =
  "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

const VECTOR_PAYLOAD = VECTOR_FRAGMENT.slice("balance=".length).split(".")[0]!;
const VECTOR_CODE = VECTOR_FRAGMENT.split(".")[1]!;

const ORIGIN = "https://tarjeta-papa.example";

function addressWith(fragment: string): string {
  return `${ORIGIN}/#${fragment}`;
}

function vectorSecret(): ArrayBuffer {
  return secretBytes(VECTOR_SECRET);
}

/** Text in base64url without padding, written here, not by the module under test. */
function base64url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The operations of WebCrypto the check could use. */
const OPERATIONS = [
  "importKey",
  "deriveBits",
  "deriveKey",
  "sign",
  "verify",
  "digest",
] as const;

/**
 * Runs `body` while every operation of the page's `crypto.subtle` fails, by throwing at once or by rejecting, as a
 * browser that refuses the work; the operations are put back afterwards.
 */
async function whileCryptoFails(
  how: "throws" | "rejects",
  body: () => Promise<void>,
): Promise<void> {
  const subtle = globalThis.crypto.subtle as unknown as Record<string, unknown>;
  const before = OPERATIONS.map((name) => ({
    name,
    descriptor: Object.getOwnPropertyDescriptor(subtle, name),
  }));
  for (const name of OPERATIONS)
    Object.defineProperty(subtle, name, {
      configurable: true,
      writable: true,
      value:
        how === "throws"
          ? () => {
              throw new Error("crypto refused");
            }
          : () => Promise.reject(new Error("crypto refused")),
    });
  try {
    await body();
  } finally {
    for (const { name, descriptor } of before)
      if (descriptor === undefined) delete subtle[name];
      else Object.defineProperty(subtle, name, descriptor);
  }
}

test("The known-answer vector's address gives its balance", async () => {
  expect(
    await balanceInAddress(addressWith(VECTOR_FRAGMENT), vectorSecret()),
  ).toEqual({
    amount: 45.2,
    readAt: "2026-11-21T09:14:03+00:00",
    czkPerEur: 24.6,
  });
  expect(
    await balanceInAddress(
      `${ORIGIN}/?from=notification#${VECTOR_FRAGMENT}`,
      vectorSecret(),
    ),
    "with a query before the fragment",
  ).toEqual({
    amount: 45.2,
    readAt: "2026-11-21T09:14:03+00:00",
    czkPerEur: 24.6,
  });
});

test("carriesBalance is true for #balance=…, whatever follows, and false for no fragment or another one", () => {
  const balanceFragments = [
    addressWith(VECTOR_FRAGMENT),
    addressWith("balance="),
    addressWith("balance=not.a.balance"),
    `${ORIGIN}/?from=notification#balance=x`,
  ];
  for (const address of balanceFragments)
    expect(carriesBalance(address), address).toBe(true);

  const others = [
    `${ORIGIN}/`,
    `${ORIGIN}/#`,
    addressWith("transactions"),
    addressWith("balances=x"),
    `${ORIGIN}/?balance=x`,
  ];
  for (const address of others)
    expect(carriesBalance(address), address).toBe(false);
});

test("A fragment that is not <payload>.<code> in base64url, or whose payload is not JSON, gives no balance", async () => {
  const padded = `${VECTOR_PAYLOAD}==`;
  const malformed: { label: string; fragment: string }[] = [
    { label: "nothing after the name", fragment: "balance=" },
    { label: "no code", fragment: `balance=${VECTOR_PAYLOAD}` },
    { label: "an empty code", fragment: `balance=${VECTOR_PAYLOAD}.` },
    { label: "a third part", fragment: `${VECTOR_FRAGMENT}.${VECTOR_CODE}` },
    {
      label: "the payload with base64's padding, its code made over that text",
      fragment: await signedFragment(padded, VECTOR_SECRET),
    },
    {
      label: "the code with base64's padding",
      fragment: `${VECTOR_FRAGMENT}=`,
    },
    {
      label: "the code in base64's alphabet, not base64url's",
      fragment: `balance=${VECTOR_PAYLOAD}.${VECTOR_CODE.replace(/_/g, "/").replace(/-/g, "+")}`,
    },
    {
      label: "a payload that is not JSON, its code right",
      fragment: await signedFragment(base64url("not json"), VECTOR_SECRET),
    },
  ];

  for (const { label, fragment } of malformed)
    expect(
      await balanceInAddress(addressWith(fragment), vectorSecret()),
      label,
    ).toBeNull();
});

test("A payload whose shape balanceOf refuses gives no balance", async () => {
  const wrongShapes: { label: string; json: string }[] = [
    { label: "no read time", json: '{"amount":250.00,"czkPerEur":24.6}' },
    {
      label: "the amount as text",
      json: '{"amount":"250.00","readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}',
    },
    {
      label: "a read time that is no date",
      json: '{"amount":250.00,"readAt":"a minute ago","czkPerEur":24.6}',
    },
    { label: "null", json: "null" },
    { label: "a list", json: "[250.00]" },
    { label: "a number", json: "250.00" },
  ];

  for (const { label, json } of wrongShapes)
    expect(
      await balanceInAddress(
        addressWith(await balanceFragment(json, VECTOR_SECRET)),
        vectorSecret(),
      ),
      label,
    ).toBeNull();
});

test("No secret, or a crypto.subtle that throws, gives no balance and never rejects", async () => {
  const address = addressWith(VECTOR_FRAGMENT);

  await expect(
    balanceInAddress(address, null),
    "no secret",
  ).resolves.toBeNull();

  await whileCryptoFails("throws", async () => {
    await expect(
      balanceInAddress(address, vectorSecret()),
      "crypto.subtle throwing at once",
    ).resolves.toBeNull();
  });
  await whileCryptoFails("rejects", async () => {
    await expect(
      balanceInAddress(address, vectorSecret()),
      "crypto.subtle rejecting",
    ).resolves.toBeNull();
  });
});

// A fragment without a code (`balance=<payload>`, and `balance=<payload>.`) is 10.3's.
test("A code made with another secret, a code one character off, and a fragment without a code each give no balance", async () => {
  const oneOff = `${VECTOR_CODE[0] === "g" ? "h" : "g"}${VECTOR_CODE.slice(1)}`;
  const notThisPhones: { label: string; fragment: string }[] = [
    {
      label: "a code made with another secret",
      fragment: await signedFragment(VECTOR_PAYLOAD, PHONE_SECRET),
    },
    {
      label: "a code one character off",
      fragment: `balance=${VECTOR_PAYLOAD}.${oneOff}`,
    },
  ];

  for (const { label, fragment } of notThisPhones)
    expect(
      await balanceInAddress(addressWith(fragment), vectorSecret()),
      label,
    ).toBeNull();
});

/** A balance of `amount` EUR read at `readAt`, as written, offset and all. Made up. */
function readAt(amount: number, at: string): Balance {
  return { amount, readAt: at, czkPerEur: 24.6 };
}

test("newest gives the balance read last, readAt compared as moments (two offsets of the same moment are equal)", () => {
  expect(newest([]), "none").toBeNull();

  const one = readAt(250, "2026-11-10T07:00:00+00:00");
  expect(newest([one]), "one").toEqual(one);

  // 08:59 UTC is read last, though its text sorts before 09:30+01:00 (08:30 UTC).
  const last = readAt(286.4, "2026-11-10T08:59:00+00:00");
  const earlier = readAt(301.9, "2026-11-10T09:30:00+01:00");
  for (const order of [
    [one, last, earlier],
    [earlier, one, last],
    [last, earlier, one],
  ])
    expect(newest(order), "whatever the order").toEqual(last);

  // 08:59 UTC both: neither is read later, so the balance read last is that moment, and nothing earlier.
  const sameMoment = readAt(301.9, "2026-11-10T09:59:00+01:00");
  for (const order of [
    [last, sameMoment, one],
    [one, sameMoment, last],
  ]) {
    const found = newest(order);
    expect(found, "one of the two read at that moment").not.toEqual(one);
    expect(Date.parse(found!.readAt), "that moment").toBe(
      Date.parse(last.readAt),
    );
  }
});
