// Tests for common.mjs's pure functions: how review comments become numbered findings, with every thread's replies,
// and when each one's review was submitted, a text's first line, the lines of a diff a comment can attach to, how a
// chat review's findings become review comments to post, when the PR's last triage summary was posted and whether a
// round's summary already is, and which references in a text would post a backlink outside the repository and the
// refusal that names them. The round and its restart (roundOf, ownCommits, classifyRound and what they rest on) are
// tested in round.test.mjs beside this file.
// Nothing here calls gh or the network; the comments, reviews and files are small made-up objects shaped like the
// REST API's, and every other repository named is made up.
//
//   node --test ".claude/skills/triage-review/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  backlinkRefusal,
  backlinkRisks,
  findingsFrom,
  firstLine,
  lastSummaryTime,
  linesInDiff,
  planPosts,
  ranges,
  submissionTimes,
  summaryPosted,
} from "./common.mjs";

// A made-up top-level review comment as the REST API returns it; a test overrides what it is about.
function comment(id, overrides = {}) {
  return {
    id,
    path: "docs/example.md",
    line: 10,
    original_line: 10,
    body: `Finding ${id}\nMore detail.`,
    user: { login: "a-reviewer" },
    html_url: `https://github.com/example/repo/pull/1#discussion_r${id}`,
    ...overrides,
  };
}

// findingsFrom's third argument is a Map from each top-level comment's id to when its review was submitted (an ISO
// 8601 time), or null while that review is pending; replies have no entry. The gather builds it with submissionTimes
// from the REST API's list of the PR's reviews (each review's `state` and `submitted_at`).

// A made-up submission time: 2026-11-20 at `hour` o'clock UTC.
const at = (hour) => `2026-11-20T${String(hour).padStart(2, "0")}:00:00Z`;

// A made-up PR comment (an issue comment) as the REST API returns it.
const issueComment = (id, createdAt, body) => ({
  id,
  body,
  created_at: createdAt,
  user: { login: "a-reviewer" },
  html_url: `https://github.com/example/repo/pull/1#issuecomment-${id}`,
});

// Each top-level comment in its own review, submitted in the order of the comments' ids: the tests whose subject is
// not the submission time.
function submittedInIdOrder(comments) {
  return new Map(
    comments
      .filter((c) => c.in_reply_to_id == null)
      .map((c) => [c.id, new Date(Date.UTC(2026, 10, 20) + c.id * 1000).toISOString().replace(".000Z", "Z")]),
  );
}

