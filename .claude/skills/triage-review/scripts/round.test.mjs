// Tests for common.mjs's round functions, the rules for restarting a triage round that stopped part-way: which
// numbers a summary lists, when a summary is refused for listing none, and which round this is, the outcome a
// thread's reply gives, what a commit is in the fix of its finding or findings, the guard tests a red commit's body
// names, whether the commits after the PR's head are all this round's own, the class of every finding of the round
// (each class, each commit shape, the numbering across rounds, the findings carried over from an earlier round, a
// commit for several findings and every unclear case), the lines the gather prints for them, and how git's output
// becomes commits.
// Nothing here calls gh, git or the network; the findings, replies, summaries and commits are small made-up objects,
// and every scope, path, name and commit id is made up.
//
//   node --test ".claude/skills/triage-review/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  GIT_LOG_FORMAT,
  classifyRound,
  commitsFromGitLog,
  guardTests,
  ownCommits,
  replyOutcome,
  roundCommit,
  roundLines,
  roundOf,
  summaryNumbers,
  summaryRefusal,
} from "./common.mjs";

// A made-up time: 2026-11-20 at `hour` o'clock UTC.
const at = (hour) => `2026-11-20T${String(hour).padStart(2, "0")}:00:00Z`;

// A made-up finding as findingsFrom's `all` holds it: a numbered top-level review comment, its thread open and
// without replies unless a test says otherwise.
function finding(id, overrides = {}) {
  return {
    id,
    commentId: 9000 + id,
    path: "src/example.mjs",
    line: 10 + id,
    title: `Finding ${id}`,
    body: `Finding ${id}\nMore detail.`,
    author: "a-reviewer",
    url: `https://github.com/example/repo/pull/1#discussion_r${9000 + id}`,
    resolved: false,
    replies: [],
    ...overrides,
  };
}
const open = (id, ...replies) => finding(id, { replies });
const resolved = (id, ...replies) => finding(id, { resolved: true, replies });
// A made-up reply in a finding's thread, posted at `hour` o'clock.
const reply = (body, hour = 12) => ({ body, createdAt: at(hour), author: "the-owner" });

// A made-up commit id whose first seven characters are the number `n`, so a test can name a commit by it.
const sha = (n) => `${String(n).padStart(7, "0")}${"f".repeat(33)}`;
const short = (n) => String(n).padStart(7, "0");
// A made-up commit after the PR's head, as commitsFromGitLog gives it.
const commit = (n, subject, extra = {}) => ({ sha: sha(n), subject, body: "", files: [], ...extra });
// The round's commit shapes for finding `id`, in the made-up scope c900; `id` may also be a list such as "3, 7", for
// findings fixed together. A red commit's body may name its guard tests.
const plan = (n, id) => commit(n, `docs(c900): [plan] ${id}: the spec names both cases`);
const red = (n, id, files = [], body = "") =>
  commit(n, `test(c900): [review] ${id}: rounds a half up, red`, { files, body });
const fix = (n, id) => commit(n, `fix(c900): [review] ${id}: round a half up`);
const guardPasses = (n, id) => commit(n, `test(c900): [review] ${id}: guard, passes`);
const guardRemoved = (n, id, how, body = "") =>
  commit(n, `test(c900): [review] ${id}: guard removed, ${how}`, { body });
const headsUp = (n, id) => commit(n, `docs(c900): [review] ${id}: heads-up for C12`);
const testFix = (n, id) => commit(n, `test(c900): [review] ${id}: assert the outcome, not the call`);
const docsFix = (n, id) => commit(n, `docs(c900): [review] ${id}: name the right section`);
const cleanup = (n, id) => commit(n, `refactor(c900): [review] ${id}: drop the unused helper`);
// The repair of a close check that a commit of the finding broke: in production code the implementer's
// (`refactor`, or `fix` for one the owner ordered that changes what the code does), in test code the test-writer's
// (`test`).
const repair = (n, id, check = "lint", type = "refactor") =>
  commit(n, `${type}(c900): [review] ${id}: close check ${check} repaired`);

// classifyRound on made-up data: round 1 (no earlier summary) unless a test gives the earlier rounds' numbers.
function classify(findings, commits = [], { earlierNumbers = [], lastSummaryAt = null } = {}) {
  return classifyRound({ findings, earlierNumbers, commits, lastSummaryAt });
}
// The one record a classification of one finding gives.
function only(result) {
  assert.equal(result.findings.length, 1, `expected one finding, got ${JSON.stringify(result.findings)}`);
  return result.findings[0];
}
const classOf = (result, id) => result.findings.find((f) => f.id === id)?.class;
const shortShas = (record) => record.commits.map((c) => c.sha.slice(0, 7));

// A made-up triage summary as a round posts it: the heading, the findings table with the given first cells, and the
// counts below it.
function summary(heading, firstCells) {
  return [
    heading,
    "",
    `${firstCells.length} findings.`,
    "",
    "| # | Finding | Outcome | Evidence or commit |",
    "|---|---|---|---|",
    ...firstCells.map((cell) => `| ${cell} | A made-up finding | FIX | \`0123abc\` |`),
    "",
    "Fixed 2, declined 1. Checks: 249 tests passed.",
  ].join("\n");
}
// A made-up PR comment (an issue comment) as the REST API returns it.
const issueComment = (id, hour, body) => ({
  id,
  body,
  created_at: at(hour),
  html_url: `https://github.com/example/repo/pull/1#issuecomment-${id}`,
});

describe("summaryNumbers", () => {
  test("lists the numbers in the first column of the findings table", () => {
    assert.deepEqual(summaryNumbers(summary("## Review triage", [1, 2, 3, 10, 13])), [1, 2, 3, 10, 13]);
  });

  test("gives them ascending and each once, whatever the rows' order", () => {
    assert.deepEqual(summaryNumbers(summary("## Review triage", [9, 2, 11, 2])), [2, 9, 11]);
  });

  test("reads a table whose other columns are named differently", () => {
    const body = ["## Review triage, round 2", "", "| # | Finding | Outcome | Commit |", "|---|---|---|---|"];
    body.push("| 16 | One | FIX | `0123abc` |", "| 17 | Two | ASK | undecided |");

    assert.deepEqual(summaryNumbers(body.join("\n")), [16, 17]);
  });

  test("reads a summary with Windows line endings", () => {
    assert.deepEqual(summaryNumbers(summary("## Review triage", [4, 5]).replace(/\n/g, "\r\n")), [4, 5]);
  });

  test("reads a cell that lists several numbers, a range, or a number in emphasis", () => {
    assert.deepEqual(
      summaryNumbers(summary("## Review triage", ["3, 7", "10-12", "**14**", "`15`"])),
      [3, 7, 10, 11, 12, 14, 15],
    );
  });

  test("lists none for a row whose first cell is not a number", () => {
    assert.deepEqual(summaryNumbers(summary("## Review triage", ["n/a", "2 of 3", "5-3", "0", 6])), [6]);
  });

  test("reads neither the rows of another table nor the numbers in the text around the tables", () => {
    const body = [
      "## Review triage",
      "",
      "13 findings, 249 tests.",
      "",
      "| # | Finding | Outcome | Evidence or commit |",
      "|---|---|---|---|",
      "| 1 | One | FIX | `0123abc` |",
      "| 2 | Two | DECLINE | design.md D4 |",
      "",
      "| Check | Result |",
      "|---|---|",
      "| 249 | tests passed |",
      "| 40 | files formatted |",
    ].join("\n");

    assert.deepEqual(summaryNumbers(body), [1, 2]);
  });

  test("lists none for a summary without a findings table", () => {
    assert.deepEqual(summaryNumbers("## Review triage\n\nNothing was left to triage: 3 threads, all resolved."), []);
    assert.deepEqual(summaryNumbers("## Review triage\n\n| Finding | Outcome |\n|---|---|\n| 4 | FIX |"), []);
  });
});

