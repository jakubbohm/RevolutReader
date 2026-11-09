import { expect, test } from "vitest";
import { listShown } from "./listState";

// What the list's place on the account screen shows, and the banner with it, from what is known (c010 design.md D7):
// the list's own states before the join with C7a's screen (D8), where the server counts as awake.

test("While the newest page is read and the server is awake, the list shows placeholders", () => {
  expect(listShown({ list: null, reading: true, problem: null })).toEqual({
    shown: { body: "placeholder" },
    banner: null,
  });
});
