# Review triage: the cases that come up now and then

What `/triage-review`'s main session needs only when a case comes up. `SKILL.md` and `once.md` beside this
file send you here, each time to one section. **Read only that section:** Grep this file for `^## `, then
Read from that heading's line to the next heading's. Every rule of `SKILL.md` holds here too.

The sections: A review from the conversation · What the workflow found · The gather's classes · A restart ·
Answers · Stops · Another effort level.

## A review from the conversation

When this conversation holds a `/code-review` reply whose findings are not on the PR (it ran without
`--comment`), or `source=chat` is given, post its findings to the PR first, whatever threads an earlier round
left open. Each then has a thread, a number and a reply like any other finding. With `source=chat` and no
review in this conversation, that is a full stop (SKILL.md § Questions for the owner): say so and ask the
owner where the findings are; never guess.

1. Write them to `<work folder>/chat-findings.json`, in the review's order. Never drop or merge one.

   ```json
   [{ "path": "<file>", "line": 42, "body": "<the finding verbatim>" }]
   ```

   - `body`: the finding verbatim: its first line the severity and a one-line summary, as `/code-review
     --comment` writes them, then the failure scenario. The one exception is a reference the script refuses
     because it would post a backlink outside this repository: rewrite it as the refusal says.
   - `line`: the line in the PR's new version, or `null` for the whole file.
   - `path`: a file the PR changes. A finding on a file the PR does not change goes on the changed file it
     concerns.
2. Run `node .claude/skills/triage-review/scripts/post-findings.mjs <PR> <work folder>/chat-findings.json
   --dry-run` and check the plan it prints, one line per finding: on its line when the line is in the PR's
   diff, else on its file. The round's commits stay local until the owner's one push at the end, and nothing
   waits for that push: the script finds each line in the PR's head on GitHub and, when the round's commits
   moved or added it, notes both places in the body by itself. A finding that does not land on its real place
   for another reason, because it moved to another file or its line is outside the diff, names that place
   (`<file>:<line>`) in its body, below the first line, which the gather takes as its title. Correct the file
   and run the dry run again until the plan is right.
3. Run it without `--dry-run`. It skips a finding this round already posted, so after a failure part-way,
   running it again posts only the rest.

## What the workflow found

The workflow's result holds four lists that its last agent made from all reports together (`newFindings`,
`noticedOutside`, `merged`, `affects`), the list `missing`, and `together`. You saved it to `<work
folder>/together.json` when it arrived (SKILL.md § 2 step 1). Whenever you need it again, Read that file:
after a compaction, and for the `MERGED` and `AFFECTS` lines of a finding that joins a later fix round.

**No result.** A notice that says the workflow failed, or that brings no result, is a full stop (SKILL.md
§ Questions for the owner): tell the owner what the notice says, and run the workflow again on their word.
Sort nothing from a run that did not end.

