import type { components } from "../api/schema";

/** A transaction's kind, as the API names it: the design system's `TxKind` names (c010 design.md D10). */
export type TransactionKind =
  components["schemas"]["RevolutReaderApiAccountTransactionKind"];

/** A transaction as the API answers it (c010 design.md D10); `date` is a calendar date, `yyyy-MM-dd`. */
export type Transaction =
  components["schemas"]["RevolutReaderApiAccountTransactionResponse"];

/** A page of transactions as the API answers it (c010 design.md D1, D10): `olderBefore` null when nothing older is kept. */
export type TransactionPage =
  components["schemas"]["RevolutReaderApiAccountTransactionPageResponse"];

/** What a read of the transactions came to (c010 design.md D2, D7). */
export type TransactionsRead =
  | { kind: "read"; page: TransactionPage }
  /** The bank problems, told apart by their `type`, exactly. */
  | { kind: "bank access expired" }
  | { kind: "bank rate limited" }
  | { kind: "bank unavailable" }
  /** 401. */
  | { kind: "signed out" }
  /** 403, with the email its problem names. */
  | { kind: "refused"; email: string | null }
  /** Any other answer, or a body that is not a page. */
  | { kind: "unexpected" }
  /** The phone says it is offline (nothing sent), no answer came, or the read was aborted. */
  | { kind: "offline" };

/**
 * Reads the newest page, `GET /api/transactions`; never throws. A stub until c010 tasks.md task 38.1 is implemented;
 * `void` keeps the unused-parameter check quiet until then.
 */
export function readNewestTransactions(options?: {
  signal?: AbortSignal;
}): Promise<TransactionsRead> {
  void options;
  throw new Error("not implemented");
}

/**
 * Reads the older page before `before` (`yyyy-MM-dd`), `GET /api/transactions/older?before=<before>`; never throws. A
 * stub until c010 tasks.md task 38.1 is implemented; `void` keeps the unused-parameter check quiet until then.
 */
export function readOlderTransactions(
  before: string,
  options?: { signal?: AbortSignal },
): Promise<TransactionsRead> {
  void before;
  void options;
  throw new Error("not implemented");
}
