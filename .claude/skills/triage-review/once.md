# Review triage: the steps that happen once in a round

`SKILL.md` beside this file holds the role, the rules, the commands (`tdd`) and the loop that repeats for the
findings: the check, the sorting, the fix round, the questions and the replies. It sends you here for the
steps that happen once in a round, § 0 and § 1 at its start and § 5 at its end, for the scripts that read and
post on GitHub (§ The scripts), and for the form of a reply (§ Replies), which you need whenever a finding
ends. The cases that only some rounds have are in `rare.md`, of which you read one section at a time, as
`SKILL.md` says. Every rule of `SKILL.md` holds here too.

## The scripts

The triage's own scripts are in `.claude/skills/triage-review/scripts/`: `gather-findings.mjs`, and the three
that post, `post-findings.mjs`, `reply-finding.mjs` and `post-summary.mjs`. Each file's header has the
details. Run each as it is, as one call of the Bash tool from the repository root: never rewrite or inline
one, and never post to the PR another way. An `ERROR:` line says what failed: fix that cause, or stop and
report; never work around the script. The three that post take `--dry-run`, and refuse a text that would make
GitHub post a backlink outside this repository, saying how to rewrite it.

## 0. Prepare

The arguments: first the pull request's number; if it is missing, the current branch's (`gh pr view --json
number`); if there is none, that is a full stop: ask the owner for it. Then `source=pr|chat` (default `pr`),
which says where the review's findings are: `pr`, in the PR's review threads, as `/code-review --comment`
posts them; `chat`, in a review's reply in this conversation (`rare.md` § A review from the conversation).

Steps 1 to 3 only read. A check that fails is a full stop (SKILL.md § Questions for the owner): tell the
owner what failed, and ask in the dialog what to do. Up to step 4 the round has no state file, so such a stop
is recorded nowhere.

1. `gh pr view <PR> --json number,title,state,headRefName,headRefOid,baseRefName,url,body`. You must be on the
   PR's head branch (`git branch --show-current`), never `main`, with a clean tree: `git status --porcelain`
   prints nothing, or only `.review-triage.md` in the change's folder: the triage's state file, which a round
   that stopped leaves changed.
2. The change: the folder `openspec/changes/<change>/` or, once archived,
   `openspec/changes/archive/<date>-<change>/`, that the PR's body or its branch names.
   - With a change, the **intent files** are its `proposal.md`, its `design.md` and every `specs/**/spec.md`
     in it (Glob), as absolute paths. The scope of the round's commits is the change's number part (`c018`);
     the script takes it from the change's name.
   - Without one, the scope is the one the PR's own commits carry (`docs/conventions/workflow.md` § 3): a
     step's id in lower case (`c13`) or, for work that lives only in a GitHub issue, `i` and the issue's
     number (`i67`). The one intent file is the text of the issue the PR closes or belongs to, saved in step
     6: nothing is read from `pm/roadmap.md`. If neither the PR's body nor its branch names that issue, that
     is a full stop too: ask the owner which issue it is.
3. The round `<n>`: each closed round left one summary comment headed `## Review triage`, and the round is
   their count plus one:
   `gh pr view <PR> --json comments --jq '[.comments[].body | select(startswith("## Review triage"))] | length'`.
   The work folder you propose is `<your scratchpad>/triage-review/<PR>/` in round 1 and
   `<your scratchpad>/triage-review/<PR>-r<n>/` in round n: an absolute path with forward slashes.
