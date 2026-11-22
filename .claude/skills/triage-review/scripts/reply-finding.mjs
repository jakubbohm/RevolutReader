// /triage-review § 5 step 2: replies in the review thread that a finding's comment starts and, with `yes`, resolves
// that thread.
//
//   node .claude/skills/triage-review/scripts/reply-finding.mjs <pr> <comment-id> <body-file> <yes|no> [--dry-run]
//
// Checks before it posts: the body file has text, the comment is a top-level review comment on this PR, and with
// `yes` the thread it starts exists. A failed check posts nothing. A thread already resolved gets the reply and stays
// resolved. Prints `REPLIED: <url>` and `RESOLVED: thread <id>`; a failure prints `ERROR: ...` and exits 1.
// `--dry-run` makes the same checks and prints what it would do, without posting anything.
// Run from the repository root; needs gh, logged in to the repository's GitHub account. A file, not a shell block in
// the skill's text: a session isolated in a worktree refuses a multi-line block it cannot verify
// (docs/software-factory/lessons.md R-37).
import { readFileSync } from "node:fs";
import { fail, gh, reviewThreads, run } from "./common.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");
const [pr, commentId, bodyFile, resolve] = positional;
if (
  positional.length !== 4 ||
  args.length !== positional.length + (dryRun ? 1 : 0) ||
  !/^[1-9]\d*$/.test(pr) ||
  !/^[1-9]\d*$/.test(commentId) ||
  !["yes", "no"].includes(resolve)
) {
  console.error(
    "Usage: node .claude/skills/triage-review/scripts/reply-finding.mjs " +
      "<pr> <comment-id> <body-file> <yes|no> [--dry-run]",
  );
  process.exit(2);
}

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (e) {
  fail(`cannot read ${bodyFile}: ${e.message}`);
}
if (!body.trim()) fail(`${bodyFile} is empty`);

const comment = JSON.parse(gh(["api", `repos/{owner}/{repo}/pulls/comments/${commentId}`]));
if (!comment.pull_request_url?.endsWith(`/pulls/${pr}`)) fail(`comment ${commentId} is not on PR ${pr}`);
if (comment.in_reply_to_id != null) fail(`comment ${commentId} is a reply; give the thread's first comment`);

const thread = resolve === "yes" ? reviewThreads(pr).find((t) => t.firstCommentId === Number(commentId)) : null;
if (resolve === "yes" && !thread) fail(`no review thread starts with comment ${commentId}; nothing posted`);

if (dryRun) {
  const firstLine = body.trim().split("\n")[0];
  console.log(`WOULD REPLY: to comment ${commentId} on PR ${pr}, ${body.length} characters: ${firstLine}`);
  if (thread) console.log(`WOULD RESOLVE: thread ${thread.id}${thread.isResolved ? " (already resolved)" : ""}`);
  process.exit(0);
}

const replies = `repos/{owner}/{repo}/pulls/${pr}/comments/${commentId}/replies`;
const url = gh(["api", "-X", "POST", replies, "-F", `body=@${bodyFile}`, "--jq", ".html_url"]);
console.log(`REPLIED: ${url}`);
if (!thread) process.exit(0);

if (thread.isResolved) {
  console.log(`RESOLVED: thread ${thread.id} (it already was)`);
  process.exit(0);
}
const mutation = "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }";
const r = run(["api", "graphql", "-f", `id=${thread.id}`, "-f", `query=${mutation}`]);
let resolved = false;
try {
  resolved = r.status === 0 && JSON.parse(r.stdout).data?.resolveReviewThread?.thread?.isResolved === true;
} catch {
  // not JSON: reported below
}
if (!resolved) {
  // The reply is posted: running the script again would post it twice. Resolve the thread on its own instead.
  fail(
    `the reply is posted, but thread ${thread.id} could not be resolved: ${(r.stderr || r.stdout || "").trim()}. ` +
      `Resolve it on its own, without posting again: gh api graphql -f id=${thread.id} -f query='${mutation}'`,
  );
}
console.log(`RESOLVED: thread ${thread.id}`);