describe("summaryRefusal", () => {
  test("lets a summary through whose findings table lists at least one number", () => {
    assert.equal(summaryRefusal(summary("## Review triage", [1, 2, 3])), null);
    assert.equal(summaryRefusal(summary("## Review triage, round 2", ["6, 7"])), null);
    assert.equal(summaryRefusal(summary("## Review triage", [4]).replace(/\n/g, "\r\n")), null);
  });

  test("refuses a summary without a findings table, saying what the table needs and why", () => {
    const refusal = summaryRefusal("## Review triage, round 2\n\nAll five findings fixed; see the threads.");

    assert.equal(typeof refusal, "string");
    assert.match(refusal, /^lists no finding number/);
    assert.match(refusal, /\| # \|/);
    assert.match(refusal, /next round/);
    assert.doesNotMatch(refusal, /\n/);
  });

  test("refuses a summary whose table has no heading row that starts with #, or no row that starts with one", () => {
    const noHash = "## Review triage\n\n| Finding | Outcome |\n|---|---|\n| 4 | FIX |";
    const noNumbers = summary("## Review triage", ["n/a", "the first one", ""]);
    const numbersInTheTextOnly = "## Review triage\n\n3 findings: 1 fixed, 2 declined.\n\n| # | Finding |\n|---|---|";

    for (const body of [noHash, noNumbers, numbersInTheTextOnly]) {
      assert.match(summaryRefusal(body), /^lists no finding number/, body);
    }
  });

  test("refuses exactly the summaries a later round could not read the numbers from", () => {
    const bodies = [
      summary("## Review triage", [1, 2]),
      "## Review triage\n\nNothing listed.",
      summary("## Review triage, round 3", ["8-10"]),
      "## Review triage\n\n| Check | Result |\n|---|---|\n| 249 | tests passed |",
    ];
    for (const body of bodies) {
      const comments = [issueComment(5101, 9, body)];
      const refused = summaryRefusal(body) !== null;

      if (refused) assert.throws(() => roundOf(comments), body);
      else assert.doesNotThrow(() => roundOf(comments), body);
    }
  });
});

describe("roundOf", () => {
  test("is round 1, with no earlier numbers, on a PR without a summary", () => {
    const comments = [issueComment(5001, 9, "Looks good so far."), issueComment(5002, 10, "A question.")];

    assert.deepEqual(roundOf(comments), {
      round: 1,
      summaries: 0,
      earlierNumbers: [],
      highestNumber: 0,
      lastSummaryAt: null,
    });
    assert.equal(roundOf([]).round, 1);
  });

  test("is the number of summaries plus one, whatever the comments' order", () => {
    const comments = [
      issueComment(5013, 14, summary("## Review triage, round 2", [6, 7])),
      issueComment(5012, 12, "A question about round one."),
      issueComment(5011, 9, summary("## Review triage", [1, 2, 3, 4, 5])),
    ];

    const round = roundOf(comments);

    assert.equal(round.round, 3);
    assert.equal(round.summaries, 2);
  });

  test("lists the numbers of every earlier round's summary, and the highest of them", () => {
    const comments = [
      issueComment(5021, 9, summary("## Review triage", [1, 2, 3, 4, 5])),
      issueComment(5022, 14, summary("## Review triage, round 2", [4, 6, 7])),
    ];

    const round = roundOf(comments);

    assert.deepEqual(round.earlierNumbers, [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(round.highestNumber, 7);
  });

  test("says when the last summary was posted", () => {
    const comments = [
      issueComment(5032, 14, summary("## Review triage, round 2", [6])),
      issueComment(5031, 9, summary("## Review triage", [1, 2])),
      issueComment(5033, 16, "Thanks."),
    ];

    assert.equal(roundOf(comments).lastSummaryAt, at(14));
  });

  test("counts only a comment that starts with the summary heading", () => {
    const comments = [
      issueComment(5041, 9, summary("## Review triage", [1, 2])),
      issueComment(5042, 11, "Before the next round:\n## Review triage\n| # |\n|---|\n| 99 |"),
    ];

    const round = roundOf(comments);

    assert.equal(round.round, 2);
    assert.deepEqual(round.earlierNumbers, [1, 2]);
  });

  test("a rerun of a round that stopped before its summary has that round's number again", () => {
    const afterRoundOne = [issueComment(5051, 9, summary("## Review triage", [1, 2, 3]))];

    // Round 2 started, replied in threads and committed, but posted no summary: the PR's comments are unchanged.
    assert.equal(roundOf(afterRoundOne).round, 2);
  });

  test("fails rather than guess the earlier rounds' numbers when a summary lists none, naming that summary", () => {
    const comments = [
      issueComment(5061, 9, summary("## Review triage", [1, 2, 3])),
      issueComment(5062, 14, "## Review triage, round 2\n\nAll five findings fixed; see the threads."),
    ];

    assert.throws(() => roundOf(comments), /issuecomment-5062/);
  });
});

describe("replyOutcome", () => {
  test("reads each outcome from how the reply starts", () => {
    assert.equal(replyOutcome("Fixed in `0123abc`: the heading; guard test `Rounds_a_half_up`"), "fixed");
    assert.equal(replyOutcome("Declined: design.md D4 decides this."), "declined");
    assert.equal(replyOutcome("Declined by the owner: two small files are fine."), "declined by the owner");
    assert.equal(replyOutcome("Deferred to the issue 123, by the owner."), "deferred");
  });

  test("reads a reply that is only the outcome's words, or has blank lines and spaces before them", () => {
    assert.equal(replyOutcome("Declined by the owner."), "declined by the owner");
    assert.equal(replyOutcome("Declined"), "declined");
    assert.equal(replyOutcome("\r\n  Fixed in 0123abc. The table is sorted now."), "fixed");
  });

  test("gives no outcome for any other reply", () => {
    assert.equal(replyOutcome("Fixed as the owner decided: keep both."), null);
    assert.equal(replyOutcome("The owner chose the narrow fix."), null);
    assert.equal(replyOutcome("Open question for the owner: is the old behaviour wanted?"), null);
    assert.equal(replyOutcome("Was this Declined: before?"), null);
    assert.equal(replyOutcome("Deferredness is not a word."), null);
    assert.equal(replyOutcome("fixed in 0123abc"), null);
    assert.equal(replyOutcome(""), null);
    assert.equal(replyOutcome(undefined), null);
  });
});

describe("roundCommit", () => {
  const kindOf = (subject) => roundCommit(subject)?.kind;

  test("reads the type, the scope, the tag, the finding's number and the summary", () => {
    assert.deepEqual(roundCommit("fix(c900): [review] 12: round a half up"), {
      type: "fix",
      scope: "c900",
      tag: "review",
      ids: [12],
      summary: "round a half up",
      kind: "fix",
    });
    assert.deepEqual(roundCommit("docs(i67): [plan] 3: the spec names both cases").ids, [3]);
  });

  test("reads several numbers separated by commas, with or without spaces, as one commit for each finding", () => {
    assert.deepEqual(roundCommit("fix(c900): [review] 3, 7: round a half up"), {
      type: "fix",
      scope: "c900",
      tag: "review",
      ids: [3, 7],
      summary: "round a half up",
      kind: "fix",
    });
    assert.deepEqual(roundCommit("test(c900): [review] 3,7,12: rounds a half up, red").ids, [3, 7, 12]);
    assert.deepEqual(roundCommit("docs(c900): [plan] 12 , 3: the spec names both cases").ids, [12, 3]);
    assert.equal(roundCommit("test(c900): [review] 3, 7: rounds a half up, red").kind, "red");
    assert.equal(roundCommit("docs(c900): [plan] 3, 7: the spec names both cases").kind, "plan");
    assert.equal(roundCommit("test(c900): [review] 3, 7: guard removed, declined").kind, "guard removed, declined");
  });

  test("lists a number given twice once", () => {
    assert.deepEqual(roundCommit("fix(c900): [review] 3, 7, 3: round a half up").ids, [3, 7]);
  });

  test("refuses an id that is neither a number nor a list of numbers", () => {
    const subjects = [
      "fix(c900): [review] E12: round a half up",
      "fix(c900): [review] 3, E12: round a half up",
      "fix(c900): [review] 3 and 7: round a half up",
      "fix(c900): [review] 3-7: round a half up",
      "fix(c900): [review] 3 7: round a half up",
      "fix(c900): [review] 3,: round a half up",
      "fix(c900): [review] , 3: round a half up",
      "fix(c900): [review] 3; 7: round a half up",
      "docs(c900): [plan] B-1, 3: the spec names both cases",
    ];
    for (const subject of subjects) assert.equal(roundCommit(subject), null, subject);
  });

  test("names every commit shape of a fix round", () => {
    assert.equal(kindOf("docs(c900): [plan] 4: the spec names both cases"), "plan");
    assert.equal(kindOf("test(c900): [review] 4: rounds a half up, red"), "red");
    assert.equal(kindOf("test(c900): [review] 4: guard, passes"), "guard passes");
    assert.equal(kindOf("test(c900): [review] 4: guard removed, declined"), "guard removed, declined");
    assert.equal(kindOf("test(c900): [review] 4: guard removed, deferred"), "guard removed, deferred");
    assert.equal(kindOf("test(c900): [review] 4: assert the outcome, not the call"), "test fix");
    assert.equal(kindOf("fix(c900): [review] 4: round a half up"), "fix");
    assert.equal(kindOf("docs(c900): [review] 4: heads-up for C12"), "heads-up");
    assert.equal(kindOf("docs(c900): [review] 4: name the right section"), "docs fix");
    assert.equal(kindOf("refactor(c900): [review] 4: drop the unused helper"), "cleanup");
  });

  test("names the repair of a close check by its summary, in production code and in test code", () => {
    assert.equal(kindOf("refactor(c900): [review] 4: close check lint repaired"), "repair");
    assert.equal(kindOf("test(c900): [review] 4: close check format:check repaired"), "repair");
    assert.equal(kindOf("refactor(c900): [review] 4: close check dotnet format repaired"), "repair");
    assert.equal(kindOf("refactor(c900): [review] 3, 7: close check typecheck repaired"), "repair");
  });

  test("names a repair by its summary whatever the commit's type: the fix of one the owner ordered, and any other", () => {
    assert.equal(kindOf("fix(c900): [review] 4: close check dotnet test repaired"), "repair");
    assert.equal(kindOf("fix(c900): [review] 3, 7: close check npm test repaired"), "repair");
    assert.equal(kindOf("docs(c900): [review] 4: close check lint repaired"), "repair");
    assert.equal(kindOf("feat(c900): [review] 4: close check lint repaired"), "repair");
    assert.equal(kindOf("chore(c900): [review] 4: close check lint repaired"), "repair");
  });

  test("takes only that exact summary, of a [review] commit, for a repair", () => {
    assert.equal(kindOf("refactor(c900): [review] 4: close check repaired"), "cleanup");
    assert.equal(kindOf("refactor(c900): [review] 4: close check lint repaired, and more"), "cleanup");
    assert.equal(kindOf("refactor(c900): [review] 4: the close check lint repaired"), "cleanup");
    assert.equal(kindOf("test(c900): [review] 4: close checks repaired"), "test fix");
    assert.equal(kindOf("fix(c900): [review] 4: close check repaired"), "fix");
    assert.equal(kindOf("fix(c900): [review] 4: the close check dotnet test repaired"), "fix");
    assert.equal(kindOf("docs(c900): [review] 4: close check lint repaired in the docs"), "docs fix");
    assert.equal(kindOf("feat(c900): [review] 4: close check lint"), "unknown");
    assert.equal(kindOf("docs(c900): [plan] 4: close check lint repaired"), "plan");
    assert.equal(kindOf("fix(c900): [plan] 4: close check lint repaired"), "unknown");
  });

  test("takes only a test commit whose summary ends with `, red` for a red commit", () => {
    assert.equal(kindOf("test(c900): [review] 4: the red badge has a test"), "test fix");
    assert.equal(kindOf("docs(c900): [review] 4: say what happens, red"), "docs fix");
    assert.equal(kindOf("test(c900): [review] 4: guard removed"), "test fix");
  });

  test("calls a numbered commit of any other type unknown", () => {
    assert.equal(kindOf("feat(c900): [review] 4: a new setting"), "unknown");
    assert.equal(kindOf("chore(c900): [review] 4: tidy up"), "unknown");
    assert.equal(kindOf("test(c900): [plan] 4: the spec names both cases"), "unknown");
  });

  test("gives nothing for any other subject", () => {
    assert.equal(roundCommit("docs(c900): [review] triage summary"), null);
    assert.equal(roundCommit('Revert "test(c900): [review] 4: rounds a half up, red"'), null);
    assert.equal(roundCommit("fix(c900): [green] 4: round a half up"), null);
    assert.equal(roundCommit("fix(c900): [chapter-review] B-1: round a half up"), null);
    assert.equal(roundCommit("fix: [review] 4: no scope"), null);
    assert.equal(roundCommit("fix(c900): [review] 4:"), null);
    assert.equal(roundCommit("Merge branch 'main' into feat/example"), null);
    assert.equal(roundCommit(undefined), null);
  });
});

describe("guardTests", () => {
  test("gives none for a body without such a line", () => {
    assert.deepEqual(guardTests(""), []);
    assert.deepEqual(guardTests(undefined), []);
    assert.deepEqual(guardTests("The test reproduces the finding.\n\nIt fails at the assertion."), []);
  });

  test("reads the test's full name from a line `Guard test: <name>`", () => {
    assert.deepEqual(guardTests("Guard test: Example.Tests.RoundingTests.Rounds_a_half_up"), [
      "Example.Tests.RoundingTests.Rounds_a_half_up",
    ]);
  });

  test("reads several lines, in the body's order, among other text", () => {
    const body = [
      "The two tests reproduce the finding.",
      "",
      "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up",
      "Guard test: src/money.test.ts > money > rounds a half up",
      "",
      "Both fail at the assertion.",
    ].join("\n");

    assert.deepEqual(guardTests(body), [
      "Example.Tests.RoundingTests.Rounds_a_half_up",
      "src/money.test.ts > money > rounds a half up",
    ]);
  });

  test("keeps a name whole, with its spaces, colons, commas and brackets", () => {
    assert.deepEqual(guardTests('Guard test: Rounds(amount: 2.5, mode: "half up") [case 3]'), [
      'Rounds(amount: 2.5, mode: "half up") [case 3]',
    ]);
  });

  test("reads a body with Windows line endings, indented lines and spaces around the name", () => {
    assert.deepEqual(guardTests("  Guard test:   Example.A  \r\n\tGuard test:Example.B\r\n"), [
      "Example.A",
      "Example.B",
    ]);
  });

  test("gives a name that is there twice once", () => {
    assert.deepEqual(guardTests("Guard test: Example.A\nGuard test: Example.B\nGuard test: Example.A"), [
      "Example.A",
      "Example.B",
    ]);
  });

  test("takes only a line that starts with exactly `Guard test:` and names a test", () => {
    const body = [
      "Guard tests: Example.A",
      "guard test: Example.B",
      "The Guard test: Example.C",
      "Guard test:",
      "Guard test:   ",
      "Guard-test: Example.D",
    ].join("\n");

    assert.deepEqual(guardTests(body), []);
  });
});

describe("ownCommits", () => {
  test("no commits after the PR's head are all the round's own", () => {
    assert.deepEqual(ownCommits([], [1, 2, 3]), { count: 0, allOwn: true, notOwn: [] });
  });

  test("review and plan commits numbered above the earlier rounds' highest number are the round's own", () => {
    const commits = [plan(1, 6), red(2, 6), fix(3, 6), docsFix(4, 7), guardRemoved(5, 8, "declined")];

    assert.deepEqual(ownCommits(commits, [1, 2, 3, 4, 5]), { count: 5, allOwn: true, notOwn: [] });
  });

  test("in round 1 every numbered review or plan commit is the round's own", () => {
    assert.equal(ownCommits([red(1, 1), fix(2, 1), plan(3, 2)], []).allOwn, true);
  });

  test("names a commit numbered at or below the earlier rounds' highest number, and why", () => {
    const commits = [red(1, 6), fix(2, 5), plan(3, 3)];

    const { count, allOwn, notOwn } = ownCommits(commits, [1, 2, 3, 4, 5]);

    assert.equal(count, 3);
    assert.equal(allOwn, false);
    assert.deepEqual(
      notOwn.map((c) => [c.sha, c.subject]),
      [
        [sha(2), "fix(c900): [review] 5: round a half up"],
        [sha(3), "docs(c900): [plan] 3: the spec names both cases"],
      ],
    );
    assert.match(notOwn[0].why, /\b5\b.*\bnot above 5\b/);
    assert.match(notOwn[1].why, /\b3\b.*\bnot above 5\b/);
    assert.equal(
      notOwn[0].why,
      "finding 5 is not above 5, the highest number an earlier round's summary lists, and is not carried into this " +
        "round",
    );
  });

  test("the commits of an earlier round's finding carried into this round are the round's own", () => {
    const commits = [plan(1, 3), red(2, 3), fix(3, 3), docsFix(4, 5), red(5, 6)];

    assert.deepEqual(ownCommits(commits, [1, 2, 3, 4, 5], [3, 5]), { count: 5, allOwn: true, notOwn: [] });
  });

  test("names the commits of an earlier round's finding that is not carried, beside those of one that is", () => {
    const commits = [red(1, 3), fix(2, 3), fix(3, 4), docsFix(4, 2)];

    const { allOwn, notOwn } = ownCommits(commits, [1, 2, 3, 4, 5], [3]);

    assert.equal(allOwn, false);
    assert.deepEqual(
      notOwn.map((c) => c.sha),
      [sha(3), sha(4)],
    );
    assert.match(notOwn[0].why, /^finding 4 is not above 5, .* and is not carried into this round$/);
  });

  test("a commit for several findings is the round's own when every one of them is this round's", () => {
    const earlierNumbers = [1, 2, 3, 4, 5];

    assert.equal(ownCommits([fix(1, "6, 7")], earlierNumbers).allOwn, true);
    assert.equal(ownCommits([fix(1, "3, 7")], earlierNumbers, [3]).allOwn, true);
    assert.equal(ownCommits([red(1, "3,4"), fix(2, "3,4")], earlierNumbers, [3, 4]).allOwn, true);
    assert.equal(ownCommits([fix(1, "1, 2")], []).allOwn, true);
  });

  test("a commit for several findings is not the round's own when one of them is an earlier round's", () => {
    const earlierNumbers = [1, 2, 3, 4, 5];

    const oneOfTwo = ownCommits([fix(1, "3, 7")], earlierNumbers);
    const twoOfThree = ownCommits([fix(1, "2, 3, 4")], earlierNumbers, [3]);

    assert.deepEqual(
      oneOfTwo.notOwn.map((c) => [c.sha, c.subject]),
      [[sha(1), "fix(c900): [review] 3, 7: round a half up"]],
    );
    assert.match(oneOfTwo.notOwn[0].why, /^finding 3 is not above 5, .* and is not carried into this round$/);
    assert.match(twoOfThree.notOwn[0].why, /^findings 2, 4 are not above 5, .* and are not carried into this round$/);
  });

  test("a commit whose id it cannot read as numbers is no review or plan commit", () => {
    const { allOwn, notOwn } = ownCommits([commit(1, "fix(c900): [review] E12: round a half up")], []);

    assert.equal(allOwn, false);
    assert.match(notOwn[0].why, /\[review\] <id>:/);
  });

  test("takes the highest of the earlier numbers, whatever their order", () => {
    assert.equal(ownCommits([fix(1, 7)], [9, 2, 5]).allOwn, false);
    assert.equal(ownCommits([fix(1, 10)], [9, 2, 5]).allOwn, true);
  });

  test("names every commit that is no numbered review or plan commit", () => {
    const commits = [
      red(1, 6),
      commit(2, "docs(c900): [review] triage summary"),
      commit(3, 'Revert "test(c900): [review] 6: rounds a half up, red"'),
      commit(4, "Merge branch 'main' into feat/example"),
      commit(5, "feat(c900): [green] the rounding rule"),
      fix(6, 6),
    ];

    const { count, allOwn, notOwn } = ownCommits(commits, []);

    assert.equal(count, 6);
    assert.equal(allOwn, false);
    assert.deepEqual(
      notOwn.map((c) => c.sha),
      [sha(2), sha(3), sha(4), sha(5)],
    );
    assert.ok(notOwn.every((c) => /\[review\] <id>:/.test(c.why)));
  });

  test("counts a numbered review commit of an unknown type as the round's own: its finding comes out unclear", () => {
    const commits = [commit(1, "feat(c900): [review] 6: a new setting")];

    assert.equal(ownCommits(commits, [1, 2]).allOwn, true);
    assert.equal(only(classify([open(6)], commits, { earlierNumbers: [1, 2] })).class, "unclear");
  });
});

describe("classifyRound: findings that go to verification", () => {
  test("an open thread that no commit names goes to verification", () => {
    const f = only(classify([open(1)]));

    assert.equal(f.class, "verify");
    assert.equal(f.thread, "open");
    assert.equal(f.outcome, null);
    assert.deepEqual(f.commits, []);
    assert.equal(f.owed, "verification");
  });

  test("so does an open thread with replies that give no outcome", () => {
    const f = only(classify([open(1, reply("Open question for the owner: is the old behaviour wanted?"))]));

    assert.equal(f.class, "verify");
    assert.equal(f.reply, null);
  });

  test("so does an open thread with an old outcome reply: the owner unresolved it to bring it back", () => {
    const f = only(classify([open(1, reply("Declined: design.md D4 decides this."))]));

    assert.equal(f.class, "verify");
    assert.equal(f.outcome, null);
    assert.equal(f.reply, "Declined: design.md D4 decides this.");
  });

  test("so does an earlier round's ask left open, whatever its number", () => {
    const result = classify([open(3), open(8)], [], { earlierNumbers: [1, 2, 3, 4, 5] });

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class]),
      [
        [3, "verify"],
        [8, "verify"],
      ],
    );
  });

  test("a record keeps the finding's own fields", () => {
    const f = only(classify([open(4)]));

    assert.deepEqual(
      [f.id, f.commentId, f.path, f.line, f.title, f.body, f.author, f.url],
      [
        4,
        9004,
        "src/example.mjs",
        14,
        "Finding 4",
        "Finding 4\nMore detail.",
        "a-reviewer",
        "https://github.com/example/repo/pull/1#discussion_r9004",
      ],
    );
  });
});

