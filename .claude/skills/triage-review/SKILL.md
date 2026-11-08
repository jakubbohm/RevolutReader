---
name: triage-review
description: Triage and fix the findings of a code review on a pull request, after /code-review. Verifies every finding read-only (a saved workflow, an investigator and a skeptic per finding), fixes the confirmed local ones test-first through the test-writer and implementer with a commit per handoff, declines the refuted ones in their PR threads with evidence, and brings the rest to the owner one at a time. Use when the owner invokes /triage-review or asks to work through a review's findings on a PR.
argument-hint: <PR number> [source=pr|chat]
disable-model-invocation: true
---

# Review triage orchestrator

You are the orchestrator (O). You do not write tests or production code yourself. You gather the findings, run
the verification workflow, check its evidence, delegate the fixes, verify every step, decide nothing the owner
should decide, and record everything in the PR. Three workers do the rest:

- the saved workflow **`triage-review-verify`** (`.claude/workflows/triage-review-verify.js`): verifies every
  finding read-only and routes it;
- **T** = `test-writer` subagent: writes the failing guard test that reproduces a finding; fixes test-quality findings;
- **I** = `implementer` subagent: makes a guard test pass; fixes docs and cleanup findings. Never edits tests.

The rules this skill applies: `docs/conventions/testing.md` § Code review after the apply; the roles:
§ Test-first workflow; the `[review]` commits: `docs/conventions/workflow.md` § 3. Test and check commands:
`CLAUDE.md` § Commands.

Arguments: `$ARGUMENTS`
- First argument: the PR number. If missing, take the current branch's PR (`gh pr view --json number`); if there
  is none, stop and ask.
- `source=` says where the findings are (default `pr`): `pr` reads the PR's review threads, which is what
  `/code-review --comment` posts; `chat` takes them from the review's reply in this conversation. With `pr` and
  no threads, fall back to `chat` and say so.

## Outcomes

| Outcome | When | What happens |
|---|---|---|
| **FIX** | verified real; the fix is local (only files the PR touches or the finding names; no new dependency, setting, Bicep change, API contract change or spec change) and not large | § 3: the guard test, then the fix, one `[review]` commit each; the thread gets the commit and is resolved |
| **DECLINE** | verified not real, with concrete evidence you checked yourself | the thread gets the evidence and is resolved |
| **ASK** | everything else: a disputed verdict, unclear, a spec change, a contract change, a fix outside the PR's files, a large fix, an implementer dispute, a finding the workflow returned no result for | § 4: the owner decides fix, decline or defer; the thread gets the decision |

When unsure, ASK. Never decline on the review's word, on the workflow's word or on your own impression: only with
evidence at a file:line, a test name or a recorded decision that you opened.

## 0. Prepare

1. `gh pr view <PR> --json number,title,state,isDraft,headRefName,baseRefName,url,body`. The current branch must
   be the PR's head branch and the working tree clean (`git status --porcelain` empty); otherwise stop and ask.
   Never work on `main`.
2. Find the change: a folder `openspec/changes/<id>/`, or `openspec/changes/archive/<date>-<id>/` once archived,
   that this branch belongs to (the PR body or the branch name names it). With one, the **scope** of the commits is
   its number part (`c007`) and the **intent files** are its `proposal.md`, `design.md` and `specs/**`. Without one
   this is a Direct PR: the scope is its roadmap step in lower case (`c13`, workflow.md § 3), and the intent is the
   issue the PR closes (`gh issue view <n> --json title,body`, saved to the work folder) plus the step's section
   in `pm/roadmap.md`.
3. Work folder: `<scratchpad>/triage-review/<PR>/`, absolute path, forward slashes. State file:
   `openspec/changes/<change>/.review-triage.md` (in the archive folder when the change is archived); for a Direct
   PR `<work folder>/state.md`. It holds: the PR, the scope, the findings source, the routing per finding, the
   commits per finding, the asks and the owner's answers, T's and I's agent IDs. **Write the agent IDs there as
   soon as you spawn or resume an agent.** After a compaction, re-read it before doing anything else.
4. T and I: read `openspec/changes/<change>/.tdd-state.md` for their IDs and resume them with SendMessage. If one
   cannot be resumed, or there is no state file, spawn a fresh one when it is first needed and brief it: the change,
   the PR, that this is the review triage, and the finding at hand.
5. Baseline: run the full suite once (`dotnet test` and the frontend tests). Record it. If anything is red, stop
   and report: no triage on a red baseline.
6. The diff: `git fetch origin <baseRef>` then `git diff origin/<baseRef>...HEAD > <work folder>/diff.patch`.
7. Create a task list with one item per step; add one item per finding after § 1.

## 1. Gather

**`source=pr`:** run script A with the PR number and the work folder. It writes `findings.json`, one element per
top-level review comment ordered by file and line with ids 1..n, and prints the count and the list. Zero findings
and `source` not forced: say so and switch to `chat`.

**`source=chat`:** write `findings.json` yourself from the review's reply in this conversation:

