import { act } from "@testing-library/react";
import { realTurn } from "./clock";

/**
 * The server and the address bar, as the app's tests see them (c007 design.md § How each scenario is verified): a
 * hand-written fake `fetch` that answers the app's API requests, a recording `location` that notes where the app
 * navigates instead of leaving the page (jsdom does not navigate), and the phone's network. All are installed once, by
 * `setup.ts`, before any module of the app loads: the API client takes `fetch` when it is created (openapi-fetch reads
 * `globalThis.fetch` in `createClient`), so a stub put in place later would never be called. Each test then says what
 * the server answers (`answerWith`), and `resetFakeServer` forgets it after the test.
 *
 * Everything the app does goes into one timeline, in order:
 * - `request GET /api/me` when the app sends a request (method, then path and query on the page's own origin);
 * - `answer GET /api/me` when the server's answer reaches the app, or `failure GET /api/me` when the request fails;
 * - `aborted GET /api/me` when the app aborted the request (its `AbortSignal`) before the answer came;
 * - `navigation /api/auth/login` when the app sets its location (`location.assign`, `location.replace`, the `href`
 *   setter, or assigning `location` itself), with the target's path and query on the page's own origin.
 * An answer reaches the app on a later task, never at once (`realTurn`), so the timeline shows whether the app waited
 * for it; an answer with `after: <ms>` comes that much later, on the test's clock (`./clock.ts`), or on the real one
 * without it. `document.location` is jsdom's own and is not recorded.
 *
 * With the test clock (`startTestClock`), every wait here runs on it: `after`, and the app's own timers. Move it with
 * `timePasses`; an answer without `after` arrives on `timePasses(0)`. Without the test clock, answers arrive on their
 * own and `findBy…` waits for them.
 *
 * The answers to the transactions (c010 design.md D10, § Public API sketch: the test kit) sit in their own blocks,
 * marked "c010". The vocabulary they share with C7a's kit (`Trouble`, `Delayed`, `Answers`, `after`, the bank problems,
 * `KORUNA_RATE`, the network and the abortable `fetch`) is written as C7a writes it (c010 design.md D13), so the hand
 * merge at the join keeps one copy.
 */

/** What the server answers when the app asks who is signed in, `GET /api/me` (design.md D3). */
export type WhoIsSignedIn =
  /** 401 with the problem description `Unauthorized`. */
  | { kind: "nobody" }
  /** 403 with the problem description `Forbidden`, naming the account's email in its `email` extension unless `null`. */
  | { kind: "refused"; email: string | null }
  /** 200 with exactly `{ name, email }`. */
  | { kind: "signed in"; name: string; email: string }
  /** 500 with the problem description `Internal Server Error`. */
  | { kind: "server error" }
  /** The request fails, as when the phone is offline. */
  | { kind: "no connection" }
  /** The request stays open, as while the server wakes up. */
  | { kind: "no answer yet" };

/** Nobody is signed in (401). Fits who is signed in and the transactions. */
export const nobodySignedIn = { kind: "nobody" } as const;

/** The server refuses the signed-in account (403), naming its email (`null`: naming none). Fits who is signed in and the transactions. */
export function refused(email: string | null): {
  kind: "refused";
  email: string | null;
} {
  return { kind: "refused", email };
}

/** This allowed user is signed in. */
export function signedIn(name: string, email: string): WhoIsSignedIn {
  return { kind: "signed in", name, email };
}

/** What the server answers to the sign-out, `POST /api/auth/logout` (design.md D2). */
export type SignOutAnswer =
  /** 204, and the login has ended: afterwards nobody is signed in. */
  | { kind: "signed out" }
  /** 500 with the problem description `Internal Server Error`; the login stays as it was. */
  | { kind: "server error" }
  /** The request fails, as when the phone is offline; the login stays as it was. */
  | { kind: "no connection" };

// ---- Shared with C7a's kit, as C7a writes it (c009 design.md D8) ----

