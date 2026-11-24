# TDD apply: the steps that happen once, and the cases that come up now and then

The parts of `/tdd-apply` that the main session needs once in a change (the arguments, the start or the
resume, the acceptance gate, the end), and the cases that only some runs have (a runner that is blocked, a
lost agent, a finding handed back, the owner's answer to a finding). `SKILL.md` beside this file holds the
rules, the commands (`tdd`) and the loop that repeats for every chapter, and sends you here by section. Every
rule of `SKILL.md` holds here too.

## The arguments

- First: the change name (a folder under `openspec/changes/`). If missing, list the active changes and ask.
  That is a full stop (SKILL.md § Questions for the owner): ask in the dialog, the active changes as its
  options.
- Then three switches, the default first: `agent-review=each-chapter|acceptance|none` (SKILL.md § 3),
  `human-test-review=acceptance|each-group` (the owner reads the tests at the gate only, or also after each
  unit and integration group's tests) and `after-chapter=continue|stop` (SKILL.md § 4 step 7). One that is not
  given is asked at the start (§ A start step 3). On a resume nothing is asked: the recorded values hold, and
  a switch given now wins.

## A start

Steps 1 and 2 only read. Nothing is created, started or asked before they are done.

1. Read `proposal.md`, and `tasks.md` up to its first group plus its group headings.
2. Check that you are on the change's branch (not `main`) and that `git status --porcelain` is empty. Anything
   else is a full stop (SKILL.md § Questions for the owner): tell the owner what you found, and ask in the
   dialog what to do.
3. **The start dialog.** Ask every switch that was not given as an argument, all of them in ONE AskUserQuestion
   call: one question per switch, each a full sentence that can be read on its own, its values as the options
   with the default first.
   - `agent-review`: what the reviewer agent reviews during the apply. `each-chapter`: the acceptance tests
     before the gate, and every chapter. `acceptance`: the acceptance tests only. `none`: nothing, so only the
     final `/code-review` reviews the change.
   - `human-test-review`: where the owner reads the tests. `acceptance`: at the acceptance gate only.
     `each-group`: also after the tests of each unit and each integration group.
   - `after-chapter`: what happens when a chapter's review and fixes are done. `continue`: the next chapter
     starts by itself. `stop`: the run reports the chapter and waits for the owner.

   With all three given there is no dialog. Nothing starts before the answers.
4. Create the state file `openspec/changes/<change>/.tdd-state.md`, which also indexes the code graph:
   `tdd init --change <change> --agent-review <value> --human-test-review <value> --after-chapter <value>
   [--issue <n>]`, with the three values and the change's GitHub issue, if `proposal.md` or `tasks.md` names
   one.
5. Record the attribution lines your context gives you for commits, so every commit carries them:
   `tdd put --section Run --key "Commit trailers" --value "<line 1>\n<line 2>"`. Then set "Resume here" for
   the first time (SKILL.md § Rules for you): the apply has started, and the design files and the acceptance
   chapter come next.
6. The design files (below).
7. Start the acceptance chapter (SKILL.md § 1). Its runner validates the change, runs the baseline and the
   bootstrap, and has the acceptance tests written.

## The design files

If the change builds or changes UI, its `design.md` names the design-system parts and the Screens design
artboards it implements (`docs/conventions/workflow.md` § 8). The subagents cannot open Claude artifacts, so
the named files are saved in a session's scratchpad, and the state file's section "Design files" says where. A
`design-fetcher` agent does that. You never fetch a design file yourself: the Artifact tool prints what it
reads, and that text would stay in your context.

1. Check cheaply whether there is anything to fetch: Grep `design.md` for `design system`, `Screens design` and
   `artboard`, and look at the matching lines only. No match: there are no design files, go on.
2. Start a `design-fetcher` with the Agent tool. The brief, and nothing more: `CHANGE: <change>`. Wait for its
   hand-back: end your turn.
3. The hand-back is one line:
   - `DESIGN FILES: <n> files recorded · versions match`: go on.
   - `… · VERSION MISMATCH: …`: an artifact was saved again after `design.md` was written, and the files are
     its latest version. Tell the owner in a line, and go on.
   - `… · NOT FOUND: …`: a part `design.md` names has no file. Tell the owner in a line, and go on.
   - `DESIGN FILES: none named`: go on.
   - `DESIGN FILES: FAILED: …`: a full stop (SKILL.md § Questions for the owner). Tell the owner what failed.

## A resume

A change already under way: its state file exists and `Run` says `Status: applying`.

1. Ask nothing. The recorded switches hold (`Run`: Agent review, Human test review, After chapter). A switch
   given as an argument now wins: `tdd put --section Run --key "<its key>" --value "<the value>"`.
2. Read `tdd get --section "Resume here" --section Run --section "Chapter plan" --section Agents --section
   Open`. "Resume here" says where the earlier session stood: step 7 goes by it. When it names a chapter's
   review or its fix round, the reviews file says what is still to do of it: `tdd get --file reviews --section
   "Chapter <X>" --section "Chapter <X> review"` (the first holds the review's range and each finding's
   outcome so far, the second the findings in full, as the reviewer recorded them).
3. Check that you are on the change's branch (not `main`), and look at `git status --porcelain`. The state file
   and `.chapter-reviews.md` may be changed (bookkeeping, which the next commit takes along), and work that
   "Resume here" names as uncommitted goes into the runner's brief as `TREE:`. In the acceptance chapter that
   is the acceptance tests and their stubs: they stay uncommitted until the owner approves them at the gate.
   Anything else is a full stop (SKILL.md § Questions for the owner): tell the owner what you found, and ask
   in the dialog what to do.
4. Record the attribution lines again (a start's step 5): this session has its own.
5. The design files: `tdd get --section "Design files"`. When it names folders, list them, and start the
   `design-fetcher` again only when they are gone. When it is empty (`—`), the earlier session may have
   stopped before the fetch: make the check of § The design files step 1, and fetch if `design.md` names
   parts.
6. Tell the owner again every question Open holds without an answer (SKILL.md § Questions for the owner). An
   answer that Open records (`answered: …`) and that is not carried out yet is carried out as that section
   says.
7. Go on where "Resume here" says, with fresh agents. The agents of an earlier session, which the Agents
   section lists, are gone: never wait for one and never resume one. Whatever ran then is started again,
   never skipped. Take the first case below that fits what "Resume here" says:
   - **The start** (`—`, or your own text about the start or the design files): the earlier session stopped
     before its first runner, and step 5 has seen to the design files. Go on at § A start step 7.
   - **A full stop waited** (`after-chapter=stop`, `REVIEW_STOP`, `BLOCKED`, `NEEDS_OWNER`, only questions
     left; a runner's text that a group's tests are handed back for the owner's review is `REVIEW_STOP`): it
     still waits. Ask again, in the dialog (SKILL.md § Questions for the owner). When the stop was a
     runner's, a fresh runner then takes the chapter up where "Resume here" says it stands, with what the
     owner answered in its `START AT:` line.
   - **The acceptance chapter before its approval,** the gate included: a fresh runner for it, with `START
     AT: step 5 of the acceptance chapter: verify the tests that are in the tree` and `TREE: the acceptance
     tests, uncommitted`; with no test in the tree yet, the chapter's first step and `TREE: clean`. Its
     `GATE_READY` brings you to § The acceptance gate. The review of the gate's step 1 is not run again when
     "Resume here" says that it is sorted: say so again in your own "Resume here" texts.
   - **A later chapter's groups are under way** (a runner's text that names a group or a step to do next, or
     your own that says the chapter's runner works): a fresh runner (SKILL.md § 1) with that group and step
     as `START AT:`.
   - **A chapter is handed back for its review, or its review is not sorted yet** (it was running; or it is
     back, and "Chapter <X>" holds no finding's line): SKILL.md § 3, with a fresh reviewer. A range that was
     not recorded yet ends at that chapter's `[chapter]` commit (`git log --oneline` shows it). A review that
     runs again starts its record anew: before you start the reviewer, `tdd set --file reviews --section
     "Chapter <X>" --text "—"`. The exception: when the section "Chapter <X> review" says `FINDINGS: 0`, the
     review is done and found nothing: go on at SKILL.md § 4 step 6.
   - **A review is sorted, or a fix round was running:** in "Chapter <X>", a finding whose line still ends
     `→ FIX` is still to fix, and one that ends `→ ASK` must have its entry in Open (park it if it has none:
     SKILL.md § 4 step 2). Send the ones to fix to a fresh runner (SKILL.md § 4 step 3). With none to fix and
     a "Resume here" that does not say that the round is handed back, send it the message with `FINDINGS:
     none`: it runs the round's end. Then, or when the round was handed back, go on at SKILL.md § 4 step 4,
     taking each finding's outcome from its line in "Chapter <X>" where you have no hand-back's `FINDINGS:`
     line for it.
   - **Something to do next and nothing running:** do it.

## The acceptance gate (always)

Whatever the switches say, the apply stops here. When the acceptance chapter's runner hands back `GATE_READY`:

1. Have the tests reviewed before the owner reads them, unless `agent-review=none`: SKILL.md § 3, with the
   range `the working tree`. Its step 3 sorts the review's findings (SKILL.md § 4 step 1) and records them.
   Nothing more of SKILL.md § 4 applies at the gate: no finding is parked, and no fix round runs before the
   approval. The findings are presented to the owner (step 2), and those to fix go to the runner as change
   requests (step 3).
2. Present, and print no diff:
   - the list scenario → test, as the runner gives it;
   - the paths to read (the owner reads the tests in the working tree);
   - what the test-writer flagged;
   - the reviewer's findings with their verdicts, and how each was sorted;
   - the chapter plan.

   The gate is a full stop (SKILL.md § Questions for the owner): the dialog asks whether the owner approves
   the tests or has change requests, and then every question that is open. Its "Resume here" text says that
   the acceptance tests are in the working tree, uncommitted, and that their review is sorted (or that none
   runs).
3. Change requests (the owner's own, and the findings the owner wants fixed): resume the runner with
   `CHANGE REQUESTS:` and the list. A finding stands in the list as `<id>, as recorded in the reviews file,
   section "Chapter <X> review"`: do not copy its lines. When `GATE_READY` comes back, present what changed.
4. Approval: resume the runner with `APPROVED` and the agreed chapter plan. It commits the tests (`[accept]`)
   and hands back `CHAPTER_DONE`. Record each of the review's findings and its outcome (SKILL.md § 3 step 3):
   write its line again, with how it ended in place of the sorting (`fixed by a change request`, `declined:
   <the evidence>`, `left as it is: <the owner's reason>`). Then start chapter A (SKILL.md § 1).

## The end of the apply

After the last chapter's review and fixes, and only when Open is empty. While Open still holds a question and
nothing else can go on, that is a full stop (SKILL.md § Questions for the owner): ask, act on the answers, and
have the tasks they free done first.

1. `tdd put --section Run --key Status --value done`, set "Resume here" to say that the apply is done and
   what the owner's next steps are, and commit the state file with the tag `chapter`.
2. Report to the owner: the chapters and their commits; the suite's totals from the last hand-back; disputes
   and how they were settled; every change to a spec or `design.md`; the review findings by outcome, with the
   ones deferred; and that the next steps are the owner's: push and a draft PR, then `/code-review` and
   `/triage-review`, then `/opsx:archive`.
3. Say in that report that `/code-review` and `/triage-review` are started in a NEW session, not in this one:
   this session's context holds the whole apply, and the triage starts a fresh pair of its own.

## A runner that is blocked

SKILL.md § 1 step 5 sends you here for a hand-back whose `RESULT` is `BLOCKED` or `NEEDS_OWNER`.

- `BLOCKED`: one case is yours to clear: a command an agent left running and could not stop (the hand-back
  names the task's id). Stop it with TaskStop (load it with ToolSearch, `select:TaskStop`), tell the owner
  in a line, and resume the runner with `CONTINUE`.
- Any other `BLOCKED`, and `NEEDS_OWNER`: a full stop. Tell the owner what stopped the runner or what it
  needs; once that is cleared, resume it with `CONTINUE`.

## A lost agent

An agent is lost when no hand-back comes from it, also after you resumed it once and asked for it (SKILL.md
§ Rules for you). A fresh agent takes its place where the state file says the work stands: the case of
§ A resume, without a new session.

1. `tdd get --section "Resume here"`, and `git status --porcelain` as § A resume step 3 says: what the lost
   agent left uncommitted goes into a fresh runner's `TREE:` line.
2. § A resume step 7, by what "Resume here" says. A lost reviewer's review starts again.
3. When that is not possible (the tree holds changes that "Resume here" does not explain, or the fresh agent
   is lost too), it is a full stop: tell the owner what you know, and ask.

## A finding handed back

SKILL.md § 4 step 4 sends you here for a line `<id>: handed back: <why>` in a fix round's `FINDINGS:`.

- A docs finding under `openspec/` that came back is yours: read the passage, fix it, and commit
  `tdd commit --type docs --tag chapter-review --summary "<id>: <summary>" --path <file>`. The finding's
  entry is in the reviews file, section "Chapter <X> review".
- A finding handed back for the owner (its fix would need a new acceptance scenario, for instance) joins the
  asks (SKILL.md § 4 step 2).

## The owner's answer to a finding

SKILL.md § 4 step 5 sends you here. The owner answers an ASK finding with fix now, decline (with their reason)
or defer (a GitHub issue, or a heads-up in the design of the step it belongs to). Record the answer at once
(SKILL.md § Questions for the owner); what changes the working tree waits for the runner's hand-back.

- **Fix now:** a spec or contract change is first written into the spec or `design.md` and committed with the
  tag `plan`; then another fix round (SKILL.md § 4 step 3). Under that message's `FINDINGS:` line the finding
  gets one more line, which carries the decision to the runner: `OWNER: <id>: <the decision>`, ending ` ·
  plan commit <sha>` when there is one.
- **Decline or defer:** nothing is fixed. An issue: show the owner its text, create it only on their word.
- **A blocked finding** is one a runner parked as its own question `Q<n>`, because the implementer calls the
  finding's guard test wrong. Its answer goes back to its runner instead, as one line: `ANSWER: Q<n>: fix
  now: <the test stands | what the test must say>`, `ANSWER: Q<n>: declined: <the reason>` or `ANSWER: Q<n>:
  deferred: <where>`. On the last two the runner takes the guard test out, and its hand-back reports the
  finding as `guard removed <commit>: declined` or `deferred`: nothing more is to do for it then.
  - The runner that parked it is resumed with that line alone.
  - If that runner cannot be resumed (it is past 200,000 tokens, or it was an earlier session's), a fresh
    one does not know the finding. Start it as SKILL.md § 4 step 3 says, with `FINDINGS: none` when nothing
    else is to fix, and put two lines at the end of the message: the `ANSWER:` line, and under it `FINDING:
    <id>, as recorded in the reviews file, section "Chapter <X> review"`.
- Record each answer: `tdd put --file reviews --section "Chapter <X>" --key "<id>" --value "<its line, with
  the outcome in place of the sorting>"`.