```json
[{ "id": 1, "path": "<file>", "line": 0, "title": "<one line>", "body": "<the finding verbatim: the claim and the failure scenario>", "commentId": null }]
```

Keep every finding in the review's order; never drop or merge one.

Then write the findings table (id · file:line · title) into the state file.

## 2. Verify

Call the Workflow tool with `name: "triage-review-verify"` and these `args` (absolute paths):

```json
{ "pr": 123, "findingsPath": ".../findings.json", "ids": [1, 2, 3], "diffPath": ".../diff.patch",
  "intentPaths": [".../proposal.md", ".../design.md", ".../specs/<capability>/spec.md"], "scope": "<one sentence on the PR>" }
```

It spawns an investigator and a skeptic per finding, read-only, and returns `routed` (per finding the outcome,
the reason, the investigation and the refutation) and `missing` (findings without a result: they are ASK).

Before acting on anything:

1. **Check every DECLINE yourself:** open the cited file:line, test or decision. Evidence you cannot see, or that
   does not cover the finding, turns it into ASK; record why.
2. **Check every FIX's shape:** the listed files are in the diff or the finding; no spec behaviour, no contract
   change. Anything off turns it into ASK.
3. Record the routing in the state file and show it to the owner in one table (id · title · outcome · one-line
   reason). Do not wait for an answer: FIX and DECLINE are this skill's job, ASK is § 4. Continue with § 3.

## 3. Fix round, one finding at a time

Order the FIX findings by file, so related ones follow each other. For each, by its kind:

