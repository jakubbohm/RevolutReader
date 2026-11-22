import { expect, test } from "vitest";
import { realTurn } from "./clock";
import { answerWith, noAnswerYet, timeline } from "./server";

// The test kit's own checks: the fake server (./server.ts) behaves as the app's tests rely on, also where Node and a
// browser differ.

// Why this test exists (#97): the app's API client wraps every call in a `Request` that follows the app's abort signal.
// In Node that link lasts only while something keeps the `Request` itself: a garbage collection that finds nothing
// keeping it cuts the link, and the app's later abort (its 60 s limit) never reaches the request, which then never ends.
// A browser keeps the link. So the fake server must keep every open request until it ends. This test leaves a request
// open, keeps nothing of it but the app's abort controller, forces a garbage collection, aborts, and expects the request
// to end as aborted.
test("An open request the app aborts still ends after a garbage collection", async () => {
  answerWith({ balance: noAnswerYet });
  const controller = new AbortController();

  // As the API client sends it: a `Request` made on the spot and kept by nobody here, only by the fake server.
  const ended = fetch(
    new Request(new URL("/api/balance", location.href), {
      signal: controller.signal,
    }),
  ).then(
    () => "answered",
    (error: unknown) => (error as Error).name,
  );
  await realTurns(5);
  expect(timeline()).toEqual(["request GET /api/balance"]);

  await collectGarbage();
  controller.abort();

  expect(await Promise.race([ended, stillWaitingAfter(50)])).toBe("AbortError");
  expect(timeline()).toEqual([
    "request GET /api/balance",
    "aborted GET /api/balance",
  ]);
});

async function realTurns(count: number): Promise<void> {
  for (let turn = 0; turn < count; turn += 1) await realTurn();
}

/**
 * Two full garbage collections, each followed by a real turn, so the clean-ups a collection schedules (Node's
 * `FinalizationRegistry` callbacks) run before the next step, and what they free is collected too.
 */
async function collectGarbage(): Promise<void> {
  const { gc } = globalThis as unknown as { gc?: () => void };
  if (typeof gc !== "function")
    throw new Error(
      "No gc() in the test worker: vite.config.ts must pass --expose-gc to it (test.execArgv).",
    );
  for (let round = 0; round < 2; round += 1) {
    gc();
    await realTurn();
  }
}

/** "still waiting" after `turns` real turns, so a request that never ends fails the test at once, not on its timeout. */
async function stillWaitingAfter(turns: number): Promise<string> {
  await realTurns(turns);
  return "still waiting";
}
