import { expect, test } from "vitest";
import { realTurn } from "../test/clock";
import {
  answerWith,
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
  serverError,
  transaction,
  transactionsPage,
  unreadable,
  wifiLoginPage,
  type Answers,
  type ServerAnswers,
  type TransactionsAnswer,
} from "../test/server";
import {
  readNewestTransactions,
  readOlderTransactions,
  type TransactionPage,
  type TransactionsRead,
} from "./transactions";

// What the server answers to a read of the transactions, read as one kind the list picks its state from (c010
// design.md D2, D7, D10): the page; the bank's three problems, told apart by their `type` exactly; signed out and
// refused; offline when the phone says so (nothing sent), when no answer came, or when the read was aborted; anything
// else unexpected. Both reads, the newest page and an older one, unless a rule is the newest page's alone (the bank's
// problems come only from its live read). The fake server (src/test/server.ts) answers the app's API client; the
// transactions, amounts and addresses are made up.

/** One of the two reads: how to make it, how the server answers it, and the request it sends. */
interface Reader {
  name: string;
  read: (options?: { signal?: AbortSignal }) => Promise<TransactionsRead>;
  answering: (answer: Answers<TransactionsAnswer>) => ServerAnswers;
  request: string;
}

/** The day an older page is asked before, in these tests. */
const BEFORE = "2026-10-20";

const NEWEST: Reader = {
  name: "the newest page",
  read: (options) => readNewestTransactions(options),
  answering: (answer) => ({ transactions: answer }),
  request: "GET /api/transactions",
};

const OLDER: Reader = {
  name: "an older page",
  read: (options) => readOlderTransactions(BEFORE, options),
  // The fake server answers 404 for any other day, so a request for the wrong day never reads as this answer.
  answering: (answer) => ({ olderTransactions: { [BEFORE]: answer } }),
  request: `GET /api/transactions/older?before=${BEFORE}`,
};

const READERS: readonly Reader[] = [NEWEST, OLDER];

/** Each case, once for each read. */
function onBothReads<Case extends { label: string }>(
  cases: readonly Case[],
): (Case & { reader: Reader })[] {
  return READERS.flatMap((reader) =>
    cases.map((each) => ({
      ...each,
      label: `${reader.name}, ${each.label}`,
      reader,
    })),
  );
}

const pages: {
  label: string;
  reader: Reader;
  answer: TransactionsAnswer;
  page: TransactionPage;
}[] = [
  {
    label: "the newest page",
    reader: NEWEST,
    answer: transactionsPage(
      [
        transaction("card", -8.9, "2026-11-19", {
          counterparty: "Kavárna Na Rohu",
          details: ["Praha 1"],
          pending: true,
        }),
        transaction("topup", 50, "2026-11-18"),
      ],
      { olderBefore: "2026-10-20", czkPerEur: 24.3, rateDate: "2026-11-08" },
    ),
    page: {
      transactions: [
        {
          date: "2026-11-19",
          amount: -8.9,
          currency: "EUR",
          pending: true,
          counterparty: "Kavárna Na Rohu",
          details: ["Praha 1"],
          kind: "card",
        },
        {
          date: "2026-11-18",
          amount: 50,
          currency: "EUR",
          pending: false,
          counterparty: null,
          details: [],
          kind: "topup",
        },
      ],
      olderBefore: "2026-10-20",
      czkPerEur: 24.3,
      rateDate: "2026-11-08",
    },
  },
  {
    label: "an older page",
    reader: OLDER,
    answer: transactionsPage(
      [
        transaction("refund", 7.5, "2026-10-15", {
          counterparty: "Knihkupectví Luxor",
          details: ["Vrácení zboží"],
        }),
        transaction("atm", -40, "2026-10-14", { details: ["Bankomat"] }),
      ],
      { olderBefore: null, czkPerEur: 24.3, rateDate: "2026-11-08" },
    ),
    page: {
      transactions: [
        {
          date: "2026-10-15",
          amount: 7.5,
          currency: "EUR",
          pending: false,
          counterparty: "Knihkupectví Luxor",
          details: ["Vrácení zboží"],
          kind: "refund",
        },
        {
          date: "2026-10-14",
          amount: -40,
          currency: "EUR",
          pending: false,
          counterparty: null,
          details: ["Bankomat"],
          kind: "atm",
        },
      ],
      olderBefore: null,
      czkPerEur: 24.3,
      rateDate: "2026-11-08",
    },
  },
];

test.each(pages)(
  "A 200 page reads as the page: $label",
  async ({ reader, answer, page }) => {
    answerWith(reader.answering(answer));

    expect(await reader.read()).toEqual({ kind: "read", page });
    expect(requests()).toEqual([reader.request]);
  },
);

