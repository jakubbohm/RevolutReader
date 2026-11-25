// Shared by the triage-review scripts (post-findings.mjs, gather-findings.mjs, reply-finding.mjs, post-summary.mjs):
// the gh and git calls, the PR's review threads, how review comments become numbered findings, how a review's
// findings from the conversation become review comments to post, what a triage summary is, whether a round's is
// posted and whether it lists its findings' numbers (summaryRefusal), the check that keeps every text the scripts
// post from making GitHub post a backlink outside this repository, and, for the gather, the round and its restart:
// which round this is and which numbers the earlier rounds used (roundOf), which commits after the PR's head are this
// round's own (ownCommits), and what every finding of the round is owed after a round that stopped part-way
// (classifyRound; the rules are in the comment above it).
import { spawnSync } from "node:child_process";

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// Runs git in the folder the script runs in and returns spawnSync's result, for a caller that handles a failure
// itself.
export function git(args) {
  return spawnSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
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
// - `all` is every numbered comment, resolved or not, in the order of the numbers: a finding's fields, then
//   `resolved` (whether its thread is) and `replies`, the thread's replies in the order they were posted, each
//   `{ body, createdAt, author }`. It is what classifyRound sorts a round's findings from.
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
  const finding = ({ number, c }) => ({
    id: number,
    commentId: c.id,
    path: c.path,
    line: c.line ?? c.original_line ?? null,
    title: firstLine(c.body).slice(0, 120),
    body: c.body,
    author: c.user?.login,
    url: c.html_url,
  });
  const findings = numbered
    .filter(({ c }) => !resolvedCommentIds.has(c.id))
    .sort((a, b) => (a.c.path ?? "").localeCompare(b.c.path ?? "") || lineOf(a.c) - lineOf(b.c) || a.c.id - b.c.id)
    .map(finding);

  // Every reply names its thread's first comment (`in_reply_to_id`), whichever comment of the thread it answers.
  const postedAt = (c) => Date.parse(c.created_at) || 0;
  const replies = comments.filter((c) => c.in_reply_to_id != null);
  const repliesTo = new Map();
  for (const r of replies.sort((a, b) => postedAt(a) - postedAt(b) || a.id - b.id)) {
    const reply = { body: r.body ?? "", createdAt: r.created_at ?? null, author: r.user?.login };
    repliesTo.set(r.in_reply_to_id, [...(repliesTo.get(r.in_reply_to_id) ?? []), reply]);
  }
  const all = numbered.map((n) => ({
    ...finding(n),
    resolved: resolvedCommentIds.has(n.c.id),
    replies: repliesTo.get(n.c.id) ?? [],
  }));
  return { findings, resolved: resolvedIds.length, resolvedIds, all };
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

// ---------------------------------------------------------------------------------------------------------------------
// The round and its restart.
//
// A triage round ends with its summary comment on the PR. A round that stopped before its summary is run again, and
// the gather then says where every finding of the round stands from what outlives a session: the PR's review threads
// (open or resolved, and the replies in them), the numbers the earlier rounds' summaries list, and the commits after
// the PR's head commit (`<PR head>..HEAD`). The replies are posted by the main session after the fix round, so a
// finding's commits can be complete while its reply is still owed: its outcome is then read from its commits alone.
// What leaves neither a reply nor a commit (a routing, the owner's answer to a question, a fix the implementer
// disputes) is in the triage's state file only, which the gather does not read.
// ---------------------------------------------------------------------------------------------------------------------

// The numbers a triage summary lists: the first column of its findings table, the table whose heading row starts with
// `#` (`| # | Finding | Outcome | Evidence or commit |`). A cell holds one number, several separated by commas, or a
// range (`3`, `3, 7`, `3-5`), with or without Markdown emphasis; a row whose first cell is anything else lists none.
// Rows of another table and numbers in the text around the tables are not read. Ascending, each number once.
export function summaryNumbers(body) {
  const numbers = new Set();
  let inFindingsTable = false;
  for (const line of body.split(/\r?\n/)) {
    const cell = /^\s*\|([^|]*)\|/.exec(line)?.[1].replace(/[*_`]/g, "").trim();
    if (cell === undefined) inFindingsTable = false;
    else if (cell === "#") inFindingsTable = true;
    else if (inFindingsTable) for (const n of numbersInCell(cell)) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

function numbersInCell(cell) {
  const numbers = [];
  for (const part of cell.split(",")) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part.trim());
    const from = Number(m?.[1]);
    const to = Number(m?.[2] ?? m?.[1]);
    if (!m || from < 1 || to < from || to - from > 999) return [];
    for (let n = from; n <= to; n++) numbers.push(n);
  }
  return numbers;
}

// Why a triage summary must not be posted as it is, as the rest of a sentence about it, or null when it may: its
// findings table lists no finding number (summaryNumbers). The next round reads the numbers this round used from the
// summary (roundOf), and its gather fails on a summary that lists none, so post-summary.mjs refuses such a body
// before it is on the PR.
export function summaryRefusal(body) {
  if (summaryNumbers(body).length > 0) return null;
  return (
    "lists no finding number: its findings table needs a heading row that starts with `| # |` and, below it, one " +
    "row per finding that starts with the finding's number (`| 3 | … |`), which the next round reads this round's " +
    "numbers from"
  );
}

// Which round this is, from the PR's issue comments (the REST API's objects, any order), where each triage leaves
// one summary (isTriageSummary): `round` is the number of summaries plus one, so a rerun of a round that stopped
// before its summary has that round's number again; `summaries` is that number of summaries; `earlierNumbers` are the
// finding numbers the summaries list (summaryNumbers), ascending, and `highestNumber` the highest of them (0 in
// round 1); `lastSummaryAt` is when the last one was posted, or null. A summary that lists no number throws: the
// numbers the earlier rounds used would be unknown, and with them which resolved threads and which commits are this
// round's.
export function roundOf(issueComments) {
  const summaries = issueComments.filter((c) => isTriageSummary(c.body));
  const numbers = new Set();
  const silent = [];
  for (const s of summaries) {
    const listed = summaryNumbers(s.body);
    if (listed.length === 0) silent.push(s.html_url ?? `comment ${s.id}`);
    for (const n of listed) numbers.add(n);
  }
  if (silent.length > 0) {
    throw new Error(
      `cannot tell which finding numbers the earlier rounds used: the triage summary ${silent.join(", ")} lists none ` +
        "in a table whose heading row starts with `| # |` and whose rows start with the findings' numbers. Without " +
        "them a rerun cannot tell this round's resolved threads and commits from an earlier round's. Edit the " +
        "summary so that its findings table has that form (the owner's go: it is a published comment), then run " +
        "the gather again.",
    );
  }
  const earlierNumbers = [...numbers].sort((a, b) => a - b);
  return {
    round: summaries.length + 1,
    summaries: summaries.length,
    earlierNumbers,
    highestNumber: highestOf(earlierNumbers),
    lastSummaryAt: lastSummaryTime(issueComments),
  };
}

// The outcome a reply in a finding's thread gives, by how it starts (the skill's reply texts): "Fixed in" is `fixed`,
// "Declined by the owner" is `declined by the owner`, "Declined" is `declined`, "Deferred" is `deferred`. Any other
// reply (a question, an undecided ask's note, "Fixed as the owner decided") gives none: null.
const REPLY_OUTCOMES = [
  ["Fixed in", "fixed"],
  ["Declined by the owner", "declined by the owner"],
  ["Declined", "declined"],
  ["Deferred", "deferred"],
];
export function replyOutcome(body) {
  const text = (body ?? "").trim();
  for (const [start, outcome] of REPLY_OUTCOMES) {
    if (text.startsWith(start) && !/\w/.test(text.charAt(start.length))) return outcome;
  }
  return null;
}

// One of a round's own commits, from its subject: `<type>(<scope>): [review] <id>: <summary>` or
// `<type>(<scope>): [plan] <id>: <summary>`, the id being the finding's number, or several numbers separated by
// commas, with or without spaces (`[review] 3, 7: …`), when findings with one cause are fixed together: `ids` lists
// them, each once, and the commit counts for each of those findings. Any other subject gives null: an id that is not
// a number or a list of numbers (`E12`, `3 and 7`, `3-7`), git's own `Revert "…"` of such a commit, and a round's
// `[review] triage summary`. `kind` is what the commit is in the fix of its finding:
//   plan                      docs(<scope>): [plan] <id>: …                 the spec or design edit of a "fix now"
//   red                       test(<scope>): [review] <id>: …, red          the guard test, failing
//   guard passes              test(<scope>): [review] <id>: guard, passes   the guard test passes at once
//   guard removed, declined   test(<scope>): [review] <id>: guard removed, declined
//   guard removed, deferred   test(<scope>): [review] <id>: guard removed, deferred
//   test fix                  test(<scope>): [review] <id>: …               any other test commit: a test-quality fix
//   fix                       fix(<scope>): [review] <id>: …                the implementer's fix
//   heads-up                  docs(<scope>): [review] <id>: heads-up for <step>
//   docs fix                  docs(<scope>): [review] <id>: …               any other docs commit: a docs fix
//   cleanup                   refactor(<scope>): [review] <id>: …           a cleanup fix
//   repair                    <type>(<scope>): [review] <id>: close check <name> repaired, of any type
//                             the repair of a close check that a commit of the finding broke: one the runner made at
//                             once (a format, lint or type-check failure; refactor, or test in test code), or one the
//                             owner ordered after a failed check (fix when it changes what production code does). It
//                             comes after the finding's own commits, whatever they said, and its type is not read:
//                             the summary alone makes it a repair
//   unknown                   any other type, e.g. feat(<scope>): [review] <id>: … or test(<scope>): [plan] <id>: …
// The texts after the number are exact: `guard, passes`, `guard removed, declined`, `guard removed, deferred`, a
// summary that ends with `, red`, one that starts with `heads-up for `, and `close check <name> repaired`.
const FINDING_NUMBERS = String.raw`\d+(?:\s*,\s*\d+)*`;
const ROUND_COMMIT = new RegExp(String.raw`^([a-z]+)\(([^()\s]+)\): \[(review|plan)\] (${FINDING_NUMBERS}): (\S.*)$`);
// A subject that names findings as a round's commit does, wherever in it and whatever its type: so that git's own
// revert of a round's commit still belongs to those findings' stories, as a commit of an unknown kind.
const NAMES_FINDINGS = new RegExp(String.raw`\[(?:review|plan)\] (${FINDING_NUMBERS}):`);
const numbersOf = (list) => [...new Set(list.split(",").map((n) => Number(n.trim())))];

export function roundCommit(subject) {
  const m = ROUND_COMMIT.exec((subject ?? "").trim());
  if (!m) return null;
  const [, type, scope, tag, ids, summary] = m;
  return { type, scope, tag, ids: numbersOf(ids), summary, kind: commitKind(type, tag, summary) };
}

// The guard tests a red commit's body names, one per line `Guard test: <name>`, the name being the test's full name
// as the test runner prints it (the fix round's runner adds the line): each once, in the body's order; none when
// the body has no such line. The names say exactly which tests may fail while the fix is not there yet.
export function guardTests(body) {
  const names = (body ?? "").split(/\r?\n/).map((line) => /^Guard test:\s*(\S.*)$/.exec(line.trim())?.[1]);
  return [...new Set(names.filter(Boolean))];
}

// The summary of a close check's repair commit: the check's name between the fixed words.
const REPAIR = /^close check \S.* repaired$/;

function commitKind(type, tag, summary) {
  if (tag === "plan") return type === "docs" ? "plan" : "unknown";
  if (REPAIR.test(summary)) return "repair";
  if (type === "fix") return "fix";
  if (type === "refactor") return "cleanup";
  if (type === "docs") return summary.startsWith("heads-up for ") ? "heads-up" : "docs fix";
  if (type !== "test") return "unknown";
  if (summary === "guard, passes") return "guard passes";
  if (summary === "guard removed, declined" || summary === "guard removed, deferred") return summary;
  return summary.endsWith(", red") ? "red" : "test fix";
}

// The highest number the earlier rounds' summaries list; 0 in round 1.
const highestOf = (earlierNumbers) => earlierNumbers.reduce((max, n) => Math.max(max, n), 0);

const shortSha = (sha) => String(sha).slice(0, 7);

// Whether the commits after the PR's head commit (`<PR head>..HEAD`, each `{ sha, subject }`) are all this round's
// own (the skill's rule for the tree a round may start or restart on): a round's own commit is a `[review] <id>:` or
// `[plan] <id>:` commit (roundCommit) every number of which is this round's: above the highest number the earlier
// rounds' summaries list (`earlierNumbers`; in round 1 any number), or one of `carried`, the earlier rounds' numbers
// carried into this round (classifyRound's `carried`, where the rule is). Returns `{ count, allOwn, notOwn }`,
// `notOwn` listing every other commit as `{ sha, subject, why }`: a commit of another kind (an earlier round's
// `[review] triage summary`, a merge, git's own revert, any other work), or one that names an earlier round's
// finding that is not carried into this round (an earlier round's commit that was never pushed). Any of them means
// the review saw other code than the working tree holds. No commits at all are all own: the tree is the PR's head.
export function ownCommits(commits, earlierNumbers, carried = []) {
  const highest = highestOf(earlierNumbers);
  const notOwn = [];
  for (const { sha, subject } of commits) {
    const own = roundCommit(subject);
    const earlier = own?.ids.filter((id) => id <= highest && !carried.includes(id)) ?? [];
    if (!own) notOwn.push({ sha, subject, why: "no `[review] <id>:` or `[plan] <id>:` commit" });
    else if (earlier.length > 0) {
      const several = earlier.length > 1;
      const [which, is] = several ? [`findings ${earlier.join(", ")}`, "are"] : [`finding ${earlier[0]}`, "is"];
      const why =
        `${which} ${is} not above ${highest}, the highest number an earlier round's summary lists, and ${is} not ` +
        "carried into this round";
      notOwn.push({ sha, subject, why });
    }
  }
  return { count: commits.length, allOwn: notOwn.length === 0, notOwn };
}

// What a finding's commits say, read oldest first (each with roundCommit's `kind`). Only the orders the fix round can
// produce are read; any other order, and a commit of an unknown kind, is `broken` and never guessed at. The states,
// and the commit kinds each one takes:
//   start              plan → planned · red → red · guard passes → refuted · heads-up → heads-up ·
//                      a test, docs or cleanup fix → fixed
//   planned            plan → planned · red → red · guard passes → refuted ·
//                      a test, docs or cleanup fix → fixed
//   red                red → red (a corrected guard test) · plan → red (a spec edit after a disputed test) ·
//                      fix → fixed · guard passes → refuted (the corrected test passes at once) ·
//                      guard removed, declined → removed, declined · guard removed, deferred → removed, deferred
//   fixed              red → red again (a fix in several test-first steps) ·
//                      a test, docs or cleanup fix → fixed (a further commit of the same fix)
//   red again          red → red again · plan → red again · fix → fixed
//   removed, deferred  heads-up → heads-up
//   refuted, removed, declined and heads-up take no further commit.
// So a fix never comes without a red commit before it, a guard is never removed that no red commit added, no
// outcome is read while a guard test may still fail, a finding once declined or deferred is not fixed after all
// without the owner being asked, and neither is one partly fixed then declined or deferred.
// A `repair` commit is no step of the fix: the round's close checks found a failure that a commit of the finding
// caused, and the repair put it right. The runner makes one at once for a format, lint or type-check failure in a
// file that a commit of the finding touched last; the owner orders one for any other failure, a failed test among
// them, and that one may be a `fix` commit. It is read past in every state and whatever its type, so it changes
// neither the finding's outcome nor where its fix resumes, whether the finding was fixed, refuted (its guard test's
// file may be the one repaired), left with its guard test removed, or left at a red commit. Repairs alone are no
// story: a finding that nothing but repair commits name is `broken`.
// Where the commits stop decides: `planned`, and `red` or `red again` when the last commit is a plan, resume at the
// test-writer (`next`); `red` and `red again` otherwise resume at the implementer; every other state is an `outcome`
// (OUTCOME_OF_STATE). `mayFail` are the `red` commits no later fix, `guard, passes` or `guard removed` commit
// settles, each `{ sha, subject, files, tests }`: the tests they added may fail, `tests` naming them when the
// commit's body does (guardTests), `files` being the files the commit changed. `removal` is the `guard removed`
// commit, whose body is the reply in full (`replyText`).
const PLAIN_FIXES = new Set(["test fix", "docs fix", "cleanup"]);
const SETTLES_A_RED = new Set(["fix", "guard passes", "guard removed, declined", "guard removed, deferred"]);
const NEXT_STATE = {
  start: { plan: "planned", red: "red", "guard passes": "refuted", plain: "fixed", "heads-up": "heads-up" },
  planned: { plan: "planned", red: "red", "guard passes": "refuted", plain: "fixed" },
  red: {
    plan: "red",
    red: "red",
    fix: "fixed",
    "guard passes": "refuted",
    "guard removed, declined": "removed, declined",
    "guard removed, deferred": "removed, deferred",
  },
  fixed: { red: "red again", plain: "fixed" },
  "red again": { plan: "red again", red: "red again", fix: "fixed" },
  "removed, deferred": { "heads-up": "heads-up" },
};
const OUTCOME_OF_STATE = {
  fixed: "fixed",
  refuted: "declined",
  "removed, declined": "declined",
  "removed, deferred": "deferred",
  "heads-up": "deferred as a heads-up",
};

function commitStory(commits) {
  const kinds = commits.map((c) => c.kind);
  const settled = (i) => kinds.slice(i + 1).some((kind) => SETTLES_A_RED.has(kind));
  const mayFail = commits
    .filter((c, i) => c.kind === "red" && !settled(i))
    .map(({ sha, subject, files, body }) => ({ sha, subject, files: files ?? [], tests: guardTests(body) }));
  const broken = (says) => ({ broken: true, says, mayFail });

  const unknown = commits.find((c) => c.kind === "unknown");
  if (unknown) {
    return broken(`${shortSha(unknown.sha)} names it but is none of the round's commit shapes: ${unknown.subject}`);
  }
  // The steps of the fix: every commit but a close check's repair, which is read past.
  const steps = commits.filter((c) => c.kind !== "repair");
  if (steps.length === 0) {
    return broken(`only close-check repairs name it, and a repair fixes no finding: ${kinds.join(" → ")}`);
  }
  let state = "start";
  for (const { kind } of steps) {
    state = NEXT_STATE[state]?.[PLAIN_FIXES.has(kind) ? "plain" : kind];
    if (!state) return broken(`its commits are in an order the fix round does not produce: ${kinds.join(" → ")}`);
  }

  const last = steps.at(-1);
  const stop = `${shortSha(last.sha)} ${last.subject}`;
  if (last.kind === "plan") {
    return { next: "test-writer", says: `its commits stop at the plan commit ${stop}`, mayFail };
  }
  if (last.kind === "red") {
    return { next: "implementer", says: `its commits stop at the red commit ${stop}`, mayFail };
  }
  const removal = commits.findLast((c) => c.kind.startsWith("guard removed")) ?? null;
  return {
    outcome: OUTCOME_OF_STATE[state],
    says: `its commits say ${OUTCOME_OF_STATE[state]} (${kinds.join(" → ")})`,
    mayFail,
    removal,
    replyText: (removal?.body ?? "").trim() || null,
    headsUpMayBeMissing: state === "removed, deferred",
  };
}

const OUTCOME_FAMILY = {
  fixed: "fixed",
  declined: "declined",
  "declined by the owner": "declined",
  deferred: "deferred",
  "deferred as a heads-up": "deferred",
};

const OWED = {
  verify: "verification",
  handled: "nothing",
  "resolved-by-hand": "the owner's answer: triage it (the owner unresolves its thread first) or leave it",
  "resume-test-writer": "the guard test from the test-writer, then the fix and the reply",
  "resume-implementer": "the fix from the implementer, then the reply",
  "reply-owed": "the reply in its thread, which resolves it",
  unclear: "the owner's decision",
};

// Sorts every finding of a round into one class, from data alone:
// - `findings`: findingsFrom's `all`, every numbered top-level review comment with `resolved` and `replies`;
// - `earlierNumbers`: the numbers the earlier rounds' summaries list (roundOf); none in round 1;
// - `commits`: the commits `<PR head>..HEAD`, oldest first, each `{ sha, subject, body, files }` (commitsFromGitLog);
// - `lastSummaryAt`: when the last summary was posted (roundOf), or null.
// Returns `{ findings, earlier, carried }`: one record per finding of the round, by number; the numbers of the
// earlier rounds' findings that are left as they are; and the numbers of those carried into this round.
//
// The round's findings are:
// - every finding numbered above the highest number the earlier rounds' summaries list (in round 1: every finding),
//   open or resolved: a resolved one was closed by this round before it stopped, or by hand;
// - of the findings numbered at or below it, those CARRIED INTO THIS ROUND: a finding whose thread is open, and one
//   whose thread is resolved with an outcome reply posted after the last summary (this round closed it). The reason:
//   an earlier round's undecided ask keeps its low number and its open thread, and a later round may fix, decline or
//   defer it; so may it a closed finding that the owner brings back by unresolving its thread. A carried finding is
//   sorted like any other finding of the round, and its `[review] <id>:` and `[plan] <id>:` commits are this round's
//   own (ownCommits takes `carried`).
// A low number whose thread is resolved without such a newer reply stays an earlier round's: it is left as it is,
// and commits that name it are not this round's own.
//
// A finding's commits are those whose subject names its number, alone or among several (roundCommit; oldest first),
// and what they say is commitStory's reading above. Its reply is the last reply in its thread that gives an outcome
// (replyOutcome); for a finding numbered at or below the earlier rounds' highest, only a reply posted after the last
// summary counts, an older one being an earlier round's word (both times must be known for it to count).
//
// The classes (`class`), and what each is owed (`owed`):
//   verify              open, and no commit names it: it goes to verification (also when a reply already gives an
//                       outcome: the owner unresolved it to bring it back).
//   handled             resolved, with a reply that gives the outcome, and either no commit or commits that say the
//                       same: taken back into the round's record with `outcome`, its reply (`reply`) and its commits;
//                       neither triaged nor answered again.
//   resolved-by-hand    resolved, no reply that gives an outcome, no commit: the owner is asked whether to triage it.
//   resume-test-writer  open, no outcome reply, and its commits stop at a plan commit: the owner chose "fix now", and
//                       the fix resumes at the guard test. `mayFail` lists the `red` commits of a guard test that is
//                       already there (a plan commit after a red one).
//   resume-implementer  open, no outcome reply, and its commits stop at a `red` commit: the fix resumes at the
//                       implementer, or waits for the owner when the state file says the implementer disputes the
//                       test. `mayFail` lists its `red` commits (`{ sha, subject, files, tests }`): the tests they
//                       added are the only ones that may fail at the baseline, named in `tests` when the commit's
//                       body has `Guard test: <name>` lines (guardTests), else to be found in `files`.
//   reply-owed          open, no outcome reply, and its commits say an outcome (`outcome`): only the reply is owed.
//                       A fix commit after a red one, or a test, docs or cleanup fix: `fixed`. `guard, passes`:
//                       `declined`, the guard test being the evidence. `guard removed, declined` or `… deferred`:
//                       `declined` or `deferred`, and `replyText` is that commit's body, the reply in full.
//                       `heads-up for <step>`: `deferred as a heads-up`, with `replyText` from a `guard removed,
//                       deferred` commit before it.
//   unclear             anything else, with the reason in `because`; the owner decides, nothing is guessed:
//                       - commits name a number that no submitted review comment has;
//                       - an earlier round's finding that is not carried into this round (resolved, no outcome reply
//                         since the last summary) but that commits name: an earlier round's unpushed commits, or
//                         work on a finding that nobody reopened;
//                       - an open thread with both an outcome reply and commits (a resolve that failed, or a finding
//                         the owner reopened);
//                       - a resolved thread with commits and no outcome reply;
//                       - a resolved thread whose outcome reply and commits do not say the same (the commits stop
//                         part-way, or say another outcome): a reply and later commits;
//                       - commits in an order the fix round does not produce, or of an unknown kind (commitStory).
//
// Every record holds the finding's fields (`id`, `commentId`, `path`, `line`, `title`, `body`, `author`, `url`; null
// but for `id` when commits name a number without a comment), `thread` (`open`, `resolved` or `none`), `class`,
// `outcome` (or null), `reply` (the reply that counts for this round, in full, or null), `commits`
// (`{ sha, subject }`, oldest first; a commit for several findings is in each one's), `mayFail`, `replyText` (or
// null), `because` (what the class rests on, in words) and `owed`.
export function classifyRound({ findings, earlierNumbers, commits, lastSummaryAt = null }) {
  const highest = highestOf(earlierNumbers);
  const commitsOf = new Map();
  for (const c of commits) {
    const own = roundCommit(c.subject);
    const named = NAMES_FINDINGS.exec(c.subject ?? "")?.[1];
    for (const id of own?.ids ?? (named ? numbersOf(named) : [])) {
      commitsOf.set(id, [...(commitsOf.get(id) ?? []), { ...c, kind: own?.kind ?? "unknown" }]);
    }
  }

  const byNumber = (a, b) => a - b;
  const records = [];
  const earlier = [];
  const carried = [];
  for (const finding of findings) {
    const mine = commitsOf.get(finding.id) ?? [];
    commitsOf.delete(finding.id);
    const reply = replyOfRound(finding, highest, lastSummaryAt);
    const ofEarlierRound = finding.id <= highest && finding.resolved && !reply;
    const sorted = classifyFinding(finding, mine, reply, ofEarlierRound ? highest : null);
    if (sorted) records.push(sorted);
    else earlier.push(finding.id);
    if (finding.id <= highest && !ofEarlierRound) carried.push(finding.id);
  }
  for (const [id, mine] of commitsOf) {
    const because = `commits name finding ${id}, but no submitted review comment on the PR has that number`;
    records.push(record({ id }, "none", null, mine, { class: "unclear", because, mayFail: commitStory(mine).mayFail }));
  }
  return {
    findings: records.sort((a, b) => a.id - b.id),
    earlier: earlier.sort(byNumber),
    carried: carried.sort(byNumber),
  };
}

// The reply that counts for this round: the last reply in the finding's thread that gives an outcome, and for a
// finding numbered at or below the earlier rounds' highest only when it was posted after the last summary.
function replyOfRound(finding, highest, lastSummaryAt) {
  const reply = (finding.replies ?? []).findLast((r) => replyOutcome(r.body) !== null) ?? null;
  if (!reply || finding.id > highest) return reply;
  return lastSummaryAt != null && Date.parse(reply.createdAt) > Date.parse(lastSummaryAt) ? reply : null;
}

function record(finding, thread, reply, commits, fields) {
  return {
    id: finding.id,
    commentId: finding.commentId ?? null,
    path: finding.path ?? null,
    line: finding.line ?? null,
    title: finding.title ?? null,
    body: finding.body ?? null,
    author: finding.author ?? null,
    url: finding.url ?? null,
    thread,
    class: fields.class,
    outcome: fields.outcome ?? null,
    reply: reply?.body ?? null,
    commits: commits.map(({ sha, subject }) => ({ sha, subject })),
    mayFail: fields.mayFail ?? [],
    replyText: fields.replyText ?? null,
    because: fields.because,
    owed: fields.owed ?? OWED[fields.class],
  };
}

// One finding's record. `reply` is the reply that counts for this round (replyOfRound). `earlierUpTo` is null for a
// finding of this round, and for an earlier round's finding that is not carried into this one the highest number the
// earlier rounds' summaries list: such a finding gives no record (null) unless commits name it.
function classifyFinding(finding, mine, reply, earlierUpTo) {
  const thread = finding.resolved ? "resolved" : "open";
  const replied = reply && { outcome: replyOutcome(reply.body), quote: `"${cut(firstLine(reply.body), 80)}"` };
  const story = mine.length > 0 ? commitStory(mine) : null;
  const sorted = (name, fields) => record(finding, thread, reply, mine, { class: name, ...fields });
  const unclear = (because) => sorted("unclear", { because, mayFail: story?.mayFail });

  if (earlierUpTo !== null) {
    if (!story) return null;
    return unclear(
      `the earlier rounds' summaries list numbers up to ${earlierUpTo}, and its thread is resolved with no outcome ` +
        "reply since the last summary, so it is not carried into this round; yet commits after the PR's head name " +
        "it: an earlier round's unpushed commits, or work on a finding that nobody reopened",
    );
  }

  if (!story) {
    if (!finding.resolved) {
      return sorted("verify", { because: "its thread is open and no commit after the PR's head names it" });
    }
    if (!reply) {
      const because = "its thread is resolved without a reply that gives an outcome, and no commit names it";
      return sorted("resolved-by-hand", { because });
    }
    const because = `its thread is resolved and its reply starts ${replied.quote}`;
    return sorted("handled", { outcome: replied.outcome, because });
  }

  if (!finding.resolved && reply) {
    return unclear(
      `its thread is open, yet it has the reply ${replied.quote} and commits of this round (${story.says}): a ` +
        "resolve that failed, or a finding the owner reopened",
    );
  }
  if (finding.resolved && !reply) {
    return unclear(
      `its thread is resolved without a reply that gives an outcome, but it has commits of this round (${story.says})`,
    );
  }
  if (story.broken) return unclear(story.says);

  if (finding.resolved) {
    if (!story.outcome) return unclear(`its reply ${replied.quote} gives an outcome, but ${story.says}`);
    if (OUTCOME_FAMILY[story.outcome] !== OUTCOME_FAMILY[replied.outcome]) {
      return unclear(`its reply ${replied.quote} says ${replied.outcome}, but ${story.says}`);
    }
    const because = `its thread is resolved, its reply starts ${replied.quote}, and ${story.says}`;
    return sorted("handled", { outcome: replied.outcome, because });
  }

  const because = `its thread is open and ${story.says}`;
  if (story.next === "test-writer") return sorted("resume-test-writer", { because, mayFail: story.mayFail });
  if (story.next === "implementer") return sorted("resume-implementer", { because, mayFail: story.mayFail });
  return sorted("reply-owed", { outcome: story.outcome, because, replyText: story.replyText, owed: replyOwed(story) });
}

// What a finding handled by its commits is owed: the reply and, after a `guard removed` commit, where its text comes
// from. A `guard removed, deferred` commit with no heads-up commit after it defers to an issue, which exists
// already, or to a heads-up whose commit the round did not reach: the commits cannot tell which, so the line says it.
function replyOwed(story) {
  const owed = OWED["reply-owed"];
  if (!story.removal) return owed;
  const removal = shortSha(story.removal.sha);
  const text = story.replyText
    ? `its text is the body of ${removal} (replyText)`
    : `${removal} has no body to take its text from, so the state file or the owner gives the reason`;
  const headsUp = story.headsUpMayBeMissing
    ? "; if it defers to a heads-up in a design, the `heads-up for <step>` commit is still missing"
    : "";
  return `${owed}: ${text}${headsUp}`;
}

// A text cut to `length` characters, the last one an ellipsis when it was longer.
function cut(text, length) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const CLASS_LABELS = {
  handled: "HANDLED",
  "resolved-by-hand": "RESOLVED BY HAND",
  "resume-test-writer": "RESUME AT THE TEST-WRITER",
  "resume-implementer": "RESUME AT THE IMPLEMENTER",
  "reply-owed": "REPLY OWED",
  unclear: "UNCLEAR",
};

// The lines the gather prints after its list of findings, from what round.json holds (`{ round, head,
// earlierRounds: { summaries, highestNumber }, commits: ownCommits' result, findings: classifyRound's records }`):
// - `ROUND: <n> · …`: the round, and how many earlier summaries list numbers up to which;
// - one line per finding that does not go to verification, by number:
//   `<CLASS>: <id> <path>:<line> · [<outcome> ·] <what the class rests on> · [may fail: <tests> ·] owed: <what>`,
//   the class in capitals as CLASS_LABELS has it, and `may fail` naming, for each of the finding's unsettled `red`
//   commits, the guard tests its body names, each in backticks, else the files it changed, else `commit <sha>`;
// - `NOT THIS ROUND'S COMMITS: <k> of <n> after the PR's head <sha>: <sha> <subject> (<why>); …` when ownCommits
//   found any, at most ten of them named (round.json has all).
export function roundLines({ round, head, earlierRounds, commits, findings }) {
  const { summaries, highestNumber } = earlierRounds;
  const earlier =
    summaries === 0
      ? "no earlier summary"
      : `${summaries} earlier ${summaries === 1 ? "summary lists" : "summaries list"} numbers up to ${highestNumber}`;
  const lines = [`ROUND: ${round} · ${earlier}`];
  for (const f of findings.filter((f) => f.class !== "verify")) {
    const where = f.path == null ? "(no review comment)" : f.line == null ? f.path : `${f.path}:${f.line}`;
    const testsOf = (c) => (c.tests ?? []).map((name) => `\`${name}\``);
    const filesOf = (c) => (c.files.length > 0 ? c.files : [`commit ${shortSha(c.sha)}`]);
    const mayFail = [...new Set(f.mayFail.flatMap((c) => (testsOf(c).length > 0 ? testsOf(c) : filesOf(c))))];
    const parts = [
      `${CLASS_LABELS[f.class]}: ${f.id} ${where}`,
      ...(f.outcome ? [f.outcome] : []),
      f.because,
      ...(mayFail.length > 0 ? [`may fail: ${mayFail.join(", ")}`] : []),
      `owed: ${f.owed}`,
    ];
    lines.push(parts.join(" · "));
  }
  if (!commits.allOwn) {
    const named = commits.notOwn.slice(0, 10).map((c) => `${shortSha(c.sha)} ${c.subject} (${c.why})`);
    const more = commits.notOwn.length > named.length ? `; … and ${commits.notOwn.length - named.length} more` : "";
    lines.push(
      `NOT THIS ROUND'S COMMITS: ${commits.notOwn.length} of ${commits.count} after the PR's head ${shortSha(head)}: ` +
        `${named.join("; ")}${more}`,
    );
  }
  return lines;
}

// The `--format` the gather gives `git log --name-only`, and the commits in its output (commitsFromGitLog): one
// record per commit, the fields separated by control characters that no commit message holds.
export const GIT_LOG_FORMAT = "--format=%x1e%H%x1f%s%x1f%b%x1f%(trailers)%x1f";

// The commits in the output of `git log --reverse --name-only <GIT_LOG_FORMAT> <PR head>..HEAD`, in its order (oldest
// first): `{ sha, subject, body, files }`. `body` is the message below the subject without its trailers (the
// `Co-Authored-By:` and session lines every commit ends with, which git itself names), trimmed, since a `guard
// removed` commit's body is its finding's reply in full; `files` are the paths the commit changed. No output gives no
// commits.
export function commitsFromGitLog(text) {
  const clean = (part) => (part ?? "").replace(/\r\n/g, "\n").trim();
  return text
    .split("\x1e")
    .slice(1)
    .map((entry) => {
      const [sha, subject, message, trailers, files] = entry.split("\x1f");
      const whole = clean(message);
      const tail = clean(trailers);
      const body = tail && whole.endsWith(tail) ? whole.slice(0, whole.length - tail.length).trimEnd() : whole;
      return {
        sha: clean(sha),
        subject: clean(subject),
        body,
        files: clean(files)
          .split("\n")
          .map((f) => f.trim())
          .filter(Boolean),
      };
    });
}
