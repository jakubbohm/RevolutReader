import { expect, test } from "vitest";
import { transaction } from "../test/server";
import { listShown, type ListProblem } from "./listState";
import { byDay, type ListState } from "./transactionList";

// What the list's place on the account screen shows, from what is known (c010 design.md D7, D8). Since the join with
// C7a's screen (D8), the screen's banner and its offline note come from the screen's state (`screenState`), never from
// the list. The transactions and the rate are made up.

test("While the newest page is read and the server is awake, the list shows placeholders", () => {
  expect(listShown({ list: null, reading: true, problem: null }).shown).toEqual(
    { body: "placeholder" },
  );
});

// D2: the newest page fails as a whole, so a failed one brings no transactions; the list kept when one is shown (the
// spec's "keep any list it shows and add one banner naming the case"; the banner is the screen's, D8).

const problems: ListProblem[] = [
  { kind: "bank access expired" },
  { kind: "bank rate limited" },
  { kind: "bank unavailable" },
  { kind: "unexpected" },
];

test.each(problems)(
  "A failed newest page with no list shows no list: $kind",
  (problem) => {
    expect(listShown({ list: null, reading: false, problem }).shown).toEqual({
      body: "none",
    });
  },
);

test("A failed newest page keeps a list already shown", () => {
  const list: ListState = {
    days: byDay([
      transaction("card", -12.3, "2026-11-18", {
        counterparty: "Pekárna U Lípy",
      }),
    ]),
    nextBefore: "2026-10-20",
    older: "idle",
  };

  expect(
    listShown({
      list,
      reading: false,
      problem: { kind: "bank unavailable" },
      rate: 24.3,
      rateDate: "2026-11-08",
    }).shown,
  ).toEqual({ body: "list", list, rate: 24.3, rateDate: "2026-11-08" });
});

// D8: offline (nothing sent, or no answer within 60 s) with no list leaves the list's place empty, as any failed newest
// page does: the offline note in that place is the screen's (`screenState`), not the list's.

test("An offline read with no list shows no list", () => {
  expect(
    listShown({ list: null, reading: false, problem: { kind: "offline" } })
      .shown,
  ).toEqual({ body: "none" });
});
