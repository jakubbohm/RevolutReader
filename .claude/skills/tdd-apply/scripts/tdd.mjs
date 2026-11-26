// The bookkeeping command line of /tdd-apply and /triage-review: one short call at each handoff in place of
// hand-written shell, each answering in a line or two (GitHub issue 67, cut context growth in /tdd-apply). The main
// session, the runner and the runner's agents all call it.
//
//   node .claude/skills/tdd-apply/scripts/tdd.mjs <command> (--change <change-name> | --pr <id>) [--root <path>]
//        [options]
//
// Run from anywhere inside the repository; USAGE below lists the commands. The pieces live next to this file:
// state.mjs (the state files' sections), guard.mjs (the paths the implementer must not change), test-output.mjs
// (what a test run printed, and which failed tests are allowed to fail), route.mjs (the sorting rules of a review's
// findings, and how a check's report is read), review.mjs (the record of a chapter review), triage.mjs (the
// pointer to the triage under way), installs.mjs (which folders have an npm install, and whether one is what its
// lockfile says) and lock.mjs (the lock and the atomic writes). This file holds what touches the world: the
// arguments, git, the files, the code graph's command line, npm, and the commands `run` wraps.
//
// - Whose files a command works on: with --change an apply's, in the change's folder under openspec/changes (or,
//   once the change is archived, its one folder under openspec/changes/archive): the state file .tdd-state.md,
//   the chapter reviews file and tasks.md. The change's name is the folder's, letter for letter, and does not
//   start with `triage-`. With --pr a triage's: the state file `triage-init` made, which is
//   .review-triage.md in the change's folder, or for a PR without a change triage-<id>.md in the working tree's
//   git folder: one file for every round and every session of that PR, never tracked. `triage-init` leaves a
//   pointer next to it (triage.mjs), and --pr is refused when there is none or it names another PR. Never both,
//   but for `triage-init` itself.
// - A triage's work folder is some session's scratchpad, which the next session does not share. The pointer holds
//   it, and `triage-init` ends its line with `work: <the folder in use>`: the pointer's while it names one for the
//   same PR and round that is still there, else the one given with --work. No tracked file holds a path of this
//   machine for a triage: its `Run` has neither the work folder nor the repository's.
// - No state file that is committed holds a value of this machine. Such a value lives in the state file's LOCAL
//   file, in the working tree's git folder next to the lock: `<change>.local.md` for an apply,
//   `triage-<id>.local.md` for a triage, of the state file's form and never tracked. `set`, `add`, `put` and `drop`
//   write it with --local; `get` prints a section from both files, a key that both hold once and with the local
//   value, so a reader needs no flag. The script keeps the code graph's project there (`Run` / `Code graph
//   project`: init, triage-init and index write it), the design-fetcher the folders of the design files. A clone
//   on another machine has no local file: `index`, or `init` on the state file that is there, writes the project
//   again. A state file from before may still hold such a line: it is left, and the local value is the one read.
//   What the script reads for itself (the switches, the commit trailers, the tests allowed to fail) is the state
//   file's alone.
// - A refusal is one line on stderr (`ERROR: …`) and exit 1, never a stack trace (TDD_DEBUG=1 adds it). Exit 3:
//   the guard found violations. Exit 4: nothing to commit. `run` exits with its command's own code, 124 when it
//   stopped the command at its time limit, 127 when the command cannot be started. Two commands write to stderr
//   without refusing. `route`, with --reports or --chapter, names each report file it cannot read (`route: <file>
//   cannot be read as a report: …`) and, with --chapter, each one that no longer agrees with the record (missing,
//   another verdict or kind, or there though the record says `no report`); it sorts that finding as one whose
//   check returned no result, and still exits 0. `get`, asked for several sections, prints those the file has and
//   names each other one (`get: no section "<name>" in <file>; the sections are: …`); it is refused only when
//   the file has none of them. `install` answers each folder on a line of its own: one it could not check or
//   install is a line `ERROR: install: <folder> | …` on stderr, never cut, the others are still checked, and the
//   exit code is then 1.
// - Every command that writes a state file, a local file, the reviews file, tasks.md or the pointer (init,
//   triage-init, set, add, put, drop, review, commit, unguard, and index for the local file) holds the working
//   tree's lock from its first read to its last write, `commit` and `unguard` to the end of `git commit`, and every
//   file is written whole or not at all (lock.mjs). `shelve` and `unshelve` hold it too, from their first look at
//   the working tree to their last change of it. `get`, `check`, `run`, `install`, `reports`, `route`, `report`
//   and `progress` take no lock. TDD_LOCK_WAIT_MS and TDD_LOCK_STALE_MS set the lock's wait limit and stale age in
//   milliseconds: the tests use both.
// - `install` is how both skills make sure, at every start and every resume, that the packages of each npm
//   folder are installed in this checkout before an agent builds or tests (docs/conventions/testing.md § Test-first
//   workflow): an install is per checkout, so a new worktree or clone has none, and a lockfile that changed since
//   leaves one behind. It finds the folders with git (each that holds a tracked package-lock.json; installs.mjs
//   says which never count), judges each from two files alone, so that a check starts no npm, and runs `npm ci`,
//   never `npm install`, where the install is not there or not what the lockfile says. An install takes minutes
//   and needs the network, which is why it is a command of its own and no part of `init` or `triage-init`: their
//   line must reach the caller at once, and a caller gives this one the time it needs. It ends by itself at its
//   time limit, 9 minutes unless --timeout says otherwise: the tool that runs it allows a command 10 at most.
// - `report` is how a review's check saves its report: the checks are read-only agents, and this command is the
//   one way they have to write a file. So it writes nothing but a text that reads as the report of the check and
//   the finding the file's name says (route.mjs), and never inside a repository: not this one, not another one,
//   not through `..` and not through a link. A triage's reports go to its work folder, a chapter review's to the
//   chapter's reports folder, which `reports` names and creates: `<temp folder>/tdd-runs/<change>/reports/<chapter
//   in lower case>`, next to the logs of `run`.
// - `review` is how a chapter's reviewer records its findings: it writes the record into the reviews file's section
//   "Chapter <X> review" only when the record has the form review.mjs reads and agrees with the reports of the
//   findings' verifiers in the chapter's reports folder, each of which belongs to a finding of the record.
//   `route --change <c> --chapter <X>` then sorts that
//   record's findings from those reports, so no verdict is typed twice; a report that no longer agrees with the
//   record decides nothing.
// - `shelve` sets a task's uncommitted work aside while its question waits for the owner, and `unshelve` puts it
//   back. The work is a commit that no branch holds, under a ref of this working tree alone
//   (`refs/worktree/tdd/shelved/<change | triage-<id>>/<key>`: in the working tree's own git folder, never pushed,
//   gone with the working tree). Neither command touches the stash stack, the branch, or, but to take the paths set
//   aside back to the last commit, the index: both work in an index of their own. Neither ever sets aside, or
//   writes, a bookkeeping file: any state file, reviews file or triage's state file under openspec/changes, or the
//   tasks.md of its own change. What is set aside is what the files hold: a file that was staged is taken as it
//   stands on disk, and comes back unstaged. Each refuses, with nothing changed and in a line that starts
//   `ERROR: nothing was changed: `, whatever it cannot do without a loss: a change that only the index holds (an
//   untracked file kept on disk among them), an ignored file in the way, git in the middle of a merge, a merge
//   driver of the repository's own where both sides changed a file, a file whose changes git is told to overlook;
//   and `unshelve` any uncommitted change but in the bookkeeping's files, so that the way out of a put-back that
//   fails meets nothing but the put-back's own. A failure after the first change is told in a line that starts
//   `ERROR: failed part-way: `, and so is one whose first change failed when the state read again cannot show that
//   it was not made after all (a key that cannot be read again); nothing else starts so. From the state read
//   again, the line says where the work is, and what of it could not be read; the shortest way out from there,
//   "nothing is left to undo", or, where the key could not be read again and nothing needs doing either way, no way
//   out at all; and every cause. It is never cut (`setAside`, `putBack`, `throwAway`). A refusal of the call
//   itself, before either command starts (an unknown option, a missing or misspelt --change, a change whose name
//   git takes for no ref), changes nothing and starts with neither.
// - `unguard` takes a finding's guard test out again. `git revert` cannot do that here: it would also reverse what
//   the test's `red` commits did to the state file, the reviews file and tasks.md, so git refuses it while the
//   state file has uncommitted changes, and it conflicts once a later commit changed that file. The command
//   reverses the commits in every other path and leaves those three alone.
// - TDD_GRAPH_CLI names another executable for the code graph's command line, and TDD_NO_GRAPH=1 skips indexing:
//   the tests use both. The code graph is never indexed inside the lock: it can take minutes. TDD_NPM_CLI names
//   another executable for npm, which `install` starts: the tests use it. TDD_FAIL_STEP makes a step of `shelve`
//   or `unshelve`, or a reading of the state after a failure, fail, for the tests of how the two recover (`step`).
// - Never prints or stores bank data or secrets: it handles paths, test names and totals, and of a test run it
//   prints what the runner printed, cut as test-output.mjs says.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { guard, guardReport, parseStatus, STEPS } from "./guard.mjs";
import { installFolders, installState, LOCKFILE, RECORD } from "./installs.mjs";
import { readText, withLock, writeAtomic } from "./lock.mjs";
import { checkRecord, readRecord, recordFindings, recordIds, recordSummary, reviewSection } from "./review.mjs";
import {
  readFindings,
  readReport,
  readReportOf,
  reportFile,
  reportOf,
  route as routed,
  routeReport,
  waiting,
} from "./route.mjs";
import {
  addBullet,
  ALLOWED_FAILURES,
  dropKey,
  keyValue,
  newLocalText,
  newReviewsText,
  newStateText,
  overlaidBody,
  putKey,
  REVIEWS_FILE,
  roundSection,
  sectionBody,
  sectionKeys,
  sectionName,
  sectionNames,
  setSection,
  STATE_FILE,
  TRIAGE_FILE,
  triageText,
} from "./state.mjs";
import { formatDuration, runReport, stripAnsi } from "./test-output.mjs";
import { archivedAs, POINTER_FILE, pointerText, prId, prStateFile, readPointer, triageAccount } from "./triage.mjs";

const USAGE = `node .claude/skills/tdd-apply/scripts/tdd.mjs <command> (--change <change-name> | --pr <id>) [--root <path>]
     [options]

  init         --agent-review <each-chapter|acceptance|none> --human-test-review <acceptance|each-group>
               --after-chapter <continue|stop> [--issue <n>]
  triage-init  --pr <id> --round <n> --work <absolute folder> [--change <change-name>] [--scope <scope>]
               [--source <pr|chat>]
  get          --section <name> [--section <name> ...] [--file state|reviews]
  set          --section <name> (--text <text> | --stdin) [--file state|reviews] [--local]
  add          --section <name> --line <text> [--file state|reviews] [--local]
  put          --section <name> --key <key> --value <value> [--file state|reviews] [--local]
  drop         --section <name> --key <key> [--file state|reviews] [--local]
  check        --step <green|wire|close>
  commit       --type <test|feat|fix|docs|refactor|build|chore> --tag <step> --summary <text>
               [--tick <id>[,<id>...]] [--path <path> ...] [--body <text>] [--resume <text>]
               [--check <green|wire|close>] [--done <step text>]
  unguard      --tag <step> --id <id> --red <commit>[,<commit>...] --outcome <declined|deferred> --body <text>
               [--resume <text>] [--done <step text>]
  shelve       --key <key>
  unshelve     --key <key> [--drop]
  index
  install      [--dry-run] [--timeout <minutes, default 9>]
  run          --label <name> [--timeout <minutes, default 30>] -- <command> [args...]
  reports      --chapter <X> [--new]
  review       --chapter <X> --stdin
  route        (--json <text> | --in <file> | --stdin | --reports <folder> --ids <id>[,<id>...]
               [--merged <id>+<id>[+<id>...] ...] [--missing <id>[,<id>...]] | --change <change-name> --chapter <X>)
  report       --file <absolute path> --stdin
  progress     --step <step text>

--change names an apply's change: its state file, reviews file and tasks.md, in its folder under openspec/changes or,
once archived, under openspec/changes/archive. --pr names the triage that triage-init started in this working tree:
its state file (.review-triage.md in the change's folder; without a change, triage-<id>.md in the working tree's
git folder, never tracked), the scope of its commits, and no reviews file. init, reports and review take --change,
triage-init --pr and maybe --change, every other command one of the two; route needs --change only with --chapter,
report and progress need neither, and install takes one of the two or neither.

init creates the apply's state file; on one that exists it changes only the switches given. triage-init starts a
round: it creates the triage's state file or, for a later round or a rerun, keeps it, updates its Run section and
adds the section "Round <n>" when missing; --scope is needed without --change. Its line ends with
"work: <folder>", the work folder to use from then on: the one an earlier start of the same PR and round took, while
it is still there, else the one --work gives. drop removes one keyed bullet. get, asked for several sections,
prints those the file has and names each other one on stderr ("get: no section …"); it is refused only when the
file has none of them.
commit --done and progress print "progress: <step text> completed at <HH:MM>". run adds a line on the failed tests
that the state file's "Allowed failures" section lists, and NOT ALLOWED with the others.

--local (set, add, put, drop) writes a value that is true on this machine only, such as a folder's path, to the
state file's local file in the working tree's git folder, which is never committed. get needs no flag: it prints a
section from both files, a key that both hold once, with the local value. The code graph's project is such a value
(Run / Code graph project): init, triage-init and index write it there; on a machine that has none, index writes
it, and so does init on a state file that exists.

install checks the npm install of every folder in which git tracks a package-lock.json that is in the working tree
(none under a folder named node_modules or fixtures), and prints one line per folder:
"install: <folder> | <state>[ | npm ci: <what was done>]". The state is ok; missing, when there is no node_modules
folder; or "stale: <what is wrong>", when one is there and is not what the lockfile says. It is read from two
files, the lockfile and node_modules/.package-lock.json, npm's own record of what it installed (installs.mjs has
the rule), so the check starts no npm. In each folder that is missing or stale it runs "npm ci", never "npm
install", with npm's output in a log under the temp folder's tdd-runs (with --change or --pr beside that run's
logs, else in "install"), and checks the folder again afterwards. With --dry-run it only says what it would run.
--timeout is the limit of the whole command: an install still running then is stopped, and no later one is started.
A folder it could not check or install is one line "ERROR: install: <folder> | ..." on stderr, and the exit code
is then 1. The line says what failed. For an install that npm began and did not finish it also says that the
folder's node_modules may now be incomplete, and gives the command to run again, the log and what npm said. The
other folders are checked and installed all the same.

shelve sets aside every uncommitted change of the working tree but the bookkeeping's files (changed, deleted and
new files; not ignored ones; a staged file as it stands on disk) under --key, and takes those paths back to the
last commit. It prints "shelved <key>: <n> files". unshelve puts that work back onto the tree as it is now, by a
three-way merge with what was committed since, all of it or nothing and none of it staged, and prints "put back
<key>: <n> files"; with --drop it throws the shelved work away and prints "dropped <key>: <n> files". The work is
kept in the working tree's own git folder: never on the branch, never pushed, not in the stash. Both are refused
in a line that starts "ERROR: nothing was changed: " and names the cause: nothing to set aside, a key that holds
work already or holds none (the keys that do are named), work that does not go back cleanly (the paths are named;
unshelve, but for --drop, needs a tree with no uncommitted change but in the bookkeeping's files), and whatever
else could not be done without a loss. A step that fails after the first change is told in a line that starts
"ERROR: failed part-way: ", never cut, and so is a first step that fails when the key cannot be read again to show
that nothing was changed: where the work is now, as read again (the paths that could not be read are named), the
commands that get out once the cause is gone, in their order ("nothing is left to undo" when none; nothing at all
when the key could not be read again, since nothing needs doing either way), and every cause; no other line starts
so. A refusal of the call itself (an unknown option, a missing or misspelt --change, a change whose name git takes
for no ref, a --key that is no key) changes nothing and starts with neither.

unguard takes the guard test of a finding out again, once the finding is declined or deferred: it reverses the
finding's red commits (--red names them by their hashes, in any order; the newest is reversed first) in every path
but the state file, the reviews file and tasks.md, which it never touches, and commits the result as
"test(<scope>): [<tag>] <id>: guard removed, <outcome>" with --body, --resume and --done as commit takes them. It is
refused, with nothing changed, when a commit is not a red commit of that tag and id (its summary is
"<id>: <text>, red"), or its reverse does not apply cleanly: a later commit or an uncommitted change touched the
same lines.

route prints each finding's FIX, DECLINE or ASK: from its verdicts as JSON, or with --reports from the report
files of its two checks in that folder, <id>-1.md and <id>-2.md, for the findings --ids names; a report that is
missing or cannot be read is a check without a result, the second also a line on stderr. A second check that says
it disagrees with the first (its report's FIRST PASS line; in JSON, "disagrees" on the second verdict) is an ASK
(route.mjs has the shapes and the rules). --merged names findings of --ids that have one cause, once for each such
group: the group is one line, "<id>, <id> → …" with its ids in rising order. It is an ASK when any of its findings
is one ("<id>: <its reason>"), else what they all are, a FIX of kind behaviour when any of them is; findings of a
group that come out as fixed and declined are printed each on its own, then "<id>, <id>: not merged, their
outcomes differ". --missing names findings of --ids for which a check returned nothing in this run: each is sorted
as one without its checks' results, whatever report files the folder still holds.
route --change <c> --chapter <X> sorts a chapter review's findings: those of the record review wrote, each with the
verdict of its verifier's report <id>-1.md in the chapter's reports folder, a finding and those merged into it as
one group, the kept finding's id first. A report that no longer agrees with the record (missing, unreadable,
another verdict or kind, or there for a "no report" finding) is a check without a result and a line on stderr.
After the outcomes it prints "<id>: waits for <ask id>[ and <ask id>]" for each FIX that an AFFECTS line of the
record, under either finding, ties to an ASK; a merged ASK is named by its key, commas and all: "A-3: waits for
A-1, A-4" waits for one ASK, "A-3: waits for A-1, A-4 and A-6" for two.
reports prints the chapter's reports folder as an absolute path with forward slashes, and creates it:
<temp folder>/tdd-runs/<change>/reports/<chapter in lower case>. With --new it empties the folder first: a review
that runs again must not read the reports of an earlier one. A chapter's name is one word of letters, digits,
dots, dashes and underscores.
review records a chapter review, read from standard input, in the reviews file's section "Chapter <X> review". It
is refused, in one line that names the line and the finding (or the report file), unless the text is the record
review.mjs reads (the REVIEW and FINDINGS lines, each finding's six-part first line, the counts; "MERGED: <id> ·
<file:line>", one line per finding merged in; "AFFECTS: <id>: <sentence>" naming a finding of the record;
REVIEWER DISAGREES only with what is disagreed on, never empty nor starting with a dash or with words that agree,
such as no, none, agreed, I agree) and agrees with the report files in the chapter's reports folder: a finding has
its report's verdict and, when confirmed, its kind; "no report" exactly when the file is missing or cannot be read;
a finding merged into another has a report with the same verdict; every <id>-1.md there belongs to a finding's
line or a MERGED line. It prints "review: chapter <X> | <n> findings · confirmed <a> · refuted <b> · unsure <c> ·
no report <d>".
report saves the report of one check, read from standard input, as the file --file names: <id>-1.md for a first
check's report and <id>-2.md for a second's, outside every repository (a triage's in its work folder, a chapter
review's in the folder reports prints). It is refused, in one line that names the line that is wrong, when the
text cannot be read as that report: its ID line names another finding, a label route reads is missing or holds
another word, a second check's report has no FIRST PASS line, or a first check's has one. It prints
"report: <file> | <verdict>".

In --text, --line, --value, --body and --resume the two characters \\n mean a line break; --stdin takes the text as
it is. Exit codes: 0 done; 1 refused, with one line on stderr; 3 the guard found violations; 4 nothing to commit;
run: the command's own, 124 when stopped at its time limit, 127 when it cannot be started; install: 1 when a
folder could not be checked or installed, with one line on stderr for each.`;

