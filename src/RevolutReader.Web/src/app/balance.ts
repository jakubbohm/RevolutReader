import { api, askTheApi } from "../api/client";
import type { components } from "../api/schema";

/** The balance as the API answers it and as the phone keeps it (c009 design.md D1, D4): `readAt` in ISO 8601. */
export type Balance =
  components["schemas"]["RevolutReaderApiAccountBalanceResponse"];

/** What a balance read came to (c009 design.md D1, D2, D5). */
export type BalanceRead =
  | { kind: "read"; balance: Balance }
  /** The bank problems, told apart by their `type`, exactly. */
  | { kind: "bank access expired" }
  | { kind: "bank rate limited" }
  | { kind: "bank unavailable" }
  /** 401. */
  | { kind: "signed out" }
  /** 403, with the email its problem names. */
  | { kind: "refused"; email: string | null }
  /** Any other answer, or a body that is not a balance. */
  | { kind: "unexpected" }
  /** The phone says it is offline (nothing sent), no answer came, or the read was aborted. */
  | { kind: "offline" };

/** The `type` of a bank problem, as the API description lists them (C13's `BankProblem`). */
type BankProblemType =
  components["schemas"]["RevolutReaderApiAccountBankProblem"]["type"];

/**
 * What each bank problem means for the read, by its `type`, compared exactly as written: never resolved to an address,
 * and never the status alone, which two of them share and the hosting proxy answers too (c009 design.md D1). Keyed by
 * the generated type's literals, so a type renamed on either side fails the type check.
 */
const readOfBankProblem: Record<BankProblemType, BalanceRead> = {
  "/problems/bank-access-expired": { kind: "bank access expired" },
  "/problems/bank-rate-limited": { kind: "bank rate limited" },
  "/problems/bank-unavailable": { kind: "bank unavailable" },
};

const UNEXPECTED: BalanceRead = { kind: "unexpected" };

/**
 * Reads the balance, `GET /api/balance` (c009 design.md D1, D2, D5); never throws.
 * - The phone says it is offline: nothing is sent, and the read is offline.
 * - 200 with the balance's shape: the balance, `readAt` as answered; any other 200 body is unexpected.
 * - A bank problem, by its `type` (`readOfBankProblem`).
 * - 401: signed out; 403: refused, with the email its problem names, or none.
 * - No answer (the request failed, or `signal` aborted it): offline. An answer with an error status never is: any other
 *   status, a plain-text hosting page among them, is unexpected.
 *
 * Offline, 401, 403 and a success that is not JSON are every read's (`askTheApi`); the rest are the balance's own.
 */
export async function readBalance(options?: {
  signal?: AbortSignal;
}): Promise<BalanceRead> {
  const answer = await askTheApi(() =>
    api.GET("/api/balance", { signal: options?.signal }),
  );
  if (answer.kind !== "answer") return answer;

  if (answer.status === 200) {
    const balance = balanceOf(answer.data);
    return balance === null ? UNEXPECTED : { kind: "read", balance };
  }

  const problemType = typeOf(answer.error);
  return problemType !== null && isBankProblemType(problemType)
    ? readOfBankProblem[problemType]
    : UNEXPECTED;
}

/**
 * The balance, when the value has its shape: the amount and the rate as numbers, the read time as a date and time; only
 * those three. For the API's answer and for the record the phone keeps (c009 design.md D4).
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

/** The problem's `type`, when the body is an object with one as text; `null` otherwise (a plain-text page, say). */
function typeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("type" in body))
    return null;
  return typeof body.type === "string" ? body.type : null;
}

function isBankProblemType(type: string): type is BankProblemType {
  return Object.hasOwn(readOfBankProblem, type);
}
