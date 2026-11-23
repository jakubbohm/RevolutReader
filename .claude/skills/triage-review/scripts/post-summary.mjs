// /triage-review § 5 step 3: posts a round's summary as a comment on the pull request, so that it gets the same
// checks as every other text the triage posts.
//
//   node .claude/skills/triage-review/scripts/post-summary.mjs <pr> <body-file> [--dry-run]
//
// Checks before it posts: the body starts with the heading `## Review triage` (isTriageSummary in common.mjs), which
// the next round counts the rounds by, so a summary without it would give the next round a wrong number; it names no
// reference that would make GitHub post a backlink outside this repository (backlinkRisks in common.mjs;
// docs/software-factory/lessons.md R-102); and the number is a pull request of this repository, not an issue. A
// failed check posts nothing. Prints `POSTED: <url>`; a failure prints `ERROR: ...` and exits 1. `--dry-run` makes the
// same checks and prints `WOULD POST: summary on PR <pr>, <n> characters: <first line>`, without posting anything.
// Run from the repository root; needs gh, logged in to the repository's GitHub account. A file, not a shell block in
// the skill's text: a session isolated in a worktree refuses a multi-line block it cannot verify
// (docs/software-factory/lessons.md R-37).
import { readFileSync } from "node:fs";
import { backlinkRefusal, fail, firstLine, gh, isTriageSummary, ownRepo, run } from "./common.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => a !== "--dry-run");
const [pr, bodyFile] = positional;
if (positional.length !== 2 || args.length !== positional.length + (dryRun ? 1 : 0) || !/^[1-9]\d*$/.test(pr)) {
  console.error("Usage: node .claude/skills/triage-review/scripts/post-summary.mjs <pr> <body-file> [--dry-run]");
  process.exit(2);
}

let body;
try {
  body = readFileSync(bodyFile, "utf8");
} catch (e) {
  fail(`cannot read ${bodyFile}: ${e.message}`);
}
if (!isTriageSummary(body)) {
  const bom = body.charCodeAt(0) === 0xfeff ? " It starts with a byte order mark: save it as UTF-8 without one." : "";
  fail(
    `nothing posted: ${bodyFile} does not start with the heading "## Review triage" (in a later round "## Review ` +
      `triage, round <n>"), which the next round counts the rounds by.${bom}`,
  );
}
const backlinks = backlinkRefusal([{ label: "the body", text: body }], ownRepo());
if (backlinks) fail(`nothing posted; fix ${bodyFile} and run it again:\n${backlinks}`);

const pull = run(["api", `repos/{owner}/{repo}/pulls/${pr}`, "--jq", ".number"]);
if (pull.status !== 0) {
  fail(`nothing posted: PR ${pr} not found: ${(pull.stderr || pull.error?.message || "").trim()}`);
}

if (dryRun) {
  console.log(`WOULD POST: summary on PR ${pr}, ${body.length} characters: ${firstLine(body)}`);
  process.exit(0);
}

const comments = `repos/{owner}/{repo}/issues/${pr}/comments`;
const url = gh(["api", "-X", "POST", comments, "-F", `body=@${bodyFile}`, "--jq", ".html_url"]);
console.log(`POSTED: ${url}`);
