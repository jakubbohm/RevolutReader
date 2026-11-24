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

This skill is attached again, and a hook adds "Resume here", "Open" and "Agents" from the state file. Go by
"Resume here", and read nothing else again until a step asks for it:

- **It starts `Main session:`:** your own text. An agent it names as running still works: end your turn and
  wait for its hand-back. A full stop it names still waits: ask again. Otherwise do what it says comes next.
- **Any other text** is from a runner's commit: that runner still works, unless the text says that its work
  is handed back. Then the next move is yours.
- **A review or a fix round is never skipped.** What is left of one is in the reviews file: `tdd get --file
  reviews --section "Chapter <X>" --section "Chapter <X> review"`.

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
- **Go by the hand-back, not by the notice.** A notice that an agent stopped comes after its hand-back, maybe
  late: it adds only a size (§ 1). A notice for an agent whose hand-back you lack: it stopped without one, or failed,
  and nothing wakes it. Resume it once and ask for it. If still none comes, the agent is lost: `once.md`
  § A lost agent.
- **To resume an agent,** SendMessage to its id (load the tool once with ToolSearch, `select:SendMessage`).
- **Keep "Resume here" yours.** When a hand-back arrives, when you start an agent or resume one that has
  handed back, and at a full stop: `tdd set --section "Resume here" --text "Main session: <where the chapter
  stands · what runs, with the agent's id, or which stop waits · what comes next>"`. A runner's commits write
  that section while it works; after its hand-back it is yours again.
- **A progress note** is a message from a runner that is one line, `<step> completed at <HH:MM>`. Print it as
  it is and end your turn: no tool call, no reading, no reply. You act only on hand-backs.
- **A report from a test-writer or an implementer can reach you directly,** after its runner has finished
  (the agent is woken once more when a command it left in the background ends). It repeats what the runner
  handed back: do nothing with it.
- Never put real bank data or secrets into anything you send, commit or record.

## Questions for the owner

- **While anything can still go on, a question is plain text, never a dialog, and the run goes on.** A runner
  parks its own and sends you each at once, in a message that starts `Q<n>:`; its hand-back repeats them
  (`QUESTIONS:`), and Open holds each one's whole entry: the question, its `OPTIONS`, its `DETAIL` and what
  waits for it. A finding routed ASK you park yourself (§ 4). Tell the owner each question when you learn of
  it: what is asked, the options with the recommended one first, and what waits for it. After a runner's
  `Q<n>:` message that is all: end your turn. Otherwise start whatever does not wait for it. The owner may
  answer at any time.
- **Record an answer at once,** also while a runner works (the script locks the file):
  `tdd add --section "Standing rules" --line "<date>, the owner: <the decision>"`, and
  `tdd put --section Open --key "<key>" --value "answered: <the decision> · still to do: <the edit, the
  tasks>\n<the entry as it stood>"`: its lines name what waits and the work set aside (nothing left to do:
  `tdd drop --section Open --key "<key>"`). The rest waits for the next hand-back: your edit of the spec or
  `design.md`, its commit (tag `plan`), and the tasks. The runner that does the last task drops the entry;
  when no task is left, you do.
- **The tasks an answer frees** are a runner's. If the runner that parked them just handed back, resume it
  with `ANSWER: <key>: <the decision>` and the commit. Otherwise plan them as a chapter of their own
  (`CHAPTER: <name>: tasks <ids>, freed by <key>`), before the first chapter that needs them, else last.
- **A full stop** is where the run stands still for the owner: a failed check at the start, the acceptance
  gate, `after-chapter=stop`, `REVIEW_STOP`, `BLOCKED`, `NEEDS_OWNER`, and when only questions are left.
  There, and only there, use ONE AskUserQuestion dialog: the stop's own question, then every question Open
  still holds. Each question stands on its own (the owner may see the dialog alone): what is asked, and its
  options, the recommended one first. Four questions per dialog at most; the next dialog follows at once.
  Details go in your text above it.
- **The apply is not done while Open holds an entry.**

## Arguments

`$ARGUMENTS`

The change name, then the three switches of the hint. `once.md` § The arguments says what each means, and
what to do when one is missing.

## Your commands

`tdd` stands for `node .claude/skills/tdd-apply/scripts/tdd.mjs`, run from the repository root with the Bash
tool (a here-document and `<` do not work in PowerShell). The command comes first, then always `--change
<change>` (only `tdd route`, § 4, takes none). Each call prints a line or two.

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

In `--text`, `--line`, `--value` and `--resume`, `\n` is a new line. In any text you pass, write paths with
forward slashes, never start with `/` (Git Bash would turn it into a path), and use no double quote, backtick
or `$`.

The state file holds state only: what a new session needs to continue. The commits are the history.

