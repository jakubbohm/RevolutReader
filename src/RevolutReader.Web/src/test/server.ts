import { act } from "@testing-library/react";
import { realTurn } from "./clock";

/**
 * The world around the app, as its tests see it (c007 design.md § How each scenario is verified, c009 design.md D8): a
 * hand-written fake `fetch` that answers the app's requests as the server would, a recording `location` that notes where
 * the app navigates instead of leaving the page (jsdom does not navigate), the phone's network and screen, and the
 * phone's storage. `fetch` and `location` are installed once, by `setup.ts`, before any module of the app loads: the API
 * client takes `fetch` when it is created (openapi-fetch reads `globalThis.fetch` in `createClient`), so a stub put in
 * place later would never be called. Each test then says what the server answers (`answerWith`), and
 * `resetFakeServer` forgets it after the test.
 *
 * Everything the app does with the server goes into one timeline, in order:
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
 * own and `findBy…` waits for them, as in the scenarios from before C7a.
 */

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

/** What the server answers when the app asks who is signed in, `GET /api/me` (c007 design.md D3). */
export type WhoIsSignedIn =
  /** 401 with the problem description `Unauthorized`. */
  | { kind: "nobody" }
  /** 403 with the problem description `Forbidden`, naming the account's email in its `email` extension unless `null`. */
  | { kind: "refused"; email: string | null }
  /** 200 with exactly `{ name, email }`. */
  | { kind: "signed in"; name: string; email: string }
  | Trouble;

/** What the server answers to the sign-out, `POST /api/auth/logout` (c007 design.md D2). */
export type SignOutAnswer =
  /** 204, and the login has ended: afterwards nobody is signed in, for who is signed in and for the balance. */
  { kind: "signed out" } | Trouble;

/** What the server answers when the app reads the balance, `GET /api/balance` (c009 design.md D1). */
export type BalanceAnswer =
  /**
   * 200 with exactly `{ amount, readAt, czkPerEur }`; `readAt` as the API writes a time in UTC (`+00:00`, fractions of
   * a second only when there are some), by default the moment the server answers.
   */
  | { kind: "balance"; amount: number; readAt?: Date; czkPerEur: number }
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

/** An answer that reaches the app only `after` milliseconds, on the test's clock when it runs. */
export type Delayed<Answer> = Answer & { after?: number };

/** One answer for every request, or one per request in order, the last repeating. */
export type Answers<Answer> = Delayed<Answer> | readonly Delayed<Answer>[];

/** The server's answers for one test. */
export interface ServerAnswers {
  /**
   * `GET /api/me`. Without one, the app's question stays open, as while the server wakes up, so the app shows what it
   * shows before any answer. After a sign-out the server answers that nobody is signed in, as the real one does.
   */
  whoIsSignedIn?: Answers<WhoIsSignedIn>;
  /** `POST /api/auth/logout`. Without one, the sign-out succeeds. */
  signOut?: Answers<SignOutAnswer>;
  /**
   * `GET /api/balance`. Without one, the server answers `DEFAULT_BALANCE` EUR, read when it answers, at C13's rate.
   * After a sign-out the server answers that nobody is signed in (401).
   */
  balance?: Answers<BalanceAnswer>;
}

/** The balance the phone keeps (c009 design.md D4): the record as the app stores it, `readAt` in ISO 8601. */
export interface KeptBalance {
  amount: number;
  readAt: string;
  czkPerEur: number;
}

/** Nobody is signed in (401). Fits who is signed in and the balance. */
export const nobodySignedIn = { kind: "nobody" } as const;

/** The server refuses the signed-in account (403), naming its email (`null`: naming none). Fits who is signed in and the balance. */
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

/** The sign-out succeeds (204). */
export const signedOut = { kind: "signed out" } as const;

/** The koruna rate the API answers with by default: C13's constant. */
export const KORUNA_RATE = 24.3;

/** The balance `amount` EUR, read at `readAt` (by default when the server answers), at `czkPerEur` (by default C13's). */
export function balance(
  amount: number,
  options: { readAt?: Date; czkPerEur?: number } = {},
): BalanceAnswer {
  return {
    kind: "balance",
    amount,
    readAt: options.readAt,
    czkPerEur: options.czkPerEur ?? KORUNA_RATE,
  };
}

/**
 * The balance in EUR the server answers when a test sets no balance answer (made up; the backend's
 * `BankDsl.DEFAULT_BALANCE`). It differs from every amount a scenario names (286.40, 301.90, 250.00), so a scenario
 * whose balance never reached the server, or came from the wrong place, cannot pass on the default (lesson R-15: a DSL
 * default differs from every value a scenario names).
 */
export const DEFAULT_BALANCE = 1234.56;

