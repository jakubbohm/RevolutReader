// The /tdd-apply orchestrator's command line: one short call at each handoff in place of hand-written shell, each
// answering in a line or two (GitHub issue 67, cut context growth in /tdd-apply).
//
//   node .claude/skills/tdd-apply/scripts/tdd.mjs <command> --change <change-name> [--root <path>] [options]
//
// Run from anywhere inside the repository; USAGE below lists the commands. The pieces live next to this file:
// state.mjs (the state file's sections), guard.mjs (the paths the implementer must not change), test-output.mjs
// (what a test run printed). This file holds what touches the world: the arguments, git, the files, the code
// graph's command line, and the commands `run` wraps.
//
// - A refusal is one line on stderr (`ERROR: …`) and exit 1, never a stack trace (TDD_DEBUG=1 adds it). Exit 3:
//   the guard found violations. Exit 4: nothing to commit. `run` exits with its command's own code, 124 when it
//   stopped the command at its time limit, 127 when the command cannot be started.
// - TDD_GRAPH_CLI names another executable for the code graph's command line, and TDD_NO_GRAPH=1 skips indexing:
//   the tests use both.
// - Never prints or stores bank data or secrets: it handles paths, test names and totals, and of a test run it
//   prints what the runner printed, cut as test-output.mjs says.
import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { constants, tmpdir } from "node:os";
import { delimiter, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guard, guardReport, parseStatus, STEPS } from "./guard.mjs";
import {
  addBullet,
  keyValue,
  newReviewsText,
  newStateText,
  putKey,
  REVIEWS_FILE,
  sectionBody,
  sectionName,
  sectionNames,
  setSection,
  STATE_FILE,
} from "./state.mjs";
import { runReport } from "./test-output.mjs";

const USAGE = `node .claude/skills/tdd-apply/scripts/tdd.mjs <command> --change <change-name> [--root <path>] [options]

  init    --review <acceptance|all> --checkpoint <stop|continue> [--issue <n>]
  get     --section <name> [--section <name> ...] [--file state|reviews]
  set     --section <name> (--text <text> | --stdin) [--file state|reviews]
  add     --section <name> --line <text> [--file state|reviews]
  put     --section <name> --key <key> --value <value> [--file state|reviews]
  check   --step <green|wire|close>
  commit  --type <test|feat|fix|docs|refactor|build|chore> --tag <step> --summary <text>
          [--tick <id>[,<id>...]] [--path <path> ...] [--body <text>] [--resume <text>] [--check <green|wire|close>]
  index
  run     --label <name> [--timeout <minutes, default 30>] -- <command> [args...]

In --text, --line, --value, --body and --resume the two characters \\n mean a line break; --stdin takes the text as
it is. Exit codes: 0 done; 1 refused, with one line on stderr; 3 the guard found violations; 4 nothing to commit;
run: the command's own, 124 when stopped at its time limit, 127 when it cannot be started.`;

// What each command takes besides --change and --root: an option with a value, one that may repeat, or a flag.
const OPTIONS = {
  init: { review: "value", checkpoint: "value", issue: "value" },
  get: { section: "list", file: "value" },
  set: { section: "value", text: "value", stdin: "flag", file: "value" },
  add: { section: "value", line: "value", file: "value" },
  put: { section: "value", key: "value", value: "value", file: "value" },
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
  },
  index: {},
  run: { label: "value", timeout: "value" },
};

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
  const kinds = { change: "value", root: "value", ...OPTIONS[command] };
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

// The commit message: `<type>(<scope>): [<tag>] <summary>`, then the body after a blank line, then the trailers
// after another (docs/conventions/workflow.md § 3). The tag may come with its brackets.
export function commitMessage({ type, scope, tag, summary, body, trailers }) {
  if (!TYPES.includes(type)) throw new Failure(`--type is one of: ${TYPES.join(", ")}`);
  const step = (tag ?? "")
    .trim()
    .replace(/^\[(.*)\]$/, "$1")
    .trim();
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

// A run's log file: the local time to the second and the label, of which only letters, digits, dots, dashes and
// underscores are kept.
export function logFileName(label, date) {
  const two = (n) => String(n).padStart(2, "0");
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
// caller handles it (`mayFail`). `input` goes to git's standard input.
function git(root, args, { input, mayFail = false } = {}) {
  const r = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) throw new Failure(`git could not be started: ${r.error.message}`);
  if (r.status !== 0 && !mayFail) {
    const verb = args.find((a) => !a.startsWith("-"));
    throw new Failure(`git ${verb} failed: ${oneLine(r.stderr || r.stdout) || `exit ${r.status}`}`);
  }
  return r;
}

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

// What every command works with: the repository's root, the change, and its files.
function context(options) {
  const change = options.change;
  if (!change) throw new Failure("--change <change-name> is missing");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(change)) {
    throw new Failure(
      `--change is the name of the change's folder under openspec/changes, not a path: "${oneLine(change)}"`,
    );
  }
  const from = options.root === undefined ? process.cwd() : resolve(options.root);
  if (!statSync(from, { throwIfNoEntry: false })?.isDirectory()) throw new Failure(`--root: no folder ${from}`);
  const top = git(from, ["rev-parse", "--show-toplevel"], { mayFail: true });
  if (top.status !== 0) {
    throw new Failure(`${from} is not inside a git repository; run from inside one or give --root <path>`);
  }
  const root = resolve(top.stdout.trim());
  const folder = `openspec/changes/${change}`;
  if (!existsSync(join(root, folder))) throw new Failure(`no change folder ${folder} in ${root}`);
  const file = (name) => ({ path: join(root, folder, name), shown: `${folder}/${name}` });
  return { root, change, state: file(STATE_FILE), reviews: file(REVIEWS_FILE), tasks: file("tasks.md") };
}