describe("classifyRound: findings a stopped round already handled", () => {
  test("a resolved thread whose reply gives the outcome is taken back with it, and owed nothing", () => {
    const replies = {
      fixed: "Fixed in `0123abc`: the heading; guard test `Rounds_a_half_up`",
      declined: "Declined: design.md D4 decides this.",
      "declined by the owner": "Declined by the owner: two small files are fine.",
      deferred: "Deferred to the issue 123, by the owner.",
    };
    for (const [outcome, text] of Object.entries(replies)) {
      const f = only(classify([resolved(1, reply(text))]));

      assert.equal(f.class, "handled", text);
      assert.equal(f.thread, "resolved");
      assert.equal(f.outcome, outcome);
      assert.equal(f.reply, text);
      assert.equal(f.owed, "nothing");
    }
  });

  test("it is taken back with its commits when they say the same as its reply", () => {
    const stories = [
      ["Fixed in `0000002`: round a half up.", [red(1, 1), fix(2, 1)], "fixed"],
      ["Fixed in `0000002`: the spec and the rule.", [plan(1, 1), red(2, 1), fix(3, 1)], "fixed"],
      ["Fixed in `0000001`: the section's name.", [docsFix(1, 1)], "fixed"],
      ["Declined: the guard test passes, `0000001`.", [guardPasses(1, 1)], "declined"],
      ["Declined by the owner: not worth it.", [red(1, 1), guardRemoved(2, 1, "declined")], "declined by the owner"],
      ["Deferred to the issue 123.", [red(1, 1), guardRemoved(2, 1, "deferred")], "deferred"],
      ["Deferred to C12's design.", [headsUp(1, 1)], "deferred"],
    ];
    for (const [text, commits, outcome] of stories) {
      const f = only(classify([resolved(1, reply(text))], commits));

      assert.equal(f.class, "handled", text);
      assert.equal(f.outcome, outcome);
      assert.deepEqual(
        f.commits,
        commits.map((c) => ({ sha: c.sha, subject: c.subject })),
      );
      assert.equal(f.owed, "nothing");
    }
  });

  test("the last reply that gives an outcome counts, whatever is said after it", () => {
    const f = only(
      classify([
        resolved(
          1,
          reply("Declined: design.md D4 decides this.", 10),
          reply("Fixed in `0123abc`: after the owner's second look.", 11),
          reply("Thanks.", 12),
        ),
      ]),
    );

    assert.equal(f.class, "handled");
    assert.equal(f.outcome, "fixed");
    assert.equal(f.reply, "Fixed in `0123abc`: after the owner's second look.");
  });
});

describe("classifyRound: threads resolved by hand", () => {
  test("a resolved thread without a reply and without commits is the owner's to decide", () => {
    const f = only(classify([resolved(1)]));

    assert.equal(f.class, "resolved-by-hand");
    assert.equal(f.outcome, null);
    assert.match(f.owed, /owner/);
    assert.match(f.owed, /triage it/);
  });

  test("so is a resolved thread whose replies give no outcome", () => {
    const f = only(classify([resolved(1, reply("Fixed as the owner decided: keep both."), reply("Thanks."))]));

    assert.equal(f.class, "resolved-by-hand");
    assert.equal(f.reply, null);
  });
});