const bankProblems: {
  label: string;
  answer: TransactionsAnswer;
  reads: TransactionsRead;
}[] = [
  {
    label: "the access-expired problem",
    answer: bankAccessExpired,
    reads: { kind: "bank access expired" },
  },
  {
    label: "the rate-limited problem",
    answer: bankRateLimited,
    reads: { kind: "bank rate limited" },
  },
  {
    label: "the bank-unavailable problem",
    answer: bankUnavailable,
    reads: { kind: "bank unavailable" },
  },
  {
    label: "a 503 with RFC 9110's type, as for any 503",
    answer: problemOf(
      503,
      "Service Unavailable",
      "https://tools.ietf.org/html/rfc9110#section-15.6.4",
    ),
    reads: { kind: "unexpected" },
  },
  {
    label: "a 503 with the bank-unavailable path resolved to an address",
    answer: problemOf(
      503,
      "Bank unavailable",
      "https://tarjeta.example.net/problems/bank-unavailable",
    ),
    reads: { kind: "unexpected" },
  },
  {
    label: "a 503 with the bank-unavailable path in other letter case",
    answer: problemOf(503, "Bank unavailable", "/problems/Bank-Unavailable"),
    reads: { kind: "unexpected" },
  },
  {
    label: "a 429 with RFC 6585's type, as for any 429",
    answer: problemOf(
      429,
      "Too Many Requests",
      "https://tools.ietf.org/html/rfc6585#section-4",
    ),
    reads: { kind: "unexpected" },
  },
];

test.each(bankProblems)(
  "Each bank problem reads as its kind by its exact `type`: $label",
  async ({ answer, reads }) => {
    answerWith(NEWEST.answering(answer));

    expect(await NEWEST.read()).toEqual(reads);
  },
);

const signInAnswers = onBothReads<{
  label: string;
  answer: TransactionsAnswer;
  reads: TransactionsRead;
}>([
  {
    label: "401",
    answer: nobodySignedIn,
    reads: { kind: "signed out" },
  },
  {
    label: "403 naming the email",
    answer: refused("cizi.ucet@example.com"),
    reads: { kind: "refused", email: "cizi.ucet@example.com" },
  },
  {
    label: "403 naming none",
    answer: refused(null),
    reads: { kind: "refused", email: null },
  },
]);

test.each(signInAnswers)(
  "A 401 reads as signed out and a 403 as refused, naming the email: $label",
  async ({ reader, answer, reads }) => {
    answerWith(reader.answering(answer));

    expect(await reader.read()).toEqual(reads);
  },
);

/** A page's fields, each test below changing one of them. */
const PAGE_BODY = {
  transactions: [
    {
      date: "2026-11-19",
      amount: -8.9,
      currency: "EUR",
      pending: false,
      counterparty: "Kavárna Na Rohu",
      details: [],
      kind: "card",
    },
  ],
  olderBefore: null,
  czkPerEur: 24.3,
  rateDate: "2026-11-08",
};

const notAPage = onBothReads<{ label: string; answer: TransactionsAnswer }>([
  { label: "a server error (500)", answer: serverError },
  {
    label: "an address the server does not know (404)",
    answer: problemOf(
      404,
      "Not Found",
      "https://tools.ietf.org/html/rfc9110#section-15.5.5",
    ),
  },
  {
    label: "a hosting error page in plain text (502)",
    answer: hostingErrorPage,
  },
  { label: "another object", answer: unreadable },
  { label: "null", answer: jsonBody(null) },
  {
    label: "the transactions not a list",
    answer: jsonBody({ ...PAGE_BODY, transactions: {} }),
  },
  {
    label: "a transaction's amount as text",
    answer: jsonBody({
      ...PAGE_BODY,
      transactions: [{ ...PAGE_BODY.transactions[0], amount: "-8.90" }],
    }),
  },
  {
    label: "a transaction without its details",
    answer: jsonBody({
      ...PAGE_BODY,
      transactions: [{ ...PAGE_BODY.transactions[0], details: undefined }],
    }),
  },
  {
    label: "no koruna rate",
    answer: jsonBody({ ...PAGE_BODY, czkPerEur: undefined }),
  },
  {
    label: "an HTML page, not JSON (a public Wi-Fi's login page)",
    answer: wifiLoginPage,
  },
]);

test.each(notAPage)(
  "Any other status, a hosting error page in plain text or a body that is not a page reads as unexpected: $label",
  async ({ reader, answer }) => {
    answerWith(reader.answering(answer));

    expect(await reader.read()).toEqual({ kind: "unexpected" });
  },
);

test.each(READERS)(
  "A read while the phone says it is offline sends nothing and reads as offline: $name",
  async (reader) => {
    answerWith(reader.answering(transactionsPage([])));
    goOffline();

    expect(await reader.read()).toEqual({ kind: "offline" });
    expect(requests()).toEqual([]);
  },
);

const noAnswer = onBothReads<{
  label: string;
  answer: TransactionsAnswer;
  meanwhile: (request: AbortController) => void;
}>([
  {
    label: "the request fails",
    answer: noConnection,
    meanwhile: () => {},
  },
  {
    label: "the read is aborted before an answer comes",
    answer: noAnswerYet,
    meanwhile: (request) => {
      request.abort();
    },
  },
]);

test.each(noAnswer)(
  "A request that fails without an answer reads as offline: $label",
  async ({ reader, answer, meanwhile }) => {
    answerWith(reader.answering(answer));
    const request = new AbortController();

    const reading = reader.read({ signal: request.signal });
    await realTurn();
    meanwhile(request);

    expect(await reading).toEqual({ kind: "offline" });
  },
);
