import { api, askTheApi, type ApiAnswer } from "../api/client";
import type { components } from "../api/schema";
import { bankProblemOf } from "./bankProblem";

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
 * Reads the newest page, `GET /api/transactions` (c010 design.md D1, D2, D7, D10); never throws. What the answer
 * means is `readOf`'s.
 */
export async function readNewestTransactions(options?: {
  signal?: AbortSignal;
}): Promise<TransactionsRead> {
  return readOf(
    await askTheApi(() =>
      api.GET("/api/transactions", { signal: options?.signal }),
    ),
  );
}

/**
 * Reads the older page before `before` (`yyyy-MM-dd`, the `olderBefore` of the page before it),
 * `GET /api/transactions/older?before=<before>` (c010 design.md D1, D10); never throws. What the answer means is
 * `readOf`'s.
 */
export async function readOlderTransactions(
  before: string,
  options?: { signal?: AbortSignal },
): Promise<TransactionsRead> {
  return readOf(
    await askTheApi(() =>
      api.GET("/api/transactions/older", {
        params: { query: { before } },
        signal: options?.signal,
      }),
    ),
  );
}

/**
 * The kinds the API names, keyed by the generated type's literals, so a kind added or renamed on either side fails the
 * type check.
 */
const KINDS: Record<TransactionKind, true> = {
  card: true,
  topup: true,
  transfer: true,
  atm: true,
  exchange: true,
  refund: true,
  other: true,
};

const UNEXPECTED: TransactionsRead = { kind: "unexpected" };

/**
 * What an answer to either read means (c010 design.md D2, D7, D10):
 * - offline (nothing sent, or no answer came, an aborted read among them), 401, 403 and a success that is not JSON are
 *   every read's (`askTheApi`);
 * - 200 with a page's shape: the page, with exactly its fields; any other 200 body is unexpected;
 * - a bank problem, by its `type` (`bankProblemOf`); only the newest page's live read answers one;
 * - any other status, a plain-text hosting page among them, is unexpected.
 */
function readOf(answer: ApiAnswer): TransactionsRead {
  if (answer.kind !== "answer") return answer;

  if (answer.status === 200) {
    const page = pageOf(answer.data);
    return page === null ? UNEXPECTED : { kind: "read", page };
  }

  return bankProblemOf(answer.error) ?? UNEXPECTED;
}

/**
 * The page, when the body has its shape: the transactions as a list of transactions, the day older ones are kept before
 * as text or null, the koruna rate as a number and its day as text; only those four.
 */
function pageOf(body: unknown): TransactionPage | null {
  if (typeof body !== "object" || body === null) return null;
  if (!(
    "transactions" in body &&
    "olderBefore" in body &&
    "czkPerEur" in body &&
    "rateDate" in body
  ))
    return null;

  const { transactions: listed, olderBefore, czkPerEur, rateDate } = body;
  if (!Array.isArray(listed)) return null;
  if (olderBefore !== null && typeof olderBefore !== "string") return null;
  if (typeof czkPerEur !== "number" || typeof rateDate !== "string")
    return null;

  const transactions: Transaction[] = [];
  for (const each of listed as unknown[]) {
    const transaction = transactionOf(each);
    if (transaction === null) return null;
    transactions.push(transaction);
  }

  return { transactions, olderBefore, czkPerEur, rateDate };
}

/**
 * The transaction, when the value has its shape (c010 design.md D10): the date, currency and counterparty as text (the
 * counterparty or null), the amount as a number, `pending` as a flag, the details as a list of text, and one of the
 * kinds the API names; only those seven.
 */
function transactionOf(value: unknown): Transaction | null {
  if (typeof value !== "object" || value === null) return null;
  if (!(
    "date" in value &&
    "amount" in value &&
    "currency" in value &&
    "pending" in value &&
    "counterparty" in value &&
    "details" in value &&
    "kind" in value
  ))
    return null;

  const { date, amount, currency, pending, counterparty, details, kind } =
    value;
  if (typeof date !== "string" || typeof currency !== "string") return null;
  if (typeof amount !== "number" || typeof pending !== "boolean") return null;
  if (counterparty !== null && typeof counterparty !== "string") return null;
  if (!isListOfText(details) || !isKind(kind)) return null;

  return { date, amount, currency, pending, counterparty, details, kind };
}

function isListOfText(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    (value as unknown[]).every((each) => typeof each === "string")
  );
}

function isKind(value: unknown): value is TransactionKind {
  return typeof value === "string" && Object.hasOwn(KINDS, value);
}