// The current branch; `main`, `master` and a detached HEAD are refused: the apply works on the change's branch.
function changeBranch(root, command) {
  const r = git(root, ["symbolic-ref", "--short", "-q", "HEAD"], { mayFail: true });
  const branch = r.status === 0 ? r.stdout.trim() : null;
  if (branch === null) throw new Failure(`${command} works on the change's branch, and HEAD is detached`);
  if (branch === "main" || branch === "master") {
    throw new Failure(`${command} works on the change's branch, and this is ${branch}`);
  }
  return branch;
}

const oneOf = (value, allowed, option) => {
  if (!allowed.includes(value)) throw new Failure(`${option} is one of: ${allowed.join(", ")}`);
  return value;
};

function init(ctx, options) {
  const branch = changeBranch(ctx.root, "init");
  const modes = [
    ["review", "Review mode", ["acceptance", "all"]],
    ["checkpoint", "Checkpoint mode", ["stop", "continue"]],
  ];
  for (const [option, , allowed] of modes) {
    if (options[option] !== undefined) oneOf(options[option], allowed, `--${option}`);
  }
  const issue = options.issue === undefined ? null : /^#?(\d+)$/.exec(options.issue.trim())?.[1];
  if (issue === undefined) throw new Failure("--issue is the issue's number");

  if (existsSync(ctx.state.path)) {
    const before = readFileSync(ctx.state.path, "utf8");
    let text = before;
    const notes = modes.map(([option, key]) => {
      const was = keyValue(text, "Run", key);
      if (options[option] === undefined || options[option] === was) return `${option}: ${was ?? "not set"}`;
      text = putKey(text, "Run", key, options[option]);
      return `${option}: ${options[option]} (was ${was ?? "not set"})`;
    });
    if (text !== before) writeFileSync(ctx.state.path, text);
    return say(`exists: ${ctx.state.shown} | ${notes.join(" | ")}`);
  }

  if (options.review === undefined || options.checkpoint === undefined) {
    throw new Failure("init needs --review <acceptance|all> and --checkpoint <stop|continue> to create the state file");
  }
  const graph = indexGraph(ctx.root);
  const notIndexed = graph.skipped ? "skipped (TDD_NO_GRAPH=1)" : graph.failed;
  const now = new Date();
  const two = (n) => String(n).padStart(2, "0");
  const run = [
    ["Status", "applying"],
    ["Started", `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`],
    ["Review mode", options.review],
    ["Checkpoint mode", options.checkpoint],
    ["Branch", branch],
    ["Folder", ctx.root],
    ["Code graph project", graph.project ?? `not indexed: ${notIndexed}`],
    ...(issue === null ? [] : [["Issue", `#${issue}`]]),
  ];
  writeFileSync(ctx.state.path, newStateText(ctx.change, run, newFileEol(ctx.root, ctx.state.shown)));
  say(`created ${ctx.state.shown} | ${graphText(graph)}`);
}

// The file a section command works on: the state file, or with `--file reviews` the chapter reviews file.
function sectionFile(ctx, options) {
  const which = oneOf(options.file ?? "state", ["state", "reviews"], "--file");
  return { ...ctx[which], reviews: which === "reviews" };
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
      file.reviews ? `no ${file.shown} yet: no chapter review is written` : `no ${file.shown}: run init first`,
    );
  }
  const text = readFileSync(file.path, "utf8");
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

// Changes one section of the state file or the reviews file with `change` (the text in, the new text out), and
// says so in one line. The reviews file is created when it is not there, and a section it does not have yet too.
function editSection(ctx, options, verb, change) {
  const file = sectionFile(ctx, options);
  const name = neededSection(options);
  const newFile = !existsSync(file.path);
  if (newFile && !file.reviews) throw new Failure(`no ${file.shown}: run init first`);
  const before = newFile
    ? newReviewsText(ctx.change, newFileEol(ctx.root, file.shown))
    : readFileSync(file.path, "utf8");
  const newSection = sectionBody(before, name) === null;
  const after = change(before, name, { create: file.reviews });
  writeFileSync(file.path, after);
  const shown = sectionName(after, name);
  return {
    shown,
    lines: sectionBody(after, name).split("\n").length,
    notes: [...(newSection ? ["new section"] : []), ...(newFile ? ["new file"] : [])],
    verb,
  };
}

