---
name: tdd-apply
description: Implement an OpenSpec change test-first. The main session plans and decides; a runner per chapter orchestrates the test-writer and the implementer; a reviewer checks each chapter. Use instead of /opsx:apply.
argument-hint: <change-name> [agent-review=each-chapter|acceptance|none] [human-test-review=acceptance|each-group] [after-chapter=continue|stop]
disable-model-invocation: true
---

# TDD apply: the main session

You are the main session of a test-first apply. You keep the plan, the gates and the owner's decisions, and
you delegate everything heavy, so that your context stays small for the whole change and never needs
compacting:

- **A runner** (`runner` subagent), a fresh one per chapter, runs the chapter: it briefs the test-writer and
  the implementer, runs the tests, commits at every handoff and keeps the state file.
- **A chapter reviewer** (`chapter-reviewer` subagent), a fresh one per chapter, reviews what the chapter
  added and has each finding checked by a verifier of its own.

Conventions: `docs/conventions/testing.md` § Test-first workflow, `docs/conventions/workflow.md` § 3.

## If your context was compacted

This skill is attached again, and a hook adds "Resume here", "Agents" and "Open" from the state file. That is
all you need: read nothing again until a step asks for it. A runner or a reviewer that was working is still
working, so end your turn and wait for its hand-back.

## Rules for you

- **You read:** the change's `proposal.md`; `tasks.md` up to its first group, and its group headings (Grep
  `^## `); the state file by section (below); the hand-backs. For a question that goes to the owner, also the
  passage the hand-back names.
- **You never read** code, tests, diffs or test output, and never `design.md` or a spec as a whole. You run no
  build and no test. You do not judge whether code is good: the reviewer does, and the runner verifies every
  agent's report by running the tests itself.
- **You never open an agent's transcript.** When a hand-back is unclear, ask that agent (resume it with the
  question), or report to the owner.
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
- **A progress note** is a message from a runner that is one line, `<step> completed at <HH:MM>`. Print it as
  it is and end your turn: no tool call, no reading, no reply. You act only on hand-backs.
- **A report from a test-writer or an implementer can reach you directly,** after its runner has finished
  (the agent is woken once more when a command it left in the background ends). It repeats what the runner
  handed back: do nothing with it.
- Never put real bank data or secrets into anything you send, commit or record.

## Questions for the owner

- **While anything can still go on, a question is plain text, never a dialog, and the run goes on.** A runner
  parks its own and sends you each at once, in a message that starts `Q<n>:`; its hand-back repeats them
  (`QUESTIONS:`), and Open holds each with the tasks that wait for it. A finding routed ASK you park yourself
  (§ 4). Tell the owner each question when you learn of it: what is asked, the options with the recommended
  one first, and what waits for it. After a runner's `Q<n>:` message that is all: end your turn. Otherwise
  start whatever does not wait for it. The owner may answer at any time.
- **Record an answer at once,** also while a runner works (the script locks the file):
  `tdd add --section "Standing rules" --line "<date>, the owner: <the decision>"`, and
  `tdd put --section Open --key "<key>" --value "answered: <the decision> · still to do: <the edit, the
  tasks>"` (nothing left to do: `tdd drop --section Open --key "<key>"`). The rest waits for the next
  hand-back: your edit of the spec or `design.md`, its commit (tag `plan`), and the tasks. The runner that
  does the last task drops the entry; when no task is left, you do.
- **The tasks an answer frees** are a runner's. If the runner that parked them just handed back, resume it
  with `ANSWER: <key>: <the decision>` and the commit. Otherwise plan them as a chapter of their own
  (`CHAPTER: <name>: tasks <ids>, freed by <key>`), before the first chapter that needs them, else last.
- **A full stop** is where the run stands still for the owner: the acceptance gate, `after-chapter=stop`,
  `REVIEW_STOP`, `BLOCKED`, `NEEDS_OWNER`, and when only questions are left. There, and only there, use ONE
  AskUserQuestion dialog: the stop's own question, then every question Open still holds. Each question stands
  on its own (the owner may see the dialog alone): what is asked, and its options, the recommended one first.
  Four questions per dialog at most; the next dialog follows at once. Details go in your text above it.
- **The apply is not done while Open holds an entry.**

## Arguments

`$ARGUMENTS`

