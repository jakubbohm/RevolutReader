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
- `source=` says where the review's findings are (default `pr`): `pr` reads the PR's review threads, which is what
  `/code-review --comment` posts, and also takes a review in this conversation whose findings are not on the PR;
  `chat` says the findings are in the review's reply in this conversation. Findings from the conversation are
  posted to the PR first, so every finding is a thread (§ 1).

## Outcomes

| Outcome | When | What happens |
|---|---|---|
| **FIX** | verified real; the fix is local (only files the PR touches or the finding names; no new dependency, setting, Bicep change, API contract change or spec change) and not large | § 3: the guard test, then the fix, one `[review]` commit each; the thread gets the commit and is resolved |
| **DECLINE** | verified not real, with concrete evidence you checked yourself | the thread gets the evidence and is resolved |
| **ASK** | everything else: a disputed verdict, unclear, a spec change, a contract change, a fix outside the PR's files, a large fix, an implementer dispute, a finding the workflow returned no result for | § 4: the owner decides fix, decline or defer (an implementer dispute at once, § 3 step 4); the thread gets the decision |

When unsure, ASK. Never decline on the review's word, on the workflow's word or on your own impression: only with
evidence at a file:line, a test name or a recorded decision that you opened.

## Replies

Each finding's thread gets its reply, and is resolved, as soon as the finding is handled, never saved up for the
close: the threads are then the complete record of a round that stops part-way, also for a Direct PR, whose state
file is lost with its session, and a rerun takes their outcomes back (§ 1, "After an interrupted round"). Write the
reply to a file in the work folder and post it in the thread of the finding's `commentId` with `reply-finding.mjs`
(§ Scripts), with `yes`, which resolves the thread; then note it in the state file.

- FIX → "Fixed in `<sha>`: <summary>; guard test `<name>`", right after the finding's last commit (§ 3);
- DECLINE → "Declined: <evidence>", right after you checked its evidence (§ 2 step 1), or for a guard test that
  passes at once, right after its `guard, passes` commit (§ 3 step 2);
- the owner's decline → "Declined by the owner: <reason>", right after the answer (§ 4 step 3);
- deferred → "Deferred to <issue or step>", right after the issue or the heads-up commit exists (§ 4 step 3).

An ASK still undecided at the close gets its reply then, with `no`, and its thread stays open (§ 5 step 2).

## 0. Prepare

