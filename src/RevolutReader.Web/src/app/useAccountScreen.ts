import { useEffect, useState } from "react";
import { readBalance, type Balance } from "./balance";
import { shown, type Facts, type Shown } from "./screenState";
import { readSession, signOut, type Session } from "./session";

/** What the app's screens need from the sequence: what to show, and what the user's actions do. */
export interface AccountScreenModel {
  shown: Shown;
  /** "Obnovit". Reads nothing yet: refreshing comes with its own slice (c009 tasks.md slice 9). */
  refresh: () => void;
  /** "Zkusit znovu". Repeats nothing yet: retrying comes with its own slice (c009 tasks.md slice 22). */
  retry: () => void;
  /** "Odhlásit se" in the account menu. */
  signOut: () => void;
}

/**
 * The account screen's sequence (c009 design.md D2), first part: at start, who is signed in (`GET /api/me`), then, only
 * for a signed-in user, the balance (`GET /api/balance`), one after the other, so nothing is read at the bank for a
 * visitor who gets the sign-in screen. What it learns becomes `Facts`, and the screen is what `shown` makes of them.
 *
 * "Odhlásit se" signs out; once the server has confirmed it, the sign-in screen shows with its note that the sign-out
 * happened. A sign-out that failed (a server error, offline) leaves the visitor on the account screen, still signed in,
 * so the note never claims a sign-out that did not happen (c007 design.md D2).
 */
export function useAccountScreen(): AccountScreenModel {
  const [session, setSession] = useState<Session | "waiting">("waiting");
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reading, setReading] = useState<Facts["reading"]>("no");

  useEffect(() => {
    let showing = true;

    async function start(): Promise<void> {
      const answer = await readSession();
      if (!showing) return;
      setSession(answer);
      if (answer.kind !== "signed-in") return;

      setReading("first");
      const read = await readBalance();
      if (!showing) return;
      setReading("no");
      if (read.kind === "read") setBalance(read.balance);
    }

    void start();

    return () => {
      showing = false;
    };
  }, []);

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
    stored: null,
    balance,
    reading,
    wait: "short",
    wokeUp: false,
    problem: null,
    signingOut: false,
  };

  return {
    shown: shown(facts),
    refresh: doNothingYet,
    retry: doNothingYet,
    signOut: () => void signOutFromMenu(),
  };
}

function doNothingYet(): void {}