**`newFindings`, before you sort.** Side remarks of the verifiers (their reports' `ALSO NOTICED` lines) that
hold after that agent checked the code path, each as `{ path, line, body }`. Each becomes a finding like any
other:

1. Write the list to `<work folder>/new-findings.json` as the workflow returned it.
2. Post it as this file's § A review from the conversation says in its steps 2 and 3, with that file.
3. Run the gather again (`once.md` § 1 step 2, the same folder): the new findings are in its list, with the
   next numbers. Add each one's line to `Round <n>` with `tdd put`.
4. Run the workflow again with those numbers alone as `ids`, the other args as before, and end your turn
   until its result arrives (SKILL.md § 2 step 1). Save that result as it is to `<work
   folder>/together-2.json`, beside the first run's. Its `merged`, `affects`, `noticedOutside` and `missing`
   count with the first run's. Tell the owner what its `newFindings` say, a line each, and do nothing more with them:
   they are not chased further, and the close names them once more (`once.md` § 5 step 6).
5. Then sort the first run's findings and the new ones in one `tdd route` call (SKILL.md § 2 step 2), with a
   `--merged` for each group of either run and the `missing` numbers of both in `--missing`.

**`merged`, when you sort.** Each entry, `{ ids, cause }`, is a group of findings with one cause that one fix
settles. Give every group to the sorting, its numbers in ascending order and joined by `+`, one `--merged`
per group: `tdd route --reports <reportsDir> --ids 3,5,7 --merged 3+7` (SKILL.md § 2 step 2; `--ids` names
every finding as before, the group's too). The script decides a group's outcome, by the same tested rule as
in the apply's chapter review; you never do. What it prints, and what follows from it:

- It prints one line for the group, under the key `3, 7`: its numbers in ascending order, joined by a comma
  and a space. The outcome is ASK when any of its findings is ASK, and the reason then names each such
  finding (`3, 7 → ASK · 7: <its reason>`); otherwise it is the outcome they all have. A FIX's kind is
  `behaviour` when any of them has it, else the first one's.
- A group whose findings came out FIX and DECLINE is not merged. The script prints each of them on a line of
  its own, and then the line `3, 7: not merged, their outcomes differ`. Handle each on its own, and tell the
  owner so in a line.
- A group's DECLINE holds only when the evidence of every finding in it holds: before you act on it, read
  both report files of each (SKILL.md § 2 step 3).
- From then on a merged group is one finding, under the key the script printed: in `Round <n>` (drop the
  findings' own lines with `tdd drop` and put one line under that key), in Open (its entry names the report
  files of each finding), in the routing table, in a question (one question for the group) and in the fix
  round's message.
- Its entry in the fix round's message starts `3, 7 · <kind> · <file>:<line> · <title>`, with the place of
  its first finding and the kind the script printed. It has one `FINDING:` and one `REPORTS:` line for each
  number, and the line `MERGED: <the cause>`. The runner's commits then name both numbers (`[review] 3, 7:
  …`), and the gather counts such a commit for each of them.
- Every thread of the group gets the reply, each with the same text.

**`affects`.** Each entry, `{ ids, how }`, is a group of findings that stay separate but whose fixes touch
each other. In the fix round's message each of them gets one line per other finding of the group: `AFFECTS:
<that finding's number>: <how>`. The runner then takes them one right after the other.

They stay separate as questions too: only a merged group is one question. When two or more of the group are
ASK, tell them to the owner right after each other, and put their questions next to each other in the
dialog. Each names the other finding and says how the two fixes touch, and each gets an answer of its own.

When one finding of the group came out ASK, the group's FIX findings wait for its answer, which may change
how they must be fixed. Whenever you are in doubt whether a fix depends on the answer, it does. For each FIX
finding that waits:

- Leave it out of the fix round, and write `FIX · <kind>, waits for <the ASK finding's number>` as the
  outcome so far in its line.
- Name it in the question as waiting for the answer, and in that question's entry in Open: its value
  (SKILL.md § 4 step 1) gets one more part at its end, ` · waits: <the numbers of the findings that wait>`.
- Until the answer is there it does not count as a finding still to fix (SKILL.md § 3 step 5): with nothing
  else to fix, only questions are left.
- When the answer is there, it goes into the next fix round: after "fix now" together with that finding, each
  with its `AFFECTS` line; after a decline or a deferral on its own, without the `AFFECTS` line for that
  finding and with a line that tells the runner the decision: `OWNER: <the ASK finding's number> was
  declined | deferred: <the reason>; fix it on its own`.
- When the owner leaves the question open at the close, it stays open too (`once.md` § 5 step 1).

**`noticedOutside`.** Each line, `<file>:<line> · <what is wrong>`, is a side remark of a verifier that holds
but is not this pull request's to fix: the defect lies in code the pull request neither changes nor depends
on, or it is a new finding beyond the ten the workflow returns. It is not a finding of the round: do not
post it, check it or fix it. It is not dropped either: at the close you tell the owner every line and name
each in your report (`once.md` § 5 step 6).

**`missing` and `together`.** `missing` names the findings a check returned nothing for. Give them to the
sorting, the numbers joined by commas: `tdd route --reports <reportsDir> --ids 3,5,7 --missing 5` (SKILL.md
§ 2 step 2; they stay in `--ids` too). `tdd route` then makes each of them ASK ("a check returned no
result"), whatever report files the folder holds: a work folder kept from an earlier run of this round may
still hold such a finding's old reports, and those must not be sorted. It also makes ASK a finding whose
report file it cannot read, which it names in a line that starts `route:`. Tell the owner that as the reason.
`together` is `done` when the last agent answered. Anything else means nobody compared the findings: the four lists are empty, and you
tell the owner so in a line.

## The gather's classes

The gather sorts every finding of the round into one class, from the PR's threads and the commits after the
PR's head. In a round's first run every finding is to check, but for a thread somebody resolved by hand. The
other classes come up in a restart (this file's § A restart). The gather prints a line per finding of another class,
starting with the class in capitals, then the finding's number and place, what the class rests on, and after
`owed:` what the finding is owed. `round.json` has the same per finding (`class`, `outcome`, `commits`,
`mayFail`, `replyText`): Grep for the field you need, never Read the file whole.

| The gather says | What you do |
|---|---|
| a finding to check (in the list under `FINDINGS:`) | It goes to the check (SKILL.md § 2). In a restart, first look at its earlier line in `Round <n>` and at Open: if they say it was declined, declined by the owner or deferred to an issue, which leaves no commit, only its reply is owed: post it (`once.md` § Replies) and do not check it again. Any other is checked again; an answer the owner already gave holds whatever the new sorting says. |
| `HANDLED` | Its thread is resolved and its reply gives the outcome. Write its line with that outcome and its commits, `posted`. Neither check it nor answer it again. |
| `REPLY OWED` | Its commits say how it ended; only the reply is missing. Post it now and write its line. The text: `replyText` in `round.json` when the line says so (the body of its `guard removed` commit, the reply in full); otherwise build it from the outcome and the commits (`once.md` § Replies). A fix's guard test is named in its `red` commit's body, on a line `Guard test: <name>` (`git show -s --format=%b <sha>`). |
| `RESUME AT THE TEST-WRITER` | The owner chose "fix now" in the earlier run, and the `[plan]` commit is there. It goes into the fix round (below). |
| `RESUME AT THE IMPLEMENTER` | Its guard test is committed and red. It goes into the fix round (below). The exception: Open holds a runner's question about it (`Q<n>`, the implementer disputes the test) with no answer yet. Then it stays parked; tell the owner the question again. |
| `RESOLVED BY HAND` | Its thread was resolved without a reply and without a commit. A question for the owner, parked under its number: triage it, or leave it? Leave it: write `left as it is, resolved by hand` in its line. Triage it: the owner unresolves its thread. If the fix round has not started, gather again (`once.md` § 1 step 2) and check it with the rest. Later, it stays open for the next round: write that in its line, and count it among the findings left open at the close. |
| `UNCLEAR` | The rules do not cover it; the line says why. A question for the owner, parked under its number, with that reason. Guess nothing: act on the owner's answer. |

**Every line with a `may fail:` part,** whatever its class, gives the fix round's message a `MAY FAIL` line:
that red guard test is in the branch, and the baseline must allow it. The line is `<number> · <the red
commit> · <the guard tests' names>`: the names are what `may fail:` lists in backticks; when it lists files
instead, the line ends after the commit, and the runner asks for the names.

**The entry of a resumed finding** in the fix round's message (SKILL.md § 3) differs in three lines, because
the gather did not send it to the check:

- `FINDING: <number> in <work folder>/round.json`: there the finding is the element of `findings` with that
  `id`;
- `REPORTS:` its two report files when the work folder still has them from the earlier run (Glob `<work
  folder>/reports/<number>-*.md`), else `REPORTS: none, it was checked in an earlier run`;
- `OWNER: fix now, decided in an earlier run`, with `· plan commit <sha>` after a `[plan]` commit.

Its kind is `behaviour`.

## A restart

`/triage-review <PR>` again, for a round that stopped before its summary; in a new session if need be.
`once.md` § 0 and § 1 run as written. The round's number is the same, because its summary is not posted. The
gather says where every finding stands from GitHub and git (this file's § The gather's classes). What left
neither a reply nor a commit is in the state file only: where the earlier session stood ("Resume here"), the
sorting, a decline that was not posted yet, the owner's answers.

- The state file outlives the session, with a change and without one: `triage-init` keeps it.
- The work folder is the one `triage-init` prints. When the stopped round's folder still exists, it is that
  one, and the earlier run's reports are still in it. When it is gone, the folder is new and empty.

After `once.md` § 0 step 4 showed that the round was started before:

1. Keep what it printed: the round's lines as they stand, Open and "Resume here". Go by "Resume here" for
   what was under way when the earlier session stopped. Whatever ran then is gone with that session, and is
   started again, never skipped: the check runs again for the findings that go to it (this file's § The
   gather's classes), and a fix round gets a fresh runner (step 3). A full stop that waited for the owner is
   put to the owner again, with its dialog, before anything is started.
2. Set "Resume here" at once, so that it no longer says that something runs: `tdd set --pr <id> --section
   "Resume here" --text "Main session: round <n> restarted in a new session · nothing runs · next: once.md
   § 0 step 5 and § 1, then the questions in Open · before the restart: <the earlier text in a few words>"`.
   From then on, set it at every point SKILL.md § Rules for you names.
3. Do not count on the agents of the earlier run, which the Agents section lists: you start a fresh runner,
   with the whole brief (SKILL.md § 3).
4. Go on with `once.md` § 0 step 5 and § 1. Its § 1 step 5 writes `Round <n>` anew, from the gather's classes
   and the earlier lines; a merged group keeps its one line.
5. Tell the owner again every question Open holds without an answer. An answer that is recorded there
   (`answered: …`) and not carried out yet is carried out now (this file's § Answers).

**A runner lost in this session** (SKILL.md § Rules for you: no hand-back came, also after you asked for
it) is the same case without a new session:

1. Set "Resume here": the runner with its id is lost, nothing runs, and the steps below come next.
2. `git status --porcelain`. A change other than the triage's state file is work the lost runner's agents
   left in the tree: that is a full stop, and the owner decides what happens to it.
3. Run `once.md` § 1 again from its step 2. The gather says where the lost runner's findings stand, and gives
   the `MAY FAIL` lines of the ones whose guard test is committed and red. Its step 5 writes `Round <n>` anew,
   from the gather's classes and the earlier lines.
4. One thing differs from a restart: a finding that the gather lists to check, and whose earlier line in
   `Round <n>` shows it sorted already, is not checked again. Its reports and its outcome stand, and its new
   line keeps that outcome.
5. Then steps 3 and 5 above: a fresh runner with the whole brief, and the questions in Open.

## Answers

The owner answers a parked finding in their own words or by an option of the dialog. A free-text answer is
the owner's own words: re-confirm it when it matters. Record the answer at once (SKILL.md § Questions for the
owner), and write it into the finding's line. The recorded answer to a runner's `Q<n>` keeps that entry's own
lines under its first line, as SKILL.md says: they name what waits for the answer and the work the runner set
aside, which a fresh runner needs. Whatever changes the working tree waits for the runner's hand-back.

This section also says what two lines of a hand-back's `FINDINGS:` ask of you: `guard removed <commit>: …`
(under "A runner's question" below) and `handed back: …` (the last paragraph).

- **Fix now.** The finding's entry goes into the next fix-round message (SKILL.md § 3) with the line `OWNER:
  fix now: <what the owner decided, in a line>`, and `· plan commit <sha>` when there is one. Its `<kind>` is
  its reports' `KIND`: when the two reports differ, `behaviour` if either says it, else the first that names
  one; when none names one (`not applicable`, or no report), `behaviour`. For a merged group, the same over
  the reports of all its findings.
  A fix that changes behaviour a spec describes, a decision in `design.md` or the API contract gets its edit
  of the spec or `design.md` first, and you make it: read only the passage (Grep for its heading), edit it,
  and commit `tdd commit --pr <id> --type docs --tag plan --summary "<number>: <what changed>" --path <file>`.
  After the archive, a spec edit goes to the main spec in `openspec/specs/` and a `design.md` edit to the
  archived change's; the archive folder stays where it is (`docs/conventions/workflow.md` § 6).
- **Decline.** The reply at once: `Declined by the owner: <the owner's reason>`.
- **Defer to an issue.** Write the issue's text into `<work folder>/issue-<number>.md`: the finding, its
  place, what the two checks found, and the step it belongs to. Like every text you post, it names no issue
  or pull request of another repository (the scripts' backlink rule; `gh` does not check it for you). Show it
  to the owner and create the issue only on their word: `gh issue create --title "<title>" --body-file
  "<work folder>/issue-<number>.md"`. Then the reply: `Deferred to #<issue>`.
- **Defer as a heads-up.** The owner says which step it belongs to. Write the heads-up into that step's
  `design.md` and commit `tdd commit --pr <id> --type docs --tag review --summary "<number>: heads-up for
  <step>" --path <file>`. Then the reply: ``Deferred to <step>'s design, `<sha>` ``.

**A runner's question** (`Q<n>`): the implementer calls a finding's guard test wrong. The runner set the
implementer's work aside, kept the red guard test as a test that is allowed to fail, and went on. The owner
has to answer it before the round closes. After the runner's hand-back, resume the runner with one line (in
a restart: the fresh runner, after its first hand-back). A runner that did not park the question itself (a
fresh one, as in a restart) does not know the finding: under that line, give it the finding's entry as a fix
round's message has it (SKILL.md § 3; for a resumed finding, this file's § The gather's classes). The line:

- `ANSWER: Q<n>: fix now: the test stands`, or `ANSWER: Q<n>: fix now: <what the test must say>`. The runner
  has the test corrected first when it must change, then the fix. Its hand-back reports the finding `fixed`.
- `ANSWER: Q<n>: declined: <the owner's reason>`. The runner takes the guard test out, in a commit whose
  body is the reply, and its hand-back reports the finding `guard removed <commit>: declined`. Then post the
  reply, `Declined by the owner: <the reason>`, and name that commit in the finding's line.
- `ANSWER: Q<n>: deferred: <where>`, where `<where>` is `#<issue>` or `<step>'s design`. For an issue, create
  it first, as above; its text also names the guard test, its `red` commit and the implementer's claim. The
  runner takes the guard test out, in a commit whose body is `Deferred to <where>`, and its hand-back reports
  the finding `guard removed <commit>: deferred`. Then, for a heads-up, write and commit it as above, after
  the runner's commit and never before it. Then post the reply, `Deferred to <where>`, and name the commits
  in the finding's line.

The runner drops its `Q<n>` entry and takes the test off the list of allowed failures. You drop the entry of
a finding you parked yourself (SKILL.md § 4).

**A docs finding under `openspec/` that a runner handed back** is yours, because neither the runner nor the
implementer writes there: read the finding and the passage, fix it, and commit `tdd commit --pr <id> --type
docs --tag review --summary "<number>: <summary>" --path <file>`. Then its reply, `Fixed in …`. Any other
finding a runner handed back (it would need a new acceptance scenario, for instance) is ASK: park it and
tell the owner (SKILL.md § 4).

## Stops

At a full stop (SKILL.md § Questions for the owner) you tell the owner what stopped the round, and ask in the
one dialog, the stop's own question first. Record the stop before you ask (SKILL.md § Rules for you): its
"Resume here" text holds the stop's own question, so that a new session can put it again. This section has
the stops of the gather and of a runner. The others are told where they arise: a failed check at the start
in `once.md` § 0 and § 1, a check that brings no result in this file's § What the workflow found, and the
questions that are left in SKILL.md § 4.

- **`NOT THIS ROUND'S COMMITS`** (the gather). The branch holds commits after the PR's head that are not
  this round's `[review] <number>:` or `[plan] <number>:` commits, so the review saw other code than the
  working tree holds. Name the commits to the owner. Nothing is checked or fixed until the owner has settled
  it (pushing is the owner's); then the skill is started again.
- **`BLOCKED`** (a runner). One case is no stop, and yours to clear: a command an agent left running and
  could not stop (the hand-back names the task's id). Stop it with TaskStop (load it with ToolSearch,
  `select:TaskStop`), tell the owner in a line, and resume the runner with `CONTINUE`. Any other `BLOCKED`
  (a red baseline, a change in the tree that its brief did not name, a missing tool) is a full stop: tell the
  owner its `WHY`; once that is cleared, resume the runner with `CONTINUE`. One whose `WHY` holds a line that
  starts `ERROR: failed part-way:` (the runner's `shelve` or `unshelve` stopped half-way) is resumed
  differently: tell the owner the cause, the line's part after `The cause:`, and where the line says the
  work is; once the cause is gone, resume the runner with `CONTINUE: run the way out your BLOCKED line
  names, then go on`. Record the line in "Resume here" at the stop. A runner that cannot be resumed then: a
  fresh one, with the line and "run its way out first" after `FIX ROUND:` in its brief. One whose `WHY` says
  that an install looks incomplete is a full stop too, but first you run `tdd install --pr <id>` again
  yourself: `.claude/skills/tdd-apply/once.md` § The npm installs says how, under "After a runner's
  `BLOCKED`", and what the stop then tells the owner (Grep that file for `^## `, and Read that section only).
- **`NEEDS_OWNER`** (a runner). Tell the owner its `NEEDS` (Docker is not running, a file outside the
  repository is missing); once it is there, resume the runner with `CONTINUE`.
- **A close check that did not pass.** The hand-back's `CLOSE CHECKS:` line, which you recorded (SKILL.md
  § 3 step 4), gives each check as one of three: `ok`, `repaired: <check> for <number>, <commit>` (one for
  each repair commit after which the check passes), or `failed: <check>[ for <number>]: <what>`, which ends
  `, repair <commit> did not help` when a repair was committed and the check still fails.
  - **`repaired:`** is no stop, and all it asks of you is a line to the owner: what was repaired, and for
    which finding. A failed format, lint or type check (`dotnet format … --verify-no-changes`, the
    frontend's `lint`, `typecheck` and `format:check`) cannot change behaviour, so the runner had every file
    the check named repaired at once, by the agent whose code it is, in one commit per finding whose fix
    caused the failure. It added that commit to the finding's line in `Round <n>` itself, and it ran all
    close checks again before it handed back: a repair commit owes no further run. The finding's reply
    stands as it is: one that is posted is never posted again for a repair, whatever its line now says. A
    repair the owner ordered (under `failed:` below) comes back as `repaired:` too, and asks the same.
  - **`failed:`** is a full stop. A check passes only when its command succeeded, and two checks need more
    than that, the API client's and the Bicep check; the runner's instructions have the whole rule. For a
    failed test (a fix broke something else, or a test is unstable), a failed API client drift check (its
    command failed, or it left a generated file changed: the runner put both files back, and its part says
    which of them had changed), a failed Bicep check (its command failed, or its output holds a warning,
    whose line the part gives), a failure in a file that no fix of this round touched, a format, lint or
    type check whose command could not run, or a check that failed because a package or a tool of an install
    was not found (its part says that an install looks incomplete), the runner repaired nothing. That last
    one is never sent back to the runner as a repair either: no agent repairs an install. A part that ends
    `repair <commit> did not help` is a check that still failed after its one repair: that commit stays in
    the branch and in the finding's line. `for <number>` names
    the finding whose fix caused the failure. It is there when a repair was tried, or when the failing
    file's last commit of this round names a finding. Tell the owner which check failed and with what, and
    ask what happens to it. A repair the owner wants now goes to the runner in a fix-round message, as an
    entry under that number, with the line `OWNER: the close check <name> failed: <what failed, with its
    paths>: <what the owner decided>`. Take what failed and its paths from the `failed:` part as it stands:
    the runner reads no code. It sends a failed test to the implementer, since a failing test means the code
    is wrong, and to the test-writer only when the decision says that the test itself is to change (unstable,
    or wrong): when the owner decides so, write it in those words. Any other check goes by its paths (test
    code to the test-writer, any other to the implementer). It is no fix of the finding: the check that failed is its test, no guard test is
    written, and the runner commits it as `<number>: close check <name> repaired` and adds that commit to the
    finding's line. The finding's outcome and its reply stand. The entry's first line still needs a kind in
    its second field: write `cleanup`; the runner does not use it for such an entry. The message carries
    `CLOSE CHECKS: since <the PR's headRefOid>`, so that the close checks run once more after the repair. A
    `failed:` part without a number: no finding's fix is known to have caused it, and the owner decides what
    happens.

## Another effort level

Each agent's definition sets its reasoning effort. The owner may ask for another level for the test-writer or
the implementer at any time, in plain words. That is no question and no stop: record it, and tell the owner
what holds.

1. Record what was asked, and only that: `tdd put --pr <id> --section Run --key Effort --value
   "implementer=high"`; for both agents, `--value "test-writer=xhigh · implementer=high"`. A level is one
   the Agent tool takes: `low`, `medium`, `high`, `xhigh` or `max`. When the entry already holds a level for
   the other agent (`tdd get --pr <id> --section Run`), keep that part in the value.
2. That entry is the one source, and you pass nothing on: no line in a brief, no message to a runner. The
   runner reads `Run` each time it starts a test-writer or an implementer, and starts the agent at the level
   it finds there; with no entry for an agent, at the level its definition sets. So the entry holds after a
   compaction and in a new session too.
3. Going back to the agents' own levels: `tdd drop --pr <id> --section Run --key Effort`. For one of two
   agents only, `tdd put` again with the part that stays.
4. Tell the owner in a line what holds: every agent started from now on has the new level, and one that
   already runs keeps its own until it is replaced.
