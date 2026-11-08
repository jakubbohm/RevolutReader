import { expect, test } from "vitest";
import {
  answerWith,
  nobodySignedIn,
  refused,
  signedIn,
  type WhoIsSignedIn,
} from "../test/server";
import { readSession } from "./session";

// What the server answers to who is signed in, read as the session the page picks its screen from (c007 design.md D3,
// D5). The fake server (src/test/server.ts) answers the app's API client; every address here is made up.

test("Nobody signed in reads as signed out", async () => {
  answerWith({ whoIsSignedIn: nobodySignedIn });

  expect(await readSession()).toEqual({
    kind: "signed-out",
    justSignedOut: false,
  });
});

test("A refused account reads as refused, with its email", async () => {
  answerWith({ whoIsSignedIn: refused("cizi.ucet@example.com") });

  expect(await readSession()).toEqual({
    kind: "refused",
    email: "cizi.ucet@example.com",
  });
});

test("A refused answer without an email reads as refused, without one", async () => {
  answerWith({ whoIsSignedIn: refused(null) });

  expect(await readSession()).toEqual({ kind: "refused", email: null });
});

test("A signed-in account reads as signed in, with its name and email", async () => {
  answerWith({
    whoIsSignedIn: signedIn("Lucie Nováková", "lucie@example.com"),
  });

  expect(await readSession()).toEqual({
    kind: "signed-in",
    name: "Lucie Nováková",
    email: "lucie@example.com",
  });
});

const noUsableAnswer: { label: string; answer: WhoIsSignedIn }[] = [
  { label: "a server error", answer: { kind: "server error" } },
  { label: "no answer, offline", answer: { kind: "no connection" } },
];

test.each(noUsableAnswer)(
  "A server error or no answer reads as unknown: $label",
  async ({ answer }) => {
    answerWith({ whoIsSignedIn: answer });

    expect(await readSession()).toEqual({ kind: "unknown" });
  },
);