// What each command takes besides --change, --pr and --root: an option with a value, one that may repeat, or a
// flag.
const OPTIONS = {
  init: { "agent-review": "value", "human-test-review": "value", "after-chapter": "value", issue: "value" },
  "triage-init": { round: "value", work: "value", scope: "value", source: "value" },
  get: { section: "list", file: "value" },
  set: { section: "value", text: "value", stdin: "flag", file: "value", local: "flag" },
  add: { section: "value", line: "value", file: "value", local: "flag" },
  put: { section: "value", key: "value", value: "value", file: "value", local: "flag" },
  drop: { section: "value", key: "value", file: "value", local: "flag" },
  check: { step: "value" },
  commit: {
    type: "value",
    tag: "value",
    summary: "value",
    tick: "list",
    path: "list",
    body: "value",
    resume: "value",
    check: "value",
    done: "value",
  },
  unguard: {
    tag: "value",
    id: "value",
    red: "list",
    outcome: "value",
    body: "value",
    resume: "value",
    done: "value",
  },
  shelve: { key: "value" },
  unshelve: { key: "value", drop: "flag" },
  index: {},
  install: { "dry-run": "flag", timeout: "value" },
  run: { label: "value", timeout: "value" },
  reports: { chapter: "value", new: "flag" },
  review: { chapter: "value", stdin: "flag" },
  route: {
    json: "value",
    in: "value",
    stdin: "flag",
    reports: "value",
    ids: "list",
    merged: "list",
    missing: "list",
    chapter: "value",
  },
  report: { file: "value", stdin: "flag" },
  progress: { step: "value" },
};

// The commands that work on no file of a change or a triage, and so need neither --change nor --pr. (`route` finds
// a change's files itself when it sorts a chapter's record, with --chapter.)
const WITHOUT_FILES = ["route", "report", "progress"];

// The commands of an apply alone, which take --change and never --pr: a triage has no chapters and no reviews file.
const OF_AN_APPLY = ["init", "reports", "review", "route --chapter"];

// The commands that work on the working tree whoever runs in it, and so take --change or --pr without needing
// either: the option only says beside whose logs theirs go.
const OF_THE_TREE = ["install"];

// A refusal the caller is told in one line: the message for stderr and the exit code. A `whole` one is never cut
// (`shelve` and `unshelve` after a failed step: what is left and the way out come first, every cause after them).
export class Failure extends Error {
  constructor(message, code = 1, { whole = false } = {}) {
    super(message);
    this.code = code;
    this.whole = whole;
  }
}

// A text on one line: its lines joined.
const joined = (text) =>
  String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" | ");

// A text on one line, for an error message: its lines joined, cut when long.
const oneLine = (text) => {
  const line = joined(text);
  return line.length > 300 ? `${line.slice(0, 300)}…` : line;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const say = (...lines) => void process.stdout.write(`${lines.join("\n")}\n`);

// The command, its options and, for `run`, the command line after `--`. An option's value is the argument after
// it, whatever it starts with (a text may start with dashes), or follows `=` in the same argument.
export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const commands = Object.keys(OPTIONS).join(", ");
  if (command === undefined) throw new Failure(`no command; the commands are: ${commands} (--help says more)`);
  if (["--help", "-h", "help"].includes(command)) return { command: "help", options: {}, after: null };
  if (!Object.hasOwn(OPTIONS, command)) {
    throw new Failure(`unknown command "${oneLine(command)}"; the commands are: ${commands}`);
  }
  const kinds = { change: "value", pr: "value", root: "value", ...OPTIONS[command] };
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--") {
      if (command !== "run") throw new Failure(`unexpected "--": only run takes a command after it`);
      return { command, options, after: rest.slice(i + 1) };
    }
    const [, name, inline] = /^--([a-z][a-z-]*)(?:=([\s\S]*))?$/.exec(rest[i]) ?? [];
    if (name === undefined) throw new Failure(`unexpected argument "${oneLine(rest[i])}"; an option starts with --`);
    if (!Object.hasOwn(kinds, name)) {
      const takes = Object.keys(kinds).map((k) => `--${k}`);
      throw new Failure(`unknown option --${name}; ${command} takes: ${takes.join(", ")}`);
    }
    if (kinds[name] === "flag") {
      if (inline !== undefined) throw new Failure(`--${name} takes no value`);
      options[name] = true;
      continue;
    }
    if (inline === undefined && i + 1 >= rest.length) throw new Failure(`--${name} needs a value`);
    const value = inline ?? rest[++i];
    if (kinds[name] === "list") (options[name] ??= []).push(value);
    else if (Object.hasOwn(options, name)) throw new Failure(`--${name} is given twice`);
    else options[name] = value;
  }
  return { command, options, after: null };
}

// The scope of the change's commits: its leading number (c018 of c018-add-approximate-payment-time), or the whole
// name when it starts with none.
export function changeScope(change) {
  return /^c\d+/.exec(change)?.[0] ?? change;
}

// A text given on the command line: the two characters `\n` are a line break, and real line breaks are LF.
export function newlines(text) {
  return text.replace(/\r\n?/g, "\n").replace(/\\n/g, "\n");
}

// The tasks file with the tasks of these ids ticked: the line starting `- [ ] <id> ` becomes `- [x] <id> `, and
// nothing else changes, line endings included. Answers the new text, the ids it ticked and those already ticked,
// which it leaves. An id the file does not have is refused before any is ticked.
export function tickTasks(text, ids) {
  const wanted = [...new Set(ids)];
  const odd = wanted.filter((id) => !/^\d+(\.\d+)*$/.test(id));
  if (odd.length > 0) {
    throw new Failure(`not a task id: ${odd.map((id) => `"${oneLine(id)}"`).join(", ")}; an id looks like 5.1`);
  }
  const lineOf = (id) => new RegExp(`^- \\[([ xX])\\] ${id.replace(/\./g, "\\.")}(?=[ \\t\\r]|$)`, "m");
  const missing = wanted.filter((id) => !lineOf(id).test(text));
  if (missing.length > 0) throw new Failure(`no task ${missing.join(", ")} in tasks.md; nothing was changed`);
  const ticked = [];
  const already = [];
  let after = text;
  for (const id of wanted) {
    if (lineOf(id).exec(after)[1] === " ") {
      after = after.replace(lineOf(id), `- [x] ${id}`);
      ticked.push(id);
    } else {
      already.push(id);
    }
  }
  return { text: after, ticked, already };
}

const TYPES = ["test", "feat", "fix", "docs", "refactor", "build", "chore"];

// A tag as a commit's subject holds it between its brackets: given with or without them.
const tagName = (tag) =>
  (tag ?? "")
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .trim();

// The commit message: `<type>(<scope>): [<tag>] <summary>`, then the body after a blank line, then the trailers
// after another (docs/conventions/workflow.md § 3). The tag may come with its brackets.
export function commitMessage({ type, scope, tag, summary, body, trailers }) {
  if (!TYPES.includes(type)) throw new Failure(`--type is one of: ${TYPES.join(", ")}`);
  const step = tagName(tag);
  if (!step || /[[\]\r\n]/.test(step)) throw new Failure("--tag is the step's name, such as red, green, wire or close");
  const subject = (summary ?? "").trim();
  if (!subject || /[\r\n]/.test(subject)) throw new Failure("--summary is one line of text");
  const parts = [`${type}(${scope}): [${step}] ${subject}`];
  for (const part of [body, trailers]) {
    const text = (part ?? "").replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
    if (text) parts.push(text);
  }
  return `${parts.join("\n\n")}\n`;
}

// Whether a commit's subject is that of a `red` commit of a finding's guard test in a fix round: the round's tag,
// and a summary that starts with the finding's id and `: ` and ends with `, red`
// (`test(c018): [review] 3: A guard, red`). A merged group's id is its numbers (`3, 7`). The id is compared
// whole, so finding 3 is not taken for 13 or for `3, 7`.
export function isRedCommit(subject, tag, id) {
  const [, step, summary] = /^[a-z]+\([^)]*\): \[([^\]]+)\] (.*)$/.exec(subject ?? "") ?? [];
  return step === tagName(tag) && summary.startsWith(`${id.trim()}: `) && summary.endsWith(", red");
}

const two = (n) => String(n).padStart(2, "0");

// The one line that tells the main session a step is done: `progress: <step> completed at <HH:MM>`, the local
// time on the 24-hour clock. The runner passes on what follows `progress: ` as it is. The step is one line of
// text, such as `Baseline` or `Chapter B, slice 3`; `option` names it in the refusal.
export function progressLine(step, date, option = "--step") {
  const text = newlines(step ?? "").trim();
  if (!text || text.includes("\n")) {
    throw new Failure(`${option} is the step's name on one line, such as Baseline or Chapter B, slice 3`);
  }
  return `progress: ${text} completed at ${two(date.getHours())}:${two(date.getMinutes())}`;
}

// A run's log file: the local time to the second and the label, of which only letters, digits, dots, dashes and
// underscores are kept.
export function logFileName(label, date) {
  const day = `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  const name = (label ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!name) throw new Failure("--label is a short name for the run, such as unit or web");
  return `${day}-${time}-${name}.log`;
}

// The characters cmd.exe reads specially.
const CMD_SPECIAL = /([()\][%!^"`<>&|;, *?])/g;

// The command line cmd.exe is given to run a .cmd or .bat file with exactly these arguments. Each argument is
// first quoted as the program behind the batch file reads its command line (a quote escaped by a backslash, the
// backslashes before a quote and at the end doubled), then every character cmd reads specially gets a caret,
// twice: cmd reads the line it is given, and then reads the batch file's own line again once the arguments stand
// in it for %*. The file's own path is read once. The known technique of npm's cross-spawn, here for every batch
// file; the tests run it for real against npm.cmd and a file in a folder with spaces and brackets.
export function windowsCommandLine(file, args) {
  const quoted = args.map((arg) => {
    if (/[\r\n]/.test(arg)) throw new Failure("an argument with a line break cannot be handed to a .cmd file");
    const forProgram = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
    return forProgram.replace(CMD_SPECIAL, "^$1").replace(CMD_SPECIAL, "^$1");
  });
  return [file.replace(CMD_SPECIAL, "^$1"), ...quoted].join(" ");
}

const envValue = (env, name) => env[Object.keys(env).find((k) => k.toUpperCase() === name.toUpperCase())];

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

// The file Windows would start for a command: the command itself when it names a file, else the first match in
// the PATH's folders with one of the extensions Windows starts, in PATHEXT's order. Null when there is none.
function findOnWindows(command, env, cwd) {
  const startable = [".com", ".exe", ".bat", ".cmd"];
  const listed = (envValue(env, "PATHEXT") ?? "").toLowerCase().split(";");
  const extensions = listed.some((e) => startable.includes(e))
    ? listed.filter((e) => startable.includes(e))
    : startable;
  const names = startable.includes(extname(command).toLowerCase()) ? [command] : extensions.map((e) => command + e);
  const folders = /[\\/]/.test(command)
    ? [cwd]
    : (envValue(env, "PATH") ?? "")
        .split(delimiter)
        .map((f) => f.replace(/^"(.*)"$/, "$1"))
        .filter(Boolean);
  for (const folder of folders) {
    const found = names.map((name) => resolve(folder, name)).find(isFile);
    if (found) return found;
  }
  return null;
}

// How to start a command so that its arguments arrive unchanged: the file to start, its arguments and the spawn
// options. Everywhere but Windows, and for an .exe, that is the command as it is, without a shell. On Windows a
// command may be a batch file (`npm` is npm.cmd), which Node refuses to start without a shell: it goes through
// cmd.exe with the command line windowsCommandLine builds.
export function spawnPlan(command, args, { env = process.env, cwd = process.cwd(), platform = process.platform } = {}) {
  if (platform !== "win32") return { file: command, args, options: {} };
  const file = findOnWindows(command, env, cwd) ?? command;
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, options: {} };
  return {
    file: envValue(env, "ComSpec") || "cmd.exe",
    args: ["/d", "/s", "/c", `"${windowsCommandLine(file, args)}"`],
    options: { windowsVerbatimArguments: true },
  };
}

// Runs git in the repository and answers spawnSync's result; a failure is refused in git's own words unless the
// caller handles it (`mayFail`). `input` goes to git's standard input. With `bytes`, what git prints comes as
// bytes and not as text: a patch may hold a file that is no UTF-8 text, and must reach `git apply` as it is.
// `env` replaces the environment git runs in.
function git(root, args, { input, mayFail = false, bytes = false, env } = {}) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: bytes ? "buffer" : "utf8",
    input,
    env,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw new Failure(`git could not be started: ${r.error.message}`);
  if (r.status !== 0 && !mayFail) {
    const verb = args.find((a) => !a.startsWith("-"));
    throw new Failure(`git ${verb} failed: ${gitSaid(r) || `exit ${r.status}`}`);
  }
  return r;
}

// What git wrote of a failure, on one line: its error output, or what it printed when that is empty.
const gitSaid = (r) => oneLine(String(r.stderr ?? "")) || oneLine(String(r.stdout ?? ""));

// The line endings a new file gets: those git would check it out with, so git has nothing to convert and nothing
// to warn about (gitattributes(5): `text`, `eol`; git-config(1): core.autocrlf, core.eol). In this repository
// `* text=auto` leaves it to the machine: CRLF on Windows with core.autocrlf true, LF on Linux.
export function newFileEol(root, path) {
  const attributes = git(root, ["check-attr", "text", "eol", "--", path], { mayFail: true }).stdout ?? "";
  const attribute = (name) => new RegExp(`: ${name}: (\\S+)\\s*$`, "m").exec(attributes)?.[1] ?? "unspecified";
  const config = (name) => {
    const r = git(root, ["config", "--get", name], { mayFail: true });
    return r.status === 0 ? r.stdout.trim().toLowerCase() : null;
  };
  const text = attribute("text");
  if (text === "unset") return "\n"; // -text: git converts nothing
  if (attribute("eol") === "crlf") return "\r\n";
  if (attribute("eol") === "lf") return "\n";
  const autocrlf = config("core.autocrlf");
  if (["true", "yes", "on", "1"].includes(autocrlf)) return "\r\n";
  if (autocrlf === "input") return "\n";
  if (text === "unspecified") return "\n"; // no attribute and no autocrlf: git converts nothing
  const eol = config("core.eol") ?? "native";
  if (eol === "crlf") return "\r\n";
  if (eol === "lf") return "\n";
  return process.platform === "win32" ? "\r\n" : "\n";
}