/** What any request can meet besides its own answers. */
export type Trouble =
  /** 500 with the problem description `Internal Server Error`. */
  | { kind: "server error" }
  /** 502 with a plain-text page, as the hosting proxy answers when the app cannot be reached (c009 design.md D1). */
  | { kind: "hosting error page" }
  /** 200 with a JSON body that is not the answer's shape. */
  | { kind: "unreadable" }
  /** 200 with an HTML page, as a public Wi-Fi's login page answers any request before the user has signed in to it. */
  | { kind: "wi-fi login page" }
  /** 200 with exactly this JSON body (`jsonBody`), for a body a little off the answer's shape. */
  | { kind: "json"; body: unknown }
  /** A problem description (`application/problem+json`) with this status, title and `type` (`problemOf`). */
  | { kind: "problem"; status: number; title: string; type: string }
  /** The request fails, as when the phone is offline. */
  | { kind: "no connection" }
  /** The request stays open, as while the server wakes up; only the app's abort ends it. */
  | { kind: "no answer yet" };

/** An answer that reaches the app only `after` milliseconds, on the test's clock when it runs. */
export type Delayed<Answer> = Answer & { after?: number };

/** One answer for every request, or one per request in order, the last repeating. */
export type Answers<Answer> = Delayed<Answer> | readonly Delayed<Answer>[];

/** The koruna rate the API answers with by default: C13's constant. */
export const KORUNA_RATE = 24.3;

/** The bank's access to the account has expired (503). */
export const bankAccessExpired = { kind: "bank access expired" } as const;
/** The bank's request limit is reached (429). */
export const bankRateLimited = { kind: "bank rate limited" } as const;
/** The bank does not answer (503). */
export const bankUnavailable = { kind: "bank unavailable" } as const;
/** The server fails with an error of its own (500). */
export const serverError = { kind: "server error" } as const;
/** The hosting proxy answers with its plain-text error page (502). */
export const hostingErrorPage = { kind: "hosting error page" } as const;
/** The server answers 200 with a body that is not the answer's shape. */
export const unreadable = { kind: "unreadable" } as const;

/** A public Wi-Fi's login page answers 200 with its HTML page instead of the server. */
export const wifiLoginPage = { kind: "wi-fi login page" } as const;

/** The server answers 200 with exactly this JSON body. */
export function jsonBody(body: unknown): { kind: "json"; body: unknown } {
  return { kind: "json", body };
}

/** The server answers this problem description: this status, title and `type`, as written. */
export function problemOf(
  status: number,
  title: string,
  type: string,
): { kind: "problem"; status: number; title: string; type: string } {
  return { kind: "problem", status, title, type };
}
/** The request fails without an answer. */
export const noConnection = { kind: "no connection" } as const;
/** The request gets no answer until the app aborts it. */
export const noAnswerYet = { kind: "no answer yet" } as const;

/** `answer`, reaching the app only `ms` later. */
export function after<Answer extends object>(
  ms: number,
  answer: Answer,
): Answer & { after: number } {
  return { ...answer, after: ms };
}

// ---- c010: the transactions (design.md D10) ----

/** A transaction's kind, as the API names it: the design system's `TxKind` names (D10). */
export type TransactionKind =
  "card" | "topup" | "transfer" | "atm" | "exchange" | "refund" | "other";

/** A transaction as the API answers it: exactly these seven fields (D10). `date` is a calendar date, `yyyy-MM-dd`. */
export interface TransactionInApi {
  date: string;
  amount: number;
  currency: string;
  pending: boolean;
  counterparty: string | null;
  details: string[];
  kind: TransactionKind;
}

/** A page of transactions: 200 with exactly `{ transactions, olderBefore, czkPerEur, rateDate }` (D10). */
export interface TransactionsPage {
  kind: "transactions";
  transactions: readonly TransactionInApi[];
  /** The day before which older transactions are kept (`yyyy-MM-dd`); `null` when nothing older is kept. */
  olderBefore: string | null;
  czkPerEur: number;
  rateDate: string;
}

/**
 * What the server answers when the app reads the newest transactions, `GET /api/transactions`, or an older page,
 * `GET /api/transactions/older?before=<day>` (D10). The bank's problems come only from the newest page's live read, but
 * the fake server answers whatever a test sets.
 */