1. `gh pr view <PR> --json number,title,state,isDraft,headRefName,headRefOid,baseRefName,url,body`. The current
   branch must be the PR's head branch and the working tree clean: `git status --porcelain` empty, or listing only
   the change's own state file (step 3), which an interrupted round leaves untracked or modified. HEAD must be
   the PR's head commit (`git rev-parse HEAD` equal to `headRefOid`) or, on a rerun of an interrupted round (§ 1,
   "After an interrupted round"), that commit followed only by this round's own `[review] <id>:` and `[plan] <id>:`
   commits (§ 4 step 3), those numbered above the highest number the earlier rounds' summary comments list (`git log
   --oneline <headRefOid>..HEAD`). Anything else, such as an earlier round's unpushed commits, means the review saw
   other code than the working tree, and pushing is the owner's go. Otherwise stop and ask. Never work on `main`.
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
   finding, the commits and the reply per finding, the asks and the owner's answers, the test-writer's and the
   implementer's agent IDs.
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
   and report: no triage on a red baseline. The one exception is a rerun of a round that stopped between a
   finding's guard test and its fix (§ 1, "After an interrupted round"): exactly the tests added by this round's
   `test(<scope>): [review] <id>: <summary>, red` commits that have no `fix(<scope>): [review] <id>:` commit yet
   may fail, and nothing else.
7. The diff: `git fetch origin <baseRef>` then `git diff origin/<baseRef>...HEAD > <work folder>/diff.patch`.
8. Create a task list with one item per step; add one item per finding after § 1.

## 1. Gather

The findings live in the PR's review threads, one per top-level review comment, which is what `/code-review
--comment` posts.

**A review only in this conversation:** when this conversation holds a `/code-review` reply whose findings are not
on the PR (it ran without `--comment`), or `source=chat` is given, post its findings to the PR first, whatever
threads an earlier round left open (`source=chat` with no review in this conversation: say so and ask the owner
where the findings are; never guess). Each then gets a thread, a number and a reply like any other finding:

1. Write them to `<work folder>/chat-findings.json`, in the review's order; never drop or merge one:

   ```json
   [{ "path": "<file>", "line": 42, "body": "<the finding verbatim>" }]
   ```

   `body` is the finding verbatim: its first line the severity and a one-line summary, as `/code-review --comment`
   writes them, then the failure scenario, except for a reference the script refuses because it would post a
   backlink outside this repository: rewrite it as the refusal says (§ Scripts). `line` is the line in the PR's new
   version, or `null` for the whole file. A finding on a file the PR does not change goes on the changed file it
   concerns.
2. Run `node .claude/skills/triage-review/scripts/post-findings.mjs <PR> <work folder>/chat-findings.json
   --dry-run` (§ Scripts) and check the plan it prints, one line per finding: on its line when the line is in the
   PR's diff, else on its file. A finding that does not land on its real place, because it moved to another file
   or its line is outside the diff, names that place (`<file>:<line>`) in its body, below the first line, which the
   gather takes as its title. Correct the file and run the dry run again until the plan is right.
3. Run it without `--dry-run`. It posts in the review's order and skips a finding this round already posted (a
   comment with the same text, posted after the PR's last summary comment), so after a failure part-way, running
   it again posts only the rest; the round has no commit yet, so its head check still passes. An earlier round's
   comment with the same text does not count: that round closed it, so the new report gets a thread of its own.

**The open threads:** run `node .claude/skills/triage-review/scripts/gather-findings.mjs <PR> <work folder>`
(§ Scripts). It writes `findings.json`, one element per open finding: a top-level review comment whose thread is
not resolved, ordered by file and line. It prints the count, how many it left out, and the list. A resolved
thread is left out, whether an earlier round resolved it or the owner did by hand; to bring one back, the owner
unresolves it. The ids number the PR's top-level comments in the order they were posted, the ones posted from
this conversation included, so a later round's new findings continue after the earlier rounds' numbers, a thread
left open keeps its number, and every `[review] <id>:` commit stays unique within the PR. Posted means submitted:
the order is when each comment's review was submitted, so a review drafted early and submitted late still comes
after the earlier rounds' numbers, and a comment of a pending review is left out until its review is submitted.

**After an interrupted round:** § 0 step 3 counts only posted summaries, so a rerun of a round that stopped before
its summary already has the right number. Every finding the round handled before it stopped has its reply and a
resolved thread (§ Replies). A left-out number above the highest number the earlier rounds' summary comments list
(in round 1: any left-out number) was closed after the last summary, so by this round before it stopped. When its
thread's reply gives the outcome ("Fixed in", "Declined", "Deferred"), take it back into this round's findings
table and summary with that outcome and its `[review] <id>:` and `[plan] <id>:` commits (a finding fixed now after
a spec change has a `[plan] <id>:` commit too, § 4 step 3), and neither triage it again nor reply to it a second
time (§ 5 step 2). A thread without such a reply was resolved by hand: ask the owner whether to triage it (they
unresolve it) or leave it. An open thread whose number has commits in `<headRefOid>..HEAD` (§ 0 step 1 lets only
this round's through) is not verified again but resumes where its commits stop: after a `[plan] <id>:` commit, the
owner chose fix now, so at § 3 step 1, the test-writer; after a `…, red` commit, at § 3 step 3, the implementer
(§ 0 step 6 lets that test fail); after any other, the finding was handled and only its reply is owed: post it
(§ Replies; after a `guard removed` commit, its text from that commit's body, § 3 step 4) and take it back as
above. Only the other open threads go to § 2; with none, go on to § 3 with the resumed findings, or to § 5 when
there are none either. A change's state file is in the repository and says the same in any session; a Direct
PR's lives only in the session that wrote it, so in a new one the threads and commits are the record (§ 0 step 3).

With no open thread, no finding taken back and no review in this conversation that is not on the PR, there is
nothing to triage: say so and stop. Otherwise write the findings table (id · file:line · title) into the state file.

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
   does not cover the finding, turns it into ASK; record why. Evidence that holds: reply and resolve its thread now
   (§ Replies).
2. **Check every FIX's shape:** the listed files are in the diff or the finding; no spec behaviour, no contract
   change. Anything off turns it into ASK.
3. Record the routing in the state file and show it to the owner in one table (id · title · outcome · one-line
   reason). Do not wait for an answer: FIX and DECLINE are this skill's job, and the DECLINEs are answered in
   their threads already (step 1); ASK is § 4. Continue with § 3.

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
     list nothing under `tests/`, `*Tests*/`, `*.test.*` and `*.spec.*` JavaScript and TypeScript files (e.g.
     `.ts(x)`, `.mjs`) or `openspec/` other than your state file (§ 0 step 3). A violation: restore the file
     (`git restore --source=HEAD -- <path>`; delete a new one), tell the implementer, resume it. Commit
     `fix(<scope>): [review] <id>: <summary>`.
  4. The implementer returns `STATUS: BLOCKED` (the test looks wrong): do not judge it alone, and do not go on to
     the next finding, since every later check of a green suite depends on that test. The finding is an ASK, asked
     at once:
     - Set the implementer's work aside: `git diff HEAD -- <paths> > <work folder>/blocked-<id>.patch` for the
       files it changed, and a copy of each new file under `<work folder>/blocked-<id>/` (the paths:
       `git status --porcelain --untracked-files=all`, except your state file). Then restore them (`git restore
       --source=HEAD -- <path>`; delete a new one) until `git status --porcelain` lists only your state file: the
       tree is the `red` commit again. Note the patch and the folder in the state file.
     - Put the finding to the owner as § 4 step 2 does, ahead of § 4's order: the test-writer's test, the
       implementer's claim, the evidence, both sides, whether the test stands, and your recommendation. The round
       waits for the answer; record it in the state file.
     - Act on it before the next finding. **Fix now:** the test first. A wrong test goes to the test-writer, and
       its change is verified as in step 2 and committed `test(<scope>): [review] <id>: <summary>, red`; for a test
       that stands, the implementer is told so. Then step 3: resume the implementer, which may start from the
       saved patch. **Decline** or **defer:** take the guard test out in a commit of its own, so the suite is green
       again: `git revert --no-commit <sha>` for each of the finding's `red` commits, newest first, committed
       `test(<scope>): [review] <id>: guard removed, declined` (or `deferred`; not git's own `Revert "…, red"`,
       which a rerun would read as a `red` commit, § 1). Its body is the thread's reply in full (§ Replies), with
       the owner's reason or where the finding is deferred, so a rerun that finds only this commit posts the reply
       from it (§ 1). A deferral to an issue therefore creates the issue first (§ 4 step 3), naming the test, its
       `red` commit and the claim, and the body gives its number; a heads-up, naming the same, comes after this
       commit in its own (§ 4 step 3). Then reply and resolve the thread (§ Replies).
- **test-quality:** The test-writer alone fixes the test. Verify the suite is green. Commit
  `test(<scope>): [review] <id>: <summary>`.
- **docs** or **cleanup:** The implementer alone; verify green as in step 3 of a behaviour fix. A docs finding
  under `openspec/` is yours instead, because the implementer cannot write there: fix it and run the full
  suite. Commit `docs(<scope>): [review] <id>: <summary>` or `refactor(<scope>): [review] <id>: <summary>`.

After each commit: tick the finding and note the commit in the state file. After a finding's last commit (its
`fix`, its `guard, passes`, or a test-quality, docs or cleanup fix's one commit), reply in its thread and resolve
it before the next finding (§ Replies). Only one of the test-writer and the implementer works at a time; never
build or test while one of them is working.

## 4. Ask round

1. Overview first: one table of the ASK findings not asked yet (id · title · why it is asked · your
   recommendation); a blocked fix was asked at once (§ 3 step 4).
2. Then one finding at a time (the owner's standing preference, memory `decisions-one-by-one`): the finding in two
   or three sentences, both sides when the verdict was disputed, the trade-off, your recommendation, and the
   choice: **fix now** · **decline** (the owner gives the reason) · **defer**. Use AskUserQuestion with these
   options; a free-text answer is the owner's own words, re-confirm it when it matters.
3. Act on each answer before the next question:
   - **fix now** → § 3 as a FIX. A spec change first gets its spec or `design.md` edit, which you make yourself
     and commit as `docs(<scope>): [plan] <id>: <what changed>` with only the files it changed, staged by path:
     any work in progress stays in the tree for § 3's checks. After the archive (a round that came after it
     anyway), the spec edit goes to the main spec in `openspec/specs/`, a `design.md` edit to the archived
     change's, and the archive folder stays where it is (workflow.md § 6). The acceptance test change then goes to
     the test-writer. Its thread gets its reply after its last commit, as in § 3;
   - **decline** → DECLINE, with the owner's reason as the evidence; reply and resolve its thread right away
     (§ Replies);
   - **defer** → the owner says where: a GitHub issue (`gh issue create`: the finding and the step it belongs to;
     the issue linked in the thread), or a heads-up you write in the `design.md` of the step it belongs to,
     committed `docs(<scope>): [review] <id>: heads-up for <step>`. Once the issue or the commit exists, reply and
     resolve its thread (§ Replies).
4. Record every answer in the state file.

## 5. Close

1. Full suite and checks: `dotnet test`, the frontend tests, `dotnet format whitespace RevolutReader.slnx
   --verify-no-changes`, the frontend `run lint`, `run typecheck` and `run format:check`; `az bicep lint --file
   infra/main.bicep` if `infra/` changed; the triage scripts' tests (`CLAUDE.md` § Commands) if
   `.claude/skills/triage-review/scripts/` changed; the API-client drift check if any endpoint changed (it should
   not have: that is an ASK).
2. Threads: the handled findings are answered already (§ Replies). Post the replies still owed, an undecided
   ASK's, with `no`, so its thread stays open. Then check the threads themselves, which outlive the session: run
   `gather-findings.mjs` again with `<work folder>/close` as its folder, so the round's `findings.json` stays as
   it is; of this round's findings, its open list must show exactly the undecided ASKs. Post the reply of any
   other that is still open. The findings § 1 took back after an interrupted round get no second reply: their
   threads already carry their outcome and stay resolved; they appear only in the summary (step 3).
3. One summary comment on the PR: write it to `<work folder>/summary.md` and post it with `node
   .claude/skills/triage-review/scripts/post-summary.mjs <PR> <work folder>/summary.md` (§ Scripts). First the
   heading `## Review triage` (in a later round `## Review triage, round <n>`: § 0 step 3 counts these headings),
   then the table `# · Finding · Outcome · Evidence or commit`, the counts, and the checks run, as PR #26's
   description has it. Never bank data, secrets or personal data in a thread or the summary: the repository is
   public.