// Indexes the repository in the code graph, as .claude/hooks/code-graph.mjs does: the project's name, that it
// was skipped, or why it failed. It never throws: a commit must not fail because of the graph.
export function indexGraph(root, env = process.env) {
  if (env.TDD_NO_GRAPH === "1") return { skipped: true };
  const cli = env.TDD_GRAPH_CLI || "codebase-memory-mcp";
  try {
    const plan = spawnPlan(cli, ["cli", "--quiet", "index_repository", "--repo-path", root], { env, cwd: root });
    const r = spawnSync(plan.file, plan.args, {
      ...plan.options,
      cwd: root,
      encoding: "utf8",
      timeout: 600_000,
      windowsHide: true,
    });
    if (r.error?.code === "ENOENT") return { failed: `${cli} is not on the PATH` };
    if (r.error?.code === "ETIMEDOUT") return { failed: `${cli} gave no answer in 10 minutes` };
    if (r.error) return { failed: oneLine(r.error.message) };
    if (r.status !== 0) return { failed: `${cli} exited ${r.status}: ${oneLine(r.stderr || r.stdout)}` };
    const project = JSON.parse(r.stdout).project;
    return typeof project === "string" && project ? { project } : { failed: `${cli} named no project` };
  } catch (e) {
    return { failed: oneLine(e.message) };
  }
}

const graphText = (graph) => `graph: ${graph.skipped ? "skipped" : (graph.project ?? `failed: ${graph.failed}`)}`;

// What the state file's `Code graph project` says: the project's name, or why there is none.
const graphProject = (graph) =>
  graph.project ?? `not indexed: ${graph.skipped ? "skipped (TDD_NO_GRAPH=1)" : graph.failed}`;

// The working tree the command is run in, or that --root names a folder of: the repository's `root`, and
// `gitFolder`, the folder of the tree's own files in git's folder, which holds the lock and the triage's pointer.
// It is never tracked, and a linked working tree has its own. One call of git answers both; it names the second
// from the folder it runs in.
function workingTree(options) {
  const from = options.root === undefined ? process.cwd() : resolve(options.root);
  if (!statSync(from, { throwIfNoEntry: false })?.isDirectory()) throw new Failure(`--root: no folder ${from}`);
  const answered = git(from, ["rev-parse", "--show-toplevel", "--git-path", "tdd"], { mayFail: true });
  if (answered.status !== 0) {
    throw new Failure(`${from} is not inside a git repository; run from inside one or give --root <path>`);
  }
  const [top, folder] = answered.stdout.split(/\r?\n/);
  return { root: resolve(top), gitFolder: resolve(from, folder) };
}

// The names of the folders in a folder, as the disk has them; none when it is not there.
const foldersIn = (path) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
    : [];

// The change's folder, from the repository's root: under openspec/changes, or once the change is archived its one
// folder under openspec/changes/archive, whose name starts with the day.
//
// The name is looked up among the folders' own names, letter for letter, and never by asking the disk for it:
// Windows finds a folder whatever the case of the letters asked for, and every path of the bookkeeping's files
// would then be built from the name as typed, which git, comparing by letter, takes for other files. A name that
// starts with `triage-` is no change's: that is how a PR's triage is named among what the git folder keeps (its
// local file, its shelved work), and the two must not meet.
function changeFolder(root, change) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(change)) {
    throw new Failure(
      `--change is the name of the change's folder under openspec/changes, not a path: "${oneLine(change)}"`,
    );
  }
  if (/^triage-/i.test(change)) {
    throw new Failure(
      `--change ${change}: a change's name must not start with "triage-", which names a PR's triage among the ` +
        "files the bookkeeping keeps in the git folder",
    );
  }
  const changes = join(root, "openspec", "changes");
  const active = foldersIn(changes);
  if (active.includes(change)) return `openspec/changes/${change}`;
  const inArchive = foldersIn(join(changes, "archive"));
  const archived = archivedAs(inArchive, change);
  if (archived.length > 1) {
    throw new Failure(`${change} has more than one folder in openspec/changes/archive: ${archived.join(", ")}`);
  }
  if (archived.length === 1) return `openspec/changes/archive/${archived[0]}`;
  const sameBut = (name) => name.toLowerCase() === change.toLowerCase();
  const real = active.find(sameBut) ?? inArchive.map((name) => name.replace(/^\d{4}-\d{2}-\d{2}-/, "")).find(sameBut);
  if (real !== undefined) {
    throw new Failure(`--change ${change}: the change's folder is named ${real}; give the name letter for letter`);
  }
  throw new Failure(`no change folder openspec/changes/${change} in ${root}, and none in its archive`);
}

// A file as a command knows it: its path, whether it is one of the working tree's (`inside`: under the
// repository's root, and not in git's own folder, where a triage without a change keeps its state file), and how
// it is shown and named to git: its path from the repository's root, or its whole path for a file that is not
// the working tree's, with forward slashes either way.
function placed({ root, gitFolder }, path) {
  const inside = within(root, path) && !within(gitFolder, path);
  return { path, shown: slashed(inside ? relative(root, path) : path), inside };
}

// Whether a path is the folder or lies in it.
function within(folder, path) {
  const from = relative(folder, path);
  return from !== ".." && !from.startsWith(`..${sep}`) && !isAbsolute(from);
}

// A path as a command prints it: with forward slashes on every system, so that it can be pasted into any shell.
const slashed = (path) => path.split(sep).join("/");

// Runs `work` while holding the working tree's lock (lock.mjs) and answers what it answers.
const locked = (ctx, work) => withLock(ctx.gitFolder, work);

// The pointer to the triage under way in the working tree; null when there is none.
function pointerOf(gitFolder) {
  const path = join(gitFolder, POINTER_FILE);
  return existsSync(path) ? readPointer(readText(path)) : null;
}

// The local file of a state file, as a command knows a file: this machine's values, in the working tree's git
// folder under the account's name (the change's, or a triage's `triage-<id>`). It is never one of the working
// tree's files.
const localFile = (tree, account) => placed(tree, join(tree.gitFolder, `${account}.local.md`));

// The key of `Run` that holds the code graph's project. It is a value of this machine: the local file's.
const GRAPH_PROJECT = "Code graph project";

// What a command of an apply works with: the working tree, the change, and its files. `account` is its name among
// what the git folder keeps for the bookkeeping: the local file and the shelved work.
function applyContext({ root, gitFolder }, change) {
  const folder = changeFolder(root, change);
  const file = (name) => placed({ root, gitFolder }, join(root, folder, name));
  const [state, reviews] = [file(STATE_FILE), file(REVIEWS_FILE)];
  return {
    root,
    gitFolder,
    change,
    account: change,
    scope: changeScope(change),
    runs: change,
    started: "init",
    branch: "the change's branch",
    state,
    reviews,
    tasks: file("tasks.md"),
    local: localFile({ root, gitFolder }, change),
    own: [state.shown, reviews.shown],
  };
}

// What a command of a triage works with: the files of the triage the pointer names. Its state file is the
// triage's, it has no reviews file, and tasks.md only with a change, next to the state file.
function triageContext({ root, gitFolder }, given) {
  const pr = prId(given);
  const pointer = pointerOf(gitFolder);
  if (pointer === null) {
    throw new Failure(`no triage is under way in this working tree: run triage-init --pr ${pr} first`);
  }
  if (pointer.pr !== pr) {
    throw new Failure(`the triage under way in this working tree is PR ${pointer.pr}'s, not PR ${pr}'s`);
  }
  const placedHere = (path) => placed({ root, gitFolder }, path);
  const state = placedHere(pointer.state);
  return {
    root,
    gitFolder,
    change: pointer.change,
    account: triageAccount(pr),
    triage: true,
    scope: pointer.scope,
    runs: `pr-${pr}`,
    started: "triage-init",
    branch: "the PR's branch",
    state,
    reviews: null,
    tasks: pointer.change === null ? null : placedHere(join(dirname(pointer.state), "tasks.md")),
    local: localFile({ root, gitFolder }, triageAccount(pr)),
    own: state.inside ? [state.shown] : [],
  };
}

// What a command works with. `triage-init` finds its files itself: it makes the pointer the others go by.
function context(options, command) {
  if (command === "triage-init") return workingTree(options);
  if (options.change !== undefined && options.pr !== undefined) {
    throw new Failure("--change and --pr are given together: --change is an apply's, --pr a triage's");
  }
  if (options.pr !== undefined && OF_AN_APPLY.includes(command)) {
    throw new Failure(`${command} is the apply's: it takes --change`);
  }
  if (options.change === undefined && OF_AN_APPLY.includes(command)) {
    throw new Failure(`${command} needs --change <change-name>: it is the apply's`);
  }
  if (options.change === undefined && options.pr === undefined) {
    if (OF_THE_TREE.includes(command)) return workingTree(options);
    throw new Failure("--change <change-name> is missing (an apply's), or --pr <id> (a triage's)");
  }
  const tree = workingTree(options);
  return options.pr !== undefined ? triageContext(tree, options.pr) : applyContext(tree, options.change);
}

// The current branch; `main`, `master` and a detached HEAD are refused: the apply works on the change's branch,
// the triage on the PR's (`whose` says which).
function workBranch(root, command, whose) {
  const r = git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { mayFail: true });
  const branch = r.status === 0 ? r.stdout.trim() : null;
  if (branch === null) throw new Failure(`${command} works on ${whose}, and HEAD is detached`);
  if (branch === "main" || branch === "master") {
    throw new Failure(`${command} works on ${whose}, and this is ${branch}`);
  }
  return branch;
}

const oneOf = (value, allowed, option) => {
  if (!allowed.includes(value)) throw new Failure(`${option} is one of: ${allowed.join(", ")}`);
  return value;
};

// The apply's three switches: the option, its key in the state file's `Run`, and its values, the default first.
const SWITCHES = [
  ["agent-review", "Agent review", ["each-chapter", "acceptance", "none"]],
  ["human-test-review", "Human test review", ["acceptance", "each-group"]],
  ["after-chapter", "After chapter", ["continue", "stop"]],
];

function init(ctx, options) {
  const branch = workBranch(ctx.root, "init", ctx.branch);
  for (const [option, , allowed] of SWITCHES) {
    if (options[option] !== undefined) oneOf(options[option], allowed, `--${option}`);
  }
  const issue = options.issue === undefined ? null : /^#?(\d+)$/.exec(options.issue.trim())?.[1];
  if (issue === undefined) throw new Failure("--issue is the issue's number");

  // A state file that exists: only the switches given change. Null when there is none.
  const existing = () => {
    if (!existsSync(ctx.state.path)) return null;
    const before = readText(ctx.state.path);
    let text = before;
    const notes = SWITCHES.map(([option, key]) => {
      const was = keyValue(text, "Run", key);
      if (options[option] === undefined || options[option] === was) return `${option}: ${was ?? "not set"}`;
      text = putKey(text, "Run", key, options[option]);
      return `${option}: ${options[option]} (was ${was ?? "not set"})`;
    });
    if (text !== before) writeAtomic(ctx.state.path, text);
    return `exists: ${ctx.state.shown} | ${notes.join(" | ")}`;
  };
  const found = locked(ctx, existing);
  if (found !== null) {
    // A state file that came with the branch, on a machine whose local file names no project yet (a fresh clone,
    // or a file from before the local file was there): the project is found and noted, outside the lock.
    if (localValue(ctx, "Run", GRAPH_PROJECT) !== null) return say(found);
    const graph = indexGraph(ctx.root);
    locked(ctx, () => putLocal(ctx.local.path, ctx.account, "Run", GRAPH_PROJECT, graphProject(graph)));
    return say(`${found} | ${graphText(graph)}`);
  }

  if (SWITCHES.some(([option]) => options[option] === undefined)) {
    const needed = SWITCHES.map(([option, , allowed]) => `--${option} <${allowed.join("|")}>`);
    throw new Failure(`init needs ${needed.join(", ")} to create the state file`);
  }
  const graph = indexGraph(ctx.root);
  const now = new Date();
  // `Run` holds no value of this machine: neither the repository's folder, which is where every command runs, nor
  // the code graph's project, which goes to the local file.
  const run = [
    ["Status", "applying"],
    ["Started", `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`],
    ...SWITCHES.map(([option, key]) => [key, options[option]]),
    ["Branch", branch],
    ...(issue === null ? [] : [["Issue", `#${issue}`]]),
  ];
  // The index ran outside the lock, so another `init` may have created the file meanwhile: then it is kept.
  const created = locked(ctx, () => {
    const meanwhile = existing();
    if (meanwhile !== null) return meanwhile;
    writeAtomic(ctx.state.path, newStateText(ctx.change, run, newFileEol(ctx.root, ctx.state.shown)));
    putLocal(ctx.local.path, ctx.account, "Run", GRAPH_PROJECT, graphProject(graph));
    return `created ${ctx.state.shown} | ${graphText(graph)}`;
  });
  say(created);
}

// A value of this machine, put into a state file's local file under a section's key; the file is created when it
// is not there, with LF line breaks (it is no file of the working tree). Called inside the lock. `of` is the
// account the file belongs to.
function putLocal(path, of, section, key, value) {
  const before = existsSync(path) ? readText(path) : null;
  const after = putKey(before ?? newLocalText(of, "\n"), section, key, value, { create: true });
  if (after !== before) writeAtomic(path, after);
}

// A value the local file holds under a section's key; null when the file, the section or the key is not there.
const localValue = (ctx, section, key) =>
  existsSync(ctx.local.path) ? keyValue(readText(ctx.local.path), section, key) : null;

// The folder `--work` names: an absolute path, of a folder or of nothing yet.
function workFolder(given) {
  if (!given?.trim()) throw new Failure("triage-init needs --work <absolute folder>, the triage's work folder");
  if (!isAbsolute(given.trim())) throw new Failure(`--work is an absolute path: "${oneLine(given)}"`);
  const work = resolve(given.trim());
  const there = statSync(work, { throwIfNoEntry: false });
  if (there && !there.isDirectory()) throw new Failure(`--work is a folder, and ${work} is a file`);
  return work;
}

// The work folder a round of a triage uses. A session proposes its own scratchpad with --work, and another
// session has another one: while the pointer names a folder for this PR and this round and that folder is still
// there, it stays the one in use, so that a session that takes the round over finds the round's files. A new
// round, or a folder that is gone, takes the folder given.
function workInUse(gitFolder, pr, round, given) {
  let pointer = null;
  try {
    pointer = pointerOf(gitFolder);
  } catch {
    // a pointer that cannot be read is written anew below
  }
  const kept =
    pointer !== null &&
    pointer.pr === pr &&
    pointer.round === round &&
    statSync(pointer.work, { throwIfNoEntry: false })?.isDirectory();
  return kept ? pointer.work : given;
}

// Starts a round of a triage: its state file, created or kept, and the pointer the other commands' --pr goes by.
// The state file of a PR without a change lies in git's folder, next to the pointer: one file for every round and
// every session of that PR in this working tree, never tracked, and with no path of this machine in a file that
// is.
function triageInit({ root, gitFolder }, options) {
  if (options.pr === undefined) throw new Failure("triage-init needs --pr <id>");
  const pr = prId(options.pr);
  const round = /^[1-9]\d*$/.test(options.round?.trim() ?? "") ? Number(options.round) : null;
  if (round === null) throw new Failure("triage-init needs --round <n>, the round's number from 1");
  const source = options.source === undefined ? undefined : oneOf(options.source, ["pr", "chat"], "--source");
  const change = options.change ?? null;
  const folder = change === null ? null : changeFolder(root, change);
  if (options.scope === undefined && change === null) {
    throw new Failure("triage-init needs --scope <scope> without --change: the scope of the round's commits");
  }
  const scope = options.scope?.trim() ?? changeScope(change);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(scope)) {
    throw new Failure(`--scope is the scope of the round's commits, such as c018 or i67: "${oneLine(scope)}"`);
  }
  const branch = workBranch(root, "triage-init", "the PR's branch");
  const given = workFolder(options.work);
  if (folder === null && within(root, given)) {
    throw new Failure(`--work lies inside the repository: without a change the triage's files stay outside it`);
  }
  const state = placed(
    { root, gitFolder },
    folder === null ? join(gitFolder, prStateFile(pr)) : join(root, folder, TRIAGE_FILE),
  );

  const graph = indexGraph(root);
  const line = locked({ gitFolder }, () => {
    const before = existsSync(state.path) ? readText(state.path) : null;
    const was = before === null ? null : keyValue(before, "Run", "PR");
    if (was !== null && was.replace(/^#/, "") !== pr) {
      throw new Failure(`${state.shown} is the triage of PR ${was}, not of PR ${pr}`);
    }
    const work = workInUse(gitFolder, pr, round, given);
    mkdirSync(work, { recursive: true });
    // `Run` holds no value of this machine: the state file of a change is tracked. The pointer holds the work
    // folder and the local file the code graph's project, and a file that has such a key from before keeps it as
    // it is.
    const run = [
      ["Status", "triaging"],
      ["PR", pr],
      ["Round", String(round)],
      ["Scope", scope],
      ...(source === undefined && before !== null && keyValue(before, "Run", "Source") !== null
        ? []
        : [["Source", source ?? "pr"]]),
      ["Branch", branch],
    ];
    // A new file in the working tree gets the line endings git would check it out with; one in git's folder, LF.
    const eol = before === null && state.inside ? newFileEol(root, state.shown) : "\n";
    const after = triageText(before, change ?? `PR ${pr}`, run, round, eol);
    if (after !== before) writeAtomic(state.path, after);
    const account = triageAccount(pr);
    putLocal(localFile({ root, gitFolder }, account).path, account, "Run", GRAPH_PROJECT, graphProject(graph));
    writeAtomic(join(gitFolder, POINTER_FILE), pointerText({ pr, round, change, scope, work, state: state.path }));
    const newRound = before !== null && sectionBody(before, roundSection(round)) === null;
    return [
      before === null ? `created ${state.shown}` : `exists: ${state.shown}`,
      `round ${round}${newRound ? ", a new section" : ""}`,
      graphText(graph),
      `work: ${slashed(work)}`,
    ].join(" | ");
  });
  say(line);
}

