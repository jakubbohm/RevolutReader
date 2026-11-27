import { expect, test } from "vitest";
import {
  balanceAddress,
  balanceFragment,
  PHONE_SECRET,
  wrongCode,
} from "./notificationBalance";

// The test kit's own checks: the balance in a notification's address (./notificationBalance.ts) is the server's
// construction (c019 design.md D2, D3), pinned to design.md D12's known-answer vector. Node's crypto.hkdfSync and
// crypto.createHmac made it once, outside both implementations, from a made-up secret (bytes 0x00 to 0x0f) and a
// made-up balance.

/** design.md D12's made-up secret, bytes 0x00 to 0x0f, in base64url. */
const VECTOR_SECRET = "AAECAwQFBgcICQoLDA0ODw";

/** design.md D12's made-up balance, as the server writes it. */
const VECTOR_JSON =
  '{"amount":45.20,"readAt":"2026-11-21T09:14:03+00:00","czkPerEur":24.6}';

const VECTOR_FRAGMENT =
  "balance=eyJhbW91bnQiOjQ1LjIwLCJyZWFkQXQiOiIyMDI2LTExLTIxVDA5OjE0OjAzKzAwOjAwIiwiY3prUGVyRXVyIjoyNC42fQ.gHNRottXJIXZNAvXcA5P_kbRkFAcBIPEngYqomaE9wM";

test("The test kit's balance fragment reproduces the known-answer vector", async () => {
  expect(await balanceFragment(VECTOR_JSON, VECTOR_SECRET)).toBe(
    VECTOR_FRAGMENT,
  );
});

test("A balance address is the start page with the balance's fragment, on the page's origin or the one given", async () => {
  const balance = {
    amount: 286.4,
    readAt: "2026-11-10T08:59:00.000Z",
    czkPerEur: 24.3,
  };
  const fragment = await balanceFragment(JSON.stringify(balance), PHONE_SECRET);

  expect(await balanceAddress(balance, PHONE_SECRET)).toBe(
    `${location.origin}/#${fragment}`,
  );
  expect(
    await balanceAddress(balance, PHONE_SECRET, {
      origin: "https://tarjeta-papa.example",
    }),
  ).toBe(`https://tarjeta-papa.example/#${fragment}`);
});

test("A wrong code keeps the payload and changes only the 43-character code", async () => {
  const balance = { amount: 0, readAt: "2026-11-10T08:59:00.000Z" };
  const right = await balanceAddress(balance, PHONE_SECRET);
  const wrong = await wrongCode(balance, PHONE_SECRET);

  const [rightPayload, rightCode] = right.split("#balance=")[1]!.split(".");
  const [wrongPayload, wrongCodeText] = wrong.split("#balance=")[1]!.split(".");
  expect(wrongPayload).toBe(rightPayload);
  expect(wrongCodeText).not.toBe(rightCode);
  expect(wrongCodeText).toHaveLength(43);
  expect(rightCode).toHaveLength(43);
});

test("The phone's secret is 16 bytes, as a push subscription's", () => {
  expect(atob(PHONE_SECRET.replace(/-/g, "+").replace(/_/g, "/"))).toHaveLength(
    16,
  );
});