// The one line a section command prints: what it did to which section, how many lines the section now has (or,
// for `put`, the key), and whether the section or the file is new.
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

// The guard's verdict on the working tree: every path git reports as changed or new, each new file by its own
// path, read with -z so that no path is quoted.
function guarded(ctx, step) {
  if (!STEPS.includes(step)) throw new Failure(`the step is one of: ${STEPS.join(", ")}`);
  const changed = git(ctx.root, ["status", "--porcelain", "--untracked-files=all", "-z"]).stdout;
  return guard(parseStatus(changed), step, ctx.change);
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

function commit(ctx, options) {
  changeBranch(ctx.root, "commit");

  // Everything that can be refused is refused here, before anything is changed.
  const scope = changeScope(ctx.change);
  commitMessage({ ...options, scope });
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
  if (ids.length > 0 && !existsSync(ctx.tasks.path)) throw new Failure(`no ${ctx.tasks.shown} to tick in`);
  const tasks = ids.length > 0 ? tickTasks(readFileSync(ctx.tasks.path, "utf8"), ids) : { ticked: [], already: [] };
  let state = existsSync(ctx.state.path) ? readFileSync(ctx.state.path, "utf8") : null;
  const resumed = options.resume !== undefined;
  if (resumed && state === null) throw new Failure(`--resume: no ${ctx.state.shown}: run init first`);
  if (resumed) state = setSection(state, "Resume here", newlines(options.resume));
  const given = options.path?.map((path) => repositoryPath(ctx.root, path));

  if (tasks.ticked.length > 0) writeFileSync(ctx.tasks.path, tasks.text);
  if (resumed) writeFileSync(ctx.state.path, state);

  // With --path: exactly those paths and the files this command changed itself. Whatever else is changed, or
  // already staged, stays as it is: `commit --only` takes the named paths alone.
  const only = given && [
    ...new Set([
      ...given,
      ...(tasks.ticked.length > 0 ? [ctx.tasks.shown] : []),
      ...(resumed ? [ctx.state.shown] : []),
    ]),
  ];
  if (only) git(ctx.root, ["--literal-pathspecs", "add", "--", ...only]);
  else git(ctx.root, ["add", "-A"]);
  const paths = only ? ["--", ...only] : [];
  if (git(ctx.root, ["--literal-pathspecs", "diff", "--cached", "--quiet", ...paths], { mayFail: true }).status === 0) {
    process.stderr.write("nothing to commit\n");
    return 4;
  }

  // The message goes to git through standard input, never through a shell; --cleanup=whitespace keeps a body
  // line that starts with # whatever the machine's commit.cleanup says.
  const trailers = state === null ? null : keyValue(state, "Run", "Commit trailers");
  const body = options.body === undefined ? undefined : newlines(options.body);
  const message = commitMessage({ ...options, scope, body, trailers });
  git(
    ctx.root,
    [
      "--literal-pathspecs",
      "commit",
      "--quiet",
      "--cleanup=whitespace",
      "-F",
      "-",
      ...(only ? ["--only", ...paths] : []),
    ],
    {
      input: message,
    },
  );

  const sha = git(ctx.root, ["rev-parse", "--short=7", "HEAD"]).stdout.trim();
  const parts = [`${sha} ${message.split("\n")[0]}`];
  if (tasks.ticked.length > 0) parts.push(`ticked ${tasks.ticked.join(", ")}`);
  if (tasks.already.length > 0) parts.push(`already ticked ${tasks.already.join(", ")}`);
  parts.push(graphText(indexGraph(ctx.root)));
  say(parts.join(" | "));
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
// output and error output going, in the order written, to one log file. Prints test-output.mjs's short report and
// answers the command's exit code.
async function run(ctx, options, command) {
  if (!command?.length) throw new Failure("run needs a command after --: run --label <name> -- <command> [args...]");
  const minutes = options.timeout === undefined ? 30 : Number(options.timeout);
  if (!(minutes > 0) || !Number.isFinite(minutes)) throw new Failure("--timeout is a number of minutes above 0");
  const name = logFileName(options.label, new Date());
  const plan = spawnPlan(command[0], command.slice(1), { cwd: ctx.root });

  const folder = join(tmpdir(), "tdd-runs", ctx.change);
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
  const report = runReport({
    code,
    timedOutAfterMinutes: ended.timedOut ? minutes : undefined,
    durationMs: Date.now() - started,
    logPath: log.path,
    output: readFileSync(log.path, "utf8"),
  });
  say(...report);
  return code;
}

const COMMANDS = { init, get, set, add, put, check, commit, index, run };

// Runs one command line and answers the exit code.
export async function main(argv) {
  try {
    const { command, options, after } = parseArguments(argv);
    if (command === "help") {
      say(USAGE);
      return 0;
    }
    return (await COMMANDS[command](context(options), options, after)) ?? 0;
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
