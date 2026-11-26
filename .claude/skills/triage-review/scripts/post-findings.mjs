// /triage-review (the skill's rare.md, § A review from the conversation and § What the workflow found): posts
// findings that have no review thread yet as review comments on the pull request, so the gather takes them like any
// other thread. They are a code review's findings that are only in the conversation (`/code-review` ran without
// `--comment`), or the new findings the check's together step returns: side remarks of the verifiers that hold
// after an agent checked their code path.
//
//   node .claude/skills/triage-review/scripts/post-findings.mjs <pr> <chat-findings-file> [--dry-run]
//
// The file is a JSON array of { path, line, body }, in the review's order; `line` may be null, else a line of the
// local HEAD's version, the one the review and the verifiers read. The triage commits as it goes and the owner pushes
// all of it once, at the end, so CI runs once: the local HEAD may be ahead of the PR's head on GitHub, and nothing
// waits for a push. Checks before it posts: the local HEAD is the PR's head commit or a descendant of it, else the
// findings' lines are of another version (a branch behind the PR, or another branch); every finding has a body, a
// path the PR's head changes, and a line that is null or a line number (planPosts in common.mjs); no body names a
// reference that would make GitHub post a backlink outside this repository (backlinkRisks in common.mjs;
// docs/software-factory/lessons.md R-102), so such a reference is rewritten in the file first, as the refusal says. A
// failed check lists every problem and posts nothing. A comment goes on the PR's head, the version GitHub has: on the
// line of the head that the finding's line is (from `git diff -U0 <PR head> HEAD`), when that line is in the PR's
// diff, else on its file; when the local commits moved or added the line, the body gets a note with both places
// (headLineOf in common.mjs). A finding whose body is already a
// top-level review comment on the PR, posted after the PR's last triage summary (an issue comment headed
// `## Review triage`; before the first summary, any comment), is skipped, so after a failure part-way, running it
// again posts only the rest. A comment from before the last summary does not count: an earlier round closed its
// thread, so a review that reports the same text again gets a thread of its own, which the gather takes.
// Posts in the review's order and prints per finding `POSTED: <n> <comment id> <url>` or `SKIPPED: <n> already
// posted as comment <id>` (posted since the last summary, so by this round), where <n> is the finding's position in
// the file; a failure prints `ERROR: ...` and exits 1. `--dry-run` makes the same checks and prints `WOULD POST: <n>
// <path>:<line>` (the head's line, with `(line <n> in the local branch)` when the local commits moved it),
// `WOULD POST: <n> <path> (file)` (with the line when it is outside the diff, or only in commits not pushed yet) or
// `WOULD SKIP: <n> already posted as comment <id>` (the same rule as SKIPPED), without posting anything.
// Run from the repository root, on the PR's branch; needs gh, logged in to the repository's GitHub account. A file,
// not a shell block in the skill's text: a session isolated in a worktree refuses a multi-line block it cannot verify
// (docs/software-factory/lessons.md R-37).
import { readFileSync } from "node:fs";
import { backlinkRefusal, fail, gh, git, lastSummaryTime, ownRepo, planPosts, run } from "./common.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");
const [pr, findingsFile] = positional;
if (positional.length !== 2 || args.length !== positional.length + (dryRun ? 1 : 0) || !/^[1-9]\d*$/.test(pr)) {
  console.error(
    "Usage: node .claude/skills/triage-review/scripts/post-findings.mjs <pr> <chat-findings-file> [--dry-run]",
  );
  process.exit(2);
}

let findings;
try {
  const text = readFileSync(findingsFile, "utf8");
  findings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text); // a byte order mark is not JSON
} catch (e) {
  fail(`cannot read ${findingsFile}: ${e.message}`);
}
if (!Array.isArray(findings) || findings.length === 0) {
  fail(`${findingsFile} is not a non-empty JSON array of { path, line, body }`);
}

