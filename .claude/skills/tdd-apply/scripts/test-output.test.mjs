// Tests for test-output.mjs's pure functions: the totals and the failed tests read from a test run's output, the
// short report `tdd.mjs run` prints, and what it says about the tests allowed to fail. The outputs are real ones,
// saved in fixtures/ with only the machine's folders replaced by D:\repo:
//
// - dotnet-test-passed.txt: `dotnet test --project tests/RevolutReader.UnitTests` in this repository (2026-11-23,
//   .NET SDK 11.0.100, TUnit 1.80.0 on Microsoft.Testing.Platform).
// - dotnet-test-failed.txt, dotnet-test-zero.txt, dotnet-build-error.txt, dotnet-test-timeout.txt: `dotnet test`
//   on a throwaway solution of TUnit projects with made-up tests, outside the repository, same SDK and TUnit: a
//   red run of two assemblies, a filter that matches nothing (exit 8), a compile error, and a test that ran out of
//   its time.
// - dotnet-exe-two-assemblies.txt: the same two projects' own executables run one after the other, the two outputs
//   joined: here each assembly prints a summary of its own.
// - dotnet-test-failed-transcript.txt: a red run of this repository's unit tests from an earlier session (c018),
//   as that session saw it, cut by its own `head` before the summary.
// - vitest-passed.txt: `npm --prefix src/RevolutReader.Web test -- <two files>` in this repository (Vitest 5.1.0).
// - vitest-failed.txt, vitest-failed-suite.txt, vitest-no-files.txt: the repository's Vitest on throwaway test
//   files outside it: failed tests next to a file that cannot be loaded, only such a file, and no file at all.
//
// Every test name and message in them is made up; none holds bank data.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { allowedFailuresLine, formatDuration, readTestOutput, runReport, stripAnsi } from "./test-output.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const crlf = (text) => text.replace(/\r?\n/g, "\r\n");
const lf = (text) => text.replace(/\r\n/g, "\n");

