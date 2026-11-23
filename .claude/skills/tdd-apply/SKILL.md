---
name: tdd-apply
description: Implement an OpenSpec change test-first. The main session plans and decides; a chapter runner per chapter orchestrates the test-writer and the implementer; a reviewer checks each chapter. Use instead of /opsx:apply.
argument-hint: <change-name> [review=acceptance|all] [checkpoint=continue|stop]
disable-model-invocation: true
---

# TDD apply: the main session

You are the main session of a test-first apply. You keep the plan, the gates and the owner's decisions, and
you delegate everything heavy, so that your context stays small for the whole change and never needs
compacting:

- **A chapter runner** (`chapter-runner` subagent), a fresh one per chapter, runs the chapter: it briefs the
  test-writer and the implementer, runs the tests, commits at every handoff and keeps the state file. Its
  definition holds the whole procedure (red, green, wiring, close, disputes).
- **A chapter reviewer** (`chapter-reviewer` subagent), a fresh one per chapter, reviews what the chapter
  added and has each finding checked by a verifier of its own.

Conventions: `docs/conventions/testing.md` § Test-first workflow, `docs/conventions/workflow.md` § 3.

## Rules for you

- **You read:** the change's `proposal.md`; `tasks.md` up to its first group, and its group headings (Grep
  `^## `); the state file by section (below); the hand-backs. For a question that goes to the owner, also the
  passage the hand-back names.
- **You never read** code, tests, diffs or test output, and never `design.md` or a spec as a whole. You run no
  build and no test. You do not judge whether code is good: the reviewer does, and the runner verifies every
  agent's report by running the tests itself.
- **You edit only:** the spec or `design.md` passage that a dispute or a review finding the owner resolved
  needs, and a docs finding under `openspec/`. The state file changes only through `tdd` (below).
- **You commit only** through `tdd commit`, and only what you edited yourself (staged by `--path`), on the
  change branch. Never push, never commit on `main`, never open a PR.
- **One worker in the working tree at a time.** Never start a runner or a reviewer while another runner is
  working. The next chapter starts only when this chapter's review and its fixes are done.
- **You wait by ending your turn.** After you start or resume a runner or a reviewer, tell the owner in a
  line what is running, and stop there. Its hand-back arrives as a message and starts your next turn. Waiting
  needs no tool: do not look for one.
- **Go by the hand-back, not by the notice.** A "finished" notice can come late or without the hand-back: if
  only a notice came, end your turn again.
- **A report from a test-writer or an implementer can reach you directly,** after its runner has finished
  (the agent is woken once more when a command it left in the background ends). It repeats what the runner
  handed back: do nothing with it.
- **Whatever the settings, the apply stops** at the acceptance gate (§ 2), for a hand-back that needs the
  owner, and for review findings that need the owner (§ 4).
- Never put real bank data or secrets into anything you send, commit or record.

## Arguments

`$ARGUMENTS`

- First: the change name (a folder under `openspec/changes/`). If missing, list the active changes and ask.
- `review=` (default `acceptance`; on a resume the recorded mode): `acceptance` stops at the acceptance gate
  only; `all` also stops after the test-writer finishes each unit and each integration group.
- `checkpoint=` (default `continue`; on a resume the recorded mode): `continue` starts the next chapter as
  soon as a chapter's review and fixes are done; `stop` reports each chapter and waits for the owner.

## Your commands

`tdd` stands for `node .claude/skills/tdd-apply/scripts/tdd.mjs`, run from the repository root. The command
comes first, then always `--change <change>`. Each call prints a line or two.

- `tdd init --review <mode> --checkpoint <mode> [--issue <n>]`: creates the state file
  `openspec/changes/<change>/.tdd-state.md` and indexes the code graph.
- `tdd get --section "<name>" [--section …]`: one or more sections. The state file's sections: Resume here,
  Run, Chapter plan, Agents, Standing rules, What the code holds now, Baseline, Acceptance tests, Open, Design
  files. Never Read the file as a whole.
- `tdd set --section "<name>" --text "<text>"` (`\n` is a new line), `tdd add --section "<name>" --line
  "<text>"`, `tdd put --section "<name>" --key "<key>" --value "<value>"`.
- With `--file reviews` the same three write to `openspec/changes/<change>/.chapter-reviews.md`, the record
  of every chapter's findings and what became of them.
- `tdd commit --type docs --tag <plan|chapter|chapter-review> --summary "<text>" --path <file> [--path …]`.

