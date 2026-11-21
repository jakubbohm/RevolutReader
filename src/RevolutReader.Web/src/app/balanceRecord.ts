// The balance's shape, apart from the API client (c015 design.md D5): the service worker loads this module, through
// storedBalance.ts, and has no `window`, so its only import is the schema's type, erased at build. balance.ts re-exports
// both, so its importers stay as they are.
import type { components } from "../api/schema";

/** The balance as the API answers it and as the phone keeps it (c009 design.md D1, D4): `readAt` in ISO 8601. */
export type Balance =
  components["schemas"]["RevolutReaderApiAccountBalanceResponse"];

/**
 * The balance, when the value has its shape: the amount and the rate as numbers, the read time as a date and time; only
 * those three. For the API's answer, the record the phone keeps (c009 design.md D4) and a push's balance (c015
 * design.md D2).
 */
export function balanceOf(body: unknown): Balance | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("amount" in body && "readAt" in body && "czkPerEur" in body))
    return null;

  const { amount, readAt, czkPerEur } = body;
  if (typeof amount !== "number" || typeof czkPerEur !== "number") return null;
  if (typeof readAt !== "string" || Number.isNaN(Date.parse(readAt)))
    return null;

  return { amount, readAt, czkPerEur };
}