4. Commit `docs(<scope>): [review] triage summary`: a change's state file with any close-out docs the round
   changed (e.g. a memory file). A Direct PR's state file stays in the work folder (§ 0 step 3), so its commit takes
   only the close-out docs, and is skipped when there are none. Never push, never open a PR or mark one ready: the
   owner does.
5. Report to the owner: the counts per outcome, the commits, what stays open, and the fix range
   `<first sha>..<last sha>` in case they want another `/code-review` on it, which a next round then triages; for a
   change, such a round comes before `/opsx:archive` (workflow.md § 6).

## Rules for you (the orchestrator)

- Never edit tests or production code yourself. The only files you edit are the state file, the chat findings
  file (§ 1), the reply and summary body files in the work folder (§ Replies, § 5 step 3), the close-out docs and
  the files under `openspec/` that a docs finding (§ 3), a spec change the owner wants fixed now or a heads-up
  (§ 4) needs. The exceptions: restoring or deleting a file the implementer was not allowed to touch (§ 3), and
  for a blocked fix, setting the implementer's work aside and, when the owner declines or defers the finding,
  reverting its guard test (§ 3 step 4).
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
  PowerShell, and never post a finding, a reply or the summary to the PR another way. A script that prints `ERROR:`
  says what failed: fix that cause (e.g. `gh` not logged in, a finding in `chat-findings.json` on a file the PR does
  not change, or a reference that would post a backlink, rewritten as the refusal says) or stop and report, never
  work around the script.

