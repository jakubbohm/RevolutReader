// /triage-review § 1: gathers a pull request's open review findings, one per top-level review comment whose thread
// is not resolved.
//
//   node .claude/skills/triage-review/scripts/gather-findings.mjs <pr> <work-folder>
//
// Writes <work-folder>/comments.json (the API's pages as they came) and <work-folder>/findings.json (ordered by file
// and line; the numbering is findingsFrom's in common.mjs, by when each comment's review was submitted, which it reads
// from the PR's reviews after the comments, so every review a listed comment belongs to is there, and joins to the
// comments with submissionTimes in common.mjs), then prints the count, how many comments it left out because their
// threads are resolved and their numbers (`LEFT OUT: 15 in resolved threads: 1-15`, for a rerun to see what an
// interrupted round already closed), and one line per finding. A comment of a pending review is left out; one whose
// review is not among the PR's reviews fails with ERROR. Run from the repository root; needs gh, logged in to the
// repository's GitHub account. A file, not a shell block in the skill's text: a session isolated in a worktree
// refuses a multi-line block it cannot verify (docs/software-factory/lessons.md R-37).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, findingsFrom, gh, ranges, reviewThreads, submissionTimes } from "./common.mjs";

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
let gathered;
try {
  gathered = findingsFrom(comments, resolvedCommentIds, submittedAt);
} catch (e) {
  fail(e.message);
}
const { findings, resolved, resolvedIds } = gathered;
writeFileSync(join(dir, "findings.json"), JSON.stringify(findings, null, 2));

console.log(`FINDINGS: ${findings.length} open top-level review comments on PR ${pr}`);
console.log(`LEFT OUT: ${resolved} in resolved threads${resolved > 0 ? `: ${ranges(resolvedIds)}` : ""}`);
for (const f of findings) console.log(`${f.id}\t${f.path}:${f.line}\t${f.title}`);