// The file a section command works on: the context's state file, or with `--file reviews` the chapter reviews
// file. `create` says whether a section the file does not have may be created: in the reviews file and in a
// triage's state file, whose sections come as the work does; never in the apply's state file, whose sections are
// fixed.
function sectionFile(ctx, options) {
  const which = oneOf(options.file ?? "state", ["state", "reviews"], "--file");
  if (ctx[which] === null) throw new Failure("--file reviews: a triage has no reviews file, only its state file");
  const reviews = which === "reviews";
  if (options.local && reviews) {
    throw new Failure("--local goes with the state file alone: the reviews file holds no value of this machine");
  }
  return { ...ctx[which], reviews, create: reviews || ctx.triage === true };
}

const neededSection = (options) => {
  if (!options.section?.trim()) throw new Failure("--section <name> is missing");
  return options.section;
};

// Prints sections. Of the state file, each one as both files have it: the state file's body with the local file's
// laid over it (state.mjs `overlaidBody`), so that a value of this machine reads like any other. Of several
// sections asked for, those the file has are printed and each other one is a line on stderr: a caller that asks
// for a section that is written later (a chapter's record, while its review runs) still gets the rest. Only when
// the file has none of them is the command refused.
function get(ctx, options) {
  const file = sectionFile(ctx, options);
  if (!options.section?.length) throw new Failure("get needs --section <name>, once for each section");
  if (!existsSync(file.path)) {
    throw new Failure(
      file.reviews
        ? `no ${file.shown} yet: no chapter review is written`
        : `no ${file.shown}: run ${ctx.started} first`,
    );
  }
  const text = readText(file.path);
  const local = !file.reviews && existsSync(ctx.local.path) ? readText(ctx.local.path) : null;
  const ofLocal = (read, name) => (local === null ? null : read(local, name));
  const body = (name) => overlaidBody(sectionBody(text, name), ofLocal(sectionBody, name));
  const found = options.section.filter((name) => body(name) !== null);
  const missing = options.section.filter((name) => body(name) === null);
  if (missing.length > 0) {
    const names = [...sectionNames(text), ...(local === null ? [] : sectionNames(local))];
    const listed = names.filter((name, i) => names.findIndex((n) => n.toLowerCase() === name.toLowerCase()) === i);
    const no = (sections) =>
      `no section ${sections} in ${file.shown}; the sections are: ${listed.join(", ") || "none yet"}`;
    if (found.length === 0) throw new Failure(no(missing.map((name) => `"${oneLine(name)}"`).join(", ")));
    for (const name of missing) process.stderr.write(`get: ${no(`"${oneLine(name)}"`)}\n`);
  }
  if (options.section.length === 1) return say(body(found[0]));
  const shown = (name) => sectionName(text, name) ?? ofLocal(sectionName, name);
  say(found.map((name) => `## ${shown(name)}\n${body(name)}`).join("\n\n"));
}

// Changes one section of the state file or the reviews file with `change` (the text in, the new text out), under
// the lock from its read to its write, and answers what `edited` prints. The reviews file is created when it is
// not there, and a section it does not have yet too; a triage's state file also gets a section it does not have.
// With --local the section is the local file's instead: see `editLocalSection`.
function editSection(ctx, options, verb, change) {
  const file = sectionFile(ctx, options);
  const name = neededSection(options);
  return locked(ctx, () => {
    if (options.local) return editLocalSection(ctx, name, verb, change);
    const newFile = !existsSync(file.path);
    if (newFile && !file.reviews) throw new Failure(`no ${file.shown}: run ${ctx.started} first`);
    const before = newFile ? newReviewsText(ctx.change, newFileEol(ctx.root, file.shown)) : readText(file.path);
    const newSection = sectionBody(before, name) === null;
    const after = change(before, name, { create: file.create });
    writeAtomic(file.path, after);
    return {
      shown: sectionName(after, name),
      lines: sectionBody(after, name).split("\n").length,
      notes: [...(newSection ? ["new section"] : []), ...(newFile ? ["new file"] : [])],
      verb,
    };
  });
}

// `editSection`'s work with --local, inside the lock: the change goes to the section of that name in the state
// file's local file, which is created when it is not there, as is the section. The state file must be there, and
// in an apply, whose sections are fixed, the section must be one of its own: a name mistyped must not open a
// section no reader asks for. The section is shown under the state file's name for it, and the line `edited`
// prints ends with `local`.
function editLocalSection(ctx, name, verb, change) {
  if (!existsSync(ctx.state.path)) throw new Failure(`no ${ctx.state.shown}: run ${ctx.started} first`);
  const state = readText(ctx.state.path);
  if (ctx.triage !== true && sectionBody(state, name) === null) {
    throw new Failure(
      `no section "${oneLine(name)}" in ${ctx.state.shown}; --local keeps this machine's values of one of its ` +
        `sections: ${sectionNames(state).join(", ")}`,
    );
  }
  const before = existsSync(ctx.local.path) ? readText(ctx.local.path) : newLocalText(ctx.account, "\n");
  const as = sectionName(before, name) ?? sectionName(state, name) ?? name;
  let after;
  try {
    after = change(before, as, { create: true });
  } catch (e) {
    throw new Failure(`--local: ${e.message}`);
  }
  writeAtomic(ctx.local.path, after);
  return { shown: sectionName(after, as), lines: sectionBody(after, as).split("\n").length, notes: ["local"], verb };
}

// The one line a section command prints: what it did to which section, how many lines the section now has (or,
// for `put` and `drop`, the key), and whether the section or the file is new, or that it is the local file's.
function edited({ verb, shown, lines, notes }, key) {
  const what = key === undefined ? [`${verb}: ${shown}`, plural(lines, "line")] : [`${verb}: ${shown} / ${key}`];
  say([...what, ...notes].join(" | "));
}

// A text read from standard input without the byte-order mark (U+FEFF) some shells put before it.
const withoutByteOrderMark = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function set(ctx, options) {
  const sources = (options.text === undefined ? 0 : 1) + (options.stdin ? 1 : 0);
  if (sources !== 1) throw new Failure("set needs one of --text <text> and --stdin");
  const body = options.stdin ? withoutByteOrderMark(readFileSync(0, "utf8")) : newlines(options.text);
  edited(editSection(ctx, options, "set", (text, name, how) => setSection(text, name, body, how)));
}

function add(ctx, options) {
  if (!options.line?.trim()) throw new Failure("add needs --line <text>");
  edited(editSection(ctx, options, "added", (text, name, how) => addBullet(text, name, newlines(options.line), how)));
}

function put(ctx, options) {
  if (!options.key?.trim()) throw new Failure("put needs --key <key>");
  if (options.value === undefined) throw new Failure("put needs --value <value>");
  const result = editSection(ctx, options, "put", (text, name, how) =>
    putKey(text, name, options.key, newlines(options.value), how),
  );
  edited(result, options.key.trim());
}

// Removes one keyed bullet, such as a test from `Allowed failures` once its task is settled. A key the section
// does not have is refused, with the keys it has.
function drop(ctx, options) {
  if (!options.key?.trim()) throw new Failure("drop needs --key <key>");
  edited(
    editSection(ctx, options, "dropped", (text, name) => dropKey(text, name, options.key)),
    options.key.trim(),
  );
}

// The guard's verdict on the working tree: every path git reports as changed or new, each new file by its own
// path, read with -z so that no path is quoted. The context's own files pass: the apply's state file and reviews
// file, or the triage's state file when it is one of the working tree's (a change's; a PR without a change keeps
// its own in git's folder, which git never reports).
function guarded(ctx, step) {
  if (!STEPS.includes(step)) throw new Failure(`the step is one of: ${STEPS.join(", ")}`);
  const changed = git(ctx.root, ["status", "--porcelain", "--untracked-files=all", "-z"]).stdout;
  return guard(parseStatus(changed), step, ctx.own);
}

function check(ctx, options) {
  const result = guarded(ctx, options.step);
  say(...guardReport(result));
  return result.violations.length > 0 ? 3 : 0;
}

// A --path as git names it: from the repository's root, with forward slashes. Given from the root or absolute,
// with either kind of slash. Refused when it lies outside the repository, or is neither a file or folder there
// nor a path git tracks (a deleted file).
function repositoryPath(root, given) {
  const absolute = resolve(root, given.replace(/\\/g, "/"));
  const path = relative(root, absolute).replace(/\\/g, "/") || ".";
  if (path.startsWith("../") || path === ".." || isAbsolute(path)) {
    throw new Failure(`--path ${oneLine(given)} lies outside the repository`);
  }
  const tracked = () =>
    git(root, ["--literal-pathspecs", "ls-files", "--error-unmatch", "--", path], { mayFail: true }).status === 0;
  if (!existsSync(absolute) && !tracked()) {
    throw new Failure(`--path ${oneLine(given)}: no such file or folder, and git tracks none`);
  }
  return path;
}

// Commits, and afterwards indexes the code graph. With --done it then prints the step's progress line, so a step
// that ends with a commit needs no second call.
function commit(ctx, options) {
  workBranch(ctx.root, "commit", ctx.branch);
  // Refused here, before anything is read or changed.
  commitMessage({ ...options, scope: ctx.scope });
  return committing(ctx, options, () => committed(ctx, options));
}

// Runs the work of a command that ends with a commit (`commit`, `unguard`), and prints its line. The lock is held
// from the work's first read to the end of `git commit`, and released before the code graph is indexed. The work
// answers the exit code when it made no commit, else the parts of the line to print and the time of the commit.
function committing(ctx, options, work) {
  // Refused here, before anything is read or changed.
  if (options.done !== undefined) progressLine(options.done, new Date(), "--done");
  const made = locked(ctx, work);
  if (typeof made === "number") return made;
  say([...made.parts, graphText(indexGraph(ctx.root))].join(" | "));
  if (options.done !== undefined) say(progressLine(options.done, made.at, "--done"));
}

// Commits what is staged with the message, or with `only` exactly those paths, whatever else is staged
// (`commit --only`). Answers the new commit's short hash and the time. The message goes to git through standard
// input, never through a shell; --cleanup=whitespace keeps a body line that starts with # whatever the machine's
// commit.cleanup says.
function gitCommit(root, message, only) {
  const paths = only ? ["--only", "--", ...only] : [];
  git(root, ["--literal-pathspecs", "commit", "--quiet", "--cleanup=whitespace", "-F", "-", ...paths], {
    input: message,
  });
  return { at: new Date(), sha: git(root, ["rev-parse", "--short=7", "HEAD"]).stdout.trim() };
}

// `commit`'s work under the lock. Answers the exit code when it made no commit (3: the guard found violations,
// which it printed; 4: nothing to commit), else the parts of the line to print and the time of the commit.
function committed(ctx, options) {
  // Everything else that can be refused is refused here, before anything is changed.
  if (options.check !== undefined) {
    const result = guarded(ctx, options.check);
    if (result.violations.length > 0) {
      say(...guardReport(result));
      return 3;
    }
  }
  const ids = (options.tick ?? [])
    .flatMap((value) => value.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length > 0 && ctx.tasks === null) throw new Failure("--tick: a triage without a change has no tasks.md");
  if (ids.length > 0 && !existsSync(ctx.tasks.path)) throw new Failure(`no ${ctx.tasks.shown} to tick in`);
  const tasks = ids.length > 0 ? tickTasks(readText(ctx.tasks.path), ids) : { ticked: [], already: [] };
  let state = existsSync(ctx.state.path) ? readText(ctx.state.path) : null;
  const resumed = options.resume !== undefined;
  if (resumed && state === null) throw new Failure(`--resume: no ${ctx.state.shown}: run ${ctx.started} first`);
  if (resumed) state = setSection(state, "Resume here", newlines(options.resume));
  const given = options.path?.map((path) => repositoryPath(ctx.root, path));

  if (tasks.ticked.length > 0) writeAtomic(ctx.tasks.path, tasks.text);
  if (resumed) writeAtomic(ctx.state.path, state);

  // With --path: exactly those paths and the files this command changed itself. Whatever else is changed, or
  // already staged, stays as it is: `commit --only` takes the named paths alone. A triage's state file in git's
  // folder is no file of the working tree, and is never committed.
  const only = given && [
    ...new Set([
      ...given,
      ...(tasks.ticked.length > 0 ? [ctx.tasks.shown] : []),
      ...(resumed && ctx.state.inside ? [ctx.state.shown] : []),
    ]),
  ];
  if (only) git(ctx.root, ["--literal-pathspecs", "add", "--", ...only]);
  else git(ctx.root, ["add", "-A"]);
  const paths = only ? ["--", ...only] : [];
  if (git(ctx.root, ["--literal-pathspecs", "diff", "--cached", "--quiet", ...paths], { mayFail: true }).status === 0) {
    process.stderr.write("nothing to commit\n");
    return 4;
  }

  const trailers = state === null ? null : keyValue(state, "Run", "Commit trailers");
  const body = options.body === undefined ? undefined : newlines(options.body);
  const message = commitMessage({ ...options, scope: ctx.scope, body, trailers });
  const { sha, at } = gitCommit(ctx.root, message, only);

  const parts = [`${sha} ${message.split("\n")[0]}`];
  if (tasks.ticked.length > 0) parts.push(`ticked ${tasks.ticked.join(", ")}`);
  if (tasks.already.length > 0) parts.push(`already ticked ${tasks.already.join(", ")}`);
  return { parts, at };
}

// Takes a finding's guard test out again, once the owner declined or deferred the finding: reverses the finding's
// `red` commits and commits that as `test(<scope>): [<tag>] <id>: guard removed, <outcome>`, with the lock, the
// trailers, `Resume here`, the progress line and the code graph as `commit` has them.
function unguard(ctx, options) {
  workBranch(ctx.root, "unguard", ctx.branch);
  // Refused here, before anything is read or changed.
  if (!options.id?.trim() || /[\r\n]/.test(options.id)) {
    throw new Failure("unguard needs --id <id>: the finding's id, as its red commits' summaries start with it");
  }
  const outcome = oneOf(options.outcome, ["declined", "deferred"], "--outcome");
  if (!options.body?.trim()) {
    throw new Failure(
      'unguard needs --body <text>: the outcome in one line, such as "Declined by the owner: <the reason>"',
    );
  }
  const message = {
    type: "test",
    scope: ctx.scope,
    tag: options.tag,
    summary: `${options.id.trim()}: guard removed, ${outcome}`,
    body: newlines(options.body),
  };
  commitMessage(message);
  return committing(ctx, options, () => unguarded(ctx, options, message));
}

// The options every patch here is written with, so that `git apply` reads it whatever the machine's git is set
// to: binary files whole, a rename as a deletion and an addition, no colour, no outside program, and the
// prefixes a patch has by default.
const PATCH = [
  "diff",
  "--binary",
  "--full-index",
  "--no-renames",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

// The commits `--red` names, newest first, each with its whole and its short hash. Each is named by its hash,
// whole or shortened, and must be a `red` commit of this tag and finding on the current branch.
function redCommits(ctx, given, tag, id) {
  const names = (given ?? [])
    .flatMap((value) => value.split(","))
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Failure("unguard needs --red <commit>[,<commit>...]: the hashes of the finding's red commits");
  }
  const reds = new Map();
  for (const name of names) {
    const sha = /^[0-9a-f]{4,64}$/i.test(name)
      ? git(ctx.root, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`], { mayFail: true }).stdout.trim()
      : "";
    if (!sha) {
      throw new Failure(
        `nothing was changed: --red ${oneLine(name)} names no commit; give each red commit's hash, as commit printed it`,
      );
    }
    if (reds.has(sha)) continue;
    const short = sha.slice(0, 7);
    const subject = git(ctx.root, ["log", "-1", "--format=%s", sha]).stdout.trim();
    if (!isRedCommit(subject, tag, id)) {
      throw new Failure(
        `nothing was changed: --red ${short} is not a red commit of finding ${id.trim()} with the tag ` +
          `${tagName(tag)}; its subject is "${oneLine(subject)}"`,
      );
    }
    if (git(ctx.root, ["merge-base", "--is-ancestor", sha, "HEAD"], { mayFail: true }).status !== 0) {
      throw new Failure(`nothing was changed: --red ${short} is not a commit of the current branch`);
    }
    // How many commits the branch has made since: the fewer, the newer.
    const since = Number(git(ctx.root, ["rev-list", "--count", `${sha}..HEAD`]).stdout.trim());
    reds.set(sha, { sha, short, since });
  }
  return [...reds.values()].sort((a, b) => a.since - b.since);
}