## Scripts

Four Node scripts in `.claude/skills/triage-review/scripts/`, run from the repository root as
`node .claude/skills/triage-review/scripts/<script> <arguments>`; `common.mjs` beside them holds what they share
(the `gh` calls, the PR's review threads, the numbering, the plan for posting findings, the backlink check). All
four need `gh` logged in to the repository's GitHub account. They are files, not shell blocks in this text, because
a session isolated in a worktree refuses a multi-line block it cannot verify (`docs/software-factory/lessons.md`
R-37). Each file's header has the details. Their pure parts have tests beside them (`*.test.mjs`, Node's own
runner, never calling `gh`; the command is in `CLAUDE.md` § Commands), which CI runs (R-103).

The three that post check every text before they post any, also in a dry run: a text that names another
repository's issue or pull request as `<owner>/<name>#<n>` or by a `github.com` link, or this repository's retired
pull request in any form GitHub links, would make GitHub post a backlink there that no edit or delete takes back
(R-102). They refuse it with `ERROR:`, naming each reference and how to rewrite it (a `https://redirect.github.com/…`
link, or words), and post nothing.

- **`post-findings.mjs <pr> <chat-findings-file> [--dry-run]`** (§ 1): posts a review's findings from this
  conversation as review comments on the PR, in the file's order: on the finding's line when the line is in the
  PR's diff, else on its file. It checks first that the local HEAD is the PR's head commit (else the line numbers
  would point at another version) and that every finding has a body, a file the PR changes and a line that is null
  or a line number, so a failed check lists every problem and posts nothing; a finding already posted as a
  top-level comment after the PR's last `## Review triage` summary (before the first: any) is skipped. Prints
  `POSTED: <n> <comment id> <url>` or `SKIPPED: <n> already posted as comment <id>` per finding. `--dry-run` makes
  the same checks and prints `WOULD POST: <n> <path>:<line>`, `WOULD POST: <n> <path> (file)` or `WOULD SKIP: …`,
  without posting.