/** The server's answer when a test sets none: `DEFAULT_BALANCE`, read when the server answers, at C13's rate. */
const defaultBalance = balance(DEFAULT_BALANCE);

/** The record of a balance `amount` EUR read at `readAt`, at `czkPerEur` (by default C13's), as the app keeps it from the API's answer. */
export function kept(
  amount: number,
  readAt: Date,
  czkPerEur: number = KORUNA_RATE,
): KeptBalance {
  return { amount, readAt: asTheApiWritesIt(readAt), czkPerEur };
}

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

const SIGN_OUT = "POST /api/auth/logout";
const WHO_IS_SIGNED_IN = "GET /api/me";
const BALANCE = "GET /api/balance";
const HEALTH = "GET /health";

/** The phone's own database for the balance it keeps (c009 design.md D4). */
const PHONE_DATABASE = "tarjeta-papa";
const PHONE_STORE = "balance";
const PHONE_KEY = "last";

/** What the server does with one request. */
type Outcome =
  | { kind: "answer"; response: () => Response; after?: number }
  | { kind: "failure"; after?: number }
  | { kind: "no answer" };

let page = new URL("http://localhost:3000/");
let whoIsSignedIn: readonly Delayed<WhoIsSignedIn>[] = [];
let signOut: readonly Delayed<SignOutAnswer>[] = [];
let balanceAnswers: readonly Delayed<BalanceAnswer>[] = [];
/** How many requests of each kind the server has answered or is answering, to pick the next answer in order. */
let asked = new Map<string, number>();
/** Set by a sign-out the server confirmed: from then on, nobody is signed in. */
let loginEnded = false;
let online = true;
let visibility: DocumentVisibilityState = "visible";
let entries: string[] = [];
/**
 * Counts the tests and the app's launches, so an answer still under way when a test ends, or when the app is closed,
 * never reaches the next test or launch.
 */
let generation = 0;

/** Sets the server's answers for this test. */
export function answerWith(answers: ServerAnswers): void {
  whoIsSignedIn = inOrder(answers.whoIsSignedIn);
  signOut = inOrder(answers.signOut);
  balanceAnswers = inOrder(answers.balance);
  asked = new Map();
  loginEnded = false;
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

/** The user leaves the app (the Home Screen, another app): the page turns hidden and hears `visibilitychange`. */
export function leaveApp(): void {
  setVisibility("hidden");
}

/** The user comes back to the app: the page turns visible and hears `visibilitychange`. */
export function returnToApp(): void {
  setVisibility("visible");
}

/**
 * The phone keeps this balance, as the app stores it (c009 design.md D4: database `tarjeta-papa`, store `balance`, key
 * `last`). Call it before `renderApp`. The storage is real IndexedDB code on `fake-indexeddb`, which runs on the real
 * event loop, so it needs no time on the test clock.
 */
export async function phoneKeeps(kept: KeptBalance): Promise<void> {
  await inPhoneStore("readwrite", (store) => store.put(kept, PHONE_KEY));
}

/**
 * The phone keeps this record where the balance goes, whatever its shape: what an older or broken app may have left
 * there. As `phoneKeeps`, otherwise.
 */
export async function phoneKeepsRecord(record: unknown): Promise<void> {
  await inPhoneStore("readwrite", (store) => store.put(record, PHONE_KEY));
}

/**
 * The phone's storage fails from now on, until the returned function restores it: opening a database throws, and so
 * does every transaction, also on a connection the app opened earlier and keeps (idb-keyval keeps one per store, so
 * breaking only `indexedDB.open` would not reach an app that has used its store before). Restore it in a `finally`.
 */
export function phoneStorageFails(): () => void {
  const factory = globalThis.indexedDB;
  const transaction = IDBDatabase.prototype.transaction;
  const broken = (): never => {
    throw new DOMException("The phone's storage failed.", "UnknownError");
  };

  globalThis.indexedDB = { open: broken } as unknown as IDBFactory;
  IDBDatabase.prototype.transaction = broken;

  return () => {
    globalThis.indexedDB = factory;
    IDBDatabase.prototype.transaction = transaction;
  };
}

/** The balance the phone keeps, as stored; `null` when it keeps none. */
export async function keptBalance(): Promise<KeptBalance | null> {
  const kept = await inPhoneStore<unknown>("readonly", (store) =>
    store.get(PHONE_KEY),
  );
  return (kept as KeptBalance | undefined) ?? null;
}

/**
 * The phone keeps nothing: every store of its database is emptied, and the database is created if it is missing, with
 * the store as the app's storage creates it. Called by `setup.ts` before every test. The database is emptied in place
 * rather than replaced: the app may keep its storage's connection open from an earlier test in the same file (idb-keyval
 * opens it once per store and keeps it), so a new IndexedDB would leave the app reading the old one, and deleting the
 * database would wait forever for that connection to close.
 */
export async function emptyThePhone(): Promise<void> {
  const database = await openPhoneDatabase();
  try {
    const names = [...database.objectStoreNames];
    if (names.length === 0) return;
    const transaction = database.transaction(names, "readwrite");
    for (const name of names) transaction.objectStore(name).clear();
    await completed(transaction);
  } finally {
    database.close();
  }
}

/** Closes the app: answers to its requests still under way never arrive. For `renderApp`'s `reopen`. */
export function closeApp(): void {
  generation += 1;
}

/** Forgets this test's answers, timeline, network and screen. */
export function resetFakeServer(): void {
  generation += 1;
  whoIsSignedIn = [];
  signOut = [];
  balanceAnswers = [];
  asked = new Map();
  loginEnded = false;
  online = true;
  visibility = "visible";
  entries = [];
}

/**
 * Puts the fake `fetch`, the recording `location`, and the phone's network flag and screen state in place of the
 * environment's. Called once, by `setup.ts`.
 */
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
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => visibility === "hidden",
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

function setVisibility(state: DocumentVisibilityState): void {
  act(() => {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
  });
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
  switch (request) {
    case SIGN_OUT:
      return signOutOutcome(nextOf(request, signOut) ?? signedOut);
    case WHO_IS_SIGNED_IN: {
      const answer = nextOf(request, whoIsSignedIn) ?? noAnswerYet;
      return whoIsSignedInOutcome(loginEnded ? nobodySignedIn : answer);
    }
    case BALANCE: {
      const answer = nextOf(request, balanceAnswers) ?? defaultBalance;
      return balanceOutcome(loginEnded ? nobodySignedIn : answer);
    }
    case HEALTH:
      return {
        kind: "answer",
        response: () =>
          new Response("Healthy", {
            headers: { "Content-Type": "text/plain" },
          }),
      };
    default:
      return { kind: "answer", response: () => problem(404, "Not Found") };
  }
}

function signOutOutcome(answer: Delayed<SignOutAnswer>): Outcome {
  if (answer.kind === "signed out")
    return {
      kind: "answer",
      after: answer.after,
      response: () => {
        loginEnded = true;
        return new Response(null, { status: 204 });
      },
    };
  return troubleOutcome(answer);
}

function whoIsSignedInOutcome(answer: Delayed<WhoIsSignedIn>): Outcome {
  switch (answer.kind) {
    case "nobody":
      return {
        kind: "answer",
        after: answer.after,
        response: () => problem(401, "Unauthorized"),
      };
    case "refused":
      return refusedOutcome(answer);
    case "signed in":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          Response.json({ name: answer.name, email: answer.email }),
      };
    default:
      return troubleOutcome(answer);
  }
}