describe("findingsFrom", () => {
  test("numbers a comment whose review was submitted later after the others, even with a lower id", () => {
    // Round 1 numbers three comments. Then a review drafted before them, so its comment has a lower id, is submitted.
    const roundOne = [comment(1001), comment(1002), comment(1003)];
    const roundOneSubmitted = new Map([
      [1001, at(9)],
      [1002, at(10)],
      [1003, at(11)],
    ]);
    const roundTwo = [comment(1000), ...roundOne];
    const roundTwoSubmitted = new Map([...roundOneSubmitted, [1000, at(12)]]);

    const before = findingsFrom(roundOne, new Set(), roundOneSubmitted).findings;
    const after = findingsFrom(roundTwo, new Set(), roundTwoSubmitted).findings;

    const numbers = (findings) => findings.map((f) => [f.commentId, f.id]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(numbers(before), [
      [1001, 1],
      [1002, 2],
      [1003, 3],
    ]);
    assert.deepEqual(numbers(after), [
      [1000, 4],
      [1001, 1],
      [1002, 2],
      [1003, 3],
    ]);
  });

  test("numbers the comments of one review by their ids, after the reviews submitted before it", () => {
    // Two reviews whose comments' ids interleave: the earlier review holds 1302 and 1304, the later 1301 and 1303.
    const comments = [comment(1303), comment(1302), comment(1301), comment(1304)];
    const submitted = new Map([
      [1302, at(9)],
      [1304, at(9)],
      [1301, at(10)],
      [1303, at(10)],
    ]);

    const { findings } = findingsFrom(comments, new Set(), submitted);

    assert.deepEqual(
      findings.map((f) => [f.commentId, f.id]),
      [
        [1301, 3],
        [1302, 1],
        [1303, 4],
        [1304, 2],
      ],
    );
  });

  test("leaves out a comment of a pending review, which takes no number from those submitted", () => {
    const comments = [comment(1101), comment(1102), comment(1103)];
    const submitted = new Map([
      [1101, at(9)],
      [1102, null],
      [1103, at(10)],
    ]);

    const { findings, resolved, resolvedIds } = findingsFrom(comments, new Set(), submitted);

    assert.deepEqual(
      findings.map((f) => [f.commentId, f.id]),
      [
        [1101, 1],
        [1103, 2],
      ],
    );
    assert.equal(resolved, 0);
    assert.deepEqual(resolvedIds, []);
  });

  test("leaves out a comment of a pending review even when its thread is resolved", () => {
    const comments = [comment(1201), comment(1202), comment(1203)];
    const submitted = new Map([
      [1201, at(9)],
      [1202, null],
      [1203, at(10)],
    ]);

    const { findings, resolved, resolvedIds } = findingsFrom(comments, new Set([1202, 1203]), submitted);

    assert.deepEqual(
      findings.map((f) => [f.commentId, f.id]),
      [[1201, 1]],
    );
    assert.equal(resolved, 1);
    assert.deepEqual(resolvedIds, [2]);
  });

  test("fails rather than guess a number for a top-level comment whose review's submission is unknown", () => {
    const comments = [comment(1401), comment(1402)];
    const submitted = new Map([[1401, at(9)]]);

    assert.throws(() => findingsFrom(comments, new Set(), submitted));
  });

  test("counts and names the resolved comments by their numbers in submission order", () => {
    // 1500 has the lowest id but was submitted third; 1500 and 1501 are resolved.
    const comments = [comment(1503), comment(1500), comment(1502), comment(1501)];
    const submitted = new Map([
      [1501, at(9)],
      [1502, at(10)],
      [1500, at(11)],
      [1503, at(12)],
    ]);

    const { findings, resolved, resolvedIds } = findingsFrom(comments, new Set([1500, 1501]), submitted);

    assert.deepEqual(resolvedIds, [1, 3]);
    assert.equal(resolved, 2);
    assert.deepEqual(
      findings.map((f) => [f.commentId, f.id]),
      [
        [1502, 2],
        [1503, 4],
      ],
    );
  });

  test("numbers the top-level comments in posting order, resolved ones included", () => {
    const comments = [comment(103), comment(101), comment(102)];

    const { findings } = findingsFrom(comments, new Set([101, 102]), submittedInIdOrder(comments));

    assert.deepEqual(
      findings.map((f) => [f.id, f.commentId]),
      [[3, 103]],
    );
  });

  test("leaves out the comments whose threads are resolved and counts them", () => {
    const comments = [comment(201), comment(202), comment(203)];

    const { findings, resolved } = findingsFrom(comments, new Set([201, 203]), submittedInIdOrder(comments));

    assert.deepEqual(
      findings.map((f) => f.commentId),
      [202],
    );
    assert.equal(resolved, 2);
  });

  test("names the resolved comments it leaves out by their numbers, in ascending order", () => {
    // Five top-level comments, in any order; the 1st, 2nd and 4th are resolved. Their paths sort them otherwise
    // (4th, 2nd, 1st), and the reply posted between the 2nd and the 3rd takes no number.
    const comments = [
      comment(826, { path: "docs/d.md" }),
      comment(825, { path: "docs/a.md" }),
      comment(821, { path: "src/z.mjs" }),
      comment(824, { path: "docs/c.md" }),
      comment(823, { in_reply_to_id: 821 }),
      comment(822, { path: "docs/b.md" }),
    ];

    const submitted = submittedInIdOrder(comments);
    const { findings, resolved, resolvedIds } = findingsFrom(comments, new Set([821, 822, 825]), submitted);

    assert.deepEqual(resolvedIds, [1, 2, 4]);
    assert.equal(resolved, 3);
    assert.deepEqual(
      findings.map((f) => f.id).sort((a, b) => a - b),
      [3, 5],
    );
  });

  test("names no resolved comments when no thread is resolved", () => {
    const comments = [comment(811), comment(812)];

    const { resolved, resolvedIds } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));

    assert.deepEqual(resolvedIds, []);
    assert.equal(resolved, 0);
  });

  test("never makes a reply a finding, and a reply takes no number", () => {
    const comments = [comment(301), comment(302, { in_reply_to_id: 301 }), comment(303)];

    const { findings, resolved } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));

    assert.deepEqual(
      findings.map((f) => [f.id, f.commentId]),
      [
        [1, 301],
        [2, 303],
      ],
    );
    assert.equal(resolved, 0);
  });

  test("orders the findings by path, then line, then comment id, whatever the input order", () => {
    const comments = [
      comment(404, { path: "docs/a.md", line: 20 }),
      comment(401, { path: "src/b.mjs", line: 5 }),
      comment(405, { path: "src/b.mjs", line: 1 }),
      comment(402, { path: "docs/a.md", line: 20 }),
      comment(403, { path: "docs/a.md", line: 3 }),
    ];

    const { findings } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));

    assert.deepEqual(
      findings.map((f) => [f.path, f.line, f.commentId]),
      [
        ["docs/a.md", 3, 403],
        ["docs/a.md", 20, 402],
        ["docs/a.md", 20, 404],
        ["src/b.mjs", 1, 405],
        ["src/b.mjs", 5, 401],
      ],
    );
  });

  test("takes the original line of an outdated comment, else no line", () => {
    const comments = [
      comment(501, { line: 4, original_line: 9 }),
      comment(502, { line: null, original_line: 7 }),
      comment(503, { line: null, original_line: null }),
    ];

    const { findings } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));
    const lineOf = (commentId) => findings.find((f) => f.commentId === commentId).line;

    assert.equal(lineOf(501), 4);
    assert.equal(lineOf(502), 7);
    assert.equal(lineOf(503), null);
  });

  test("titles a finding with its body's first line, cut to 120 characters", () => {
    const comments = [
      comment(601, { body: "Short title\nThe detail below it." }),
      comment(602, { body: `${"x".repeat(130)}\nThe detail below it.` }),
    ];

    const { findings } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));
    const titleOf = (commentId) => findings.find((f) => f.commentId === commentId).title;

    assert.equal(titleOf(601), "Short title");
    assert.equal(titleOf(602), "x".repeat(120));
  });

  test("titles a finding whose body has Windows line endings without the carriage return", () => {
    const comments = [comment(701, { body: "Important: one\r\nmore" })];

    const { findings } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));

    assert.equal(findings[0].title, "Important: one");
  });

  // `all` is what the gather sorts a round's findings from (classifyRound; its tests are in round.test.mjs).
  // A made-up reply in the thread that the comment `to` starts.
  const replyTo = (id, to, hour, body) =>
    comment(id, { in_reply_to_id: to, body, created_at: at(hour), user: { login: "the-owner" } });

  test("lists every numbered comment, resolved or not, in the order of the numbers", () => {
    // The paths would order them otherwise (1902, 1903, 1901); 1902 is resolved.
    const comments = [
      comment(1903, { path: "docs/b.md" }),
      comment(1901, { path: "src/z.mjs" }),
      comment(1902, { path: "docs/a.md" }),
    ];

    const { all, findings } = findingsFrom(comments, new Set([1902]), submittedInIdOrder(comments));

    assert.deepEqual(
      all.map((f) => [f.id, f.commentId, f.resolved]),
      [
        [1, 1901, false],
        [2, 1902, true],
        [3, 1903, false],
      ],
    );
    assert.deepEqual(
      findings.map((f) => f.id),
      [3, 1],
    );
  });

  test("gives each of them a finding's fields, whether its thread is resolved, and its replies", () => {
    const comments = [comment(1911, { path: "src/a.mjs", line: 7, body: "Important: one\nmore" })];

    const { all } = findingsFrom(comments, new Set([1911]), submittedInIdOrder(comments));

    assert.deepEqual(all, [
      {
        id: 1,
        commentId: 1911,
        path: "src/a.mjs",
        line: 7,
        title: "Important: one",
        body: "Important: one\nmore",
        author: "a-reviewer",
        url: "https://github.com/example/repo/pull/1#discussion_r1911",
        resolved: true,
        replies: [],
      },
    ]);
  });

  test("gives each thread its own replies, in the order they were posted", () => {
    // 1924 has the lowest reply id but was posted last; 1926 answers the other thread.
    const comments = [
      comment(1921),
      comment(1922),
      replyTo(1925, 1921, 11, "Fixed in `0123abc`: the heading."),
      replyTo(1926, 1922, 10, "Declined: design.md D4 decides this."),
      replyTo(1924, 1921, 12, "Thanks."),
      replyTo(1927, 1921, 9, "Is the old behaviour wanted?"),
    ];

    const { all } = findingsFrom(comments, new Set([1921]), submittedInIdOrder(comments));

    assert.deepEqual(
      all.map((f) => [f.commentId, f.replies]),
      [
        [
          1921,
          [
            { body: "Is the old behaviour wanted?", createdAt: at(9), author: "the-owner" },
            { body: "Fixed in `0123abc`: the heading.", createdAt: at(11), author: "the-owner" },
            { body: "Thanks.", createdAt: at(12), author: "the-owner" },
          ],
        ],
        [1922, [{ body: "Declined: design.md D4 decides this.", createdAt: at(10), author: "the-owner" }]],
      ],
    );
  });

  test("orders replies posted at the same time by their ids", () => {
    const comments = [comment(1931), replyTo(1933, 1931, 9, "Second."), replyTo(1932, 1931, 9, "First.")];

    const { all } = findingsFrom(comments, new Set(), submittedInIdOrder(comments));

    assert.deepEqual(
      all[0].replies.map((r) => r.body),
      ["First.", "Second."],
    );
  });

  test("leaves a comment of a pending review out of them too", () => {
    const comments = [comment(1941), comment(1942), comment(1943)];
    const submitted = new Map([
      [1941, at(9)],
      [1942, null],
      [1943, at(10)],
    ]);

    const { all } = findingsFrom(comments, new Set([1942, 1943]), submitted);

    assert.deepEqual(
      all.map((f) => [f.id, f.commentId, f.resolved]),
      [
        [1, 1941, false],
        [2, 1943, true],
      ],
    );
  });
});

