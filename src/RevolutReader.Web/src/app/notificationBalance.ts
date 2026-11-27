// The balance in a notification's address (c019 design.md D2, D3, D5), shared by the page and the service worker: its
// only import is ./balanceRecord (c015 design.md D5), so the service worker never loads the API client.
import { balanceOf, type Balance } from "./balanceRecord";

/** The fragment's name: `#balance=<payload>.<code>` (D2). */
export const BALANCE_FRAGMENT = "balance";

/** HKDF's salt and info for the check code's key (D3). */
const SALT = "tarjeta-papa";
const INFO = "notification balance check code v1";

/** The code is base64url without padding of a 32-byte HMAC-SHA-256: always 43 characters (D2). */
const CODE_LENGTH = 43;

/** `balance=` followed by the payload and the code, both base64url without padding, and nothing else. */
const FRAGMENT_SHAPE = new RegExp(
  `^${BALANCE_FRAGMENT}=([A-Za-z0-9_-]+)\\.([A-Za-z0-9_-]{${CODE_LENGTH}})$`,
);

/** Whether `address`'s fragment is a balance's (`#balance=…`), whatever its code: the page removes such a fragment. */
export function carriesBalance(address: string): boolean {
  return fragmentOf(address)?.startsWith(`${BALANCE_FRAGMENT}=`) ?? false;
}

/**
 * The balance in `address`'s fragment when its code verifies under `secret` (D3) and `balanceOf` accepts its shape;
 * else null. Never rejects.
 */
export async function balanceInAddress(
  address: string,
  secret: ArrayBuffer | null,
): Promise<Balance | null> {
  if (secret === null) return null;

  const parts = FRAGMENT_SHAPE.exec(fragmentOf(address) ?? "");
  const payload = parts?.[1];
  const code = parts?.[2];
  if (payload === undefined || code === undefined) return null;

  try {
    const payloadBytes = fromBase64Url(payload);
    const codeBytes = fromBase64Url(code);
    if (payloadBytes === null || codeBytes === null) return null;
    if (!(await verifies(payload, codeBytes, secret))) return null;

    const json = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    return balanceOf(JSON.parse(json));
  } catch {
    // A browser that refuses the crypto, a payload that is not UTF-8 or not JSON: no balance this time (Error model).
    return null;
  }
}

/** The balance read last, `readAt` compared as moments; null for none. */
export function newest(balances: readonly Balance[]): Balance | null {
  let found: Balance | null = null;
  for (const balance of balances)
    if (found === null || Date.parse(balance.readAt) > Date.parse(found.readAt))
      found = balance;
  return found;
}

/** The text after the address's first `#`, or null when it has none. */
function fragmentOf(address: string): string | null {
  const hash = address.indexOf("#");
  return hash === -1 ? null : address.slice(hash + 1);
}

/**
 * Whether `code` is HMAC-SHA-256 of the payload's text under the key HKDF-SHA-256 derives from `secret` (D3); WebCrypto's
 * `verify` compares in constant time.
 */
async function verifies(
  payload: string,
  code: Uint8Array<ArrayBuffer>,
  secret: ArrayBuffer,
): Promise<boolean> {
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
    ["verify"],
  );
  return subtle.verify("HMAC", hmacKey, code, ascii.encode(payload));
}

/**
 * The bytes of base64url text without padding, or null when the text is not canonical base64url (a length no encoding
 * gives, or unused bits set in its last character): one text per value.
 */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (text.length % 4 === 1) return null;
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return toBase64Url(bytes) === text ? bytes : null;
}

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