function balanceOutcome(answer: Delayed<BalanceAnswer>): Outcome {
  switch (answer.kind) {
    case "balance":
      return {
        kind: "answer",
        after: answer.after,
        response: () =>
          Response.json({
            amount: answer.amount,
            readAt: asTheApiWritesIt(answer.readAt ?? new Date()),
            czkPerEur: answer.czkPerEur,
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
      return refusedOutcome(answer);
    default:
      return troubleOutcome(answer);
  }
}

function refusedOutcome(
  answer: Delayed<{ kind: "refused"; email: string | null }>,
): Outcome {
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
}

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

/** A time as the API writes a `DateTimeOffset` in UTC: `+00:00`, and fractions of a second only when there are some. */
function asTheApiWritesIt(time: Date): string {
  return time.toISOString().replace(/(\.000)?Z$/, "+00:00");
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

/** Opens the phone's database, creating its store as the app's storage does (idb-keyval: no key path) if it is new. */
function openPhoneDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(PHONE_DATABASE);
    opening.onupgradeneeded = () => {
      opening.result.createObjectStore(PHONE_STORE);
    };
    opening.onsuccess = () => {
      resolve(opening.result);
    };
    opening.onerror = () => {
      reject(opening.error ?? new Error("The phone's database did not open."));
    };
  });
}

async function inPhoneStore<Result>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<Result>,
): Promise<Result> {
  const database = await openPhoneDatabase();
  try {
    if (!database.objectStoreNames.contains(PHONE_STORE))
      throw new Error(
        `The phone's database has no store "${PHONE_STORE}": the app created it differently (c009 design.md D4).`,
      );
    const transaction = database.transaction(PHONE_STORE, mode);
    const request = operation(transaction.objectStore(PHONE_STORE));
    await completed(transaction);
    return request.result;
  } finally {
    database.close();
  }
}

function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("A phone storage write failed."));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("A phone storage write aborted."));
    };
  });
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
