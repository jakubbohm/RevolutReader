// /triage-review's gather: reads a pull request's review findings, one per top-level review comment, and says where
// every finding of the round stands, so that a round that stopped part-way is restarted from what GitHub and git
// hold, not from a session's memory.
//
//   node .claude/skills/triage-review/scripts/gather-findings.mjs <pr> <work-folder>
//
// It reads the PR's review comments, reviews and threads, the PR's own comments (where each round leaves its summary)
// and its head commit with gh, and the commits after that head commit with git, from the folder it runs in
// (`git log <PR head>..HEAD`). It changes nothing on GitHub and nothing in the working tree. It writes three files
// into the work folder:
//
// - comments.json: the review comments, the API's pages as they came.
// - findings.json: the findings that go to verification, the verification step's input, in its shape of always
//   (`[{ id, commentId, path, line, title, body, author, url }]`, ordered by file and line): the open threads that no
//   commit after the PR's head names. In a first run of a round those are all the open threads.
// - round.json: every finding of the round with its class and what the class rests on:
//   `{ pr, round, head, earlierRounds: { summaries, highestNumber, lastSummaryAt, resolved, carried },
//   commits: { count, allOwn, notOwn }, findings: [...] }`. `round` is the number of `## Review triage` summaries on
//   the PR plus one, so a rerun of a round that stopped before its summary has that round's number again; `head` is
//   the PR's head commit; `earlierRounds` says how many summaries there are, the highest finding number they list,
//   when the last one was posted, the numbers of the earlier rounds' resolved findings that are left as they are
//   (`resolved`), and the numbers of those carried into this round (`carried`); `commits` is ownCommits' result for
//   the commits after the PR's head (`notOwn`: `{ sha, subject, why }`); `findings` are classifyRound's records, by
//   number (both in common.mjs): the finding's fields as in findings.json, then `thread` (`open`, `resolved`, or
//   `none` when commits name a number no comment has), `class`, `outcome`, `reply` (the reply in its thread that
//   gives its outcome), `commits` (`{ sha, subject }`, oldest first), `mayFail` (`{ sha, subject, files, tests }`),
//   `replyText`, `because` and `owed`.
//
// The numbering is findingsFrom's in common.mjs: by when each comment's review was submitted, which it reads from the
// PR's reviews after the comments, so every review a listed comment belongs to is there, and joins to the comments
// with submissionTimes. A comment of a pending review is left out.
//
// The round's findings are every finding numbered above the highest number an earlier round's summary lists, and of
// the lower numbers those carried into this round: a finding whose thread is open (an earlier round's undecided ask
// keeps its number, and a later round may fix it; the owner brings a closed one back by unresolving it), and one
// whose thread is resolved with an outcome reply newer than the last summary (this round closed it). A carried
// finding is sorted like any other, and its commits are this round's own. A lower number whose thread is resolved
// without such a newer reply stays an earlier round's.
//
// The round's commits are `<type>(<scope>): [review] <id>: …` and `docs(<scope>): [plan] <id>: …`, the id being the
// finding's number or, for findings fixed together, several separated by commas (`[review] 3, 7: …`): such a commit
// counts for each of them. A `…, red` commit's body may name the guard tests it added, one per line
// `Guard test: <the test's full name as the test runner prints it>`: they are `tests` in `mayFail`.
//
// The classes (`class` in round.json; the rules, every commit shape, the orders of commits that are read and every
// unclear case are in the comments above roundCommit, commitStory and classifyRound in common.mjs):
//
//   verify              open, no commit names it: in findings.json, goes to verification.
//   handled             resolved, and its thread's reply gives the outcome ("Fixed in", "Declined", "Declined by the
//                       owner", "Deferred"; its commits, when it has any, say the same): taken back into the round's
//                       record with that outcome, neither triaged nor answered again.
//   resolved-by-hand    resolved, no such reply, no commit: the owner is asked whether to triage it.
//   resume-test-writer  open, its commits stop at a `[plan] <id>:` commit: the owner chose "fix now"; the fix resumes
//                       at the guard test.
//   resume-implementer  open, its commits stop at a `…, red` commit: the fix resumes at the implementer; the tests
//                       its `red` commits added (`mayFail`: their names in `tests` when the commits' bodies give
//                       them, else the files to look in) are the only ones that may fail at the baseline.
//   reply-owed          open, its commits say an outcome (`outcome`): only the reply is owed, its text in
//                       `replyText` when a `guard removed` commit's body carries it.
//   unclear             a case the rules do not cover, with the reason (`because`): the owner decides.
//
// The gather reads GitHub and git only, never the triage's state file. What leaves neither a reply nor a commit is
// therefore not in its answer: a finding that was routed, or declined or deferred without a commit, but not answered
// yet comes out as `verify`, and a fix the implementer disputes as `resume-implementer`.
//
// It prints:
//
//   FINDINGS: <n> open top-level review comments on PR <pr>      (the n findings in findings.json)
//   LEFT OUT: <n> in resolved threads: <numbers>                  (every resolved thread, of any round; the numbers
//                                                                 as ranges, `1-15`; none: no colon)
//   <id>\t<path>:<line>\t<title>                                  (one line per finding in findings.json)
//   ROUND: <n> · <k> earlier summaries list numbers up to <m>     (in round 1: `ROUND: 1 · no earlier summary`)
//   <CLASS>: <id> <path>:<line> · [<outcome> ·] <what the class rests on> · [may fail: <tests> ·] owed: <what>
//                                                                 (one line per finding of another class, by number;
//                                                                 the class in capitals: HANDLED, RESOLVED BY HAND,
//                                                                 RESUME AT THE TEST-WRITER, RESUME AT THE
//                                                                 IMPLEMENTER, REPLY OWED, UNCLEAR; `may fail` names
//                                                                 the guard tests, each in backticks, or for a red
//                                                                 commit whose body names none the files it changed)
//   NOT THIS ROUND'S COMMITS: <k> of <n> after the PR's head <sha>: <sha> <subject> (<why>); …
//                                                                 (only when a commit after the PR's head is not a
//                                                                 `[review] <id>:` or `[plan] <id>:` commit, or
//                                                                 names an earlier round's finding that is not
//                                                                 carried into this round: the review saw other
//                                                                 code than the working tree, so the round stops
//                                                                 for the owner)
//
// It fails with `ERROR: ...` and exit 1, having written only comments.json, rather than guess: a top-level comment
// whose review is not among the PR's reviews (its number would be a guess); an earlier round's summary that lists no
// finding number (the numbers the earlier rounds used would be unknown; post-summary.mjs refuses to post such a
// summary); a HEAD that is not the PR's head commit or a descendant of it (the commits after the head cannot be read:
// the working tree is behind the PR, on another branch, or has not fetched it).
//
// Run from the repository root, on the PR's branch; needs git, and gh logged in to the repository's GitHub account. A
// file, not a shell block in the skill's text: a session isolated in a worktree refuses a multi-line block it cannot
// verify (docs/software-factory/lessons.md R-37).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  GIT_LOG_FORMAT,
  classifyRound,
  commitsFromGitLog,
  fail,
  findingsFrom,
  gh,
  git,
  ownCommits,
  ranges,
  reviewThreads,
  roundLines,
  roundOf,
  submissionTimes,
} from "./common.mjs";