export type TransactionsAnswer =
  | TransactionsPage
  /** 503 with the problem `/problems/bank-access-expired`, `Bank access expired`. */
  | { kind: "bank access expired" }
  /** 429 with the problem `/problems/bank-rate-limited`, `Bank rate limit reached`. */
  | { kind: "bank rate limited" }
  /** 503 with the problem `/problems/bank-unavailable`, `Bank unavailable`. */
  | { kind: "bank unavailable" }
  /** 401 with the problem description `Unauthorized`: the login has ended. */
  | { kind: "nobody" }
  /** 403 with the problem description `Forbidden`, naming the account's email unless `null`. */
  | { kind: "refused"; email: string | null }
  | Trouble;

/** The rate's date the API answers with by default: C13's `KorunaRate.Date`. */
export const RATE_DATE = "2026-11-08";

/**
 * A transaction of `amount` (signed: negative for money spent) EUR on `date` (`yyyy-MM-dd`), of this kind; settled, with
 * no counterparty and no details unless `options` give them.
 */
export function transaction(
  kind: TransactionKind,
  amount: number,
  date: string,
  options: {
    counterparty?: string;
    details?: readonly string[];
    pending?: boolean;
    currency?: string;
  } = {},
): TransactionInApi {
  return {
    date,
    amount,
    currency: options.currency ?? "EUR",
    pending: options.pending ?? false,
    counterparty: options.counterparty ?? null,
    details: [...(options.details ?? [])],
    kind,
  };
}

/**
 * A page of these transactions, in this order; by default nothing older is kept (`olderBefore: null`), at C13's rate and
 * its date.
 */
export function transactionsPage(
  transactions: readonly TransactionInApi[],
  options: {
    olderBefore?: string | null;
    czkPerEur?: number;
    rateDate?: string;
  } = {},
): TransactionsPage {
  return {
    kind: "transactions",
    transactions,
    olderBefore: options.olderBefore ?? null,
    czkPerEur: options.czkPerEur ?? KORUNA_RATE,
    rateDate: options.rateDate ?? RATE_DATE,
  };
}

/**
 * The newest page the server answers when a test sets none: one made-up payment and nothing older, so a test whose
 * transactions never reached the server cannot pass on the default (it differs from every transaction a scenario names).
 */
export const DEFAULT_TRANSACTIONS = transactionsPage([
  transaction("card", -1.23, "2026-11-09", {
    counterparty: "Papírnictví Tužka",
  }),
]);

/** The server's answers for one test. */
export interface ServerAnswers {
  /**
   * `GET /api/me`. Without one, the app's question stays open, as while the server wakes up, so the app shows what it
   * shows before any answer. After a sign-out the server answers that nobody is signed in, as the real one does.
   */
  whoIsSignedIn?: WhoIsSignedIn;
  /** `POST /api/auth/logout`. Without one, the sign-out succeeds. */
  signOut?: SignOutAnswer;
  // ---- c010: the transactions ----
  /** `GET /api/transactions`. Without one, `DEFAULT_TRANSACTIONS`. */
  transactions?: Answers<TransactionsAnswer>;
  /**
   * `GET /api/transactions/older?before=<day>`, by the day asked before (`yyyy-MM-dd`), each in order. A day the test
   * gives no answers for gets 404, as an address the server does not know, so a request for the wrong day shows.
   */
  olderTransactions?: Readonly<Record<string, Answers<TransactionsAnswer>>>;
}

const SIGN_OUT = "POST /api/auth/logout";
const WHO_IS_SIGNED_IN = "GET /api/me";
// ---- c010 ----
const TRANSACTIONS = "GET /api/transactions";
const OLDER_TRANSACTIONS = "GET /api/transactions/older";

/** What the server does with one request. */
type Outcome =
  | { kind: "answer"; response: () => Response; after?: number }
  | { kind: "failure"; after?: number }
  | { kind: "no answer" };