In a text you pass (`--text`, `--line`, `--value`, `--summary`, `--resume`), `\n` is a new line: write paths
with forward slashes, and never start a text with `/` (Git Bash would turn it into a path).

The state file holds state only: what a new session needs to continue. The commits are the history.

## 0. Start, or resume

**A change already under way** (its state file exists and `Run` says `Status: applying`): read
`tdd get --section "Resume here" --section Run --section Agents --section Open`, do steps 2, 4 and 5 below
as they say for a resume, and start a fresh runner (§ 1) where "Resume here" says, telling it where the
chapter stands. Do not count on the agents of an earlier session that the Agents section lists: start fresh
ones (for a fix round of an earlier chapter, a fresh runner with that chapter's brief). A `review=` or
`checkpoint=` given now wins over the recorded mode (`tdd put --section Run`).

1. Read `proposal.md`, and `tasks.md` up to its first group plus its group headings.
2. Check that you are on the change's branch (not `main`), and look at `git status --porcelain`. At a start
   it must be empty. On a resume, the state file and `.chapter-reviews.md` may be changed (bookkeeping, which
   the next commit takes along), and work that "Resume here" names as uncommitted goes into the runner's
   brief as `TREE:`. Anything else: stop and ask the owner.
3. `tdd init` with the two modes and the change's GitHub issue, if `proposal.md` or `tasks.md` names one.
4. Record the attribution lines your context gives you for commits, so every commit carries them:
   `tdd put --section Run --key "Commit trailers" --value "<line 1>\n<line 2>"`.
5. If the change builds or changes UI, `design.md` names the design-system parts and the Screens design
   artboards it implements (Grep it for them; `docs/conventions/workflow.md` § 8 has the links). The subagents
   cannot open Claude artifacts: fetch the named files with the Artifact tool (`action: read` with `paths`, so
   they are saved and not printed) and record the saved paths: `tdd set --section "Design files"`. They live
   in a session's scratchpad. On a resume, first check that the recorded files are still there
   (`tdd get --section "Design files"`, then list its base folders), and fetch again only when they are gone.
6. Start the acceptance chapter (§ 1). Its runner validates the change, runs the baseline and the bootstrap,
   and has the acceptance tests written.

## 1. Run a chapter

1. Start a `chapter-runner` with the Agent tool. The brief, and nothing more:

   ```
   CHANGE: <change>
   CHAPTER: <name>: <its groups or slices>
   MODE: review=<acceptance|all>
   START AT: <the chapter's first group, or the group and step "Resume here" names>
   TREE: clean | <what is uncommitted, when resuming mid-chapter>
   ```

2. Record it: `tdd put --section Agents --key "<chapter> runner" --value "<agent id>"`. The runner expects
   this one change in the tree.
3. Wait for its hand-back: end your turn.
4. Each notice that the runner stopped ends with `<usage><subagent_tokens>N…`: its context size. Past
   **200,000** with the chapter not done, resume it with `END THE CHAPTER after the slice in progress.` The
   rest of the chapter becomes a new chapter with a fresh runner (the rest of B is B2): update the plan with
   `tdd set --section "Chapter plan"`.
5. Act on the hand-back's `RESULT`:
   - `GATE_READY`: § 2.
   - `REVIEW_STOP`: show the owner the group's tests (names, files, the commit) and wait. Resume the runner
     with the owner's feedback, or with `CONTINUE`.
   - `NEEDS_OWNER`: put the question to the owner as the runner gives it (both sides, the passage, its
     recommendation) with your own recommendation, and wait. Then record the answer:
     - if it settles what the spec or `design.md` should say, edit that passage and commit it:
       `tdd commit --type docs --tag plan --summary "<what changed>" --path <file>`;
     - `tdd add --section "Standing rules" --line "<date>, the owner: <the decision>"`;
     - resume the runner with `ANSWER: <the decision>` and the commit, if there is one.
   - `BLOCKED`: tell the owner what stopped the runner, and wait. One case is yours to clear: a command an
     agent left running and could not stop (the hand-back names the task's id). Stop it with TaskStop (load
     it with ToolSearch, `select:TaskStop`), tell the owner in a line, and resume the runner with `CONTINUE`.
   - `CHAPTER_DONE` or `CHAPTER_ENDED_EARLY`: § 3 (the acceptance chapter: start chapter A).
   - `FIX_ROUND_DONE`: back in § 4, step 4.

## 2. The acceptance gate (always)

1. Have the tests reviewed before the owner reads them: § 3, with the range `the working tree`.
2. Present, and print no diff:
   - the list scenario → test, as the runner gives it;
   - the paths to read (the owner reads the tests in the working tree);
   - what the test-writer flagged;
   - the reviewer's findings with their verdicts;
   - the chapter plan.
   End your turn and wait.
3. Change requests (the owner's own, and the findings the owner wants fixed): resume the runner with
   `CHANGE REQUESTS:` and the list. When `GATE_READY` comes back, present what changed.
4. Approval: resume the runner with `APPROVED` and the agreed chapter plan. It commits the tests (`[accept]`)
   and hands back `CHAPTER_DONE`. Record each of the review's findings and its outcome (§ 3 step 3).

## 3. Review the chapter

After every chapter's `CHAPTER_DONE` (the acceptance chapter: at its gate, § 2):

1. Start a `chapter-reviewer` with the Agent tool. The brief, and nothing more:

   ```
   CHANGE: <change>
   CHAPTER: <name>: <its groups or slices>
   RANGE: <the runner's RANGE, or "the working tree">
   LATER: <one line per later chapter of the plan: its name and what it adds; "none" after the last>
   ```

2. Wait for its hand-back: end your turn. It holds every finding with a verifier's verdict.
3. Route each finding (§ 4, step 1) and record it:
   `tdd put --file reviews --section "Chapter <X>" --key "<id>" --value "<severity> · <verdict> · <file:line> · <the defect in a few words> → <FIX|DECLINE|ASK>"`.

## 4. Act on the findings

1. **Route,** by these rules in this order:
   - `refuted` with concrete evidence (a file:line, a test, a decision, a later task group), and the
     reviewer does not disagree → **DECLINE**. Nothing more is done.
   - `unsure`; or the reviewer disagrees with the verifier; or `refuted` without concrete evidence → **ASK**.
   - `confirmed`, and its fix changes behaviour a spec describes, or changes the API contract, or is not
     local, or is large, or the finding is outside the chapter → **ASK**.
   - every other `confirmed` finding → **FIX**.
2. Show the owner the routing in one table (id · severity · the finding · outcome · the reason in a few
   words). Do not wait: FIX and DECLINE are this skill's job.
3. **Fix round.** Resume the chapter's own runner with `FIX ROUND:` and each FIX finding as the reviewer
   wrote it (its id line and the lines under it). If that runner is past 200,000 tokens, start a fresh one
   with the chapter's brief and the same message. Wait for `FIX_ROUND_DONE`.
4. From its `FINDINGS:` lines: a finding refuted by its guard test is a DECLINE with that test as the
   evidence. A docs finding under `openspec/` that came back is yours: read the passage, fix it, and commit
   `tdd commit --type docs --tag chapter-review --summary "<id>: <summary>" --path <file>`. A finding handed
   back for the owner joins the asks.
5. **Ask round,** after the fix round: an overview, then one finding at a time: the finding, the verifier's
   evidence, the trade-off and your recommendation. The owner answers fix now, decline (with their reason) or
   defer (a GitHub issue, or a heads-up in the design of the step it belongs to).
   - Fix now: a spec or contract change is first written into the spec or `design.md` and committed with the
     tag `plan`; then another `FIX ROUND:` to the runner.
   - Defer to an issue: show the owner the issue's text and create it only on their word.
   - Record each answer: `tdd put --file reviews …` with the outcome.
6. Commit the reviews file when you changed it after the runner's last commit:
   `tdd commit --type docs --tag chapter-review --summary "chapter <X>: the review's record" --path <the reviews file>`.
7. Then, as `checkpoint=` says: `stop` reports the chapter (its commits, the suite's totals, the findings by
   outcome, the agents' context sizes) and waits; `continue` reports it in a few lines and starts the next
   chapter (§ 1).

## 5. The end of the apply

After the last chapter's review and fixes:

1. `tdd put --section Run --key Status --value done`, set "Resume here" to say that the apply is done and
   what the owner's next steps are, and commit the state file with the tag `chapter`.
2. Report to the owner: the chapters and their commits; the suite's totals from the last hand-back; disputes
   and how they were settled; every change to a spec or `design.md`; the review findings by outcome, with the
   ones still open or deferred; and that the next steps are the owner's: push and a draft PR, `/code-review`,
   `/triage-review`, `/opsx:archive`.

## If your context was compacted

This skill is attached again, and a hook adds "Resume here", "Agents" and "Open" from the state file. That is
all you need: read nothing again until a step asks for it. A runner or a reviewer that was working is still
working, so end your turn and wait for its hand-back.
