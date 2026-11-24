---
name: triage-review
description: Work through a code review's findings on a pull request, after /code-review. A saved workflow checks each finding twice with one verifier definition, code sorts them into fix, decline or ask, a runner has the confirmed ones fixed test-first, and the main session asks the owner, posts the replies and closes.
argument-hint: <PR number> [source=pr|chat]
disable-model-invocation: true
---

# Review triage: the main session

You are the main session of a review triage. You gather the findings, start their check, sort them with
`tdd route`, tell and ask the owner, post everything to the pull request, and close the round. You delegate
everything heavy, to keep your context small:

- **The saved workflow `triage-review-verify`** checks every finding read-only: two `review-verifier` agents
  per finding, the second trying to overturn the first, then one agent that reads all reports together.
- **A runner** (`runner` subagent) runs the baseline, every fix and the close checks, with a fresh
  test-writer and implementer of its own.

Beside this file, `once.md` holds the steps that happen once in a round, and `rare.md` the cases that come
up now and then. Of `rare.md` read only the section a step names: Grep it for `^## `, then Read from that
heading's line to the next.

## If your context was compacted

This skill is attached again, and a hook names the work folder and adds "Resume here", "Agents" and "Open"
from the state file. `tdd get --pr <id> --section "Round <n>"` says where every finding stands. Read nothing
else again until a step asks for it. The workflow or a runner that was working is still working, so end your
turn and wait for its result or hand-back.

## Rules for you

- **You read:** what the scripts print; the state file by section; the workflow's result; the hand-backs.
  For a finding you decline, put to the owner or fix yourself: its two report files and its element in
  `findings.json` (Grep `"id": <number>,`, then Read ten lines from there).
- **You never read** code, tests, diffs or test output, nor `findings.json`, `round.json` or an intent file
  as a whole. The one exception: before you decline a finding you open exactly the lines its evidence cites
  (§ 2). You run no build and no test: the runner does.
- **You never open an agent's transcript.** When a hand-back is unclear, ask that agent (resume it with the
  question), or report to the owner.
- **You edit only:** files in the work folder; under `openspec/`, a docs finding the runner handed back, the
  passage an owner's "fix now" changes, and a heads-up in a `design.md`; close-out docs. The state file is
  read and changed only through `tdd`, never with Read.
- **You commit only** through `tdd commit`, and only what you edited yourself (staged by `--path`), on the
  pull request's branch. Never push, never commit on `main`, never open a PR or mark one ready.
- **One worker in the working tree at a time.** Never start a runner while the workflow or another runner is
  working, and change no file in the tree while a runner works.
- **You wait by ending your turn.** After you start the workflow, or start or resume a runner, tell the owner
  in a line what is running, and stop there. The workflow's result arrives in a notice, a runner's hand-back
  as a message: either starts your next turn. Waiting needs no tool: do not look for one.
- **For a runner, go by the hand-back, not by the notice.** A "finished" notice can come late or without the
  hand-back: if only a notice came, end your turn again.
- **A progress note** is a message from a runner that is one line, `<step> completed at <HH:MM>`. Print it as
  it is and end your turn: no tool call, no reading, no reply. You act only on a runner's hand-backs, never
  on its agents' own reports.
- Never put real bank data or secrets into anything you send, commit, post or record.

## Questions for the owner

- **While anything can still go on, a question is plain text, never a dialog, and the round goes on.** A
  finding sorted ASK you park yourself (§ 4). A runner parks its own and sends you each at once, in a message
  that starts `Q<n>:`; its hand-back repeats them (`QUESTIONS:`). Tell the owner each question when you learn
  of it: what is asked, the options with the recommended one first, and what waits for it. After a runner's
  `Q<n>:` message that is all: end your turn.
- **Record an answer at once,** also while a runner works: `tdd put --pr <id> --section Open --key "<key>"
  --value "answered: <the decision> · still to do: <what>"`.
- **A full stop** is where the round stands still for the owner: `NOT THIS ROUND'S COMMITS`, `BLOCKED`,
  `NEEDS_OWNER`, a failed close check, and when only questions are left. There, and only there, use ONE
  AskUserQuestion dialog: the stop's own question, then every question Open still holds. Each question stands
  on its own: what is asked, and its options, the recommended one first. Four questions per dialog at most;
  the next dialog follows at once. Details go in your text above it.

## Outcomes (`tdd route` decides)

| Outcome | When | What happens |
|---|---|---|
| **FIX** | both checks confirm it and find its fix local, not large, with no spec or contract change | § 3, then its reply |
| **DECLINE** | both checks refute it with evidence that holds when you open it (§ 2) | its reply, with the evidence |
| **ASK** | everything else, and a guard test the implementer disputes | § 4: the owner decides |

## Your commands

`$ARGUMENTS`: the pull request's number, then `source=pr|chat` (`once.md` § 0).