// What reversing the red commits, newest first, does to HEAD: the paths it changes and the one patch that changes
// them, the bookkeeping files (`kept`) left out. It is worked out in an index of its own, which starts as HEAD:
// nothing of the working tree or its index is read or changed here, so a commit whose reverse does not apply is
// refused with everything as it was.
function reversal(ctx, reds, kept) {
  const index = join(ctx.gitFolder, `unguard.${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const others = ["--", ".", ...kept.map((path) => `:(exclude,literal)${path}`)];
  try {
    git(ctx.root, ["read-tree", "HEAD"], { env });
    for (const red of reds) {
      const patch = git(ctx.root, [...PATCH, red.sha, `${red.sha}~1`, ...others], { bytes: true }).stdout;
      if (patch.length === 0) {
        throw new Failure(
          `nothing was changed: --red ${red.short} holds no guard test; it changed only the bookkeeping's own files ` +
            "(the state file, the reviews file, tasks.md), which are never reversed",
        );
      }
      const applied = git(ctx.root, ["apply", "--cached", "--whitespace=nowarn", "-"], {
        env,
        input: patch,
        bytes: true,
        mayFail: true,
      });
      if (applied.status !== 0) {
        throw new Failure(
          `nothing was changed: the reverse of ${red.short} does not apply cleanly; git says: ${gitSaid(applied)}`,
        );
      }
    }
    const paths = git(ctx.root, ["diff", "--cached", "--no-renames", "--name-only", "-z", "HEAD"], { env })
      .stdout.split("\0")
      .filter(Boolean);
    return { paths, patch: git(ctx.root, [...PATCH, "--cached", "HEAD"], { env, bytes: true }).stdout };
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

// `unguard`'s work under the lock. Everything that can be refused is refused before anything is changed; then the
// one patch is applied to the working tree and the index, which git does whole or not at all, and committed. If
// that commit fails, the patch is taken back, so that the command can be run again.
function unguarded(ctx, options, message) {
  const reds = redCommits(ctx, options.red, options.tag, options.id);
  // The state file, the reviews file and tasks.md are never reversed, whatever a red commit did to them: they
  // hold what was recorded since.
  const { paths, patch } = reversal(ctx, reds, bookkeeping(ctx));
  if (paths.length === 0) {
    throw new Failure("nothing was changed: the red commits undo each other, so reversing them changes no file");
  }
  const changed = parseStatus(
    git(ctx.root, ["--literal-pathspecs", "status", "--porcelain", "--untracked-files=all", "-z", "--", ...paths])
      .stdout,
  ).map((entry) => entry.path);
  if (changed.length > 0) {
    throw new Failure(
      `nothing was changed: the reverse does not apply cleanly; uncommitted changes in ${named(changed)}`,
    );
  }
  const before = existsSync(ctx.state.path) ? readText(ctx.state.path) : null;
  const resumed = options.resume !== undefined;
  if (resumed && before === null) throw new Failure(`--resume: no ${ctx.state.shown}: run ${ctx.started} first`);
  const state = resumed ? setSection(before, "Resume here", newlines(options.resume)) : before;
  const trailers = state === null ? null : keyValue(state, "Run", "Commit trailers");
  const text = commitMessage({ ...message, trailers });

  const apply = (...how) =>
    git(ctx.root, ["apply", "--index", "--whitespace=nowarn", ...how, "-"], {
      input: patch,
      bytes: true,
      mayFail: true,
    });
  const applied = apply();
  if (applied.status !== 0) {
    throw new Failure(`nothing was changed: the reverse does not apply cleanly; git says: ${gitSaid(applied)}`);
  }
  // As for `commit --path`: exactly the reversed paths and, with --resume, the state file when it is one of the
  // working tree's. Whatever else is changed or staged stays as it is.
  const own = resumed && ctx.state.inside ? [ctx.state.shown] : [];
  try {
    if (resumed) writeAtomic(ctx.state.path, state);
    if (own.length > 0) git(ctx.root, ["--literal-pathspecs", "add", "--", ...own]);
    const { sha, at } = gitCommit(ctx.root, text, [...paths, ...own]);
    return { parts: [`${sha} ${text.split("\n")[0]}`, `reversed ${reds.map((red) => red.short).join(", ")}`], at };
  } catch (e) {
    // No commit was made: the guard test goes back in, and `Resume here` back to what it said.
    const back = apply("-R").status === 0;
    if (resumed) writeAtomic(ctx.state.path, before);
    if (own.length > 0) git(ctx.root, ["--literal-pathspecs", "reset", "--quiet", "--", ...own], { mayFail: true });
    const left = back ? "nothing was changed" : "the reverse of the red commits stays applied and staged";
    throw new Failure(`${left}: no commit was made; ${e.message}`, e instanceof Failure ? e.code : 1);
  }
}

// The bookkeeping's own files among the working tree's, by their paths from its root: the state file, the reviews
// file and tasks.md. `unguard` never reverses them, and `shelve` never sets them aside: they hold what was
// recorded since. (A triage has no reviews file, and one without a change keeps its state file in git's folder
// and has no tasks.md.)
const bookkeeping = (ctx) =>
  [ctx.state, ctx.reviews, ctx.tasks].filter((file) => file?.inside).map((file) => file.shown);

// Whether a path is one that `shelve` never sets aside and `unshelve` never writes: the account's own bookkeeping
// files, and every state file, reviews file and triage's state file under openspec/changes, whoever's it is. An
// apply and a triage may be under way in one working tree, and neither may set the other's records aside.
function neverShelved(ctx) {
  const own = bookkeeping(ctx);
  const records = [STATE_FILE, REVIEWS_FILE, TRIAGE_FILE];
  return (path) =>
    own.includes(path) ||
    (path.startsWith("openspec/changes/") && records.includes(path.slice(path.lastIndexOf("/") + 1)));
}

// Runs the part of `shelve` or `unshelve` that changes nothing yet: whatever is refused or fails in it is told as
// a refusal that starts with `nothing was changed: `, the words a caller goes by.
function beforeAnyChange(work) {
  try {
    return work();
  } catch (e) {
    const said = e.message.startsWith("nothing was changed: ") ? e.message : `nothing was changed: ${e.message}`;
    throw new Failure(said, e instanceof Failure ? e.code : 1);
  }
}

// What git is in the middle of in this working tree, in words; null when it is at rest. An unfinished merge,
// cherry-pick, revert or rebase keeps its state in the index and the git folder, and setting work aside or putting
// it back would wipe or mix it.
function gitOperation(root) {
  // A rebase first: while it stops at a commit, git may keep that commit's own mark beside the rebase's.
  const marks = [
    ["rebase-merge", "a rebase"],
    ["rebase-apply", "a rebase"],
    ["MERGE_HEAD", "a merge"],
    ["CHERRY_PICK_HEAD", "a cherry-pick"],
    ["REVERT_HEAD", "a revert"],
  ];
  const paths = git(root, ["rev-parse", ...marks.flatMap(([name]) => ["--git-path", name])]).stdout.split(/\r?\n/);
  const under = marks.find((_, i) => existsSync(resolve(root, paths[i])));
  if (under !== undefined) return under[1];
  return git(root, ["ls-files", "--unmerged", "-z"]).stdout.length > 0 ? "a conflict that is not settled" : null;
}

// Paths for a message: the first five, and how many more there are.
const named = (paths) => `${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ` and ${paths.length - 5} more` : ""}`;

// Paths as git reads them from its standard input with `-z` or `--pathspec-file-nul`: each ended by a NUL, so
// that no path is quoted and no number of them is too many for a command line.
const nulEnded = (paths) => paths.map((path) => `${path}\0`).join("");

// Every path git reports as changed, deleted or new, in the working tree or the index (not an ignored one): a new
// file by its own path, a renamed one by both its paths.
function uncommittedPaths(root) {
  const reported = parseStatus(git(root, ["status", "--porcelain", "--untracked-files=all", "-z"]).stdout);
  const paths = reported.flatMap((entry) => (entry.from === undefined ? [entry.path] : [entry.path, entry.from]));
  return [...new Set(paths)];
}

// The refs that keep the work set aside: of this working tree alone (git keeps `refs/worktree/` per working tree,
// in its own git folder, and never pushes it), under the account's name, so that an apply's keys and a triage's
// in the same tree cannot meet.
const SHELVED = "refs/worktree/tdd/shelved";

// The key `--key` gives and the ref that keeps its work. A key is letters, digits, dots, dashes and underscores,
// and a name git takes for a ref. So must the change's name be, which the ref holds too (a triage's `triage-<id>`
// always is): a change folder may be named so that git takes no ref for it, and the refusal then names the change.
function shelf(ctx, command, given) {
  const key = given?.trim() ?? "";
  const ref = `${SHELVED}/${ctx.account}/${key}`;
  const aRef = (name) => git(ctx.root, ["check-ref-format", name], { mayFail: true }).status === 0;
  if (!aRef(`${SHELVED}/${ctx.account}/Q1`)) {
    throw new Failure(
      `--change ${ctx.account}: ${command} keeps the work under ${SHELVED}/<change>/<key>, and git takes no ref ` +
        "named after this change (no two dots in a row, no .lock at its end)",
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(key) || !aRef(ref)) {
    throw new Failure(
      `${command} needs --key <key>: the name the work is set aside under, of letters, digits, dots, dashes and ` +
        `underscores, such as Q2 (no dot first or last, no two dots in a row, no .lock at its end)` +
        (key ? `: "${oneLine(key)}"` : ""),
    );
  }
  return { key, ref };
}

// The commit a ref names; null when there is no such ref. That is git's own answer, its exit code alone: `rev-parse
// --verify --quiet` exits 1 for a name that names nothing, whatever else git writes to stderr meanwhile (a trace,
// GIT_TRACE; a warning). It is asked of the ref itself, and only then of the commit: asked of `<ref>^{commit}`, git
// exits 1 also for a ref that names no commit, or an object that is not there. Such a ref, and a git that cannot
// answer, are refused in git's own words, and never taken for a ref that is not there.
function refCommit(root, ref) {
  const found = git(root, ["rev-parse", "--verify", "--quiet", ref], { mayFail: true });
  if (found.status === 1) return null;
  if (found.status !== 0) throw new Failure(`git rev-parse failed: ${gitSaid(found) || `exit ${found.status}`}`);
  const commit = git(root, ["rev-parse", "--verify", "--quiet", `${found.stdout.trim()}^{commit}`], { mayFail: true });
  if (commit.status === 0) return commit.stdout.trim();
  throw new Failure(`git rev-parse failed: ${ref} names no commit: ${gitSaid(commit) || `exit ${commit.status}`}`);
}

// The keys under which the account has work set aside.
function shelvedKeys(ctx) {
  const under = `${SHELVED}/${ctx.account}/`;
  return git(ctx.root, ["for-each-ref", "--format=%(refname)", under])
    .stdout.split(/\r?\n/)
    .filter(Boolean)
    .map((ref) => ref.slice(under.length));
}

// The paths in which one tree differs from another, each with git's letter for what the second did to it: A (it
// has the path, the first has not), D (the other way round), M or T. A rename counts as a deletion and an
// addition.
function changedPaths(root, from, to) {
  const records = git(root, ["diff", "--no-renames", "--name-status", "-z", from, to]).stdout.split("\0");
  const entries = [];
  for (let i = 0; i + 1 < records.length; i += 2) entries.push({ status: records[i], path: records[i + 1] });
  return entries;
}

// Runs `work` with an index of its own, which starts as the tree given, and answers what it answers: `work` gets
// the environment in which git uses that index. The working tree's real index is neither read nor changed.
function withIndexOf(ctx, tree, work) {
  const index = join(ctx.gitFolder, `shelve.${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(ctx.root, ["read-tree", tree], { env });
    return work(env);
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

// Deletes a file of the working tree, and then every folder above it that this leaves empty, as git does. A
// folder that stands at the path is left: the file is gone already, and the folder holds other paths' files.
function removeFile(root, path) {
  const file = join(root, path);
  if (standing(root, path)?.isDirectory()) return;
  rmSync(file, { force: true });
  for (let folder = dirname(file); folder !== root && within(root, folder); folder = dirname(folder)) {
    try {
      rmdirSync(folder);
    } catch {
      break; // not empty, or gone already
    }
  }
}

// Makes paths of the working tree what a tree has: each path of `entries` is written as git would check it out
// from the tree (its line endings, its file mode), or with `gone` deleted. The deletions come first: a file may
// stand where a folder is to be. The tree is read into an index of its own, so the real index stays as it is.
function writeFromTree(ctx, tree, entries) {
  for (const { path } of entries.filter((entry) => entry.gone)) removeFile(ctx.root, path);
  const written = entries.filter((entry) => !entry.gone).map((entry) => entry.path);
  if (written.length === 0) return;
  withIndexOf(ctx, tree, (env) =>
    git(ctx.root, ["checkout-index", "--force", "-z", "--stdin"], { env, input: nulEnded(written) }),
  );
}

// What stands at a path of the working tree: a file, a folder, or a link, whatever it points at; undefined when
// nothing does, also when a file stands where one of the path's folders would be (which Linux answers as an
// error, and Windows as nothing there).
function standing(root, path) {
  try {
    return lstatSync(join(root, path), { throwIfNoEntry: false });
  } catch (e) {
    if (e.code === "ENOTDIR") return undefined;
    throw e;
  }
}

// The paths the last commit has.
const committedPaths = (root) =>
  new Set(git(root, ["ls-tree", "-r", "-z", "--name-only", "HEAD"]).stdout.split("\0").filter(Boolean));

// Takes paths back to the last commit, in the working tree and in the index: a path the commit has (`committed`
// holds those) is checked out from it; one it lacks is taken out of the index and deleted. (Out of the index by
// its exact path, and not as a pathspec: a new file may stand where the last commit has a folder, and nothing of
// that folder's entries may go.)
function backToLastCommit(ctx, paths, committed) {
  const { root } = ctx;
  const fromFile = ["--pathspec-from-file=-", "--pathspec-file-nul"];
  const fresh = paths.filter((path) => !committed.has(path));
  if (fresh.length > 0) {
    git(root, ["update-index", "--force-remove", "-z", "--stdin"], { input: nulEnded(fresh) });
    for (const path of fresh) removeFile(root, path);
  }
  const kept = paths.filter((path) => committed.has(path));
  if (kept.length > 0) {
    git(root, ["--literal-pathspecs", "checkout", "--quiet", "HEAD", ...fromFile], { input: nulEnded(kept) });
  }
}

// Sets a task's uncommitted work aside while its question waits for the owner, so that the tree is the last
// commit again and the next task starts clean: every path git reports as changed, deleted or new (not an ignored
// one), but for the bookkeeping's own files. Prints `shelved <key>: <n> files`.
function shelve(ctx, options) {
  const { key, ref } = shelf(ctx, "shelve", options.key);
  say(lockedOrUnchanged(ctx, () => shelved(ctx, key, ref)));
}

// Runs `work` while holding the working tree's lock, as `locked` does; a lock that cannot be taken is told as a
// refusal that changed nothing, like every other refusal of `shelve` and `unshelve`. What `work` itself throws is
// passed on as it is: it says for itself what was changed.
function lockedOrUnchanged(ctx, work) {
  let entered = false;
  try {
    return locked(ctx, () => {
      entered = true;
      return work();
    });
  } catch (e) {
    if (entered) throw e;
    throw new Failure(`nothing was changed: ${e.message}`);
  }
}

// The tree a set of paths comes to when git adds them, as they stand in the working tree, to an index: one of its
// own that starts as a commit (`from` names it), or a copy of the working tree's real index (`from` is null). The
// real index is never changed. A path that neither that index nor the working tree has is left out: there is
// nothing of it to add, and `git add` would refuse it. So is, in the copy of the real index, a path that the last
// commit has (`committed`) and the index does not: the index has stopped tracking it (`git rm --cached`), which
// no file on disk can show, and adding it would take that back. A path where a folder stands now has no file to
// add, and only leaves the index: the files in the folder that git reports are paths of their own. The others are
// added with --force: each is one git reports or the index holds, and so no ignored file of its own, but git
// refuses without it a tracked file that a rule ignores, or one in an ignored folder.
function treeOfPaths(ctx, from, paths, committed) {
  const { root } = ctx;
  const index = join(ctx.gitFolder, `shelve.${process.pid}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    const real = resolve(root, git(root, ["rev-parse", "--git-path", "index"]).stdout.trim());
    if (from === null && existsSync(real)) copyFileSync(real, index);
    else git(root, ["read-tree", from ?? "HEAD"], { env });
    const held = new Set(git(root, ["ls-files", "-z"], { env }).stdout.split("\0"));
    const untracked = (path) => from === null && committed.has(path);
    const present = paths.filter((path) => held.has(path) || (standing(root, path) !== undefined && !untracked(path)));
    const folders = present.filter((path) => standing(root, path)?.isDirectory() === true);
    const files = present.filter((path) => !folders.includes(path));
    if (folders.length > 0) {
      git(root, ["update-index", "--force-remove", "-z", "--stdin"], { env, input: nulEnded(folders) });
    }
    if (files.length > 0) {
      git(root, ["--literal-pathspecs", "add", "--all", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], {
        env,
        input: nulEnded(files),
      });
    }
    return git(root, ["write-tree"], { env }).stdout.trim();
  } finally {
    rmSync(index, { force: true });
    rmSync(`${index}.lock`, { force: true });
  }
}

// The ignored files that taking paths back to the last commit would delete: git removes whatever stands in the
// way of a file it checks out, and an ignored file is on no list of what was set aside. So is every ignored file
// in a folder that stands where a committed file is to be, and an ignored file that stands where one of its
// folders is to be. (`paths` are the committed ones among those to take back, `reported` every path git reports:
// a file that is not ignored is among them, and is set aside.)
function ignoredInTheWay(root, paths, reported) {
  const inTheWay = new Set();
  for (const path of paths) {
    const parts = path.split("/");
    for (const folder of parts.slice(1).map((_, i) => parts.slice(0, i + 1).join("/"))) {
      const there = standing(root, folder);
      if (there !== undefined && !there.isDirectory() && !reported.has(folder)) inTheWay.add(folder);
    }
    if (!standing(root, path)?.isDirectory()) continue;
    const listIgnored = ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"];
    const ignored = git(root, ["--literal-pathspecs", ...listIgnored, "--", path]).stdout.split("\0");
    for (const file of ignored.filter(Boolean)) inTheWay.add(file);
  }
  return [...inTheWay];
}

// `shelve`'s work under the lock. The work becomes a commit on the last commit that no branch holds: its tree is
// built in an index of its own from the paths git reports, so binary files, file modes and line endings are
// git's own business. Everything that can be refused is refused before anything is changed (`shelvePlan`); then
// the ref takes the commit, and only then are the paths taken back to the last commit (`setAside`).
function shelved(ctx, key, ref) {
  const { root } = ctx;
  const { head, changed, committed, work, commit } = beforeAnyChange(() => shelvePlan(ctx, key, ref));
  setAside(key, {
    keep: step("keep", () => git(root, ["update-ref", ref, commit, ""])), // refused when the ref is there after all
    clear: step("clear", () => backToLastCommit(ctx, changed, committed)),
    writeBack: step("writeBack", () => writeFromTree(ctx, commit, asWritten(work))),
    forget: step("forget", () => git(root, ["update-ref", "-d", ref, commit])),
    keyHolds: step("keyHolds", () => refCommit(root, ref) === commit),
    treeHolds: step("treeHolds", () => {
      const [inWork, inLast] = [blobsOf(root, commit), blobsOf(root, head)];
      return heldAs(root, changed, { work: (path) => inWork.get(path), last: (path) => inLast.get(path) });
    }),
    paths: changed,
  });
  return `shelved ${key}: ${plural(work.length, "file")}`;
}

// The blobs a tree holds, by their paths: each file's object id (a submodule's commit counts as no file).
function blobsOf(root, treeish) {
  const blobs = new Map();
  for (const entry of git(root, ["ls-tree", "-r", "-z", treeish]).stdout.split("\0").filter(Boolean)) {
    const tab = entry.indexOf("\t");
    const [, type, id] = entry.slice(0, tab).split(" ");
    blobs.set(entry.slice(tab + 1), type === "blob" ? id : "?");
  }
  return blobs;
}

// What `blobOnDisk` answers for a path whose file cannot be read: no object id of a tree is ever this.
const UNREADABLE = Symbol("unreadable");

// What the working tree holds at a path, as git would add it: the object id of the file there (of a link, of the
// path it points to, as git keeps a link), without writing it; null when no file stands there (nothing does, or
// a folder); UNREADABLE for anything else, and for a file that cannot be read (git's clean filter fails on it, say).
function blobOnDisk(root, path) {
  const there = standing(root, path);
  if (there === undefined || there.isDirectory()) return null;
  let r;
  if (there.isSymbolicLink()) {
    r = git(root, ["hash-object", "--stdin", "--no-filters"], { input: readlinkSync(join(root, path)), mayFail: true });
  } else if (there.isFile()) {
    r = git(root, ["hash-object", "--", path], { mayFail: true });
  }
  return r?.status === 0 ? r.stdout.trim() : UNREADABLE;
}

// Which of the trees `shapes` names the working tree holds at the paths, read without changing anything: the first
// whose every path is as the working tree has it (`shapes` gives each tree's object id of a path, undefined where
// it has none), else `neither`. When a path cannot be read, none can be told: `{ unread }` names those paths.
function heldAs(root, paths, shapes) {
  const disk = new Map(paths.map((path) => [path, blobOnDisk(root, path)]));
  const unread = paths.filter((path) => disk.get(path) === UNREADABLE);
  if (unread.length > 0) return { unread };
  const held = Object.entries(shapes).find(([, idOf]) =>
    paths.every((path) => disk.get(path) === (idOf(path) ?? null)),
  );
  return held === undefined ? "neither" : held[0];
}

// A step of `shelve` or `unshelve` that changes something, or a reading of the state after a failure (`keyHolds`,
// `treeHolds`), as the command runs it. TDD_FAIL_STEP makes steps fail for the tests of what the two commands do
// then, also in the states a real failure seldom leaves: it names steps, separated by commas, each failing before
// it does its work, or after it with a `+` behind its name.
const step = (name, work) => () => {
  const failing = (process.env.TDD_FAIL_STEP ?? "").split(",");
  if (failing.includes(name)) throw new Failure(`TDD_FAIL_STEP made the step ${name} fail before its work`);
  const done = work();
  if (failing.includes(`${name}+`)) throw new Failure(`TDD_FAIL_STEP made the step ${name} fail after its work`);
  return done;
};

// What a tree's difference from another means for the working tree's paths, as `writeFromTree` takes it: a path
// the tree lacks is gone.
const asWritten = (entries) => entries.map(({ status, path }) => ({ path, gone: status === "D" }));

// What `shelve` is about to do, worked out and checked without changing anything: the last commit (`head`), the
// paths to take back to it (`changed`), those it has (`committed`), the work as the commit object that keeps it
// (`commit`) and its difference from the last commit (`work`). Refused: a key that holds work; git in the middle
// of a merge or the like; a repository of its own among the paths; nothing to set aside; a change that only the
// index holds; an ignored file that taking the paths back would delete.
function shelvePlan(ctx, key, ref) {
  const { root } = ctx;
  if (refCommit(root, ref) !== null) {
    throw new Failure(
      `the key ${key} holds shelved work already; put that back or drop it first (unshelve --key ${key}), or take ` +
        "another key",
    );
  }
  const under = gitOperation(root);
  if (under !== null) {
    throw new Failure(`git is in the middle of ${under} in this working tree: finish it or abort it first`);
  }
  const kept = neverShelved(ctx);
  const reported = uncommittedPaths(root);
  const changed = reported.filter((path) => !kept(path));
  const nested = changed.filter((path) => path.endsWith("/"));
  if (nested.length > 0) {
    throw new Failure(`${named(nested)} holds a repository of its own, which cannot be set aside`);
  }
  const nothing = "nothing to set aside: the working tree has no uncommitted change but in the bookkeeping's own files";
  if (changed.length === 0) throw new Failure(nothing);

  const head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).stdout.trim();
  const committed = committedPaths(root);
  const tree = treeOfPaths(ctx, head, changed, committed);
  // What is set aside is the working tree's content. A change that the index alone holds (a file renamed in the
  // case of its letters only, a file mode staged where the disk keeps none, a file the index no longer tracks
  // though it stays on disk, ignored or not) is in no file, so it would be lost when the index goes back to the
  // last commit: the tree that is kept must be the one the index and the working tree record together.
  const staged = treeOfPaths(ctx, null, changed, committed);
  const onlyInIndex = changedPaths(root, tree, staged)
    .map((entry) => entry.path)
    .filter((path) => !kept(path));
  if (onlyInIndex.length > 0) {
    throw new Failure(
      `the index holds changes the working tree does not show in ${named(onlyInIndex)}: commit them or take ` +
        "them back first",
    );
  }
  const work = changedPaths(root, head, tree);
  // Git may report a path whose content is the last commit's all the same (a change that was staged and then
  // taken back by hand): that is no work to set aside.
  if (work.length === 0) throw new Failure(nothing);
  const lost = ignoredInTheWay(
    root,
    changed.filter((path) => committed.has(path)),
    new Set(reported),
  );
  if (lost.length > 0) {
    throw new Failure(
      `taking the tree back to the last commit would delete ignored files that stand in the way: ${named(lost)}`,
    );
  }
  const commit = git(root, [
    "commit-tree",
    tree,
    "-p",
    head,
    "-m",
    `tdd.mjs shelve: ${ctx.account}/${key}`,
  ]).stdout.trim();
  return { head, changed, committed, work, commit };
}

