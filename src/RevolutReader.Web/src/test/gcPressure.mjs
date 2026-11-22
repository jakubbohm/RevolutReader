// Memory pressure for the frontend's tests: a full garbage collection every 5 ms in every Vitest worker this file is
// preloaded into. A diagnostic run by hand, never in CI or `npm test` (lesson R-99, docs/software-factory/lessons.md).
//
// Why: a test can depend, without showing it, on something only a weak reference keeps, such as the link from the
// app's abort signal to Node's `Request` (R-99). It then fails only when a collection lands while it waits: now and
// then in a full run, where memory pressure brings one, and never when run alone. A collection every few milliseconds
// makes such a failure show on every run, so a test that fails only in full runs is reproduced here first, and a fix is
// proven here. The kit's self-test (server.test.ts) guards the case R-99 found in every normal run. V8's own
// `--gc-interval` does nothing in Node's release builds, hence the timer.
//
// Running it, from this project's folder (from the repository root, add `--prefix src/RevolutReader.Web` after `npm`):
//   npm run test:gc-pressure                the whole suite: about 14 minutes instead of seconds
//   npm run test:gc-pressure -- <file> …    chosen test files: from a second to about a minute each
// The script gives every worker `--expose-gc`, for `gc()`, and this file, and each test up to 10 minutes. It passes
// `--expose-gc` again because Vitest's `--execArgv` replaces `test.execArgv` in vite.config.ts rather than adding to it.
// Each worker writes one line to stderr when it starts, so a run shows the pressure was on.

if (typeof globalThis.gc !== "function")
  throw new Error(
    "gcPressure.mjs needs --expose-gc in the test workers: run it with `npm run test:gc-pressure`.",
  );

const collectGarbage = globalThis.gc;
// unref: the timer never keeps a worker alive once its tests are done.
setInterval(() => collectGarbage(), 5).unref();
process.stderr.write("[gcPressure] a full garbage collection every 5 ms\n");