`tdd` stands for `node .claude/skills/tdd-apply/scripts/tdd.mjs`, run from the repository root. The command
comes first, then always `--pr <id>`, the PR's number (only `tdd route` takes none).

- `tdd get --pr <id> --section "<name>" [--section …]`: the triage's state file by section: Resume here,
  Run, Agents, Open, Allowed failures, and one `Round <n>` per round.
- `tdd set --pr <id> --section "<name>" --text "<text>"` (a long text: `--stdin` in place of `--text`),
  `tdd put --pr <id> --section "<name>" --key "<key>" --value "<value>"`,
  `tdd drop --pr <id> --section "<name>" --key "<key>"`.
- `tdd route --reports <folder> --ids <number>[,<number>...]` (§ 2).
- `tdd commit --pr <id> --type docs --tag <review|plan> --summary "<text>" --path <file> [--path …]`.

In a text you pass (`--text`, `--value`, `--summary`), write paths with forward slashes, never start with
`/`, and use no quote, backtick or `$`. In `--text` and `--value`, `\n` is a new line.

## 0. Prepare, and 1. Gather

Once per round: read `once.md` now and follow its § 0 and § 1.

- `tdd triage-init` ends its line with `| work: <absolute path>`: the **work folder**, which may be an
  earlier session's. Use it for everything from then on: the findings, the diff, the reports, the reply and
  summary texts.
- § 1 ends with the round's findings in the state file. Whenever a finding moves on, write its line again:
  `tdd put --pr <id> --section "Round <n>" --key "<number>" --value "<file:line> · <title> · <outcome so
  far> · <commits> · <reply>"`.

## 2. Check and sort

1. Call the Workflow tool with `name: "triage-review-verify"` and these `args`:

   ```json
   { "pr": 123, "change": "<change>", "findingsPath": "<work folder>/findings.json", "ids": [1, 2, 3],
     "diffPath": "<work folder>/diff.patch", "intentPaths": ["<each intent file>"],
     "reportsDir": "<work folder>/reports" }
   ```

   Without a change, `"change": null`. The call returns at once, with a task id: tell the owner in a line
   what runs, and end your turn. The result arrives in a later notice: `{ pr, ids, reportsDir, merged,
   affects, newFindings, missing, together }`. Each finding's two reports are then
   `<reportsDir>/<number>-1.md` and `<number>-2.md`. Unless all four lists are empty and `together` is
   `done`: `rare.md` § What the workflow found, before you sort.
2. `tdd route --reports <reportsDir> --ids <number>[,<number>...]` prints one line per finding, `<number> →
   FIX · <kind>`, `→ DECLINE · <reason>` or `→ ASK · <reason>`, then the counts. Never sort a finding
   yourself.
3. **Before you act on a DECLINE,** read its two report files and open exactly what their `EVIDENCE` lines
   cite: the lines at a file:line, the named test, the decision's passage. Evidence that holds and covers
   the finding: post its reply now (§ Replies). Evidence that does not: the finding is ASK.
4. Write every finding's line again with its outcome, and show the owner the routing in one table. Do not
   wait: park and tell the ASK findings (§ 4), then start the fix round (§ 3). Without a FIX finding, go on at
   § 3 step 5.

## 3. The fix round

1. Start a `runner` with the Agent tool. The brief, and nothing more:

   ```
   PR: <id>
   CHANGE: <change | none>
   INTENT: <the intent files, absolute paths>
   FIX ROUND: round <n>
   TAG: review
   RECORD: --section "Round <n>"
   PAIR: fresh
   BASELINE: <run | done>
   MAY FAIL: <none | one line per finding: <number> · <its red commit> · <its guard tests' names>>
   CLOSE CHECKS: <no | since <the PR's headRefOid>>
   FINDINGS:
   <none, or each finding's entry, ordered by file>
   ```

   A finding's entry; its last three lines only when they apply:

   ```
   <number> · <kind> · <file>:<line> · <title>
   FINDING: <number> in <work folder>/findings.json
   REPORTS: <reportsDir>/<number>-1.md, <reportsDir>/<number>-2.md
   MERGED: <the group's one cause>
   AFFECTS: <the other finding's number>: <how>
   OWNER: <the owner's answer, and its plan commit>
   ```

   - `BASELINE: run` while `Round <n>` has no `baseline` entry, `done` after. `MAY FAIL: none`, except in a
     restart.
   - `CLOSE CHECKS: since …` in the round's last message, the one you send when Open holds no question. If
     one was open then, resume the runner at the end with `FINDINGS: none` and that line. After any later
     commit, yours or a runner's, they run once more. A round without a commit needs none.
2. `tdd put --pr <id> --section Agents --key "round <n> runner" --value "<agent id>"`. End your turn.
3. Each notice that the runner stopped ends with `<usage><subagent_tokens>N…`: its context size. Past
   **200,000** with the round not done, resume it with `END THE CHAPTER after the slice in progress.`