describe("submissionTimes", () => {
  // A made-up review as the REST API's list of a PR's reviews returns it; a pending one has no submission time.
  const review = (id, state, submittedAt) => ({ id, state, submitted_at: submittedAt });
  // A made-up top-level comment of the given review.
  const commentOf = (id, reviewId) => comment(id, { pull_request_review_id: reviewId });

  test("maps a submitted review's comment to the time its review was submitted", () => {
    const comments = [commentOf(1601, 7001)];
    const reviews = [review(7001, "COMMENTED", at(9))];

    assert.deepEqual(submissionTimes(comments, reviews), new Map([[1601, at(9)]]));
  });

  test("maps a comment of a pending review to no time", () => {
    const comments = [commentOf(1602, 7002)];
    const reviews = [{ id: 7002, state: "PENDING" }];

    assert.deepEqual(submissionTimes(comments, reviews), new Map([[1602, null]]));
  });

  test("gives no entry to a comment whose review is not listed", () => {
    const comments = [commentOf(1603, 7003), commentOf(1604, 7999)];
    const reviews = [review(7003, "COMMENTED", at(9))];

    assert.deepEqual(submissionTimes(comments, reviews), new Map([[1603, at(9)]]));
  });

  test("gives no entry to a comment of a review that is neither pending nor submitted", () => {
    const comments = [commentOf(1605, 7004), commentOf(1606, 7005)];
    const reviews = [review(7004, "COMMENTED", at(9)), review(7005, "COMMENTED", null)];

    assert.deepEqual(submissionTimes(comments, reviews), new Map([[1605, at(9)]]));
  });

  test("gives replies no entry", () => {
    const comments = [commentOf(1611, 7006), comment(1612, { in_reply_to_id: 1611, pull_request_review_id: 7006 })];
    const reviews = [review(7006, "COMMENTED", at(9))];

    assert.deepEqual(submissionTimes(comments, reviews), new Map([[1611, at(9)]]));
  });

  test("maps every comment of one review to that review's time", () => {
    const comments = [commentOf(1623, 7007), commentOf(1621, 7007), commentOf(1624, 7008), commentOf(1622, 7007)];
    const reviews = [review(7007, "CHANGES_REQUESTED", at(10)), review(7008, "APPROVED", at(11))];

    assert.deepEqual(
      submissionTimes(comments, reviews),
      new Map([
        [1621, at(10)],
        [1622, at(10)],
        [1623, at(10)],
        [1624, at(11)],
      ]),
    );
  });
});