describe("readTestOutput on dotnet test (Microsoft.Testing.Platform, TUnit)", () => {
  test("reads a passing run's totals and no failed test", () => {
    const { totals, failed } = readTestOutput(fixture("dotnet-test-passed.txt"));

    assert.deepEqual(totals, { passed: 1220, failed: 0, skipped: 0 });
    assert.deepEqual(failed, []);
  });

  test("reads a red run of two assemblies: the one summary's totals for both", () => {
    const { totals } = readTestOutput(fixture("dotnet-test-failed.txt"));

    assert.deepEqual(totals, { passed: 3, failed: 4, skipped: 2 });
  });

  test("names each failed test, with its arguments and without its duration", () => {
    const { failed } = readTestOutput(fixture("dotnet-test-failed.txt"));

    assert.deepEqual(
      failed.map((f) => f.name),
      [
        "A_stub_is_not_written_yet",
        "A_case_ends_as_its_path_says(throws)",
        "A_list_holds_what_was_added",
        "A_test_that_writes_output_and_fails",
      ],
    );
  });

  test("gives each failed test's message up to where the assembly, the stack or the next test follows", () => {
    const { failed } = readTestOutput(fixture("dotnet-test-failed.txt"));

    assert.deepEqual(failed[0].message, [
      "[Test Failure] NotImplementedException: c000 tasks.md 1.1: the made-up stub.",
    ]);
    assert.deepEqual(failed[2].message, [
      "[Test Failure] ShouldAssertException: names",
      "should be",
      '["first", "second"]',
      "but was (case sensitive comparison)",
      '["first"]',
      "difference",
      '["first", *]',
      "Additional Info:",
      "both names are kept",
    ]);
    assert.deepEqual(failed[3].message, [
      "[Test Failure] ShouldAssertException: true",
      "should be",
      "False",
      "but was",
      "True",
    ]);
  });

  test("reads the same from CRLF and from LF output", () => {
    const text = fixture("dotnet-test-failed.txt");

    assert.deepEqual(readTestOutput(crlf(text)), readTestOutput(lf(text)));
  });

  test("adds up the summaries when each assembly prints its own", () => {
    const { totals, failed } = readTestOutput(fixture("dotnet-exe-two-assemblies.txt"));

    // Alpha: 7 tests, 4 failed, 2 succeeded, 1 skipped. Beta: 2 tests, 1 succeeded, 1 skipped.
    assert.deepEqual(totals, { passed: 3, failed: 4, skipped: 2 });
    assert.equal(failed.length, 4);
    assert.deepEqual(failed[0], {
      name: "A_stub_is_not_written_yet",
      message: [
        "TUnit.Engine.Exceptions.TestFailedException: [Test Failure] NotImplementedException: c000 tasks.md 1.1: the made-up stub.",
      ],
    });
  });

  test("reads a run in which no test ran as zero totals", () => {
    const { totals, failed } = readTestOutput(fixture("dotnet-test-zero.txt"));

    assert.deepEqual(totals, { passed: 0, failed: 0, skipped: 0 });
    assert.deepEqual(failed, []);
  });

  test("recognises nothing in a build error", () => {
    assert.deepEqual(readTestOutput(fixture("dotnet-build-error.txt")), { totals: null, failed: [] });
  });

  test("names the failed test of an output cut before its summary, and gives no totals", () => {
    const { totals, failed } = readTestOutput(fixture("dotnet-test-failed-transcript.txt"));

    assert.equal(totals, null);
    assert.equal(failed.length, 1);
    assert.equal(
      failed[0].name,
      "A_storage_failure_of_the_kept_balances_reads_nothing_at_the_bank_the_transactions_included",
    );
    assert.deepEqual(failed[0].message.slice(0, 3), [
      "[Test Failure] ShouldAssertException: thrown",
      "should satisfy all the conditions specified, but does not.",
      "The following errors were found ...",
    ]);
  });

  test("reads a test that ran out of time as a failed test, its message cut where the handler's stack starts", () => {
    const { totals, failed } = readTestOutput(fixture("dotnet-test-timeout.txt"));

    assert.deepEqual(totals, { passed: 1, failed: 1, skipped: 0 });
    assert.equal(failed.length, 1);
    assert.equal(failed[0].name, "A_test_that_takes_too_long");
    assert.equal(
      failed[0].message[0],
      "[Test Failure] TimeoutException: Test 'A_test_that_takes_too_long' timed out after 00:00:00.2000000",
    );
    assert.equal(
      failed[0].message.at(-1),
      "Note: This is the timeout handler's stack trace, not the blocked test's stack.",
    );
  });

  test("does not take an indented `failed` line, or one without a duration, for a failed test", () => {
    const text = [
      "failed A_real_one (12ms)",
      "  [Test Failure] ShouldAssertException: log",
      "    should contain",
      "failed to reach the made-up server",
      "  Standard output",
      "    failed An_indented_line (3ms)",
      "",
    ].join("\n");

    const { failed } = readTestOutput(text);

    assert.deepEqual(failed, [
      {
        name: "A_real_one",
        message: ["[Test Failure] ShouldAssertException: log", "should contain", "failed to reach the made-up server"],
      },
    ]);
  });

  test("reads a duration of minutes and seconds", () => {
    const { failed } = readTestOutput(
      "failed A_slow_one (1m 02s 345ms)\n  [Test Failure] TimeoutException: too slow\n",
    );

    assert.deepEqual(failed, [{ name: "A_slow_one", message: ["[Test Failure] TimeoutException: too slow"] }]);
  });
});