- **`gather-findings.mjs <pr> <work-folder>`** (§ 1): reads the PR's review comments, reviews and threads, and
  writes `comments.json` (the API's pages as they came) and `findings.json` (the open findings, numbered and
  ordered as § 1 says) into the work folder. Prints `FINDINGS: <n> open …`, `LEFT OUT: <n> in resolved threads:
  <numbers>` (the left-out numbers as ranges, e.g. `1-15`; none: no colon) and one line per finding. A top-level
  comment whose review is not among the PR's reviews fails it with `ERROR:` rather than take a guessed number.
- **`reply-finding.mjs <pr> <comment-id> <body-file> <yes|no> [--dry-run]`** (§ Replies): posts the body file
  as a reply in the thread the comment starts and, with `yes`, resolves that thread. It checks first that the
  comment is a top-level review comment on the PR and, with `yes`, that its thread exists, so a failed check posts
  nothing; a thread already resolved stays resolved. Prints `REPLIED: <url>` and `RESOLVED: thread <id>`.
  `--dry-run` makes the same checks and prints what it would post, without posting.
- **`post-summary.mjs <pr> <body-file> [--dry-run]`** (§ 5 step 3): posts the body file as the round's summary
  comment on the PR. It checks first that the body starts with `## Review triage`, the heading § 0 step 3 counts
  the rounds by, that the number is a PR, and that no comment on it has the body's first line yet (a summary of this
  round already posted, whose address it names), so a failed check posts nothing. Prints `POSTED: <url>`. `--dry-run`
  makes the same checks and prints `WOULD POST: summary on PR <pr>, <n> characters: <first line>`, without posting.