let page = new URL("http://localhost:3000/");
let whoIsSignedIn: WhoIsSignedIn = { kind: "no answer yet" };
let signOut: SignOutAnswer = { kind: "signed out" };
// ---- c010 ----
let transactionsAnswers: readonly Delayed<TransactionsAnswer>[] = [];
let olderTransactionsAnswers: Readonly<
  Record<string, Answers<TransactionsAnswer>>
> = {};
/** How many requests of each kind the server has answered or is answering, to pick the next answer in order. */
let asked = new Map<string, number>();
let online = true;
let entries: string[] = [];
/** Counts the tests, so an answer still under way when a test ends never reaches the next test's timeline. */
let generation = 0;

/** Sets the server's answers for this test. */
export function answerWith(answers: ServerAnswers): void {
  whoIsSignedIn = answers.whoIsSignedIn ?? { kind: "no answer yet" };
  signOut = answers.signOut ?? { kind: "signed out" };
  transactionsAnswers = inOrder(answers.transactions);
  olderTransactionsAnswers = answers.olderTransactions ?? {};
  asked = new Map();
}

/** The timeline so far (see the module's description). */
export function timeline(): string[] {
  return [...entries];
}

/** The requests the app sent, in order, as `METHOD /path?query`. */
export function requests(): string[] {
  return entriesOf("request ");
}

/** Where the app navigated, in order, as `/path?query` on the page's own origin (a full address elsewhere). */
export function navigations(): string[] {
  return entriesOf("navigation ");
}

/**
 * The phone loses its network: `navigator.onLine` turns false and the window hears `offline`. Any request the app still
 * sends fails without an answer, as on a real phone; the server never sees it. Works before `renderApp`, for a phone
 * that is offline when the app opens.
 */
export function goOffline(): void {
  act(() => {
    online = false;
    window.dispatchEvent(new Event("offline"));
  });
}

/** The phone is back online: `navigator.onLine` turns true and the window hears `online`. */
export function goOnline(): void {
  act(() => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
}

/** Forgets this test's answers, timeline and network. */
export function resetFakeServer(): void {
  generation += 1;
  whoIsSignedIn = { kind: "no answer yet" };
  signOut = { kind: "signed out" };
  transactionsAnswers = [];
  olderTransactionsAnswers = {};
  asked = new Map();
  online = true;
  entries = [];
}

/** Puts the fake `fetch`, the recording `location` and the phone's network flag in place of the environment's. Called once, by `setup.ts`. */
export function installFakeServer(): void {
  page = new URL(globalThis.location.href);
  globalThis.fetch = fakeFetch;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    get: () => recordingLocation,
    set: (target: string | URL) => {
      navigate(target);
    },
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

function inOrder<Answer>(
  answers: Answers<Answer> | undefined,
): readonly Delayed<Answer>[] {
  if (answers === undefined) return [];
  return Array.isArray(answers)
    ? (answers as readonly Delayed<Answer>[])
    : [answers as Delayed<Answer>];
}

/** The answer for the next request of this kind: one per request in order, the last repeating; none without answers. */
function nextOf<Answer>(
  request: string,
  answers: readonly Delayed<Answer>[],
): Delayed<Answer> | undefined {
  const index = asked.get(request) ?? 0;
  asked.set(request, index + 1);
  return answers[Math.min(index, answers.length - 1)];
}

function entriesOf(prefix: string): string[] {
  return entries
    .filter((entry) => entry.startsWith(prefix))
    .map((entry) => entry.slice(prefix.length));
}

/** The address as the timeline writes it: path, query and fragment on the page's own origin, a full address elsewhere. */
function onThePage(url: URL): string {
  return url.origin === page.origin
    ? `${url.pathname}${url.search}${url.hash}`
    : url.href;
}

async function fakeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const isRequest = input instanceof Request;
  const url = new URL(isRequest ? input.url : String(input), page);
  const method = (
    init?.method ?? (isRequest ? input.method : "GET")
  ).toUpperCase();
  const signal = init?.signal ?? (isRequest ? input.signal : undefined);
  const request = `${method} ${onThePage(url)}`;
  const sentIn = generation;

  entries.push(`request ${request}`);
  if (signal?.aborted === true) {
    entries.push(`aborted ${request}`);
    throw abortReason(signal);
  }

  const outcome: Outcome = online ? outcomeOf(request) : { kind: "failure" };
  const ending = await arrival(outcome, signal ?? undefined);
  if (sentIn !== generation) return new Promise<Response>(() => {});

  if (ending === "aborted") {
    entries.push(`aborted ${request}`);
    throw abortReason(signal!);
  }
  if (outcome.kind !== "answer") {
    entries.push(`failure ${request}`);
    throw new TypeError("Failed to fetch");
  }

  entries.push(`answer ${request}`);
  return outcome.response();
}

/** Waits until the outcome reaches the app (a real turn, or `after` ms) or the app aborts the request. */
function arrival(
  outcome: Outcome,
  signal: AbortSignal | undefined,
): Promise<"arrived" | "aborted"> {
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      resolve("aborted");
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const arrive = (): void => {
      signal?.removeEventListener("abort", onAbort);
      resolve("arrived");
    };

    if (outcome.kind === "no answer") return;
    if (outcome.after === undefined) void realTurn().then(arrive);
    else timer = setTimeout(arrive, outcome.after);
  });
}

