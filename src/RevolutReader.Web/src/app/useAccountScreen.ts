import { useCallback, useEffect, useRef, useState } from "react";
import { readBalance, type Balance, type BalanceRead } from "./balance";
import { watchRefreshTriggers } from "./refreshTriggers";
import { shown, type Facts, type Problem, type Shown } from "./screenState";
import { readSession, signOut, type Session } from "./session";
import { loadStoredBalance, storeBalance } from "./storedBalance";

/** The phone is offline: what the phone said, or a request that got no answer (D2). */
const OFFLINE: Problem = { kind: "offline" };

/** What the app's screens need from the sequence: what to show, and what the user's actions do. */
export interface AccountScreenModel {
  shown: Shown;
  /** "Obnovit": reads the balance again, unless a read is under way. */
  refresh: () => void;
  /** "Zkusit znovu". Repeats nothing yet: retrying comes with its own slice (c009 tasks.md slice 22). */
  retry: () => void;
  /** "Odhlásit se" in the account menu. */
  signOut: () => void;
}

/**
 * The account screen's sequence (c009 design.md D2, D3, D4): at start, the balance the phone keeps, shown at once until
 * a read replaces it; and who is signed in (`GET /api/me`), then, only for a signed-in user, the balance
 * (`GET /api/balance`), one after the other, so nothing is read at the bank for a visitor who gets the sign-in screen. "Obnovit" and every return to the screen (`watchRefreshTriggers`) read the balance again
 * for a signed-in user. One read at a time: a refresh asked for while a read is under way, the first one included, is
 * ignored, not queued. What it learns becomes `Facts`, and the screen is what `shown` makes of them.
 *
 * "Odhlásit se" signs out; once the server has confirmed it, the sign-in screen shows with its note that the sign-out
 * happened. A sign-out that failed (a server error, offline) leaves the visitor on the account screen, still signed in,
 * so the note never claims a sign-out that did not happen (c007 design.md D2).
 */
export function useAccountScreen(): AccountScreenModel {
  const [session, setSession] = useState<Session | "waiting">("waiting");
  const [stored, setStored] = useState<Balance | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reading, setReading] = useState<Facts["reading"]>("no");
  const [problem, setProblem] = useState<Problem | null>(null);
  /** Set the moment a balance read starts, so a second one asked for in the same turn sees it (state would not yet). */
  const readUnderWay = useRef(false);

  /** Reads the balance as `as`, unless a read is under way: then nothing is sent, and the answer is `null`. */
  const readOnce = useCallback(
    async (as: "first" | "refresh"): Promise<BalanceRead | null> => {
      if (readUnderWay.current) return null;
      readUnderWay.current = true;
      setReading(as);

      try {
        return await readBalance();
      } finally {
        readUnderWay.current = false;
      }
    },
    [],
  );

  /**
   * What a read brought: the read is over; a balance it read replaces the one shown and the one the phone keeps, and no
   * answer means offline.
   */
  const takeIn = useCallback((read: BalanceRead): void => {
    setReading("no");
    if (read.kind === "read") {
      setBalance(read.balance);
      // Kept after every successful read, in place of the one before (D4); a failed write is ignored.
      void storeBalance(read.balance);
    }
    if (read.kind === "offline") setProblem(OFFLINE);
  }, []);

  useEffect(() => {
    let showing = true;

    // What the phone keeps shows at once, before any answer (D2); a failing store reads as none.
    async function loadStored(): Promise<void> {
      const kept = await loadStoredBalance();
      if (showing) setStored(kept);
    }

    async function start(): Promise<void> {
      const answer = await readSession();
      if (!showing) return;
      setSession(answer);
      if (answer.kind === "offline") setProblem(OFFLINE);
      if (answer.kind !== "signed-in") return;

      const read = await readOnce("first");
      if (showing && read !== null) takeIn(read);
    }

    void loadStored();
    void start();

    return () => {
      showing = false;
    };
  }, [readOnce, takeIn]);

  const signedIn = session !== "waiting" && session.kind === "signed-in";

  /** Reads the balance again and takes in what it brought, unless a read is under way. */
  const readAgain = useCallback(async (): Promise<void> => {
    const read = await readOnce("refresh");
    if (read !== null) takeIn(read);
  }, [readOnce, takeIn]);

  // While signed in, every return to the screen reads the balance again (D3): no throttle, and a return during a read
  // is ignored like any refresh then.
  useEffect(() => {
    if (!signedIn) return undefined;
    return watchRefreshTriggers(() => void readAgain());
  }, [signedIn, readAgain]);

  function refresh(): void {
    if (signedIn) void readAgain();
  }

  async function signOutFromMenu(): Promise<void> {
    try {
      await signOut();
    } catch {
      return;
    }

    setSession({ kind: "signed-out", justSignedOut: true });
  }

  const facts: Facts = {
    session,
    stored,
    balance: balance ?? stored,
    reading,
    wait: "short",
    wokeUp: false,
    problem,
    signingOut: false,
  };

  return {
    shown: shown(facts),
    refresh,
    retry: doNothingYet,
    signOut: () => void signOutFromMenu(),
  };
}

function doNothingYet(): void {}