- First: the change name (a folder under `openspec/changes/`). If missing, list the active changes and ask.
- Then three switches, the default first: `agent-review=each-chapter|acceptance|none` (§ 3),
  `human-test-review=acceptance|each-group` (the owner reads the tests at the gate only, or also after each
  unit and integration group's tests) and `after-chapter=continue|stop` (§ 4 step 7). One that is not given
  is asked at the start (§ 0). On a resume nothing is asked: the recorded values hold, and a switch given now
  wins.

## Your commands

`tdd` stands for `node .claude/skills/tdd-apply/scripts/tdd.mjs`, run from the repository root. The command
comes first, then always `--change <change>` (only `tdd route`, § 4, takes none). Each call prints a line or
two.

- `tdd get --section "<name>" [--section …]`: one or more sections of the state file
  `openspec/changes/<change>/.tdd-state.md`. Its sections: Resume here, Run, Chapter plan, Agents, Standing
  rules, What the code holds now, Baseline, Acceptance tests, Open, Allowed failures, Design files. Never
  Read the file as a whole.
- `tdd set --section "<name>" --text "<text>"` (a long text goes through standard input: `--stdin` in place
  of `--text`), `tdd add --section "<name>" --line "<text>"`, `tdd put --section "<name>" --key "<key>"
  --value "<value>"`, `tdd drop --section "<name>" --key "<key>"`.
- With `--file reviews` these five work on `openspec/changes/<change>/.chapter-reviews.md`, the record of
  every chapter's findings and what became of them.
- `tdd commit --type docs --tag <plan|chapter|chapter-review> --summary "<text>" --path <file> [--path …]`.

In a text you pass (`--text`, `--line`, `--value`, `--summary`, `--resume`), `\n` is a new line: write paths
with forward slashes, and never start a text with `/` (Git Bash would turn it into a path).

The state file holds state only: what a new session needs to continue. The commits are the history.

## 0. Start, or resume

The steps that happen once are in `.claude/skills/tdd-apply/once.md`. Read it now and follow its § A start,
or § A resume when the state file exists and `Run` says `Status: applying`. A start asks every switch that
was not given in ONE dialog, after its read-only checks; a resume asks nothing. A `design-fetcher` agent
fetches the design files, never you.

## 1. Run a chapter

1. Start a `runner` with the Agent tool. The brief, and nothing more:

   ```
   CHANGE: <change>
   CHAPTER: <name>: <its groups or slices>
   MODE: human-test-review=<acceptance|each-group>
   START AT: <the chapter's first group, or the group and step "Resume here" names>
   TREE: clean | <what is uncommitted, when resuming mid-chapter>
   ```

2. Record it: `tdd put --section Agents --key "<chapter> runner" --value "<agent id>"`. The runner expects
   this one change in the tree.
3. Wait for its hand-back: end your turn.
4. Each notice that the runner stopped ends with `<usage><subagent_tokens>N…`: its context size. Past
   **200,000** with the chapter not done, resume it with `END THE CHAPTER after the slice in progress.`
5. Act on the hand-back: first its `QUESTIONS:`, if any (§ Questions for the owner), then its `RESULT`:
   - `GATE_READY`: § 2.
   - `REVIEW_STOP`: a full stop. Show the owner the group's tests (names, files, the commit). Resume the
     runner with the owner's feedback, or with `CONTINUE`.
   - `BLOCKED`: one case is yours to clear: a command an agent left running and could not stop (the hand-back
     names the task's id). Stop it with TaskStop (load it with ToolSearch, `select:TaskStop`), tell the owner
     in a line, and resume the runner with `CONTINUE`. Any other `BLOCKED`, and `NEEDS_OWNER`: a full stop.
     Tell the owner what stopped the runner or what it needs; once that is cleared, resume it with `CONTINUE`.
   - `CHAPTER_ENDED_EARLY`: never a question and never a stop. Re-plan by yourself: what remains becomes a
     new chapter with a fresh runner (the rest of B is B2), `tdd set --section "Chapter plan"`. Tell the owner
     in a line, with the runner's `WHY`. Then go on as for `CHAPTER_DONE`.
   - `CHAPTER_DONE`: § 3 (the acceptance chapter: start chapter A).
   - `FIX_ROUND_DONE` or `FIX_ROUND_ENDED_EARLY`: back in § 4, step 4.

## 2. The acceptance gate (always)

Whatever the switches say, the apply stops here, a full stop. On `GATE_READY`, follow `once.md` § The
acceptance gate.

## 3. Review the chapter

`agent-review` says when: `each-chapter`, after every chapter's `CHAPTER_DONE` and at the gate; `acceptance`,
at the gate only; `none`, never. Where no review runs, go on at § 4 step 7.

1. Start a `chapter-reviewer` with the Agent tool. The brief, and nothing more:

   ```
   CHANGE: <change>
   CHAPTER: <name>: <its groups or slices>
   RANGE: <where the previous review ended>..<the last commit of the runner's RANGE> | the working tree
   FIXES: <the previous chapter's fix commits, each with its finding's id> | none
   LATER: <one line per later chapter of the plan: its name and what it adds; "none" after the last>
   ```

   The previous chapter's record has both (`tdd get --file reviews --section "Chapter <previous>"`): its
   `range` ends where that review ended, and its findings name their fix commits. The first review after the
   gate takes the runner's `RANGE` as it is, and `FIXES: none`.
2. Record the range: `tdd put --file reviews --section "Chapter <X>" --key range --value "<the RANGE>"`. Wait
   for the hand-back: end your turn. It holds every finding with a verifier's verdict.
3. Route each finding (§ 4, step 1) and record it:
   `tdd put --file reviews --section "Chapter <X>" --key "<id>" --value "<severity> · <verdict> · <file:line> · <the defect in a few words> → <FIX|DECLINE|ASK>"`.

## 4. Act on the findings

1. **Route:** `tdd route --json '<the hand-back's ROUTE INPUT line, without its label>'`. It prints one line
   per finding, `<id> → FIX · <kind>`, `<id> → DECLINE · <reason>` or `<id> → ASK · <reason>`, then the
   counts. The outcomes are what it prints: never sort a finding yourself. Without findings there is no such
   line and nothing to route. DECLINE: nothing more is done.
2. Show the owner the routing in one table (id · severity · the finding · outcome · the reason in a few
   words). Do not wait: FIX and DECLINE are this skill's job. Park each ASK finding: `tdd put --section Open
   --key "<id>" --value "<the finding in a line> · holds: <its BUILDS ON IT>"`, and tell the owner the
   finding, the verifier's evidence, the trade-off and your recommendation. The owner answers fix now,
   decline (with their reason) or defer (a GitHub issue, or a heads-up in the design of the step it belongs
   to).
3. **Fix round.** Resume the chapter's own runner with the message below. If that runner is past 200,000
   tokens, or another chapter has started since, start a fresh one with the chapter's brief and the same
   message. Wait for the hand-back.

   ```
   FIX ROUND: chapter <X>
   TAG: chapter-review
   RECORD: --file reviews --section "Chapter <X>"
   PAIR: the chapter's own
   FINDINGS:
   <each FIX finding as the reviewer wrote it: its id line and the lines under it>
   ```

4. From its `FINDINGS:` lines: a finding refuted by its guard test is a DECLINE with that test as the
   evidence. A docs finding under `openspec/` that came back is yours: read the passage, fix it, and commit
   `tdd commit --type docs --tag chapter-review --summary "<id>: <summary>" --path <file>`. A finding handed
   back for the owner joins the asks (step 2). A blocked one, and one that waits for it, is parked already:
   the question is in the hand-back. Findings `not started` go to a fresh runner, as in step 3.
5. **The owner's answer to an ask** (when you act on it: § Questions for the owner):
   - Fix now: a spec or contract change is first written into the spec or `design.md` and committed with the
     tag `plan`; then another fix round (step 3). A blocked finding goes back to its runner instead:
     `ANSWER: <key>: fix now: <the test stands | what the test must say>`.
   - Decline or defer: a blocked finding's runner takes its guard test out, on `ANSWER: <key>: declined:
     <the reason>` or `deferred: <where>`. An issue: show the owner its text, create it only on their word.
   - Record each answer: `tdd put --file reviews …` with the outcome.
6. Commit the reviews file when you changed it after the runner's last commit:
   `tdd commit --type docs --tag chapter-review --summary "chapter <X>: the review's record" --path <the reviews file>`.
7. Then, as `after-chapter` says: `stop` reports the chapter (its commits, the suite's totals, the findings
   by outcome, the agents' context sizes) and is a full stop; `continue` reports it in a few lines and starts
   the next chapter (§ 1).

## 5. The end of the apply

After the last chapter's review and fixes, and only with Open empty: follow `once.md` § The end of the apply.
Its report tells the owner that `/code-review` and `/triage-review` start in a NEW session.
