import { expect, test } from "vitest";
import { realTurn } from "../test/clock";
import {
  answerWith,
  balance,
  bankAccessExpired,
  bankRateLimited,
  bankUnavailable,
  goOffline,
  hostingErrorPage,
  jsonBody,
  noAnswerYet,
  noConnection,
  nobodySignedIn,
  problemOf,
  refused,
  requests,
  timeline,
  unreadable,
  type BalanceAnswer,
} from "../test/server";
import { readBalance } from "./balance";

// What the server answers to a balance read, read as one kind the screen picks its state from (c009 design.md D1, D2,
// D5): the balance; the bank's three problems, told apart by their `type` exactly; signed out and refused; offline when
// the phone says so (nothing sent), when no answer came, or when the read was aborted; anything else unexpected. The
// fake server (src/test/server.ts) answers the app's API client; the amounts and addresses are made up.

const READ_AT = new Date("2026-11-10T08:58:00Z");

test("A balance answer reads as the balance", async () => {
  answerWith({ balance: balance(286.4, { readAt: READ_AT, czkPerEur: 24.3 }) });

  expect(await readBalance()).toEqual({
    kind: "read",
    balance: {
      amount: 286.4,
      readAt: "2026-11-10T08:58:00+00:00",
      czkPerEur: 24.3,
    },
  });
});

const notABalance: { label: string; answer: BalanceAnswer }[] = [
  { label: "another object", answer: unreadable },
  {
    label: "the amount as text",
    answer: jsonBody({
      amount: "286.40",
      readAt: "2026-11-10T08:58:00+00:00",
      czkPerEur: 24.3,
    }),
  },
  {
    label: "no read time",
    answer: jsonBody({ amount: 286.4, czkPerEur: 24.3 }),
  },
  {
    label: "no rate",
    answer: jsonBody({ amount: 286.4, readAt: "2026-11-10T08:58:00+00:00" }),
  },
  { label: "null", answer: jsonBody(null) },
];

test.each(notABalance)(
  "A success whose body is not a balance reads as unexpected: $label",
  async ({ answer }) => {
    answerWith({ balance: answer });

    expect(await readBalance()).toEqual({ kind: "unexpected" });
  },
);

test("The access-expired problem reads as bank access expired", async () => {
  answerWith({ balance: bankAccessExpired });

  expect(await readBalance()).toEqual({ kind: "bank access expired" });
});

test("The rate-limited problem reads as bank rate limited", async () => {
  answerWith({ balance: bankRateLimited });

  expect(await readBalance()).toEqual({ kind: "bank rate limited" });
});

test("The bank-unavailable problem reads as bank unavailable", async () => {
  answerWith({ balance: bankUnavailable });

  expect(await readBalance()).toEqual({ kind: "bank unavailable" });
});

const otherTypesOf503: { label: string; type: string }[] = [
  {
    label: "RFC 9110's, as for any 503",
    type: "https://tools.ietf.org/html/rfc9110#section-15.6.4",
  },
  {
    label: "the bank-unavailable path resolved to an address",
    type: "https://tarjeta.example.net/problems/bank-unavailable",
  },
];

test.each(otherTypesOf503)(
  "A 503 with any other type reads as unexpected: $label",
  async ({ type }) => {
    answerWith({ balance: problemOf(503, "Service Unavailable", type) });

    expect(await readBalance()).toEqual({ kind: "unexpected" });
  },
);

test("A 401 reads as signed out, and a 403 as refused with the email its problem names", async () => {
  answerWith({ balance: nobodySignedIn });
  expect(await readBalance()).toEqual({ kind: "signed out" });

  answerWith({ balance: refused("cizi.ucet@example.com") });
  expect(await readBalance()).toEqual({
    kind: "refused",
    email: "cizi.ucet@example.com",
  });
});

test("A hosting error page in plain text reads as unexpected", async () => {
  answerWith({ balance: hostingErrorPage });

  expect(await readBalance()).toEqual({ kind: "unexpected" });
});

test("With the phone offline, nothing is sent and the read is offline", async () => {
  answerWith({ balance: balance(286.4) });
  goOffline();

  expect(await readBalance()).toEqual({ kind: "offline" });
  expect(requests()).toEqual([]);
});

test("A request that gets no answer reads as offline", async () => {
  answerWith({ balance: noConnection });

  expect(await readBalance()).toEqual({ kind: "offline" });
});

test("An aborted read reads as offline", async () => {
  answerWith({ balance: noAnswerYet });
  const read = new AbortController();

  const reading = readBalance({ signal: read.signal });
  await realTurn();
  read.abort();

  expect(await reading).toEqual({ kind: "offline" });
  expect(timeline()).toContain("aborted GET /api/balance");
});
