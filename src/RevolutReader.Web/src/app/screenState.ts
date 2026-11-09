import type { Balance } from "./balance";
import type { ListProblem } from "./listState";
import type { Session } from "./session";

/**
 * The screen's one banner (c009 design.md D5, D6, D7). At the join (c010 design.md D8), `of: "list"` marks a problem of
 * the transactions' read alone, in the list's words.
 */
export type Problem =
  | { kind: "bank unavailable"; of?: "list" }
  | { kind: "bank rate limited" }
  | { kind: "bank access expired" }
  | { kind: "unexpected"; of?: "list" }
  | { kind: "offline" }
  | { kind: "sign-out failed"; offline: boolean };

/** What the list reports to the screen at the join (c010 design.md D8). */
export interface ListReport {
  /** Its newest page is being read, at first or again. */
  reading: boolean;
  /** What went wrong with its last newest page, if anything. */
  problem: ListProblem | null;
  /** A newest page has come: the list shows its days, or that there are none yet. */
  onScreen: boolean;
}

/** What the screen knows (c009 design.md D2, D3, D5, D6, D7). */
export interface Facts {
  /** The answer to who is signed in, once it came; `"waiting"` while it is asked, at first or again. */
  session: Session | "waiting";
  /** The latest read, else the one the phone keeps, as loaded at start. */
  balance: Balance | null;
  /** A balance read under way. */
  reading: "no" | "first" | "refresh";
  /** The first load's wait: under 1.5 s, from 1.5 s, from 30 s. */
  wait: "short" | "long" | "slow";
  /**
   * The first answer took 1.5 s or more, and the first reads, the balance's and the list's newest page, have not both
   * landed yet: the waiting screen stays while either runs (c010 design.md D8).
   */
  wokeUp: boolean;
  /** The screen's one banner. */
  problem: Problem | null;
  signingOut: boolean;
  /** What the list reports (c010 design.md D8); absent, it has nothing to report. */
  list?: ListReport;
}

/** What the screen shows (c009 design.md D2, D7, D10). */
export type Shown =
  | { screen: "sign-in"; justSignedOut: boolean }
  | { screen: "no access"; email: string | null }
  | {
      screen: "account";
      /** The menu, once the server named the user. */
      account: { name: string; email: string } | null;
      header: { balance: Balance; refreshing: boolean } | "placeholder" | null;
      banner: Problem | null;
      /** The list slot, or a whole-screen state. */
      body:
        | "list"
        | "waking"
        | "waking slow"
        | "offline note"
        | "offline"
        | "empty";
      signingOut: boolean;
    };

/** The account screen, as `shown` describes it. */
export type ShownAccount = Extract<Shown, { screen: "account" }>;

/**
 * What the screen shows for these facts; pure (c007 design.md D3, D5; c009 D2, D5, D7; c010 D8). Nobody signed in: the
 * sign-in screen; a refused account: the no-access screen, naming it. Otherwise the account screen: the menu once the
 * server named the user, the header (`headerOf`), the one banner (`bannerOf`), and under the header the list slot
 * (`bodyOf`); with no header and no list, the empty frame. Offline (D2; app-shell), whichever read found it so: with
 * nothing to show, the offline state is the whole screen under the top bar, in place of the header and the banner;
 * otherwise what there is, under the offline banner.
 */
export function shown(facts: Facts): Shown {
  const { session } = facts;
  if (session !== "waiting" && session.kind === "signed-out")
    return { screen: "sign-in", justSignedOut: session.justSignedOut };
  if (session !== "waiting" && session.kind === "refused")
    return { screen: "no access", email: session.email };

  const offline = isOffline(facts);
  if (facts.balance === null && !listOnScreen(facts) && offline)
    return {
      screen: "account",
      account: accountOf(session),
      header: null,
      banner: null,
      body: "offline",
      signingOut: facts.signingOut,
    };

  const header = headerOf(facts);

  return {
    screen: "account",
    account: accountOf(facts.session),
    header,
    banner: bannerOf(facts, offline),
    body: bodyOf(facts, header, offline),
    signingOut: facts.signingOut,
  };
}

/**
 * The list slot under the header (c009 design.md D7 a; c010 D8). A list on screen stays there through every reload,
 * whether it fails, wakes or finds the phone offline. Until one has come: offline, the offline note in its place; while
 * the server wakes, the waking-up screen (`wakingOf`), under a stored header or, with nothing stored, as the whole
 * screen; otherwise the slot, for the list's placeholders, or the empty frame when there is no header either.
 */
function bodyOf(
  facts: Facts,
  header: ShownAccount["header"],
  offline: boolean,
): ShownAccount["body"] {
  if (listOnScreen(facts)) return "list";
  if (offline) return "offline note";
  return wakingOf(facts) ?? (header === null ? "empty" : "list");
}

