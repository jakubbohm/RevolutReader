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
// findings, and how a check's report is read), triage.mjs (the pointer to the triage under way) and lock.mjs (the
// lock and the atomic writes). This file holds what touches the world: the arguments, git, the files, the code
// graph's command line, and the commands `run` wraps.
//
// - Whose files a command works on: with --change an apply's, in the change's folder under openspec/changes (or,
//   once the change is archived, its one folder under openspec/changes/archive): the state file .tdd-state.md,
//   the chapter reviews file and tasks.md. With --pr a triage's: the state file `triage-init` made, which is
//   .review-triage.md in the change's folder, or for a PR without a change triage-<id>.md in the working tree's
//   git folder: one file for every round and every session of that PR, never tracked. `triage-init` leaves a
//   pointer next to it (triage.mjs), and --pr is refused when there is none or it names another PR. Never both,
//   but for `triage-init` itself.
// - A triage's work folder is some session's scratchpad, which the next session does not share. The pointer holds
//   it, and `triage-init` ends its line with `work: <the folder in use>`: the pointer's while it names one for the
//   same PR and round that is still there, else the one given with --work. No tracked file holds a path of this
//   machine for a triage: its `Run` has neither the work folder nor the repository's.
// - A refusal is one line on stderr (`ERROR: …`) and exit 1, never a stack trace (TDD_DEBUG=1 adds it). Exit 3:
//   the guard found violations. Exit 4: nothing to commit. `run` exits with its command's own code, 124 when it
//   stopped the command at its time limit, 127 when the command cannot be started. One command writes to stderr
//   without refusing: `route --reports` names each report file it cannot read (`route: <file> cannot be read as a
//   report: …`), sorts that finding as one whose check returned no result, and still exits 0.
// - Every command that writes a state file, the reviews file, tasks.md or the pointer (init, triage-init, set, add,
//   put, drop, commit, unguard) holds the working tree's lock from its first read to its last write, `commit` and
//   `unguard` to the end of `git commit`, and every file is written whole or not at all (lock.mjs). `get`, `check`,
//   `run`, `index`, `route`, `report` and `progress` take no lock. TDD_LOCK_WAIT_MS and TDD_LOCK_STALE_MS set the
//   lock's wait limit and stale age in milliseconds: the tests use both.
// - `report` is how a review's check saves its report: the checks are read-only agents, and this command is the
//   one way they have to write a file. So it writes nothing but a text that reads as the report of the check and
//   the finding the file's name says (route.mjs), and never inside a repository: not this one, not another one,
//   not through `..` and not through a link.
// - `unguard` takes a finding's guard test out again. `git revert` cannot do that here: it would also reverse what
//   the test's `red` commits did to the state file, the reviews file and tasks.md, so git refuses it while the
//   state file has uncommitted changes, and it conflicts once a later commit changed that file. The command
//   reverses the commits in every other path and leaves those three alone.
// - TDD_GRAPH_CLI names another executable for the code graph's command line, and TDD_NO_GRAPH=1 skips indexing:
//   the tests use both. The code graph is never indexed inside the lock: it can take minutes.
// - Never prints or stores bank data or secrets: it handles paths, test names and totals, and of a test run it
//   prints what the runner printed, cut as test-output.mjs says.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { guard, guardReport, parseStatus, STEPS } from "./guard.mjs";
import { readText, withLock, writeAtomic } from "./lock.mjs";
import {
  readFindings,
  readReport,
  readReportOf,
  reportFile,
  reportOf,
  route as routed,
  routeReport,
} from "./route.mjs";
import {
  addBullet,
  ALLOWED_FAILURES,
  dropKey,
  keyValue,
  newReviewsText,
  newStateText,
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
import { runReport } from "./test-output.mjs";
import { archivedAs, POINTER_FILE, pointerText, prId, prStateFile, readPointer } from "./triage.mjs";

const USAGE = `node .claude/skills/tdd-apply/scripts/tdd.mjs <command> (--change <change-name> | --pr <id>) [--root <path>]
     [options]

  init         --agent-review <each-chapter|acceptance|none> --human-test-review <acceptance|each-group>
               --after-chapter <continue|stop> [--issue <n>]
  triage-init  --pr <id> --round <n> --work <absolute folder> [--change <change-name>] [--scope <scope>]
               [--source <pr|chat>]
  get          --section <name> [--section <name> ...] [--file state|reviews]
  set          --section <name> (--text <text> | --stdin) [--file state|reviews]
  add          --section <name> --line <text> [--file state|reviews]
  put          --section <name> --key <key> --value <value> [--file state|reviews]
  drop         --section <name> --key <key> [--file state|reviews]
  check        --step <green|wire|close>
  commit       --type <test|feat|fix|docs|refactor|build|chore> --tag <step> --summary <text>
               [--tick <id>[,<id>...]] [--path <path> ...] [--body <text>] [--resume <text>]
               [--check <green|wire|close>] [--done <step text>]
  unguard      --tag <step> --id <id> --red <commit>[,<commit>...] --outcome <declined|deferred> --body <text>
               [--resume <text>] [--done <step text>]
  index
  run          --label <name> [--timeout <minutes, default 30>] -- <command> [args...]
  route        (--json <text> | --in <file> | --stdin | --reports <folder> --ids <id>[,<id>...])
  report       --file <absolute path> --stdin
  progress     --step <step text>

--change names an apply's change: its state file, reviews file and tasks.md, in its folder under openspec/changes or,
once archived, under openspec/changes/archive. --pr names the triage that triage-init started in this working tree:
its state file (.review-triage.md in the change's folder; without a change, triage-<id>.md in the working tree's
git folder, never tracked), the scope of its commits, and no reviews file. init takes --change, triage-init --pr
and maybe --change, every other command one of the two; route, report and progress need neither.

init creates the apply's state file; on one that exists it changes only the switches given. triage-init starts a
round: it creates the triage's state file or, for a later round or a rerun, keeps it, updates its Run section and
adds the section "Round <n>" when missing; --scope is needed without --change. Its line ends with
"work: <folder>", the work folder to use from then on: the one an earlier start of the same PR and round took, while
it is still there, else the one --work gives. drop removes one keyed bullet.
commit --done and progress print "progress: <step text> completed at <HH:MM>". run adds a line on the failed tests
that the state file's "Allowed failures" section lists, and NOT ALLOWED with the others.

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
(route.mjs has the shapes and the rules).
report saves the report of one check, read from standard input, as the file --file names: <id>-1.md for a first
check's report and <id>-2.md for a second's, outside every repository. It is refused, in one line that names the
line that is wrong, when the text cannot be read as that report: its ID line names another finding, a label route
reads is missing or holds another word, a second check's report has no FIRST PASS line, or a first check's has
one. It prints "report: <file> | <verdict>".

In --text, --line, --value, --body and --resume the two characters \\n mean a line break; --stdin takes the text as
it is. Exit codes: 0 done; 1 refused, with one line on stderr; 3 the guard found violations; 4 nothing to commit;
run: the command's own, 124 when stopped at its time limit, 127 when it cannot be started.`;

// What each command takes besides --change, --pr and --root: an option with a value, one that may repeat, or a
// flag.
const OPTIONS = {
  init: { "agent-review": "value", "human-test-review": "value", "after-chapter": "value", issue: "value" },
  "triage-init": { round: "value", work: "value", scope: "value", source: "value" },
  get: { section: "list", file: "value" },
  set: { section: "value", text: "value", stdin: "flag", file: "value" },
  add: { section: "value", line: "value", file: "value" },
  put: { section: "value", key: "value", value: "value", file: "value" },
  drop: { section: "value", key: "value", file: "value" },
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
  index: {},
  run: { label: "value", timeout: "value" },
  route: { json: "value", in: "value", stdin: "flag", reports: "value", ids: "list" },
  report: { file: "value", stdin: "flag" },
  progress: { step: "value" },
};

// The commands that work on no file of a change or a triage, and so need neither --change nor --pr.
const WITHOUT_FILES = ["route", "report", "progress"];

// A refusal the caller is told in one line: the message for stderr and the exit code.
export class Failure extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

// A text on one line, for an error message: its lines joined, cut when long.
const oneLine = (text) => {
  const line = String(text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" | ");
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

// The change's folder, from the repository's root: under openspec/changes, or once the change is archived its one
// folder under openspec/changes/archive, whose name starts with the day.
function changeFolder(root, change) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(change)) {
    throw new Failure(
      `--change is the name of the change's folder under openspec/changes, not a path: "${oneLine(change)}"`,
    );
  }
  const folder = `openspec/changes/${change}`;
  if (existsSync(join(root, folder))) return folder;
  const archive = join(root, "openspec", "changes", "archive");
  const folders = existsSync(archive)
    ? readdirSync(archive, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    : [];
  const archived = archivedAs(
    folders.map((entry) => entry.name),
    change,
  );
  if (archived.length > 1) {
    throw new Failure(`${change} has more than one folder in openspec/changes/archive: ${archived.join(", ")}`);
  }
  if (archived.length === 0) throw new Failure(`no change folder ${folder} in ${root}, and none in its archive`);
  return `openspec/changes/archive/${archived[0]}`;
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

// What a command of an apply works with: the working tree, the change, and its files.
function applyContext({ root, gitFolder }, change) {
  const folder = changeFolder(root, change);
  const file = (name) => placed({ root, gitFolder }, join(root, folder, name));
  const [state, reviews] = [file(STATE_FILE), file(REVIEWS_FILE)];
  return {
    root,
    gitFolder,
    change,
    scope: changeScope(change),
    runs: change,
    started: "init",
    branch: "the change's branch",
    state,
    reviews,
    tasks: file("tasks.md"),
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
    triage: true,
    scope: pointer.scope,
    runs: `pr-${pr}`,
    started: "triage-init",
    branch: "the PR's branch",
    state,
    reviews: null,
    tasks: pointer.change === null ? null : placedHere(join(dirname(pointer.state), "tasks.md")),
    own: state.inside ? [state.shown] : [],
  };
}

// What a command works with. `triage-init` finds its files itself: it makes the pointer the others go by.
function context(options, command) {
  if (command === "triage-init") return workingTree(options);
  if (options.change !== undefined && options.pr !== undefined) {
    throw new Failure("--change and --pr are given together: --change is an apply's, --pr a triage's");
  }
  if (options.change === undefined && options.pr === undefined) {
    throw new Failure("--change <change-name> is missing (an apply's), or --pr <id> (a triage's)");
  }
  if (options.pr !== undefined && command === "init") throw new Failure("init is the apply's: it takes --change");
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
  if (found !== null) return say(found);

  if (SWITCHES.some(([option]) => options[option] === undefined)) {
    const needed = SWITCHES.map(([option, , allowed]) => `--${option} <${allowed.join("|")}>`);
    throw new Failure(`init needs ${needed.join(", ")} to create the state file`);
  }
  const graph = indexGraph(ctx.root);
  const now = new Date();
  const run = [
    ["Status", "applying"],
    ["Started", `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`],
    ...SWITCHES.map(([option, key]) => [key, options[option]]),
    ["Branch", branch],
    ["Folder", ctx.root],
    ["Code graph project", graphProject(graph)],
    ...(issue === null ? [] : [["Issue", `#${issue}`]]),
  ];
  // The index ran outside the lock, so another `init` may have created the file meanwhile: then it is kept.
  const created = locked(ctx, () => {
    const meanwhile = existing();
    if (meanwhile !== null) return meanwhile;
    writeAtomic(ctx.state.path, newStateText(ctx.change, run, newFileEol(ctx.root, ctx.state.shown)));
    return `created ${ctx.state.shown} | ${graphText(graph)}`;
  });
  say(created);
}

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
    // `Run` holds no path of this machine: the state file of a change is tracked. The pointer holds the work
    // folder, and a file that has such a key from before keeps it as it is.
    const run = [
      ["Status", "triaging"],
      ["PR", pr],
      ["Round", String(round)],
      ["Scope", scope],
      ...(source === undefined && before !== null && keyValue(before, "Run", "Source") !== null
        ? []
        : [["Source", source ?? "pr"]]),
      ["Branch", branch],
      ["Code graph project", graphProject(graph)],
    ];
    // A new file in the working tree gets the line endings git would check it out with; one in git's folder, LF.
    const eol = before === null && state.inside ? newFileEol(root, state.shown) : "\n";
    const after = triageText(before, change ?? `PR ${pr}`, run, round, eol);
    if (after !== before) writeAtomic(state.path, after);
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
  return { ...ctx[which], reviews, create: reviews || ctx.triage === true };
}

const neededSection = (options) => {
  if (!options.section?.trim()) throw new Failure("--section <name> is missing");
  return options.section;
};

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
  const missing = options.section.filter((name) => sectionBody(text, name) === null);
  if (missing.length > 0) {
    const names = sectionNames(text).join(", ") || "none yet";
    throw new Failure(
      `no section ${missing.map((m) => `"${oneLine(m)}"`).join(", ")} in ${file.shown}; the sections are: ${names}`,
    );
  }
  const bodies = options.section.map((name) => sectionBody(text, name));
  if (bodies.length === 1) return say(bodies[0]);
  say(options.section.map((name, i) => `## ${sectionName(text, name)}\n${bodies[i]}`).join("\n\n"));
}

