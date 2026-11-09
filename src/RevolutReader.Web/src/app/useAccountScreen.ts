import { useCallback, useEffect, useRef, useState } from "react";
import { readBalance, type Balance, type BalanceRead } from "./balance";
import { watchRefreshTriggers } from "./refreshTriggers";
import {
  OFFLINE,
  shown,
  type Facts,
  type Problem,
  type Shown,
} from "./screenState";
import { readSession, SignOutFailed, signOut, type Session } from "./session";
import {
  forgetStoredBalance,
  loadStoredBalance,
  storeBalance,
} from "./storedBalance";

/** How long the first question may go unanswered before the screen says the server is waking (D2). */
const WAKING_AFTER_MS = 1_500;

/** How long it may go unanswered before the waking-up screen offers to try again (D2). */
const SLOW_AFTER_MS = 30_000;

/**
 * How long a refresh may go unanswered before it counts as offline (D3): every balance read but the first load's own,
 * whether or not a read has succeeded yet, and asking again who is signed in.
 */
const REFRESH_LIMIT_MS = 60_000;

/** What the app's screens need from the sequence: what to show, and what the user's actions do. */
export interface AccountScreenModel {
  shown: Shown;
  /** "Obnovit": the screen's refresh signal (`repeat`). */
  refresh: () => void;
  /** "Zkusit znovu": asks again on the slow waking-up screen; otherwise repeats what was under way, at once (`repeat`). */
  retry: () => void;
  /** "Odhlásit se" in the account menu; settles when the sign-out has ended, whatever its outcome (it never rejects). */
  signOut: () => Promise<void>;
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
 * again, and the balance only after it; for a signed-in user, it reads the balance again. Both have the 60 s limit,
 * then end as offline. One question and one read at a time: a repeat while one is under way is ignored, not queued.
 * Each new question or read clears the screen's problem the moment it starts, and its outcome sets the next (D3, D7 c).
 *
 * "Odhlásit se" signs out; once the server has confirmed it, the balance the phone keeps is forgotten and the sign-in
 * screen shows with its note that the sign-out happened. A sign-out that failed (a server error, offline) leaves the
 * visitor on the account screen, still signed in, so the note never claims a sign-out that did not happen (c007
 * design.md D2). A 401 or 403 to who is signed in or to a balance read forgets the balance too, and shows the sign-in
 * screen (without the note) or the no-access screen (D4, D5 c).
 */
export function useAccountScreen(): AccountScreenModel {
  const [session, setSession] = useState<Session | "waiting">("waiting");
  const [stored, setStored] = useState<Balance | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [reading, setReading] = useState<Facts["reading"]>("no");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [wait, setWait] = useState<Facts["wait"]>("short");
  const [wokeUp, setWokeUp] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  /** Set the moment a sign-out starts, so a second tap in the same turn sees it (state would not yet). */
  const signOutUnderWay = useRef(false);
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
  /** How many logins have ended on this screen: a read started before the latest end lands for nobody, and is dropped. */
  const loginsEnded = useRef(0);

  /**
   * The device has no allowed login any more (D4, D5 c): a sign-out the server confirmed, or a 401 or 403 to who is
   * signed in or to a balance read. The balance the phone keeps is forgotten before `next`, the sign-in or no-access
   * screen, shows; what the screen held goes with it, and a read still under way is dropped when it lands.
   */
  const endLogin = useCallback(async (next: Session): Promise<void> => {
    loginsEnded.current += 1;
    await forgetStoredBalance();
    if (!onPage.current) return;

    setSession(next);
    setBalance(null);
    setStored(null);
    setReading("no");
    setProblem(null);
  }, []);

  /**
   * Reads the balance and takes in what it brought, unless a read is under way: then nothing is sent. `as` is how the
   * screen shows it: as the first read until one has succeeded, then as a refresh. Every read but the first load's own
   * (`firstLoad`, the one after the first answer to who is signed in) is a refresh for the limit: with no answer after
   * `REFRESH_LIMIT_MS` it is aborted, and so ends as offline (D3); the first load's read has no limit, since the first
   * load shows the waking-up screens instead (D2). A read that lands after the login ended is neither shown nor kept
   * (D4); one that finds the login ended (401, 403) ends it here too. Once a read has landed, whatever its outcome, a wake
   * is over: later reads show the header refreshing or the placeholder, never the waking-up screen (D2, D3).
   */
  const readTheBalance = useCallback(
    async (as: "first" | "refresh", firstLoad: boolean): Promise<void> => {
      if (readUnderWay.current) return;
      readUnderWay.current = true;
      const login = loginsEnded.current;
      setReading(as);
      setProblem(null);

      // A timer of the page's own, not AbortSignal.timeout, so the tests' clock drives it too.
      const limit = firstLoad ? undefined : new AbortController();
      const limitTimer =
        limit === undefined
          ? undefined
          : setTimeout(() => {
              limit.abort();
            }, REFRESH_LIMIT_MS);

      let read: BalanceRead;
      try {
        read = await readBalance({ signal: limit?.signal });
      } finally {
        clearTimeout(limitTimer);
        readUnderWay.current = false;
      }
      if (!onPage.current || login !== loginsEnded.current) return;

      // A read has landed, whatever it brought: a wake is over, and the server is awake for every read after it (D2, D3).
      setWokeUp(false);

      // The login has ended (D5 c): a 401 leads to the sign-in screen, with no note that a sign-out happened; a 403 to
      // the no-access screen, naming the account.
      if (read.kind === "signed out") {
        await endLogin({ kind: "signed-out", justSignedOut: false });
        return;
      }
      if (read.kind === "refused") {
        await endLogin({ kind: "refused", email: read.email });
        return;
      }

      setReading("no");
      if (read.kind === "read") {
        setBalance(read.balance);
        // Kept after every successful read, in place of the one before (D4); a failed write is ignored.
        void storeBalance(read.balance);
      }
      if (read.kind === "offline") setProblem(OFFLINE);
      // A failure at the bank, or an answer the app cannot read, keeps what is shown, with its banner (D5).
      if (
        read.kind === "bank unavailable" ||
        read.kind === "bank rate limited" ||
        read.kind === "bank access expired" ||
        read.kind === "unexpected"
      )
        setProblem({ kind: read.kind });
    },
    [endLogin],
  );

  /**
   * Asks who is signed in, unless the question is under way: then nothing is sent, and the answer is `null`. `anew`
   * asks again all the same and gives the question under way up: its answer, whenever it comes, is `null` too. `signal`
   * aborts the request, which then reads as offline.
   */
  const askOnce = useCallback(
    async ({
      anew = false,
      signal,
    }: {
      anew?: boolean;
      signal?: AbortSignal;
    } = {}): Promise<Session | null> => {
      if (askUnderWay.current && !anew) return null;
      askUnderWay.current = true;
      const question = ++latestQuestion.current;

      try {
        const answer = await readSession({ signal });
        return question === latestQuestion.current ? answer : null;
      } finally {
        if (question === latestQuestion.current) askUnderWay.current = false;
      }
    },
    [],
  );

  /**
   * Who is signed in, as the server answered: it replaces the screen's problem (offline, unexpected, or none), and for a
   * signed-in user the balance is read next, as the first load's read when `firstLoad` (`readTheBalance`). Nobody signed
   * in (401) or a refused account (403): the device has no allowed login, so the balance it keeps is forgotten first
   * (D4).
   */
  const takeInAnswer = useCallback(
    async (answer: Session, firstLoad: boolean): Promise<void> => {
      if (!onPage.current) return;
      if (answer.kind === "signed-out" || answer.kind === "refused") {
        await endLogin(answer);
        return;
      }

      setSession(answer);
      setProblem(
        answer.kind === "offline" || answer.kind === "unexpected"
          ? { kind: answer.kind }
          : null,
      );
      if (answer.kind === "signed-in") await readTheBalance("first", firstLoad);
    },
    [endLogin, readTheBalance],
  );

  /**
   * Asks who is signed in again, after the first question found the phone offline or got an unexpected answer, and takes
   * in the answer; nothing when a question is under way (D3, "Asking again who is signed in"). The moment it starts,
   * the screen's problem goes, and the screen shows what it has, the stored balance in its default state or the empty
   * frame: who is signed in is unknown again, with a short wait, so no waking-up screen (the 1.5 s and 30 s marks belong
   * to the first load). With no answer after `REFRESH_LIMIT_MS` it is aborted, and so ends as offline. For a signed-in
   * user the balance read follows, with the refresh's limit.
   */
  const askWhoIsSignedIn = useCallback(async (): Promise<void> => {
    if (askUnderWay.current) return;
    setSession("waiting");
    setWait("short");
    setProblem(null);

    // A timer of the page's own, not AbortSignal.timeout, so the tests' clock drives it too.
    const limit = new AbortController();
    const limitTimer = setTimeout(() => {
      limit.abort();
    }, REFRESH_LIMIT_MS);

    let answer: Session | null;
    try {
      answer = await askOnce({ signal: limit.signal });
    } finally {
      clearTimeout(limitTimer);
    }
    if (answer !== null) await takeInAnswer(answer, false);
  }, [askOnce, takeInAnswer]);

  /**
   * The first load's answer to who is signed in: a signed-in user's that took 1.5 s or more woke the server, so the
   * waking-up screen stays until the balance read that follows at once lands, whatever it brings (D2; `readTheBalance`
   * ends the wake). Any other late answer is no wake: no answer at all is offline (D2), and after an unexpected one no
   * read follows until a repeated question; the sign-in and no-access screens have no waking-up screen. The read that
   * follows it is the first load's, with no limit.
   */
  const takeInFirstAnswer = useCallback(
    async (answer: Session): Promise<void> => {
      firstAnswered.current = true;
      if (firstAnswerLate.current && answer.kind === "signed-in")
        setWokeUp(true);
      await takeInAnswer(answer, true);
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

    const answer = await askOnce({ anew: true });
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
   * signed-in user, shown as the first read until one succeeded, and always with the refresh's limit. Nothing for a
   * visitor on the sign-in or no-access screen.
   */
  const repeat = useCallback((): void => {
    if (signedIn) void readTheBalance(hasRead ? "refresh" : "first", false);
    else if (unanswered) void askWhoIsSignedIn();
  }, [signedIn, unanswered, hasRead, readTheBalance, askWhoIsSignedIn]);

  // Every return to the screen and coming back online repeat what was under way: no throttle.
  useEffect(() => watchRefreshTriggers(repeat), [repeat]);

  /** "Zkusit znovu": on the slow waking-up screen it asks again at once; otherwise it repeats what was under way. */
  const retry = useCallback((): void => {
    if (session === "waiting" && wait === "slow") void askAgainAfterASlowWake();
    else repeat();
  }, [session, wait, askAgainAfterASlowWake, repeat]);

  /**
   * "Odhlásit se" (D6): one sign-out at a time, busy while it runs. Confirmed: the balance the phone keeps is forgotten
   * before the signed-out screen shows (D4). Failed: the visitor stays signed in on the account screen, the balance
   * shown and kept, and its banner, offline or not, replaces any other.
   */
  async function signOutFromMenu(): Promise<void> {
    if (signOutUnderWay.current) return;
    signOutUnderWay.current = true;
    setSigningOut(true);

    try {
      await signOut();
    } catch (failure) {
      setProblem({
        kind: "sign-out failed",
        offline: failure instanceof SignOutFailed && failure.offline,
      });
      setSigningOut(false);
      signOutUnderWay.current = false;
      return;
    }

    await endLogin({ kind: "signed-out", justSignedOut: true });
    setSigningOut(false);
    signOutUnderWay.current = false;
  }

  const facts: Facts = {
    session,
    balance: balance ?? stored,
    reading,
    wait,
    wokeUp,
    problem,
    signingOut,
  };

  return {
    shown: shown(facts),
    refresh: repeat,
    retry,
    signOut: signOutFromMenu,
  };
}