function abortReason(signal: AbortSignal): unknown {
  return (
    (signal.reason as unknown) ??
    new DOMException("The operation was aborted.", "AbortError")
  );
}

function outcomeOf(request: string): Outcome {
  if (request === SIGN_OUT) return signOutOutcome(signOut);
  if (request === WHO_IS_SIGNED_IN) return whoIsSignedInOutcome(whoIsSignedIn);
  // ---- c010 ----
  if (request === TRANSACTIONS)
    return transactionsOutcome(
      nextOf(request, transactionsAnswers) ?? DEFAULT_TRANSACTIONS,
    );
  if (request.startsWith(`${OLDER_TRANSACTIONS}?`))
    return olderTransactionsOutcome(request);
  return { kind: "answer", response: () => problem(404, "Not Found") };
}

function signOutOutcome(answer: SignOutAnswer): Outcome {
  switch (answer.kind) {
    case "signed out":
      return {
        kind: "answer",
        response: () => {
          whoIsSignedIn = nobodySignedIn;
          return new Response(null, { status: 204 });
        },
      };
    case "server error":
      return {
        kind: "answer",
        response: () => problem(500, "Internal Server Error"),
      };
    case "no connection":
      return { kind: "failure" };
  }
}

function whoIsSignedInOutcome(answer: WhoIsSignedIn): Outcome {
  switch (answer.kind) {
    case "nobody":
      return { kind: "answer", response: () => problem(401, "Unauthorized") };
    case "refused":
      return {
        kind: "answer",
        response: () =>
          problem(
            403,
            "Forbidden",
            answer.email === null ? {} : { email: answer.email },
          ),
      };
    case "signed in":
      return {
        kind: "answer",
        response: () =>
          Response.json({ name: answer.name, email: answer.email }),
      };
    case "server error":
      return {
        kind: "answer",
        response: () => problem(500, "Internal Server Error"),
      };
    case "no connection":
      return { kind: "failure" };
    case "no answer yet":
      return { kind: "no answer" };
  }
}

// ---- c010: the transactions' answers ----

/** An older page: the answers the test set for the day asked before, in order; 404 for a day it set none for. */
function olderTransactionsOutcome(request: string): Outcome {
  const before = new URLSearchParams(
    request.slice(OLDER_TRANSACTIONS.length),
  ).get("before");
  const answers =
    before !== null && Object.hasOwn(olderTransactionsAnswers, before)
      ? inOrder(olderTransactionsAnswers[before])
      : [];
  const answer = nextOf(request, answers);

  return answer === undefined
    ? { kind: "answer", response: () => problem(404, "Not Found") }
    : transactionsOutcome(answer);
}

