import { useCallback, useEffect, useRef, useState } from "react";
import { readBalance, type Balance, type BalanceRead } from "./balance";
import { watchRefreshTriggers } from "./refreshTriggers";
import { shown, type Facts, type Problem, type Shown } from "./screenState";
import { readSession, signOut, type Session } from "./session";
import { loadStoredBalance, storeBalance } from "./storedBalance";

/** The phone is offline: what the phone said, or a request that got no answer (D2). */
const OFFLINE: Problem = { kind: "offline" };

/** How long the first question may go unanswered before the screen says the server is waking (D2). */
const WAKING_AFTER_MS = 1_500;

/** How long it may go unanswered before the waking-up screen offers to try again (D2). */
const SLOW_AFTER_MS = 30_000;

/** What the app's screens need from the sequence: what to show, and what the user's actions do. */
export interface AccountScreenModel {
  shown: Shown;
  /** "Obnovit": the screen's refresh signal (`repeat`). */
  refresh: () => void;
  /** "Zkusit znovu": asks again on the slow waking-up screen; otherwise repeats what was under way, at once (`repeat`). */
  retry: () => void;
  /** "Odhlásit se" in the account menu. */
  signOut: () => void;
}

/**
 * The account screen's sequence (c009 design.md D2, D3, D4, D7): at start, the balance the phone keeps, shown at once
 * until a read replaces it; and who is signed in (`GET /api/me`), then, only for a signed-in user, the balance
 * (`GET /api/balance`), one after the other, so nothing is read at the bank for a visitor who gets the sign-in screen.
 * What it learns becomes `Facts`, and the screen is what `shown` makes of them. The first question's wait: from 1.5 s
 * without an answer it is long, and an answer that took that long woke the server; from 30 s it is slow, and "Zkusit
 * znovu" asks again and starts the 30 s over (D2). The first load has no other cap (D3).
 *
 * One signal repeats what was under way (`repeat`): "Obnovit", "Zkusit znovu", every return to the screen and coming
 * back online (`watchRefreshTriggers`). With who is signed in unanswered (found offline, no usable answer), it asks
 * again, and the balance only after it; for a signed-in user, it reads the balance again. One question and one read at a
 * time: a repeat while one is under way is ignored, not queued. Each new question or read clears the screen's problem,
 * and its outcome sets the next (D7 c).
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
  const [wait, setWait] = useState<Facts["wait"]>("short");
  const [wokeUp, setWokeUp] = useState(false);
  /** Whether the screen is on the page, for answers that come after it left. */
  const onPage = useRef(false);
  /** The first question has been answered. */
  const firstAnswered = useRef(false);
  /** The first question had no answer after `WAKING_AFTER_MS`: the server was asleep. */
  const firstAnswerLate = useRef(false);
  /** The 30 s mark's timer, started over by "Zkusit znovu" on the slow waking-up screen. */
  const slowMark = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Set the moment the question starts, so a second one asked for in the same turn sees it (state would not yet). */
  const askUnderWay = useRef(false);
  /** The latest question's number: the answer to one asked before it was given up, and is ignored. */
  const latestQuestion = useRef(0);
  /** As `askUnderWay`, for a balance read. */
  const readUnderWay = useRef(false);

  /** Reads the balance as `as` and takes in what it brought, unless a read is under way: then nothing is sent. */
  const readTheBalance = useCallback(
    async (as: "first" | "refresh"): Promise<void> => {
      if (readUnderWay.current) return;
      readUnderWay.current = true;
      setReading(as);
      setProblem(null);

      let read: BalanceRead;
      try {
        read = await readBalance();
      } finally {
        readUnderWay.current = false;
      }
      if (!onPage.current) return;

      setReading("no");
      if (read.kind === "read") {
        setBalance(read.balance);
        // Kept after every successful read, in place of the one before (D4); a failed write is ignored.
        void storeBalance(read.balance);
      }
      if (read.kind === "offline") setProblem(OFFLINE);
    },
    [],
  );

  /**
   * Asks who is signed in, unless the question is under way: then nothing is sent, and the answer is `null`. `anew`
   * asks again all the same and gives the question under way up: its answer, whenever it comes, is `null` too.
   */
  const askOnce = useCallback(
    async (anew: boolean = false): Promise<Session | null> => {
      if (askUnderWay.current && !anew) return null;
      askUnderWay.current = true;
      const question = ++latestQuestion.current;

      try {
        const answer = await readSession();
        return question === latestQuestion.current ? answer : null;
      } finally {
        if (question === latestQuestion.current) askUnderWay.current = false;
      }
    },
    [],
  );

  /**
   * Who is signed in, as the server answered: it replaces the screen's problem (offline, or none), and for a signed-in
   * user the balance is read next.
   */
  const takeInAnswer = useCallback(
    async (answer: Session): Promise<void> => {
      if (!onPage.current) return;

      setSession(answer);
      setProblem(answer.kind === "offline" ? OFFLINE : null);
      if (answer.kind === "signed-in") await readTheBalance("first");
    },
    [readTheBalance],
  );

  /** Asks who is signed in and takes in the answer, unless the question is under way. */
  const askWhoIsSignedIn = useCallback(async (): Promise<void> => {
    const answer = await askOnce();
    if (answer !== null) await takeInAnswer(answer);
  }, [askOnce, takeInAnswer]);

  /**
   * The first load's answer to who is signed in: one that took 1.5 s or more woke the server, so the waking-up screen
   * stays until the balance arrives (D2).
   */
  const takeInFirstAnswer = useCallback(
    async (answer: Session): Promise<void> => {
      firstAnswered.current = true;
      if (firstAnswerLate.current) setWokeUp(true);
      await takeInAnswer(answer);
    },
    [takeInAnswer],
  );

  /** From 30 s without the first answer, the waking-up screen is the slow one (D2). */
  const markSlowIfUnanswered = useCallback((): void => {
    if (!firstAnswered.current) setWait("slow");
  }, []);

  useEffect(() => {
    onPage.current = true;

    // What the phone keeps shows at once, before any answer (D2); a failing store reads as none.
    async function loadStored(): Promise<void> {
      const kept = await loadStoredBalance();
      if (onPage.current) setStored(kept);
    }

    // The first question unanswered after 1.5 s: the server is waking (D2).
    const wakingMark = setTimeout(() => {
      if (firstAnswered.current) return;
      firstAnswerLate.current = true;
      setWait("long");
    }, WAKING_AFTER_MS);
    slowMark.current = setTimeout(markSlowIfUnanswered, SLOW_AFTER_MS);

    async function start(): Promise<void> {
      const answer = await askOnce();
      if (answer !== null) await takeInFirstAnswer(answer);
    }

    void loadStored();
    void start();

    return () => {
      clearTimeout(wakingMark);
      clearTimeout(slowMark.current);
      onPage.current = false;
    };
  }, [askOnce, takeInFirstAnswer, markSlowIfUnanswered]);

  /**
   * "Zkusit znovu" on the slow waking-up screen (D2): the first question is sent again, the one still unanswered given
   * up, and the 30 s start over; the page is never reloaded.
   */
  const askAgainAfterASlowWake = useCallback(async (): Promise<void> => {
    setWait("long");
    clearTimeout(slowMark.current);
    slowMark.current = setTimeout(markSlowIfUnanswered, SLOW_AFTER_MS);

    const answer = await askOnce(true);
    if (answer !== null) await takeInFirstAnswer(answer);
  }, [askOnce, takeInFirstAnswer, markSlowIfUnanswered]);

  const signedIn = session !== "waiting" && session.kind === "signed-in";
  const unanswered =
    session === "waiting" ||
    session.kind === "offline" ||
    session.kind === "unexpected";
  const hasRead = balance !== null;

  /**
   * Repeats what was under way (D2, D3): the question while who is signed in is unanswered; the balance read for a
   * signed-in user, as the first read until one succeeded. Nothing for a visitor on the sign-in or no-access screen.
   */
  const repeat = useCallback((): void => {
    if (signedIn) void readTheBalance(hasRead ? "refresh" : "first");
    else if (unanswered) void askWhoIsSignedIn();
  }, [signedIn, unanswered, hasRead, readTheBalance, askWhoIsSignedIn]);

  // Every return to the screen and coming back online repeat what was under way: no throttle.
  useEffect(() => watchRefreshTriggers(repeat), [repeat]);

  /** "Zkusit znovu": on the slow waking-up screen it asks again at once; otherwise it repeats what was under way. */
  const retry = useCallback((): void => {
    if (session === "waiting" && wait === "slow") void askAgainAfterASlowWake();
    else repeat();
  }, [session, wait, askAgainAfterASlowWake, repeat]);

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
    wait,
    wokeUp,
    problem,
    signingOut: false,
  };

  return {
    shown: shown(facts),
    refresh: repeat,
    retry,
    signOut: () => void signOutFromMenu(),
  };
}
