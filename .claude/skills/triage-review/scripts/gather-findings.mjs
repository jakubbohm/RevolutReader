// /triage-review § 1 (source=pr): gathers a pull request's review findings, one per top-level review comment.
//
//   node .claude/skills/triage-review/scripts/gather-findings.mjs <pr> <work-folder>
//
// Writes <work-folder>/comments.json (the API's pages as they came) and <work-folder>/findings.json (ids 1..n,
// ordered by file and line), then prints the count and one line per finding. Run from the repository root; needs gh,
// logged in to the repository's GitHub account. A file, not a shell block in the skill's text: a session isolated in
// a worktree refuses a multi-line block it cannot verify (docs/software-factory/lessons.md R-37).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

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

const r = spawnSync("gh", ["api", `repos/{owner}/{repo}/pulls/${pr}/comments`, "--paginate", "--slurp"], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
  windowsHide: true,
});
if (r.status !== 0) fail(`gh api failed for PR ${pr}: ${(r.stderr || r.error?.message || "").trim()}`);
writeFileSync(join(dir, "comments.json"), r.stdout);

const comments = JSON.parse(r.stdout)
  .flat()
  .filter((c) => c.in_reply_to_id == null);
const lineOf = (c) => c.line ?? c.original_line ?? 0;
comments.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "") || lineOf(a) - lineOf(b) || a.id - b.id);
const findings = comments.map((c, i) => ({
  id: i + 1,
  commentId: c.id,
  path: c.path,
  line: c.line ?? c.original_line ?? null,
  title: c.body.split("\n")[0].slice(0, 120),
  body: c.body,
  author: c.user?.login,
  url: c.html_url,
}));
writeFileSync(join(dir, "findings.json"), JSON.stringify(findings, null, 2));

console.log(`FINDINGS: ${findings.length} top-level review comments on PR ${pr}`);
for (const f of findings) console.log(`${f.id}\t${f.path}:${f.line}\t${f.title}`);
