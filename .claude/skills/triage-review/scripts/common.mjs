// Shared by the triage-review scripts (post-findings.mjs, gather-findings.mjs, reply-finding.mjs, post-summary.mjs):
// the gh calls, the PR's review threads, how review comments become numbered findings, how a review's findings from
// the conversation become review comments to post, what a triage summary is and whether a round's is posted, and the
// check that keeps every text the scripts post from making GitHub post a backlink outside this repository.
import { spawnSync } from "node:child_process";

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// Runs gh and returns spawnSync's result, for a caller that handles a failure itself. `input`, when given, is
// written to gh's standard input (e.g. a request body for `--input -`).
export function run(args, input) {
  return spawnSync("gh", args, { encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024, windowsHide: true });
}

// Runs gh and returns its trimmed output; a failure ends the script with ERROR.
export function gh(args) {
  const r = run(args);
  if (r.status !== 0) fail(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
}

// The repository the scripts run in, as `owner/name`: the one gh's `{owner}/{repo}` placeholders stand for.
export function ownRepo() {
  return gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
}

// Every review thread of the PR, paged: its node id, whether it is resolved, and its first comment's database id.
export function reviewThreads(pr) {
  const [owner, repo] = ownRepo().split("/");
  const query = `query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }`;
  const all = [];
  let after = null;
  do {
    const page = ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `pr=${pr}`];
    page.push("-f", `query=${query}`);
    if (after) page.push("-f", `after=${after}`);
    const threads = JSON.parse(gh(page)).data?.repository?.pullRequest?.reviewThreads;
    if (!threads) fail(`PR ${pr} not found`);
    for (const t of threads.nodes) {
      all.push({ id: t.id, isResolved: t.isResolved, firstCommentId: t.comments.nodes[0]?.databaseId });
    }
    after = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
  } while (after);
  return all;
}

// The open findings among a PR's review comments (the REST API's comment objects, any order).
// - `submittedAt` maps each top-level comment's id to when its review was submitted (an ISO 8601 time), or to null
//   while that review is pending; replies need no entry.
// - A finding is a top-level comment (not a reply) of a submitted review whose thread is not resolved.
// - Its id numbers the PR's top-level comments in the order they were posted: by when their reviews were submitted,
//   then by comment id, resolved ones included. Not by id alone: a comment gets its id when its review's draft is
//   written, so a review drafted early and submitted late would slot in below numbers an earlier round used. So a
//   later round's new findings continue after the earlier rounds' and a thread left open keeps its number. A
//   comment of a pending review takes no number, resolved or not. A deleted top-level comment shifts the numbers of
//   those posted after it.
// - A top-level comment whose submission time is unknown (no entry, or not a time) throws rather than take a guessed
//   number, which could name another finding than an earlier round's commits do.
// - The findings are returned ordered by file and line.
// - `resolved` counts the comments left out because their threads are resolved, and `resolvedIds` lists their
//   numbers in ascending order, so a rerun can see the threads an interrupted round already closed.
export function findingsFrom(comments, resolvedCommentIds, submittedAt) {
  const unknown = [];
  const posted = [];
  for (const c of comments.filter((c) => c.in_reply_to_id == null)) {
    const time = submittedAt.get(c.id);
    if (time === null) continue; // its review is pending
    const ms = typeof time === "string" ? Date.parse(time) : NaN;
    if (Number.isNaN(ms)) unknown.push(c.id);
    else posted.push({ c, ms });
  }
  if (unknown.length > 0) {
    throw new Error(
      `cannot number the top-level review comment${unknown.length > 1 ? "s" : ""} ${unknown.join(", ")}: ` +
        "the time its review was submitted is unknown, and a guessed number could clash with one an earlier round " +
        "used. Its review is not among the PR's reviews, e.g. it was submitted, discarded or deleted while the " +
        "gather ran, or is still pending: submit or discard any pending review on the PR, then run the gather again.",
    );
  }
  const topLevel = posted.sort((a, b) => a.ms - b.ms || a.c.id - b.c.id).map(({ c }) => c);
  const numbered = topLevel.map((c, i) => ({ number: i + 1, c }));
  const resolvedIds = numbered.filter(({ c }) => resolvedCommentIds.has(c.id)).map(({ number }) => number);
  const lineOf = (c) => c.line ?? c.original_line ?? 0;
  const findings = numbered
    .filter(({ c }) => !resolvedCommentIds.has(c.id))
    .sort((a, b) => (a.c.path ?? "").localeCompare(b.c.path ?? "") || lineOf(a.c) - lineOf(b.c) || a.c.id - b.c.id)
    .map(({ number, c }) => ({
      id: number,
      commentId: c.id,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
      title: firstLine(c.body).slice(0, 120),
      body: c.body,
      author: c.user?.login,
      url: c.html_url,
    }));
  return { findings, resolved: resolvedIds.length, resolvedIds };
}

