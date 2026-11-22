// /triage-review § 1: posts a code review's findings that are only in the conversation (`/code-review` ran without
// `--comment`) as review comments on the pull request, so the gather takes them like any other thread.
//
//   node .claude/skills/triage-review/scripts/post-findings.mjs <pr> <chat-findings-file> [--dry-run]
//
// The file is a JSON array of { path, line, body }, in the review's order; `line` may be null. Checks before it
// posts: the local HEAD is the PR's head commit, else the findings' line numbers would point at another version
// (push first, on the owner's go); every finding has a body, a path the PR changes, and a line that is null or a line
// number (planPosts in common.mjs). A failed check lists every problem and posts nothing. A finding goes on its line
// (the PR's new version) when the line is in the PR's diff, else on its file. A finding whose body is already a
// top-level review comment on the PR, posted after the PR's last triage summary (an issue comment headed
// `## Review triage`; before the first summary, any comment), is skipped, so after a failure part-way, running it
// again posts only the rest. A comment from before the last summary does not count: an earlier round closed its
// thread, so a review that reports the same text again gets a thread of its own, which the gather takes.
// Posts in the review's order and prints per finding `POSTED: <n> <comment id> <url>` or `SKIPPED: <n> already
// posted as comment <id>` (posted since the last summary, so by this round), where <n> is the finding's position in
// the file; a failure prints `ERROR: ...` and exits 1. `--dry-run` makes the same checks and prints `WOULD POST: <n>
// <path>:<line>`, `WOULD POST: <n> <path> (file)` (with the line when it is outside the diff) or `WOULD SKIP: <n>
// already posted as comment <id>` (the same rule as SKIPPED), without posting anything.
// Run from the repository root; needs gh, logged in to the repository's GitHub account. A file, not a shell block in
// the skill's text: a session isolated in a worktree refuses a multi-line block it cannot verify
// (docs/software-factory/lessons.md R-37).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fail, gh, lastSummaryTime, planPosts, run } from "./common.mjs";

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
const local = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
if (local.status !== 0) fail(`git rev-parse HEAD failed: ${(local.stderr || local.error?.message || "").trim()}`);
const localSha = local.stdout.trim();
if (localSha !== headSha) {
  fail(
    `nothing posted: the local HEAD ${localSha} is not PR ${pr}'s head commit ${headSha}, so the findings' line ` +
      `numbers would point at another version. Push first (on the owner's go), then run it again.`,
  );
}
const prFiles = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}/files`, "--paginate", "--slurp"])).flat();
const comments = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/${pr}/comments`, "--paginate", "--slurp"])).flat();
// The PR's own comments (not on a line), where each triage leaves its summary.
const prComments = gh(["api", `repos/{owner}/{repo}/issues/${pr}/comments`, "--paginate", "--slurp"]);
const lastSummaryAt = lastSummaryTime(JSON.parse(prComments).flat());

const { errors, posts } = planPosts(findings, prFiles, comments, headSha, lastSummaryAt);
if (errors.length > 0) {
  fail(`nothing posted; fix ${findingsFile} and run it again:\n${errors.map((e) => `  ${e}`).join("\n")}`);
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
    const outside = given != null ? `: line ${given} is outside the diff` : "";
    console.log(`WOULD POST: ${n} ${subjectType === "file" ? `${path} (file)${outside}` : `${path}:${line}`}`);
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