describe("classifyRound: findings that resume at the test-writer", () => {
  test("only a plan commit: the owner chose to fix it now", () => {
    const f = only(classify([open(1)], [plan(1, 1)]));

    assert.equal(f.class, "resume-test-writer");
    assert.equal(f.outcome, null);
    assert.deepEqual(shortShas(f), [short(1)]);
    assert.deepEqual(f.mayFail, []);
    assert.match(f.because, new RegExp(short(1)));
    assert.match(f.owed, /test-writer/);
  });

  test("several plan commits", () => {
    assert.equal(only(classify([open(1)], [plan(1, 1), plan(2, 1)])).class, "resume-test-writer");
  });

  test("a plan commit after a red one: the guard test already there may still fail", () => {
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs"]), plan(2, 1)];

    const f = only(classify([open(1)], commits));

    assert.equal(f.class, "resume-test-writer");
    assert.deepEqual(f.mayFail, [
      { sha: sha(1), subject: commits[0].subject, files: ["tests/Unit/RoundingTests.cs"], tests: [] },
    ]);
  });
});

describe("classifyRound: findings that resume at the implementer", () => {
  test("a red commit and no fix yet, with the test that may fail", () => {
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs"])];

    const f = only(classify([open(1)], commits));

    assert.equal(f.class, "resume-implementer");
    assert.equal(f.outcome, null);
    assert.deepEqual(shortShas(f), [short(1)]);
    assert.deepEqual(f.mayFail, [
      { sha: sha(1), subject: commits[0].subject, files: ["tests/Unit/RoundingTests.cs"], tests: [] },
    ]);
    assert.match(f.because, new RegExp(short(1)));
    assert.match(f.owed, /implementer/);
  });

  test("names the guard tests a red commit's body gives, beside the files it changed", () => {
    const body = "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up\nGuard test: money > rounds a half up";
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs", "src/money.test.ts"], body)];

    const f = only(classify([open(1)], commits));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(f.mayFail, [
      {
        sha: sha(1),
        subject: commits[0].subject,
        files: ["tests/Unit/RoundingTests.cs", "src/money.test.ts"],
        tests: ["Example.Tests.RoundingTests.Rounds_a_half_up", "money > rounds a half up"],
      },
    ]);
  });

  test("names each red commit's own guard tests when a guard test was corrected or a second one added", () => {
    const commits = [
      red(1, 1, ["tests/Unit/RoundingTests.cs"], "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up"),
      red(2, 1, ["tests/Unit/SignTests.cs"]),
      red(
        3,
        1,
        ["tests/Unit/RoundingTests.cs"],
        "The corrected test.\n\nGuard test: Example.Tests.RoundingTests.Rounds_up",
      ),
    ];

    const f = only(classify([open(1)], commits));

    assert.deepEqual(
      f.mayFail.map((c) => [c.sha, c.tests]),
      [
        [sha(1), ["Example.Tests.RoundingTests.Rounds_a_half_up"]],
        [sha(2), []],
        [sha(3), ["Example.Tests.RoundingTests.Rounds_up"]],
      ],
    );
  });

  test("reads guard test names only from the red commits that may still fail", () => {
    const commits = [
      red(1, 1, [], "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up"),
      commit(2, "fix(c900): [review] 1: round a half up", { body: "Guard test: Not.A.Red.Commit" }),
      red(3, 1, [], "Guard test: Example.Tests.RoundingTests.Keeps_the_sign"),
    ];

    const f = only(classify([open(1)], commits));

    assert.deepEqual(
      f.mayFail.map((c) => [c.sha, c.tests]),
      [[sha(3), ["Example.Tests.RoundingTests.Keeps_the_sign"]]],
    );
  });

  test("a red commit after a plan commit", () => {
    const f = only(classify([open(1)], [plan(1, 1), red(2, 1)]));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(
      f.mayFail.map((c) => c.sha),
      [sha(2)],
    );
  });

  test("a corrected guard test: every red commit's test may fail", () => {
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs"]), red(2, 1, ["tests/Unit/RoundingTests.cs"])];

    const f = only(classify([open(1)], commits));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(
      f.mayFail.map((c) => c.sha),
      [sha(1), sha(2)],
    );
  });

  test("a second test-first step of a fix: only the red commit no fix follows may fail", () => {
    const f = only(classify([open(1)], [red(1, 1), fix(2, 1), red(3, 1)]));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(shortShas(f), [short(1), short(2), short(3)]);
    assert.deepEqual(
      f.mayFail.map((c) => c.sha),
      [sha(3)],
    );
    assert.match(f.because, new RegExp(`red commit ${short(3)}`));
  });

  test("a spec edit in a second test-first step resumes at the test-writer", () => {
    const f = only(classify([open(1)], [red(1, 1), fix(2, 1), red(3, 1), plan(4, 1)]));

    assert.equal(f.class, "resume-test-writer");
    assert.deepEqual(
      f.mayFail.map((c) => c.sha),
      [sha(3)],
    );
  });

  test("a red commit read without its files still names the commit", () => {
    const f = only(classify([open(1)], [{ sha: sha(1), subject: "test(c900): [review] 1: rounds a half up, red" }]));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(f.mayFail, [
      { sha: sha(1), subject: "test(c900): [review] 1: rounds a half up, red", files: [], tests: [] },
    ]);
  });
});

describe("classifyRound: findings handled by their commits, only the reply owed", () => {
  const owedReply = (commits) => {
    const f = only(classify([open(1)], commits));
    assert.equal(f.class, "reply-owed", JSON.stringify(commits.map((c) => c.subject)));
    assert.equal(f.thread, "open");
    assert.equal(f.reply, null);
    assert.deepEqual(f.mayFail, []);
    assert.match(f.owed, /^the reply in its thread, which resolves it/);
    return f;
  };

  test("a fix commit after a red commit: fixed", () => {
    const f = owedReply([red(1, 1), fix(2, 1)]);

    assert.equal(f.outcome, "fixed");
    assert.deepEqual(shortShas(f), [short(1), short(2)]);
    assert.equal(f.replyText, null);
  });

  test("a fix after a plan commit, a corrected guard test, or a spec edit between test and fix: fixed", () => {
    assert.equal(owedReply([plan(1, 1), red(2, 1), fix(3, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), red(2, 1), fix(3, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), plan(2, 1), red(3, 1), fix(4, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), plan(2, 1), fix(3, 1)]).outcome, "fixed");
  });

  test("the single commit of a test-quality, docs or cleanup fix: fixed", () => {
    assert.equal(owedReply([testFix(1, 1)]).outcome, "fixed");
    assert.equal(owedReply([docsFix(1, 1)]).outcome, "fixed");
    assert.equal(owedReply([cleanup(1, 1)]).outcome, "fixed");
    assert.equal(owedReply([plan(1, 1), docsFix(2, 1)]).outcome, "fixed");
  });

  test("a fix in several test-first steps, or with a further test, docs or cleanup commit: fixed", () => {
    assert.equal(owedReply([red(1, 1), fix(2, 1), red(3, 1), fix(4, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), fix(2, 1), red(3, 1), plan(4, 1), red(5, 1), fix(6, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), fix(2, 1), testFix(3, 1)]).outcome, "fixed");
    assert.equal(owedReply([red(1, 1), fix(2, 1), cleanup(3, 1), docsFix(4, 1)]).outcome, "fixed");
    assert.equal(owedReply([docsFix(1, 1), docsFix(2, 1)]).outcome, "fixed");
  });

  test("a guard test that passes at once: declined, the guard test being the evidence", () => {
    const f = owedReply([guardPasses(1, 1)]);

    assert.equal(f.outcome, "declined");
    assert.deepEqual(shortShas(f), [short(1)]);
    assert.match(f.because, /guard passes/);
    assert.equal(f.replyText, null);
  });

  test("a guard test corrected after a dispute that then passes at once: declined", () => {
    assert.equal(owedReply([red(1, 1), guardPasses(2, 1)]).outcome, "declined");
    assert.equal(owedReply([plan(1, 1), guardPasses(2, 1)]).outcome, "declined");
  });

  test("a guard removed, declined: declined, the reply's text being the commit's body", () => {
    const body = "Declined by the owner: the old rounding is what the bank shows.";

    const f = owedReply([red(1, 1), guardRemoved(2, 1, "declined", body)]);

    assert.equal(f.outcome, "declined");
    assert.equal(f.replyText, body);
    assert.match(f.owed, new RegExp(`body of ${short(2)}`));
    assert.doesNotMatch(f.owed, /heads-up/);
  });

  test("a guard removed, deferred: deferred, the reply's text being the commit's body", () => {
    const body = "Deferred to the issue 123, by the owner: it names the test and its red commit.";

    const f = owedReply([red(1, 1), red(2, 1), guardRemoved(3, 1, "deferred", `\n${body}\n`)]);

    assert.equal(f.outcome, "deferred");
    assert.equal(f.replyText, body);
    assert.match(f.owed, new RegExp(`body of ${short(3)}`));
  });

  test("a guard removed, deferred, without a heads-up commit says that one may still be missing", () => {
    const f = owedReply([red(1, 1), guardRemoved(2, 1, "deferred", "Deferred to a heads-up in C12's design.")]);

    assert.match(f.owed, /heads-up for <step>.*missing/);
  });

  test("a guard removed commit without a body says where the reply's text has to come from", () => {
    const f = owedReply([red(1, 1), guardRemoved(2, 1, "declined", "  \n")]);

    assert.equal(f.outcome, "declined");
    assert.equal(f.replyText, null);
    assert.match(f.owed, new RegExp(`${short(2)} has no body`));
    assert.match(f.owed, /state file or the owner/);
  });

  test("a heads-up commit: deferred as a heads-up", () => {
    const f = owedReply([headsUp(1, 1)]);

    assert.equal(f.outcome, "deferred as a heads-up");
    assert.equal(f.replyText, null);
    assert.equal(f.owed, "the reply in its thread, which resolves it");
  });

  test("a heads-up commit after a guard removed, deferred: deferred as a heads-up, with that commit's body", () => {
    const body = "Deferred to a heads-up in C12's design, by the owner.";

    const f = owedReply([red(1, 1), guardRemoved(2, 1, "deferred", body), headsUp(3, 1)]);

    assert.equal(f.outcome, "deferred as a heads-up");
    assert.equal(f.replyText, body);
    assert.doesNotMatch(f.owed, /missing/);
  });
});

