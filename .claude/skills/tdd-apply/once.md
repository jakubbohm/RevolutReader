# TDD apply: the steps that happen once

The parts of `/tdd-apply` that the main session needs once in a change: the start or the resume, the acceptance
gate, and the end. `SKILL.md` beside this file holds the rules, the commands (`tdd`) and the loop that repeats
for every chapter, and sends you here from its § 0, § 2 and § 5.

## A start

Steps 1 and 2 only read. Nothing is created, started or asked before they are done.

1. Read `proposal.md`, and `tasks.md` up to its first group plus its group headings.
2. Check that you are on the change's branch (not `main`) and that `git status --porcelain` is empty. Anything
   else: stop and ask the owner.
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
   `tdd put --section Run --key "Commit trailers" --value "<line 1>\n<line 2>"`.
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
   Open`.
3. Check that you are on the change's branch (not `main`), and look at `git status --porcelain`. The state file
   and `.chapter-reviews.md` may be changed (bookkeeping, which the next commit takes along), and work that
   "Resume here" names as uncommitted goes into the runner's brief as `TREE:`. Anything else: stop and ask the
   owner.
4. Record the attribution lines again (a start's step 5): this session has its own.
5. The design files: check that the recorded files are still there (`tdd get --section "Design files"`, then
   list the folders it names), and start the `design-fetcher` again only when they are gone.
6. Tell the owner again every question Open holds without an answer (SKILL.md § Questions for the owner).
7. Start a fresh runner (SKILL.md § 1) where "Resume here" says, telling it where the chapter stands. Do not
   count on the agents of an earlier session that the Agents section lists: start fresh ones (for a fix round
   of an earlier chapter, a fresh runner with that chapter's brief).

## The acceptance gate (always)

Whatever the switches say, the apply stops here. When the acceptance chapter's runner hands back `GATE_READY`:

1. Have the tests reviewed before the owner reads them, unless `agent-review=none`: SKILL.md § 3, with the
   range `the working tree`.
2. Present, and print no diff:
   - the list scenario → test, as the runner gives it;
   - the paths to read (the owner reads the tests in the working tree);
   - what the test-writer flagged;
   - the reviewer's findings with their verdicts;
   - the chapter plan.

   The gate is a full stop (SKILL.md § Questions for the owner): the dialog asks whether the owner approves
   the tests or has change requests, and then every question that is open.
3. Change requests (the owner's own, and the findings the owner wants fixed): resume the runner with
   `CHANGE REQUESTS:` and the list. When `GATE_READY` comes back, present what changed.
4. Approval: resume the runner with `APPROVED` and the agreed chapter plan. It commits the tests (`[accept]`)
   and hands back `CHAPTER_DONE`. Record each of the review's findings and its outcome (SKILL.md § 3 step 3).
   Then start chapter A (SKILL.md § 1).

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
