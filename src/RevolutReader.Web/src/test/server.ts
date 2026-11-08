/**
 * The server and the address bar, as the app's tests see them (c007 design.md § How each scenario is verified): a
 * hand-written fake `fetch` that answers the app's API requests, and a recording `location` that notes where the app
 * navigates instead of leaving the page (jsdom does not navigate). Both are installed once, by `setup.ts`, before any
 * module of the app loads: the API client takes `fetch` when it is created (openapi-fetch reads `globalThis.fetch` in
 * `createClient`), so a stub put in place later would never be called. Each test then says what the server answers
 * (`answerWith`), and `resetFakeServer` forgets it after the test.
 *
 * Everything the app does goes into one timeline, in order:
 * - `request GET /api/me` when the app sends a request (method, then path and query on the page's own origin);
 * - `answer GET /api/me` when the server's answer reaches the app, or `failure GET /api/me` when the request fails;
 * - `navigation /api/auth/login` when the app sets its location (`location.assign`, `location.replace`, the `href`
 *   setter, or assigning `location` itself), with the target's path and query on the page's own origin.
 * An answer reaches the app on a later task, never at once, so the timeline shows whether the app waited for it.
 * `document.location` is jsdom's own and is not recorded.
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

/** Nobody is signed in. */
export const nobodySignedIn: WhoIsSignedIn = { kind: "nobody" };

/** The server refuses the signed-in account, naming its email (`null`: naming none). */
export function refused(email: string | null): WhoIsSignedIn {
  return { kind: "refused", email };
}

/** This allowed user is signed in. */
export function signedIn(name: string, email: string): WhoIsSignedIn {
  return { kind: "signed in", name, email };
}

/** The server's answers for one test. */
export interface ServerAnswers {
  /**
   * `GET /api/me`. Without one, the app's question stays open, as while the server wakes up, so the app shows what it
   * shows before any answer. After a sign-out the server answers that nobody is signed in, as the real one does.
   */
  whoIsSignedIn?: WhoIsSignedIn;
}

/** The sign-out (design.md D2): 204, and the login has ended. */
const SIGN_OUT = "POST /api/auth/logout";
const WHO_IS_SIGNED_IN = "GET /api/me";

/** What the server does with one request. */
type Outcome =
  | { kind: "answer"; response: () => Response }
  | { kind: "failure" }
  | { kind: "no answer" };

let page = new URL("http://localhost:3000/");
let whoIsSignedIn: WhoIsSignedIn = { kind: "no answer yet" };
let entries: string[] = [];
/** Counts the tests, so an answer still under way when a test ends never reaches the next test's timeline. */
let generation = 0;

/** Sets the server's answers for this test. */
export function answerWith(answers: ServerAnswers): void {
  whoIsSignedIn = answers.whoIsSignedIn ?? { kind: "no answer yet" };
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

/** Forgets this test's answers and timeline. */
export function resetFakeServer(): void {
  generation += 1;
  whoIsSignedIn = { kind: "no answer yet" };
  entries = [];
}

/** Puts the fake `fetch` and the recording `location` in place of the environment's. Called once, by `setup.ts`. */
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
  const request = `${method} ${onThePage(url)}`;
  const sentIn = generation;

  entries.push(`request ${request}`);
  const outcome = outcomeOf(request);
  if (outcome.kind === "no answer") return new Promise<Response>(() => {});

  await new Promise((resolve) => setTimeout(resolve, 0));
  if (sentIn !== generation) return new Promise<Response>(() => {});

  if (outcome.kind === "failure") {
    entries.push(`failure ${request}`);
    throw new TypeError("Failed to fetch");
  }

  entries.push(`answer ${request}`);
  return outcome.response();
}

function outcomeOf(request: string): Outcome {
  if (request === SIGN_OUT)
    return {
      kind: "answer",
      response: () => {
        whoIsSignedIn = nobodySignedIn;
        return new Response(null, { status: 204 });
      },
    };
  if (request === WHO_IS_SIGNED_IN) return whoIsSignedInOutcome(whoIsSignedIn);
  return { kind: "answer", response: () => problem(404, "Not Found") };
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

/** The RFC 9110 section ASP.NET Core names as each status's problem `type`. */
const PROBLEM_TYPE_SECTIONS: Record<number, string> = {
  401: "15.5.2",
  403: "15.5.4",
  404: "15.5.5",
  500: "15.6.1",
};

/** A problem description (RFC 9457) as the API writes one, with any extensions. */
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