describe("firstLine", () => {
  test("gives the first line of text with Windows line endings without the carriage return", () => {
    assert.equal(firstLine("Line one\r\nLine two\r\n"), "Line one");
  });

  test("gives the first line of text with Unix line endings", () => {
    assert.equal(firstLine("Line one\nLine two\n"), "Line one");
  });

  test("skips the blank lines and spaces before the text", () => {
    assert.equal(firstLine("\r\n\r\n  Line one\r\nLine two"), "Line one");
  });
});

// A made-up file patch as the REST API's "list PR files" returns it: hunks only, lines joined by "\n", and no
// final newline.
function patch(...lines) {
  return lines.join("\n");
}

describe("linesInDiff", () => {
  test("gives the new version's numbers of a hunk's context and added lines, not its deleted ones", () => {
    const lines = linesInDiff(
      patch(
        "@@ -10,4 +10,5 @@ A section",
        " context a", // new 10
        "-removed line", // old 11 only
        "+added one", // new 11
        "+added two", // new 12
        " context b", // new 13
        " context c", // new 14
      ),
    );

    assert.deepEqual(lines, new Set([10, 11, 12, 13, 14]));
  });

  test("numbers each hunk from its own header", () => {
    const lines = linesInDiff(
      patch(
        "@@ -1,3 +1,3 @@",
        " line one", // new 1
        "-old line two",
        "+new line two", // new 2
        " line three", // new 3
        "@@ -40,3 +40,4 @@ Further down",
        " line forty", // new 40
        "+inserted", // new 41
        " old forty-one", // new 42
        " old forty-two", // new 43
      ),
    );

    assert.deepEqual(lines, new Set([1, 2, 3, 40, 41, 42, 43]));
  });

  test("reads a hunk header without line counts", () => {
    const lines = linesInDiff(patch("@@ -1 +1 @@", "-the only line", "+the only line, changed"));

    assert.deepEqual(lines, new Set([1]));
  });

  test("gives no number to the no-newline-at-end-of-file marker", () => {
    const lines = linesInDiff(
      patch(
        "@@ -1,2 +1,2 @@",
        " first", // new 1
        "-second",
        "\\ No newline at end of file",
        "+second, changed", // new 2
        "\\ No newline at end of file",
      ),
    );

    assert.deepEqual(lines, new Set([1, 2]));
  });

  test("gives no lines for a file without a patch, such as a binary or very large file", () => {
    assert.deepEqual(linesInDiff(undefined), new Set());
    assert.deepEqual(linesInDiff(""), new Set());
  });
});