// findingsFrom's `submittedAt` Map, from a PR's review comments and its reviews (the REST API's objects, joined on
// each comment's `pull_request_review_id`): each top-level comment's id maps to when its review was submitted
// (`submitted_at`), or to null while that review is pending. A comment whose review is not listed, or neither
// pending nor submitted (no `submitted_at`), gets no entry, so findingsFrom refuses to number it; replies get none.
export function submissionTimes(comments, reviews) {
  const reviewsById = new Map(reviews.map((r) => [r.id, r]));
  const submittedAt = new Map();
  for (const c of comments.filter((c) => c.in_reply_to_id == null)) {
    const review = reviewsById.get(c.pull_request_review_id);
    if (review?.state === "PENDING") submittedAt.set(c.id, null);
    else if (review?.submitted_at) submittedAt.set(c.id, review.submitted_at);
  }
  return submittedAt;
}

// The first line of the trimmed text, without the "\r" of Windows line endings.
export function firstLine(text) {
  return text.trim().split(/\r?\n/)[0];
}

// The line numbers a review comment can attach to on the RIGHT side (the PR's new version), from one PR file's
// unified-diff patch as the REST API's "list PR files" returns it: every hunk's context and added lines. Deleted
// lines and the "\ No newline at end of file" marker take no number. A file without a patch (a binary or very large
// file) gives an empty Set.
export function linesInDiff(patch) {
  const lines = new Set();
  let next = 0; // the new version's number of the hunk's next context or added line
  let left = 0; // how many of the hunk's new-version lines are still to come
  for (const text of (patch ?? "").split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(text);
    if (hunk) {
      next = Number(hunk[1]);
      left = hunk[2] === undefined ? 1 : Number(hunk[2]);
    } else if (left > 0 && (text.startsWith(" ") || text.startsWith("+"))) {
      lines.add(next++);
      left--;
    }
  }
  return lines;
}

// Plans posting a review's findings from the conversation (`{ path, line, body }`, in the review's order) as review
// comments on the PR, given the PR's files and review comments (the REST API's objects), its head commit, and when
// its last triage summary was posted (lastSummaryTime; null before the first summary).
// - Returns { errors, posts }: one error per finding that cannot be posted, naming its position in the review
//   (1-based) and its path; with any error, nothing may be posted. A finding's path must be a file the PR changes,
//   its body must have text, and its line must be null or a positive whole number.
// - One post per valid finding, in the review's order: `{ action: "post", request }`, where the request goes on the
//   finding's line (RIGHT side) when the line is in the PR's diff, else on its file (`subject_type: "file"`).
// - A finding whose body is already a top-level review comment's (line endings and outer spaces aside), posted after
//   the last triage summary (before the first summary: any), is `{ action: "skip", existingId, request }`: so a run
//   that failed part-way can run again. Each comment accounts for one finding only. A comment from before the last
//   summary does not count: an earlier round closed it, and a new report of the same text is a finding of its own,
//   which the gather would otherwise leave out with that closed thread.
export function planPosts(findings, prFiles, existingComments, headSha, lastSummaryAt) {
  const filesByName = new Map(prFiles.map((f) => [f.filename, f]));
  const normalized = (text) => text.replace(/\r\n/g, "\n").trim();
  const sinceSummary = (c) => lastSummaryAt == null || Date.parse(c.created_at) > Date.parse(lastSummaryAt);
  const unclaimed = existingComments
    .filter((c) => c.in_reply_to_id == null && typeof c.body === "string" && sinceSummary(c))
    .sort((a, b) => a.id - b.id);
  const errors = [];
  const posts = [];
  findings.forEach((finding, i) => {
    const { path, line, body } = finding ?? {};
    const file = filesByName.get(path);
    const problems = [];
    if (!file) problems.push(path ? "the PR does not change this file" : "no path");
    if (typeof body !== "string" || !body.trim()) problems.push("no body");
    if (line != null && !(Number.isInteger(line) && line > 0)) {
      problems.push(`line ${JSON.stringify(line)} is neither null nor a line number`);
    }
    if (problems.length > 0) {
      errors.push(`finding ${i + 1} (${path || "no path"}): ${problems.join("; ")}`);
      return;
    }

    const request =
      line != null && linesInDiff(file.patch).has(line)
        ? { body, commit_id: headSha, path, line, side: "RIGHT" }
        : { body, commit_id: headSha, path, subject_type: "file" };
    const posted = unclaimed.findIndex((c) => normalized(c.body) === normalized(body));
    if (posted === -1) {
      posts.push({ action: "post", request });
    } else {
      posts.push({ action: "skip", existingId: unclaimed[posted].id, request });
      unclaimed.splice(posted, 1);
    }
  });
  return { errors, posts };
}