describe("classifyRound: a close check's repair commit changes no finding's outcome", () => {
  const owed = (commits) => only(classify([open(1)], commits));

  test("after a fix: fixed, with the repair among the finding's commits", () => {
    const f = owed([red(1, 1), fix(2, 1), repair(3, 1)]);

    assert.equal(f.class, "reply-owed");
    assert.equal(f.outcome, "fixed");
    assert.deepEqual(shortShas(f), [short(1), short(2), short(3)]);
    assert.equal(f.because, "its thread is open and its commits say fixed (red → fix → repair)");
    assert.deepEqual(f.mayFail, []);
  });

  test("after the single commit of a test-quality, docs or cleanup fix, in test code or in production code: fixed", () => {
    assert.equal(owed([testFix(1, 1), repair(2, 1, "format:check", "test")]).outcome, "fixed");
    assert.equal(owed([docsFix(1, 1), repair(2, 1)]).outcome, "fixed");
    assert.equal(owed([cleanup(1, 1), repair(2, 1, "dotnet format")]).outcome, "fixed");
  });

  test("after a guard test that passes at once: still declined, not unclear", () => {
    const f = owed([guardPasses(1, 1), repair(2, 1, "dotnet format", "test")]);

    assert.equal(f.class, "reply-owed");
    assert.equal(f.outcome, "declined");
    assert.equal(f.because, "its thread is open and its commits say declined (guard passes → repair)");
  });

  test("after a guard removed, declined or deferred, and after a heads-up: the outcome and the reply's text stay", () => {
    const body = "Declined by the owner: the old rounding is what the bank shows.";

    const declined = owed([red(1, 1), guardRemoved(2, 1, "declined", body), repair(3, 1)]);
    const deferred = owed([red(1, 1), guardRemoved(2, 1, "deferred", "Deferred to the issue 123."), repair(3, 1)]);
    const headsUpOnly = owed([red(1, 1), guardRemoved(2, 1, "deferred", "To C12."), headsUp(3, 1), repair(4, 1)]);

    assert.deepEqual([declined.class, declined.outcome, declined.replyText], ["reply-owed", "declined", body]);
    assert.match(declined.owed, new RegExp(`body of ${short(2)}`));
    assert.deepEqual([deferred.outcome, deferred.replyText], ["deferred", "Deferred to the issue 123."]);
    assert.match(deferred.owed, /heads-up for <step>.*missing/);
    assert.deepEqual([headsUpOnly.outcome, headsUpOnly.replyText], ["deferred as a heads-up", "To C12."]);
  });

  test("a repair the owner ordered, committed as a fix, after a guard test that passes at once: still declined", () => {
    const f = owed([guardPasses(1, 1), repair(2, 1, "dotnet test", "fix")]);
    const answered = only(
      classify(
        [resolved(1, reply("Declined: the guard test passes."))],
        [guardPasses(1, 1), repair(2, 1, "dotnet test", "fix")],
      ),
    );

    assert.equal(f.class, "reply-owed");
    assert.equal(f.outcome, "declined");
    assert.equal(f.because, "its thread is open and its commits say declined (guard passes → repair)");
    assert.deepEqual([answered.class, answered.outcome], ["handled", "declined"]);
  });

  test("a repair the owner ordered, committed as a fix, after a guard removed, declined or deferred: the outcome and the reply's text stay", () => {
    const body = "Declined by the owner: the old rounding is what the bank shows.";

    const declined = owed([red(1, 1), guardRemoved(2, 1, "declined", body), repair(3, 1, "dotnet test", "fix")]);
    const deferred = owed([
      red(1, 1),
      guardRemoved(2, 1, "deferred", "Deferred to the issue 123."),
      repair(3, 1, "npm test", "fix"),
    ]);

    assert.deepEqual([declined.class, declined.outcome, declined.replyText], ["reply-owed", "declined", body]);
    assert.equal(
      declined.because,
      "its thread is open and its commits say declined (red → guard removed, declined → repair)",
    );
    assert.deepEqual(
      [deferred.class, deferred.outcome, deferred.replyText],
      ["reply-owed", "deferred", "Deferred to the issue 123."],
    );
  });

  test("a repair the owner ordered, committed as a fix, after a fix: fixed, with the repair among the finding's commits", () => {
    const f = owed([red(1, 1), fix(2, 1), repair(3, 1, "dotnet test", "fix")]);

    assert.equal(f.class, "reply-owed");
    assert.equal(f.outcome, "fixed");
    assert.deepEqual(shortShas(f), [short(1), short(2), short(3)]);
    assert.equal(f.because, "its thread is open and its commits say fixed (red → fix → repair)");
    assert.deepEqual(f.mayFail, []);
  });

  test("several repairs, and one between the steps of a fix, are all read past", () => {
    assert.equal(owed([red(1, 1), fix(2, 1), repair(3, 1), repair(4, 1, "typecheck")]).outcome, "fixed");
    assert.equal(owed([red(1, 1), repair(2, 1, "lint", "test"), fix(3, 1)]).outcome, "fixed");
    assert.equal(owed([guardPasses(1, 1), repair(2, 1), repair(3, 1)]).outcome, "declined");
  });

  test("after a red commit that no fix follows: the fix still resumes at the implementer, and the test may still fail", () => {
    const f = owed([red(1, 1, ["tests/rounding.test.mjs"]), repair(2, 1, "format:check", "test")]);

    assert.equal(f.class, "resume-implementer");
    assert.equal(f.outcome, null);
    assert.match(f.because, new RegExp(`its commits stop at the red commit ${short(1)} `));
    assert.deepEqual(
      f.mayFail.map((c) => [c.sha.slice(0, 7), c.files]),
      [[short(1), ["tests/rounding.test.mjs"]]],
    );
  });

  test("after a plan commit: the fix still resumes at the test-writer", () => {
    assert.equal(owed([plan(1, 1), repair(2, 1)]).class, "resume-test-writer");
  });

  test("a finding the stopped round already answered is taken back with its reply, the repair among its commits", () => {
    const fixed = only(classify([resolved(1, reply("Fixed in 0000002."))], [red(1, 1), fix(2, 1), repair(3, 1)]));
    const declined = only(
      classify([resolved(1, reply("Declined: the guard test passes."))], [guardPasses(1, 1), repair(2, 1)]),
    );

    assert.deepEqual([fixed.class, fixed.outcome], ["handled", "fixed"]);
    assert.deepEqual(shortShas(fixed), [short(1), short(2), short(3)]);
    assert.deepEqual([declined.class, declined.outcome], ["handled", "declined"]);
  });

  test("an order the fix round does not produce stays unclear with a repair in it", () => {
    const f = owed([guardPasses(1, 1), repair(2, 1), fix(3, 1)]);

    assert.equal(f.class, "unclear");
    assert.match(f.because, /order the fix round does not produce: guard passes → repair → fix$/);
  });

  test("repairs alone fix no finding: unclear, and the owner decides", () => {
    const f = owed([repair(1, 1), repair(2, 1, "typecheck")]);

    assert.equal(f.class, "unclear");
    assert.equal(f.because, "only close-check repairs name it, and a repair fixes no finding: repair → repair");
    assert.deepEqual(f.mayFail, []);
  });

  test("a repair commit is the round's own", () => {
    const own = ownCommits([red(1, 6), fix(2, 6), repair(3, 6)], [1, 2, 3, 4, 5]);

    assert.deepEqual(own, { count: 3, allOwn: true, notOwn: [] });
  });
});

describe("classifyRound: the numbering across rounds", () => {
  const earlierNumbers = [1, 2, 3, 4, 5];

  test("a resolved thread numbered at or below the earlier rounds' highest number is theirs, and left as it is", () => {
    const findings = [
      resolved(1, reply("Fixed in `0123abc`: the heading.", 8)),
      resolved(2),
      resolved(5, reply("Declined: design.md D4 decides this.", 8)),
      resolved(6, reply("Fixed in `0000002`: round a half up.", 12)),
      open(7),
    ];

    const result = classify(findings, [], { earlierNumbers, lastSummaryAt: at(9) });

    assert.deepEqual(result.earlier, [1, 2, 5]);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class]),
      [
        [6, "handled"],
        [7, "verify"],
      ],
    );
  });

  test("a resolved thread numbered above it is this round's: handled, or resolved by hand", () => {
    const result = classify([resolved(6, reply("Declined: no such path.")), resolved(7)], [], { earlierNumbers });

    assert.equal(classOf(result, 6), "handled");
    assert.equal(classOf(result, 7), "resolved-by-hand");
    assert.deepEqual(result.earlier, []);
  });

  test("the highest number counts, also when a summary left a number out or lists them out of order", () => {
    const result = classify([resolved(4), resolved(8), resolved(10)], [], { earlierNumbers: [9, 1, 2] });

    assert.deepEqual(result.earlier, [4, 8]);
    assert.equal(classOf(result, 10), "resolved-by-hand");
  });

  test("in round 1 every resolved thread is this round's", () => {
    const result = classify([resolved(1, reply("Fixed in `0123abc`: the heading.")), resolved(2), open(3)]);

    assert.deepEqual(result.earlier, []);
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class]),
      [
        [1, "handled"],
        [2, "resolved-by-hand"],
        [3, "verify"],
      ],
    );
  });

  test("this round's commits sort its findings, each by the commits that name its number", () => {
    const findings = [
      resolved(3),
      open(6),
      open(7),
      open(8),
      open(9),
      resolved(10, reply("Fixed in `0000006`: done.")),
    ];
    const commits = [red(1, 6), plan(2, 8), fix(3, 6), red(4, 7), red(5, 10), fix(6, 10)];

    const result = classify(findings, commits, { earlierNumbers });

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, shortShas(f)]),
      [
        [6, "reply-owed", [short(1), short(3)]],
        [7, "resume-implementer", [short(4)]],
        [8, "resume-test-writer", [short(2)]],
        [9, "verify", []],
        [10, "handled", [short(5), short(6)]],
      ],
    );
  });

  test("gives every finding of the round exactly one record, by number, whatever the input order", () => {
    const findings = [open(9), resolved(7), open(6), resolved(2), open(8)];

    const result = classify(findings, [red(1, 8)], { earlierNumbers });

    assert.deepEqual(
      result.findings.map((f) => f.id),
      [6, 7, 8, 9],
    );
    assert.deepEqual(result.earlier, [2]);
  });
});

