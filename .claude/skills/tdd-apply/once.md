# TDD apply: the steps that happen once, and the cases that come up now and then

The parts of `/tdd-apply` that the main session needs once in a change (the arguments, the start or the
resume, the acceptance gate, the first review after it, the end), and the cases that only some runs have (a
group's tests for the owner, a chapter ended early, a runner that is blocked, a lost agent, the tasks an
answer frees, findings whose fixes touch, what a fix round left, a finding handed back, the owner's answer to
a finding, another effort level). `SKILL.md` beside this file holds the rules, the commands (`tdd`) and the
loop that repeats for every chapter, and sends you here by section. Every rule of `SKILL.md` holds here too.

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
   one. Then the npm installs (below), before anything else.
5. Record the attribution lines your context gives you for commits, so every commit carries them:
   `tdd put --section Run --key "Commit trailers" --value "<line 1>\n<line 2>"`. Then set "Resume here" for
   the first time (SKILL.md § Rules for you): the apply has started, and the design files and the acceptance
   chapter come next.
6. The design files (below).
7. Start the acceptance chapter (SKILL.md § 1), under the name `acceptance`. Its runner validates the change,
   runs the baseline and the bootstrap, and has the acceptance tests written.

## The npm installs

§ A start step 4 and § A resume step 1 send you here, right after `tdd init`; `/triage-review` sends its main
session here too, right after `tdd triage-init`. Every folder with a `package-lock.json` needs its packages
installed in this checkout, in its `node_modules`: a new worktree or clone has none, and a lockfile that
changed since leaves an install behind. The script checks every such folder and installs by itself. Nobody is
asked, and no agent starts before this is done.

1. Run `tdd install`, with `--change <change>` (a triage: `--pr <id>`), and with the Bash tool's `timeout` set
   to 600000, ten minutes, the most the tool gives: an install can take minutes and needs the network. The
   script ends by itself after nine.
2. It prints one line per folder, `install: <folder> | <state>`. The state is `ok`; `missing`, when there is
   no `node_modules`; or `stale: <what is wrong>`, when what is installed is not what the lockfile says. In a
   folder that is missing or stale it runs `npm ci`, and the line ends `| npm ci: done in <time>`. With every
   line `ok` or done, go on.
3. A line that starts `ERROR: install:` is a failed check at the start, a full stop (your skill's SKILL.md
   § Questions for the owner). It names the folder and what failed. Where npm was started and did not finish,
   it also says that the folder's `node_modules` may now be incomplete, and gives the command to run again.
   Tell the owner the line as it is. Run `tdd install` again only on the owner's word, once the cause is gone,
   and go on only when no line starts `ERROR:`. Never install another way: no `npm install`, and no `npm ci`
   of your own.
4. If the tool answers that it moved the command to the background, the install is still running: start
   nothing, and end your turn. Its notice names the file that holds the lines the command printed: Read it,
   and go by those lines.

## The design files

If the change builds or changes UI, its `design.md` names the design-system parts and the Screens design
artboards it implements (`docs/conventions/workflow.md` § 8). The subagents cannot open Claude artifacts, so
the named files are saved in a session's scratchpad, and the state file's section "Design files" says what
was fetched and where it is. The folders are true on this machine only, so they are in the state file's local
part, which is never committed; `tdd get --section "Design files"` prints them after the committed text. A
`design-fetcher` agent does all that. You never fetch a design file yourself: the Artifact tool prints what it
reads, and that text would stay in your context.

1. Check cheaply whether there is anything to fetch: Grep `design.md` for `design system`, `Screens design` and
   `artboard`, and look at the matching lines only. No match: there are no design files, go on.
2. Start a `design-fetcher` with the Agent tool. The brief, and nothing more: `CHANGE: <change>`. Wait for its
   hand-back: end your turn.