describe("readTestOutput on Vitest", () => {
  test("reads a passing run's totals and no failed test", () => {
    const { totals, failed } = readTestOutput(fixture("vitest-passed.txt"));

    assert.deepEqual(totals, { passed: 23, failed: 0, skipped: 0 });
    assert.deepEqual(failed, []);
  });

  test("reads a red run's totals: todo tests count as skipped, and a file that cannot be loaded is a failed suite", () => {
    const { totals } = readTestOutput(fixture("vitest-failed.txt"));

    // Tests  3 failed | 2 passed | 1 skipped | 1 todo (7), and "Failed Suites 1".
    assert.deepEqual(totals, { passed: 2, failed: 3, skipped: 2, failedSuites: 1 });
  });

  test("names the failed suite and each failed test by file and name, with the first paragraph of its message", () => {
    const { failed } = readTestOutput(fixture("vitest-failed.txt"));

    assert.deepEqual(failed, [
      {
        name: "src/gamma.test.js [ src/gamma.test.js ]",
        message: ["Error: Cannot find module './not-there.js' imported from D:/repo/vsample/src/gamma.test.js"],
      },
      {
        name: "src/alpha.test.js > a made-up group > a list holds what was added",
        message: ["AssertionError: expected [ 'first' ] to deeply equal [ 'first', 'second' ]"],
      },
      {
        name: "src/alpha.test.js > a made-up group > a stub is not written yet",
        message: ["Error: Not implemented: c000 tasks.md 1.1"],
      },
      {
        name: "src/alpha.test.js > a top-level test with a message",
        message: ["AssertionError: the flag is set: expected false to be true // Object.is equality"],
      },
    ]);
  });

  test("reads a run whose only file cannot be loaded: no tests, one failed suite", () => {
    const { totals, failed } = readTestOutput(fixture("vitest-failed-suite.txt"));

    assert.deepEqual(totals, { passed: 0, failed: 0, skipped: 0, failedSuites: 1 });
    assert.deepEqual(
      failed.map((f) => f.name),
      ["src/gamma.test.js [ src/gamma.test.js ]"],
    );
  });

  test("recognises nothing when no test file was found", () => {
    assert.deepEqual(readTestOutput(fixture("vitest-no-files.txt")), { totals: null, failed: [] });
  });

  test("reads output with terminal colours as without them", () => {
    const plain = fixture("vitest-failed.txt");
    const coloured = plain
      .replace(/^ FAIL  /gm, "\u001b[41m\u001b[1m FAIL \u001b[22m\u001b[49m ")
      .replace(/(\d+) failed/g, "\u001b[1m\u001b[31m$1 failed\u001b[39m\u001b[22m")
      .replace(/(\d+) passed/g, "\u001b[1m\u001b[32m$1 passed\u001b[39m\u001b[22m");

    assert.notEqual(coloured, plain);
    assert.deepEqual(readTestOutput(coloured), readTestOutput(plain));
  });
});

describe("readTestOutput on other output", () => {
  test("adds up a .NET and a Vitest summary in one output", () => {
    const { totals } = readTestOutput(fixture("dotnet-test-passed.txt") + fixture("vitest-failed.txt"));

    assert.deepEqual(totals, { passed: 1222, failed: 3, skipped: 2, failedSuites: 1 });
  });

  test("recognises nothing in an empty output or in other text", () => {
    assert.deepEqual(readTestOutput(""), { totals: null, failed: [] });
    assert.deepEqual(readTestOutput("Found 0 warnings and 0 errors.\nFinished in 1.2s\n"), {
      totals: null,
      failed: [],
    });
  });
});

describe("stripAnsi", () => {
  test("removes colour and cursor sequences and keeps the text", () => {
    assert.equal(
      stripAnsi("\u001b[1m\u001b[31m3 failed\u001b[39m\u001b[22m | \u001b[2K\u001b[1Gdone"),
      "3 failed | done",
    );
    assert.equal(stripAnsi("plain"), "plain");
  });
});

describe("formatDuration", () => {
  test("gives seconds to a tenth under a minute, then minutes and seconds, then hours", () => {
    assert.equal(formatDuration(0), "0.0s");
    assert.equal(formatDuration(940), "0.9s");
    assert.equal(formatDuration(12_340), "12.3s");
    assert.equal(formatDuration(59_940), "59.9s");
    assert.equal(formatDuration(60_000), "1m 00s");
    assert.equal(formatDuration(125_400), "2m 05s");
    assert.equal(formatDuration(3_723_000), "1h 02m 03s");
  });
});