describe("classifyRound: findings carried over from an earlier round", () => {
  // Round 1's summary, posted at 9 o'clock, lists the numbers 1 to 5. A reply at 8 o'clock is round 1's, one at 11
  // o'clock this round's.
  const earlier = { earlierNumbers: [1, 2, 3, 4, 5], lastSummaryAt: at(9) };
  const earlierNumbers = earlier.earlierNumbers;

  test("an earlier round's ask left open is carried into this round, and goes to verification", () => {
    const result = classify([open(3, reply("Open question for the owner.", 8)), resolved(4), open(7)], [], earlier);

    assert.deepEqual(result.carried, [3]);
    assert.deepEqual(result.earlier, [4]);
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class]),
      [
        [3, "verify"],
        [7, "verify"],
      ],
    );
  });

  test("its commits sort it like any other finding of the round, and are this round's own", () => {
    const stories = [
      [[plan(1, 3)], "resume-test-writer", null],
      [[red(1, 3)], "resume-implementer", null],
      [[plan(1, 3), red(2, 3)], "resume-implementer", null],
      [[red(1, 3), fix(2, 3)], "reply-owed", "fixed"],
      [[docsFix(1, 3)], "reply-owed", "fixed"],
      [[guardPasses(1, 3)], "reply-owed", "declined"],
      [[red(1, 3), guardRemoved(2, 3, "deferred", "Deferred to the issue 123.")], "reply-owed", "deferred"],
      [[headsUp(1, 3)], "reply-owed", "deferred as a heads-up"],
    ];
    for (const [commits, expected, outcome] of stories) {
      const result = classify([open(3)], commits, earlier);

      const f = only(result);
      assert.equal(f.class, expected, JSON.stringify(commits.map((c) => c.subject)));
      assert.equal(f.outcome, outcome);
      assert.equal(f.commits.length, commits.length);
      assert.deepEqual(result.carried, [3]);
      assert.deepEqual(ownCommits(commits, earlierNumbers, result.carried), {
        count: commits.length,
        allOwn: true,
        notOwn: [],
      });
    }
  });

  test("a carried finding that resumes at the implementer names the test that may fail", () => {
    const commits = [red(1, 3, ["tests/Unit/RoundingTests.cs"], "Guard test: Example.Tests.Rounds_a_half_up")];

    const f = only(classify([open(3)], commits, earlier));

    assert.equal(f.class, "resume-implementer");
    assert.deepEqual(f.mayFail, [
      {
        sha: sha(1),
        subject: commits[0].subject,
        files: ["tests/Unit/RoundingTests.cs"],
        tests: ["Example.Tests.Rounds_a_half_up"],
      },
    ]);
  });

  test("an earlier round's reply in its thread does not count: the owner reopened it, and this round fixes it", () => {
    const reopened = open(3, reply("Declined: design.md D4 decides this.", 8));

    const untouched = only(classify([reopened], [], earlier));
    const fixed = only(classify([reopened], [red(1, 3), fix(2, 3)], earlier));
    const halfWay = only(classify([reopened], [red(1, 3)], earlier));

    assert.deepEqual([untouched.class, untouched.reply], ["verify", null]);
    assert.deepEqual([fixed.class, fixed.outcome, fixed.reply], ["reply-owed", "fixed", null]);
    assert.deepEqual([halfWay.class, halfWay.reply], ["resume-implementer", null]);
  });

  test("a carried finding this round closed is taken back with its reply's outcome", () => {
    const findings = [
      resolved(3, reply("Open question for the owner.", 8), reply("Declined by the owner: not worth it.", 11)),
      resolved(4, reply("Fixed in `0123abc`: the heading.", 8)),
      resolved(5, reply("Declined: no such path.", 8), reply("Deferred to the issue 123, by the owner.", 12)),
    ];

    const result = classify(findings, [], earlier);

    assert.deepEqual(result.carried, [3, 5]);
    assert.deepEqual(result.earlier, [4]);
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.outcome, f.reply, f.owed]),
      [
        [3, "handled", "declined by the owner", "Declined by the owner: not worth it.", "nothing"],
        [5, "handled", "deferred", "Deferred to the issue 123, by the owner.", "nothing"],
      ],
    );
  });

  test("it is taken back with its commits when they say the same as its reply, and they are this round's own", () => {
    const commits = [red(1, 3), fix(2, 3)];

    const result = classify([resolved(3, reply("Fixed in `0000002`: round a half up.", 11))], commits, earlier);

    const f = only(result);
    assert.deepEqual([f.class, f.outcome, shortShas(f)], ["handled", "fixed", [short(1), short(2)]]);
    assert.deepEqual(result.carried, [3]);
    assert.equal(ownCommits(commits, earlierNumbers, result.carried).allOwn, true);
  });

  test("like any other finding it is unclear when its reply and its commits do not tell one story", () => {
    const closedButRed = classify([resolved(3, reply("Fixed in `0000001`: done.", 11))], [red(1, 3)], earlier);
    const openWithBoth = classify([open(3, reply("Fixed in `0000002`: done.", 11))], [red(1, 3), fix(2, 3)], earlier);
    const disagree = classify([resolved(3, reply("Declined: no such path.", 11))], [docsFix(1, 3)], earlier);

    for (const result of [closedButRed, openWithBoth, disagree]) {
      assert.equal(only(result).class, "unclear");
      assert.deepEqual(result.carried, [3]);
    }
    assert.match(only(closedButRed).because, /Fixed in.*red commit/);
    assert.match(only(openWithBoth).because, /open, yet it has the reply/);
    assert.match(only(disagree).because, /says declined, but its commits say fixed/);
  });

  test("a resolved one without an outcome reply since the last summary stays an earlier round's", () => {
    const findings = [
      resolved(1, reply("Fixed in `0123abc`: the heading.", 8)),
      resolved(2),
      resolved(3, reply("Declined: no such path.", 8), reply("Thanks, agreed.", 11)),
      resolved(4, reply("Fixed as the owner decided: keep both.", 11)),
    ];

    const result = classify(findings, [], earlier);

    assert.deepEqual(result.earlier, [1, 2, 3, 4]);
    assert.deepEqual(result.carried, []);
    assert.deepEqual(result.findings, []);
  });

  test("a resolved one stays an earlier round's when its reply's time or the last summary's is not known", () => {
    const untimed = { body: "Declined by the owner: not worth it.", createdAt: null, author: "the-owner" };

    const noReplyTime = classify([resolved(3, untimed)], [], earlier);
    const noSummaryTime = classify([resolved(3, reply("Declined: no.", 11))], [], { earlierNumbers });

    assert.deepEqual([noReplyTime.earlier, noReplyTime.carried], [[3], []]);
    assert.deepEqual([noSummaryTime.earlier, noSummaryTime.carried], [[3], []]);
  });

  test("an open one is carried whatever is known of the times", () => {
    const result = classify([open(3, reply("Declined: no.", 11))], [red(1, 3)], { earlierNumbers });

    assert.deepEqual(result.carried, [3]);
    assert.equal(only(result).class, "resume-implementer");
  });

  test("lists the carried numbers in ascending order, whatever the findings' order", () => {
    const findings = [open(5), resolved(2, reply("Declined by the owner: no.", 11)), open(1), resolved(4), open(9)];

    const result = classify(findings, [], earlier);

    assert.deepEqual(result.carried, [1, 2, 5]);
    assert.deepEqual(result.earlier, [4]);
  });

  test("in round 1 nothing is carried", () => {
    assert.deepEqual(classify([open(1), resolved(2), open(3)], [red(1, 1)]).carried, []);
  });
});

describe("classifyRound: one commit for several findings", () => {
  test("counts in each finding's story", () => {
    const commits = [red(1, "3, 7", ["tests/Unit/RoundingTests.cs"]), fix(2, "3, 7")];

    const result = classify([open(3), open(5), open(7)], commits);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.outcome, shortShas(f)]),
      [
        [3, "reply-owed", "fixed", [short(1), short(2)]],
        [5, "verify", null, []],
        [7, "reply-owed", "fixed", [short(1), short(2)]],
      ],
    );
    assert.equal(result.findings[0].commits[0].subject, "test(c900): [review] 3, 7: rounds a half up, red");
  });

  test("resumes each of the findings where the shared commits stop, with the same test that may fail", () => {
    const commits = [plan(1, "3,7"), red(2, "3,7", ["tests/Unit/RoundingTests.cs"], "Guard test: Example.Rounds_up")];

    const result = classify([open(3), open(7)], commits);

    const mayFail = [
      {
        sha: sha(2),
        subject: commits[1].subject,
        files: ["tests/Unit/RoundingTests.cs"],
        tests: ["Example.Rounds_up"],
      },
    ];
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.mayFail]),
      [
        [3, "resume-implementer", mayFail],
        [7, "resume-implementer", mayFail],
      ],
    );
  });

  test("joins a finding's own commits in the order of the commits", () => {
    const commits = [red(1, 3), red(2, "3, 7"), fix(3, "3, 7"), docsFix(4, 7), plan(5, "7, 9")];

    const result = classify([open(3), open(7), open(9)], commits);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, shortShas(f)]),
      [
        [3, "reply-owed", [short(1), short(2), short(3)]],
        [7, "unclear", [short(2), short(3), short(4), short(5)]],
        [9, "resume-test-writer", [short(5)]],
      ],
    );
  });

  test("takes back each finding the stopped round already answered, and owes the reply to the other", () => {
    const commits = [red(1, "3, 7"), fix(2, "3, 7")];

    const result = classify([resolved(3, reply("Fixed in `0000002`: round a half up.")), open(7)], commits);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.outcome]),
      [
        [3, "handled", "fixed"],
        [7, "reply-owed", "fixed"],
      ],
    );
  });

  test("a number among them that no review comment has comes out unclear, the others as they stand", () => {
    const result = classify([open(3)], [red(1, "3, 8"), fix(2, "3, 8")]);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.thread, f.class]),
      [
        [3, "open", "reply-owed"],
        [8, "none", "unclear"],
      ],
    );
  });

  test("a carried finding fixed together with one of this round's has commits that are this round's own", () => {
    const earlier = { earlierNumbers: [1, 2, 3, 4, 5], lastSummaryAt: at(9) };
    const commits = [red(1, "3, 7"), fix(2, "3, 7")];

    const result = classify([open(3), open(7)], commits, earlier);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class]),
      [
        [3, "reply-owed"],
        [7, "reply-owed"],
      ],
    );
    assert.equal(ownCommits(commits, earlier.earlierNumbers, result.carried).allOwn, true);
  });

  test("git's own revert of such a commit belongs to each of its findings, as a commit the rules do not name", () => {
    const commits = [red(1, "3, 7"), commit(2, 'Revert "test(c900): [review] 3, 7: rounds a half up, red"')];

    const result = classify([open(3), open(7)], commits);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, shortShas(f)]),
      [
        [3, "unclear", [short(1), short(2)]],
        [7, "unclear", [short(1), short(2)]],
      ],
    );
  });

  test("a commit whose id it cannot read as numbers belongs to no finding", () => {
    const commits = [
      commit(1, "fix(c900): [review] E12: round a half up"),
      commit(2, "fix(c900): [review] 3 and 7: x"),
    ];

    const result = classify([open(3), open(7)], commits);

    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.commits]),
      [
        [3, "verify", []],
        [7, "verify", []],
      ],
    );
    assert.equal(ownCommits(commits, []).notOwn.length, 2);
  });
});