/**
 * The waking-up screen, as the first load sees it (D2); `null` when the server is not waking. Who is signed in has had
 * no answer for 1.5 s or more: waking, and from 30 s the slow one, which offers to try again. Or it took that long,
 * and a first read still runs, the balance's or the list's newest page (c010 design.md D8): the waking-up screen stays
 * until they have come, never a placeholder. A refresh never shows it (D3).
 */
function wakingOf(facts: Facts): "waking" | "waking slow" | null {
  if (facts.session === "waiting" && facts.wait !== "short")
    return facts.wait === "slow" ? "waking slow" : "waking";
  if (facts.wokeUp && (facts.reading === "first" || listReads(facts)))
    return "waking";
  return null;
}

/** The offline problem and its banner, whichever request found the phone offline: what the phone said, or no answer (D2). */
export const OFFLINE: Problem = { kind: "offline" };

/** The unexpected answer's problem (D5 b). */
const UNEXPECTED: Problem = { kind: "unexpected" };

/**
 * The problems a read can leave, the most important first (c010 design.md D8): offline comes before them all, and a
 * failed sign-out before offline.
 */
const PRECEDENCE = [
  "bank access expired",
  "bank rate limited",
  "bank unavailable",
  "unexpected",
] as const;

/**
 * The screen's one banner (c009 design.md D5, D6, D7 c; c010 D8). A failed sign-out replaces any other until the next
 * action clears it. Then offline, whichever read found it so. Then the most important problem of the two reads
 * (`PRECEDENCE`), the balance's before the list's of the same kind: an answer to who is signed in that the app cannot
 * read counts as the balance's unexpected answer, whether or not it is on record. A problem of the list's read alone is
 * in the list's words (`ofTheList`).
 */
function bannerOf(facts: Facts, offline: boolean): Problem | null {
  const { session, problem } = facts;
  if (problem?.kind === "sign-out failed") return problem;
  if (offline) return OFFLINE;

  const own =
    session !== "waiting" && session.kind === "unexpected"
      ? UNEXPECTED
      : problem;
  const list = facts.list?.problem ?? null;
  for (const kind of PRECEDENCE) {
    if (own?.kind === kind) return own;
    if (list?.kind === kind) return ofTheList(list);
  }
  return null;
}

/**
 * The banner for a problem of the list's read alone (c010 design.md D7, D8): the bank not answering and an unexpected
 * answer in the list's words; expired access and the request limit in the same words as the balance's.
 */
function ofTheList(problem: ListProblem): Problem {
  switch (problem.kind) {
    case "bank unavailable":
    case "unexpected":
      return { kind: problem.kind, of: "list" };
    default:
      return { kind: problem.kind };
  }
}

/**
 * Whether the phone is offline as far as the screen knows (D2; c010 D8): who is signed in found it so, or the offline
 * problem is on record, the balance's or the list's.
 */
function isOffline(facts: Facts): boolean {
  const { session, problem } = facts;
  return (
    (session !== "waiting" && session.kind === "offline") ||
    problem?.kind === "offline" ||
    facts.list?.problem?.kind === "offline"
  );
}

/** A newest page of the list has come (c010 design.md D8). */
function listOnScreen(facts: Facts): boolean {
  return facts.list?.onScreen ?? false;
}

/** The list's newest page is being read (c010 design.md D8). */
function listReads(facts: Facts): boolean {
  return facts.list?.reading ?? false;
}

/** The menu's account: only once `GET /api/me` has named the user (D2), never from what the phone keeps. */
function accountOf(session: Facts["session"]): ShownAccount["account"] {
  if (session === "waiting" || session.kind !== "signed-in") return null;
  return { name: session.name, email: session.email };
}

/**
 * The header: the balance, the latest read or else the stored one, refreshing while it is read again (`readsOnAwake`);
 * with no balance, the placeholder while the first read runs on a server that answered within 1.5 s (D2: after a wake
 * the waking-up screen stays instead, never a placeholder); otherwise none.
 */
function headerOf(facts: Facts): ShownAccount["header"] {
  if (facts.balance !== null)
    return { balance: facts.balance, refreshing: readsOnAwake(facts) };
  if (facts.reading === "first" && !facts.wokeUp) return "placeholder";
  return null;
}

/**
 * Whether what is shown is being read again on an awake server (D2, D3; c010 D8: "Obnovuji…" waits for both answers): a
 * balance refresh; or, once the server answered within 1.5 s, the balance's first read or the list's newest page. After
 * a wake, the first reads run under the waking-up screen instead, and the header stays as it was.
 */
function readsOnAwake(facts: Facts): boolean {
  return (
    facts.reading === "refresh" ||
    (!facts.wokeUp && (facts.reading === "first" || listReads(facts)))
  );
}