## 0. Start, or resume

`.claude/skills/tdd-apply/once.md` has the steps that happen once, and the cases that come up now and then.
Read it now and follow its § A start, or § A resume when the state file exists and `Run` says `Status:
applying`. A `design-fetcher` agent fetches the design files, never you.

## 1. Run a chapter

1. Start a `runner` with the Agent tool. The brief, and nothing more:

   ```
   CHANGE: <change>
   CHAPTER: <name>: <its groups or slices>
   MODE: human-test-review=<acceptance|each-group>
   START AT: <the chapter's first group, or the group and step "Resume here" names>
   TREE: clean | <what is uncommitted, when resuming mid-chapter>
   ```

2. Record it: `tdd put --section Agents --key "<chapter> runner" --value "<agent id>"`, and set "Resume
   here". The runner expects the state file changed in the tree.
3. Wait for its hand-back: end your turn.
4. Each notice that the runner stopped ends with `<usage><subagent_tokens>N…`: its context size. Past
   **200,000** with the chapter not done, resume it with `END THE CHAPTER after the slice in progress.`
5. Act on the hand-back. First its `QUESTIONS:` (§ Questions for the owner); tell the owner its `DISPUTES:`
   and `FOR THE OWNER:` lines. Its `NEXT:` says what remains: plan it (a final `[close]` that a parked task
   holds back shows only there). Then its `RESULT`:
   - `GATE_READY`: § 2.
   - `REVIEW_STOP`: a full stop. Show the owner the group's tests (names, files, the commit). Resume the
     runner with the owner's feedback, or with `CONTINUE`.
   - `BLOCKED` or `NEEDS_OWNER`: a full stop, except for a command an agent left running, which you stop
     yourself: `once.md` § A runner that is blocked.
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
2. Record the range: `tdd put --file reviews --section "Chapter <X>" --key range --value "<the RANGE>"`, and
   the reviewer: `tdd put --section Agents --key "<chapter> reviewer" --value "<agent id>"`. Set "Resume
   here". Wait for the hand-back: end your turn. It holds every finding with a verifier's verdict.
3. Route each finding (§ 4, step 1) and record it:
   `tdd put --file reviews --section "Chapter <X>" --key "<id>" --value "<severity> · <verdict> · <file:line> · <the defect in a few words> → <FIX|DECLINE|ASK>"`.

## 4. Act on the findings

1. **Route:** `tdd route --json '<the hand-back's ROUTE INPUT line, without its label>'`. It prints one line
   per finding, `<id> → FIX · <kind>`, `<id> → DECLINE · <reason>` or `<id> → ASK · <reason>`, then the
   counts. The outcomes are what it prints: never sort a finding yourself. Without findings there is no such
   line and nothing to route. DECLINE: nothing more is done.
2. Show the owner the routing in one table (id · severity · the finding · outcome · the reason in a few
   words). Do not wait: FIX and DECLINE are this skill's job. Park each ASK finding: `tdd put --section Open
   --key "<id>" --value "<the finding in a line> · ASK: <the reason> · its entry: reviews file, section
   Chapter <X> review · waits: <its BUILDS ON IT>"`, and tell the owner the finding, the verifier's evidence,
   the trade-off and your recommendation. The owner answers fix now, decline or defer (step 5).
3. **Fix round.** Resume the chapter's own runner with the message below. If that runner is past 200,000
   tokens, or another chapter has started since, start a fresh one with the chapter's brief, `START AT: the
   fix round below`, and the same message. Wait for the hand-back.

   ```
   FIX ROUND: chapter <X>
   TAG: chapter-review
   RECORD: --file reviews --section "Chapter <X>"
   PAIR: the chapter's own
   FINDINGS: <the ids>, as recorded in the reviews file, section "Chapter <X> review"
   ```

4. From its `FINDINGS:` lines: a finding refuted by its guard test is a DECLINE with that test as the
   evidence. One `handed back`: `once.md` § A finding handed back. A blocked one, and one that waits for it,
   is parked already: the question is in the hand-back. Findings `not started` go to a fresh runner, as in
   step 3.
5. **The owner's answer to an ask** (when you act on it: § Questions for the owner): `once.md` § The owner's
   answer to a finding.
6. Commit the reviews file when it changed after the runner's last commit:
   `tdd commit --type docs --tag chapter-review --summary "chapter <X>: the review's record" --path <the reviews file>`.
7. Then, as `after-chapter` says: `stop` reports the chapter (its commits, the suite's totals, the findings
   by outcome, the agents' context sizes) and is a full stop; `continue` reports it in a few lines and starts
   the next chapter (§ 1).

## 5. The end of the apply

After the last chapter's review and fixes, and only with Open empty: follow `once.md` § The end of the apply.