describe("planPosts", () => {
  const headSha = "0123456789abcdef0123456789abcdef01234567";
  // planPosts' last argument: when the PR's last triage summary was posted (lastSummaryTime), or null before the
  // first one, when every comment already on the PR counts.
  const noSummary = null;
  // Made-up PR files: docs/a.md's new lines 1-4 and src/b.mjs's 20-22 are in the diff; docs/logo.png has no patch.
  const prFiles = [
    {
      filename: "docs/a.md",
      patch: patch("@@ -1,3 +1,4 @@ Title", " line one", "+line two", " line three", " line four"),
    },
    {
      filename: "src/b.mjs",
      patch: patch("@@ -20,2 +20,3 @@ function b", " const x = 1;", "+const y = 2;", " return x + y;"),
    },
    { filename: "docs/logo.png" },
  ];

  test("posts a finding on its line when the line is in the PR's diff", () => {
    const findings = [{ path: "src/b.mjs", line: 21, body: "This constant is unused." }];

    const { errors, posts } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(posts, [
      {
        action: "post",
        request: { body: "This constant is unused.", commit_id: headSha, path: "src/b.mjs", line: 21, side: "RIGHT" },
      },
    ]);
  });

  test("posts a finding without a line on its file", () => {
    const findings = [{ path: "docs/a.md", line: null, body: "The page has no heading." }];

    const { errors, posts } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(posts, [
      {
        action: "post",
        request: { body: "The page has no heading.", commit_id: headSha, path: "docs/a.md", subject_type: "file" },
      },
    ]);
  });

  test("posts a finding whose line is outside the PR's diff on its file", () => {
    const findings = [{ path: "docs/a.md", line: 50, body: "An unchanged line is wrong." }];

    const { errors, posts } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(posts, [
      {
        action: "post",
        request: { body: "An unchanged line is wrong.", commit_id: headSha, path: "docs/a.md", subject_type: "file" },
      },
    ]);
  });

  test("posts a finding on its file when the PR's file has no patch", () => {
    const findings = [{ path: "docs/logo.png", line: 1, body: "The logo is the old one." }];

    const { errors, posts } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(posts, [
      {
        action: "post",
        request: { body: "The logo is the old one.", commit_id: headSha, path: "docs/logo.png", subject_type: "file" },
      },
    ]);
  });

  test("plans one post per finding, in the findings' order", () => {
    // The reverse of the order by path, so a sort by file would show.
    const findings = [
      { path: "src/b.mjs", line: 22, body: "Finding one." },
      { path: "docs/logo.png", line: null, body: "Finding two." },
      { path: "docs/a.md", line: 2, body: "Finding three." },
    ];

    const { errors, posts } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.request.path, p.request.body]),
      [
        ["post", "src/b.mjs", "Finding one."],
        ["post", "docs/logo.png", "Finding two."],
        ["post", "docs/a.md", "Finding three."],
      ],
    );
  });

  test("skips a finding already posted as a top-level comment, whatever its line endings and outer spaces", () => {
    const findings = [{ path: "docs/a.md", line: 2, body: "  Same finding.\nWith detail.\n" }];
    const existing = [comment(901, { body: "Same finding.\r\nWith detail.\r\n\r\n" })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].action, "skip");
    assert.equal(posts[0].existingId, 901);
  });

  test("posts a finding whose text is on the PR only as a reply", () => {
    const findings = [{ path: "docs/a.md", line: 2, body: "Said only in a reply." }];
    const existing = [
      comment(911, { body: "A different finding." }),
      comment(912, { in_reply_to_id: 911, body: "Said only in a reply." }),
    ];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => p.action),
      ["post"],
    );
  });

  test("after a part-way failure, plans to post only the findings not yet on the PR", () => {
    const findings = [
      { path: "docs/a.md", line: 1, body: "First finding." },
      { path: "src/b.mjs", line: 21, body: "Second finding." },
      { path: "src/b.mjs", line: 22, body: "Second finding, and more." },
    ];
    const existing = [comment(921, { body: "First finding." }), comment(922, { body: "Second finding." })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId, p.request.body]),
      [
        ["skip", 921, "First finding."],
        ["skip", 922, "Second finding."],
        ["post", undefined, "Second finding, and more."],
      ],
    );
  });

  test("lets each comment already on the PR account for one finding only", () => {
    const findings = [
      { path: "docs/a.md", line: 1, body: "The same finding." },
      { path: "docs/a.md", line: 2, body: "The same finding." },
    ];
    const existing = [comment(931, { body: "The same finding." })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [
        ["skip", 931],
        ["post", undefined],
      ],
    );
  });

  test("posts a finding whose text an earlier round's comment has, posted before the last triage summary", () => {
    const findings = [{ path: "docs/a.md", line: 2, body: "A finding reported again." }];
    const existing = [comment(941, { body: "A finding reported again.", created_at: at(9) })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, at(10));

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [["post", undefined]],
    );
  });

  test("skips a finding already posted after the last triage summary, as a rerun of the round finds it", () => {
    const findings = [{ path: "docs/a.md", line: 2, body: "Posted by this round." }];
    const existing = [comment(942, { body: "Posted by this round.", created_at: at(11) })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, at(10));

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [["skip", 942]],
    );
  });

  test("before the first triage summary, skips a finding that any comment already on the PR has", () => {
    const findings = [{ path: "docs/a.md", line: 2, body: "Posted by round one." }];
    const existing = [comment(943, { body: "Posted by round one.", created_at: at(9) })];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, noSummary);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [["skip", 943]],
    );
  });

  test("lets only the comments posted after the last triage summary account for findings", () => {
    // The same text twice on the PR: by an earlier round (951) and by this round before it stopped (952).
    const findings = [
      { path: "docs/a.md", line: 1, body: "The same text." },
      { path: "docs/a.md", line: 2, body: "The same text." },
    ];
    const existing = [
      comment(951, { body: "The same text.", created_at: at(9) }),
      comment(952, { body: "The same text.", created_at: at(11) }),
    ];

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha, at(10));

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [
        ["skip", 952],
        ["post", undefined],
      ],
    );
  });

  // An error names the finding by its position in the review (1-based) and its path.
  const namesFinding = (errors, position, path) =>
    errors.some((e) => new RegExp(`\\b${position}\\b`).test(e) && e.includes(path));

  test("reports a finding whose file the PR does not change, by its position and path", () => {
    const findings = [
      { path: "docs/a.md", line: 1, body: "A good finding." },
      { path: "docs/missing.md", line: 3, body: "Points at a file the PR does not change." },
    ];

    const { errors } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.equal(errors.length, 1);
    assert.ok(namesFinding(errors, 2, "docs/missing.md"), `no error names finding 2 and its path: ${errors}`);
  });

  test("reports each finding with an empty, blank or missing body, one error per finding", () => {
    const findings = [
      { path: "docs/a.md", line: 1, body: "A good finding." },
      { path: "src/b.mjs", line: 21, body: "" },
      { path: "docs/logo.png", line: null },
      { path: "docs/a.md", line: 2, body: "Another good finding." },
      { path: "docs/a.md", line: 3, body: "  \r\n " },
    ];

    const { errors } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.equal(errors.length, 3);
    assert.ok(namesFinding(errors, 2, "src/b.mjs"), `no error names finding 2 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 3, "docs/logo.png"), `no error names finding 3 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 5, "docs/a.md"), `no error names finding 5 and its path: ${errors}`);
  });

  test("reports each finding whose line is given but is not a positive whole number, one error per finding", () => {
    // Each bad finding has a path of its own, so an error cannot be taken for another's.
    const findings = [
      { path: "docs/a.md", line: 1, body: "A good finding." },
      { path: "src/b.mjs", line: "12", body: "A line given as text." },
      { path: "docs/logo.png", line: 0, body: "A line before the first." },
      { path: "docs/a.md", line: 2.5, body: "Half a line." },
      { path: "src/b.mjs", line: null, body: "Another good finding." },
    ];

    const { errors } = planPosts(findings, prFiles, [], headSha, noSummary);

    assert.equal(errors.length, 3);
    assert.ok(namesFinding(errors, 2, "src/b.mjs"), `no error names finding 2 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 3, "docs/logo.png"), `no error names finding 3 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 4, "docs/a.md"), `no error names finding 4 and its path: ${errors}`);
  });
});