// How a refusal of `shelve` or `unshelve` starts when it comes after the first change, or when the state read again
// cannot show that the first change was not made (`setAside`, `putBack`, `throwAway`): the words a caller goes by
// to touch nothing more. No other refusal starts so.
const PART_WAY = "failed part-way: ";

// The causes of a failure, the failed step's first, then what failed on the way back and in reading the state
// again.
const causesText = (causes) => `The cause: ${causes.join("; ")}`;

// A failure after the first change, in one line that is never cut: where the work is now, the way out from there
// (the commands that get out once the cause is gone, in their order; "nothing is left to undo" when there are none),
// then every cause. With `wayOut` null the line names no way out at all: the state could not be read again where it
// matters, and nothing needs doing whichever way it is.
function partWay(where, wayOut, causes) {
  const out =
    wayOut === null
      ? ""
      : wayOut.length === 0
        ? "; nothing is left to undo"
        : `; the way out, once the cause is gone: ${wayOut.join(", then ")}`;
  return new Failure(`${PART_WAY}${where}${out}. ${causesText(causes)}`, 1, { whole: true });
}

// A failure that, as the state read again shows, changed nothing after all: one line, never cut.
const unchanged = (what, causes) =>
  new Failure(`nothing was changed: ${what}. ${causesText(causes)}`, 1, { whole: true });

// The state after a failure, read again: what `look` answers, or `otherwise` when it cannot be read, its cause then
// added to the others.
function readAgain(look, otherwise, causes) {
  try {
    return look();
  } catch (e) {
    causes.push(`reading the state again: ${e.message}`);
    return otherwise;
  }
}

// The working tree in words, after "the working tree", when the reading of it after a failure (`heldAs`) found it
// to be `neither` of the two it may be (`last` names the first: "at the last commit", or "as it was before"), or
// could not read it in full (`{ unread }`, the paths it could not read).
function treeWords(tree, last) {
  if (tree === "neither") return `is neither ${last} nor as the work has it`;
  return `could not be read in full: ${named(tree.unread)} could not be read`;
}

// The way out of a working tree that a failure left neither as it was nor as it was to be, or that could not be
// read in full, while the key holds all of the work: set aside what the tree holds under another key, which takes
// the tree back to the last commit, put the work back, and throw away what the other key holds. (When the tree is
// at the last commit already, the first is refused with nothing to set aside, and the runner leaves out the last.)
const viaAnother = (key) => [
  "shelve --key <another> (takes what is left)",
  `unshelve --key ${key}`,
  "unshelve --key <another> --drop",
];

// The steps of `shelve` that change something, in their order, and what is done and said when one fails. `keep`
// makes the key hold the work, `clear` takes the working tree back to the last commit, `writeBack` writes the
// work into the tree again and `forget` frees the key, which it does only once the tree holds the work again.
// After a failure the state is read again where the steps that ran leave it open: `keyHolds` says whether the key
// holds the work (after `keep` or `forget` failed), `treeHolds` whether the working tree holds the `work`, is at
// the `last` commit or `neither`, or could not be read in full at some of the `paths` (after `writeBack` failed;
// `heldAs`). The line says what is true then, and the shortest way out from there: the commands to run, after
// which the caller sets the work aside again. When the key cannot be read again after `keep` or `forget` failed,
// the tree holds the work (as it was, or again), and the line names no way out: a shelve run again is refused
// while the key holds the work.
export function setAside(key, { keep, clear, writeBack, forget, keyHolds, treeHolds, paths }) {
  const causes = [];
  const copy = [`unshelve --key ${key} --drop`];
  const holdsAgain = `the working tree holds the work again, and the key ${key} still holds a copy of it`;
  try {
    keep();
  } catch (e) {
    causes.push(e.message);
    const holds = readAgain(keyHolds, null, causes);
    if (holds === false) {
      const what = `the work could not be kept under the key ${key}: ${causes.join("; ")}`;
      throw new Failure(`nothing was changed: ${what}`, 1, { whole: true });
    }
    const asItWas = "the working tree holds the work as it was";
    if (holds === null) {
      const where = `${asItWas}, not touched yet, and whether the key ${key} holds a copy of it could not be read`;
      throw partWay(where, null, causes);
    }
    throw partWay(`${asItWas}, and the key ${key} holds a copy of it`, copy, causes);
  }
  try {
    clear();
    return;
  } catch (e) {
    causes.push(e.message);
  }
  // The tree may be part-way between the work and the last commit; the key holds all of the work.
  try {
    writeBack();
  } catch (e) {
    causes.push(`on the way back: ${e.message}`);
    const tree = readAgain(treeHolds, { unread: paths }, causes);
    if (tree === "work") throw partWay(holdsAgain, copy, causes);
    if (tree === "last") {
      const where = `the work is set aside under the key ${key}, and the working tree is at the last commit`;
      throw partWay(where, [`unshelve --key ${key}`], causes);
    }
    const tell = treeWords(tree, "at the last commit");
    throw partWay(`the work is safe under the key ${key}, but the working tree ${tell}`, viaAnother(key), causes);
  }
  try {
    forget();
  } catch (e) {
    causes.push(`on the way back: ${e.message}`);
    const holds = readAgain(keyHolds, null, causes);
    if (holds === true) throw partWay(holdsAgain, copy, causes);
    if (holds === null) {
      const where = `the working tree holds the work again, and whether the key ${key} still holds a copy of it`;
      throw partWay(`${where} could not be read`, null, causes);
    }
  }
  throw partWay(`nothing was set aside: the working tree holds the work again, and the key ${key} is free`, [], causes);
}

// Puts the work set aside under a key back onto the working tree, or with --drop throws it away. Prints
// `put back <key>: <n> files`, or `dropped <key>: <n> files`.
function unshelve(ctx, options) {
  const { key, ref } = shelf(ctx, "unshelve", options.key);
  say(lockedOrUnchanged(ctx, () => unshelved(ctx, key, ref, options.drop === true)));
}

// The tree that holds the last commit with the shelved work merged in: what the shelved commit did to the commit
// it was made on (`base`), on top of what was committed since, by git's three-way merge. Worked out without the
// working tree or an index. Refused, naming the paths, when the two changed the same lines.
function mergedTree(ctx, key, base, commit) {
  // While the branch still holds `base`, it is the merge base git finds itself (git 2.38). After a rewrite of
  // the branch it is not, and git must be told (--merge-base, git 2.40).
  const onBranch = git(ctx.root, ["merge-base", "--is-ancestor", base, "HEAD"], { mayFail: true }).status === 0;
  const merged = git(
    ctx.root,
    ["merge-tree", "--write-tree", "--name-only", "-z", ...(onBranch ? [] : [`--merge-base=${base}`]), "HEAD", commit],
    { mayFail: true },
  );
  return mergedOrRefused(key, { status: merged.status, printed: merged.stdout, said: gitSaid(merged) }, onBranch);
}

// What `git merge-tree --write-tree --name-only -z` answered, read: the merged tree when it exited 0. Exit 1 is a
// conflict: git printed the tree, then the conflicting paths, an empty entry, and what it has to say, each ended
// by a NUL, and the refusal names the paths. Any other exit is a git that cannot do it: one before 2.38, or
// before 2.40 when the merge base had to be named (`onBranch` is false).
export function mergedOrRefused(key, { status, printed, said }, onBranch) {
  const [tree, ...rest] = printed.split("\0");
  if (status === 0) return tree.trim();
  if (status !== 1) {
    const needs = onBranch
      ? "git 2.38 or later"
      : "git 2.40 or later once the branch no longer holds the commit the work was set aside on";
    throw new Failure(`git merge-tree failed (unshelve needs ${needs}): ${said || `exit ${status}`}`);
  }
  const end = rest.indexOf("");
  const conflicting = [...new Set(rest.slice(0, end === -1 ? rest.length : end))];
  throw new Failure(
    `the work shelved under ${key} does not go back cleanly: what was committed since changed the same lines in ` +
      named(conflicting),
  );
}

// The paths, among those given, that a merge driver of the repository's own decides (gitattributes(5), `merge`):
// any value but git's built-in ones. Such a driver may settle a merge for one side without a conflict, so a
// three-way merge there cannot be trusted to keep the shelved change.
function drivenPaths(root, paths) {
  if (paths.length === 0) return [];
  const records = git(root, ["check-attr", "-z", "--stdin", "merge"], { input: nulEnded(paths) }).stdout.split("\0");
  const builtIn = ["unspecified", "set", "unset", "text", "binary", "union"];
  const driven = [];
  for (let i = 0; i + 2 < records.length; i += 3) if (!builtIn.includes(records[i + 2])) driven.push(records[i]);
  return driven;
}

// The tracked paths whose changes git is told to overlook: the skip-worktree and the assume-unchanged bit
// (git-update-index(1)). Git reports no change in them, so a check for uncommitted changes sees none.
function overlookedPaths(root) {
  const listed = git(root, ["ls-files", "-v", "-z"]).stdout.split("\0").filter(Boolean);
  return new Set(listed.filter((entry) => entry[0] !== "H").map((entry) => entry.slice(2)));
}

