import type { Balance } from "./balance";
import type { Session } from "./session";

/** The screen's one banner (c009 design.md D5, D6, D7). */
export type Problem =
  | { kind: "bank unavailable" }
  | { kind: "bank rate limited" }
  | { kind: "bank access expired" }
  | { kind: "unexpected" }
  | { kind: "offline" }
  | { kind: "sign-out failed"; offline: boolean };

/** What the screen knows (c009 design.md D2, D3, D5, D6, D7). */
export interface Facts {
  /** The answer to who is signed in, once it came. */
  session: Session | "waiting";
  /** The phone's record, as loaded at start. */
  stored: Balance | null;
  /** The latest read, else the stored one. */
  balance: Balance | null;
  /** A balance read under way. */
  reading: "no" | "first" | "refresh";
  /** The first load's wait: under 1.5 s, from 1.5 s, from 30 s. */
  wait: "short" | "long" | "slow";
  /** The first answer took 1.5 s or more: the waiting screen stays until data. */
  wokeUp: boolean;
  /** The screen's one banner. */
  problem: Problem | null;
  signingOut: boolean;
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
 * What the screen shows for these facts; pure (c007 design.md D3, D5; c009 D2, D5, D7). Nobody signed in: the sign-in
 * screen; a refused account: the no-access screen, naming it. Otherwise the account screen: the menu once the server
 * named the user, the header (`headerOf`), the one banner, and under the header the list slot, which C7b's list fills;
 * with no header, the empty frame. Offline (D2; app-shell): with nothing to show, the offline state is the whole screen
 * under the top bar, in place of the header and the banner; with a balance, its header, the offline banner and the
 * offline note in the list's place (D7 a). While the server wakes (`waking`), the waking-up screen stands in the list's
 * place under a stored header, or is the whole screen with nothing stored. A problem on the screen is its banner,
 * under the header or alone under the top bar (`bannerOf`; D5).
 */
export function shown(facts: Facts): Shown {
  const { session } = facts;
  if (session !== "waiting" && session.kind === "signed-out")
    return { screen: "sign-in", justSignedOut: session.justSignedOut };
  if (session !== "waiting" && session.kind === "refused")
    return { screen: "no access", email: session.email };

  const offline = isOffline(facts);
  if (facts.balance === null && offline)
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
    banner: offline ? OFFLINE : bannerOf(facts),
    body: offline
      ? "offline note"
      : (wakingOf(facts) ?? (header === null ? "empty" : "list")),
    signingOut: facts.signingOut,
  };
}

/**
 * The waking-up screen, as the first load sees it (D2); `null` when the server is not waking. Who is signed in has had
 * no answer for 1.5 s or more: waking, and from 30 s the slow one, which offers to try again. Or it took that long,
 * and the first balance read still runs: the waking-up screen stays until the balance arrives, never a placeholder. A
 * refresh never shows it (D3).
 */
function wakingOf(facts: Facts): "waking" | "waking slow" | null {
  if (facts.session === "waiting" && facts.wait !== "short")
    return facts.wait === "slow" ? "waking slow" : "waking";
  if (facts.wokeUp && facts.reading === "first") return "waking";
  return null;
}

/** The offline problem and its banner, whichever request found the phone offline: what the phone said, or no answer (D2). */
export const OFFLINE: Problem = { kind: "offline" };

/** The unexpected answer's problem (D5 b). */
const UNEXPECTED: Problem = { kind: "unexpected" };

/**
 * The screen's one banner when the phone is online (D5, D7 c): an answer to who is signed in that the app cannot read
 * is the unexpected banner, whether or not it is on record; otherwise the problem on record, if any.
 */
function bannerOf(facts: Facts): Problem | null {
  const { session } = facts;
  if (session !== "waiting" && session.kind === "unexpected") return UNEXPECTED;
  return facts.problem;
}

/** Whether the phone is offline as far as the screen knows (D2): who is signed in found it so, or the offline problem is on record. */
function isOffline(facts: Facts): boolean {
  const { session, problem } = facts;
  return (
    (session !== "waiting" && session.kind === "offline") ||
    problem?.kind === "offline"
  );
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
 * Whether the balance shown is being read again on an awake server (D2, D3): a refresh, or the first read once the
 * server answered within 1.5 s. After a wake, the first read runs under the waking-up screen instead, and the header
 * stays as it was.
 */
function readsOnAwake(facts: Facts): boolean {
  return (
    facts.reading === "refresh" || (facts.reading === "first" && !facts.wokeUp)
  );
}
