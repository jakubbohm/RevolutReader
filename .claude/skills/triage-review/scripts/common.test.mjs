// Tests for common.mjs's pure functions: how review comments become numbered findings, a text's first line, the lines
// of a diff a comment can attach to, and how a chat review's findings become review comments to post.
// Nothing here calls gh or the network; the comments and files are small made-up objects shaped like the REST API's.
//
//   node --test ".claude/skills/triage-review/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findingsFrom, firstLine, linesInDiff, planPosts, ranges } from "./common.mjs";

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

describe("findingsFrom", () => {
  test("numbers the top-level comments in posting order, resolved ones included", () => {
    const comments = [comment(103), comment(101), comment(102)];

    const { findings } = findingsFrom(comments, new Set([101, 102]));

    assert.deepEqual(
      findings.map((f) => [f.id, f.commentId]),
      [[3, 103]],
    );
  });

  test("leaves out the comments whose threads are resolved and counts them", () => {
    const comments = [comment(201), comment(202), comment(203)];

    const { findings, resolved } = findingsFrom(comments, new Set([201, 203]));

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

    const { findings, resolved, resolvedIds } = findingsFrom(comments, new Set([821, 822, 825]));

    assert.deepEqual(resolvedIds, [1, 2, 4]);
    assert.equal(resolved, 3);
    assert.deepEqual(
      findings.map((f) => f.id).sort((a, b) => a - b),
      [3, 5],
    );
  });

  test("names no resolved comments when no thread is resolved", () => {
    const comments = [comment(811), comment(812)];

    const { resolved, resolvedIds } = findingsFrom(comments, new Set());

    assert.deepEqual(resolvedIds, []);
    assert.equal(resolved, 0);
  });

  test("never makes a reply a finding, and a reply takes no number", () => {
    const comments = [comment(301), comment(302, { in_reply_to_id: 301 }), comment(303)];

    const { findings, resolved } = findingsFrom(comments, new Set());

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

    const { findings } = findingsFrom(comments, new Set());

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

    const { findings } = findingsFrom(comments, new Set());
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

    const { findings } = findingsFrom(comments, new Set());
    const titleOf = (commentId) => findings.find((f) => f.commentId === commentId).title;

    assert.equal(titleOf(601), "Short title");
    assert.equal(titleOf(602), "x".repeat(120));
  });

  test("titles a finding whose body has Windows line endings without the carriage return", () => {
    const comments = [comment(701, { body: "Important: one\r\nmore" })];

    const { findings } = findingsFrom(comments, new Set());

    assert.equal(findings[0].title, "Important: one");
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

    const { errors, posts } = planPosts(findings, prFiles, [], headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, [], headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, [], headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, [], headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, [], headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha);

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

    const { errors, posts } = planPosts(findings, prFiles, existing, headSha);

    assert.deepEqual(errors, []);
    assert.deepEqual(
      posts.map((p) => [p.action, p.existingId]),
      [
        ["skip", 931],
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

    const { errors } = planPosts(findings, prFiles, [], headSha);

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

    const { errors } = planPosts(findings, prFiles, [], headSha);

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

    const { errors } = planPosts(findings, prFiles, [], headSha);

    assert.equal(errors.length, 3);
    assert.ok(namesFinding(errors, 2, "src/b.mjs"), `no error names finding 2 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 3, "docs/logo.png"), `no error names finding 3 and its path: ${errors}`);
    assert.ok(namesFinding(errors, 4, "docs/a.md"), `no error names finding 4 and its path: ${errors}`);
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