describe("lastSummaryTime", () => {
  test("gives the time of the latest triage summary, whatever the comments' order", () => {
    const comments = [
      issueComment(5003, at(14), "## Review triage, round 2\n\n| # | Finding | Outcome |"),
      issueComment(5004, at(15), "Thanks, merging after the next look."),
      issueComment(5001, at(9), "## Review triage\n\n| # | Finding | Outcome |"),
      issueComment(5002, at(12), "A question about round one."),
    ];

    assert.equal(lastSummaryTime(comments), at(14));
  });

  test("takes only a comment that starts with the summary heading, not one that mentions it later", () => {
    const comments = [
      issueComment(5011, at(9), "## Review triage\n\n| # | Finding | Outcome |"),
      issueComment(5012, at(11), "Before the next round:\n## Review triage\nwill follow."),
      issueComment(5013, at(12), "The Review triage of round one looks complete."),
    ];

    assert.equal(lastSummaryTime(comments), at(9));
  });

  test("takes a summary whose heading ends with a Windows line ending", () => {
    const comments = [
      issueComment(5021, at(9), "## Review triage\n\n| # | Finding | Outcome |"),
      issueComment(5022, at(13), "## Review triage, round 3\r\n\r\n| # | Finding | Outcome |"),
    ];

    assert.equal(lastSummaryTime(comments), at(13));
  });

  test("gives no time when the PR has no triage summary", () => {
    assert.equal(lastSummaryTime([]), null);
    assert.equal(lastSummaryTime([issueComment(5031, at(9), "Looks good so far.")]), null);
  });
});