const args = process.argv.slice(2);
const [pr, dir] = args;
if (args.length !== 2 || !/^[1-9]\d*$/.test(pr)) {
  console.error("Usage: node .claude/skills/triage-review/scripts/gather-findings.mjs <pr> <work-folder>");
  process.exit(2);
}

try {
  mkdirSync(dir, { recursive: true });
} catch (e) {
  fail(`cannot create ${dir}: ${e.message}`);
}

// The commits after the PR's head commit, oldest first, read from the folder the script runs in. This is the one
// place that asks git; what the commits mean is common.mjs's.
function commitsAfter(head) {
  if (!/^[0-9a-f]{40,64}$/.test(head)) fail(`PR ${pr}'s head commit is not a commit id: ${head}`);
  const inHistory = git(["merge-base", "--is-ancestor", head, "HEAD"]);
  if (inHistory.status === 1) {
    fail(
      `HEAD is neither PR ${pr}'s head commit ${head} nor a descendant of it: the working tree is behind the PR or ` +
        "on another branch, so the review saw other code than it holds. Check out the PR's branch and bring it up " +
        "to date (the owner's go when that needs a pull or a push), then run the gather again.",
    );
  }
  if (inHistory.status !== 0) {
    const detail = (inHistory.stderr || inHistory.error?.message || "").trim();
    fail(
      `git cannot compare HEAD with PR ${pr}'s head commit ${head}: ${detail}. If the commit is not in this ` +
        "repository yet, fetch the PR's branch, then run the gather again.",
    );
  }
  const log = git(["-c", "core.quotePath=false", "log", "--reverse", "--name-only", GIT_LOG_FORMAT, `${head}..HEAD`]);
  if (log.status !== 0) fail(`git log ${head}..HEAD failed: ${(log.stderr || log.error?.message || "").trim()}`);
  return commitsFromGitLog(log.stdout);
}

const pages = gh(["api", `repos/{owner}/{repo}/pulls/${pr}/comments`, "--paginate", "--slurp"]);
writeFileSync(join(dir, "comments.json"), pages);
const comments = JSON.parse(pages).flat();

const reviews = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}/reviews`, "--paginate", "--slurp"])).flat();
const submittedAt = submissionTimes(comments, reviews);

const resolvedCommentIds = new Set(
  reviewThreads(pr)
    .filter((t) => t.isResolved)
    .map((t) => t.firstCommentId),
);
// The PR's own comments (not on a line), where each triage leaves its summary.
const prComments = gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--paginate", "--slurp"]);
let gathered;
let round;
try {
  gathered = findingsFrom(comments, resolvedCommentIds, submittedAt);
  round = roundOf(JSON.parse(prComments).flat());
} catch (e) {
  fail(e.message);
}
const { resolved, resolvedIds } = gathered;

const head = gh(["api", `repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".head.sha"]);
const commits = commitsAfter(head);
const sorted = classifyRound({
  findings: gathered.all,
  earlierNumbers: round.earlierNumbers,
  commits,
  lastSummaryAt: round.lastSummaryAt,
});
const toVerify = new Set(sorted.findings.filter((f) => f.class === "verify").map((f) => f.id));
const findings = gathered.findings.filter((f) => toVerify.has(f.id));
const record = {
  pr: Number(pr),
  round: round.round,
  head,
  earlierRounds: {
    summaries: round.summaries,
    highestNumber: round.highestNumber,
    lastSummaryAt: round.lastSummaryAt,
    resolved: sorted.earlier,
    carried: sorted.carried,
  },
  commits: ownCommits(commits, round.earlierNumbers, sorted.carried),
  findings: sorted.findings,
};
writeFileSync(join(dir, "findings.json"), JSON.stringify(findings, null, 2));
writeFileSync(join(dir, "round.json"), JSON.stringify(record, null, 2));

console.log(`FINDINGS: ${findings.length} open top-level review comments on PR ${pr}`);
console.log(`LEFT OUT: ${resolved} in resolved threads${resolved > 0 ? `: ${ranges(resolvedIds)}` : ""}`);
for (const f of findings) console.log(`${f.id}\t${f.path}:${f.line}\t${f.title}`);
for (const line of roundLines(record)) console.log(line);