4. Start the round, before anything is gathered: `tdd triage-init --pr <id> --round <n> --work <the folder
   you propose> --change <change>` or, without a change, `tdd triage-init --pr <id> --round <n> --work <the
   folder you propose> --scope <scope>`; add `--source chat` when `source=chat` was given. It creates the
   triage's state file, or keeps the one that is there, and indexes the code graph.
   - Its line ends with `| work: <absolute path>`. That path is the **work folder** from now on, for
     everything: the findings, the diff, the reports, the reply and summary texts. It is the folder you
     proposed or, when the work folder of a round that stopped still exists, that one, which may be an
     earlier session's.
   - Then the npm installs, at every start of the skill and before anything else: `tdd install --pr <id>`,
     with the Bash tool's `timeout` set to 600000. The script checks the installed packages of every folder
     with a `package-lock.json`, and installs by itself where they are missing or behind the lockfile. When
     the install of every folder is in order at the end, and only then, it prints a line that starts
     `installs in order |`. Go on only when the output holds that line, never by the lines before it. For
     anything else (no such line, or a command the tool moved to the background) follow
     `.claude/skills/tdd-apply/once.md` § The npm installs from its step 2, the command being run already:
     Grep that file for `^## `, and Read that section only.
   - The state file is read and written only through `tdd … --pr <id>`, with a change and without one alike:
     never with Read, and never as a whole.
   - Then read `tdd get --pr <id> --section "Round <n>" --section Open --section "Resume here"`. If `Round
     <n>` already holds findings, this round was started before: `rare.md` § A restart. Otherwise "Resume
     here" is empty or an earlier round's: set it now, as from here on at every point SKILL.md § Rules for
     you names: `tdd set --pr <id> --section "Resume here" --text "Main session: round <n> has started ·
     nothing runs · next: once.md § 0 step 5, then § 1"`.
5. Record the attribution lines your context gives you for commits, so every commit carries them:
   `tdd put --pr <id> --section Run --key "Commit trailers" --value "<line 1>\n<line 2>"`.
6. The diff: `git fetch origin <baseRefName>`, then
   `git diff origin/<baseRefName>...HEAD > "<work folder>/diff.patch"`. Without a change, also the issue:
   `gh issue view <issue> --json title,body > "<work folder>/issue.json"`. You read neither file. And the
   folder the checks save their reports to: `mkdir -p "<work folder>/reports"`.

There is no baseline here: the runner runs it at the start of the first fix round.

## 1. Gather

The findings live in the PR's review threads, one per top-level review comment.

1. A review whose findings are only in this conversation is posted to the PR first: `rare.md` § A review
   from the conversation.
2. `node .claude/skills/triage-review/scripts/gather-findings.mjs <PR> <work folder>`. It changes nothing on
   GitHub and nothing in the working tree. It writes into the work folder `findings.json` (the findings that
   go to the check, an array of `{ id, commentId, path, line, title, body, … }`), `round.json` (every finding
   of the round, with its class) and `comments.json`. It prints:
   - `FINDINGS: <n> open …`, and below `LEFT OUT: …` one line per finding to check: its number, its
     `<file>:<line>` (the file alone for a finding on a whole file, which has no line) and its title;
   - `ROUND: <n> · …`: the same `<n>` as § 0 step 3 gave; if it differs, that is a full stop: tell the owner
     both numbers, and ask in the dialog;
   - one line for every finding of the round that does not go to the check, starting with its class in
     capitals;
   - `NOT THIS ROUND'S COMMITS: …`, when the branch holds a commit after the PR's head that is not this
     round's own.
3. `NOT THIS ROUND'S COMMITS` is a full stop (`rare.md` § Stops). For every line of a class, `rare.md` § The
   gather's classes says what that finding is owed. Do that before step 5.
4. Nothing to check and no line of a class: there is nothing to triage. `tdd put --pr <id> --section Run
   --key Status --value done`, tell the owner, and stop. With a change, tell the owner also that § 0 left the
   change's `.review-triage.md` in the tree, uncommitted.
5. Write the round's findings into the state file in ONE call. Write the lines into `<work folder>/round.md`
   with the Write tool, one line per finding of the round, of every class:

   ```
   - **<number>:** <file:line> · <title> · <outcome so far> · <commits> · <reply>
   ```

   Then `tdd set --pr <id> --section "Round <n>" --stdin < "<work folder>/round.md"`.
   - `<title>`: the finding in a few plain words of your own, with no quote, backtick or `$`: it travels on
     command lines, in this line and in the fix round's message.
   - `<outcome so far>`: `to check` at first. Then what `tdd route` printed (`FIX · <kind>`, `DECLINE`, `ASK ·
     <reason>`), then how it ended: `fixed`, `declined: <the evidence in a few words>`, `declined by the
     owner`, `deferred to <where>`, `left open`. The runner writes a finding's line itself when it ends its
     work on it, in its hand-back's words, with `reply owed` at its end.
   - `<commits>`: the finding's commits, short; `—` while there are none.
   - `<reply>`: `reply owed`, then `posted` (and its thread resolved) or `posted, thread open`.

   From then on a finding's line is written again whenever the finding moves on, with `tdd put` (SKILL.md
   § 0). The section also takes two entries that are not findings, `baseline` and `close-checks` (SKILL.md
   § 3 step 4). Writing the section anew, as this step does at every start of the skill, leaves them out: the
   baseline and the close checks then run again.