// Among the paths a put-back would write or delete (`entries`, as `changedPaths` gives them from the last commit
// to the tree), those the working tree does not hold as the last commit has them, and so would lose something:
// - a path the last commit has, with any uncommitted change (`uncommitted` holds every path git reports);
// - a new path where a file of other content stands (one of the same content is no loss: `same` gets its path), a
//   folder that holds anything but files the put-back deletes itself, or a file where one of its folders is to
//   be, unless the put-back deletes that file itself. (Such a file or folder may be an ignored one.)
function blockedPaths(ctx, tree, entries, uncommitted, same) {
  const { root } = ctx;
  const deleted = new Set(entries.filter((entry) => entry.status === "D").map((entry) => entry.path));
  const there = (path) => standing(root, path);
  const fileAbove = (path) => {
    const parts = path.split("/");
    return parts
      .slice(1)
      .map((_, i) => parts.slice(0, i + 1).join("/"))
      .some((folder) => !deleted.has(folder) && there(folder) !== undefined && !there(folder).isDirectory());
  };
  // Whether a folder holds only files the put-back deletes, so that it is gone when the new file is written.
  const goesAway = (folder) =>
    readdirSync(join(root, folder), { withFileTypes: true }).every((entry) =>
      entry.isDirectory() ? goesAway(`${folder}/${entry.name}`) : deleted.has(`${folder}/${entry.name}`),
    );
  const blob = (args) => git(root, args, { mayFail: true }).stdout.trim();
  return entries
    .filter(({ status, path }) => {
      if (status !== "A") return uncommitted.has(path);
      const found = there(path);
      if (found === undefined) return fileAbove(path);
      if (found.isDirectory()) return !goesAway(path);
      if (!found.isFile()) return true;
      const onDisk = blob(["hash-object", "--", path]);
      if (onDisk === "" || onDisk !== blob(["rev-parse", "--verify", "--quiet", `${tree}:${path}`])) return true;
      same.add(path);
      return false;
    })
    .map((entry) => entry.path);
}

// `unshelve`'s work under the lock. Everything that can be refused is refused before anything is changed: the
// merge is worked out without the working tree, and the paths it would write are checked against what the tree
// holds. Then they are written, the real index left as it is (a new file comes back untracked, as it was set
// aside), and only then is the ref deleted. If a write fails half-way, the paths are taken back to what they
// were, and read again.
function unshelved(ctx, key, ref, drop) {
  const { root } = ctx;
  const plan = beforeAnyChange(() => unshelvePlan(ctx, key, ref, drop));
  const forget = step("forget", () => git(root, ["update-ref", "-d", ref, plan.commit]));
  const keyHolds = step("keyHolds", () => refCommit(root, ref) === plan.commit);
  if (drop) {
    throwAway(key, { forget, keyHolds });
    return `dropped ${key}: ${plural(plan.files, "file")}`;
  }
  const { tree, entries, same } = plan;
  // Back to what the paths were: the last commit's, a new path gone again, and a new path where the same file as
  // the work's stood already that file again, written from the work: `write` writes it too, and git deletes a file
  // before it writes it, so a write that fails can leave it gone.
  const before = entries
    .filter((entry) => !same.has(entry.path))
    .map(({ status, path }) => ({ path, gone: status === "A" }));
  const stoodThere = [...same].map((path) => ({ path, gone: false }));
  const paths = entries.map((entry) => entry.path);
  putBack(key, {
    write: step("write", () => writeFromTree(ctx, tree, asWritten(entries))),
    undo: step("undo", () => {
      writeFromTree(ctx, "HEAD", before);
      writeFromTree(ctx, tree, stoodThere);
    }),
    forget,
    keyHolds,
    treeHolds: step("treeHolds", () => {
      const [inLast, inWork] = [blobsOf(root, "HEAD"), blobsOf(root, tree)];
      // As it was before is the last commit, but where the same file as the work's stood already.
      const last = (path) => (same.has(path) ? inWork : inLast).get(path);
      return heldAs(root, paths, { last, work: (path) => inWork.get(path) });
    }),
    paths,
  });
  return `put back ${key}: ${plural(entries.length, "file")}`;
}

// What `unshelve` is about to do, worked out and checked without changing anything: the shelved `commit`, and for
// a drop the number of its `files`; else the `tree` that holds the last commit with the work merged in, its
// difference from the last commit (`entries`: what to write and delete) and the new paths where the same file
// stands already (`same`). Refused: a key that holds nothing; git in the middle of a merge or the like; a path
// both sides changed that a merge driver decides; a merge that conflicts; a path to write whose changes git is
// told to overlook; a path to write where the working tree holds something that would be lost; and any other
// uncommitted change but in the bookkeeping's files. A drop is refused only for a key that holds nothing.
function unshelvePlan(ctx, key, ref, drop) {
  const { root } = ctx;
  const commit = refCommit(root, ref);
  if (commit === null) {
    const keys = shelvedKeys(ctx);
    const others = keys.length > 0 ? `the keys with shelved work: ${keys.join(", ")}` : "no key holds shelved work";
    throw new Failure(`no shelved work under the key ${key}; ${others}`);
  }
  const base = git(root, ["rev-parse", "--verify", `${commit}^`]).stdout.trim();
  const shelvedPaths = changedPaths(root, base, commit).map((entry) => entry.path);
  if (drop) return { commit, files: shelvedPaths.length };

  const under = gitOperation(root);
  if (under !== null) {
    throw new Failure(`git is in the middle of ${under} in this working tree: finish it or abort it first`);
  }
  // A path that only one side changed is taken from that side; a merge driver is asked only where both did.
  const since = new Set(changedPaths(root, base, "HEAD").map((entry) => entry.path));
  const driven = drivenPaths(
    root,
    shelvedPaths.filter((path) => since.has(path)),
  );
  if (driven.length > 0) {
    throw new Failure(
      `the work shelved under ${key} cannot be merged with what was committed since: a merge driver decides ` +
        named(driven),
    );
  }
  const tree = mergedTree(ctx, key, base, commit);
  // The bookkeeping's files were not set aside, so the merge leaves them as the last commit has them; they are
  // left out all the same: this command never writes them.
  const kept = neverShelved(ctx);
  const entries = changedPaths(root, "HEAD", tree).filter((entry) => !kept(entry.path));
  const overlooked = overlookedPaths(root);
  const unseen = entries.map((entry) => entry.path).filter((path) => overlooked.has(path));
  if (unseen.length > 0) {
    throw new Failure(
      `the work shelved under ${key} cannot be written: git is told to overlook changes in ${named(unseen)} ` +
        "(skip-worktree or assume-unchanged), so what the working tree holds there cannot be checked",
    );
  }
  const same = new Set();
  const uncommitted = uncommittedPaths(root);
  const blocked = blockedPaths(ctx, tree, entries, new Set(uncommitted), same);
  // Nor may the tree hold an uncommitted change anywhere else, but in the bookkeeping's files: the way out of a
  // put-back that fails part-way sets aside every uncommitted change and throws it away at its end, so it must
  // meet none but the put-back's own. (A new file of the work that stands there already, the same, is its own.)
  const elsewhere = uncommitted.filter((path) => !kept(path) && !same.has(path));
  const inTheWay = [...new Set([...blocked, ...elsewhere])].sort();
  if (inTheWay.length > 0) {
    throw new Failure(
      `the work shelved under ${key} does not go back cleanly: the working tree holds uncommitted changes or ` +
        `other files in ${named(inTheWay)}`,
    );
  }
  return { commit, tree, entries, same };
}

// The steps of `unshelve` that change something, in their order, and what is done and said when one fails.
// `write` writes the work into the working tree, `undo` takes the paths back to what they were, and `forget`
// frees the key. After a failure the state is read again where the steps that ran leave it open: `treeHolds`
// says whether the paths are as they were (`last`), hold the `work` or `neither`, or could not be read in full at
// some of the `paths` (after `write` failed, whether `undo` failed too or not; `heldAs`), `keyHolds` whether the
// key still holds the work (after `forget` failed). The line starts with PART_WAY unless the paths read as they
// were, so that nothing was changed after all, and gives the shortest way out from there. When the key cannot be
// read again after `forget` failed, the work is back, and the line names no way out: a copy the key may still
// hold harms nothing.
export function putBack(key, { write, undo, forget, keyHolds, treeHolds, paths }) {
  const causes = [];
  const back = "the work is back in the working tree";
  const copy = [`unshelve --key ${key} --drop`];
  try {
    write();
  } catch (e) {
    causes.push(e.message);
    try {
      undo();
    } catch (e2) {
      causes.push(`on the way back: ${e2.message}`);
    }
    const tree = readAgain(treeHolds, { unread: paths }, causes);
    if (tree === "last") {
      throw unchanged(`the work shelved under ${key} could not be written and is still under the key`, causes);
    }
    if (tree === "work") throw partWay(`${back}, and the key ${key} still holds a copy of it`, copy, causes);
    const tell = treeWords(tree, "as it was before");
    throw partWay(`the work is still safe under the key ${key}, but the working tree ${tell}`, viaAnother(key), causes);
  }
  try {
    forget();
  } catch (e) {
    causes.push(e.message);
    const holds = readAgain(keyHolds, null, causes);
    if (holds === true) throw partWay(`${back}, and the key ${key} still holds a copy of it`, copy, causes);
    if (holds === null) {
      throw partWay(`${back}, and whether the key ${key} still holds a copy of it could not be read`, null, causes);
    }
    throw partWay(`${back}, and the key ${key} is free`, [], causes);
  }
}

// What `unshelve --drop` changes: `forget` frees the key, and nothing else. When it fails, `keyHolds` says whether
// the key still holds the work, so that nothing was changed, or holds it no more, which is what was asked. When the
// key cannot be read again, the line says so and names no way out: the tree is unchanged either way, and work the
// key may still hold harms nothing.
export function throwAway(key, { forget, keyHolds }) {
  try {
    forget();
  } catch (e) {
    const causes = [e.message];
    const holds = readAgain(keyHolds, null, causes);
    if (holds === true) {
      throw unchanged(`the work shelved under ${key} could not be thrown away and is still under the key`, causes);
    }
    if (holds === null) {
      const unknown = `whether the key ${key} still holds the shelved work could not be read`;
      throw partWay(`the working tree is unchanged, and ${unknown}`, null, causes);
    }
    throw partWay(`the work shelved under ${key} is thrown away, as asked`, [], causes);
  }
}

// Indexes the working tree in the code graph and, when a state file is there, notes the project in its local
// file: that is how a machine that has no local file yet (a fresh clone) gets the project's name.
function index(ctx) {
  const graph = indexGraph(ctx.root);
  if (graph.failed) throw new Failure(graphText(graph));
  if (graph.project !== undefined && existsSync(ctx.state.path)) {
    locked(ctx, () => putLocal(ctx.local.path, ctx.account, "Run", GRAPH_PROJECT, graph.project));
  }
  say(graphText(graph));
}

// Opens a new log file in the folder: the name as it is, or with -2, -3, … before its extension when a run in the
// same second took it.
function openLog(folder, name) {
  for (let n = 1; ; n++) {
    const path = join(folder, n === 1 ? name : name.replace(/\.log$/, `-${n}.log`));
    try {
      return { path, fd: openSync(path, "wx") };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}

// Ends a process with everything it started.
function stopTree(pid) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // the group the command leads (`detached` below)
  } catch {
    // already gone
  }
}

// A --timeout as a number of minutes: the default when none is given.
function timeLimit(given, byDefault) {
  const minutes = given === undefined ? byDefault : Number(given);
  if (!(minutes > 0) || !Number.isFinite(minutes)) throw new Failure("--timeout is a number of minutes above 0");
  return minutes;
}

// Starts a command (`plan`: spawnPlan's) in a folder, with no standard input and with its standard output and
// error output going, in the order written, to a new log file of that name in the logs' folder. At the time limit
// it stops the command with everything it started. Answers the log's path, how long the command ran, and how it
// ended: `error` when it could not be started (the log is then removed), else its exit `code`, 124 when it was
// stopped at the limit (`timedOut`).
async function logged(plan, { cwd, logs, name, limitMs }) {
  mkdirSync(logs, { recursive: true });
  const log = openLog(logs, name);
  const started = Date.now();
  const ended = await new Promise((done) => {
    const child = spawn(plan.file, plan.args, {
      ...plan.options,
      cwd,
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child.pid);
    }, limitMs);
    const interrupted = () => {
      stopTree(child.pid);
      process.exit(130);
    };
    process.once("SIGINT", interrupted);
    process.once("SIGTERM", interrupted);
    const end = (result) => {
      clearTimeout(timer);
      process.off("SIGINT", interrupted);
      process.off("SIGTERM", interrupted);
      done(result);
    };
    child.once("error", (error) => end({ error }));
    child.once("exit", (code, signal) => end({ code, signal, timedOut }));
  });
  closeSync(log.fd);
  if (ended.error) {
    rmSync(log.path, { force: true });
    return { error: ended.error };
  }
  return {
    log: log.path,
    durationMs: Date.now() - started,
    timedOut: ended.timedOut,
    code: ended.timedOut ? 124 : (ended.code ?? 128 + (constants.signals[ended.signal] ?? 0)),
  };
}

// The install of one npm folder as it stands: its state, and what is wrong with it (installs.mjs). Throws for a
// lockfile that cannot be judged, and for a file that cannot be read.
function installOf(root, folder) {
  const at = (path) => join(root, folder, path);
  return installState({
    lockfile: readFileSync(at(LOCKFILE), "utf8"),
    record: existsSync(at(RECORD)) ? readFileSync(at(RECORD), "utf8") : null,
    modules: statSync(at("node_modules"), { throwIfNoEntry: false })?.isDirectory() === true,
    holds: (path) => existsSync(at(join(path, "package.json"))),
  });
}

// An install's state as its line shows it: `ok`, `missing`, or `stale: <what is wrong>`.
const installText = ({ state, why }) => (why === null ? state : `${state}: ${why}`);