4. Act on the hand-back, in this order (`rare.md` § Stops has each full stop):
   - `QUESTIONS:`, `DISPUTES:` and `FOR THE OWNER:`: tell the owner.
   - `BASELINE:` and `CLOSE CHECKS:`: `tdd put --pr <id> --section "Round <n>" --key <baseline |
     close-checks> --value "<the line>"`. A failed check is a full stop.
   - `FINDINGS:`, each line. `fixed …`: its reply. `refuted by its guard test …`: a DECLINE on that test,
     its reply. `guard removed <commit>: declined` and `guard removed <commit>: deferred`: its reply, in the
     words of the owner's answer; its line names that commit. `handed back: …`: a docs finding under
     `openspec/` is yours to fix (`rare.md` § Answers); any other is ASK (§ 4). `blocked, Q<n> …` and `waits
     for Q<n>`: parked already. `not started`: a fresh runner's.
   - `RESULT` other than `FIX_ROUND_DONE`. `FIX_ROUND_ENDED_EARLY`: tell the owner its `WHY` in a line, never
     ask. `BLOCKED` and `NEEDS_OWNER`: a full stop.
5. Then: with findings still to fix, the next message; with only questions left, § 4 step 3; else § 5. A
   later message goes to the same runner, from `FIX ROUND:` on. Findings `not started`, a runner past 200,000
   tokens or one that cannot be resumed: a fresh runner, with the whole brief.

## 4. The findings that need the owner

1. **Park** each ASK finding: `tdd put --pr <id> --section Open --key "<number>" --value "<the finding in a
   line> · ASK: <the reason>"`, and tell the owner in plain text: the finding in two or three sentences, both
   sides, your recommendation. The fix round runs meanwhile.
2. **Act on an answer** (more on each: `rare.md` § Answers). What changes the working tree waits for the
   runner's hand-back; a reply does not.
   - **Fix now:** the finding joins the next fix round, with an `OWNER:` line. A change to a spec or a
     `design.md` comes first: edit the passage and commit it with `--tag plan --summary "<number>: <what
     changed>"`.
   - **Decline:** its reply.
   - **Defer:** to an issue (show the owner its text, create it on their word with `gh issue create`), or as
     a heads-up in the `design.md` of the step it belongs to (commit it with `--tag review --summary
     "<number>: heads-up for <step>"`); then its reply.
   - **A runner's question:** resume the runner with `ANSWER: Q<n>: fix now: <the test stands | what the
     test must say>`, `ANSWER: Q<n>: declined: <the reason>` or `ANSWER: Q<n>: deferred: <where>`. The
     runner drops its own entry.

   Drop a finding's entry once its answer is carried out, and before a message takes it into a fix round:
   `tdd drop --pr <id> --section Open --key "<number>"`.
3. **When only questions are left:** the full stop's dialog, one question per finding (a merged group is one)
   with the options fix now · decline · defer to an issue · defer as a heads-up; a runner's question has its
   own `OPTIONS`.

## Replies

A finding's thread gets its reply as soon as the finding ends. Write the text to `<work
folder>/reply-<number>.md` and post it: `node .claude/skills/triage-review/scripts/reply-finding.mjs <PR>
<comment id> <that file> <yes|no>`; `yes` resolves the thread. The comment id is the finding's `commentId` in
`round.json` (Grep `"(id|commentId)":` there). Then write the finding's line again.

The gather reads a finding's outcome from its reply's first words. So a reply starts exactly as below, and
nothing else you post in a thread starts so:

```
Fixed in `<sha>`: <summary>; guard test `<name>`
Declined: <the evidence>
Declined by the owner: <the reason>
Deferred to <#<issue> | <step>'s design, `<sha>`>
Undecided: <what the owner still has to decide>
```

Each goes with `yes`; `Undecided:`, for an ASK the owner left open at the close, goes with `no`. A fix
without a guard test leaves that part out.

## 5. Close

When every finding has ended or the owner left it open, and the close checks ran: follow `once.md` § 5.

## Scripts

The scripts are in `.claude/skills/triage-review/scripts/`; each file's header has the details. Run each
as it is, as one Bash call from the repository root: never rewrite or inline one, and never post to the PR
another way. An `ERROR:` line says what failed: fix that cause, or stop and report; never work around the
script. The three that post refuse a text that would make GitHub post a backlink outside this
repository, and say how to rewrite it.

- `gather-findings.mjs <pr> <work-folder>`
- `post-findings.mjs <pr> <chat-findings-file> [--dry-run]`
- `reply-finding.mjs <pr> <comment-id> <body-file> <yes|no> [--dry-run]`
- `post-summary.mjs <pr> <body-file> [--dry-run]`
