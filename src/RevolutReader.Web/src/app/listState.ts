import type { ListState } from "./transactionList";

/**
 * What went wrong with the newest page, as the list tells it (c010 design.md D7): 401 and 403 count as unexpected until
 * the join, where C7a's screens take them (D8).
 */
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

/** The phone says it is offline, or no answer came within the cap (c010 design.md D7). */
export const LIST_OFFLINE: ListProblem = { kind: "offline" };

/**
 * What the list shows and which banner goes with it, from what is known (c010 design.md D2, D7); pure, extended at the
 * join (D8). A list once read stays on screen, through a failed read too, unless it has no transactions and nothing
 * older is kept: then it says that there are none yet. While the newest page is read and no list is on screen yet, its
 * placeholders. A failed newest page brings no transactions (D2): offline is the list's note, never a banner; any other
 * problem is the banner, kept above a list already shown, alone otherwise.
 */
export function listShown(facts: ListFacts): {
  shown: ListShown;
  banner: ListProblem | null;
} {
  const banner = bannerOf(facts.problem);

  if (isEmpty(facts.list)) return { shown: { body: "empty" }, banner };
  if (facts.list !== null)
    return {
      shown: {
        body: "list",
        list: facts.list,
        rate: facts.rate,
        rateDate: facts.rateDate,
      },
      banner,
    };
  if (facts.reading) return { shown: { body: "placeholder" }, banner: null };
  if (facts.problem?.kind === "offline")
    return { shown: { body: "offline note" }, banner: null };

  return { shown: { body: "none" }, banner };
}

/** The banner a problem makes: every problem but offline, which the list says in its note instead (D7). */
function bannerOf(problem: ListProblem | null): ListProblem | null {
  return problem?.kind === "offline" ? null : problem;
}

/** Whether the list is read and has nothing to show: no transactions on the newest page, and nothing older kept. */
function isEmpty(list: ListState | null): boolean {
  return list !== null && list.days.length === 0 && list.nextBefore === null;
}