const headSha = gh(["api", `repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".head.sha"]);
const local = git(["rev-parse", "HEAD"]);
if (local.status !== 0) fail(`git rev-parse HEAD failed: ${(local.stderr || local.error?.message || "").trim()}`);
const localSha = local.stdout.trim();
// The triage's commits are local until the owner's one push at the end, so the local HEAD may be ahead of the PR's
// head: then each finding's line, the local HEAD's, is found in the head's version from the diff between the two.
let localDiffs = null;
if (localSha !== headSha) {
  const inHistory = git(["merge-base", "--is-ancestor", headSha, "HEAD"]);
  if (inHistory.status === 1) {
    fail(
      `nothing posted: the local HEAD ${localSha} is neither PR ${pr}'s head commit ${headSha} nor a descendant of ` +
        "it: the working tree is behind the PR or on another branch, so the findings' lines are of another version. " +
        "Check out the PR's branch and bring it up to date (the owner's go when that needs a pull), then run it again.",
    );
  }
  if (inHistory.status !== 0) {
    fail(
      `nothing posted: git cannot compare HEAD with PR ${pr}'s head commit ${headSha}: ` +
        `${(inHistory.stderr || inHistory.error?.message || "").trim()}. If the commit is not in this repository ` +
        "yet, fetch the PR's branch, then run it again.",
    );
  }
  localDiffs = new Map();
  const diffArgs = ["-c", "core.quotePath=false", "diff", "-U0", "--no-color", "--no-ext-diff", "--no-renames"];
  for (const path of new Set(findings.map((f) => f?.path).filter((p) => typeof p === "string" && p))) {
    const d = git([...diffArgs, headSha, "HEAD", "--", path]);
    if (d.status !== 0) {
      fail(`git diff ${headSha} HEAD -- ${path} failed: ${(d.stderr || d.error?.message || "").trim()}`);
    }
    localDiffs.set(path, d.stdout);
  }
}
const prFiles = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}/files`, "--paginate", "--slurp"])).flat();
const comments = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}/comments`, "--paginate", "--slurp"])).flat();
// The PR's own comments (not on a line), where each triage leaves its summary.
const prComments = gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--paginate", "--slurp"]);
const lastSummaryAt = lastSummaryTime(JSON.parse(prComments).flat());

const { errors, posts } = planPosts(findings, prFiles, comments, headSha, lastSummaryAt, localDiffs);
const backlinks = backlinkRefusal(
  findings.map((f, i) => ({
    label: `finding ${i + 1} (${f?.path || "no path"})`,
    text: typeof f?.body === "string" ? f.body : "",
  })),
  ownRepo(),
);
if (errors.length > 0 || backlinks) {
  const problems = [...errors.map((e) => `  ${e}`), ...(backlinks ? [backlinks] : [])];
  fail(`nothing posted; fix ${findingsFile} and run it again:\n${problems.join("\n")}`);
}

// With no errors, posts[i] is findings[i]'s plan.
if (dryRun) {
  posts.forEach((p, i) => {
    const n = i + 1;
    if (p.action === "skip") {
      console.log(`WOULD SKIP: ${n} already posted as comment ${p.existingId}`);
      return;
    }
    const { path, line, subject_type: subjectType } = p.request;
    const given = findings[i].line;
    // headLine is there only when the local HEAD is ahead of the PR's head (planPosts in common.mjs).
    const moved = p.headLine !== undefined && p.headLine !== given;
    const localLine = moved ? ` (line ${given} in the local branch)` : "";
    let where;
    if (subjectType !== "file") where = `${path}:${line}${localLine}`;
    else if (given == null) where = `${path} (file)`;
    else if (p.headLine === null) where = `${path} (file): line ${given} is only in commits not pushed yet`;
    else where = `${path} (file): line ${p.headLine ?? given} is outside the diff${localLine}`;
    console.log(`WOULD POST: ${n} ${where}`);
  });
  process.exit(0);
}

let posted = 0;
for (const [i, p] of posts.entries()) {
  const n = i + 1;
  if (p.action === "skip") {
    console.log(`SKIPPED: ${n} already posted as comment ${p.existingId}`);
    continue;
  }
  const endpoint = `repos/{owner}/{repo}/pulls/${pr}/comments`;
  const r = run(["api", "-X", "POST", endpoint, "--input", "-"], JSON.stringify(p.request));
  let comment = null;
  try {
    comment = r.status === 0 ? JSON.parse(r.stdout) : null;
  } catch {
    // not JSON: reported below
  }
  if (!comment?.id) {
    fail(
      `finding ${n} could not be posted: ${(r.stderr || r.stdout || r.error?.message || "").trim()}. ` +
        `${posted} posted in this run before it; running the script again skips every finding already posted.`,
    );
  }
  posted++;
  console.log(`POSTED: ${n} ${comment.id} ${comment.html_url}`);
}
