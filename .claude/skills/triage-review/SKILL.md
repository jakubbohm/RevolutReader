---
name: triage-review
description: Triage and fix the findings of a code review on a pull request, after /code-review. Verifies every finding read-only (a saved workflow, an investigator and a skeptic per finding), fixes the confirmed local ones test-first through the test-writer and implementer with a commit per handoff, declines the refuted ones in their PR threads with evidence, and brings the rest to the owner one at a time. Use when the owner invokes /triage-review or asks to work through a review's findings on a PR.
argument-hint: <PR number> [source=pr|chat]
disable-model-invocation: true
---

# Review triage orchestrator

You are the orchestrator. You do not write tests or production code yourself. You gather the findings, run
the verification workflow, check its evidence, delegate the fixes, verify every step, decide nothing the owner
should decide, and record everything in the PR. Three workers do the rest:

- the saved workflow **`triage-review-verify`** (`.claude/workflows/triage-review-verify.js`): verifies every
  finding read-only and routes it;
- **the test-writer** (`test-writer` subagent): writes the failing guard test that reproduces a finding;
  fixes test-quality findings;
- **the implementer** (`implementer` subagent): makes a guard test pass; fixes docs and cleanup findings outside
  `openspec/`. Never edits tests.

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
   this is a Direct PR: the scope is its roadmap step in lower case (`c13`) or, for work that lives only in a
   GitHub issue, `i` and the issue number (`i67`; workflow.md § 3). The intent is the issue the PR closes or is
   part of (`gh issue view <n> --json title,body`, saved to the work folder), plus the step's section in
   `pm/roadmap.md` when it has one.
3. The round: 1, or later when `/code-review` ran again on the PR after an earlier triage. Each triage leaves one
   summary comment headed `## Review triage` (§ 5 step 3); the round is their count plus one:
   `gh pr view <PR> --json comments --jq '[.comments[].body | select(startswith("## Review triage"))] | length'`.
   Work folder: `<scratchpad>/triage-review/<PR>/` in round 1, `<scratchpad>/triage-review/<PR>-r<n>/` in round
   n; absolute path, forward slashes. State file: `openspec/changes/<change>/.review-triage.md` (in the archive
   folder when the change is archived), where a later round adds a section `## Round <n>` at the end and leaves
   the earlier rounds' text as it is; for a Direct PR `<work folder>/state.md`, outside the repository and never
   committed: a Direct PR has no change folder, and its summary comments, threads and `[review]` commits are the
   record that outlives the session. It holds: the round, the PR, the scope, the findings source, the routing per
   finding, the commits per finding, the asks and the owner's answers, the test-writer's and the implementer's
   agent IDs.
   **Write the agent IDs there as soon as you spawn or resume an agent.** After a compaction, re-read it before
   doing anything else.
4. Index the working tree in the code graph (codebase-memory-mcp; load its tools with ToolSearch first if they
   are deferred): `index_repository` with its absolute path. Write the project's name into the state file. You
   index it again after every commit (Rules for you). Why, and how the project is named:
   `.claude/skills/tdd-apply/SKILL.md` § 0 step 9 and `CLAUDE.md` § Code navigation.
5. The test-writer and the implementer: read `.tdd-state.md` in the change's folder (step 2) for their IDs (the
   current pair, the last chapter's; in a later round, the pair the last round's state file records, when it is
   at hand: a Direct PR's only in the session that wrote it, step 3) and resume them with SendMessage; your first
   message to each names the code graph's project (step 4), so neither relies on the one the apply gave it. If one
   cannot be resumed, or no file records a pair, spawn a fresh one when it is first needed and brief it: the
   change, the PR, that this is the review triage, the code graph's project and the finding at hand. Without the
   last round's state file, its open asks come back as open threads (§ 1) and its routing is in its summary
   comment (§ 5 step 3).
6. Baseline: run the full suite once (`dotnet test` and the frontend tests). Record it. If anything is red, stop
   and report: no triage on a red baseline.
7. The diff: `git fetch origin <baseRef>` then `git diff origin/<baseRef>...HEAD > <work folder>/diff.patch`.
8. Create a task list with one item per step; add one item per finding after § 1.

## 1. Gather

**`source=pr`:** run `node .claude/skills/triage-review/scripts/gather-findings.mjs <PR> <work folder>`
(§ Scripts). It writes `findings.json`, one element per open finding: a top-level review comment whose thread is
not resolved, ordered by file and line. It prints the count, how many it left out, and the list. A resolved
thread is left out, whether an earlier round resolved it or the owner did by hand; to bring one back, the owner
unresolves it. The ids number the PR's top-level comments in the order they were posted, so a later round's new
findings continue after the earlier rounds' numbers, a thread left open keeps its number, and every
`[review] <id>:` commit stays unique within the PR. Zero findings and `source` not forced: say so and switch to
`chat`.