// What npm said of a failure, on one line: its error lines (`npm error …`; `npm ERR! …` before npm 10), or the
// last lines of its output when it wrote none.
function npmSaid(log) {
  const lines = stripAnsi(readFileSync(log, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const errors = lines.filter((line) => /^npm (error|ERR!)/.test(line));
  return oneLine((errors.length > 0 ? errors.slice(0, 4) : lines.slice(-3)).join("\n"));
}

// Checks the npm install of every install folder of the working tree and has npm make the ones that are missing
// or stale: `npm ci` in the folder, its output in a log, and the folder checked again afterwards. One line per
// folder; a folder that could not be checked or installed is an `ERROR:` line on stderr, the others still get
// their turn, and the exit code is then 1. With --dry-run nothing is run.
async function install(ctx, options) {
  const minutes = timeLimit(options.timeout, 9);
  const deadline = Date.now() + minutes * 60_000;
  const tracked = git(ctx.root, ["ls-files", "-z", "--", `:(glob)**/${LOCKFILE}`]).stdout.split("\0");
  const folders = installFolders(tracked.filter((path) => path && existsSync(join(ctx.root, path))));
  if (folders.length === 0) return say(`install: no folder with a tracked ${LOCKFILE}`);

  // The command as it was called, for the line of a folder whose install failed.
  const whose = [
    ...(options.change === undefined ? [] : [` --change ${options.change}`]),
    ...(options.pr === undefined ? [] : [` --pr ${options.pr}`]),
  ];
  const again = `run again: node .claude/skills/tdd-apply/scripts/tdd.mjs install${whose.join("")}`;
  const npm = process.env.TDD_NPM_CLI || "npm";
  let failed = false;
  const fail = (folder, ...parts) => {
    failed = true;
    process.stderr.write(`ERROR: install: ${[folder, ...parts].join(" | ")}\n`);
  };

  for (const folder of folders) {
    let found;
    try {
      found = installOf(ctx.root, folder);
    } catch (e) {
      fail(folder, oneLine(e.message));
      continue;
    }
    const state = installText(found);
    if (found.state === "ok") {
      say(`install: ${folder} | ok`);
      continue;
    }
    if (options["dry-run"]) {
      say(`install: ${folder} | ${state} | npm ci: not run (--dry-run)`);
      continue;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      fail(folder, state, `npm ci not started: the time limit (${minutes} min) was reached`, again);
      continue;
    }
    const cwd = join(ctx.root, folder);
    const ended = await logged(spawnPlan(npm, ["ci"], { cwd }), {
      cwd,
      logs: join(tmpdir(), "tdd-runs", ctx.runs ?? "install"),
      name: logFileName(`npm ci ${folder}`, new Date()),
      limitMs: left,
    });
    if (ended.error) {
      const why = ended.error.code === "ENOENT" ? `${oneLine(npm)} is not on the PATH` : oneLine(ended.error.message);
      fail(folder, state, `npm ci cannot be started: ${why}`);
      continue;
    }
    const log = `log: ${slashed(ended.log)}`;
    const took = formatDuration(ended.durationMs);
    const incomplete = "its node_modules may now be incomplete";
    if (ended.timedOut) {
      fail(folder, state, `npm ci stopped at the time limit (${minutes} min): ${incomplete}`, again, log);
      continue;
    }
    if (ended.code !== 0) {
      const said = `npm said: ${npmSaid(ended.log)}`;
      fail(folder, state, `npm ci failed (exit ${ended.code}) after ${took}: ${incomplete}`, again, log, said);
      continue;
    }
    // npm's word is not taken for it: the folder is read again, by the same rule.
    let now;
    try {
      now = installText(installOf(ctx.root, folder));
    } catch (e) {
      now = oneLine(e.message);
    }
    if (now !== "ok") {
      const still = `the install is still not what the lockfile says: ${now}`;
      fail(folder, state, `npm ci ended without an error after ${took}, and ${still}`, log);
      continue;
    }
    say(`install: ${folder} | ${state} | npm ci: done in ${took}`);
  }
  return failed ? 1 : 0;
}

// Runs a command in the repository's root, where CLAUDE.md § Commands says every command runs, with its standard
// output and error output going, in the order written, to one log file under the temp folder's tdd-runs (an
// apply's in a folder named after the change, a triage's in `pr-<id>`). Prints test-output.mjs's short report,
// which says which failed tests the state file allows to fail, and answers the command's exit code.
async function run(ctx, options, command) {
  if (!command?.length) throw new Failure("run needs a command after --: run --label <name> -- <command> [args...]");
  const minutes = timeLimit(options.timeout, 30);
  const name = logFileName(options.label, new Date());
  const ended = await logged(spawnPlan(command[0], command.slice(1), { cwd: ctx.root }), {
    cwd: ctx.root,
    logs: join(tmpdir(), "tdd-runs", ctx.runs),
    name,
    limitMs: minutes * 60_000,
  });
  if (ended.error) {
    const why = ended.error.code === "ENOENT" ? "it is not on the PATH" : ended.error.message;
    throw new Failure(`cannot start ${oneLine(command[0])}: ${why}`, 127);
  }
  const { code } = ended;
  // The tests allowed to fail are read after the run, as the state file then stands; without a state file there
  // is no list, and the report says nothing about it.
  const allowed = existsSync(ctx.state.path) ? sectionKeys(readText(ctx.state.path), ALLOWED_FAILURES) : undefined;
  const report = runReport({
    code,
    timedOutAfterMinutes: ended.timedOut ? minutes : undefined,
    durationMs: ended.durationMs,
    logPath: ended.log,
    output: readFileSync(ended.log, "utf8"),
    allowed,
  });
  say(...report);
  return code;
}

// A chapter's name as --chapter gives it: it names a folder and a section, so it is one word of letters, digits,
// dots, dashes and underscores that starts and ends with a letter or a digit.
function chapterName(given) {
  const name = given?.trim() ?? "";
  if (!/^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(name)) {
    throw new Failure(
      "--chapter <X> is the chapter's name, one word of letters, digits, dots, dashes and underscores such as A, " +
        `B2 or acceptance${name ? `: "${oneLine(name)}"` : ""}`,
    );
  }
  return name;
}

// The folder of the report files of a chapter's review: under the temp folder's tdd-runs, next to the logs of the
// change's runs, and so outside every repository and of this machine alone. Its name is the chapter's in lower
// case: a chapter's section is found whatever the case of the name asked for, and so must its folder be, also
// where the disk tells `A` from `a`.
const reportsFolder = (ctx, chapter) => join(tmpdir(), "tdd-runs", ctx.runs, "reports", chapter.toLowerCase());

// Prints the chapter's reports folder, and creates it. With --new it is emptied first: the reviewer runs that
// once, before its first verifier, so that a review that runs again reads no report of an earlier one.
function reports(ctx, options) {
  const folder = reportsFolder(ctx, chapterName(options.chapter));
  try {
    if (options.new) rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    mkdirSync(folder, { recursive: true });
  } catch (e) {
    const done = options.new ? "emptied" : "created";
    throw new Failure(`the reports folder ${slashed(folder)} cannot be ${done}: ${e.message}`);
  }
  say(slashed(folder));
}

// What the report file of a finding's verifier in a folder holds, as review.mjs takes it: its verdict, that it is
// missing, or why it cannot be read as a report.
function reportIn(folder, id) {
  const path = join(folder, reportFile(id, 1));
  if (!existsSync(path)) return { missing: true };
  try {
    return { verdict: readReport(readText(path), 1) };
  } catch (e) {
    return { unreadable: oneLine(e.message) };
  }
}

// The names of the first checks' report files in a folder (`<id>-1.md`), each as the finding among `ids` that
// reads it names it: a disk that does not tell the case of letters apart reads `b-1-1.md` as B-1's `B-1-1.md`.
function filedReports(folder, ids) {
  if (!existsSync(folder)) return [];
  const asRead = new Map();
  for (const id of ids) {
    const path = join(folder, reportFile(id, 1));
    if (existsSync(path)) asRead.set(basename(realpathSync.native(path)), reportFile(id, 1));
  }
  return readdirSync(folder)
    .filter((name) => reportOf(name)?.check === 1)
    .map((name) => asRead.get(name) ?? name);
}

// Records a chapter review: the reviewer's record, read from standard input, becomes the reviews file's section
// "Chapter <X> review", once it has the form review.mjs reads and agrees with the reports in the chapter's reports
// folder: each finding with its report, and every report with a finding of the record. A refusal names the line
// and the finding, or the report file, so that the reviewer corrects the record and runs the command again;
// nothing is written then.
function review(ctx, options) {
  if (!options.stdin) throw new Failure("review needs --stdin: the record's text comes on standard input");
  const chapter = chapterName(options.chapter);
  const text = withoutByteOrderMark(readFileSync(0, "utf8"));
  const folder = reportsFolder(ctx, chapter);
  let record;
  try {
    record = readRecord(text, chapter);
    const filed = filedReports(folder, recordIds(record));
    checkRecord(record, (id) => reportIn(folder, id), slashed(folder), filed);
  } catch (e) {
    throw new Failure(`not recorded: ${e.message}`);
  }
  const section = { file: "reviews", section: reviewSection(chapter) };
  editSection(ctx, section, "set", (before, name, how) => setSection(before, name, text, how));
  say(`review: chapter ${chapter} | ${recordSummary(record)}`);
}

// The findings of a chapter's record as route.mjs takes them, with the groups of the merged ones and the ties
// between those whose fixes touch (review.mjs `recordFindings`): each with the verdict of its verifier's report
// in the chapter's reports folder, while that report agrees with the record. One that does not (it is missing
// though the record gives the finding a verdict, cannot be read, says another verdict or kind, or is there
// though the record says `no report`) is a check that returned no result, said in one line on stderr: the folder
// is of this machine and may be gone, and a file may have come or changed since the record was written.
function chapterFindings(options) {
  const ctx = context(options, "route --chapter");
  const chapter = chapterName(options.chapter);
  const section = reviewSection(chapter);
  if (!existsSync(ctx.reviews.path)) {
    throw new Failure(`no ${ctx.reviews.shown} yet: no chapter review is recorded`);
  }
  const body = sectionBody(readText(ctx.reviews.path), section);
  if (body === null) {
    throw new Failure(`no section "${section}" in ${ctx.reviews.shown}: the chapter's reviewer records it with review`);
  }
  let record;
  try {
    record = readRecord(body, chapter);
  } catch (e) {
    throw new Failure(`the section "${section}" of ${ctx.reviews.shown} is no record of a review: ${e.message}`);
  }
  const folder = reportsFolder(ctx, chapter);
  const sorted = recordFindings(record, (id) => reportIn(folder, id), slashed(folder));
  for (const line of sorted.said) process.stderr.write(`route: ${line}\n`);
  return sorted;
}

// The ids an option names, given at once with commas or one by one: each without the spaces around it.
const idsOf = (given) =>
  (given ?? [])
    .flatMap((value) => value.split(","))
    .map((id) => id.trim())
    .filter(Boolean);

// The groups `--merged` names among the findings of `--ids`: each `<id>+<id>[+<id>...]` as its ids in rising
// order, by number when they all are numbers, else as --ids has them. Refused in one line: a group of one, an id
// that --ids does not name, an id named twice or in two groups.
function mergedGroups(given, ids) {
  const groups = (given ?? []).map((value) => {
    const refuse = (what) => {
      throw new Failure(`--merged ${oneLine(value)}: ${what}`);
    };
    const members = value.split("+").map((id) => id.trim());
    if (members.length < 2 || members.includes("")) refuse("a group is two findings or more, as <id>+<id>");
    const unknown = members.find((id) => !ids.includes(id));
    if (unknown !== undefined) refuse(`finding ${oneLine(unknown)} is not among --ids`);
    const twice = members.find((id, i) => members.indexOf(id) !== i);
    if (twice !== undefined) refuse(`finding ${twice} is named twice`);
    const numbers = members.every((id) => /^\d+$/.test(id));
    return members.sort((a, b) => (numbers ? Number(a) - Number(b) : ids.indexOf(a) - ids.indexOf(b)));
  });
  const groupOf = new Map();
  groups.forEach((group, k) => {
    for (const id of group) {
      if (groupOf.has(id)) {
        throw new Failure(
          `--merged ${oneLine(given[groupOf.get(id)])} and --merged ${oneLine(given[k])}: finding ${id} is in two groups`,
        );
      }
      groupOf.set(id, k);
    }
  });
  return groups;
}

// Sorts a review's findings into FIX, DECLINE and ASK by route.mjs's rules, prints, and changes nothing. The
// findings come with their verdicts as JSON, from the command line, a file or standard input; with --reports from
// the report files a triage's checks wrote, --merged naming those with one cause; or with --change and --chapter
// from a chapter review's record and the report files of its verifiers.
function route(_ctx, options) {
  const sources = ["json", "in", "stdin", "reports", "chapter"].filter((name) => options[name] !== undefined);
  if (sources.length !== 1) {
    throw new Failure(
      "route needs one of --json <text>, --in <file>, --stdin, --reports <folder> with --ids, and --change " +
        "<change-name> with --chapter <X>",
    );
  }
  if (options.merged !== undefined && options.reports === undefined) {
    throw new Failure("--merged goes with --reports <folder> and --ids: it names findings there that have one cause");
  }
  if (options.missing !== undefined && options.reports === undefined) {
    throw new Failure(
      "--missing goes with --reports <folder> and --ids: it names findings there for which a check returned nothing",
    );
  }
  if (options.reports !== undefined) {
    const findings = reportedFindings(options.reports, options.ids, options.missing);
    const groups = mergedGroups(
      options.merged,
      findings.map((finding) => finding.id),
    );
    return say(...routeReport(routed(findings, groups)));
  }
  if (options.ids !== undefined) throw new Failure("--ids goes with --reports <folder>: it names the findings there");
  if (options.chapter !== undefined) {
    const { findings, groups, ties } = chapterFindings(options);
    const sorted = routed(findings, groups);
    return say(...routeReport(sorted, waiting(sorted, groups, ties)));
  }
  let text = options.json;
  if (options.stdin) text = readFileSync(0, "utf8");
  if (options.in !== undefined) {
    if (!statSync(options.in, { throwIfNoEntry: false })?.isFile()) {
      throw new Failure(`--in: no file ${oneLine(options.in)}`);
    }
    text = readText(options.in);
  }
  say(...routeReport(routed(readFindings(withoutByteOrderMark(text)))));
}

// The findings of `--ids`, in that order, each with the verdicts of its two checks as their reports in the folder
// say: `<id>-1.md` and `<id>-2.md`, the second with whether it disagrees with the first. A report that is not
// there is a check that returned no result. So is one that cannot be read as that check's report, which is also
// said in one line on stderr: the other findings are still sorted, and the exit code stays 0.
//
// `missing` names the findings for which the caller knows that a check returned nothing in this run (the triage's
// workflow says so): each is a finding without its checks' results whatever files the folder holds, since a
// folder kept from an earlier start of the round may still hold that start's reports.
function reportedFindings(folder, given, missing) {
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Failure(`--reports: no folder ${oneLine(folder)}`);
  }
  const ids = idsOf(given);
  if (ids.length === 0) throw new Failure("route --reports needs --ids <id>[,<id>...]: the findings to sort");
  const odd = ids.filter((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id));
  if (odd.length > 0) {
    const named = odd.map((id) => `"${oneLine(id)}"`).join(", ");
    throw new Failure(`not a finding's id: ${named}; an id is letters, digits, dots, dashes and underscores`);
  }
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice !== undefined) throw new Failure(`finding ${twice}: the id is given twice`);
  const without = idsOf(missing);
  const unknown = without.find((id) => !ids.includes(id));
  if (unknown !== undefined) throw new Failure(`--missing: finding ${oneLine(unknown)} is not among --ids`);
  const verdict = (id, check) => {
    if (without.includes(id)) return null;
    const name = reportFile(id, check);
    if (!existsSync(join(folder, name))) return null;
    try {
      return readReport(readText(join(folder, name)), check);
    } catch (e) {
      process.stderr.write(`route: ${name} cannot be read as a report: ${oneLine(e.message)}\n`);
      return null;
    }
  };
  return ids.map((id) => ({
    id,
    outside: false,
    reviewerDisagrees: false,
    verdicts: [verdict(id, 1), verdict(id, 2)],
  }));
}

// A path with every link in it followed: the real path of the longest part of it that exists, then the rest as
// given. So a file that is not there yet is placed where writing it would put it, whatever `..` or link (a
// symbolic link, a Windows junction) its path goes through.
function realPlace(path) {
  const rest = [];
  for (let part = resolve(path); ; part = dirname(part)) {
    try {
      return join(realpathSync.native(part), ...rest);
    } catch (e) {
      if (dirname(part) === part) throw new Failure(`--file: ${oneLine(e.message)}`);
      rest.unshift(basename(part));
    }
  }
}

// The repository a path lies in: the nearest folder above it that is a working tree's root (it holds `.git`, a
// folder in the main working tree and a file in a linked one) or a git folder itself (it holds HEAD, objects and
// refs); null when there is none. Found by looking and not by asking git, so that it holds for every repository
// on the way up, also one the command was not started in, and no program runs in a folder the caller names.
function repositoryAround(path) {
  const isGitFolder = (folder) => ["HEAD", "objects", "refs"].every((name) => existsSync(join(folder, name)));
  for (let folder = dirname(path); ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git")) || isGitFolder(folder)) return folder;
    if (dirname(folder) === folder) return null;
  }
}

// Saves the report of one check of a finding, read from standard input, as the file `--file` names. The checks
// are read-only agents, and this is the one way they have to write a file, so it writes only what `route
// --reports` can read as the report the file's name says (`<id>-1.md`: the first check's on that finding,
// `<id>-2.md`: the second's), and only outside every repository. The text is stored as given, with LF line breaks
// and one line break at its end. A refusal names the line that is wrong, so that the check can correct its report
// and run the command again.
function report(_ctx, options) {
  if (!options.stdin) throw new Failure("report needs --stdin: the report's text comes on standard input");
  if (!options.file?.trim()) throw new Failure("report needs --file <absolute path>: where the report is saved");
  const given = options.file.trim();
  if (!isAbsolute(given)) throw new Failure(`--file is an absolute path: "${oneLine(given)}"`);
  const file = resolve(given);
  const name = basename(file);
  const of = reportOf(name);
  if (of === null) {
    throw new Failure(
      `--file is named <id>-1.md for a first check's report and <id>-2.md for a second's: "${oneLine(name)}"`,
    );
  }
  const repository = repositoryAround(realPlace(file));
  if (repository !== null) {
    throw new Failure(
      "--file lies inside a repository: a report is saved outside every repository, in the triage's work folder " +
        `or, in an apply, in the chapter's reports folder (the repository: ${slashed(repository)})`,
    );
  }
  if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Failure(`--file is a file, and ${slashed(file)} is a folder`);
  }
  const text = `${withoutByteOrderMark(readFileSync(0, "utf8")).replace(/\r\n?/g, "\n").replace(/\s+$/, "")}\n`;
  let verdict;
  try {
    ({ verdict } = readReportOf(text, of));
  } catch (e) {
    throw new Failure(`not saved: ${name} cannot be read as a report: ${e.message}`);
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeAtomic(file, text);
  } catch (e) {
    throw new Failure(`not saved: ${slashed(file)} cannot be written: ${e.message}`);
  }
  say(`report: ${slashed(file)} | ${verdict}`);
}

// Prints the progress line of a step that ends without a commit; with one, `commit --done` prints it.
function progress(_ctx, options) {
  say(progressLine(options.step, new Date()));
}

const COMMANDS = {
  init,
  "triage-init": triageInit,
  get,
  set,
  add,
  put,
  drop,
  check,
  commit,
  unguard,
  shelve,
  unshelve,
  index,
  install,
  run,
  reports,
  review,
  route,
  report,
  progress,
};

// Runs one command line and answers the exit code.
export async function main(argv) {
  try {
    const { command, options, after } = parseArguments(argv);
    if (command === "help") {
      say(USAGE);
      return 0;
    }
    const ctx = WITHOUT_FILES.includes(command) ? null : context(options, command);
    return (await COMMANDS[command](ctx, options, after)) ?? 0;
  } catch (e) {
    process.stderr.write(`ERROR: ${e.whole ? joined(e.message) : oneLine(e.message)}\n`);
    if (process.env.TDD_DEBUG === "1") process.stderr.write(`${e.stack}\n`);
    return e instanceof Failure ? e.code : 1;
  }
}

// Whether this file is the script Node was started with, and not imported by a test or the hook.
function startedDirectly() {
  const same = (path) => {
    let real = path;
    try {
      real = realpathSync.native(path);
    } catch {
      // compared as given
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return Boolean(process.argv[1]) && same(resolve(process.argv[1])) === same(fileURLToPath(import.meta.url));
}

if (startedDirectly()) process.exitCode = await main(process.argv.slice(2));