describe("runReport", () => {
  const run = (overrides) => ({
    code: 0,
    durationMs: 12_340,
    logPath: "C:\\Temp\\tdd-runs\\c900\\x.log",
    output: "",
    ...overrides,
  });

  test("is one line for a green run: exit code, totals, duration and the log", () => {
    assert.deepEqual(runReport(run({ output: fixture("dotnet-test-passed.txt") })), [
      "exit 0 | 1220 passed, 0 failed, 0 skipped | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
    ]);
  });

  test("lists each failed test under the first line, with at most 3 lines of its message", () => {
    const lines = runReport(run({ code: 2, output: fixture("dotnet-test-failed.txt") }));

    assert.deepEqual(lines, [
      "exit 2 | 3 passed, 4 failed, 2 skipped | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
      "- A_stub_is_not_written_yet",
      "    [Test Failure] NotImplementedException: c000 tasks.md 1.1: the made-up stub.",
      "- A_case_ends_as_its_path_says(throws)",
      "    [Test Failure] ShouldAssertException: path",
      "    should be",
      '    "returns"',
      "- A_list_holds_what_was_added",
      "    [Test Failure] ShouldAssertException: names",
      "    should be",
      '    ["first", "second"]',
      "- A_test_that_writes_output_and_fails",
      "    [Test Failure] ShouldAssertException: true",
      "    should be",
      "    False",
    ]);
  });

  test("names Vitest's failed suites in the totals", () => {
    const lines = runReport(run({ code: 1, output: fixture("vitest-failed.txt") }));

    assert.equal(
      lines[0],
      "exit 1 | 2 passed, 3 failed, 2 skipped, 1 failed suite | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
    );
    assert.equal(lines[1], "- src/gamma.test.js [ src/gamma.test.js ]");
    assert.equal(lines.length, 1 + 4 * 2);
  });

  test("lists at most 25 failed tests, then how many more failed", () => {
    const blocks = Array.from(
      { length: 40 },
      (_, i) => `failed Test_${i + 1} (1ms)\n  [Test Failure] Exception: made up ${i + 1}\n`,
    );
    const summary =
      "Test run summary: Failed!\n  total: 45\n  failed: 40\n  succeeded: 5\n  skipped: 0\n  duration: 1s\n";

    const lines = runReport(run({ code: 2, output: blocks.join("") + summary }));

    assert.equal(lines[0], "exit 2 | 5 passed, 40 failed, 0 skipped | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log");
    assert.equal(lines.length, 1 + 25 * 2 + 1);
    assert.equal(lines[49], "- Test_25");
    assert.equal(lines[50], "    [Test Failure] Exception: made up 25");
    assert.equal(lines[51], "… and 15 more failed");
  });

  test("counts the failed tests it could not name among those not listed", () => {
    const output =
      "failed Test_1 (1ms)\n  [Test Failure] Exception: made up\nTest run summary: Failed!\n  total: 9\n  failed: 4\n  succeeded: 5\n  skipped: 0\n";

    const lines = runReport(run({ code: 2, output }));

    assert.deepEqual(lines.slice(1), ["- Test_1", "    [Test Failure] Exception: made up", "… and 3 more failed"]);
  });

  test("cuts a long name and a long message line", () => {
    const output = `failed ${"N".repeat(400)} (1ms)\n  ${"m".repeat(400)}\n`;

    const lines = runReport(run({ code: 2, output }));

    assert.equal(lines[1], `- ${"N".repeat(200)}…`);
    assert.equal(lines[2], `    ${"m".repeat(200)}…`);
  });

  test("prints the last 25 lines of the output when the run failed and no failed test is recognised", () => {
    const lines = runReport(run({ code: 1, output: fixture("dotnet-build-error.txt") }));

    assert.deepEqual(lines, [
      "exit 1 | totals not recognised | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
      "D:\\repo\\sample\\Beta.Tests\\BetaTests.cs(9,28): error CS1002: ; expected [D:\\repo\\sample\\Beta.Tests\\Beta.Tests.csproj]",
      "Build failed with exit code: 1.",
    ]);
  });

  test("prints only the last 25 lines of a long output, without its blank lines", () => {
    const output = Array.from({ length: 80 }, (_, i) => `line ${i + 1}\n\n`).join("");

    const lines = runReport(run({ code: 1, output }));

    assert.equal(lines.length, 26);
    assert.equal(lines[1], "line 56");
    assert.equal(lines[25], "line 80");
  });

  test("prints the tail for a run in which no test ran, after its zero totals", () => {
    const lines = runReport(run({ code: 8, output: fixture("dotnet-test-zero.txt") }));

    assert.equal(lines[0], "exit 8 | 0 passed, 0 failed, 0 skipped | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log");
    assert.ok(lines.includes("Test run summary: Zero tests ran"));
    assert.ok(lines.at(-1).startsWith("Test run completed with non-success exit code: 8."));
  });

  test("prints no tail for a green run it does not recognise", () => {
    assert.deepEqual(runReport(run({ output: "Found 0 warnings and 0 errors.\n" })), [
      "exit 0 | totals not recognised | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
    ]);
  });

  test("says when the run was stopped at its time limit", () => {
    const lines = runReport(run({ code: 124, timedOutAfterMinutes: 30, output: "still running\n" }));

    assert.deepEqual(lines, [
      "exit 124 (stopped after 30 min) | totals not recognised | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
      "still running",
    ]);
  });

  test("removes terminal colours from what it prints", () => {
    const lines = runReport(run({ code: 1, output: "\u001b[31merror\u001b[39m: made up\n" }));

    assert.equal(lines[1], "error: made up");
  });

  test("says nothing about allowed failures without a list, and for a green run with an empty one", () => {
    const red = fixture("dotnet-test-failed.txt");

    assert.equal(runReport(run({ code: 2, output: red })).length, 15);
    assert.equal(runReport(run({ code: 2, output: red, allowed: undefined })).length, 15);
    assert.equal(runReport(run({ output: fixture("dotnet-test-passed.txt"), allowed: [] })).length, 1);
    assert.equal(runReport(run({ output: fixture("vitest-passed.txt"), allowed: [] })).length, 1);
  });

  test("with a list, says on its second line which failed tests are on it and which are not", () => {
    const lines = runReport(
      run({ code: 2, output: fixture("dotnet-test-failed.txt"), allowed: ["A_stub_is_not_written_yet"] }),
    );

    assert.deepEqual(lines.slice(0, 3), [
      "exit 2 | 3 passed, 4 failed, 2 skipped | 12.3s | log: C:\\Temp\\tdd-runs\\c900\\x.log",
      "allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: A_case_ends_as_its_path_says(throws) | " +
        "A_list_holds_what_was_added | A_test_that_writes_output_and_fails",
      "- A_stub_is_not_written_yet",
    ]);
    assert.equal(lines.length, 16, "one line more than without a list");
  });

  test("with a list, says how many failed tests are on it also when the run failed otherwise", () => {
    const lines = runReport(run({ code: 1, output: fixture("dotnet-build-error.txt"), allowed: ["A_parked_test"] }));

    assert.equal(lines[1], "allowed failures: 0 of 0 failed tests are on the list");
    assert.equal(lines.at(-1), "Build failed with exit code: 1.");
  });
});