3. The hand-back is one line:
   - `DESIGN FILES: <n> files recorded · versions match`: go on.
   - `… · VERSION MISMATCH: …`: an artifact was saved again after `design.md` was written, and the files are
     its latest version, which is the one that counts. Tell the owner in a line, and go on.
   - `… · NOT FOUND: …`: a part `design.md` names has no file, and UI is never built from a guess. A full
     stop (SKILL.md § Questions for the owner): tell the owner which parts, and ask in the dialog what to do,
     with these two options. A line that also has a `VERSION MISMATCH` is this case: say the mismatch too.
     - **Correct the name in `design.md` and fetch again.** The owner gives the part's name as the artifact
       has it. Write it into `design.md` in place of the wrong one (the line step 1's Grep found), commit
       that (`tdd commit --type docs --tag plan --summary "design.md: the name of a design part" --path
       openspec/changes/<change>/design.md`), and start the `design-fetcher` again (step 2).
     - **Go on without that part.** Record the decision, so that the agents build the UI knowing it: `tdd add
       --section "Standing rules" --line "<date>, the owner: the UI is built without the design part <name>:
       <what the owner says to do in its place>"`. Then go on.
   - `DESIGN FILES: none named`: go on.
   - `DESIGN FILES: FAILED: …`: a full stop (SKILL.md § Questions for the owner). Tell the owner what failed.

## A resume

A change already under way: its state file exists and `Run` says `Status: applying`.

1. Ask nothing. Run `tdd init --change <change>`, with each switch that was given as an argument now
   (`--agent-review <value>`, `--human-test-review <value>`, `--after-chapter <value>`). On a state file that
   exists it changes only the switches given: the recorded ones hold (`Run`: Agent review, Human test review,
   After chapter), and one given now wins. The same call indexes the code graph and writes its project for
   this machine when the state file's local part has none (another machine, a fresh clone): no agent starts
   before it. Then the npm installs, as at a start (§ The npm installs).
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
5. The design files: `tdd get --section "Design files"`. It prints what was fetched and, after that text, the
   folder of each artifact on this machine.
   - The section is empty (`—`): the earlier session may have stopped before the fetch. Make the check of
     § The design files step 1, and fetch if `design.md` names parts.
   - Otherwise there is no fetch only when every artifact whose files the text lists has a folder, and that
     folder exists (list it). In any other case start the `design-fetcher` again (§ The design files step
     2): no folder is named (another machine or a fresh clone: the folders are never committed), an artifact
     whose files are listed has none (a fetcher lost part-way through its record), or a named folder is gone.

   The hand-back of a fetch is handled as § The design files step 3 says.

   **A part without a file still stops the run, fetch or no fetch.** When the section's `Not found:` line
   names a part (anything but `nothing`), or a fetch's hand-back does, read the Standing rules (`tdd get
   --section "Standing rules"`). A part they say the UI is built without is settled: no stop. For any other
   part the stop of § The design files step 3 still waits, also when the folders are all there: ask again.
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
     owner answered in its `START AT:` line. A design fetch that failed or missed a part is such a stop too:
     step 5 has asked it again, and after the owner's answer you take the case here that fits where the
     apply stands.
   - **The acceptance chapter before its approval,** the gate included: a fresh runner for it, with `START
     AT: step 5 of the acceptance chapter: verify the tests that are in the tree` and `TREE: the acceptance
     tests, uncommitted`; with no test in the tree yet, the chapter's first step and `TREE: clean`. Its
     `GATE_READY` brings you to § The acceptance gate. The review of the gate's step 1 is not run again when
     "Resume here" says that it is sorted: say so again in your own "Resume here" texts. When it is not
     sorted yet, the case of a review that is not sorted, below, says whether it runs again or is only
     sorted.
   - **A later chapter's groups are under way** (a runner's text that names a group or a step to do next, or
     your own that says the chapter's runner works): a fresh runner (SKILL.md § 1) with that group and step
     as `START AT:`.
   - **A chapter is handed back for its review, or its review is not sorted yet.** A review is sorted when
     every finding of its record has its line in "Chapter <X>" (step 2 printed both sections; a merged
     finding goes by its first id). A sorting that stopped half-way is not sorted. Two things survive of a
     review: its record, the section "Chapter <X> review", which the reviewer's command writes only when
     the review is complete and agrees with the verifiers' reports; and those reports, files in this
     machine's temp folder.
     - **The record is there** (the section starts `REVIEW:`): the review is done and is not run again.
       Sort it, or finish its sorting: run `tdd route` (SKILL.md § 4 step 1; running it again changes
       nothing) and record each finding whose line is missing (SKILL.md § 3 step 3), with its severity,
       verdict and defect from the record. Then go on at SKILL.md § 4 step 2. With `FINDINGS: 0` there is
       nothing to sort: go on at SKILL.md § 4 step 6. At the gate, in both cases, go on in § The
       acceptance gate step 1 instead, where the sorting ends.
     - **The record is there and its reports are gone** (another machine, a cleared temp folder): `tdd
       route` then prints a line `route: <file> …` for each missing report, and sorts its finding ASK.
       Nothing is sorted from that: the review runs again, as the next case says.
     - **No record** (`—`, or no such section): the review was running, or never started. SKILL.md § 3, with
       a fresh reviewer. A range that was not recorded yet ends at that chapter's `[chapter]` commit (`git
       log --oneline` shows it); where it starts in the first review after the gate: § The first review
       after the gate. A review that runs again starts its record anew: before you start the reviewer, `tdd
       set --file reviews --section "Chapter <X>" --text "—"` and the same for the section "Chapter <X>
       review", then record the range again (SKILL.md § 3 step 2). At the gate, record `gate` again after
       the sorting (§ The acceptance gate step 1).
   - **A review is sorted, or a fix round was running:** in "Chapter <X>", a finding whose line still ends
     `→ FIX` is still to fix, and one that ends `→ ASK` must have its entry in Open (park it if it has none:
     SKILL.md § 4 step 2). One that ends `→ FIX, waits for <id>` waits for that finding's answer, or for
     each one's when it names several (§ Findings whose fixes touch). Send the ones to fix to a fresh runner (SKILL.md § 4 step 3). With none to fix:
     when no fix round of the chapter was begun ("Resume here" names none), go on at SKILL.md § 4 step 5,
     as SKILL.md § 4 step 3 does without a FIX finding that does not wait; when one was begun and "Resume
     here" does not say that it is handed back, send a fresh runner the message with `FINDINGS: none`: it
     runs the round's end. After a runner's hand-back, or when the round was handed back, go on at SKILL.md
     § 4 step 4, taking each finding's outcome from its line in "Chapter <X>" where you have no hand-back's
     `FINDINGS:` line for it.
   - **Something to do next and nothing running:** do it.

## The acceptance gate (always)

Whatever the switches say, the apply stops here. When the acceptance chapter's runner hands back `GATE_READY`:

1. Have the tests reviewed before the owner reads them, unless `agent-review=none`: SKILL.md § 3, with the
   range `the working tree`. Its step 3 sorts the review's findings (SKILL.md § 4 step 1) and records them.
   Nothing more of SKILL.md § 4 applies at the gate: no finding is parked, and no fix round runs before the
   approval. The findings are presented to the owner (step 2), and those to fix go to the runner as change
   requests (step 3).

   Then record how the acceptance tests stand, in the acceptance chapter's section of the reviews file, but
   only right after the sorting of the review that ran at this `GATE_READY`, also when a resume sorts it:
   `tdd put --file reviews --section "Chapter acceptance" --key gate --value "unchanged since its review"`. A
   `GATE_READY` for which the review does not run again (after change requests or an answer, or in a new
   session when "Resume here" says that the review is sorted) never writes that value: the key keeps what it
   holds, or becomes `changed after its review` as the next paragraph says. With `agent-review=none`, the
   value `not reviewed`. The first chapter review goes by it (§ The first review after the gate).

   The value `unchanged since its review` holds only while the tests stay as the review read them. Whenever
   you resume the acceptance chapter's runner with anything but `APPROVED` before the first chapter review
   has started (change requests, an `ANSWER:`, `CONTINUE`), first write the key again, with `changed after
   its review`. The same when a `GATE_READY` says under `FLAGGED:` that a test had to be changed. `not
   reviewed` stays as it is.
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
3. Change requests (the owner's own, and the findings the owner wants fixed), and the owner's answer to a
   question the runner parked: first record that the tests change after their review (step 1; not when no
   review ran and `gate` says `not reviewed`): `tdd put --file reviews --section "Chapter acceptance" --key
   gate --value "changed after its review"`. The gate's review does not run again; the first chapter review
   reads the changed tests instead. Then resume the runner: with `CHANGE REQUESTS:` and the list, or with
   `ANSWER: <key>: <the decision>`. A finding stands in the list as `<id>, as recorded in the reviews file,
   section "Chapter acceptance review"`: do not copy its lines. When `GATE_READY` comes back, present what
   changed.
4. Approval: resume the runner with `APPROVED` and the agreed chapter plan. It commits the tests (`[accept]`)
   and hands back `CHAPTER_DONE`. SKILL.md § 1 step 5 sends you here with it, also after a compaction:
   - Record where the apply started, the first commit of that hand-back's `RANGE`: `tdd put --file reviews
     --section "Chapter acceptance" --key "apply start" --value "<that commit>"`.
   - Record each of the review's findings and its outcome (SKILL.md § 3 step 3): write its line again, with
     how it ended in place of the sorting (`fixed by a change request`, `declined: <the evidence>`, `left as
     it is: <the owner's reason>`).
   - Then start chapter A (SKILL.md § 1).

## The first review after the gate

SKILL.md § 3 step 1 sends you here for the first chapter review that runs after the gate: no chapter after
`acceptance` has a `range` in the reviews file yet. That is chapter A's review, or a later chapter's when the
reviews were switched on after chapter A. No chapter review has read what the apply committed before the
gate: the bootstrap (`[setup]`), when the change has one, and the acceptance tests (`[accept]`). So this
review differs from a later one in two things:

- **Its range starts where the apply started:** `RANGE: <apply start>..<the last commit of the runner's
  RANGE>`, with `FIXES: none`. Chapters before this one that had no review lie in that range too, and the
  reviewer reads them as part of it.
- **Its brief has one more line, after `LATER:`:** `GATE: <gate>`. It tells the reviewer whether the
  acceptance tests in that range were reviewed as they stand (`unchanged since its review`: it does not
  review them again) or not (`changed after its review`, `not reviewed`: it does). The bootstrap commit it
  reviews always.

Both values are in the acceptance chapter's section of the reviews file, where § The acceptance gate
recorded them: `tdd get --file reviews --section "Chapter acceptance"`, the keys `apply start` and `gate`. A
key that is missing there, or a section that is not there (a session ended between the approval and its
record):

- `apply start` is the commit before the one that added the state file: `git log --diff-filter=A --format=%h
  -- openspec/changes/<change>/.tdd-state.md` prints that one, and `git rev-parse --short <it>~1` the commit
  before it. Record it.
- `gate` is `not reviewed`, the cautious value: the reviewer then reads the acceptance tests too.

Every later review goes as SKILL.md § 3 step 1 says: its range starts where the last review that ran ended,
also when chapters between the two had none.

## A group's tests for the owner

SKILL.md § 1 step 5 sends you here for a hand-back whose `RESULT` is `REVIEW_STOP` (it comes only with
`human-test-review=each-group`). It is a full stop (SKILL.md § Questions for the owner). Show the owner the
group's tests: their names, their files and the `red` commit, as the hand-back's `TESTS:` has them. Then
resume the runner with the owner's feedback, or with `CONTINUE`.

## A chapter ended early

SKILL.md § 1 step 5 sends you here for a hand-back whose `RESULT` is `CHAPTER_ENDED_EARLY`. It is never a
question and never a stop. Re-plan by yourself: what remains becomes a new chapter with a fresh runner (the
rest of B is `B2`: one word, as every chapter's name, SKILL.md § 1), and the plan is written again: `tdd set
--section "Chapter plan"`. Tell the owner in a line, with the runner's `WHY`. Then go on as for
`CHAPTER_DONE`: the part that was done gets its review (SKILL.md § 3).

## The end of the apply

After the last chapter's review and fixes, and only when Open is empty and no finding's line in the reviews
file still ends `→ FIX`, with or without `, waits for <ask id>` (§ Findings whose fixes touch). While Open
still holds a question and nothing else can go on, that is a full stop (SKILL.md § Questions for the owner):
ask, act on the answers, and have the tasks they free done first. A finding whose line still ends `→ FIX`
goes into a fix round first (SKILL.md § 4 step 3), and so does one whose line still says that it waits when
the answer is there (§ The owner's answer to a finding).

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
- `BLOCKED` with a line that starts `ERROR: failed part-way:` (the runner's `shelve` or `unshelve` stopped
  half-way): a full stop. Tell the owner the cause, the line's part after `The cause:`, and where the line
  says the work is; once the cause is gone, resume the runner with `CONTINUE: run the way out your BLOCKED
  line names, then go on`. Record the line in "Resume here" at the stop. A runner that cannot be resumed
  then: a fresh one, whose brief's `START AT:` gives that line and says to run its way out first.
- Any other `BLOCKED`, and `NEEDS_OWNER`: a full stop. Tell the owner what stopped the runner or what it
  needs; once that is cleared, resume it with `CONTINUE`.

## A lost agent

An agent is lost when no hand-back comes from it, also after you resumed it once and asked for it (SKILL.md
§ Rules for you). A fresh agent takes its place where the state file says the work stands: the case of
§ A resume, without a new session.

1. `tdd get --section "Resume here"`, and `git status --porcelain` as § A resume step 3 says: what the lost
   agent left uncommitted goes into a fresh runner's `TREE:` line.
2. § A resume step 5, then its step 7, by what "Resume here" says. Step 5 sees to the design files: a lost
   `design-fetcher` is started again there unless every artifact whose files it recorded has its folder, and
   a part without a file still stops the run. A lost reviewer's review starts again, unless its record is there
   already: step 7's case of a review that is not sorted says which.
3. When that is not possible (the tree holds changes that "Resume here" does not explain, or the fresh agent
   is lost too), it is a full stop: tell the owner what you know, and ask.

## The tasks an answer frees

SKILL.md § Questions for the owner sends you here when the owner's answer frees tasks. They are a runner's.

- If the runner that parked them just handed back, resume it with `ANSWER: <key>: <the decision>` and the
  commit.
- Before the approval, an answer that frees acceptance tasks goes to the acceptance chapter's runner, also
  to a fresh one (a new session, a lost runner): never a chapter of its own. Resume that runner with the
  `ANSWER:` line when it hands back `GATE_READY`, as § The acceptance gate step 3 says.
- Otherwise plan them as a chapter of their own, before the first chapter that needs them, else last. Its
  brief's `CHAPTER:` line is `<name>: tasks <ids>, freed by <key>`, and its name is one word, as every
  chapter's (SKILL.md § 1): `Q1-tasks`, for instance.

## Findings whose fixes touch

SKILL.md § 4 step 1 sends you here. The reviewer says in an `AFFECTS` line under each of two findings that
their fixes touch: fixing one changes how the other has to be fixed, or both change the same lines. They stay
two findings, each with its own outcome and, as a question, its own answer. Only a merged finding is one.

- **Both are to fix:** nothing to do. Their entries carry the lines, and the runner takes them one right
  after the other.
- **One is ASK, the other FIX:** the fix waits, because the answer may change how it must be done. `tdd
  route` says so in a line of its own, after the outcome lines: `<id>: waits for <ask id>`. Several ASK
  findings are joined by ` and ` (`A-7: waits for A-2 and A-6`). A merged ASK finding stands as its key,
  with its comma (`A-3: waits for A-1, A-4`): one finding, named by its first id (`A-1`) as SKILL.md § 4
  step 1 says. For each finding that waits:
  - Leave it out of the fix round, and say so in its line in "Chapter <X>" (SKILL.md § 3 step 3), which then
    ends `→ FIX, waits for <ask id>`, several joined by ` and `.
  - Name it where the ASK finding is parked (SKILL.md § 4 step 2): Open's entry names it after `waits:`,
    with what builds on that finding, and you tell the owner that it waits for the answer.
  - Until the answer is there it is no finding still to fix: with nothing else to fix, only questions are
    left.
  - When the answer is there, write its line again, ending `→ FIX`, and send it into the next fix round:
    after "fix now" together with the finding that was asked, after a decline or a deferral on its own. On
    its own it gets one more line under the message's `FINDINGS:` line, which tells the runner the decision:
    `OWNER: <its id>: <ask id> was declined | deferred: <the reason>; fix it on its own`. The runner then
    passes its entry on without its `AFFECTS` line for that ask. A finding that waits for several answers
    waits for the last of them: until then its line keeps the ids still unanswered.
- **Both are ASK:** tell them to the owner right after each other, and put their questions next to each
  other in the dialog. Each names the other finding and says how the two fixes touch, and each gets an
  answer of its own.

## After a fix round

SKILL.md § 4 step 4 sends you here with the `FINDINGS:` lines of a fix round's hand-back. A finding that is
`fixed` needs nothing more from you. The others:

- **Refuted by its guard test:** a DECLINE, with that test as the evidence.
- **Handed back:** § A finding handed back.
- **Blocked, and one that waits for it:** parked already. The question is in the hand-back (SKILL.md
  § Questions for the owner).
- **Guard removed** (declined or deferred): the owner's answer is carried out; nothing more.
- **Not started:** to a fresh runner, as SKILL.md § 4 step 3 says.

## A finding handed back

§ After a fix round sends you here for a line `<id>: handed back: <why>` in a fix round's `FINDINGS:`.

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
  plan commit <sha>` when there is one. A finding whose first line in the record gives `not applicable` as
  its kind (its verifier refuted it or never reported) has no kind for the runner to fix it by: there the
  line names one, before the plan commit: ` · kind: behaviour`, or `test-quality`, `docs` or `cleanup` when
  the owner's answer says that it is one of these.
- **Decline or defer:** nothing is fixed. An issue: show the owner its text, create it only on their word.
- **The findings that wait for it,** whichever of the three the answer is: every finding whose line in
  "Chapter <X>" names this id after `→ FIX, waits for` (Open's entry names it after `waits:`) now goes into a
  fix round, as § Findings whose fixes touch says: after fix now together with this finding, after a decline
  or a deferral on its own, and not yet while it waits for another answer too. Until that fix round hands
  back, this finding's entry in Open stays, so that no compaction loses them: write it as `answered: <the
  decision> · still to do: the fix round of <the waiting ids it frees>` (after fix now, this finding's id
  too, after the edit when there is one), with the entry as it stood under it (SKILL.md § Questions for the
  owner).
  When that round's hand-back is there, take the round out of it: drop the entry (`tdd drop --section Open
  --key "<id>"`) when no task it holds is left, else write it again with the tasks alone still to do.
- **A blocked finding** is one a runner parked as its own question `Q<n>`, because the implementer calls the
  finding's guard test wrong. Its answer goes back to its runner instead, as one line: `ANSWER: Q<n>: fix
  now: <the test stands | what the test must say>`, `ANSWER: Q<n>: declined: <the reason>` or `ANSWER: Q<n>:
  deferred: <where>`. On the last two the runner takes the guard test out, and its hand-back reports the
  finding as `guard removed <commit>: declined` or `deferred`: nothing more is to do for it then.
  - The runner that parked it is resumed with that line alone.
  - If that runner cannot be resumed (it is past 300,000 tokens, or it was an earlier session's), a fresh
    one does not know the finding. Start it as SKILL.md § 4 step 3 says, with `FINDINGS: none` when nothing
    else is to fix, and put two lines at the end of the message: the `ANSWER:` line, and under it `FINDING:
    <id>, as recorded in the reviews file, section "Chapter <X> review"`.
- Record each answer: `tdd put --file reviews --section "Chapter <X>" --key "<id>" --value "<its line, with
  the outcome in place of the sorting>"`.

## Another effort level

The test-writer and the implementer work at the effort their definitions set. The owner may ask for another
level for one of them or for both, at any time and in plain words ("the implementer at high from now on").
The levels are the Agent tool's: `low`, `medium`, `high`, `xhigh`, `max`. Never change a level by yourself.

1. Record it, with only the agents the owner named: `tdd put --section Run --key Effort --value
   "test-writer=<level> · implementer=<level>"` (one of the two parts, or both). A later request writes the
   whole value again: the part of an agent it does not name stays as the entry has it (`tdd get --section
   Run`).
2. Going back to an agent's own level: write the value again without that agent's part. With no part left:
   `tdd drop --section Run --key Effort`.
3. That is all you do. The entry is the one place that says it: no brief and no message names a level, and
   nothing depends on your memory of the request. A runner reads `Run` each time it starts a test-writer or
   an implementer, and passes the level it finds there.
4. Tell the owner in a line what holds from when: every agent started from now on has the new level, and one
   that is running keeps its own until it is replaced (at the next chapter, or when it is past its budget).
