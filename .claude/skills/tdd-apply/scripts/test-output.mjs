// What `tdd.mjs run` reads from a test run's output: the totals and the failed tests, and the short report it
// prints in place of the output, with which of the failed tests are on the state file's list of tests allowed to
// fail (a parked task's or a blocked finding's red test). Nothing here runs anything or reads a file; the formats
// are those of real runs, saved next to the tests in fixtures/ (test-output.test.mjs says where each came from):
//
// - `dotnet test` on Microsoft.Testing.Platform with TUnit. A failed test is a `failed <name> (<duration>)` line at
//   the start of a line, then its message, then `from <assembly>`, the exception with the message again and the
//   stack. The run ends with a `Test run summary:` block of `total:`, `failed:`, `succeeded:` and `skipped:`
//   lines: one block for all assemblies under `dotnet test`, one per assembly when a test project's own executable
//   runs. Every block found is added up, which is right for both.
// - Vitest. A failed test is a ` FAIL  <file> > <name>` line, then its message; a file that cannot be loaded is a
//   failed suite, ` FAIL  <file> [ <file> ]`. The run ends with a `Test Files` line and a `Tests` line of
//   `<n> failed | <n> passed | <n> skipped | <n> todo (<all>)`, or `no tests`.

// Terminal control sequences: colours and cursor moves (CSI), window titles and links (OSC), and the two-character
// ones.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\^_]/g;

export function stripAnsi(text) {
  return text.replace(ANSI, "");
}

const linesOf = (output) => stripAnsi(output).split(/\r?\n/);

// A .NET duration as the platform prints it: (211ms), (10s 072ms), (1m 02s 345ms).
const DURATION = String.raw`\(\d+(?:h|ms|m|s)(?: \d+(?:h|ms|m|s))*\)`;
const DOTNET_FAILED = new RegExp(`^failed (.+) ${DURATION}$`);
// Where a .NET failed test's message ends: its assembly, a stack frame, its captured output, or what follows it
// (the next test, which `dotnet test` prints without a duration when it was skipped; an assembly's result; the
// summary).
const DOTNET_AFTER_MESSAGE = [
  /^\s+from .+\)$/,
  /^\s+at \S/,
  /^\s+--- TUnit internals omitted/,
  /^\s+(Standard|Error) output$/,
  new RegExp(`^(?:failed|passed) .+ ${DURATION}$`),
  /^skipped \S/,
  /\) (passed|failed with \d+ error\(s\)|Zero tests ran) \[\+\d+\/x\d+\/\?\d+\]/,
  /^(Test run summary:|Exit code: \d+$|Running tests from )/,
];

const VITEST_FAILED = /^\s*FAIL\s+(\S.*)$/;
// Where a Vitest failed test's message ends: a blank line (its first paragraph is the error itself; the diff and
// the code frame follow), a stack line, the separator, or what follows it.
const VITEST_AFTER_MESSAGE = [/^\s*$/, /^\s*❯ /, /^⎯+/, VITEST_FAILED, /^\s*Test Files\s/];

const MESSAGE_LINES_KEPT = 20; // more than the report prints; a message nothing ends stops here

// What the output of a test run says: `totals` ({ passed, failed, skipped }, and `failedSuites` when Vitest
// reports any), or null when the output holds no summary it knows; and `failed`, each failed test's `name` and
// the lines of its `message`, without their indent and without blank lines.
export function readTestOutput(output) {
  const lines = linesOf(output);
  const totals = [...dotnetSummaries(lines), ...vitestSummaries(lines)];
  return {
    totals: totals.length === 0 ? null : totals.reduce(added),
    failed: failedTests(lines),
  };
}

function added(sum, more) {
  const total = {
    passed: sum.passed + more.passed,
    failed: sum.failed + more.failed,
    skipped: sum.skipped + more.skipped,
  };
  const suites = (sum.failedSuites ?? 0) + (more.failedSuites ?? 0);
  return suites > 0 ? { ...total, failedSuites: suites } : total;
}

