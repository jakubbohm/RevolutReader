/**
 * The balance in a notification's address, as the server makes it (c019 design.md D2, D3, D12), made by the test kit
 * itself, never by the app's `notificationBalance` module: `<origin>/#balance=<payload>.<code>`, the payload the
 * balance's JSON as `GET /api/balance` writes it, UTF-8, base64url without padding; the code HMAC-SHA-256 of the
 * payload's text under the key HKDF-SHA-256 derives from the device's push subscription secret (`auth` as the keying
 * material, salt `"tarjeta-papa"`, info `"notification balance check code v1"`, 32 bytes), base64url without padding,
 * 43 characters.
 *
 * It runs on Node's WebCrypto (`crypto.subtle`, which Vitest's jsdom environment keeps: design.md § Context), since the
 * app's TypeScript has no Node types for `node:crypto`; its own test (`notificationBalance.test.ts`) pins it to the
 * known-answer vector of design.md D12, which Node's `crypto.hkdfSync` and `crypto.createHmac` made, outside both
 * implementations. Every secret and balance here is made up.
 */

/** The secret of the phone a scenario's notifications are made for: 16 made-up bytes, base64url, as a subscription's `auth`. */
export const PHONE_SECRET = toText(
  Uint8Array.from({ length: 16 }, (_, i) => (0x50 + i * 11) & 0xff),
);

/** The fragment's name (design.md D2). */
const NAME = "balance";

/** HKDF's salt and info for the check code's key (design.md D3). */
const SALT = "tarjeta-papa";
const INFO = "notification balance check code v1";

/** Where the address points when a test names no origin: the page's own origin. */
function pageOrigin(): string {
  return globalThis.location.origin;
}

/**
 * The fragment, without `#`, for a balance whose JSON text is `json` (written as the server writes it, e.g. `45.20` with
 * its trailing zero), made for the device whose secret is `secret` (base64url): `balance=<payload>.<code>`.
 */
export async function balanceFragment(
  json: string,
  secret: string,
): Promise<string> {
  const payload = toText(new TextEncoder().encode(json));
  return `${NAME}=${payload}.${await checkCode(payload, fromText(secret))}`;
}

/**
 * The address a notification about the account opens, carrying `balance` (any JSON value, written with
 * `JSON.stringify`: a balance as the phone keeps it, `kept(…)`, has the API's shape; leave a member out for the wrong
 * shape) for the device whose secret is `secret`: the start page on `origin` (by default the page's own) with the
 * balance's fragment.
 */
export async function balanceAddress(
  balance: unknown,
  secret: string,
  options: { origin?: string } = {},
): Promise<string> {
  const fragment = await balanceFragment(JSON.stringify(balance), secret);
  return `${options.origin ?? pageOrigin()}/#${fragment}`;
}

/**
 * As `balanceAddress`, but with a check code not made for the device whose secret is `secret`: the same payload, its
 * code made under another secret (each of `secret`'s bytes inverted, so never the same), as a link's author or another
 * device's notification would carry it.
 */
export async function wrongCode(
  balance: unknown,
  secret: string,
  options: { origin?: string } = {},
): Promise<string> {
  const another = toText(fromText(secret).map((byte) => byte ^ 0xff));
  return balanceAddress(balance, another, options);
}

/** HMAC-SHA-256 of the payload's text under the key HKDF derives from `secret` (design.md D3), base64url. */
async function checkCode(
  payload: string,
  secret: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const ascii = new TextEncoder();
  const keyingMaterial = await subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  const key = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: ascii.encode(SALT),
      info: ascii.encode(INFO),
    },
    keyingMaterial,
    256,
  );
  const hmacKey = await subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const code = await subtle.sign("HMAC", hmacKey, ascii.encode(payload));
  return toText(new Uint8Array(code));
}

/** The test kit's own base64url, independent of the app's: bytes to text without padding, and back. */
function toText(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromText(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
