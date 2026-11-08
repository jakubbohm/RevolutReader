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

/**
 * What the screen shows for these facts; pure. A stub until c009 tasks.md group 16 is implemented; `void` keeps the
 * unused-parameter check quiet until then.
 */
export function shown(facts: Facts): Shown {
  void facts;
  throw new Error("not implemented");
}