// Whether a PR comment's body is a triage summary: it starts with the heading "## Review triage" (any round's), which
// the skill counts the rounds by. A comment that only mentions the heading further down is none.
export function isTriageSummary(body) {
  return typeof body === "string" && body.startsWith("## Review triage");
}

// When the PR's last triage summary was posted: the `created_at` of the latest of its issue comments (the REST API's
// objects, any order) that is a triage summary (isTriageSummary), else null.
export function lastSummaryTime(issueComments) {
  let latest = null;
  for (const c of issueComments) {
    if (!isTriageSummary(c.body)) continue;
    if (latest === null || Date.parse(c.created_at) > Date.parse(latest)) latest = c.created_at;
  }
  return latest;
}

// The PR's issue comment (the REST API's objects) that already is the summary `body` would post: the first whose first
// line equals the body's first line, which is the round's heading, so the first round's "## Review triage" and a later
// round's "## Review triage, round <n>" never match each other. Line endings and trailing spaces aside; null when
// there is none.
export function summaryPosted(issueComments, body) {
  const heading = (text) => text.split("\n")[0].trimEnd();
  const wanted = heading(body);
  return issueComments.find((c) => typeof c.body === "string" && heading(c.body) === wanted) ?? null;
}

// This repository's pull requests retired because their text made GitHub post backlinks on other repositories'
// issues. A mention of one, in any form GitHub links, puts a link to the mentioning text on its page, which stays even
// after that text is deleted, so they are named in words only (docs/software-factory/lessons.md R-102).
const RETIRED_PULL_REQUESTS = [94];

// The references GitHub links in published text, in one pattern so that each is matched once, from left to right:
// a github.com link to an issue or pull request (with or without the scheme and www; redirect.github.com and any other
// host ending in github.com do not match), a repository's `owner/name#n`, or a bare `#n` or `GH-n` (either case),
// which GitHub reads as this repository's. Markdown code is not skipped: GitHub links nothing there, but rewriting a
// reference costs nothing.
const REFERENCE = new RegExp(
  [
    String.raw`(?<![\w.-])(?:https?:\/\/)?(?:www\.)?github\.com\/` +
      String.raw`(?<linkRepo>[\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(?<linkNumber>\d+)`,
    String.raw`(?<nameRepo>[\w.-]+\/[\w.-]+)#(?<nameNumber>\d+)`,
    String.raw`(?<!\w)#(?<bareNumber>\d+)`,
    String.raw`(?<!\w)GH-(?<ghNumber>\d+)`,
  ].join("|"),
  "gi",
);

// The references in a text GitHub publishes that would make it post a backlink outside `ownRepo` (`owner/name`), in
// text order, each as the text it matched: another repository's issue or pull request named as `owner/name#n` or by a
// github.com link (a redirect.github.com link posts none), and this repository's retired pull requests in any form
// GitHub links. This repository's other references are fine. Owner and name are compared without regard to case.
export function backlinkRisks(text, ownRepo) {
  const own = ownRepo.toLowerCase();
  const risks = [];
  for (const m of text.matchAll(REFERENCE)) {
    const { linkRepo, linkNumber, nameRepo, nameNumber, bareNumber, ghNumber } = m.groups;
    const repo = (linkRepo ?? nameRepo)?.toLowerCase() ?? own;
    const number = Number(linkNumber ?? nameNumber ?? bareNumber ?? ghNumber);
    if (repo !== own || RETIRED_PULL_REQUESTS.includes(number)) risks.push(m[0]);
  }
  return risks;
}

// The refusal for texts a script would post (`{ label, text }`, the label naming the text in the message): one line
// per reference backlinkRisks finds, then how to rewrite them; null when none would post a backlink outside `ownRepo`.
export function backlinkRefusal(texts, ownRepo) {
  const lines = texts.flatMap(({ label, text }) => backlinkRisks(text, ownRepo).map((r) => `  ${label}: ${r}`));
  if (lines.length === 0) return null;
  return (
    "Each of these would make GitHub post a backlink on another repository's issue or pull request, or on this " +
    "repository's retired pull request, and neither an edit nor a delete takes one back " +
    `(docs/software-factory/lessons.md R-102):\n${lines.join("\n")}\n` +
    "Rewrite each: another repository's issue or pull request as a https://redirect.github.com/<owner>/<name>/" +
    "issues/<n> (or /pull/<n>) link, or in words; this repository's retired pull request in words, its number " +
    "without # and never as a link."
  );
}

// A sorted list of whole numbers as compact text, each run of consecutive numbers as a range: [1, 2, 4, 7, 8, 9]
// gives "1-2, 4, 7-9", and no numbers give "".
export function ranges(numbers) {
  const runs = [];
  for (const n of numbers) {
    const last = runs.at(-1);
    if (last && n === last.to + 1) last.to = n;
    else runs.push({ from: n, to: n });
  }
  return runs.map(({ from, to }) => (from === to ? `${from}` : `${from}-${to}`)).join(", ");
}