function transactionsOutcome(answer: Delayed<TransactionsAnswer>): Outcome {
  switch (answer.kind) {
    case "transactions":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          Response.json({
            transactions: answer.transactions.map((each) => ({
              date: each.date,
              amount: each.amount,
              currency: each.currency,
              pending: each.pending,
              counterparty: each.counterparty,
              details: each.details,
              kind: each.kind,
            })),
            olderBefore: answer.olderBefore,
            czkPerEur: answer.czkPerEur,
            rateDate: answer.rateDate,
          }),
      };
    case "bank access expired":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          problem(503, "Bank access expired", {
            type: "/problems/bank-access-expired",
          }),
      };
    case "bank rate limited":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          problem(429, "Bank rate limit reached", {
            type: "/problems/bank-rate-limited",
          }),
      };
    case "bank unavailable":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          problem(503, "Bank unavailable", {
            type: "/problems/bank-unavailable",
          }),
      };
    case "nobody":
      return {
        kind: "answer",
        after: answer.after,
        response: () => problem(401, "Unauthorized"),
      };
    case "refused":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          problem(
            403,
            "Forbidden",
            answer.email === null ? {} : { email: answer.email },
          ),
      };
    default:
      return troubleOutcome(answer);
  }
}

// ---- Shared with C7a's kit, as C7a writes it ----

function troubleOutcome(answer: Delayed<Trouble>): Outcome {
  switch (answer.kind) {
    case "server error":
      return {
        kind: "answer",
        after: answer.after,
        response: () => problem(500, "Internal Server Error"),
      };
    case "hosting error page":
      return {
        kind: "answer",
        after: answer.after,
        // Written from a hosting proxy's usual plain-text page, not captured.
        response: () =>
          new Response("502 Bad Gateway", {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          }),
      };
    case "unreadable":
      return {
        kind: "answer",
        after: answer.after,
        response: () => Response.json({ message: "Something else" }),
      };
    case "wi-fi login page":
      return {
        kind: "answer",
        after: answer.after,
        // Written from a typical public Wi-Fi login page, made up and with no provider's name, not captured.
        response: () =>
          new Response(
            "<!DOCTYPE html><html><head><title>Wi-Fi</title></head><body><h1>Připojte se k síti</h1></body></html>",
            { headers: { "Content-Type": "text/html; charset=utf-8" } },
          ),
      };
    case "json":
      return {
        kind: "answer",
        after: answer.after,
        response: () => Response.json(answer.body),
      };
    case "problem":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          problem(answer.status, answer.title, { type: answer.type }),
      };
    case "no connection":
      return { kind: "failure", after: answer.after };
    case "no answer yet":
      return { kind: "no answer" };
  }
}

/** The RFC 9110 section ASP.NET Core names as each status's problem `type`. */
const PROBLEM_TYPE_SECTIONS: Record<number, string> = {
  401: "15.5.2",
  403: "15.5.4",
  404: "15.5.5",
  500: "15.6.1",
};

/**
 * A problem description (RFC 9457) as the API writes one: RFC 9110's `type` for the status unless an extension gives
 * the app's own, and a trace id (made up), with any extensions.
 */
function problem(
  status: number,
  title: string,
  extensions: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify({
      type: `https://tools.ietf.org/html/rfc9110#section-${PROBLEM_TYPE_SECTIONS[status]}`,
      title,
      status,
      traceId: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00",
      ...extensions,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

function navigate(target: string | URL): void {
  entries.push(`navigation ${onThePage(new URL(String(target), page))}`);
}

/** The page's address for reading, which stays put: setting it records a navigation instead of leaving the page. */
const recordingLocation = {
  get href(): string {
    return page.href;
  },
  set href(target: string) {
    navigate(target);
  },
  get origin(): string {
    return page.origin;
  },
  get protocol(): string {
    return page.protocol;
  },
  get host(): string {
    return page.host;
  },
  get hostname(): string {
    return page.hostname;
  },
  get port(): string {
    return page.port;
  },
  get pathname(): string {
    return page.pathname;
  },
  get search(): string {
    return page.search;
  },
  get hash(): string {
    return page.hash;
  },
  assign(target: string | URL): void {
    navigate(target);
  },
  replace(target: string | URL): void {
    navigate(target);
  },
  reload(): void {
    navigate(page);
  },
  toString(): string {
    return page.href;
  },
};