// One { passed, failed, skipped } per `Test run summary:` block: the block is the indented and blank lines after
// the heading, which under `dotnet test` also name each assembly.
function dotnetSummaries(lines) {
  const found = [];
  lines.forEach((line, i) => {
    if (!line.startsWith("Test run summary:")) return;
    const counts = {};
    for (let k = i + 1; k < lines.length && /^(\s|$)/.test(lines[k]); k++) {
      const count = /^\s+(total|failed|succeeded|skipped): (\d+)\s*$/.exec(lines[k]);
      if (count) counts[count[1]] = Number(count[2]);
    }
    if (counts.failed === undefined || counts.succeeded === undefined) return;
    found.push({ passed: counts.succeeded, failed: counts.failed, skipped: counts.skipped ?? 0 });
  });
  return found;
}

// One { passed, failed, skipped } per `Test Files` line with its `Tests` line: todo tests count as skipped, and
// the `Failed Suites <n>` headings before it give `failedSuites`.
function vitestSummaries(lines) {
  const found = [];
  let failedSuites = 0;
  lines.forEach((line, i) => {
    const suites = /^⎯+ Failed Suites (\d+) ⎯+$/.exec(line);
    if (suites) failedSuites += Number(suites[1]);
    if (!/^\s*Test Files\s{2,}\S/.test(line)) return;
    const tests = /^\s*Tests\s{2,}(\S.*)$/.exec(lines[i + 1] ?? "")?.[1];
    if (tests === undefined) return;
    const count = (word) => Number(new RegExp(`(\\d+) ${word}\\b`).exec(tests)?.[1] ?? 0);
    const totals = { passed: count("passed"), failed: count("failed"), skipped: count("skipped") + count("todo") };
    found.push(failedSuites > 0 ? { ...totals, failedSuites } : totals);
    failedSuites = 0;
  });
  return found;
}

function failedTests(lines) {
  const found = [];
  lines.forEach((line, i) => {
    const dotnet = DOTNET_FAILED.exec(line);
    const vitest = dotnet ? null : VITEST_FAILED.exec(line);
    if (!dotnet && !vitest) return;
    const ends = dotnet ? DOTNET_AFTER_MESSAGE : VITEST_AFTER_MESSAGE;
    const message = [];
    for (let k = i + 1; k < lines.length && message.length < MESSAGE_LINES_KEPT; k++) {
      // A blank line ends a Vitest message once it has begun; before that, and in a .NET message, it is skipped.
      if (!lines[k].trim() && (dotnet || message.length === 0)) continue;
      if (ends.some((r) => r.test(lines[k]))) break;
      message.push(lines[k].trim());
    }
    found.push({ name: (dotnet ?? vitest)[1].trim(), message });
  });
  return found;
}

// A duration for the report: seconds to a tenth under a minute, then minutes and seconds, then hours.
export function formatDuration(ms) {
  if (ms < 59_950) return `${(ms / 1000).toFixed(1)}s`;
  const seconds = Math.round(ms / 1000);
  const two = (n) => String(n).padStart(2, "0");
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60];
  return h > 0 ? `${h}h ${two(m)}m ${two(s)}s` : `${m}m ${two(s)}s`;
}

const FAILED_LISTED = 25; // the most failed tests the report names
const MESSAGE_LINES = 3; // the most lines of a failed test's message it prints
const TAIL_LINES = 25; // the lines of output it prints when the run failed and it could name no failed test
const WIDTH = 200; // where it cuts a name or a message line
const TAIL_WIDTH = 400; // where it cuts a line of the tail: a compiler's error line with its two paths fits
const NOT_ALLOWED_LISTED = 10; // the most failed tests it names as not allowed to fail

const cut = (text, width) => (text.length > width ? `${text.slice(0, width)}…` : text);

