/**
 * The crypto work under way (c019): the page checks a notification's balance on WebCrypto (design.md D3, D12), whose
 * operations Node answers from its thread pool, in real time: not on the test clock, and not within any number of the
 * event loop's turns, so on a busy machine an answer can come after the turns `timePasses` gives the app. `setup.ts`
 * counts every operation started on the page's `crypto.subtle` (`countCryptoWork`), the app's and the test kit's alike,
 * and the test clock's `timePasses` waits for those under way (`cryptoWorkFinished`) before the test reads the screen.
 * The wait is bounded by real time: an operation that has not ended `CRYPTO_WORK_LIMIT` ms after the wait began fails
 * the test with a message saying so, never a test that waits for good.
 */

/** `SubtleCrypto`'s operations, each answering a promise. */
const OPERATIONS = [
  "encrypt",
  "decrypt",
  "sign",
  "verify",
  "digest",
  "generateKey",
  "deriveKey",
  "deriveBits",
  "importKey",
  "exportKey",
  "wrapKey",
  "unwrapKey",
] as const;

/** How long, in real milliseconds, a wait for the crypto work under way lasts at most: well inside a test's 5 s. */
export const CRYPTO_WORK_LIMIT = 2_000;

/** The operations of one target that are under way. */
export interface WorkCounter {
  /** How many of its operations are under way now: started, their promise not yet settled. */
  underWay(): number;
  /**
   * Settles once every operation under way now has ended, fulfilled or failed; fails if one has not ended `limitMs` real
   * milliseconds later (by default `CRYPTO_WORK_LIMIT`).
   */
  finished(limitMs?: number): Promise<void>;
}

/** Node's timers, taken before any test fakes them: the limit is real time, which the test clock never moves. */
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

/** On a counting operation: the operation it stands in front of, so counting a target again never counts twice. */
const ORIGINAL = Symbol.for("revolutreader.test.cryptoWork.original");

type Operation = ((...args: unknown[]) => unknown) & {
  [ORIGINAL]?: Operation;
};

/**
 * Counts the operations started on `target` from now on: each of `SubtleCrypto`'s operations it has is put in front of,
 * on `target` itself, by one that starts the operation as it is and counts it until its promise settles. The callers see
 * the operation's own result, its failure too. Counting a target again replaces the earlier count, which then stops.
 */
export function countWorkOf(target: object): WorkCounter {
  const underWay = new Set<PromiseLike<unknown>>();
  const operations = target as Record<string, unknown>;

  for (const name of OPERATIONS) {
    const found = operations[name];
    if (typeof found !== "function") continue;
    const operation = (found as Operation)[ORIGINAL] ?? (found as Operation);
    const counting: Operation = (...args) => {
      const result = Reflect.apply(operation, target, args);
      if (isPromiseLike(result)) {
        underWay.add(result);
        const ended = (): void => {
          underWay.delete(result);
        };
        result.then(ended, ended);
      }
      return result;
    };
    counting[ORIGINAL] = operation;
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: counting,
    });
  }

  return {
    underWay: () => underWay.size,
    finished: async (limitMs = CRYPTO_WORK_LIMIT) => {
      if (underWay.size === 0) return;
      let limit: ReturnType<typeof realSetTimeout> | undefined;
      const outOfTime = new Promise<"out of time">((resolve) => {
        limit = realSetTimeout(() => {
          resolve("out of time");
        }, limitMs);
      });
      try {
        const ended = Promise.allSettled([...underWay]).then(
          () => "ended" as const,
        );
        if ((await Promise.race([ended, outOfTime])) === "out of time")
          throw new Error(
            `${underWay.size} crypto.subtle operation(s) still under way after ${limitMs} ms of real time.`,
          );
      } finally {
        realClearTimeout(limit);
      }
    },
  };
}

/** The count of the page's `crypto.subtle`, once `setup.ts` has started it. */
let cryptoWork: WorkCounter | undefined;

/**
 * Counts the operations started on the page's `crypto.subtle` (the same object as `window.crypto.subtle` and
 * `self.crypto.subtle`) from now on. Called once, by `setup.ts`, before any module of the app loads.
 */
export function countCryptoWork(): void {
  cryptoWork = countWorkOf(globalThis.crypto.subtle);
}

/** How many operations on the page's `crypto.subtle` are under way now; 0 before `countCryptoWork`. */
export function cryptoWorkUnderWay(): number {
  return cryptoWork?.underWay() ?? 0;
}

/**
 * Settles once every operation on the page's `crypto.subtle` under way now has ended; fails if one has not ended within
 * `CRYPTO_WORK_LIMIT` real milliseconds. For the test clock's `timePasses`.
 */
export function cryptoWorkFinished(): Promise<void> {
  return cryptoWork?.finished() ?? Promise.resolve();
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
