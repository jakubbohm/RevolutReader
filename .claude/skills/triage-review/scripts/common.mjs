// Shared by the triage-review scripts (gather-findings.mjs, reply-finding.mjs): the gh calls, the PR's review
// threads, and how review comments become numbered findings.
import { spawnSync } from "node:child_process";

export function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

// Runs gh and returns spawnSync's result, for a caller that handles a failure itself.
export function run(args) {
  return spawnSync("gh", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, windowsHide: true });
}

// Runs gh and returns its trimmed output; a failure ends the script with ERROR.
export function gh(args) {
  const r = run(args);
  if (r.status !== 0) fail(`gh ${args.slice(0, 2).join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
}

// Every review thread of the PR, paged: its node id, whether it is resolved, and its first comment's database id.
export function reviewThreads(pr) {
  const [owner, repo] = gh(["repo", "view", "--json", "owner,name", "--jq", '.owner.login + "/" + .name']).split("/");
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
// - A finding is a top-level comment (not a reply) whose thread is not resolved.
// - Its id numbers the PR's top-level comments in the order they were posted, resolved ones included, so a later
//   round's new findings continue after the earlier rounds' and a thread left open keeps its number. A deleted
//   top-level comment shifts the numbers of those posted after it.
// - The findings are returned ordered by file and line.
export function findingsFrom(comments, resolvedCommentIds) {
  const topLevel = comments.filter((c) => c.in_reply_to_id == null).sort((a, b) => a.id - b.id);
  const lineOf = (c) => c.line ?? c.original_line ?? 0;
  const findings = topLevel
    .map((c, i) => ({ number: i + 1, c }))
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
  return { findings, resolved: topLevel.length - findings.length };
}

// The first line of the trimmed text, without the "\r" of Windows line endings.
export function firstLine(text) {
  return text.trim().split(/\r?\n/)[0];
}
