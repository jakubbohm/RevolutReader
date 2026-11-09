import type { components } from "../api/schema";

/** A failure at the bank, as every bank read tells it: the balance's and the transactions' (c009 design.md D5; c010 D7). */
export type BankProblem =
  | { kind: "bank access expired" }
  | { kind: "bank rate limited" }
  | { kind: "bank unavailable" };

/** The `type` of a bank problem, as the API description lists them (C13's `BankProblem`). */
type BankProblemType =
  components["schemas"]["RevolutReaderApiAccountBankProblem"]["type"];

/**
 * What each bank problem means for a read, by its `type`. Keyed by the generated type's literals, so a type renamed on
 * either side fails the type check.
 */
const BANK_PROBLEMS: Record<BankProblemType, BankProblem> = {
  "/problems/bank-access-expired": { kind: "bank access expired" },
  "/problems/bank-rate-limited": { kind: "bank rate limited" },
  "/problems/bank-unavailable": { kind: "bank unavailable" },
};

/**
 * The bank problem an error answer's body names by its `type`, compared exactly as written: never resolved to an
 * address, and never the status alone, which two of them share and the hosting proxy answers too (c009 design.md D1;
 * c010 D7). `null` when it names none: a body that is not an object with a `type` as text (a plain-text page, say), or
 * any other `type`.
 */
export function bankProblemOf(body: unknown): BankProblem | null {
  const type = typeOf(body);
  return type !== null && isBankProblemType(type) ? BANK_PROBLEMS[type] : null;
}

/** The problem's `type`, when the body is an object with one as text; `null` otherwise (a plain-text page, say). */
function typeOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || !("type" in body))
    return null;
  return typeof body.type === "string" ? body.type : null;
}

function isBankProblemType(type: string): type is BankProblemType {
  return Object.hasOwn(BANK_PROBLEMS, type);
}
