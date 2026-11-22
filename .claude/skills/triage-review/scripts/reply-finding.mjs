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
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

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

function gh(ghArgs) {
  const r = spawnSync("gh", ghArgs, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) fail(`gh ${ghArgs.slice(0, 2).join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
}

// The thread whose first comment is the finding's comment, paging through the PR's review threads.
function findThread() {
  const [owner, repo] = gh(["repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name']).split("/");
  const query = `query($owner: String!, $repo: String!, $pr: Int!, $after: String) {
    repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }`;
  let after = null;
  for (;;) {
    const page = ["api", "graphql", "-f", `owner=${owner}`, "-f", `repo=${repo}`, "-F", `pr=${pr}`];
    page.push("-f", `query=${query}`);
    if (after) page.push("-f", `after=${after}`);
    const threads = JSON.parse(gh(page)).data?.repository?.pullRequest?.reviewThreads;
    if (!threads) fail(`PR ${pr} not found`);
    const thread = threads.nodes.find((t) => t.comments.nodes[0]?.databaseId === Number(commentId));
    if (thread) return thread;
    if (!threads.pageInfo.hasNextPage) return null;
    after = threads.pageInfo.endCursor;
  }
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

const thread = resolve === "yes" ? findThread() : null;
if (resolve === "yes" && !thread) fail(`no review thread starts with comment ${commentId}; nothing posted`);

if (dryRun) {
  const firstLine = body.trim().split("\n")[0];
  console.log(`WOULD REPLY: to comment ${commentId} on PR ${pr}, ${body.length} characters: ${firstLine}`);
  if (thread) console.log(`WOULD RESOLVE: thread ${thread.id}${thread.isResolved ? " (already resolved)" : ""}`);
  process.exit(0);
}

const url = gh([
  "api",
  "-X",
  "POST",
  `repos/{owner}/{repo}/pulls/${pr}/comments/${commentId}/replies`,
  "-F",
  `body=@${bodyFile}`,
  "--jq",
  ".html_url",
]);
console.log(`REPLIED: ${url}`);
if (!thread) process.exit(0);

if (thread.isResolved) {
  console.log(`RESOLVED: thread ${thread.id} (it already was)`);
  process.exit(0);
}
const mutation = "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }";
const resolveArgs = ["api", "graphql", "-f", `id=${thread.id}`, "-f", `query=${mutation}`];
resolveArgs.push("--jq", ".data.resolveReviewThread.thread.isResolved");
const r = spawnSync("gh", resolveArgs, { encoding: "utf8", windowsHide: true });
if (r.status !== 0 || r.stdout.trim() !== "true") {
  // The reply is posted: running the script again would post it twice. Resolve the thread on its own instead.
  fail(
    `the reply is posted, but thread ${thread.id} could not be resolved: ${(r.stderr || r.stdout || "").trim()}. ` +
      `Resolve it on its own, without posting again: gh api graphql -f id=${thread.id} -f query='${mutation}'`,
  );
}
console.log(`RESOLVED: thread ${thread.id}`);
