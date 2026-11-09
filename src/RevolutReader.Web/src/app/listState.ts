import type { ListState } from "./transactionList";

/**
 * What went wrong with the newest page, as the list reports it to the account screen (c010 design.md D7, D8). 401 and
 * 403 are never among them: the account screen's sign-in and no-access screens take them (D8).
 */
export type ListProblem =
  | { kind: "bank access expired" }
  | { kind: "bank rate limited" }
  | { kind: "bank unavailable" }
  | { kind: "unexpected" }
  | { kind: "offline" };

/**
 * What the list's place on the account screen shows (c010 design.md D7, D8); `none`, nothing: a failed newest page with
 * no list.
 */
export type ListShown =
  | { body: "placeholder" }
  | { body: "empty" }
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

/** The phone says it is offline, or no answer came within the cap (c010 design.md D7). */
export const LIST_OFFLINE: ListProblem = { kind: "offline" };

/**
 * What the list's place shows, from what is known (c010 design.md D2, D7, D8); pure. A list once read stays on screen,
 * through a failed read too, unless it has no transactions and nothing older is kept: then it says that there are none
 * yet. While the newest page is read and no list is on screen yet, its placeholders. A failed newest page brings no
 * transactions (D2): with no list, nothing is in the list's place, offline too. The banner and the offline note are the
 * account screen's (`screenState`), from what the list reports to it (D8).
 */
export function listShown(facts: ListFacts): { shown: ListShown } {
  if (isEmpty(facts.list)) return { shown: { body: "empty" } };
  if (facts.list !== null)
    return {
      shown: {
        body: "list",
        list: facts.list,
        rate: facts.rate,
        rateDate: facts.rateDate,
      },
    };
  if (facts.reading) return { shown: { body: "placeholder" } };

  return { shown: { body: "none" } };
}

/** Whether the list is read and has nothing to show: no transactions on the newest page, and nothing older kept. */
function isEmpty(list: ListState | null): boolean {
  return list !== null && list.days.length === 0 && list.nextBefore === null;
}