// Changes one section of the state file or the reviews file with `change` (the text in, the new text out), under
// the lock from its read to its write, and answers what `edited` prints. The reviews file is created when it is
// not there, and a section it does not have yet too; a triage's state file also gets a section it does not have.
function editSection(ctx, options, verb, change) {
  const file = sectionFile(ctx, options);
  const name = neededSection(options);
  return locked(ctx, () => {
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

// The one line a section command prints: what it did to which section, how many lines the section now has (or,
// for `put` and `drop`, the key), and whether the section or the file is new.
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
  // hold what was recorded since. (A triage has no reviews file, and one without a change keeps its state file
  // in git's folder and has no tasks.md.)
  const kept = [ctx.state, ctx.reviews, ctx.tasks].filter((file) => file?.inside).map((file) => file.shown);
  const { paths, patch } = reversal(ctx, reds, kept);
  if (paths.length === 0) {
    throw new Failure("nothing was changed: the red commits undo each other, so reversing them changes no file");
  }
  const changed = parseStatus(
    git(ctx.root, ["--literal-pathspecs", "status", "--porcelain", "--untracked-files=all", "-z", "--", ...paths])
      .stdout,
  ).map((entry) => entry.path);
  if (changed.length > 0) {
    const named = `${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ` and ${changed.length - 5} more` : ""}`;
    throw new Failure(`nothing was changed: the reverse does not apply cleanly; uncommitted changes in ${named}`);
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

function index(ctx) {
  const graph = indexGraph(ctx.root);
  if (graph.failed) throw new Failure(graphText(graph));
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

// Runs a command in the repository's root, where CLAUDE.md § Commands says every command runs, with its standard
// output and error output going, in the order written, to one log file under the temp folder's tdd-runs (an
// apply's in a folder named after the change, a triage's in `pr-<id>`). Prints test-output.mjs's short report,
// which says which failed tests the state file allows to fail, and answers the command's exit code.
async function run(ctx, options, command) {
  if (!command?.length) throw new Failure("run needs a command after --: run --label <name> -- <command> [args...]");
  const minutes = options.timeout === undefined ? 30 : Number(options.timeout);
  if (!(minutes > 0) || !Number.isFinite(minutes)) throw new Failure("--timeout is a number of minutes above 0");
  const name = logFileName(options.label, new Date());
  const plan = spawnPlan(command[0], command.slice(1), { cwd: ctx.root });

  const folder = join(tmpdir(), "tdd-runs", ctx.runs);
  mkdirSync(folder, { recursive: true });
  const log = openLog(folder, name);
  const started = Date.now();
  const ended = await new Promise((done) => {
    const child = spawn(plan.file, plan.args, {
      ...plan.options,
      cwd: ctx.root,
      stdio: ["ignore", log.fd, log.fd],
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child.pid);
    }, minutes * 60_000);
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
    const why = ended.error.code === "ENOENT" ? "it is not on the PATH" : ended.error.message;
    throw new Failure(`cannot start ${oneLine(command[0])}: ${why}`, 127);
  }

  const code = ended.timedOut ? 124 : (ended.code ?? 128 + (constants.signals[ended.signal] ?? 0));
  // The tests allowed to fail are read after the run, as the state file then stands; without a state file there
  // is no list, and the report says nothing about it.
  const allowed = existsSync(ctx.state.path) ? sectionKeys(readText(ctx.state.path), ALLOWED_FAILURES) : undefined;
  const report = runReport({
    code,
    timedOutAfterMinutes: ended.timedOut ? minutes : undefined,
    durationMs: Date.now() - started,
    logPath: log.path,
    output: readFileSync(log.path, "utf8"),
    allowed,
  });
  say(...report);
  return code;
}

// Sorts a review's findings into FIX, DECLINE and ASK by route.mjs's rules, prints, and changes nothing. The
// findings come with their verdicts as JSON, from the command line, a file or standard input, or with --reports
// from the report files the triage's checks wrote.
function route(_ctx, options) {
  const sources = ["json", "in", "stdin", "reports"].filter((name) => options[name] !== undefined);
  if (sources.length !== 1) {
    throw new Failure("route needs one of --json <text>, --in <file>, --stdin and --reports <folder> with --ids");
  }
  if (options.reports !== undefined) return say(...routeReport(routed(reportedFindings(options.reports, options.ids))));
  if (options.ids !== undefined) throw new Failure("--ids goes with --reports <folder>: it names the findings there");
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
function reportedFindings(folder, given) {
  if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Failure(`--reports: no folder ${oneLine(folder)}`);
  }
  const ids = (given ?? [])
    .flatMap((value) => value.split(","))
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) throw new Failure("route --reports needs --ids <id>[,<id>...]: the findings to sort");
  const odd = ids.filter((id) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id));
  if (odd.length > 0) {
    const named = odd.map((id) => `"${oneLine(id)}"`).join(", ");
    throw new Failure(`not a finding's id: ${named}; an id is letters, digits, dots, dashes and underscores`);
  }
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice !== undefined) throw new Failure(`finding ${twice}: the id is given twice`);
  const verdict = (id, check) => {
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
        `(the repository: ${slashed(repository)})`,
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
  index,
  run,
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
    process.stderr.write(`ERROR: ${oneLine(e.message)}\n`);
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