**`source=chat`:** write `findings.json` yourself from the review's reply in this conversation:

```json
[{ "id": 1, "path": "<file>", "line": 0, "title": "<one line>", "body": "<the finding verbatim: the claim and the failure scenario>", "commentId": null }]
```

Keep every finding in the review's order; never drop or merge one. Number them from 1, or in a later round from
one past the highest number the earlier rounds used (their summary comments list them).

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
  1. Send the test-writer the finding (its body, file:line, the investigation's evidence and sketch) and the
     change's `design.md` and delta specs (a Direct PR: its issue, § 0 step 2). Ask for **one guard test that
     reproduces it**, at the level `testing.md` § Where tests live gives it: a unit test next to the rule, an
     integration edge test for an adapter, a frontend test for browser behaviour. **Never a new acceptance
     scenario:** that is a spec change and an ASK. The test-writer edits only test files, the DSL and the
     drivers the test needs.
  2. Verify red yourself: the build passes; the new test fails at runtime, not at compile time; everything else is
     still green. Commit `test(<scope>): [review] <id>: <summary>, red`.
     **A guard test that passes at once refutes the finding:** keep it, commit
     `test(<scope>): [review] <id>: guard, passes`, and move the finding to DECLINE with the test as its evidence.
  3. Send the implementer the test (file and test name), the finding and the sketch (a Direct PR: also its
     issue); the implementer must not change any test file. Verify green yourself: the full suite passes, and
     `git status --porcelain --untracked-files=all` (every new file by its own path) and `git diff --name-only HEAD`
     list nothing under `tests/`, `*Tests*/`, `*.test.ts(x)`, `*.spec.ts(x)`, `*.test.mjs` or `openspec/` other
     than your state file (§ 0 step 3). A violation: restore the file (`git restore --source=HEAD -- <path>`;
     delete a new one), tell the implementer, resume it. Commit `fix(<scope>): [review] <id>: <summary>`.
  4. The implementer returns `STATUS: BLOCKED` (the test looks wrong): do not judge it alone. Move the finding
     to ASK with the test-writer's test, the implementer's claim and the evidence.
- **test-quality:** The test-writer alone fixes the test. Verify the suite is green. Commit
  `test(<scope>): [review] <id>: <summary>`.
- **docs** or **cleanup:** The implementer alone; verify green as in step 3 of a behaviour fix. A docs finding
  under `openspec/` is yours instead, because the implementer cannot write there: fix it and run the full
  suite. Commit `docs(<scope>): [review] <id>: <summary>` or `refactor(<scope>): [review] <id>: <summary>`.

After each commit: tick the finding and note the commit in the state file. Only one of the test-writer and the
implementer works at a time; never build or test while one of them is working.

## 4. Ask round

1. Overview first: one table of the ASK findings (id · title · why it is asked · your recommendation).
2. Then one finding at a time (the owner's standing preference, memory `decisions-one-by-one`): the finding in two
   or three sentences, both sides when the verdict was disputed, the trade-off, your recommendation, and the
   choice: **fix now** · **decline** (the owner gives the reason) · **defer**. Use AskUserQuestion with these
   options; a free-text answer is the owner's own words, re-confirm it when it matters.
3. Act on each answer before the next question:
   - **fix now** → § 3 as a FIX. A spec change first gets its spec or `design.md` edit, which you make yourself
     and commit as `docs(<scope>): [plan] <what changed>`; the acceptance test change then goes to the
     test-writer;
   - **decline** → DECLINE, with the owner's reason as the evidence;
   - **defer** → the owner says where: a GitHub issue (`gh issue create`: the finding and the step it belongs to;
     the issue linked in the thread), or a heads-up you write in the `design.md` of the step it belongs to,
     committed `docs(<scope>): [review] <id>: heads-up for <step>`.
4. Record every answer in the state file.

## 5. Close

1. Full suite and checks: `dotnet test`, the frontend tests, `dotnet format whitespace RevolutReader.slnx
   --verify-no-changes`, the frontend `run lint`, `run typecheck` and `run format:check`; `az bicep lint --file
   infra/main.bicep` if `infra/` changed; the triage scripts' tests (`CLAUDE.md` § Commands) if
   `.claude/skills/triage-review/scripts/` changed; the API-client drift check if any endpoint changed (it should
   not have: that is an ASK).
2. Threads (`source=pr`): for every finding with a `commentId`, write the reply to a file in the work folder and
   post it with `reply-finding.mjs` (§ Scripts): FIX → "Fixed in `<sha>`: <summary>; guard test `<name>`";
   DECLINE → "Declined: <evidence>"; the owner's decline → "Declined by the owner: <reason>"; deferred → "Deferred
   to <issue or step>". Resolve the FIX, DECLINE and deferred threads (`yes`); leave an undecided ASK's thread
   open (`no`).
3. One summary comment on the PR, `gh pr comment <PR> --body-file <file>`: first the heading `## Review triage`
   (in a later round `## Review triage, round <n>`: § 0 step 3 counts these headings), then the table
   `# · Finding · Outcome · Evidence or commit`, the counts, and the checks run, as PR #26's description has it.
   Never bank data, secrets or personal data in a thread or the summary: the repository is public.
4. Commit `docs(<scope>): [review] triage summary`: a change's state file with any close-out docs the round
   changed (e.g. a memory file). A Direct PR's state file stays in the work folder (§ 0 step 3), so its commit takes
   only the close-out docs, and is skipped when there are none. Never push, never open a PR or mark one ready: the
   owner does.
5. Report to the owner: the counts per outcome, the commits, what stays open, and the fix range
   `<first sha>..<last sha>` in case they want another `/code-review` on it, which a next round then triages.

## Rules for you (the orchestrator)

- Never edit tests or production code yourself. The only files you edit are the state file, the findings file,
  the close-out docs and the files under `openspec/` that a docs finding (§ 3), a spec change the owner wants
  fixed now or a heads-up (§ 4) needs. Restoring or deleting a file the implementer was not allowed to touch
  (§ 3) is the one exception.
- Verify before trusting: the workflow's evidence, the test-writer's red, the implementer's green. Never start a
  build or a test run while the test-writer or the implementer works. The workflow's agents never build or
  run tests (its prompts forbid it).
- Commit only on the PR's branch, at the handoffs above, with the `[review]` tag and the finding number. Never
  push, never commit on `main`.
- After every commit, run `index_repository` on the working tree (§ 0 step 4) before your next message to the
  test-writer or the implementer.
- The test-writer and the implementer run at the effort their definitions set, high and medium
  (`docs/software-factory/lessons.md` R-71). A level passed at spawn overrides it and holds across resumes, so a
  pair resumed from the apply keeps any level its last chapter was given (`.tdd-state.md` records it). Pass the
  Agent tool's `effort` only when the owner asks for another level, and record that in the state file.
- Do not use `isolation: "worktree"` for the test-writer or the implementer: one working tree, as in `/tdd-apply`.
- Never put bank data or secrets into anything you send, commit, post or record.
- Run the scripts as they are (§ Scripts), each as one Bash tool call; never rewrite, inline or translate one to
  PowerShell. A script that prints `ERROR:` says what failed: fix that cause (e.g. `gh` not logged in) or stop
  and report, never work around the script.

## Scripts

Two Node scripts in `.claude/skills/triage-review/scripts/`, run from the repository root as
`node .claude/skills/triage-review/scripts/<script> <arguments>`; `common.mjs` beside them holds what both use (the
`gh` calls, the PR's review threads, the numbering). Both need `gh` logged in to the repository's GitHub account.
They are files, not shell blocks in this text, because a session isolated in a worktree refuses a multi-line block
it cannot verify (`docs/software-factory/lessons.md` R-37). Each file's header has the details. Their pure parts
have tests beside them (`*.test.mjs`, Node's own runner, never calling `gh`; the command is in `CLAUDE.md`
§ Commands), which CI runs (R-98).

- **`gather-findings.mjs <pr> <work-folder>`** (§ 1): reads the PR's review comments and threads, and writes
  `comments.json` (the API's pages as they came) and `findings.json` (the open findings, numbered and ordered as
  § 1 says) into the work folder. Prints `FINDINGS: <n> open …`, `LEFT OUT: <n> in resolved threads` and one
  line per finding.
- **`reply-finding.mjs <pr> <comment-id> <body-file> <yes|no> [--dry-run]`** (§ 5 step 2): posts the body file
  as a reply in the thread the comment starts and, with `yes`, resolves that thread. It checks first that the
  comment is a top-level review comment on the PR and, with `yes`, that its thread exists, so a failed check posts
  nothing; a thread already resolved stays resolved. Prints `REPLIED: <url>` and `RESOLVED: thread <id>`.
  `--dry-run` makes the same checks and prints what it would post, without posting.
