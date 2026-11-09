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

/** What is known about the list: a list comes with the koruna rate and its date its page carried. */
export type ListFacts = {
  reading: boolean;
  problem: ListProblem | null;
} & (
  | { list: null; rate?: number; rateDate?: string }
  | { list: ListState; rate: number; rateDate: string }
);

/**
 * What the list shows and which banner goes with it, from what is known (c010 design.md D7); pure, extended at the join
 * (D8). A list once read stays on screen, unless it has no transactions and nothing older is kept: then it says that
 * there are none yet; while the newest page is read and no list is on screen yet, its placeholders; nothing otherwise
 * so far.
 */
export function listShown(facts: ListFacts): {
  shown: ListShown;
  banner: ListProblem | null;
} {
  if (isEmpty(facts.list)) return { shown: { body: "empty" }, banner: null };
  if (facts.list !== null)
    return {
      shown: {
        body: "list",
        list: facts.list,
        rate: facts.rate,
        rateDate: facts.rateDate,
      },
      banner: null,
    };
  if (facts.reading) return { shown: { body: "placeholder" }, banner: null };

  return { shown: { body: "none" }, banner: null };
}

/** Whether the list is read and has nothing to show: no transactions on the newest page, and nothing older kept. */
function isEmpty(list: ListState | null): boolean {
  return list !== null && list.days.length === 0 && list.nextBefore === null;
}