- **behaviour** (`needsFailingTest`):
  1. Send T the finding (its body, file:line, the investigation's evidence and sketch) and the change's `design.md`
     and delta specs. Ask for **one guard test that reproduces it**, at the level `testing.md` § Where tests live
     gives it: a unit test next to the rule, an integration edge test for an adapter, a frontend test for browser
     behaviour. **Never a new acceptance scenario:** that is a spec change and an ASK. T edits only test files, the
     DSL and the drivers the test needs.
  2. Verify red yourself: the build passes; the new test fails at runtime, not at compile time; everything else is
     still green. Commit `test(<scope>): [review] <id>: <summary>, red`.
     **A guard test that passes at once refutes the finding:** keep it, commit
     `test(<scope>): [review] <id>: guard, passes`, and move the finding to DECLINE with the test as its evidence.
  3. Send I the test (file and test name), the finding and the sketch; I must not change any test file. Verify
     green yourself: the full suite passes, and `git diff --name-only HEAD` lists nothing under `tests/`, `*Tests*/`,
     `*.test.ts(x)`, `*.spec.ts(x)` or `openspec/`. A violation: restore the file
     (`git restore --source=HEAD -- <path>`), tell I, resume I. Commit `fix(<scope>): [review] <id>: <summary>`.
  4. I returns `STATUS: BLOCKED` (the test looks wrong): do not judge it alone. Move the finding to ASK with T's
     test, I's claim and the evidence.
- **test-quality:** T alone fixes the test. Verify the suite is green. Commit `test(<scope>): [review] <id>: <summary>`.
- **docs** or **cleanup:** I alone. Verify the suite is green and the diff touches no test file. Commit
  `docs(<scope>): [review] <id>: <summary>` or `refactor(<scope>): [review] <id>: <summary>`.

After each commit: tick the finding and note the commit in the state file. Only one of T and I works at a time;
never build or test while one of them is working.

## 4. Ask round

1. Overview first: one table of the ASK findings (id · title · why it is asked · your recommendation).
2. Then one finding at a time (the owner's standing preference, memory `decisions-one-by-one`): the finding in two
   or three sentences, both sides when the verdict was disputed, the trade-off, your recommendation, and the
   choice: **fix now** · **decline** (the owner gives the reason) · **defer**. Use AskUserQuestion with these
   options; a free-text answer is the owner's own words, re-confirm it when it matters.
3. Act on each answer before the next question:
   - **fix now** → § 3 as a FIX. A spec change first gets its spec or `design.md` edit, committed
     `docs(<scope>): [plan] <what changed>`; the acceptance test change then goes to T;
   - **decline** → DECLINE, with the owner's reason as the evidence;
   - **defer** → the owner says where: a GitHub issue (`gh issue create`: the finding and the step it belongs to;
     the issue linked in the thread), or a heads-up in the `design.md` of the step it belongs to, committed
     `docs(<scope>): [review] <id>: heads-up for <step>`.
4. Record every answer in the state file.

## 5. Close

1. Full suite and checks: `dotnet test`, the frontend tests, `dotnet format whitespace RevolutReader.slnx
   --verify-no-changes`, the frontend `run lint`, `run typecheck` and `run format:check`; `az bicep lint --file
   infra/main.bicep` if `infra/` changed; the API-client drift check if any endpoint changed (it should not have:
   that is an ASK).
2. Threads (`source=pr`): for every finding with a `commentId`, one reply through script B: FIX → "Fixed in
   `<sha>`: <summary>; guard test `<name>`"; DECLINE → "Declined: <evidence>"; the owner's decline → "Declined by
   the owner: <reason>"; deferred → "Deferred to <issue or step>". Resolve the FIX, DECLINE and deferred threads;
   leave an undecided ASK's thread open.
3. One summary comment on the PR through script C: the table `# · Finding · Outcome · Evidence or commit`, the
   counts, and the checks run, as PR #26's description has it. Never bank data, secrets or personal data in a
   thread or the summary: the repository is public.
4. Commit the state file: `docs(<scope>): [review] triage summary`. Never push, never open a PR or mark one ready:
   the owner does.
5. Report to the owner: the counts per outcome, the commits, what stays open, and the fix range
   `<first sha>..<last sha>` in case they want a second `/code-review` on it.

## Rules for you (O)

- Never edit tests or production code yourself. The only files you edit are the state file, the findings file and
  the close-out docs. Restoring a file I was not allowed to change is the one exception.
- Verify before trusting: the workflow's evidence, T's red, I's green. Never start a build or a test run while T
  or I works. The workflow's agents never build or run tests (its prompts forbid it).
- Commit only on the PR's branch, at the handoffs above, with the `[review]` tag and the finding number. Never
  push, never commit on `main`.
- Do not use `isolation: "worktree"` for T or I: one working tree, as in `/tdd-apply`.
- Never put bank data or secrets into anything you send, commit, post or record.
- Scripts run verbatim, each as one Bash tool call with the placeholders filled in; never translated to PowerShell.

## Scripts

Placeholders: `<pr>`, `<work-folder>` (absolute, forward slashes), `<comment-id>`, `<body-file>`, `<resolve>`
(`yes` or `no`). Each script needs `gh` logged in to the repository's GitHub account and `node` on the path.

### A — gather the findings from the PR's review threads

```sh
gather_findings() {
  pr='<pr>'; dir='<work-folder>'
  mkdir -p "$dir" || { printf 'ERROR: cannot create %s\n' "$dir"; exit 1; }
  gh api "repos/{owner}/{repo}/pulls/$pr/comments" --paginate --slurp > "$dir/comments.json" \
    || { printf 'ERROR: gh api failed for PR %s\n' "$pr"; exit 1; }
  node -e '
    const fs = require("fs");
    const [input, output, pr] = process.argv.slice(1);
    const pages = JSON.parse(fs.readFileSync(input, "utf8"));
    const comments = pages.flat().filter(c => c.in_reply_to_id == null);
    const lineOf = c => c.line ?? c.original_line ?? 0;
    comments.sort((a, b) => (a.path ?? "").localeCompare(b.path ?? "") || lineOf(a) - lineOf(b) || a.id - b.id);
    const findings = comments.map((c, i) => ({
      id: i + 1, commentId: c.id, path: c.path, line: c.line ?? c.original_line ?? null,
      title: c.body.split("\n")[0].slice(0, 120), body: c.body, author: c.user?.login, url: c.html_url,
    }));
    fs.writeFileSync(output, JSON.stringify(findings, null, 2));
    console.log(`FINDINGS: ${findings.length} top-level review comments on PR ${pr}`);
    for (const f of findings) console.log(`${f.id}\t${f.path}:${f.line}\t${f.title}`);
  ' "$dir/comments.json" "$dir/findings.json" "$pr"
}
gather_findings
```

### B — reply in a finding's thread, and resolve it

```sh
reply_finding() {
  pr='<pr>'; comment_id='<comment-id>'; body_file='<body-file>'; resolve='<resolve>'
  url=$(gh api -X POST "repos/{owner}/{repo}/pulls/$pr/comments/$comment_id/replies" -F body=@"$body_file" --jq .html_url) \
    || { printf 'ERROR: the reply to comment %s failed\n' "$comment_id"; exit 1; }
  printf 'REPLIED: %s\n' "$url"
  [ "$resolve" = "yes" ] || exit 0
  owner=$(gh repo view --json owner --jq .owner.login); repo=$(gh repo view --json name --jq .name)
  thread=$(gh api graphql -F owner="$owner" -F repo="$repo" -F pr="$pr" -f query='
    query($owner: String!, $repo: String!, $pr: Int!) {
      repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {
        reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }' \
    --jq ".data.repository.pullRequest.reviewThreads.nodes[] | select(.comments.nodes[0].databaseId == $comment_id) | .id")
  [ -n "$thread" ] || { printf 'ERROR: no review thread starts with comment %s\n' "$comment_id"; exit 1; }
  resolved=$(gh api graphql -F id="$thread" \
    -f query='mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }' \
    --jq '.data.resolveReviewThread.thread.isResolved')
  [ "$resolved" = "true" ] && printf 'RESOLVED: thread %s\n' "$thread" \
    || { printf 'ERROR: could not resolve thread %s\n' "$thread"; exit 1; }
}
reply_finding
```

### C — the summary comment

```sh
gh pr comment '<pr>' --body-file '<body-file>'
```