describe("summaryPosted", () => {
  const roundOne = "## Review triage\n\n| # | Finding | Outcome |";
  const roundTwo = "## Review triage, round 2\n\n| # | Finding | Outcome |";

  test("finds the summary already posted for the round by its heading", () => {
    const comments = [
      issueComment(6001, at(9), roundOne),
      issueComment(6002, at(10), "A question about round one."),
      issueComment(6003, at(12), roundTwo),
    ];

    const posted = summaryPosted(comments, "## Review triage, round 2\n\n| # | Finding | Outcome |\n| 7 | Other |");

    assert.deepEqual(posted, comments[2]);
  });

  test("finds it whatever line ending follows the heading", () => {
    const crlf = [issueComment(6011, at(9), "## Review triage, round 3\r\n\r\n| # | Finding | Outcome |")];
    const lf = [issueComment(6012, at(9), "## Review triage, round 3\n\n| # | Finding | Outcome |")];

    assert.equal(summaryPosted(crlf, "## Review triage, round 3\n\n| # |")?.id, 6011);
    assert.equal(summaryPosted(lf, "## Review triage, round 3\r\n\r\n| # |")?.id, 6012);
  });

  test("does not take the first round's summary for a later round's, nor a later round's for the first's", () => {
    assert.equal(summaryPosted([issueComment(6021, at(9), roundOne)], roundTwo), null);
    assert.equal(summaryPosted([issueComment(6022, at(9), roundTwo)], roundOne), null);
  });

  test("finds none when no comment starts with the round's heading", () => {
    assert.equal(summaryPosted([], roundTwo), null);
    const comments = [
      issueComment(6031, at(9), "Looks good so far."),
      issueComment(6032, at(10), "Before the next round:\n## Review triage, round 2\nwill follow."),
    ];
    assert.equal(summaryPosted(comments, roundTwo), null);
  });
});