describe("allowedFailuresLine", () => {
  const failed = (...names) => ({ totals: null, failed: names.map((name) => ({ name, message: [] })) });
  const dotnet = readTestOutput(fixture("dotnet-test-failed.txt"));
  const vitest = readTestOutput(fixture("vitest-failed.txt"));

  test("says nothing when no test is listed and none failed", () => {
    assert.equal(allowedFailuresLine([], failed()), null);
    assert.equal(allowedFailuresLine([], readTestOutput(fixture("dotnet-test-passed.txt"))), null);
  });

  test("says that none failed when tests are listed and the run is green", () => {
    assert.equal(
      allowedFailuresLine(["A_parked_test"], readTestOutput(fixture("dotnet-test-passed.txt"))),
      "allowed failures: 0 of 0 failed tests are on the list",
    );
  });

  test("says only how many when every failed test is on the list", () => {
    const keys = [
      "A_stub_is_not_written_yet",
      "A_case_ends_as_its_path_says(throws)",
      "A_list_holds_what_was_added",
      "A_test_that_writes_output_and_fails",
    ];

    assert.equal(allowedFailuresLine(keys, dotnet), "allowed failures: 4 of 4 failed tests are on the list");
  });

  test("names, on the same line, the failed tests that are not on the list, also when the list is empty", () => {
    assert.equal(
      allowedFailuresLine(["A_list_holds_what_was_added"], dotnet),
      "allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: A_stub_is_not_written_yet | " +
        "A_case_ends_as_its_path_says(throws) | A_test_that_writes_output_and_fails",
    );
    assert.equal(
      allowedFailuresLine([], failed("A_made_up_test")),
      "allowed failures: 0 of 1 failed tests are on the list; NOT ALLOWED: A_made_up_test",
    );
  });

  test("is one line whatever it says", () => {
    for (const keys of [[], ["A_list_holds_what_was_added"], ["A_"]]) {
      assert.equal(allowedFailuresLine(keys, dotnet).includes("\n"), false);
    }
  });

  test("takes a key for a failed test whose printed name contains it, in the same case", () => {
    const one = (key) =>
      allowedFailuresLine([key], failed("Made.Up.Tests.A_case_ends_as_its_path_says(throws)")).split(";")[0];

    assert.equal(one("A_case_ends_as_its_path_says(throws)"), "allowed failures: 1 of 1 failed tests are on the list");
    assert.equal(one("A_case_ends"), "allowed failures: 1 of 1 failed tests are on the list");
    assert.equal(one("a_case_ends"), "allowed failures: 0 of 1 failed tests are on the list");
    assert.equal(one("A_case_ends_as_its_path_says(returns)"), "allowed failures: 0 of 1 failed tests are on the list");
  });

  test("lets one key cover every failed test that contains it, and counts a test once for several keys", () => {
    const run = failed("Group_A_first", "Group_A_second", "Group_B_first");

    assert.equal(
      allowedFailuresLine(["Group_A", "A_first", "Group_A_first"], run),
      "allowed failures: 2 of 3 failed tests are on the list; NOT ALLOWED: Group_B_first",
    );
  });

  test("reads Vitest's names the same: a test by its full name, a file that cannot be loaded by its own", () => {
    assert.equal(
      allowedFailuresLine(
        ["a made-up group > a stub is not written yet", "src/gamma.test.js [ src/gamma.test.js ]"],
        vitest,
      ),
      "allowed failures: 2 of 4 failed tests are on the list; NOT ALLOWED: " +
        "src/alpha.test.js > a made-up group > a list holds what was added | " +
        "src/alpha.test.js > a top-level test with a message",
    );
  });

  test("names at most 10 tests that are not allowed, then how many more there are", () => {
    const names = Array.from({ length: 14 }, (_, i) => `Test_${i + 1}`);

    assert.equal(
      allowedFailuresLine(["Test_14"], failed(...names)),
      `allowed failures: 1 of 14 failed tests are on the list; NOT ALLOWED: ${names.slice(0, 10).join(" | ")} | … and 3 more`,
    );
    assert.equal(
      allowedFailuresLine([], failed(...names.slice(0, 10))),
      `allowed failures: 0 of 10 failed tests are on the list; NOT ALLOWED: ${names.slice(0, 10).join(" | ")}`,
    );
  });

  test("counts the failed tests the output did not name as not allowed", () => {
    const cut = { totals: { passed: 5, failed: 4, skipped: 0 }, failed: failed("Test_1", "Test_2").failed };
    const unnamed = { totals: { passed: 5, failed: 3, skipped: 0 }, failed: [] };

    assert.equal(
      allowedFailuresLine(["Test_1"], cut),
      "allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: Test_2 | … and 2 more",
    );
    assert.equal(
      allowedFailuresLine(["Test_1", "Test_2"], cut),
      "allowed failures: 2 of 4 failed tests are on the list; NOT ALLOWED: 2 failed tests the output does not name",
    );
    assert.equal(
      allowedFailuresLine(["Test_1"], unnamed),
      "allowed failures: 0 of 3 failed tests are on the list; NOT ALLOWED: 3 failed tests the output does not name",
    );
  });

  test("cuts a long name", () => {
    assert.equal(
      allowedFailuresLine([], failed("N".repeat(400))),
      `allowed failures: 0 of 1 failed tests are on the list; NOT ALLOWED: ${"N".repeat(200)}…`,
    );
  });
});