describe("classifyRound: cases the rules do not cover", () => {
  const earlierNumbers = [1, 2, 3, 4, 5];
  const unclear = (result, id = result.findings[0]?.id) => {
    const f = result.findings.find((r) => r.id === id);
    assert.equal(f?.class, "unclear", JSON.stringify(f));
    assert.equal(f.outcome, null);
    assert.equal(f.owed, "the owner's decision");
    return f;
  };

  test("commits for a number that no review comment has", () => {
    const result = classify([open(1)], [red(1, 9, ["tests/Unit/RoundingTests.cs"]), fix(2, 9), red(3, 12)]);

    const f = unclear(result, 9);
    assert.equal(f.thread, "none");
    assert.deepEqual([f.commentId, f.path, f.line, f.title, f.body, f.url], [null, null, null, null, null, null]);
    assert.deepEqual(shortShas(f), [short(1), short(2)]);
    assert.match(f.because, /no submitted review comment/);
    assert.deepEqual(f.mayFail, []);
    assert.deepEqual(
      unclear(result, 12).mayFail.map((c) => c.sha),
      [sha(3)],
    );
    assert.equal(classOf(result, 1), "verify");
  });

  test("an earlier round's resolved finding, not carried into this round, that commits after the head name", () => {
    const findings = [resolved(3, reply("Fixed in `0123abc`: the heading.", 8))];
    const commits = [red(1, 3, ["tests/Unit/RoundingTests.cs"]), fix(2, 3), red(3, 3)];

    const result = classify(findings, commits, { earlierNumbers, lastSummaryAt: at(9) });

    const f = unclear(result);
    assert.equal(f.thread, "resolved");
    assert.equal(f.reply, null);
    assert.deepEqual(shortShas(f), [short(1), short(2), short(3)]);
    assert.match(f.because, /numbers up to 5/);
    assert.match(f.because, /not carried into this round/);
    assert.match(f.because, /unpushed commits/);
    assert.deepEqual(
      f.mayFail.map((c) => c.sha),
      [sha(3)],
    );
    assert.deepEqual(result.earlier, []);
    assert.deepEqual(result.carried, []);
    assert.equal(ownCommits(commits, earlierNumbers, result.carried).notOwn.length, 3);
  });

  test("so is one that was resolved by hand, without a reply, and that commits name", () => {
    const result = classify([resolved(2)], [docsFix(1, 2)], { earlierNumbers, lastSummaryAt: at(9) });

    assert.match(unclear(result).because, /not carried into this round/);
    assert.deepEqual(result.carried, []);
  });

  test("an open thread with both an outcome reply and commits", () => {
    const fixedAndOpen = classify([open(1, reply("Fixed in `0000002`: round a half up."))], [red(1, 1), fix(2, 1)]);
    const declinedThenRed = classify([open(1, reply("Declined by the owner: not worth it."))], [red(1, 1)]);

    assert.match(unclear(fixedAndOpen).because, /open.*Fixed in.*fixed/);
    assert.match(unclear(declinedThenRed).because, /open.*Declined by the owner.*red commit/);
    assert.deepEqual(
      unclear(declinedThenRed).mayFail.map((c) => c.sha),
      [sha(1)],
    );
  });

  test("a resolved thread with commits and no outcome reply", () => {
    const result = classify([resolved(1, reply("Thanks."))], [red(1, 1), fix(2, 1)]);

    const f = unclear(result);
    assert.match(f.because, /resolved without a reply/);
    assert.match(f.because, /fixed/);
    assert.deepEqual(shortShas(f), [short(1), short(2)]);
  });

  test("a resolved thread with a reply and later commits that stop part-way", () => {
    const replied = resolved(1, reply("Fixed in `0000002`: round a half up."));

    assert.match(unclear(classify([replied], [red(1, 1), fix(2, 1), red(3, 1)])).because, /Fixed in.*red commit/);
    assert.match(unclear(classify([replied], [red(1, 1), fix(2, 1), plan(3, 1)])).because, /order/);
    assert.match(unclear(classify([replied], [red(1, 1)])).because, /Fixed in.*red commit/);
    assert.match(unclear(classify([replied], [plan(1, 1)])).because, /Fixed in.*plan commit/);
  });

  test("a resolved thread whose reply and commits say different outcomes", () => {
    const declinedButFixed = classify([resolved(1, reply("Declined: no such path."))], [red(1, 1), fix(2, 1)]);
    const fixedButRemoved = classify(
      [resolved(1, reply("Fixed in `0000001`: round a half up."))],
      [red(1, 1), guardRemoved(2, 1, "deferred", "Deferred to the issue 123.")],
    );

    assert.match(unclear(declinedButFixed).because, /says declined, but its commits say fixed/);
    assert.match(unclear(fixedButRemoved).because, /says fixed, but its commits say deferred/);
  });

  test("commits in an order the fix round does not produce", () => {
    const declined = (n) => guardRemoved(n, 1, "declined", "Declined by the owner.");
    const deferred = (n) => guardRemoved(n, 1, "deferred", "Deferred to the issue 123.");
    const orders = [
      // a fix without a red commit before it, a guard removed that no red commit added
      [fix(1, 1)],
      [plan(1, 1), fix(2, 1)],
      [docsFix(1, 1), fix(2, 1)],
      [red(1, 1), fix(2, 1), fix(3, 1)],
      [declined(1)],
      [plan(1, 1), deferred(2)],
      // an outcome while a guard test may still fail
      [red(1, 1), docsFix(2, 1)],
      [red(1, 1), testFix(2, 1)],
      [red(1, 1), cleanup(2, 1)],
      [red(1, 1), headsUp(2, 1)],
      [red(1, 1), fix(2, 1), red(3, 1), cleanup(4, 1)],
      // a finding declined or deferred, then worked on again
      [guardPasses(1, 1), red(2, 1)],
      [guardPasses(1, 1), fix(2, 1)],
      [guardPasses(1, 1), docsFix(2, 1)],
      [guardPasses(1, 1), plan(2, 1)],
      [red(1, 1), declined(2), red(3, 1)],
      [red(1, 1), deferred(2), red(3, 1), fix(4, 1)],
      [headsUp(1, 1), red(2, 1)],
      [headsUp(1, 1), docsFix(2, 1)],
      [red(1, 1), deferred(2), headsUp(3, 1), headsUp(4, 1)],
      // a finding fixed, or about to be, then declined or deferred
      [red(1, 1), fix(2, 1), guardPasses(3, 1)],
      [red(1, 1), fix(2, 1), headsUp(3, 1)],
      [red(1, 1), fix(2, 1), red(3, 1), declined(4)],
      [red(1, 1), fix(2, 1), red(3, 1), guardPasses(4, 1)],
      [docsFix(1, 1), headsUp(2, 1)],
      [plan(1, 1), headsUp(2, 1)],
      [red(1, 1), declined(2), headsUp(3, 1)],
      // a spec edit after the fix
      [red(1, 1), fix(2, 1), plan(3, 1)],
      [docsFix(1, 1), plan(2, 1)],
    ];
    for (const commits of orders) {
      const f = unclear(classify([open(1)], commits));

      assert.match(f.because, /order the fix round does not produce/, JSON.stringify(commits.map((c) => c.subject)));
      assert.equal(f.commits.length, commits.length);
    }
  });

  test("an order that is not read still names the red commits nothing settles", () => {
    const f = unclear(classify([open(1)], [red(1, 1, ["tests/Unit/RoundingTests.cs"]), docsFix(2, 1)]));

    assert.deepEqual(f.mayFail, [
      {
        sha: sha(1),
        subject: "test(c900): [review] 1: rounds a half up, red",
        files: ["tests/Unit/RoundingTests.cs"],
        tests: [],
      },
    ]);
    assert.deepEqual(unclear(classify([open(1)], [red(1, 1), fix(2, 1), plan(3, 1)])).mayFail, []);
  });

  test("a numbered commit of a type the rules do not name", () => {
    const f = unclear(classify([open(1)], [red(1, 1), commit(2, "feat(c900): [review] 1: a new setting")]));

    assert.match(f.because, /none of the round's commit shapes/);
    assert.match(f.because, /feat\(c900\): \[review\] 1: a new setting/);
  });

  test("git's own revert of a red commit is not read as a red commit", () => {
    const commits = [red(1, 1), commit(2, 'Revert "test(c900): [review] 1: rounds a half up, red"')];

    const f = unclear(classify([open(1)], commits));

    assert.deepEqual(shortShas(f), [short(1), short(2)]);
    assert.match(f.because, /none of the round's commit shapes/);
    assert.equal(ownCommits(commits, []).allOwn, false);
  });

  test("a commit that names no finding belongs to none: ownCommits reports it", () => {
    const commits = [commit(1, "docs(c900): [review] triage summary"), commit(2, "chore: tidy up")];

    assert.equal(only(classify([open(1)], commits)).class, "verify");
    assert.equal(ownCommits(commits, []).notOwn.length, 2);
  });
});

describe("roundLines", () => {
  // What round.json holds, from made-up findings and commits, as the gather builds it.
  function roundRecord(findings, commits = [], earlierNumbers = []) {
    const sorted = classifyRound({ findings, earlierNumbers, commits, lastSummaryAt: null });
    const summaries = earlierNumbers.length > 0 ? 1 : 0;
    return {
      pr: 1,
      round: summaries + 1,
      head: sha(900),
      earlierRounds: {
        summaries,
        highestNumber: Math.max(0, ...earlierNumbers),
        lastSummaryAt: null,
        resolved: sorted.earlier,
        carried: sorted.carried,
      },
      commits: ownCommits(commits, earlierNumbers, sorted.carried),
      findings: sorted.findings,
    };
  }

  test("says the round and that no summary came before it, in round 1", () => {
    assert.deepEqual(roundLines(roundRecord([open(1), open(2)])), ["ROUND: 1 · no earlier summary"]);
  });

  test("says the round and the earlier rounds' highest number, in a later round", () => {
    assert.deepEqual(roundLines(roundRecord([open(6)], [], [1, 2, 3, 4, 5])), [
      "ROUND: 2 · 1 earlier summary lists numbers up to 5",
    ]);
    const roundThree = { ...roundRecord([open(8)], [], [1, 2, 7]), round: 3 };
    roundThree.earlierRounds.summaries = 2;
    assert.deepEqual(roundLines(roundThree), ["ROUND: 3 · 2 earlier summaries list numbers up to 7"]);
  });

  test("prints no line for a finding that goes to verification", () => {
    const lines = roundLines(roundRecord([open(1), resolved(2), open(3)]));

    assert.equal(lines.length, 2);
    assert.match(lines[1], /^RESOLVED BY HAND: 2 /);
  });

  test("prints one line per other finding, by number: its class, where it is, what it rests on, what is owed", () => {
    const findings = [
      resolved(1, reply("Fixed in `0123abc`: the heading; guard test `Rounds_a_half_up`")),
      resolved(2),
      open(3),
      open(4, reply("Declined: design.md D4 decides this.")),
      open(5),
      open(6),
      open(7, reply("Fixed in `0000009`: done.")),
      open(8),
    ];
    const commits = [
      plan(1, 3),
      red(2, 5, ["tests/Unit/RoundingTests.cs", "tests/Unit/Rounding.cs"]),
      red(3, 6),
      fix(4, 6),
      red(5, 7),
      fix(6, 7),
    ];

    const lines = roundLines(roundRecord(findings, commits));

    assert.deepEqual(lines, [
      "ROUND: 1 · no earlier summary",
      "HANDLED: 1 src/example.mjs:11 · fixed · its thread is resolved and its reply starts " +
        '"Fixed in `0123abc`: the heading; guard test `Rounds_a_half_up`" · owed: nothing',
      "RESOLVED BY HAND: 2 src/example.mjs:12 · its thread is resolved without a reply that gives an outcome, and " +
        "no commit names it · owed: the owner's answer: triage it (the owner unresolves its thread first) or leave it",
      "RESUME AT THE TEST-WRITER: 3 src/example.mjs:13 · its thread is open and its commits stop at the plan commit " +
        "0000001 docs(c900): [plan] 3: the spec names both cases · owed: the guard test from the test-writer, then " +
        "the fix and the reply",
      "RESUME AT THE IMPLEMENTER: 5 src/example.mjs:15 · its thread is open and its commits stop at the red commit " +
        "0000002 test(c900): [review] 5: rounds a half up, red · may fail: tests/Unit/RoundingTests.cs, " +
        "tests/Unit/Rounding.cs · owed: the fix from the implementer, then the reply",
      "REPLY OWED: 6 src/example.mjs:16 · fixed · its thread is open and its commits say fixed (red → fix) · " +
        "owed: the reply in its thread, which resolves it",
      'UNCLEAR: 7 src/example.mjs:17 · its thread is open, yet it has the reply "Fixed in `0000009`: done." and ' +
        "commits of this round (its commits say fixed (red → fix)): a resolve that failed, or a finding the owner " +
        "reopened · owed: the owner's decision",
    ]);
  });

  test("quotes a long reply by its first line, cut to 80 characters", () => {
    const firstLine = `Declined: ${"a very long piece of evidence ".repeat(5)}`;
    assert.ok(firstLine.length > 80);

    const [, line] = roundLines(roundRecord([resolved(1, reply(`${firstLine}\nand a second line.`))]));

    assert.ok(line.includes(` and its reply starts "${firstLine.slice(0, 79)}…" · owed: nothing`), line);
  });

  test("quotes a reply of several lines by its first line", () => {
    const [, line] = roundLines(roundRecord([resolved(1, reply("Declined: no such path.\r\n\r\nThe detail."))]));

    assert.ok(line.includes(' and its reply starts "Declined: no such path." · owed: nothing'), line);
  });

  test("names a finding on a whole file by its path, and one without a review comment as such", () => {
    const wholeFile = finding(1, { line: null, resolved: true });

    const lines = roundLines(roundRecord([wholeFile], [red(1, 4)]));

    assert.match(lines[1], /^RESOLVED BY HAND: 1 src\/example\.mjs · /);
    assert.match(lines[2], /^UNCLEAR: 4 \(no review comment\) · commits name finding 4/);
    assert.match(lines[2], new RegExp(` · may fail: commit ${short(1)} · owed: the owner's decision$`));
  });

  test("names the files of a corrected guard test once", () => {
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs"]), red(2, 1, ["tests/Unit/RoundingTests.cs"])];

    const [, line] = roundLines(roundRecord([open(1)], commits));

    assert.match(line, / · may fail: tests\/Unit\/RoundingTests\.cs · owed: /);
  });

  test("names the guard tests, each in backticks, instead of the files when the red commit gives them", () => {
    const body = "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up\nGuard test: money > rounds (1, 2) up";
    const commits = [red(1, 1, ["tests/Unit/RoundingTests.cs", "src/money.test.ts"], body)];

    const [, line] = roundLines(roundRecord([open(1)], commits));

    assert.ok(
      line.includes(
        " · may fail: `Example.Tests.RoundingTests.Rounds_a_half_up`, `money > rounds (1, 2) up` · owed: the fix",
      ),
      line,
    );
    assert.doesNotMatch(line, /RoundingTests\.cs|money\.test\.ts/);
  });

  test("names the tests of the red commits that give them and the files of those that do not, each once", () => {
    const commits = [
      red(1, 1, ["tests/Unit/RoundingTests.cs"], "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up"),
      red(2, 1, ["tests/Unit/SignTests.cs"]),
      red(3, 1, ["tests/Unit/RoundingTests.cs"], "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up"),
      red(4, 1),
    ];

    const [, line] = roundLines(roundRecord([open(1)], commits));

    const named = "`Example.Tests.RoundingTests.Rounds_a_half_up`, tests/Unit/SignTests.cs, commit 0000004";
    assert.ok(line.includes(` · may fail: ${named} · owed: `), line);
  });

  test("adds a line naming the commits after the PR's head that are not this round's own", () => {
    const commits = [red(1, 6), commit(2, "chore: tidy up"), fix(3, 4)];

    const lines = roundLines(roundRecord([resolved(4), open(6)], commits, [1, 2, 3, 4, 5]));

    assert.equal(
      lines.at(-1),
      "NOT THIS ROUND'S COMMITS: 2 of 3 after the PR's head 0000900: " +
        "0000002 chore: tidy up (no `[review] <id>:` or `[plan] <id>:` commit); " +
        "0000003 fix(c900): [review] 4: round a half up (finding 4 is not above 5, the highest number an earlier " +
        "round's summary lists, and is not carried into this round)",
    );
  });

  test("adds no such line when every commit is this round's own", () => {
    const lines = roundLines(roundRecord([open(6)], [red(1, 6)], [1, 2, 3, 4, 5]));

    assert.ok(!lines.some((l) => l.startsWith("NOT THIS ROUND'S COMMITS")), lines.join("\n"));
  });

  test("adds no such line for the commits of an earlier round's finding carried into this round", () => {
    const commits = [red(1, 4), fix(2, 4), red(3, "4, 6")];

    const lines = roundLines(roundRecord([open(4), open(6)], commits, [1, 2, 3, 4, 5]));

    assert.deepEqual(
      lines.map((l) => l.split(" · ")[0]),
      [
        "ROUND: 2",
        "RESUME AT THE IMPLEMENTER: 4 src/example.mjs:14",
        "RESUME AT THE IMPLEMENTER: 6 src/example.mjs:16",
      ],
    );
  });

  test("names at most ten such commits and counts the rest", () => {
    const commits = Array.from({ length: 13 }, (_, i) => commit(i + 1, `chore: other work ${i + 1}`));

    const line = roundLines(roundRecord([open(1)], commits)).at(-1);

    assert.match(line, /^NOT THIS ROUND'S COMMITS: 13 of 13 after the PR's head 0000900: 0000001 chore: other work 1 /);
    assert.match(line, /0000010 chore: other work 10 \([^)]*\); … and 3 more$/);
    assert.doesNotMatch(line, /other work 11/);
  });
});

describe("commitsFromGitLog", () => {
  // One commit as `git log --name-only` prints it with GIT_LOG_FORMAT: the id, the subject, the body (which ends with
  // the trailers) and the trailers alone, each followed by a unit separator, then the names of the changed files.
  function logged(id, subject, body, trailers, files) {
    const lines = (text) => (text ? `${text}\n` : "");
    const message = [body, trailers].filter(Boolean).join("\n\n");
    const names = files.length > 0 ? `\n${files.join("\n")}\n` : "";
    return `\x1e${id}\x1f${subject}\x1f${lines(message)}\x1f${lines(trailers)}\x1f\n${names}`;
  }
  const trailers =
    "Co-Authored-By: A Made-Up Model <model@example.com>\nMade-Up-Session: https://example.com/session_1";

  test("asks git for the id, the subject, the body and the trailers, separated by control characters", () => {
    assert.equal(GIT_LOG_FORMAT, "--format=%x1e%H%x1f%s%x1f%b%x1f%(trailers)%x1f");
  });

  test("gives no commits for no output", () => {
    assert.deepEqual(commitsFromGitLog(""), []);
  });

  test("reads each commit's id, subject and changed files, in the output's order", () => {
    const text =
      logged(sha(1), "test(c900): [review] 6: rounds a half up, red", "", trailers, ["tests/Unit/RoundingTests.cs"]) +
      logged(sha(2), "fix(c900): [review] 6: round a half up", "", trailers, ["src/Rounding.cs", "src/Money.cs"]);

    assert.deepEqual(commitsFromGitLog(text), [
      {
        sha: sha(1),
        subject: "test(c900): [review] 6: rounds a half up, red",
        body: "",
        files: ["tests/Unit/RoundingTests.cs"],
      },
      {
        sha: sha(2),
        subject: "fix(c900): [review] 6: round a half up",
        body: "",
        files: ["src/Rounding.cs", "src/Money.cs"],
      },
    ]);
  });

  test("gives the body without the trailers, so a guard removed commit's body is the reply in full", () => {
    const reply =
      "Declined by the owner: the old rounding is what the bank shows.\n\nThe test and its claim: see 0000001.";
    const text = logged(sha(2), "test(c900): [review] 6: guard removed, declined", reply, trailers, ["tests/A.cs"]);

    const [removed] = commitsFromGitLog(text);

    assert.equal(removed.body, reply);
    assert.deepEqual(removed.files, ["tests/A.cs"]);
  });

  test("keeps a red commit's guard test lines in its body, with or without trailers after them", () => {
    // Git takes a `Guard test: …` line for no trailer (a trailer's name has no space), so it stays in the body.
    const names = "Guard test: Example.Tests.RoundingTests.Rounds_a_half_up\nGuard test: money > rounds a half up";
    const subject = "test(c900): [review] 3, 7: rounds a half up, red";
    const text =
      logged(sha(1), subject, names, trailers, ["tests/Unit/RoundingTests.cs"]) +
      logged(sha(2), subject, names, "", ["tests/Unit/RoundingTests.cs"]);

    const commits = commitsFromGitLog(text);

    assert.deepEqual(
      commits.map((c) => c.body),
      [names, names],
    );
    const result = classify([open(3), open(7)], [commits[0]]);
    assert.deepEqual(
      result.findings.map((f) => [f.id, f.class, f.mayFail.map((c) => c.tests)]),
      [
        [3, "resume-implementer", [["Example.Tests.RoundingTests.Rounds_a_half_up", "money > rounds a half up"]]],
        [7, "resume-implementer", [["Example.Tests.RoundingTests.Rounds_a_half_up", "money > rounds a half up"]]],
      ],
    );
  });

  test("keeps a body whole when the commit has no trailers", () => {
    const text = logged(sha(3), "docs(c900): [plan] 7: the spec names both cases", "One line.\nAnother.", "", []);

    assert.deepEqual(commitsFromGitLog(text), [
      {
        sha: sha(3),
        subject: "docs(c900): [plan] 7: the spec names both cases",
        body: "One line.\nAnother.",
        files: [],
      },
    ]);
  });

  test("reads output with Windows line endings", () => {
    const text = logged(
      sha(4),
      "test(c900): [review] 8: guard removed, deferred",
      "Deferred to the issue 123.",
      trailers,
      ["tests/A.cs", "tests/B.cs"],
    ).replace(/\n/g, "\r\n");

    assert.deepEqual(commitsFromGitLog(text), [
      {
        sha: sha(4),
        subject: "test(c900): [review] 8: guard removed, deferred",
        body: "Deferred to the issue 123.",
        files: ["tests/A.cs", "tests/B.cs"],
      },
    ]);
  });

  test("its commits are what classifyRound and ownCommits read", () => {
    const text =
      logged(sha(1), "test(c900): [review] 6: rounds a half up, red", "", trailers, ["tests/Unit/RoundingTests.cs"]) +
      logged(
        sha(2),
        "test(c900): [review] 6: guard removed, declined",
        "Declined by the owner: fine as it is.",
        trailers,
        ["tests/Unit/RoundingTests.cs"],
      );
    const commits = commitsFromGitLog(text);

    const f = only(classify([open(6)], commits, { earlierNumbers: [1, 2, 3] }));

    assert.equal(f.class, "reply-owed");
    assert.equal(f.outcome, "declined");
    assert.equal(f.replyText, "Declined by the owner: fine as it is.");
    assert.equal(ownCommits(commits, [1, 2, 3]).allOwn, true);
  });
});
