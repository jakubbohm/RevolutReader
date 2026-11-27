import { expect, test } from "vitest";
import { realTurn, startTestClock, timePasses } from "./clock";
import { countWorkOf, cryptoWorkUnderWay } from "./cryptoWork";

/** A promise the test settles itself, and its functions to do so. */
function held<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** A made-up `SubtleCrypto` whose `sign` answers the promise the test gives it next. */
function madeUpSubtle(): {
  subtle: { sign: (...args: unknown[]) => Promise<unknown> };
  answers: Promise<unknown>[];
  calls: unknown[][];
} {
  const answers: Promise<unknown>[] = [];
  const calls: unknown[][] = [];
  const subtle = {
    sign: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      const answer = answers.shift();
      if (answer === undefined) throw new Error("No answer given to sign.");
      return answer;
    },
  };
  return { subtle, answers, calls };
}

test("countWorkOf counts an operation while it is under way, and gives its caller the operation's own answer", async () => {
  const { subtle, answers, calls } = madeUpSubtle();
  const answer = held<string>();
  answers.push(answer.promise);
  const work = countWorkOf(subtle);

  const signing = subtle.sign("HMAC", "key", "data");
  expect(work.underWay()).toBe(1);
  answer.resolve("the code");

  await expect(signing).resolves.toBe("the code");
  expect(work.underWay()).toBe(0);
  expect(calls).toEqual([["HMAC", "key", "data"]]);
});

test("countWorkOf counts a failed operation as ended, and its caller still sees the failure", async () => {
  const { subtle, answers } = madeUpSubtle();
  const answer = held<string>();
  answers.push(answer.promise);
  const work = countWorkOf(subtle);

  const signing = subtle.sign();
  answer.reject(new Error("The key does not sign."));

  await expect(signing).rejects.toThrow("The key does not sign.");
  expect(work.underWay()).toBe(0);
});

test("finished waits until the operations under way have ended", async () => {
  const { subtle, answers } = madeUpSubtle();
  const first = held<string>();
  const second = held<string>();
  answers.push(first.promise, second.promise);
  const work = countWorkOf(subtle);
  void subtle.sign();
  void subtle.sign();
  let finished = false;

  const waiting = work.finished().then(() => {
    finished = true;
  });
  first.resolve("one");
  for (let turn = 0; turn < 10; turn += 1) await realTurn();
  expect(finished, "with one operation still under way").toBe(false);
  second.resolve("two");

  await waiting;
  expect(finished).toBe(true);
});

test("finished fails when an operation has not ended within its limit", async () => {
  const { subtle, answers } = madeUpSubtle();
  answers.push(new Promise<never>(() => {}));
  const work = countWorkOf(subtle);
  void subtle.sign();

  await expect(work.finished(0)).rejects.toThrow(
    "1 crypto.subtle operation(s) still under way after 0 ms of real time.",
  );
});

test("countWorkOf on a target already counted replaces the earlier count, and the operation still runs once", async () => {
  const { subtle, answers, calls } = madeUpSubtle();
  answers.push(Promise.resolve("the code"));
  const earlier = countWorkOf(subtle);
  const later = countWorkOf(subtle);

  const signing = subtle.sign();
  expect([earlier.underWay(), later.underWay()]).toEqual([0, 1]);

  await expect(signing).resolves.toBe("the code");
  expect(calls).toHaveLength(1);
});

test("setup counts the operations started on the page's crypto.subtle", async () => {
  expect(window.crypto.subtle).toBe(globalThis.crypto.subtle);
  expect(self.crypto.subtle).toBe(globalThis.crypto.subtle);

  const digest = crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("made up"),
  );
  expect(cryptoWorkUnderWay()).toBe(1);

  expect((await digest).byteLength).toBe(32);
  expect(cryptoWorkUnderWay()).toBe(0);
});

test("timePasses waits for crypto work that ends after the turns it gives the app", async () => {
  startTestClock();
  // PBKDF2 with this many rounds keeps a thread of Node's pool busy far longer than the turns `timePasses(0)` gives.
  const keyingMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("made-up password"),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  let derived = false;
  void crypto.subtle
    .deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: new TextEncoder().encode("made-up salt"),
        iterations: 300_000,
      },
      keyingMaterial,
      256,
    )
    .then(() => {
      derived = true;
    });

  await timePasses(0);

  expect(derived).toBe(true);
});