Then SKILL.md § 2, with the findings to check. With none to check (a restart whose findings are all past the
check), go on at SKILL.md § 3 step 5.

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

Each goes with `yes`; `Undecided:`, for a finding the owner left open at the close, goes with `no`. A fix
without a guard test leaves that part out.

## 5. Close

The round closes when every finding of it has ended or the owner left it open, and the close checks ran after
the round's last commit (SKILL.md § 3; a round without a commit has none). It does not close while a runner's
question is open: `tdd get --pr <id> --section Open --section "Allowed failures"` must show no `Q<n>` entry and
no test. A blocked finding's red guard test is in the branch, so the owner has to answer that question first
(`rare.md` § Answers).

1. Post the replies that are still owed (§ Replies above). An ASK finding the owner left open gets its
   `Undecided:` reply with `no`, so its thread stays open; note `left open` in its line, and drop its entry
   from Open. A FIX finding that waited for that answer (`rare.md` § What the workflow found) stays open with
   it, in the same way: its reply is `Undecided: waits for the decision on finding <number>`.
2. Check the threads themselves, which outlive the session:
   `node .claude/skills/triage-review/scripts/gather-findings.mjs <PR> <work folder>/close` (a folder of its
   own, so the round's `findings.json` stays as it is). Of this round's findings it must list as findings to
   check exactly the ones that stay open: the asks the owner left undecided, the findings that wait for them,
   and a finding the owner decided to leave for the next round. It must print no `REPLY OWED` line and no
   `RESUME AT …` line, and a `RESOLVED BY HAND` or `UNCLEAR` line only for a finding the owner decided to
   leave as it is. Otherwise: post the reply that is owed, or tell the owner what the line says.
3. The summary comment. Write it to `<work folder>/summary.md`:
   - its first line is the heading `## Review triage`, in a later round `## Review triage, round <n>`: the
     next round counts these headings;
   - then the findings table, one row per finding of the round, the ones the gather took back as `HANDLED`
     included. Its heading row starts `| # |` and every row starts with the finding's number (a merged group:
     `3, 7`), which the next round's gather reads:

     ```
     | # | Finding | Outcome | Evidence or commit |
     |---|---|---|---|
     | 3 | <the finding in a few words> | Fixed | `<sha>`, guard test `<name>` |
     ```

   - then the counts per outcome, and the checks that ran: the baseline's totals and each close check, from
     the `baseline` and `close-checks` entries of `Round <n>`.

   Never bank data, secrets or personal data in it. Post it:
   `node .claude/skills/triage-review/scripts/post-summary.mjs <PR> <work folder>/summary.md`.
4. `tdd put --pr <id> --section Run --key Status --value done`, and
   `tdd set --pr <id> --section "Resume here" --text "Main session: round <n> is closed, its summary posted.
   <what stays open, and that pushing is the owner's>"`.
5. Commit: `tdd commit --pr <id> --type docs --tag review --summary "triage summary" --path <file> [--path
   <file> …]`. The files: with a change, its state file, `openspec/changes/<change>/.review-triage.md` (in the
   archive folder once the change is archived); and close-out docs you changed in this round (a memory file,
   for instance). Without a change there is nothing of the state file to commit. With no file at all, skip the
   commit. Never run it without `--path`.
6. Report to the owner: the counts per outcome; the round's commits and the fix range `<first sha>..<last
   sha>`, in case they want another `/code-review` on it, which a next round then triages (for a change, such
   a round comes before `/opsx:archive`); the checks; what stays open. Never push, never open a PR or mark one
   ready: the owner does.

   The report also tells the owner what the check noticed and nobody followed up. Read the check's saved
   results, `together.json` and, after a second run of the workflow, `together-2.json` (Glob `<work
   folder>/together*.json`; `rare.md` § What the workflow found), and name every one of these, a line each,
   under a heading of its own: each line of `noticedOutside`, which is a side remark that holds and is not
   this pull request's to fix; and each entry of `newFindings` that did not become a finding of the round.
   None is dropped and none is shortened to a count: the owner decides which of them becomes an issue. A
   round without a saved result has nothing of this kind to tell.

