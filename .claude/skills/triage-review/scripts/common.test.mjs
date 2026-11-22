// Tests for common.mjs's pure functions: how review comments become numbered findings, and a text's first line.
// Nothing here calls gh or the network; the comments are small made-up objects shaped like the REST API's.
//
//   node --test ".claude/skills/triage-review/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findingsFrom, firstLine } from "./common.mjs";

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
