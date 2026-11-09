import type { ListState } from "./transactionList";

/** What went wrong with the newest page, as the list tells it (c010 design.md D7). */
export type ListProblem =
  | { kind: "bank access expired" }
  | { kind: "bank rate limited" }
  | { kind: "bank unavailable" }
  | { kind: "unexpected" }
  | { kind: "offline" };

/** What the list's place on the account screen shows (c010 design.md D7). */
export type ListShown =
  | { body: "placeholder" }
  | { body: "empty" }
  | { body: "offline note" }
  | { body: "list"; list: ListState; rate: number; rateDate: string }
  | { body: "none" };

/**
 * What the list shows and which banner goes with it, from what is known (c010 design.md D7); pure, extended at the join
 * (D8). While the newest page is read and no list is on screen yet, its placeholders; nothing otherwise so far.
 */
export function listShown(facts: {
  list: ListState | null;
  reading: boolean;
  problem: ListProblem | null;
  rate?: number;
  rateDate?: string;
}): { shown: ListShown; banner: ListProblem | null } {
  if (facts.reading && facts.list === null)
    return { shown: { body: "placeholder" }, banner: null };

  return { shown: { body: "none" }, banner: null };
}