// How many tests failed: those the output names, or the summary's count when that is higher (an output cut short
// names fewer).
const failedCount = (totals, failed) => Math.max(failed.length, (totals?.failed ?? 0) + (totals?.failedSuites ?? 0));

// The one line a run's report says about the tests allowed to fail; null when it has nothing to say. `keys` are the
// keys of the state file's `Allowed failures` section; a key matches a failed test whose printed name contains
// it, in the same case.
// - Nothing, when no key is listed and no test failed.
// - Else `allowed failures: <k> of <n> failed tests are on the list`, in the same words for any count.
// - On the same line, when a failed test is not on the list: `; NOT ALLOWED: ` and those tests' names with ` | `
//   between them: at most 10, then `… and <m> more`, which also counts the failed tests the output did not name.
export function allowedFailuresLine(keys, { totals, failed }) {
  const all = failedCount(totals, failed);
  if (keys.length === 0 && all === 0) return null;
  const others = failed.filter((test) => !keys.some((key) => test.name.includes(key)));
  const line = `allowed failures: ${failed.length - others.length} of ${all} failed tests are on the list`;
  const unnamed = all - failed.length;
  if (others.length + unnamed === 0) return line;
  const named = others.slice(0, NOT_ALLOWED_LISTED).map((test) => cut(test.name, WIDTH));
  const more = others.length - named.length + unnamed;
  const rest = named.length === 0 ? `${more} failed tests the output does not name` : `… and ${more} more`;
  return `${line}; NOT ALLOWED: ${[...named, ...(more > 0 ? [rest] : [])].join(" | ")}`;
}

// The report of one run, as lines. `code` is the command's exit code, `timedOutAfterMinutes` is set when the run
// was stopped at its time limit, `output` is everything the command printed, and `allowed` holds the keys of the
// state file's `Allowed failures` section, or is left out when there is no state file to read them from.
// - Line 1: `exit <code> | <totals> | <duration> | log: <path>`.
// - Line 2, with `allowed`: what `allowedFailuresLine` says, when it says anything.
// - Then up to 25 failed tests, each as `- <name>` and at most 3 lines of its message, and `… and <k> more failed`
//   for the rest, counting those the summary reports and the output did not name.
// - Or, when the exit code is not 0 and no failed test was recognised (a build error, a lint error, no test run):
//   the last 25 lines of the output, without blank lines.
export function runReport({ code, timedOutAfterMinutes, durationMs, logPath, output, allowed }) {
  const { totals, failed } = readTestOutput(output);
  const exit =
    timedOutAfterMinutes === undefined ? `exit ${code}` : `exit ${code} (stopped after ${timedOutAfterMinutes} min)`;
  const lines = [`${exit} | ${totalsText(totals)} | ${formatDuration(durationMs)} | log: ${logPath}`];
  const onAllowed = allowed === undefined ? null : allowedFailuresLine(allowed, { totals, failed });
  if (onAllowed !== null) lines.push(onAllowed);
  const listed = failed.slice(0, FAILED_LISTED);
  for (const test of listed) {
    lines.push(
      `- ${cut(test.name, WIDTH)}`,
      ...test.message.slice(0, MESSAGE_LINES).map((l) => `    ${cut(l, WIDTH)}`),
    );
  }
  if (failed.length > 0) {
    const all = failedCount(totals, failed);
    if (all > listed.length) lines.push(`… and ${all - listed.length} more failed`);
  } else if (code !== 0) {
    const printed = linesOf(output).filter((l) => l.trim());
    lines.push(...printed.slice(-TAIL_LINES).map((l) => cut(l.trimEnd(), TAIL_WIDTH)));
  }
  return lines;
}

function totalsText(totals) {
  if (!totals) return "totals not recognised";
  const suites = totals.failedSuites
    ? `, ${totals.failedSuites} failed suite${totals.failedSuites === 1 ? "" : "s"}`
    : "";
  return `${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped${suites}`;
}