describe("backlinkRisks", () => {
  // The repository the scripts post in; example-org/widget and other.user/some-lib stand for any other repository.
  const ownRepo = "jakubbohm/RevolutReader";

  // backlinkRisks finds exactly one match per expected reference, in text order: each match holds its reference and
  // no white space (the reference itself, not the line around it). How far a link's match reaches (its https://,
  // a trailing anchor) is left open.
  function assertFinds(text, references) {
    const found = backlinkRisks(text, ownRepo);
    assert.equal(found.length, references.length, `found ${JSON.stringify(found)}`);
    references.forEach((reference, i) => {
      assert.ok(
        found[i].includes(reference) && !/\s/.test(found[i]),
        `match ${i + 1} is ${JSON.stringify(found[i])}, not ${reference}`,
      );
    });
  }
  const assertClean = (text) => assert.deepEqual(backlinkRisks(text, ownRepo), []);

  test("finds another repository's issue named by its owner, name and number", () => {
    assertFinds("Upstream: example-org/widget#123, and other.user/some-lib#7.", [
      "example-org/widget#123",
      "other.user/some-lib#7",
    ]);
  });

  test("finds a github.com link to another repository's issue or pull request, with or without https and www", () => {
    const text = [
      "https://github.com/example-org/widget/issues/12",
      "github.com/example-org/widget/pull/7",
      "https://www.github.com/other.user/some-lib/issues/3#issuecomment-45",
      "http://github.com/example-org/widget/pull/8/files",
    ].join("\n");

    assertFinds(text, [
      "github.com/example-org/widget/issues/12",
      "github.com/example-org/widget/pull/7",
      "github.com/other.user/some-lib/issues/3",
      "github.com/example-org/widget/pull/8",
    ]);
  });

  test("allows a redirect.github.com link to another repository's issue or pull request", () => {
    assertClean(
      "Upstream: https://redirect.github.com/example-org/widget/issues/12 and " +
        "redirect.github.com/other.user/some-lib/pull/7.",
    );
  });

  test("allows a github.com link to another repository's page that is no issue or pull request", () => {
    assertClean(
      [
        "https://github.com/example-org/widget",
        "https://github.com/example-org/widget/blob/main/README.md",
        "https://github.com/example-org/widget/releases/tag/v1.2.0",
      ].join("\n"),
    );
  });

  test("finds this repository's retired pull request in every form that links it", () => {
    const text = [
      "#94 was retired.",
      "Also jakubbohm/RevolutReader#94, https://github.com/jakubbohm/RevolutReader/pull/94 and",
      "github.com/jakubbohm/RevolutReader/issues/94.",
    ].join("\n");

    assertFinds(text, [
      "#94",
      "#94",
      "github.com/jakubbohm/RevolutReader/pull/94",
      "github.com/jakubbohm/RevolutReader/issues/94",
    ]);
  });

  test("takes neither another number nor a 94 without # for the retired pull request", () => {
    assertClean(
      [
        "#940 and #9 are other issues; R-94 is a lesson, and the review had 94 findings (PR 94 in words).",
        "jakubbohm/RevolutReader#940 and https://github.com/jakubbohm/RevolutReader/pull/940 are fine too.",
      ].join("\n"),
    );
  });

  test("allows references to this repository's other issues and pull requests", () => {
    assertClean(
      [
        "Closes #67.",
        "Part of jakubbohm/RevolutReader#67.",
        "https://github.com/jakubbohm/RevolutReader/issues/67 and github.com/jakubbohm/RevolutReader/pull/93",
      ].join("\n"),
    );
  });

  test("compares the repository's owner and name without regard to case", () => {
    assertClean("JakubBohm/revolutreader#67 and https://github.com/JAKUBBOHM/RevolutReader/issues/67");
    assertFinds("Not Jakubbohm/Revolutreader#94 either.", ["#94"]);
  });

  test("finds several references in a text of several lines, in text order", () => {
    const text = [
      "## Review triage, round 2",
      "",
      "- Upstream: https://github.com/example-org/widget/issues/12",
      "- The same as (#94), fixed here.",
      "- Tracked in other.user/some-lib#7 and #67.",
    ].join("\r\n");

    assertFinds(text, ["github.com/example-org/widget/issues/12", "#94", "other.user/some-lib#7"]);
  });

  test("finds a reference inside Markdown code too, although GitHub links none there", () => {
    assertFinds("Run `example-org/widget#12` again.\n```\nSee #94\n```", ["example-org/widget#12", "#94"]);
  });

  test("finds nothing in a text without references", () => {
    assertClean("No references here.\nJust text, a path like docs/a.md and a heading anchor #top.");
    assertClean("");
  });

  test("finds the retired pull request named as GH- and its number, in either case", () => {
    assertFinds("See GH-94, and gh-94 too.", ["GH-94", "gh-94"]);
  });

  test("takes neither another number nor this repository's other issues named as GH-", () => {
    assertClean("GH-940 and GH-67 are fine.");
  });
});

describe("backlinkRefusal", () => {
  const ownRepo = "jakubbohm/RevolutReader";
  const linesOf = (message) => message.split(/\r?\n/);

  test("gives no refusal when every text is clean", () => {
    const texts = [
      { label: "finding 1 (docs/a.md)", text: "Closes #67." },
      { label: "finding 2 (src/b.mjs)", text: "Upstream: https://redirect.github.com/example-org/widget/issues/12" },
    ];

    assert.equal(backlinkRefusal(texts, ownRepo), null);
  });

  test("names each reference with the label of its text, and no clean text", () => {
    const texts = [
      { label: "finding 1 (docs/a.md)", text: "Clean, and part of #67." },
      { label: "finding 2 (src/b.mjs)", text: "Upstream example-org/widget#12, as in #94." },
      { label: "finding 3 (docs/c.md)", text: "See https://github.com/other.user/some-lib/pull/7." },
    ];

    const message = backlinkRefusal(texts, ownRepo);

    assert.equal(typeof message, "string");
    const named = (label, reference) => linesOf(message).some((l) => l.includes(label) && l.includes(reference));
    assert.ok(named("finding 2 (src/b.mjs)", "example-org/widget#12"), message);
    assert.ok(named("finding 2 (src/b.mjs)", "#94"), message);
    assert.ok(named("finding 3 (docs/c.md)", "github.com/other.user/some-lib/pull/7"), message);
    assert.ok(!message.includes("finding 1 (docs/a.md)"), message);
  });

  test("says how to rewrite a reference: through redirect.github.com", () => {
    const message = backlinkRefusal([{ label: "the reply", text: "Upstream example-org/widget#12." }], ownRepo);

    assert.ok(message.includes("redirect.github.com"), message);
  });
});

describe("ranges", () => {
  test("writes a run of consecutive numbers as one range", () => {
    assert.equal(ranges([1, 2, 3, 4, 5]), "1-5");
  });

  test("separates the runs and the single numbers with commas", () => {
    assert.equal(ranges([1, 2, 4, 7, 8, 9]), "1-2, 4, 7-9");
  });

  test("writes a single number on its own", () => {
    assert.equal(ranges([5]), "5");
  });

  test("writes nothing for no numbers", () => {
    assert.equal(ranges([]), "");
  });
});
