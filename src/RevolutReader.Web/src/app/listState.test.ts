import { expect, test } from "vitest";
import { transaction } from "../test/server";
import { listShown, type ListProblem } from "./listState";
import { byDay, type ListState } from "./transactionList";

// What the list's place on the account screen shows, and the banner with it, from what is known (c010 design.md D7):
// the list's own states before the join with C7a's screen (D8), where the server counts as awake. The transactions
// and the rate are made up.

test("While the newest page is read and the server is awake, the list shows placeholders", () => {
  expect(listShown({ list: null, reading: true, problem: null })).toEqual({
    shown: { body: "placeholder" },
    banner: null,
  });
});

// D2: the newest page fails as a whole, so a failed one brings no transactions; its problem is the banner (D7), with
// the list kept when one is shown (the spec's "keep any list it shows and add one banner naming the case").

const problemsWithABanner: ListProblem[] = [
  { kind: "bank access expired" },
  { kind: "bank rate limited" },
  { kind: "bank unavailable" },
  { kind: "unexpected" },
];

test.each(problemsWithABanner)(
  "A failed newest page with no list shows no list and its problem as the banner: $kind",
  (problem) => {
    expect(listShown({ list: null, reading: false, problem })).toEqual({
      shown: { body: "none" },
      banner: problem,
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
    }),
  ).toEqual({
    shown: { body: "list", list, rate: 24.3, rateDate: "2026-11-08" },
    banner: { kind: "bank unavailable" },
  });
});

// D7: offline (nothing sent, or no answer within 60 s) is the list's note, never a banner.

test("An offline read shows the note and no banner", () => {
  expect(
    listShown({ list: null, reading: false, problem: { kind: "offline" } }),
  ).toEqual({
    shown: { body: "offline note" },
    banner: null,
  });
});
