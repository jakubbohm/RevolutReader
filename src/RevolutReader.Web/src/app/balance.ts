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

/**
 * Reads the balance, `GET /api/balance`; never throws. A stub until c009 tasks.md group 15 is implemented; `void` keeps
 * the unused-parameter check quiet until then.
 */
export function readBalance(options?: {
  signal?: AbortSignal;
}): Promise<BalanceRead> {
  void options;
  throw new Error("not implemented");
}
