// Tests for tdd.mjs: its pure functions, and every command run as the main session, the runner and their agents
// run it, `node tdd.mjs …`, in a throwaway git repository in the OS temp folder (a made-up change with its tasks,
// some code and a test). Nothing here reaches the network, Docker or the real code graph: the graph's command
// line is switched off (TDD_NO_GRAPH=1) or replaced by a small fake (TDD_GRAPH_CLI), the npm that `install` starts
// is a small fake too (TDD_NPM_CLI), which installs made-up packages from a made-up lockfile, and the commands
// `run` wraps are Node one-liners and, for the Windows shim, npm running a script of a made-up package. Every
// name, text and path is made up.
//
// The apply's commands come first, then what both skills share (`drop`, the local file with `--local`, the
// progress line, `unguard`, `shelve` and `unshelve`, `route`, `report`, the tests allowed to fail) and a chapter
// review's own (`reports`, `review`, `route --chapter`), then a triage (`triage-init`, the commands with `--pr`),
// then the lock. The lock's waiting and its stale age are cut short with TDD_LOCK_WAIT_MS and TDD_LOCK_STALE_MS;
// the reports of a chapter review and the logs of `run` go under a temp folder the test names (TEMP, TMP, TMPDIR);
// and what `shelve` and `unshelve` do when a step fails after the first change is tested twice: with stand-ins for
// the steps and the readings of the state (`setAside`, `putBack`, `throwAway`), and through the commands, a step or
// a reading made to fail with TDD_FAIL_STEP, or for real, by a filter that cannot write a file or read one again.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  addBullet,
  EMPTY,
  keyValue,
  putKey,
  sectionBody,
  sectionKeys,
  sectionNames,
  setSection,
  STATE_SECTIONS,
  TRIAGE_SECTIONS,
} from "./state.mjs";
import {
  changeScope,
  commitMessage,
  isRedCommit,
  logFileName,
  mergedOrRefused,
  newlines,
  progressLine,
  putBack,
  setAside,
  throwAway,
  tickTasks,
  windowsCommandLine,
} from "./tdd.mjs";

const SCRIPT = fileURLToPath(new URL("./tdd.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const CHANGE = "c900-add-made-up-thing";
const BRANCH = "feat/c900-add-made-up-thing";
const FOLDER = `openspec/changes/${CHANGE}`;
const STATE = `${FOLDER}/.tdd-state.md`;
const REVIEWS = `${FOLDER}/.chapter-reviews.md`;
const TASKS = `${FOLDER}/tasks.md`;
const TRIAGE = `${FOLDER}/.review-triage.md`;
const ARCHIVED = `openspec/changes/archive/2026-11-23-${CHANGE}`;
const PR = "109";
const WINDOWS = process.platform === "win32";

const TASKS_TEXT = [
  "## 1. [acceptance] The made-up thing",
  "",
  "- [x] 1.1 Acceptance: made-up-thing / The thing is shown",
  "",
  "## 5. [unit] Mapping",
  "",
  "- [ ] 5.1 A balance maps to its amount",
  "- [ ] 5.2 A missing balance maps to nothing",
  "- [ ] 5.10 A tenth task, whose id starts like 5.1",
  "",
].join("\n");

// Starts a program and answers its exit code and what it printed. Not spawnSync: the tests of a group run side by
// side, each in its own repository, and a synchronous call would hold them all up.
function started(file, args, { cwd, env, input } = {}) {
  return new Promise((done, failed) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true });
    const printed = { out: [], err: [] };
    child.stdout.on("data", (chunk) => printed.out.push(chunk));
    child.stderr.on("data", (chunk) => printed.err.push(chunk));
    child.once("error", failed);
    child.once("close", (code) => {
      done({
        code,
        out: Buffer.concat(printed.out).toString("utf8"),
        err: Buffer.concat(printed.err).toString("utf8"),
      });
    });
    // A program that ends without reading its input may have closed the pipe before this end reaches it (seen
    // on Linux, under load): that is no failure of the program, whose exit code and output the test still judges.
    child.stdin.on("error", () => {});
    child.stdin.end(input ?? "");
  });
}

async function git(cwd, ...args) {
  const r = await started("git", args, { cwd });
  assert.equal(r.code, 0, `git ${args.join(" ")} failed: ${r.err}`);
  return r.out;
}

// A folder of its own in the OS temp folder, removed when the test ends.
function tempFolder(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tdd-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

function write(dir, path, text) {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
}

const read = (dir, path) => readFileSync(join(dir, path), "utf8");

// The made-up repository every test copies: the change's folder with its tasks, some code and a test, committed on
// `main`, with the change's branch checked out. Git keeps line endings as they are (core.autocrlf false), whatever
// the machine's own setting; a test about line endings sets what it needs.
let template;
before(async () => {
  template = realpathSync(mkdtempSync(join(tmpdir(), "tdd-template-")));
  await git(template, "init", "--quiet", "--initial-branch=main");
  for (const [key, value] of [
    ["user.name", "A Tester"],
    ["user.email", "tester@example.com"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
  ]) {
    await git(template, "config", key, value);
  }
  write(template, TASKS, TASKS_TEXT);
  write(template, `${FOLDER}/design.md`, "# Design\n");
  write(template, "src/App/Mapping.cs", "// production code\n");
  write(template, "tests/App.UnitTests/MappingTests.cs", "// a test\n");
  write(template, "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs", "// a driver\n");
  write(template, "tests/RevolutReader.IntegrationTests/Wiring/EdgeCases.cs", "// a wiring test\n");
  await git(template, "add", "-A");
  await git(template, "commit", "--quiet", "-m", "chore: the made-up repository");
  await git(template, "checkout", "--quiet", "-b", BRANCH);
});
after(() => rmSync(template, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

function repository(t) {
  const dir = tempFolder(t);
  cpSync(template, dir, { recursive: true });
  return dir;
}

// Runs the script as its callers do. The code graph is switched off unless a test's `env` says otherwise, and
// `install` finds no npm to start unless a test's `env` names the stand-in.
function tdd(cwd, args, { env = {}, input } = {}) {
  // npm, which one `run` test wraps, must not look for its own updates: no test reaches the network.
  const quiet = {
    TDD_NO_GRAPH: "1",
    TDD_GRAPH_CLI: "",
    TDD_NPM_CLI: "no-npm-is-started-by-a-test",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
  };
  return started(process.execPath, [SCRIPT, ...args], { cwd, input, env: { ...process.env, ...quiet, ...env } });
}

// A command line for the made-up change: the command, `--change`, then the arguments as they are. An object among
// them stands for its options: { type: "feat", path: ["a", "b"], stdin: true } for
// `--type feat --path a --path b --stdin`.
const withChange = (command, ...args) => [command, "--change", CHANGE, ...args.flatMap(optionsAsArguments)];
const optionsAsArguments = (given) =>
  typeof given === "string"
    ? [given]
    : Object.entries(given).flatMap(([name, value]) =>
        value === true ? [`--${name}`] : [value].flat().flatMap((one) => [`--${name}`, one]),
      );

// The apply's three switches as `init` takes them, each at its default.
const SWITCHES = { "agent-review": "each-chapter", "human-test-review": "acceptance", "after-chapter": "continue" };

// A repository whose change has the state file of a fresh `init`.
async function initialized(t) {
  const dir = repository(t);
  const r = await tdd(dir, withChange("init", SWITCHES));
  assert.equal(r.code, 0, r.err);
  return dir;
}

// A command line for the made-up triage: the command, `--pr`, then the arguments as `withChange` takes them.
const withPr = (command, ...args) => [command, "--pr", PR, ...args.flatMap(optionsAsArguments)];

// The made-up repository with its change archived, as `openspec archive` leaves it, committed.
async function archivedRepository(t) {
  const dir = repository(t);
  mkdirSync(join(dir, "openspec/changes/archive"), { recursive: true });
  renameSync(join(dir, FOLDER), join(dir, ARCHIVED));
  await git(dir, "add", "-A");
  await git(dir, "commit", "--quiet", "-m", "chore: the change archived");
  return dir;
}

// The working tree's own folder in git's folder, with the lock, the triage's pointer and, for a PR without a
// change, the triage's state file.
const gitFolder = (dir) => join(dir, ".git", "tdd");
const pointer = (dir) => JSON.parse(readFileSync(join(gitFolder(dir), "triage.json"), "utf8"));
const prState = (dir, pr = PR) => join(gitFolder(dir), `triage-${pr}.md`);
// The local file of a state file, with this machine's values: the made-up change's, or a PR's triage's.
const localFile = (dir, of = CHANGE) => join(gitFolder(dir), `${of}.local.md`);
const prLocalFile = (dir, pr = PR) => localFile(dir, `triage-${pr}`);
// What that folder holds besides the local files, which `init` and `triage-init` write: a lock or an index that a
// command left, the triage's pointer, the state file of a PR without a change. In the order of the names.
const leftInGitFolder = (dir) =>
  readdirSync(gitFolder(dir))
    .filter((name) => !name.endsWith(".local.md"))
    .sort();
// A folder's path as `triage-init` prints it: with forward slashes on every system.
const slashed = (path) => path.split(sep).join("/");
// The line `triage-init` prints: what it did to which state file, the round, the code graph (skipped in most
// tests) and the work folder in use.
const startLine = (what, round, work, graph = "skipped") =>
  `${what} | round ${round} | graph: ${graph} | work: ${slashed(work)}\n`;

// A repository in which round 1 of the made-up PR's triage has started, as `triage-init` leaves it, with the work
// folder outside it and the state file's path. `of` says whose triage: `change` (the made-up change's, its state
// file in the change's folder), `archived` (the same once the change is archived) or `none` (a PR without a
// change: its state file in git's folder).
async function triaging(t, of = "change") {
  const dir = of === "archived" ? await archivedRepository(t) : repository(t);
  const work = tempFolder(t);
  const whose = of === "none" ? { scope: "i900" } : { change: CHANGE };
  const r = await tdd(dir, withPr("triage-init", { round: "1", work, ...whose }));
  assert.equal(r.code, 0, r.err);
  const shown = { change: TRIAGE, archived: `${ARCHIVED}/.review-triage.md`, none: slashed(prState(dir)) }[of];
  return { dir, work, shown, state: of === "none" ? prState(dir) : join(dir, shown) };
}
// A lock as a command of the process `pid` that took it so long ago would have left it.
function leftLock(dir, pid, agoMs) {
  mkdirSync(gitFolder(dir), { recursive: true });
  const time = new Date(Date.now() - agoMs).toISOString();
  writeFileSync(join(gitFolder(dir), "state.lock"), JSON.stringify({ pid, time }));
}

// The local time as the progress line prints it.
const clock = (date = new Date()) =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// A stand-in for the code graph's command line, outside the repository: it records its arguments and answers as
// FAKE_GRAPH_MODE says (a project, a failure, or text that is not JSON). On Windows it is a .cmd file, which also
// proves the script can start one. With FAKE_GRAPH_LOCK naming the working tree's lock file, it also records
// whether the lock is there while it runs (`lockSeen`).
function fakeGraph(t) {
  const dir = tempFolder(t);
  const calls = join(dir, "calls.jsonl");
  write(
    dir,
    "fake-graph.mjs",
    [
      'import { appendFileSync, existsSync } from "node:fs";',
      'appendFileSync(process.env.FAKE_GRAPH_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");',
      "const lock = process.env.FAKE_GRAPH_LOCK;",
      'if (lock) appendFileSync(process.env.FAKE_GRAPH_CALLS + ".lock", JSON.stringify(existsSync(lock)) + "\\n");',
      'const mode = process.env.FAKE_GRAPH_MODE ?? "ok";',
      'if (mode === "fail") {',
      '  process.stderr.write("made-up failure: the index is locked\\n");',
      "  process.exit(3);",
      "}",
      'process.stdout.write(mode === "garbage" ? "not json" : JSON.stringify({ project: "made-up-project", nodes: 12 }));',
      "",
    ].join("\n"),
  );
  let cli;
  if (WINDOWS) {
    cli = join(dir, "fake-graph.cmd");
    writeFileSync(cli, `@"${process.execPath}" "%~dp0fake-graph.mjs" %*\r\n`);
  } else {
    cli = join(dir, "fake-graph");
    writeFileSync(cli, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-graph.mjs" "$@"\n`);
    chmodSync(cli, 0o755);
  }
  const env = (mode = "ok") => ({
    TDD_NO_GRAPH: "",
    TDD_GRAPH_CLI: cli,
    FAKE_GRAPH_CALLS: calls,
    FAKE_GRAPH_MODE: mode,
  });
  const recorded = (file) =>
    existsSync(join(dir, file))
      ? read(dir, file)
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  return { env, received: () => recorded("calls.jsonl"), lockSeen: () => recorded("calls.jsonl.lock") };
}

// A stand-in for npm, outside the repository: it records each call's arguments and the folder it was started in,
// prints a line, and then does what FAKE_NPM_MODE says. With FAKE_NPM_IN naming a folder, the mode holds in the
// folder of that name alone, and every other folder is installed (`ok`). On Windows it is a .cmd file, as npm is.
// - `ok`: what `npm ci` does: it clears node_modules, then installs what the folder's lockfile says, a folder with
//   a package.json for each locked package (none for one of the made-up system `made-up-os`), and writes its
//   record of them, node_modules/.package-lock.json;
// - `fail`: it clears node_modules, prints an error as npm words one, and exits 1;
// - `nothing`: it exits 0 and installs nothing;
// - `hang`: it never ends.
function fakeNpm(t) {
  const dir = tempFolder(t);
  const calls = join(dir, "calls.jsonl");
  write(
    dir,
    "fake-npm.mjs",
    [
      'import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
      'import { basename, join } from "node:path";',
      'appendFileSync(process.env.FAKE_NPM_CALLS, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n");',
      'console.log("made-up npm output: added 3 packages");',
      "const only = process.env.FAKE_NPM_IN;",
      'const mode = only && basename(process.cwd()) !== only ? "ok" : (process.env.FAKE_NPM_MODE ?? "ok");',
      'if (mode === "hang") {',
      "  setTimeout(() => {}, 120000);",
      '} else if (mode !== "nothing") {',
      '  rmSync("node_modules", { recursive: true, force: true });',
      '  mkdirSync("node_modules");',
      '  if (mode === "fail") {',
      '    console.error("npm error code EPERM");',
      '    console.error("npm error made-up: a file is held by another program");',
      "    process.exit(1);",
      "  }",
      '  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));',
      "  const packages = {};",
      "  for (const [path, entry] of Object.entries(lock.packages)) {",
      '    if (!path.includes("node_modules/") || entry.os?.includes("made-up-os")) continue;',
      "    packages[path] = entry;",
      "    mkdirSync(path, { recursive: true });",
      '    writeFileSync(join(path, "package.json"), JSON.stringify({ version: entry.version }));',
      "  }",
      '  writeFileSync("node_modules/.package-lock.json", JSON.stringify({ lockfileVersion: 3, requires: true, packages }));',
      "}",
      "",
    ].join("\n"),
  );
  let cli;
  if (WINDOWS) {
    cli = join(dir, "fake-npm.cmd");
    writeFileSync(cli, `@"${process.execPath}" "%~dp0fake-npm.mjs" %*\r\n`);
  } else {
    cli = join(dir, "fake-npm");
    writeFileSync(cli, `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake-npm.mjs" "$@"\n`);
    chmodSync(cli, 0o755);
  }
  const env = (mode = "ok", only = "") => ({
    TDD_NPM_CLI: cli,
    FAKE_NPM_CALLS: calls,
    FAKE_NPM_MODE: mode,
    FAKE_NPM_IN: only,
  });
  const received = () =>
    existsSync(calls)
      ? read(dir, "calls.jsonl")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  return { env, received };
}

const samePath = (a, b) => assert.equal(realpathSync(a).toLowerCase(), realpathSync(b).toLowerCase());
const oneLine = (text) => text.trim().split("\n").length === 1;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const lastCommit = async (dir) => ({
  message: (await git(dir, "log", "-1", "--format=%B")).replace(/\n+$/, ""),
  files: (await git(dir, "show", "--name-only", "--format=", "HEAD")).trim().split("\n").filter(Boolean).sort(),
  sha: (await git(dir, "rev-parse", "HEAD")).trim(),
});
const status = async (dir) =>
  (await git(dir, "status", "--porcelain", "--untracked-files=all")).split("\n").filter(Boolean);

describe("changeScope", () => {
  test("is the change's leading number", () => {
    assert.equal(changeScope("c018-add-approximate-payment-time"), "c018");
    assert.equal(changeScope("c7-x"), "c7");
  });

  test("is the whole name when the name starts with no number", () => {
    assert.equal(changeScope("add-made-up-thing"), "add-made-up-thing");
    assert.equal(changeScope("cut-context-growth"), "cut-context-growth");
  });
});

describe("newlines", () => {
  test("turns the two characters backslash and n into a line break, and keeps real line breaks", () => {
    assert.equal(newlines("one\\ntwo\\n\\nthree"), "one\ntwo\n\nthree");
    assert.equal(newlines("one\r\ntwo"), "one\ntwo");
    assert.equal(newlines("no break"), "no break");
  });
});

describe("tickTasks", () => {
  test("ticks the tasks named, and only them", () => {
    const { text, ticked, already } = tickTasks(TASKS_TEXT, ["5.1", "5.2"]);

    assert.deepEqual(ticked, ["5.1", "5.2"]);
    assert.deepEqual(already, []);
    assert.equal(
      text,
      TASKS_TEXT.replace("- [ ] 5.1 A balance", "- [x] 5.1 A balance").replace(
        "- [ ] 5.2 A missing",
        "- [x] 5.2 A missing",
      ),
    );
  });

  test("does not take a longer id that starts the same for the task", () => {
    const { text } = tickTasks(TASKS_TEXT, ["5.1"]);

    assert.ok(text.includes("- [ ] 5.10 A tenth task"));
    assert.ok(text.includes("- [x] 5.1 A balance"));
  });

  test("reports a task already ticked and leaves it", () => {
    const { text, ticked, already } = tickTasks(TASKS_TEXT, ["1.1", "5.2"]);

    assert.deepEqual(already, ["1.1"]);
    assert.deepEqual(ticked, ["5.2"]);
    assert.equal(text, TASKS_TEXT.replace("- [ ] 5.2 A missing", "- [x] 5.2 A missing"));
  });

  test("fails for an id the tasks do not have, naming every such id", () => {
    assert.throws(() => tickTasks(TASKS_TEXT, ["5.1", "9.9", "5.3"]), /9\.9, 5\.3/);
  });

  test("fails for something that is no task id", () => {
    assert.throws(() => tickTasks(TASKS_TEXT, ["5.x"]), /5\.x/);
    assert.throws(() => tickTasks(TASKS_TEXT, [""]));
  });

  test("keeps a CRLF file CRLF and changes nothing but the box", () => {
    const crlf = TASKS_TEXT.replace(/\n/g, "\r\n");

    const { text } = tickTasks(crlf, ["5.2"]);

    assert.equal(text, crlf.replace("- [ ] 5.2 A missing", "- [x] 5.2 A missing"));
  });

  test("ticks a task whose line ends after its id", () => {
    assert.equal(tickTasks("- [ ] 2.1\r\n- [ ] 2.2\n", ["2.1", "2.2"]).text, "- [x] 2.1\r\n- [x] 2.2\n");
  });

  test("names an id once when it is given twice", () => {
    assert.deepEqual(tickTasks(TASKS_TEXT, ["5.1", "5.1"]).ticked, ["5.1"]);
  });
});

describe("commitMessage", () => {
  const base = { type: "feat", scope: "c900", tag: "green", summary: "Balance mapping" };

  test("is the tagged subject alone when there is no body and no trailer", () => {
    assert.equal(commitMessage(base), "feat(c900): [green] Balance mapping\n");
  });

  test("puts the body after a blank line, then the trailers after another", () => {
    const message = commitMessage({
      ...base,
      body: "Why it changed.\nA second line.",
      trailers: "Co-Authored-By: Someone <someone@example.com>\nA-Session: https://example.com/s/1",
    });

    assert.equal(
      message,
      "feat(c900): [green] Balance mapping\n\nWhy it changed.\nA second line.\n\n" +
        "Co-Authored-By: Someone <someone@example.com>\nA-Session: https://example.com/s/1\n",
    );
  });

  test("puts the trailers after one blank line when there is no body", () => {
    assert.equal(
      commitMessage({ ...base, trailers: "A-Trailer: one" }),
      "feat(c900): [green] Balance mapping\n\nA-Trailer: one\n",
    );
  });

  test("takes the tag with or without its brackets", () => {
    assert.equal(commitMessage({ ...base, tag: "[wire]" }), "feat(c900): [wire] Balance mapping\n");
  });

  test("refuses a type the convention does not have, an empty tag and a summary of no or several lines", () => {
    assert.throws(() => commitMessage({ ...base, type: "feature" }), /test, feat, fix, docs, refactor, build, chore/);
    assert.throws(() => commitMessage({ ...base, tag: " " }));
    assert.throws(() => commitMessage({ ...base, tag: "a]b" }));
    assert.throws(() => commitMessage({ ...base, summary: "" }));
    assert.throws(() => commitMessage({ ...base, summary: "one\ntwo" }));
  });
});

describe("isRedCommit", () => {
  test("takes the red commit of a finding's guard test: the round's tag, the finding's id first, `, red` last", () => {
    assert.equal(isRedCommit("test(c900): [review] 3: A made-up guard, red", "review", "3"), true);
    assert.equal(isRedCommit("test(c900): [chapter-review] B-1: A made-up guard, red", "chapter-review", "B-1"), true);
    assert.equal(isRedCommit("test(i900): [review] 3, 7: One guard for both, red", "review", "3, 7"), true);
    assert.equal(isRedCommit("test(c900): [review] 3: A guard: with a colon, and a comma, red", "review", "3"), true);
  });

  test("takes the tag with or without its brackets, and the id with spaces around it", () => {
    assert.equal(isRedCommit("test(c900): [review] 3: A made-up guard, red", "[review]", " 3 "), true);
  });

  test("takes no commit of another finding, of another tag, or one that is not red", () => {
    const not = (subject, tag = "review", id = "3") => assert.equal(isRedCommit(subject, tag, id), false, subject);

    not("test(c900): [review] 13: A made-up guard, red");
    not("test(c900): [review] 3, 7: One guard for both, red");
    not("test(c900): [review] 3: One guard for both, red", "review", "3, 7");
    not("test(c900): [review] 4: A guard that names finding 3: there, red");
    not("test(c900): [chapter-review] 3: A made-up guard, red");
    not("test(c900): [red] 3: A made-up guard, red");
    not("fix(c900): [review] 3: A made-up fix");
    not("test(c900): [review] 3: guard, passes");
    not("test(c900): [review] 3: guard removed, declined");
    not("test(c900): [review] 3: A made-up guard, red, again");
    not("3: A made-up guard, red");
    not("chore: the made-up repository");
    not("");
    not(undefined);
  });
});

describe("logFileName", () => {
  test("is the local time to the second and the label", () => {
    assert.equal(logFileName("unit", new Date(2026, 10, 23, 9, 5, 7)), "20261123-090507-unit.log");
  });

  test("keeps a label's letters, digits, dots, dashes and underscores, and replaces the rest", () => {
    assert.equal(
      logFileName("web tests/1: a|b", new Date(2026, 0, 2, 13, 14, 15)),
      "20260102-131415-web-tests-1-a-b.log",
    );
    assert.equal(
      logFileName("c900_unit.red-2", new Date(2026, 0, 2, 13, 14, 15)),
      "20260102-131415-c900_unit.red-2.log",
    );
  });
});

describe("progressLine", () => {
  test("is the step and the local time on the 24-hour clock, to the minute", () => {
    assert.equal(progressLine("Baseline", new Date(2026, 10, 24, 16, 24, 59)), "progress: Baseline completed at 16:24");
    assert.equal(
      progressLine("Chapter B, slice 3", new Date(2026, 10, 24, 9, 5, 0)),
      "progress: Chapter B, slice 3 completed at 09:05",
    );
    assert.equal(
      progressLine("Finding B-2", new Date(2026, 10, 24, 0, 0, 0)),
      "progress: Finding B-2 completed at 00:00",
    );
    assert.equal(
      progressLine("Close checks", new Date(2026, 10, 24, 23, 59, 0)),
      "progress: Close checks completed at 23:59",
    );
  });

  test("drops the spaces around the step and keeps the step as it is", () => {
    assert.equal(
      progressLine("  Acceptance tests  ", new Date(2026, 10, 24, 12, 30)),
      "progress: Acceptance tests completed at 12:30",
    );
  });

  test("refuses no step, an empty one and one of several lines, naming the option", () => {
    const now = new Date(2026, 10, 24, 12, 30);

    assert.throws(() => progressLine(undefined, now), /^Error: --step is the step's name on one line/);
    assert.throws(() => progressLine(" ", now), /--step is the step's name on one line/);
    assert.throws(() => progressLine("one\ntwo", now), /--step/);
    assert.throws(() => progressLine("one\\ntwo", now), /--step/, "the two characters \\n are a line break");
    assert.throws(() => progressLine("", now, "--done"), /--done is the step's name on one line/);
  });
});

describe("windowsCommandLine", () => {
  // What cmd.exe is given to run a .cmd file: every character cmd reads specially carries carets, twice for an
  // argument, because cmd parses the batch file's own line again once the arguments are in it. That the arguments
  // then arrive unchanged is tested for real under `run`, below.
  test("quotes each argument for the program and escapes it twice for cmd", () => {
    assert.equal(
      windowsCommandLine("C:\\tools\\npm.cmd", ["test", "a b"]),
      'C:\\tools\\npm.cmd ^^^"test^^^" ^^^"a^^^ b^^^"',
    );
  });

  test("escapes the program's own path once", () => {
    assert.equal(windowsCommandLine("C:\\Program Files (x86)\\npm.cmd", []), "C:\\Program^ Files^ ^(x86^)\\npm.cmd");
  });

  test("escapes a quote inside an argument for the program first, with the backslashes before it doubled", () => {
    assert.equal(windowsCommandLine("x.cmd", ['a\\"b']), 'x.cmd ^^^"a\\\\\\^^^"b^^^"');
  });

  test("doubles an argument's last backslashes, which would otherwise escape its closing quote", () => {
    assert.equal(windowsCommandLine("x.cmd", ["dir\\"]), 'x.cmd ^^^"dir\\\\^^^"');
  });

  test("keeps an empty argument as an empty pair of quotes", () => {
    assert.equal(windowsCommandLine("x.cmd", [""]), 'x.cmd ^^^"^^^"');
  });
});

// The steps of `shelve` and `unshelve` that change something, with stand-ins for the steps and for the readings of
// the state after a failure: each test names the steps that fail and what the readings answer, and reads which
// steps ran and what the caller is told. Every branch of what is done and said is here; the commands' own tests
// below reach them with git (TDD_FAIL_STEP, and a filter that fails for real).
describe("setAside, putBack and throwAway: what is done and said when a step fails", () => {
  const LONG = `git checkout failed: ${"a path that cannot be written, ".repeat(20)}and so on`;
  // Stand-ins for the steps named, of which `failing` throw their cause (`causes` gives one per step, else "the
  // disk is full"); `ran` lists the steps run and the readings asked. `looks` gives what each reading answers, an
  // Error for one that cannot read. `paths` are the paths the reading of the tree covers.
  const PATHS = ["src/App/Mapping.cs", "src/App/Parked/Half.cs"];
  function steps(names, failing, { causes = {}, looks = {} } = {}) {
    const ran = [];
    const stand = (name) => () => {
      ran.push(name);
      if (failing.includes(name)) throw new Error(causes[name] ?? "the disk is full");
    };
    const look = (name) => () => {
      ran.push(name);
      if (looks[name] instanceof Error) throw looks[name];
      return looks[name];
    };
    const all = Object.fromEntries(names.map((name) => [name, stand(name)]));
    return { ran, steps: { ...all, keyHolds: look("keyHolds"), treeHolds: look("treeHolds"), paths: PATHS } };
  }
  const SHELVE = ["keep", "clear", "writeBack", "forget"];
  const UNSHELVE = ["write", "undo", "forget"];
  // What the caller is told: the message, and whether it is a line that is never cut.
  const said = (work) => {
    try {
      work();
      return null;
    } catch (e) {
      return { message: e.message, whole: e.whole };
    }
  };
  const told = (message) => ({ message, whole: true });
  const GONE = new Error("git cannot read the repository");
  const UNREAD = "reading the state again: git cannot read the repository";
  const OUT = "the way out, once the cause is gone:";
  const THREE = (key) =>
    `${OUT} shelve --key <another> (takes what is left), then unshelve --key ${key}, then unshelve --key <another> ` +
    "--drop";
  // A line that names no way out: neither the commands nor "nothing is left to undo".
  const noWayOut = (message) => {
    assert.doesNotMatch(message, /the way out|nothing is left to undo/, message);
  };

  describe("setAside", () => {
    test("keeps the work under the key, then clears the tree, and no more", () => {
      const { ran, steps: all } = steps(SHELVE, []);

      assert.equal(
        said(() => setAside("Q2", all)),
        null,
      );
      assert.deepEqual(ran, ["keep", "clear"]);
    });

    test("when the key cannot take the work and holds none, nothing was changed and the tree is not touched", () => {
      const { ran, steps: all } = steps(SHELVE, ["keep"], { looks: { keyHolds: false } });

      assert.deepEqual(
        said(() => setAside("Q2", all)),
        told("nothing was changed: the work could not be kept under the key Q2: the disk is full"),
      );
      assert.deepEqual(ran, ["keep", "keyHolds"]);
    });

    test("when the key cannot take the work and cannot be read again, the line says only what is known, names no way out, and the tree is not touched", () => {
      const { ran, steps: all } = steps(SHELVE, ["keep"], { looks: { keyHolds: GONE } });

      const answer = said(() => setAside("Q2", all));

      assert.deepEqual(
        answer,
        told(
          "failed part-way: the working tree holds the work as it was, not touched yet, and whether the key Q2 " +
            `holds a copy of it could not be read. The cause: the disk is full; ${UNREAD}`,
        ),
      );
      noWayOut(answer.message);
      assert.deepEqual(ran, ["keep", "keyHolds"]);
    });

    test("when the key took the work after all though its step failed, it holds a copy, and --drop removes it", () => {
      const { ran, steps: all } = steps(SHELVE, ["keep"], { looks: { keyHolds: true } });

      assert.deepEqual(
        said(() => setAside("Q2", all)),
        told(
          "failed part-way: the working tree holds the work as it was, and the key Q2 holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. The cause: the disk is full`,
        ),
      );
      assert.deepEqual(ran, ["keep", "keyHolds"]);
    });

    test("when the tree cannot be cleared, the work is written back and the key freed: nothing is left to undo", () => {
      const { ran, steps: all } = steps(SHELVE, ["clear"]);

      assert.deepEqual(
        said(() => setAside("Q2", all)),
        told(
          "failed part-way: nothing was set aside: the working tree holds the work again, and the key Q2 is free; " +
            "nothing is left to undo. The cause: the disk is full",
        ),
      );
      assert.deepEqual(ran, ["keep", "clear", "writeBack", "forget"]);
    });

    test("when the key cannot be freed after the work is written back, it is read again: a copy, or free after all", () => {
      const causes = { clear: "clear failed", forget: "forget failed" };
      const both = "The cause: clear failed; on the way back: forget failed";
      for (const [keyHolds, message] of [
        [
          true,
          "failed part-way: the working tree holds the work again, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${both}`,
        ],
        [
          false,
          "failed part-way: nothing was set aside: the working tree holds the work again, and the key Q2 is free; " +
            `nothing is left to undo. ${both}`,
        ],
      ]) {
        const { ran, steps: all } = steps(SHELVE, ["clear", "forget"], { causes, looks: { keyHolds } });

        assert.deepEqual(
          said(() => setAside("Q2", all)),
          told(message),
        );
        assert.deepEqual(ran, ["keep", "clear", "writeBack", "forget", "keyHolds"]);
      }
    });

    test("when the key cannot be freed after the work is written back and cannot be read again, the line says where the work is, that the key could not be read, and names no way out", () => {
      const causes = { clear: "clear failed", forget: "forget failed" };
      const { ran, steps: all } = steps(SHELVE, ["clear", "forget"], { causes, looks: { keyHolds: GONE } });

      const answer = said(() => setAside("Q2", all));

      assert.deepEqual(
        answer,
        told(
          "failed part-way: the working tree holds the work again, and whether the key Q2 still holds a copy of it " +
            `could not be read. The cause: clear failed; on the way back: forget failed; ${UNREAD}`,
        ),
      );
      noWayOut(answer.message);
      assert.deepEqual(ran, ["keep", "clear", "writeBack", "forget", "keyHolds"]);
    });

    test("when the work cannot be written back either, the tree is read again, the key is never freed, and the way out fits what the tree holds", () => {
      const causes = { clear: "clear failed", writeBack: "writeBack failed" };
      const both = "The cause: clear failed; on the way back: writeBack failed";
      for (const [treeHolds, message] of [
        [
          "work",
          "failed part-way: the working tree holds the work again, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${both}`,
        ],
        [
          "last",
          "failed part-way: the work is set aside under the key Q2, and the working tree is at the last commit; " +
            `${OUT} unshelve --key Q2. ${both}`,
        ],
        [
          "neither",
          "failed part-way: the work is safe under the key Q2, but the working tree is neither at the last commit " +
            `nor as the work has it; ${THREE("Q2")}. ${both}`,
        ],
        [
          { unread: ["src/App/Data.flt"] },
          "failed part-way: the work is safe under the key Q2, but the working tree could not be read in full: " +
            `src/App/Data.flt could not be read; ${THREE("Q2")}. ${both}`,
        ],
        [
          GONE,
          "failed part-way: the work is safe under the key Q2, but the working tree could not be read in full: " +
            `${PATHS.join(", ")} could not be read; ${THREE("Q2")}. ${both}; ${UNREAD}`,
        ],
      ]) {
        const { ran, steps: all } = steps(SHELVE, ["clear", "writeBack"], { causes, looks: { treeHolds } });

        assert.deepEqual(
          said(() => setAside("Q2", all)),
          told(message),
        );
        assert.deepEqual(ran, ["keep", "clear", "writeBack", "treeHolds"], "the key is all that holds the work");
      }
    });

    test("names every cause whole, however long, and the line is never cut", () => {
      const causes = { clear: LONG, writeBack: `${LONG}, the second` };
      const { steps: all } = steps(SHELVE, ["clear", "writeBack"], { causes, looks: { treeHolds: "neither" } });

      const { message, whole } = said(() => setAside("Q2", all));

      assert.ok(message.endsWith(`The cause: ${LONG}; on the way back: ${LONG}, the second`), message);
      assert.ok(message.length > 1000);
      assert.equal(whole, true);
    });
  });

  describe("putBack", () => {
    test("writes the work, then frees the key, and no more", () => {
      const { ran, steps: all } = steps(UNSHELVE, []);

      assert.equal(
        said(() => putBack("Q2", all)),
        null,
      );
      assert.deepEqual(ran, ["write", "forget"]);
    });

    test("when the work cannot be written, the paths are taken back and the key keeps the work: nothing was changed, once the tree reads as it was", () => {
      const { ran, steps: all } = steps(UNSHELVE, ["write"], { looks: { treeHolds: "last" } });

      assert.deepEqual(
        said(() => putBack("Q2", all)),
        told(
          "nothing was changed: the work shelved under Q2 could not be written and is still under the key. The " +
            "cause: the disk is full",
        ),
      );
      assert.deepEqual(ran, ["write", "undo", "treeHolds"], "forget must not run");
    });

    test("when the paths are taken back but the tree does not read as it was, or cannot be read, the line says what is true and the way out fits it", () => {
      const cause = "The cause: the disk is full";
      for (const [treeHolds, message] of [
        [
          "work",
          "failed part-way: the work is back in the working tree, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${cause}`,
        ],
        [
          "neither",
          "failed part-way: the work is still safe under the key Q2, but the working tree is neither as it was " +
            `before nor as the work has it; ${THREE("Q2")}. ${cause}`,
        ],
        [
          { unread: ["src/App/Data.flt"] },
          "failed part-way: the work is still safe under the key Q2, but the working tree could not be read in " +
            `full: src/App/Data.flt could not be read; ${THREE("Q2")}. ${cause}`,
        ],
        [
          GONE,
          "failed part-way: the work is still safe under the key Q2, but the working tree could not be read in " +
            `full: ${PATHS.join(", ")} could not be read; ${THREE("Q2")}. ${cause}; ${UNREAD}`,
        ],
      ]) {
        const { ran, steps: all } = steps(UNSHELVE, ["write"], { looks: { treeHolds } });

        assert.deepEqual(
          said(() => putBack("Q2", all)),
          told(message),
        );
        assert.deepEqual(
          ran,
          ["write", "undo", "treeHolds"],
          "forget must not run: the key is all that holds the work",
        );
      }
    });

    test("when the paths cannot be taken back either, the tree is read again, and what is said and the way out fit what it holds", () => {
      const causes = { write: "write failed", undo: "undo failed" };
      const both = "The cause: write failed; on the way back: undo failed";
      for (const [treeHolds, message] of [
        [
          "last",
          "nothing was changed: the work shelved under Q2 could not be written and is still under the key. " + both,
        ],
        [
          "work",
          "failed part-way: the work is back in the working tree, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${both}`,
        ],
        [
          "neither",
          "failed part-way: the work is still safe under the key Q2, but the working tree is neither as it was " +
            `before nor as the work has it; ${THREE("Q2")}. ${both}`,
        ],
        [
          { unread: ["src/App/Data.flt", "src/App/Other.flt"] },
          "failed part-way: the work is still safe under the key Q2, but the working tree could not be read in " +
            `full: src/App/Data.flt, src/App/Other.flt could not be read; ${THREE("Q2")}. ${both}`,
        ],
        [
          GONE,
          "failed part-way: the work is still safe under the key Q2, but the working tree could not be read in " +
            `full: ${PATHS.join(", ")} could not be read; ${THREE("Q2")}. ${both}; ${UNREAD}`,
        ],
      ]) {
        const { ran, steps: all } = steps(UNSHELVE, ["write", "undo"], { causes, looks: { treeHolds } });

        assert.deepEqual(
          said(() => putBack("Q2", all)),
          told(message),
        );
        assert.deepEqual(
          ran,
          ["write", "undo", "treeHolds"],
          "forget must not run: the key is all that holds the work",
        );
      }
    });

    test("when the work is written but the key cannot be freed, it is read again: a copy, or free after all", () => {
      for (const [keyHolds, message] of [
        [
          true,
          "failed part-way: the work is back in the working tree, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. The cause: the disk is full`,
        ],
        [
          false,
          "failed part-way: the work is back in the working tree, and the key Q2 is free; nothing is left to undo. " +
            "The cause: the disk is full",
        ],
      ]) {
        const { ran, steps: all } = steps(UNSHELVE, ["forget"], { looks: { keyHolds } });

        assert.deepEqual(
          said(() => putBack("Q2", all)),
          told(message),
        );
        assert.deepEqual(
          ran,
          ["write", "forget", "keyHolds"],
          "the paths are not taken back: the work is where it belongs",
        );
      }
    });

    test("when the work is written but the key cannot be freed and cannot be read again, the line says where the work is, that the key could not be read, and names no way out", () => {
      const { ran, steps: all } = steps(UNSHELVE, ["forget"], { looks: { keyHolds: GONE } });

      const answer = said(() => putBack("Q2", all));

      assert.deepEqual(
        answer,
        told(
          "failed part-way: the work is back in the working tree, and whether the key Q2 still holds a copy of it " +
            `could not be read. The cause: the disk is full; ${UNREAD}`,
        ),
      );
      noWayOut(answer.message);
      assert.deepEqual(ran, ["write", "forget", "keyHolds"], "the paths are not taken back");
    });
  });

  describe("throwAway", () => {
    test("frees the key, and no more", () => {
      const { ran, steps: all } = steps(["forget"], []);

      assert.equal(
        said(() => throwAway("Q2", all)),
        null,
      );
      assert.deepEqual(ran, ["forget"]);
    });

    test("when the key cannot be freed, it is read again: nothing was changed, or the work is thrown away after all", () => {
      for (const [keyHolds, message] of [
        [
          true,
          "nothing was changed: the work shelved under Q2 could not be thrown away and is still under the key. The " +
            "cause: the disk is full",
        ],
        [
          false,
          "failed part-way: the work shelved under Q2 is thrown away, as asked; nothing is left to undo. The cause: " +
            "the disk is full",
        ],
      ]) {
        const { ran, steps: all } = steps(["forget"], ["forget"], { looks: { keyHolds } });

        assert.deepEqual(
          said(() => throwAway("Q2", all)),
          told(message),
        );
        assert.deepEqual(ran, ["forget", "keyHolds"]);
      }
    });

    test("when the key cannot be freed and cannot be read again, the line says only what is known and names no way out", () => {
      const { ran, steps: all } = steps(["forget"], ["forget"], { looks: { keyHolds: GONE } });

      const answer = said(() => throwAway("Q2", all));

      assert.deepEqual(
        answer,
        told(
          "failed part-way: the working tree is unchanged, and whether the key Q2 still holds the shelved work " +
            `could not be read. The cause: the disk is full; ${UNREAD}`,
        ),
      );
      noWayOut(answer.message);
      assert.deepEqual(ran, ["forget", "keyHolds"]);
    });
  });
});

describe("mergedOrRefused: what git's merge of the shelved work with the last commit answered", () => {
  const TREE = "6edeeb05a1c381f1c5fb495cb509044629d61ad7";
  const refusal = (answer, onBranch = true) => {
    try {
      mergedOrRefused("Q2", answer, onBranch);
      return null;
    } catch (e) {
      return e.message;
    }
  };

  test("gives the merged tree when git merged without a conflict", () => {
    assert.equal(mergedOrRefused("Q2", { status: 0, printed: `${TREE}\0`, said: "" }, true), TREE);
    assert.equal(mergedOrRefused("Q2", { status: 0, printed: `${TREE}\n`, said: "" }, false), TREE);
  });

  test("names the files of a conflict, each once, as git lists them before its messages", () => {
    const printed =
      `${TREE}\0src/a b.cs\0src/c.cs\0\x001\0src/a b.cs\0Auto-merging\0Auto-merging src/a b.cs\n\x001\0src/a b.cs\0` +
      "CONFLICT (contents)\0CONFLICT (content): Merge conflict in src/a b.cs\n\0";

    assert.equal(
      refusal({ status: 1, printed, said: "" }),
      "the work shelved under Q2 does not go back cleanly: what was committed since changed the same lines in " +
        "src/a b.cs, src/c.cs",
    );
    assert.equal(
      refusal({ status: 1, printed: `${TREE}\0src/a.cs\0src/a.cs\0`, said: "" }),
      "the work shelved under Q2 does not go back cleanly: what was committed since changed the same lines in src/a.cs",
    );
  });

  test("says which git it needs when git cannot merge trees: 2.38, or 2.40 once the branch was rewritten", () => {
    const usage = { status: 129, printed: "", said: "usage: git merge-tree <base-tree> <branch1> <branch2>" };

    assert.equal(
      refusal(usage, true),
      "git merge-tree failed (unshelve needs git 2.38 or later): usage: git merge-tree <base-tree> <branch1> <branch2>",
    );
    assert.equal(
      refusal(usage, false),
      "git merge-tree failed (unshelve needs git 2.40 or later once the branch no longer holds the commit the work " +
        "was set aside on): usage: git merge-tree <base-tree> <branch1> <branch2>",
    );
    assert.equal(
      refusal({ status: 128, printed: "", said: "" }, true),
      "git merge-tree failed (unshelve needs git 2.38 or later): exit 128",
    );
  });
});

describe("how the script is called", { concurrency: true }, () => {
  test("fails with one line when the change's folder is missing", async (t) => {
    const dir = repository(t);

    const r = await tdd(dir, ["get", "--change", "c901-not-there", "--section", "Run"]);

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.match(r.err, /^ERROR: .*c901-not-there/);
    assert.ok(oneLine(r.err), r.err);
  });

  test("fails with one line for a missing --change, an unknown command and an unknown option", async (t) => {
    const dir = repository(t);

    for (const args of [
      ["get", "--section", "Run"],
      withChange("explode"),
      withChange("get", { sektion: "Run" }),
      [],
    ]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, 1, args.join(" "));
      assert.match(r.err, /^ERROR: /);
      assert.ok(oneLine(r.err), r.err);
      assert.doesNotMatch(r.err, /\bat .*tdd\.mjs/, "no stack trace");
    }
  });

  test("fails with one line for an option without its value, one given twice, and a stray argument", async (t) => {
    const dir = await initialized(t);

    for (const args of [
      withChange("get", "--section"),
      withChange("put", { section: "Run", key: ["A", "B"], value: "x" }),
      withChange("get", "--section", "Run", "stray"),
    ]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, 1, args.join(" "));
      assert.ok(oneLine(r.err), r.err);
    }
  });

  test("refuses a change name that is a path", async (t) => {
    const dir = repository(t);

    const r = await tdd(dir, ["get", "--change", "../changes/" + CHANGE, "--section", "Run"]);

    assert.equal(r.code, 1);
    assert.ok(oneLine(r.err), r.err);
  });

  test("refuses a change's name that differs from its folder's in the case of a letter, naming the folder, for every command", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("commit", { type: "docs", tag: "plan", summary: "The state file" }));
    write(dir, "src/App/Mapping.cs", "// production code\n// half a task\n");
    const typed = CHANGE.toUpperCase();
    const before = { status: await status(dir), state: read(dir, STATE), tasks: read(dir, TASKS) };
    const refusal = `ERROR: --change ${typed}: the change's folder is named ${CHANGE}; give the name letter for letter\n`;

    for (const args of [
      ["get", "--change", typed, "--section", "Run"],
      ["put", "--change", typed, "--section", "Open", "--key", "Q1", "--value", "x"],
      ["shelve", "--change", typed, "--key", "Q1"],
      ["commit", "--change", typed, "--type", "feat", "--tag", "green", "--summary", "Mapping", "--tick", "5.1"],
      ["init", "--change", typed],
      ["reports", "--change", typed, "--chapter", "B"],
      ["route", "--change", typed, "--chapter", "B"],
      ["triage-init", "--pr", PR, "--round", "1", "--work", tempFolder(t), "--change", typed],
    ]) {
      const r = await tdd(dir, args, { env: { TEMP: dir, TMP: dir, TMPDIR: dir } });

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.equal(r.err, refusal, args.join(" "));
    }
    assert.deepEqual({ status: await status(dir), state: read(dir, STATE), tasks: read(dir, TASKS) }, before);
    assert.equal(existsSync(join(dir, "tdd-runs")), false);
  });

  test("refuses an archived change's name in another case too, and one that only resembles a folder's is no change", async (t) => {
    const dir = await archivedRepository(t);

    const cased = await tdd(dir, ["get", "--change", CHANGE.toUpperCase(), "--section", "Run"]);
    const none = await tdd(dir, ["get", "--change", `${CHANGE}-two`, "--section", "Run"]);

    assert.equal(
      cased.err,
      `ERROR: --change ${CHANGE.toUpperCase()}: the change's folder is named ${CHANGE}; give the name letter for letter\n`,
    );
    assert.match(none.err, new RegExp(`^ERROR: no change folder openspec/changes/${CHANGE}-two in `));
  });

  test("refuses a change whose name starts with triage-, which is how a PR's triage is named in the git folder", async (t) => {
    const dir = repository(t);
    write(dir, "openspec/changes/triage-109/tasks.md", TASKS_TEXT);
    write(dir, "openspec/changes/Triage-local/tasks.md", TASKS_TEXT);

    for (const change of ["triage-109", "Triage-local", "triage-not-there"]) {
      const init = await tdd(dir, ["init", "--change", change, ...optionsAsArguments(SWITCHES)]);
      const triage = await tdd(dir, [
        "triage-init",
        "--pr",
        PR,
        "--round",
        "1",
        "--work",
        tempFolder(t),
        "--change",
        change,
      ]);

      for (const r of [init, triage]) {
        assert.equal(r.code, 1, change);
        assert.equal(
          r.err,
          `ERROR: --change ${change}: a change's name must not start with "triage-", which names a PR's triage ` +
            "among the files the bookkeeping keeps in the git folder\n",
        );
      }
    }
    assert.equal(existsSync(gitFolder(dir)), false, "nothing was written");
  });

  test("fails with one line outside a git repository", async (t) => {
    const dir = tempFolder(t);

    const r = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(r.code, 1);
    assert.match(r.err, /^ERROR: .*git repository/);
    assert.ok(oneLine(r.err), r.err);
  });

  test("works from a folder inside the repository", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(join(dir, "src", "App"), withChange("get", { section: "Resume here" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `${EMPTY}\n`);
  });

  test("takes the repository from --root, with either kind of slash, from outside it", async (t) => {
    const dir = await initialized(t);
    const elsewhere = tempFolder(t);

    for (const root of [dir, dir.replace(/\\/g, "/")]) {
      const r = await tdd(elsewhere, withChange("get", { root: root, section: "Resume here" }));

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, `${EMPTY}\n`);
    }
  });

  test("takes an option's value written as --name=value, and a value that starts with dashes", async (t) => {
    const dir = await initialized(t);

    assert.equal(
      (await tdd(dir, ["set", `--change=${CHANGE}`, "--section=Open", "--text", "--- a rule ---\\n- a bullet"])).code,
      0,
    );

    assert.equal(sectionBody(read(dir, STATE), "Open"), "--- a rule ---\n- a bullet");
  });

  test("prints its commands for --help", async (t) => {
    const r = await tdd(tempFolder(t), ["--help"]);

    assert.equal(r.code, 0);
    for (const command of ["init", "get", "set", "add", "put", "check", "commit", "index", "run"]) {
      assert.match(r.out, new RegExp(`^  ${command}\\b`, "m"));
    }
    for (const command of ["triage-init", "drop", "route", "progress", "unguard", "report"]) {
      assert.match(r.out, new RegExp(`^  ${command}\\b`, "m"));
    }
    for (const command of ["shelve", "unshelve", "reports", "review"]) {
      assert.match(r.out, new RegExp(`^  ${command}\\b`, "m"));
    }
    for (const option of ["--agent-review", "--human-test-review", "--after-chapter", "--pr <id>", "--done"]) {
      assert.ok(r.out.includes(option), option);
    }
    for (const line of [
      "  unguard      --tag <step> --id <id> --red <commit>[,<commit>...] --outcome <declined|deferred> --body <text>\n" +
        "               [--resume <text>] [--done <step text>]\n",
      "  report       --file <absolute path> --stdin\n",
      "  put          --section <name> --key <key> --value <value> [--file state|reviews] [--local]\n",
      "  shelve       --key <key>\n",
      "  unshelve     --key <key> [--drop]\n",
      "  reports      --chapter <X> [--new]\n",
      "  review       --chapter <X> --stdin\n",
      "  route        (--json <text> | --in <file> | --stdin | --reports <folder> --ids <id>[,<id>...]\n" +
        "               [--merged <id>+<id>[+<id>...] ...] [--missing <id>[,<id>...]] | --change <change-name> --chapter <X>)\n",
    ]) {
      assert.ok(r.out.includes(line), line);
    }
  });

  test("names every command when it is given none or one it does not know", async (t) => {
    const dir = repository(t);

    for (const args of [[], withChange("explode")]) {
      const r = await tdd(dir, args);

      assert.ok(
        r.err.includes(
          "the commands are: init, triage-init, get, set, add, put, drop, check, commit, unguard, shelve, unshelve, " +
            "index, install, run, reports, review, route, report, progress",
        ),
        r.err,
      );
    }
  });

  test("refuses --change and --pr together, and neither of them, in one line", async (t) => {
    const { dir } = await triaging(t);

    const both = await tdd(dir, [...withChange("get", { section: "Run" }), "--pr", PR]);
    const neither = await tdd(dir, ["get", "--section", "Run"]);

    assert.equal(both.code, 1);
    assert.equal(both.err, "ERROR: --change and --pr are given together: --change is an apply's, --pr a triage's\n");
    assert.equal(neither.code, 1);
    assert.equal(neither.err, "ERROR: --change <change-name> is missing (an apply's), or --pr <id> (a triage's)\n");
  });

  test("finds an archived change's folder for every command, by the change's name", async (t) => {
    const dir = await archivedRepository(t);
    const shown = `${ARCHIVED}/.tdd-state.md`;

    const init = await tdd(dir, withChange("init", SWITCHES));
    const put = await tdd(dir, withChange("put", { section: "Run", key: "Status", value: "done" }));
    const get = await tdd(dir, withChange("get", { section: "Run" }));
    const check = await tdd(dir, withChange("check", { step: "green" }));
    const commit = await tdd(dir, withChange("commit", { type: "docs", tag: "close", summary: "Done", tick: "5.1" }));

    assert.equal(init.out, `created ${shown} | graph: skipped\n`);
    assert.equal(put.code, 0, put.err);
    assert.match(get.out, /^- \*\*Status:\*\* done\n/);
    assert.equal(check.out, `ok: 1 changed paths\n  ?? ${shown}\n`);
    assert.equal(commit.code, 0, commit.err);
    assert.deepEqual((await lastCommit(dir)).files, [shown, `${ARCHIVED}/tasks.md`]);
    assert.equal(existsSync(join(dir, FOLDER)), false, "nothing is created under the change's old place");
  });

  test("prefers the change's own folder to an archived one of the same name", async (t) => {
    const dir = await archivedRepository(t);
    write(dir, TASKS, TASKS_TEXT);

    const r = await tdd(dir, withChange("init", SWITCHES));

    assert.equal(r.out, `created ${STATE} | graph: skipped\n`);
  });

  test("refuses a change with two folders in the archive, naming both", async (t) => {
    const dir = await archivedRepository(t);
    write(dir, `openspec/changes/archive/2026-12-01-${CHANGE}/tasks.md`, TASKS_TEXT);

    const r = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(r.code, 1);
    assert.match(r.err, new RegExp(`^ERROR: .*2026-11-23-${CHANGE}, 2026-12-01-${CHANGE}\\n$`));
    assert.ok(oneLine(r.err), r.err);
  });
});

describe("init", { concurrency: true }, () => {
  test("creates the state file with every section and the run's facts", async (t) => {
    const dir = repository(t);
    const day = today();

    const r = await tdd(
      dir,
      withChange("init", { "agent-review": "none", "human-test-review": "each-group", "after-chapter": "stop" }),
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `created ${STATE} | graph: skipped\n`);
    const text = read(dir, STATE);
    assert.equal(text.split(/\r?\n/)[0], `# .tdd-state: ${CHANGE}`);
    assert.deepEqual(sectionNames(text), STATE_SECTIONS);
    const keys = sectionBody(text, "Run")
      .split("\n")
      .map((l) => /^- \*\*(.+?):\*\*/.exec(l)?.[1]);
    assert.deepEqual(keys, ["Status", "Started", "Agent review", "Human test review", "After chapter", "Branch"]);
    assert.equal(keyValue(text, "Run", "Status"), "applying");
    assert.ok([day, today()].includes(keyValue(text, "Run", "Started")));
    assert.equal(keyValue(text, "Run", "Agent review"), "none");
    assert.equal(keyValue(text, "Run", "Human test review"), "each-group");
    assert.equal(keyValue(text, "Run", "After chapter"), "stop");
    assert.equal(keyValue(text, "Run", "Branch"), BRANCH);
    for (const name of STATE_SECTIONS.filter((n) => n !== "Run")) assert.equal(sectionBody(text, name), EMPTY);
  });

  test("holds no value of this machine in the state file: the code graph's project goes to the local file, the repository's folder nowhere", async (t) => {
    const dir = repository(t);

    const r = await tdd(dir, withChange("init", SWITCHES));

    assert.equal(r.code, 0, r.err);
    const text = read(dir, STATE);
    assert.equal(keyValue(text, "Run", "Folder"), null);
    assert.equal(keyValue(text, "Run", "Code graph project"), null);
    assert.equal(text.toLowerCase().includes(basename(dir).toLowerCase()), false, "no path of this machine");
    const local = readFileSync(localFile(dir), "utf8");
    assert.equal(
      local,
      `# This machine's values: ${CHANGE}\n\n## Run\n\n- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n`,
    );
    assert.deepEqual(await status(dir), [`?? ${STATE}`], "the local file is no file of the working tree");
  });

  test("indexes the repository and records the code graph's project in the local file", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(dir, withChange("init", SWITCHES), {
      env: graph.env(),
    });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `created ${STATE} | graph: made-up-project\n`);
    assert.equal(keyValue(readFileSync(localFile(dir), "utf8"), "Run", "Code graph project"), "made-up-project");
    const [call] = graph.received();
    assert.deepEqual(call.slice(0, 4), ["cli", "--quiet", "index_repository", "--repo-path"]);
    samePath(call[4], dir);
    assert.equal(call.length, 5);
  });

  test("still creates the file when the index fails, and records why", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(dir, withChange("init", SWITCHES), {
      env: graph.env("fail"),
    });

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^created ${STATE.replace(/\./g, "\\.")} \\| graph: failed: .*the index is locked`));
    assert.match(
      keyValue(readFileSync(localFile(dir), "utf8"), "Run", "Code graph project"),
      /^not indexed: .*the index is locked/,
    );
  });

  test("on a state file that exists, finds the code graph's project when the local file names none: a fresh clone", async (t) => {
    const dir = await initialized(t);
    rmSync(localFile(dir));
    const graph = fakeGraph(t);
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("init"), { env: graph.env() });
    const again = await tdd(dir, withChange("init"), { env: graph.env() });

    const exists = `exists: ${STATE} | agent-review: each-chapter | human-test-review: acceptance | after-chapter: continue`;
    assert.equal(r.out, `${exists} | graph: made-up-project\n`);
    assert.equal(again.out, `${exists}\n`, "the project is there now, so nothing is indexed");
    assert.equal(graph.received().length, 1);
    assert.equal(keyValue(readFileSync(localFile(dir), "utf8"), "Run", "Code graph project"), "made-up-project");
    assert.equal(read(dir, STATE), before, "the state file keeps every byte");
    assert.deepEqual(leftInGitFolder(dir), [], "no lock is left");
  });

  test("records the issue only when one is given, with or without its #", async (t) => {
    for (const issue of ["67", "#67"]) {
      const dir = repository(t);

      assert.equal((await tdd(dir, withChange("init", { ...SWITCHES, issue: issue }))).code, 0);

      const text = read(dir, STATE);
      assert.equal(keyValue(text, "Run", "Issue"), "#67");
      assert.equal(sectionBody(text, "Run").split("\n").at(-1), "- **Issue:** #67");
    }
  });

  test("takes every value of the three switches", async (t) => {
    for (const switches of [
      { "agent-review": "each-chapter", "human-test-review": "acceptance", "after-chapter": "continue" },
      { "agent-review": "acceptance", "human-test-review": "each-group", "after-chapter": "stop" },
      { "agent-review": "none", "human-test-review": "acceptance", "after-chapter": "continue" },
    ]) {
      const dir = repository(t);

      assert.equal((await tdd(dir, withChange("init", switches))).code, 0);

      const text = read(dir, STATE);
      assert.equal(keyValue(text, "Run", "Agent review"), switches["agent-review"]);
      assert.equal(keyValue(text, "Run", "Human test review"), switches["human-test-review"]);
      assert.equal(keyValue(text, "Run", "After chapter"), switches["after-chapter"]);
    }
  });

  test("refuses an issue that is no number, and a switch's value it does not know", async (t) => {
    const dir = repository(t);

    for (const options of [
      { ...SWITCHES, issue: "sixty-seven" },
      { ...SWITCHES, "agent-review": "everything" },
      { ...SWITCHES, "agent-review": "all" },
      { ...SWITCHES, "human-test-review": "all" },
      { ...SWITCHES, "human-test-review": "none" },
      { ...SWITCHES, "after-chapter": "sometimes" },
    ]) {
      const r = await tdd(dir, withChange("init", options));

      assert.equal(r.code, 1, JSON.stringify(options));
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("names a switch's values when it refuses one", async (t) => {
    const dir = repository(t);

    const r = await tdd(dir, withChange("init", { ...SWITCHES, "agent-review": "all" }));

    assert.equal(r.err, "ERROR: --agent-review is one of: each-chapter, acceptance, none\n");
  });

  test("no longer takes the options of before the switches were renamed", async (t) => {
    const dir = repository(t);

    for (const old of [{ review: "all" }, { checkpoint: "stop" }]) {
      const r = await tdd(dir, withChange("init", { ...SWITCHES, ...old }));

      assert.equal(r.code, 1, JSON.stringify(old));
      assert.match(r.err, /^ERROR: unknown option --(review|checkpoint); init takes: /);
    }
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("needs all three switches to create the file, and names them", async (t) => {
    const dir = repository(t);

    for (const missing of Object.keys(SWITCHES)) {
      const r = await tdd(dir, withChange("init", { ...SWITCHES, [missing]: [] }));

      assert.equal(r.code, 1, missing);
      assert.equal(
        r.err,
        "ERROR: init needs --agent-review <each-chapter|acceptance|none>, " +
          "--human-test-review <acceptance|each-group>, --after-chapter <continue|stop> to create the state file\n",
      );
    }
    assert.equal((await tdd(dir, withChange("init"))).code, 1);
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("changes nothing in a file that exists, and says that it exists", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." }));
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("init"));

    assert.equal(r.code, 0, r.err);
    assert.equal(
      r.out,
      `exists: ${STATE} | agent-review: each-chapter | human-test-review: acceptance | after-chapter: continue\n`,
    );
    assert.equal(read(dir, STATE), before);
  });

  test("changes only the switches given in a file that exists", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." }));
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("init", { "human-test-review": "each-group", issue: "99" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(
      r.out,
      `exists: ${STATE} | agent-review: each-chapter | human-test-review: each-group (was acceptance) | ` +
        "after-chapter: continue\n",
    );
    assert.equal(
      read(dir, STATE),
      before.replace("- **Human test review:** acceptance", "- **Human test review:** each-group"),
    );

    const again = await tdd(
      dir,
      withChange("init", { "agent-review": "none", "human-test-review": "each-group", "after-chapter": "stop" }),
    );

    assert.equal(
      again.out,
      `exists: ${STATE} | agent-review: none (was each-chapter) | human-test-review: each-group | ` +
        "after-chapter: stop (was continue)\n",
    );
    assert.equal(keyValue(read(dir, STATE), "Run", "Agent review"), "none");
    assert.equal(keyValue(read(dir, STATE), "Run", "After chapter"), "stop");
  });

  test("refuses on main, on master and on a detached HEAD, and creates nothing", async (t) => {
    for (const checkout of [["main"], ["-b", "master"], ["--detach"]]) {
      const dir = repository(t);
      await git(dir, "checkout", "--quiet", ...checkout);

      const r = await tdd(dir, withChange("init", SWITCHES));

      assert.equal(r.code, 1, checkout.join(" "));
      assert.ok(oneLine(r.err), r.err);
      assert.equal(existsSync(join(dir, STATE)), false);
    }
  });

  // The new file's line endings are those git would check the file out with, so git has nothing to convert or to
  // warn about: proven by committing the file, deleting it and checking it out again.
  for (const [name, autocrlf, attributes] of [
    ["with core.autocrlf true", "true", null],
    ["with core.autocrlf true under `* text=auto`", "true", "* text=auto\n"],
    ["with core.autocrlf false under `* text=auto` (the platform's own)", "false", "* text=auto\n"],
    ["with core.autocrlf input under `* text=auto`", "input", "* text=auto\n"],
    ["with `*.md text eol=lf` against core.autocrlf true", "true", "*.md text eol=lf\n"],
    ["with `*.md text eol=crlf` against core.autocrlf false", "false", "*.md text eol=crlf\n"],
    ["with `*.md -text` against core.autocrlf true", "true", "*.md -text\n"],
    ["with no setting at all", "false", null],
  ]) {
    test(`writes a new file as git would check it out ${name}`, async (t) => {
      const dir = repository(t);
      await git(dir, "config", "core.autocrlf", autocrlf);
      if (attributes) write(dir, ".gitattributes", attributes);

      assert.equal((await tdd(dir, withChange("init", SWITCHES))).code, 0);
      assert.equal(
        (await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }))).code,
        0,
      );

      const written = [readFileSync(join(dir, STATE)), readFileSync(join(dir, REVIEWS))];
      await git(dir, "add", "-A");
      await git(dir, "commit", "--quiet", "-m", "docs: the two files");
      rmSync(join(dir, STATE));
      rmSync(join(dir, REVIEWS));
      await git(dir, "checkout", "--", STATE, REVIEWS);
      assert.deepEqual(readFileSync(join(dir, STATE)), written[0]);
      assert.deepEqual(readFileSync(join(dir, REVIEWS)), written[1]);
    });
  }

  test("writes CRLF under `*.md text eol=crlf` and LF under `*.md text eol=lf`", async (t) => {
    for (const [attributes, expected] of [
      ["*.md text eol=crlf\n", "\r\n"],
      ["*.md text eol=lf\n", "\n"],
    ]) {
      const dir = repository(t);
      write(dir, ".gitattributes", attributes);

      await tdd(dir, withChange("init", SWITCHES));

      const text = read(dir, STATE);
      assert.equal(/\r\n/.test(text), expected === "\r\n");
      assert.equal(/(?<!\r)\n/.test(text), expected === "\n");
    }
  });
});

describe("get", { concurrency: true }, () => {
  test("prints one section's body, without its heading", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^- \*\*Status:\*\* applying\n- \*\*Started:\*\* /);
    assert.doesNotMatch(r.out, /^## /m);
  });

  test("prints several sections in the order asked, each under its heading", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." }));
    await tdd(dir, withChange("add", { section: "Open", line: "a dispute" }));

    const r = await tdd(dir, withChange("get", { section: ["Open", "resume here"] }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "## Open\n- a dispute\n\n## Resume here\nChapter B, group 7.\n");
  });

  test("prints LF line breaks for a CRLF file", async (t) => {
    const dir = await initialized(t);
    writeFileSync(join(dir, STATE), read(dir, STATE).replace(/\r?\n/g, "\r\n"));

    const r = await tdd(dir, withChange("get", { section: ["Run", "Open"] }));

    assert.equal(r.out.includes("\r"), false);
  });

  test("fails for a section the file does not have, naming those it has", async (t) => {
    const dir = await initialized(t);
    const sections = STATE_SECTIONS.join(", ");

    const one = await tdd(dir, withChange("get", { section: "Disputes" }));
    const two = await tdd(dir, withChange("get", { section: ["Disputes", "Answers"] }));

    assert.equal(one.code, 1);
    assert.equal(one.out, "");
    assert.equal(one.err, `ERROR: no section "Disputes" in ${STATE}; the sections are: ${sections}\n`);
    assert.equal(two.code, 1);
    assert.equal(two.out, "");
    assert.equal(two.err, `ERROR: no section "Disputes", "Answers" in ${STATE}; the sections are: ${sections}\n`);
  });

  test("of several sections, prints those the file has under their headings and names each other one on stderr", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("add", { section: "Open", line: "a dispute" }));
    const sections = STATE_SECTIONS.join(", ");

    const r = await tdd(dir, withChange("get", { section: ["Disputes", "Open", "Answers", "resume here"] }));
    const single = await tdd(dir, withChange("get", { section: ["Open", "Disputes"] }));

    assert.equal(r.code, 0, "the sections that are there are worth an answer");
    assert.equal(r.out, `## Open\n- a dispute\n\n## Resume here\n${EMPTY}\n`);
    assert.equal(
      r.err,
      `get: no section "Disputes" in ${STATE}; the sections are: ${sections}\n` +
        `get: no section "Answers" in ${STATE}; the sections are: ${sections}\n`,
    );
    assert.equal(single.out, "## Open\n- a dispute\n", "under its heading: more than one section was asked for");
    assert.equal(single.code, 0);
  });

  test("gives the sections of a chapter while its review runs: the record, which is written later, is named on stderr", async (t) => {
    const dir = await initialized(t);
    await tdd(
      dir,
      withChange("put", { file: "reviews", section: "Chapter B", key: "range", value: "1a2b3c4..5d6e7f8" }),
    );
    const both = withChange("get", { file: "reviews", section: ["Chapter B", "Chapter B review"] });

    const during = await tdd(dir, both);
    await tdd(dir, withChange("set", { file: "reviews", section: "Chapter B review", text: "REVIEW: chapter B, …" }));
    const after = await tdd(dir, both);
    const neither = await tdd(dir, withChange("get", { file: "reviews", section: ["Chapter C", "Chapter C review"] }));

    assert.equal(during.code, 0, during.err);
    assert.equal(during.out, "## Chapter B\n- **range:** 1a2b3c4..5d6e7f8\n");
    assert.equal(during.err, `get: no section "Chapter B review" in ${REVIEWS}; the sections are: Chapter B\n`);
    assert.equal(
      after.out,
      "## Chapter B\n- **range:** 1a2b3c4..5d6e7f8\n\n## Chapter B review\nREVIEW: chapter B, …\n",
    );
    assert.equal(after.err, "");
    assert.equal(neither.code, 1);
    assert.equal(
      neither.err,
      `ERROR: no section "Chapter C", "Chapter C review" in ${REVIEWS}; the sections are: Chapter B, Chapter B review\n`,
    );
  });

  test("fails when no section is asked for, and before `init`", async (t) => {
    const dir = repository(t);

    assert.match((await tdd(dir, withChange("get", { section: "Run" }))).err, /^ERROR: .*init/);
    assert.equal((await tdd(dir, withChange("get", { section: "Run" }))).code, 1);

    await tdd(dir, withChange("init", SWITCHES));
    const r = await tdd(dir, withChange("get"));

    assert.equal(r.code, 1);
    assert.match(r.err, /--section/);
  });

  test("reads the reviews file with --file reviews, and fails while there is none", async (t) => {
    const dir = await initialized(t);

    const none = await tdd(dir, withChange("get", { file: "reviews", section: "Chapter A" }));
    assert.equal(none.code, 1);
    assert.ok(oneLine(none.err), none.err);

    await tdd(dir, withChange("set", { file: "reviews", section: "Chapter A", text: "No findings." }));
    const r = await tdd(dir, withChange("get", { file: "reviews", section: "Chapter A" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "No findings.\n");
  });

  test("refuses a --file it does not know", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(dir, withChange("get", { file: "tasks", section: "Run" }));

    assert.equal(r.code, 1);
    assert.match(r.err, /state.*reviews/);
  });
});

describe("set", { concurrency: true }, () => {
  test("replaces a section's body, reading \\n in --text as a line break", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    const r = await tdd(
      dir,
      withChange("set", { section: "Resume here", text: "Chapter B, group 7.\\nThe last commit is [green]." }),
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "set: Resume here | 2 lines\n");
    const text = read(dir, STATE);
    assert.equal(sectionBody(text, "Resume here"), "Chapter B, group 7.\nThe last commit is [green].");
    const eol = /\r\n/.test(before) ? "\r\n" : "\n";
    assert.equal(
      text,
      before.replace(`${eol}${EMPTY}${eol}`, `${eol}Chapter B, group 7.${eol}The last commit is [green].${eol}`),
    );
  });

  test("keeps a CRLF file CRLF and an LF file LF", async (t) => {
    for (const eol of ["\r\n", "\n"]) {
      const dir = await initialized(t);
      writeFileSync(join(dir, STATE), read(dir, STATE).replace(/\r?\n/g, eol));

      await tdd(dir, withChange("set", { section: "Open", text: "one\\ntwo" }));
      await tdd(dir, withChange("add", { section: "Agents", line: "test-writer: a1" }));
      await tdd(dir, withChange("put", { section: "Run", key: "Status", value: "done\\nat noon" }));

      const text = read(dir, STATE);
      assert.equal(/\r\n/.test(text), eol === "\r\n", "CRLF kept");
      assert.equal(/(?<!\r)\n/.test(text), eol === "\n", "no bare LF in a CRLF file");
      assert.equal(sectionBody(text, "Open"), "one\ntwo");
      assert.equal(keyValue(text, "Run", "Status"), "done\nat noon");
    }
  });

  test("takes the body from standard input as it is with --stdin", async (t) => {
    const dir = await initialized(t);
    const body = "A path: bin\\net11.0\\x.dll\n\n- a bullet\n- another\n";

    const r = await tdd(dir, withChange("set", { section: "What the code holds now", stdin: true }), { input: body });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "set: What the code holds now | 4 lines\n");
    assert.equal(
      sectionBody(read(dir, STATE), "What the code holds now"),
      "A path: bin\\net11.0\\x.dll\n\n- a bullet\n- another",
    );
  });

  test("writes the placeholder for an empty text", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Open", text: "a dispute" }));

    const r = await tdd(dir, withChange("set", { section: "Open", text: "" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(sectionBody(read(dir, STATE), "Open"), EMPTY);
  });

  test("fails for a section the state file does not have, and leaves the file as it was", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("set", { section: "Disputes", text: "x" }));

    assert.equal(r.code, 1);
    assert.match(r.err, /Disputes.*Resume here, Run/);
    assert.ok(oneLine(r.err), r.err);
    assert.equal(read(dir, STATE), before);
  });

  test("needs exactly one of --text and --stdin", async (t) => {
    const dir = await initialized(t);

    assert.equal((await tdd(dir, withChange("set", { section: "Open" }))).code, 1);
    assert.equal(
      (await tdd(dir, withChange("set", { section: "Open", text: "x", stdin: true }), { input: "y" })).code,
      1,
    );
    assert.equal(sectionBody(read(dir, STATE), "Open"), EMPTY);
  });

  test("refuses a text that would start a new section", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(dir, withChange("set", { section: "Open", text: "before\\n## Sneaky\\nafter" }));

    assert.equal(r.code, 1);
    assert.ok(oneLine(r.err), r.err);
    assert.deepEqual(sectionNames(read(dir, STATE)), STATE_SECTIONS);
  });

  test("in the reviews file, creates the file and a missing section, each new section at the end", async (t) => {
    const dir = await initialized(t);

    const first = await tdd(dir, withChange("set", { file: "reviews", section: "Chapter A", text: "No findings." }));
    const second = await tdd(
      dir,
      withChange("set", { file: "reviews", section: "Chapter B", text: "One finding.\\nFixed." }),
    );
    const again = await tdd(dir, withChange("set", { file: "reviews", section: "chapter a", text: "Two findings." }));

    assert.equal(first.out, "set: Chapter A | 1 line | new section | new file\n");
    assert.equal(second.out, "set: Chapter B | 2 lines | new section\n");
    assert.equal(again.out, "set: Chapter A | 1 line\n");
    const text = read(dir, REVIEWS);
    assert.equal(text.split(/\r?\n/)[0], `# Chapter reviews: ${CHANGE}`);
    assert.deepEqual(sectionNames(text), ["Chapter A", "Chapter B"]);
    assert.equal(sectionBody(text, "Chapter A"), "Two findings.");
    assert.equal(sectionBody(text, "Chapter B"), "One finding.\nFixed.");
  });
});

describe("add", { concurrency: true }, () => {
  test("appends a bullet in place of the placeholder, then after the last line", async (t) => {
    const dir = await initialized(t);

    const first = await tdd(dir, withChange("add", { section: "Open", line: "a dispute about the error model" }));
    const second = await tdd(dir, withChange("add", { section: "Open", line: "a second one\\nwith a second line" }));

    assert.equal(first.code, 0, first.err);
    assert.equal(first.out, "added: Open | 1 line\n");
    assert.equal(second.out, "added: Open | 3 lines\n");
    assert.equal(
      sectionBody(read(dir, STATE), "Open"),
      "- a dispute about the error model\n- a second one\n  with a second line",
    );
  });

  test("fails for a section the state file does not have, and for an empty line", async (t) => {
    const dir = await initialized(t);

    assert.equal((await tdd(dir, withChange("add", { section: "Disputes", line: "x" }))).code, 1);
    assert.equal((await tdd(dir, withChange("add", { section: "Open", line: " " }))).code, 1);
    assert.equal((await tdd(dir, withChange("add", { section: "Open" }))).code, 1);
    assert.equal(sectionBody(read(dir, STATE), "Open"), EMPTY);
  });

  test("in the reviews file, creates a missing section", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "finding 1: fixed" }));
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "finding 2: declined" }));

    assert.equal(r.out, "added: Chapter A | 1 line | new section | new file\n");
    assert.equal(sectionBody(read(dir, REVIEWS), "Chapter A"), "- finding 1: fixed\n- finding 2: declined");
  });
});

describe("put", { concurrency: true }, () => {
  test("inserts a keyed bullet, and replaces it when the key is there", async (t) => {
    const dir = await initialized(t);

    const first = await tdd(
      dir,
      withChange("put", { section: "Agents", key: "Test-writer (A)", value: "a1b2, 41k tokens" }),
    );
    const second = await tdd(dir, withChange("put", { section: "Agents", key: "Implementer (A)", value: "c3d4" }));
    const third = await tdd(
      dir,
      withChange("put", { section: "Agents", key: "Test-writer (A)", value: "a1b2, 97k tokens" }),
    );

    assert.equal(first.code, 0, first.err);
    assert.equal(first.out, "put: Agents / Test-writer (A)\n");
    assert.equal(second.code, 0, second.err);
    assert.equal(third.code, 0, third.err);
    assert.equal(
      sectionBody(read(dir, STATE), "Agents"),
      "- **Test-writer (A):** a1b2, 97k tokens\n- **Implementer (A):** c3d4",
    );
  });

  test("replaces a key of the run, where it stands", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    await tdd(dir, withChange("put", { section: "Run", key: "Status", value: "done" }));

    assert.equal(read(dir, STATE), before.replace("- **Status:** applying", "- **Status:** done"));
  });

  test("keeps a value of several lines one list item: \\n becomes a line break and two spaces", async (t) => {
    const dir = await initialized(t);

    await tdd(
      dir,
      withChange("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one\\nB-Trailer: two" }),
    );

    const text = read(dir, STATE);
    assert.equal(
      sectionBody(text, "Run").split("\n").slice(-2).join("\n"),
      "- **Commit trailers:** A-Trailer: one\n  B-Trailer: two",
    );
    assert.equal(keyValue(text, "Run", "Commit trailers"), "A-Trailer: one\nB-Trailer: two");
  });

  test("fails without a key or a value, and for a section the state file does not have", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    assert.equal((await tdd(dir, withChange("put", { section: "Run", value: "x" }))).code, 1);
    assert.equal((await tdd(dir, withChange("put", { section: "Run", key: "Status" }))).code, 1);
    assert.equal((await tdd(dir, withChange("put", { section: "Disputes", key: "A", value: "x" }))).code, 1);
    assert.equal(read(dir, STATE), before);
  });

  test("in the reviews file, creates a missing section", async (t) => {
    const dir = await initialized(t);

    const r = await tdd(
      dir,
      withChange("put", { file: "reviews", section: "Chapter A", key: "Verdict", value: "clean" }),
    );

    assert.equal(r.out, "put: Chapter A / Verdict | new section | new file\n");
    assert.equal(sectionBody(read(dir, REVIEWS), "Chapter A"), "- **Verdict:** clean");
  });
});

describe("check", { concurrency: true }, () => {
  test("says ok for a clean tree", async (t) => {
    const dir = repository(t);

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "ok: 0 changed paths\n");
  });

  test("says ok for production code, naming every new file of a new folder by its own path", async (t) => {
    const dir = await initialized(t);
    write(dir, "src/App/Mapping.cs", "// changed\n");
    write(dir, "src/App/New/One.cs", "// new\n");
    write(dir, "src/App/New/Deep/Two.cs", "// new\n");

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.trimEnd().split("\n"), [
      "ok: 4 changed paths",
      "   M src/App/Mapping.cs",
      `  ?? ${STATE}`,
      "  ?? src/App/New/Deep/Two.cs",
      "  ?? src/App/New/One.cs",
    ]);
  });

  test("exits 3 and names the violations first when test code or an OpenSpec artifact changed", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Mapping.cs", "// changed\n");
    write(dir, "tests/App.UnitTests/MappingTests.cs", "// changed by the implementer\n");
    write(dir, "src/App/web/thing.test.ts", "// a new test\n");
    write(dir, TASKS, TASKS_TEXT.replace("- [ ] 5.1", "- [x] 5.1"));

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 3);
    assert.deepEqual(r.out.trimEnd().split("\n"), [
      "violations (3):",
      `   M ${TASKS}`,
      "   M tests/App.UnitTests/MappingTests.cs",
      "  ?? src/App/web/thing.test.ts",
      "other changed paths (1):",
      "   M src/App/Mapping.cs",
    ]);
  });

  test("allows the acceptance drivers in wire and close, and the Wiring folder in wire only", async (t) => {
    const dir = repository(t);
    write(dir, "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs", "// the real method\n");
    write(dir, "tests/RevolutReader.IntegrationTests/Wiring/EdgeCases.cs", "// an edge case\n");

    const green = await tdd(dir, withChange("check", { step: "green" }));
    const wire = await tdd(dir, withChange("check", { step: "wire" }));
    const close = await tdd(dir, withChange("check", { step: "close" }));

    assert.equal(green.code, 3);
    assert.match(green.out, /^violations \(2\):/);
    assert.equal(wire.code, 0);
    assert.match(wire.out, /^ok: 2 changed paths/);
    assert.equal(close.code, 3);
    assert.deepEqual(close.out.trimEnd().split("\n"), [
      "violations (1):",
      "   M tests/RevolutReader.IntegrationTests/Wiring/EdgeCases.cs",
      "other changed paths (1):",
      "   M tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs",
    ]);
  });

  test("counts a test file moved out of the tests as a violation, by its old path", async (t) => {
    const dir = repository(t);
    await git(dir, "mv", "tests/App.UnitTests/MappingTests.cs", "src/App/Moved.cs");

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 3);
    assert.deepEqual(r.out.trimEnd().split("\n"), [
      "violations (1):",
      "  R  tests/App.UnitTests/MappingTests.cs -> src/App/Moved.cs",
    ]);
  });

  test("names a path with spaces, quotes' neighbours and letters outside ASCII as it is", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Žluťoučký kůň.cs", "// new\n");
    write(dir, "tests/App.UnitTests/Úplně nový test.cs", "// new\n");

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 3);
    assert.deepEqual(r.out.trimEnd().split("\n"), [
      "violations (1):",
      "  ?? tests/App.UnitTests/Úplně nový test.cs",
      "other changed paths (1):",
      "  ?? src/App/Žluťoučký kůň.cs",
    ]);
  });

  test("lets the bookkeeping's own two files through", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));

    const r = await tdd(dir, withChange("check", { step: "green" }));

    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^ok: 2 changed paths/);
  });

  test("lists at most 60 paths", async (t) => {
    const dir = repository(t);
    for (let i = 1; i <= 64; i++) write(dir, `src/App/Many/File${String(i).padStart(2, "0")}.cs`, "// new\n");

    const r = await tdd(dir, withChange("check", { step: "green" }));

    const lines = r.out.trimEnd().split("\n");
    assert.equal(lines[0], "ok: 64 changed paths");
    assert.equal(lines.length, 62);
    assert.equal(lines.at(-1), "  … and 4 more");
  });

  test("fails with one line for a step it does not know, and without a step", async (t) => {
    const dir = repository(t);

    for (const args of [["--step", "red"], []]) {
      const r = await tdd(dir, withChange("check", ...args));

      assert.equal(r.code, 1);
      assert.match(r.err, /green, wire, close/);
      assert.ok(oneLine(r.err), r.err);
    }
  });
});

describe("commit", { concurrency: true }, () => {
  test("ticks the tasks, commits everything with the tagged message, and says what it did in one line", async (t) => {
    const dir = await initialized(t);
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "-m", "docs(c900): [plan] the state file");
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    write(dir, "src/App/New.cs", "// new\n");

    const r = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "Balance mapping", tick: "5.1,5.2" }),
    );

    assert.equal(r.code, 0, r.err);
    const { message, files, sha } = await lastCommit(dir);
    assert.equal(r.out, `${sha.slice(0, 7)} feat(c900): [green] Balance mapping | ticked 5.1, 5.2 | graph: skipped\n`);
    assert.equal(message, "feat(c900): [green] Balance mapping");
    assert.deepEqual(files, [TASKS, "src/App/Mapping.cs", "src/App/New.cs"].sort());
    assert.ok(read(dir, TASKS).includes("- [x] 5.1 A balance") && read(dir, TASKS).includes("- [x] 5.2 A missing"));
    assert.deepEqual(await status(dir), []);
  });

  test("writes the body after a blank line and the run's commit trailers after another", async (t) => {
    const dir = await initialized(t);
    await tdd(
      dir,
      withChange("put", {
        section: "Run",
        key: "Commit trailers",
        value: "Co-Authored-By: Someone <someone@example.com>\\nA-Session: https://example.com/s/1",
      }),
    );
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(
      dir,
      withChange("commit", {
        type: "fix",
        tag: "[green]",
        summary: "Balance mapping",
        body: 'Why it changed.\\n\\n#67 is the issue; `code`, "quotes" and $HOME stay.',
      }),
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(
      (await lastCommit(dir)).message,
      'fix(c900): [green] Balance mapping\n\nWhy it changed.\n\n#67 is the issue; `code`, "quotes" and $HOME stay.\n\n' +
        "Co-Authored-By: Someone <someone@example.com>\nA-Session: https://example.com/s/1",
    );
    assert.equal(
      (await git(dir, "log", "-1", "--format=%(trailers:key=A-Session,valueonly)")).trim(),
      "https://example.com/s/1",
    );
  });

  test("with --resume, rewrites `Resume here` and commits the state file with the rest", async (t) => {
    const dir = await initialized(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(
      dir,
      withChange("commit", {
        type: "docs",
        tag: "chapter",
        summary: "A's state",
        resume: "Chapter B, group 7.\\nA fresh pair.",
      }),
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(sectionBody(read(dir, STATE), "Resume here"), "Chapter B, group 7.\nA fresh pair.");
    assert.equal((await lastCommit(dir)).message, "docs(c900): [chapter] A's state");
    assert.deepEqual((await lastCommit(dir)).files, [STATE, "src/App/Mapping.cs"].sort());
    assert.deepEqual(await status(dir), []);
  });

  test("with --path, commits exactly those paths and its own files, and leaves the rest as it was", async (t) => {
    const dir = await initialized(t);
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "-m", "docs(c900): [plan] the state file");
    write(dir, "tests/App.UnitTests/MappingTests.cs", "// the test-writer's fix\n");
    write(dir, "tests/App.UnitTests/New/Deep/MoreTests.cs", "// the test-writer's new file\n");
    write(dir, "src/App/Mapping.cs", "// the implementer's work in progress\n");
    write(dir, "src/App/Staged.cs", "// staged by someone before\n");
    await git(dir, "add", "src/App/Staged.cs");

    const r = await tdd(
      dir,
      withChange("commit", {
        type: "test",
        tag: "red",
        summary: "Mapping, dispute fix",
        tick: "5.1",
        resume: "Group 5, green.",
        path: ["tests/App.UnitTests/MappingTests.cs", "tests\\App.UnitTests\\New"],
      }),
    );

    assert.equal(r.code, 0, r.err);
    assert.deepEqual(
      (await lastCommit(dir)).files,
      [STATE, TASKS, "tests/App.UnitTests/MappingTests.cs", "tests/App.UnitTests/New/Deep/MoreTests.cs"].sort(),
    );
    assert.deepEqual(await status(dir), [" M src/App/Mapping.cs", "A  src/App/Staged.cs"]);
  });

  test("with --path, takes an absolute path and a deleted file", async (t) => {
    const dir = repository(t);
    rmSync(join(dir, "tests/App.UnitTests/MappingTests.cs"));
    write(dir, "src/App/Mapping.cs", "// changed\n");
    write(dir, "src/App/Other.cs", "// not for this commit\n");

    const r = await tdd(
      dir,
      withChange("commit", {
        type: "test",
        tag: "red",
        summary: "Mapping",
        path: [join(dir, "src", "App", "Mapping.cs"), "tests/App.UnitTests/MappingTests.cs"],
      }),
    );

    assert.equal(r.code, 0, r.err);
    assert.deepEqual((await lastCommit(dir)).files, ["src/App/Mapping.cs", "tests/App.UnitTests/MappingTests.cs"]);
    assert.deepEqual(await status(dir), ["?? src/App/Other.cs"]);
  });

  test("with --path, fails before changing anything for a path that is not there or lies outside the repository", async (t) => {
    const dir = await initialized(t);
    const outside = tempFolder(t);
    write(outside, "x.cs", "// outside\n");
    write(dir, "src/App/Mapping.cs", "// changed\n");
    const head = (await lastCommit(dir)).sha;

    for (const path of ["src/App/NotThere.cs", join(outside, "x.cs")]) {
      const r = await tdd(
        dir,
        withChange("commit", { type: "test", tag: "red", summary: "Mapping", tick: "5.1", path: path }),
      );

      assert.equal(r.code, 1, path);
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal((await lastCommit(dir)).sha, head);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
  });

  test("refuses on main, on master and on a detached HEAD, and changes nothing", async (t) => {
    for (const checkout of [["main"], ["-b", "master"], ["--detach"]]) {
      const dir = repository(t);
      await git(dir, "checkout", "--quiet", ...checkout);
      write(dir, "src/App/Mapping.cs", "// changed\n");
      const head = (await lastCommit(dir)).sha;

      const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: "5.1" }));

      assert.equal(r.code, 1, checkout.join(" "));
      assert.ok(oneLine(r.err), r.err);
      assert.equal((await lastCommit(dir)).sha, head);
      assert.equal(read(dir, TASKS), TASKS_TEXT);
      assert.deepEqual(await status(dir), [" M src/App/Mapping.cs"]);
    }
  });

  test("exits 4 with `nothing to commit` when nothing is staged", async (t) => {
    const dir = repository(t);
    const head = (await lastCommit(dir)).sha;

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }));

    assert.equal(r.code, 4);
    assert.equal(r.out, "");
    assert.equal(r.err.trim(), "nothing to commit");
    assert.equal((await lastCommit(dir)).sha, head);
  });

  test("exits 4 when the paths given hold no change, whatever else changed", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Other.cs", "// not for this commit\n");

    const r = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "Mapping", path: "src/App/Mapping.cs" }),
    );

    assert.equal(r.code, 4);
    assert.deepEqual(await status(dir), ["?? src/App/Other.cs"]);
  });

  test("with --check, stops at a violation with exit 3 and changes nothing", async (t) => {
    const dir = await initialized(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    write(dir, "tests/App.UnitTests/MappingTests.cs", "// changed by the implementer\n");
    const head = (await lastCommit(dir)).sha;
    const state = read(dir, STATE);

    const r = await tdd(
      dir,
      withChange("commit", {
        type: "feat",
        tag: "green",
        summary: "Mapping",
        tick: "5.1",
        resume: "Next.",
        check: "green",
      }),
    );

    assert.equal(r.code, 3);
    assert.match(r.out, /^violations \(1\):\n {3}M tests\/App\.UnitTests\/MappingTests\.cs\n/);
    assert.equal((await lastCommit(dir)).sha, head);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
    assert.equal(read(dir, STATE), state);
    assert.deepEqual(await status(dir), [
      " M src/App/Mapping.cs",
      " M tests/App.UnitTests/MappingTests.cs",
      `?? ${STATE}`,
    ]);
  });

  test("with --check, commits when the guard finds nothing", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    write(dir, "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs", "// the real method\n");

    const green = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "Mapping", check: "green" }),
    );
    const wire = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "wire", summary: "Mapping", tick: "5.1", check: "wire" }),
    );

    assert.equal(green.code, 3);
    assert.equal(wire.code, 0, wire.err);
    assert.match(wire.out, /^[0-9a-f]{7,} feat\(c900\): \[wire\] Mapping \| ticked 5\.1 \| graph: skipped\n$/);
  });

  test("fails for a task id that is not there before anything is changed", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const head = (await lastCommit(dir)).sha;

    const r = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: ["5.1", "7.3"] }),
    );

    assert.equal(r.code, 1);
    assert.match(r.err, /7\.3/);
    assert.ok(oneLine(r.err), r.err);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
    assert.equal((await lastCommit(dir)).sha, head);
    assert.deepEqual(await status(dir), [" M src/App/Mapping.cs"]);
  });

  test("reports a task already ticked and skips it", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: "1.1,5.2" }));

    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /^[0-9a-f]{7,} feat\(c900\): \[green\] Mapping \| ticked 5\.2 \| already ticked 1\.1 \| graph: skipped\n$/,
    );
  });

  test("keeps a CRLF tasks file CRLF", async (t) => {
    const dir = repository(t);
    writeFileSync(join(dir, TASKS), TASKS_TEXT.replace(/\n/g, "\r\n"));
    await git(dir, "commit", "--quiet", "-am", "chore: CRLF tasks");

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: "5.2" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(read(dir, TASKS), TASKS_TEXT.replace("- [ ] 5.2", "- [x] 5.2").replace(/\n/g, "\r\n"));
  });

  test("uses the whole change name as the scope when it starts with no number", async (t) => {
    const dir = repository(t);
    renameSync(join(dir, FOLDER), join(dir, "openspec/changes/add-made-up-thing"));
    await git(dir, "add", "-A");

    const r = await tdd(dir, [
      "commit",
      "--change",
      "add-made-up-thing",
      "--type",
      "chore",
      "--tag",
      "apply",
      "--summary",
      "Renamed",
    ]);

    assert.equal(r.code, 0, r.err);
    assert.equal((await lastCommit(dir)).message, "chore(add-made-up-thing): [apply] Renamed");
  });

  test("fails with one line for a type it does not know and for a missing tag or summary, and changes nothing", async (t) => {
    const dir = repository(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const head = (await lastCommit(dir)).sha;

    for (const args of [
      ["--type", "feature", "--tag", "green", "--summary", "Mapping", "--tick", "5.1"],
      ["--type", "feat", "--summary", "Mapping", "--tick", "5.1"],
      ["--type", "feat", "--tag", "green", "--tick", "5.1"],
      ["--type", "feat", "--tag", "green", "--summary", "Mapping", "--tick", "5.1", "--resume", "Needs a state file."],
    ]) {
      const r = await tdd(dir, withChange("commit", ...args));

      assert.equal(r.code, 1, args.join(" "));
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal((await lastCommit(dir)).sha, head);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
  });

  test("indexes the repository after the commit and names the project", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }), {
      env: graph.env(),
    });

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^[0-9a-f]{7,} feat\(c900\): \[green\] Mapping \| graph: made-up-project\n$/);
    assert.equal(graph.received().length, 1);
  });

  test("does not fail because the index failed", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }), {
      env: graph.env("fail"),
    });

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^[0-9a-f]{7,} feat\(c900\): \[green\] Mapping \| graph: failed: .*the index is locked.*\n$/);
    assert.ok(oneLine(r.out), r.out);
    assert.equal((await lastCommit(dir)).message, "feat(c900): [green] Mapping");
  });

  test("fails with git's own words when git refuses the commit, here a hook", async (t) => {
    const dir = repository(t);
    write(dir, ".git/hooks/commit-msg", "#!/bin/sh\necho 'made-up hook: the message is refused' >&2\nexit 1\n");
    chmodSync(join(dir, ".git/hooks/commit-msg"), 0o755);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const head = (await lastCommit(dir)).sha;

    const r = await tdd(dir, withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }));

    assert.equal(r.code, 1);
    assert.match(r.err, /^ERROR: .*made-up hook: the message is refused/);
    assert.ok(oneLine(r.err), r.err);
    assert.equal((await lastCommit(dir)).sha, head);
  });
});

describe("index", { concurrency: true }, () => {
  test("indexes the repository's root and prints the project", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(join(dir, "src", "App"), withChange("index"), { env: graph.env() });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "graph: made-up-project\n");
    const [call] = graph.received();
    assert.deepEqual(call.slice(0, 4), ["cli", "--quiet", "index_repository", "--repo-path"]);
    samePath(call[4], dir);
  });

  test("skips the index with TDD_NO_GRAPH=1", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(dir, withChange("index"), { env: { ...graph.env(), TDD_NO_GRAPH: "1" } });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "graph: skipped\n");
    assert.deepEqual(graph.received(), []);
  });

  test("notes the project in the local file of a state file that is there: an apply's, and a triage's", async (t) => {
    const graph = fakeGraph(t);
    const project = (path) => keyValue(readFileSync(path, "utf8"), "Run", "Code graph project");
    const dir = await initialized(t);
    const before = read(dir, STATE);
    const { dir: triaged } = await triaging(t, "none");

    const r = await tdd(dir, withChange("index"), { env: graph.env() });
    const ofTriage = await tdd(triaged, withPr("index"), { env: graph.env() });

    assert.equal(r.out, "graph: made-up-project\n");
    assert.equal(project(localFile(dir)), "made-up-project");
    assert.equal(read(dir, STATE), before, "the state file keeps every byte");
    assert.equal(ofTriage.out, "graph: made-up-project\n");
    assert.equal(project(prLocalFile(triaged)), "made-up-project");
    assert.deepEqual(leftInGitFolder(dir), [], "no lock is left");
  });

  test("on a machine whose local file is not there, a fresh clone, creates it with the project: for an apply and for a triage", async (t) => {
    const graph = fakeGraph(t);
    const dir = await initialized(t);
    const { dir: triaged, state } = await triaging(t, "change");
    rmSync(localFile(dir));
    rmSync(prLocalFile(triaged));
    const before = [read(dir, STATE), readFileSync(state, "utf8")];

    const r = await tdd(dir, withChange("index"), { env: graph.env() });
    const ofTriage = await tdd(triaged, withPr("index"), { env: graph.env() });
    const run = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(r.out, "graph: made-up-project\n");
    assert.equal(ofTriage.out, "graph: made-up-project\n");
    assert.equal(
      readFileSync(localFile(dir), "utf8"),
      `# This machine's values: ${CHANGE}\n\n## Run\n\n- **Code graph project:** made-up-project\n`,
    );
    assert.equal(
      readFileSync(prLocalFile(triaged), "utf8"),
      `# This machine's values: triage-${PR}\n\n## Run\n\n- **Code graph project:** made-up-project\n`,
    );
    assert.ok(run.out.endsWith("- **Code graph project:** made-up-project\n"), run.out);
    assert.deepEqual([read(dir, STATE), readFileSync(state, "utf8")], before, "no state file is touched");
  });

  test("writes no local file while there is no state file, and leaves the local value when the index fails or is skipped", async (t) => {
    const graph = fakeGraph(t);
    const bare = repository(t);
    const dir = await initialized(t);
    await tdd(dir, withChange("index"), { env: graph.env() });

    const none = await tdd(bare, withChange("index"), { env: graph.env() });
    const failed = await tdd(dir, withChange("index"), { env: graph.env("fail") });
    const skipped = await tdd(dir, withChange("index"), { env: { ...graph.env(), TDD_NO_GRAPH: "1" } });

    assert.equal(none.out, "graph: made-up-project\n");
    assert.equal(existsSync(gitFolder(bare)), false, "nothing is written for a change without a state file");
    assert.equal(failed.code, 1);
    assert.equal(skipped.out, "graph: skipped\n");
    assert.equal(keyValue(readFileSync(localFile(dir), "utf8"), "Run", "Code graph project"), "made-up-project");
  });

  test("fails with one line when the command line fails, answers no JSON, or is not there", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    for (const env of [
      graph.env("fail"),
      graph.env("garbage"),
      { TDD_NO_GRAPH: "", TDD_GRAPH_CLI: "no-such-graph-command-line" },
    ]) {
      const r = await tdd(dir, withChange("index"), { env });

      assert.equal(r.code, 1);
      assert.equal(r.out, "");
      assert.match(r.err, /^ERROR: graph: failed: /);
      assert.ok(oneLine(r.err), r.err);
    }
  });
});

describe("install", { concurrency: true }, () => {
  // Where a test's logs go: `install` writes npm's output under the OS temp folder, which these variables name.
  const tempEnv = (dir) => ({ TEMP: dir, TMP: dir, TMPDIR: dir });
  // A package as a lockfile holds it.
  const from = (version, more = {}) => ({
    version,
    resolved: `https://registry.example.com/made-up/-/made-up-${version}.tgz`,
    integrity: `sha512-made-up-${version}`,
    ...more,
  });
  // What the made-up npm projects lock: a package, a scoped one that only tests need, and an optional one of a
  // system no machine has, which no install holds.
  const LOCKED = {
    "node_modules/made-up-dep": from("1.2.4"),
    "node_modules/@made-up/scoped": from("3.0.0", { dev: true }),
    "node_modules/@made-up/binding-made-up-os": from("4.0.0", { optional: true, os: ["made-up-os"] }),
  };
  const { "node_modules/@made-up/binding-made-up-os": _otherSystem, ...HERE } = LOCKED;
  const CLIENT = "tools/made-up-client";
  const WEB = "src/Made.Up.Web";
  const lockText = (packages) =>
    `${JSON.stringify(
      {
        name: "made-up-project",
        lockfileVersion: 3,
        requires: true,
        packages: { "": { name: "made-up-project", devDependencies: { "made-up-dep": "^1.2.0" } }, ...packages },
      },
      null,
      2,
    )}\n`;
  // A made-up npm project in a folder of the repository: its package.json and the lockfile that locks `packages`.
  function npmProject(dir, folder, packages = LOCKED) {
    const manifest = { name: "made-up-project", devDependencies: { "made-up-dep": "^1.2.0" } };
    write(dir, `${folder}/package.json`, `${JSON.stringify(manifest)}\n`);
    write(dir, `${folder}/package-lock.json`, lockText(packages));
  }
  // What npm leaves in a folder after it installed `packages`: each one's folder with its package.json, and its
  // record of them.
  function npmInstalled(dir, folder, packages = HERE) {
    for (const [path, entry] of Object.entries(packages)) {
      write(dir, `${folder}/${path}/package.json`, JSON.stringify({ version: entry.version }));
    }
    const record = { lockfileVersion: 3, requires: true, packages };
    write(dir, `${folder}/node_modules/.package-lock.json`, JSON.stringify(record));
  }
  // The made-up repository with npm projects in the folders given, committed, node_modules ignored as in a real
  // repository.
  async function withProjects(t, ...folders) {
    const dir = repository(t);
    write(dir, ".gitignore", "node_modules/\n");
    for (const folder of folders) npmProject(dir, folder);
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "-m", "chore: the made-up npm projects");
    return dir;
  }
  const installing = (cwd, temp, env, ...args) =>
    tdd(cwd, ["install", ...args.flatMap(optionsAsArguments)], { env: { ...tempEnv(temp), ...env } });
  const DONE = String.raw`npm ci: done in \d+(\.\d)?s`;
  const AGAIN = "run again: node .claude/skills/tdd-apply/scripts/tdd.mjs install";

  test("says in one line that a repository tracks no lockfile, and starts no npm", async (t) => {
    const dir = repository(t);
    const npm = fakeNpm(t);

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "install: no folder with a tracked package-lock.json\n");
    assert.deepEqual(npm.received(), []);
  });

  test("says ok for an install that is what its lockfile says, and starts no npm", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);
    npmInstalled(dir, CLIENT);

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `install: ${CLIENT} | ok\n`);
    assert.equal(r.err, "");
    assert.deepEqual(npm.received(), []);
    assert.deepEqual(await status(dir), [], "the working tree stays clean");
  });

  test("runs npm ci in a folder without node_modules, says so in the folder's line, and finds it ok afterwards", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const temp = tempFolder(t);
    const npm = fakeNpm(t);

    const r = await installing(dir, temp, npm.env());
    const again = await installing(dir, temp, npm.env());

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^install: ${CLIENT} \\| missing \\| ${DONE}\\n$`));
    assert.equal(r.err, "");
    const [call, ...more] = npm.received();
    assert.deepEqual(more, [], "npm is started once");
    assert.deepEqual(call.args, ["ci"]);
    samePath(call.cwd, join(dir, CLIENT));
    assert.equal(again.out, `install: ${CLIENT} | ok\n`);
    assert.deepEqual(await status(dir), [], "node_modules is ignored, and the lockfile is as it was");
  });

  test("keeps npm's own output out of what it prints, in a log beside the run's logs", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const temp = tempFolder(t);

    const r = await installing(dir, temp, fakeNpm(t).env());

    assert.doesNotMatch(r.out + r.err, /made-up npm output/);
    const logs = readdirSync(join(temp, "tdd-runs", "install"));
    assert.deepEqual(
      logs.map((name) => name.replace(/^\d{8}-\d{6}/, "<time>")),
      ["<time>-npm-ci-tools-made-up-client.log"],
    );
    const log = readFileSync(join(temp, "tdd-runs", "install", logs[0]), "utf8");
    assert.equal(log, "made-up npm output: added 3 packages\n");
  });

  test("runs npm ci again where a lockfile's step inside package.json's range left the install behind", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);
    npmInstalled(dir, CLIENT, { ...HERE, "node_modules/made-up-dep": from("1.2.3") });

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      new RegExp(
        `^install: ${CLIENT} \\| stale: differs from the lockfile in 1 package: ` +
          `node_modules/made-up-dep \\(1\\.2\\.4 locked, 1\\.2\\.3 installed\\) \\| ${DONE}\\n$`,
      ),
    );
    assert.deepEqual(
      npm.received().map((call) => call.args),
      [["ci"]],
    );
    const record = JSON.parse(read(dir, `${CLIENT}/node_modules/.package-lock.json`));
    assert.equal(record.packages["node_modules/made-up-dep"].version, "1.2.4");
  });

  test("runs npm ci where node_modules is there without npm's record, as an install that failed leaves it", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);
    mkdirSync(join(dir, CLIENT, "node_modules", ".bin"), { recursive: true });

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      new RegExp(
        `^install: ${CLIENT} \\| stale: no node_modules/\\.package-lock\\.json, npm's record of what it installed \\| ${DONE}\\n$`,
      ),
    );
  });

  test("checks every folder, one line each in the order of their names, and installs only where it must", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const npm = fakeNpm(t);
    npmInstalled(dir, WEB);

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    const [web, client, ...more] = r.out.trimEnd().split("\n");
    assert.equal(web, `install: ${WEB} | ok`);
    assert.match(client, new RegExp(`^install: ${CLIENT} \\| missing \\| ${DONE}$`));
    assert.deepEqual(more, []);
    assert.equal(npm.received().length, 1);
    samePath(npm.received()[0].cwd, join(dir, CLIENT));
  });

  test("with --dry-run says each folder's state and what it would run, and runs nothing", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const temp = tempFolder(t);
    const npm = fakeNpm(t);
    npmInstalled(dir, WEB, { ...HERE, "node_modules/made-up-extra": from("7.0.0") });

    const r = await installing(dir, temp, npm.env(), { "dry-run": true });

    assert.equal(r.code, 0, r.err);
    assert.equal(
      r.out,
      `install: ${WEB} | stale: differs from the lockfile in 1 package: node_modules/made-up-extra (not in the lockfile) | ` +
        `npm ci: not run (--dry-run)\ninstall: ${CLIENT} | missing | npm ci: not run (--dry-run)\n`,
    );
    assert.deepEqual(npm.received(), []);
    assert.equal(existsSync(join(dir, CLIENT, "node_modules")), false);
    assert.equal(existsSync(join(temp, "tdd-runs")), false, "no log is written");
  });

  test("takes a lockfile only when git tracks it, and none under a folder named fixtures or node_modules", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);
    npmInstalled(dir, CLIENT);
    npmProject(dir, "tests/fixtures/an-npm-project");
    npmProject(dir, `${CLIENT}/node_modules/made-up-dep`);
    await git(dir, "add", "--force", "tests/fixtures", `${CLIENT}/node_modules/made-up-dep/package-lock.json`);
    await git(dir, "commit", "--quiet", "-m", "chore: lockfiles that are no install's");
    npmProject(dir, "tools/not-tracked");

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `install: ${CLIENT} | ok\n`);
    assert.deepEqual(npm.received(), []);
  });

  test("leaves out a tracked lockfile that is not in the working tree: there is nothing to install from", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const npm = fakeNpm(t);
    npmInstalled(dir, WEB);
    rmSync(join(dir, CLIENT), { recursive: true });

    const r = await installing(dir, tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `install: ${WEB} | ok\n`);
    assert.deepEqual(npm.received(), []);
  });

  test("names the folders from the repository's root, from wherever it is called, and installs a lockfile in the root", async (t) => {
    const dir = await withProjects(t, ".", CLIENT);
    const npm = fakeNpm(t);
    npmInstalled(dir, CLIENT);

    const r = await installing(join(dir, "src", "App"), tempFolder(t), npm.env());

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^install: \\. \\| missing \\| ${DONE}\\ninstall: ${CLIENT} \\| ok\\n$`));
    samePath(npm.received()[0].cwd, dir);
  });

  test("tells a failed install in one ERROR line, with the way on, and still installs the other folders", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const temp = tempFolder(t);
    const npm = fakeNpm(t);

    const r = await installing(dir, temp, npm.env("fail", "Made.Up.Web"));

    assert.equal(r.code, 1);
    assert.match(r.out, new RegExp(`^install: ${CLIENT} \\| missing \\| ${DONE}\\n$`));
    assert.ok(oneLine(r.err), r.err);
    const line =
      /^ERROR: install: src\/Made\.Up\.Web \| missing \| npm ci failed \(exit 1\) after \d+(\.\d)?s: its node_modules may now be incomplete \| run again: node \.claude\/skills\/tdd-apply\/scripts\/tdd\.mjs install \| log: (\S+\.log) \| npm said: npm error code EPERM \| npm error made-up: a file is held by another program\n$/;
    assert.match(r.err, line);
    const log = line.exec(r.err)[2];
    assert.ok(!log.includes("\\"), "the log's path has forward slashes");
    assert.equal(
      readFileSync(log, "utf8"),
      "made-up npm output: added 3 packages\nnpm error code EPERM\nnpm error made-up: a file is held by another program\n",
    );
    assert.equal(npm.received().length, 2);
  });

  test("tells it when npm ends without an error and the install is still not what the lockfile says", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);
    mkdirSync(join(dir, CLIENT, "node_modules"));

    const r = await installing(dir, tempFolder(t), npm.env("nothing"));

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.ok(oneLine(r.err), r.err);
    assert.match(
      r.err,
      /^ERROR: install: tools\/made-up-client \| stale: no node_modules\/\.package-lock\.json, npm's record of what it installed \| npm ci ended without an error after \d+(\.\d)?s, and the install is still not what the lockfile says: stale: no node_modules\/\.package-lock\.json, npm's record of what it installed \| log: \S+\.log\n$/,
    );
    assert.doesNotMatch(r.err, /run again/, "running it again would end the same way");
  });

  test("stops an install at the command's time limit and starts none after it", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const npm = fakeNpm(t);

    // 0.05 minutes: 3 seconds, enough for the stand-in to start on a busy machine.
    const r = await installing(dir, tempFolder(t), npm.env("hang"), { timeout: "0.05" });

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    const [first, second, ...more] = r.err.trimEnd().split("\n");
    assert.deepEqual(more, []);
    assert.match(
      first,
      new RegExp(
        `^ERROR: install: ${WEB.replace(/\./g, "\\.")} \\| missing \\| npm ci stopped at the time limit \\(0\\.05 min\\): ` +
          `its node_modules may now be incomplete \\| ${AGAIN.replace(/\./g, "\\.")} \\| log: \\S+\\.log$`,
      ),
    );
    assert.equal(
      second,
      `ERROR: install: ${CLIENT} | missing | npm ci not started: the time limit (0.05 min) was reached | ${AGAIN}`,
    );
    assert.equal(npm.received().length, 1);
  });

  test("tells in one line per folder that npm cannot be started", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const temp = tempFolder(t);

    const r = await installing(dir, temp, { TDD_NPM_CLI: "no-such-npm-made-up" });

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.equal(
      r.err,
      `ERROR: install: ${CLIENT} | missing | npm ci cannot be started: no-such-npm-made-up is not on the PATH\n`,
    );
    assert.equal(existsSync(join(dir, CLIENT, "node_modules")), false);
    assert.deepEqual(readdirSync(join(temp, "tdd-runs", "install")), [], "no empty log is left");
  });

  test("tells a lockfile it cannot judge in its folder's ERROR line, starts no npm there, and checks the others", async (t) => {
    const dir = await withProjects(t, CLIENT, WEB);
    const npm = fakeNpm(t);
    npmInstalled(dir, CLIENT);
    write(dir, `${WEB}/package-lock.json`, JSON.stringify({ lockfileVersion: 1, dependencies: {} }));

    const r = await installing(dir, tempFolder(t), npm.env());
    const dry = await installing(dir, tempFolder(t), npm.env(), { "dry-run": true });

    for (const run of [r, dry]) {
      assert.equal(run.code, 1);
      assert.equal(run.out, `install: ${CLIENT} | ok\n`);
      assert.equal(
        run.err,
        `ERROR: install: ${WEB} | package-lock.json has no "packages" map (lockfileVersion 1): the check reads lockfileVersion 2 or 3\n`,
      );
    }
    assert.deepEqual(npm.received(), []);
  });

  test("takes --change or --pr, puts the log with that run's logs, and names the same command to run again", async (t) => {
    const npm = fakeNpm(t);
    const ofApply = await initialized(t);
    const { dir: ofTriage } = await triaging(t, "none");
    for (const dir of [ofApply, ofTriage]) {
      npmProject(dir, CLIENT);
      await git(dir, "add", "-A");
    }
    const [tempOfApply, tempOfTriage] = [tempFolder(t), tempFolder(t)];

    const apply = await installing(ofApply, tempOfApply, npm.env("fail"), { change: CHANGE });
    const triage = await installing(ofTriage, tempOfTriage, npm.env("fail"), { pr: PR });

    assert.match(apply.err, new RegExp(` \\| ${AGAIN.replace(/\./g, "\\.")} --change ${CHANGE} \\| log: `));
    assert.match(triage.err, new RegExp(` \\| ${AGAIN.replace(/\./g, "\\.")} --pr ${PR} \\| log: `));
    assert.equal(readdirSync(join(tempOfApply, "tdd-runs", CHANGE)).length, 1);
    assert.equal(readdirSync(join(tempOfTriage, "tdd-runs", `pr-${PR}`)).length, 1);
  });

  test("refuses, in one line and before anything is checked, a time limit that is no number, and both --change and --pr", async (t) => {
    const dir = await withProjects(t, CLIENT);
    const npm = fakeNpm(t);

    const limit = /^ERROR: --timeout is a number of minutes above 0\n$/;
    for (const [args, refusal] of [
      [{ timeout: "soon" }, limit],
      [{ timeout: "0" }, limit],
      [{ change: CHANGE, pr: PR }, /^ERROR: --change and --pr are given together/],
    ]) {
      const r = await installing(dir, tempFolder(t), npm.env(), args);

      assert.equal(r.code, 1, JSON.stringify(args));
      assert.equal(r.out, "");
      assert.match(r.err, refusal);
      assert.ok(oneLine(r.err), r.err);
    }
    assert.deepEqual(npm.received(), []);
  });
});

describe("run", { concurrency: true }, () => {
  // Where a test's logs go: `run` writes them under the OS temp folder, which these variables name.
  const tempEnv = (dir) => ({ TEMP: dir, TMP: dir, TMPDIR: dir });
  const FIRST_LINE = /^exit (\d+)(?: \([^)]*\))? \| (.+) \| (\S+(?: \d+m \d+s| \d+s)?) \| log: (.+)$/;
  const firstLine = (r) => {
    const m = FIRST_LINE.exec(r.out.split("\n")[0]);
    assert.ok(m, `no first line in: ${r.out}${r.err}`);
    return { code: Number(m[1]), totals: m[2], duration: m[3], log: m[4] };
  };
  // Runs a command through `run` under the label, from the folder `cwd`, its log going under `temp`.
  // `more.options` are run's own options, `more.env` what else the command's environment holds.
  const wrapped = (cwd, temp, label, command, { options = {}, env = {} } = {}) =>
    tdd(cwd, withChange("run", { label, ...options }, "--", ...command), { env: { ...tempEnv(temp), ...env } });
  // A Node one-liner as a command.
  const node = (code, ...args) => [process.execPath, "-e", code, ...args];
  // A Node one-liner that prints a fixture and ends with the exit code given.
  const printing = (fixture, code) =>
    node(
      "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8')); process.exitCode = Number(process.argv[2]);",
      join(FIXTURES, fixture),
      String(code),
    );
  // A script that writes the arguments it got to a file, as JSON.
  function argumentsRecorder(dir) {
    write(
      dir,
      "record-args.mjs",
      'import { writeFileSync } from "node:fs";\nwriteFileSync(process.env.ARGS_OUT, JSON.stringify(process.argv.slice(2)));\n',
    );
    return {
      script: join(dir, "record-args.mjs"),
      env: { ARGS_OUT: join(dir, "args.json") },
      got: () => JSON.parse(read(dir, "args.json")),
    };
  }
  const AWKWARD = [
    "--treenode-filter",
    "/*/*/(AScenarios)|(BScenarios)/*",
    "/*/*/Class/(Test1)|(Test2)",
    "a b",
    'q"uote',
    "it's",
    "100%",
    "%PATH%",
    "a&b",
    "x<y>z",
    "caret^",
    "back\\slash\\",
    'end"\\',
    "!bang!",
    "",
    "semi;colon,comma",
    "`tick`",
    "$HOME",
    "--",
    "-t",
  ];

  test("passes the command's exit code through and prints one line for it", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const r = await wrapped(dir, temp, "unit", node("process.exit(0)"));
    const seven = await wrapped(dir, temp, "unit", node("console.log('made-up output'); process.exit(7)"));

    assert.equal(r.code, 0, r.err);
    assert.ok(oneLine(r.out), r.out);
    assert.equal(firstLine(r).code, 0);
    assert.equal(firstLine(r).totals, "totals not recognised");
    assert.equal(seven.code, 7);
    assert.equal(firstLine(seven).code, 7);
    assert.deepEqual(seven.out.trimEnd().split("\n").slice(1), ["made-up output"]);
  });

  test("writes standard output and error output, in order, to a log under the temp folder's tdd-runs", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const code = "process.stdout.write('one\\n'); process.stderr.write('two\\n'); process.stdout.write('three\\n');";

    const r = await wrapped(dir, temp, "web tests", node(code));

    assert.equal(r.code, 0, r.err);
    const { log } = firstLine(r);
    assert.equal(readFileSync(log, "utf8"), "one\ntwo\nthree\n");
    const folder = join(temp, "tdd-runs", CHANGE);
    samePath(join(log, ".."), folder);
    assert.deepEqual(
      readdirSync(folder).map((f) => f.replace(/^\d{8}-\d{6}/, "<time>")),
      ["<time>-web-tests.log"],
    );
  });

  test("gives each of several runs started at once, with one label, a log of its own", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const run = (n) => wrapped(dir, temp, "unit", node(`console.log('run ${n}')`));

    const runs = await Promise.all([run(1), run(2), run(3), run(4)]);

    const logs = runs.map((r) => firstLine(r).log);
    assert.equal(new Set(logs).size, 4);
    assert.deepEqual(
      logs.map((log) => readFileSync(log, "utf8")),
      ["run 1\n", "run 2\n", "run 3\n", "run 4\n"],
    );
    assert.equal(readdirSync(join(temp, "tdd-runs", CHANGE)).length, 4);
  });

  test("hands the command its arguments unchanged: pipes, stars, brackets, spaces and quotes", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const recorder = argumentsRecorder(temp);

    const r = await wrapped(dir, temp, "args", [process.execPath, recorder.script, ...AWKWARD], { env: recorder.env });

    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(recorder.got(), AWKWARD);
  });

  test("hands npm's script its arguments unchanged, on Windows through npm.cmd", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const recorder = argumentsRecorder(temp);
    write(
      temp,
      "package.json",
      JSON.stringify({ name: "made-up", version: "0.0.0", private: true, scripts: { record: "node record-args.mjs" } }),
    );
    // npm itself reads `--` and options before it; what follows the `--` goes to the script.
    const forScript = AWKWARD.filter((a) => a !== "--");

    const npm = ["npm", "--prefix", temp, "run", "record", "--", ...forScript];
    const r = await wrapped(dir, temp, "npm", npm, { env: recorder.env });

    assert.equal(r.code, 0, r.out + r.err);
    assert.deepEqual(recorder.got(), forScript);
  });

  test(
    "starts a .cmd file in a folder with spaces and brackets, its arguments unchanged",
    { skip: !WINDOWS && "Windows only" },
    async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);
      const recorder = argumentsRecorder(temp);
      const shim = join(temp, "a (made up) folder & more", "shim.cmd");
      write(temp, "a (made up) folder & more/shim.cmd", `@"${process.execPath}" "${recorder.script}" %*\r\n`);

      const r = await wrapped(dir, temp, "shim", [shim, ...AWKWARD], { env: recorder.env });

      assert.equal(r.code, 0, r.out + r.err);
      assert.deepEqual(recorder.got(), AWKWARD);
    },
  );

  test("runs the command in the repository's root, from wherever it is called", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const r = await wrapped(join(dir, "src", "App"), temp, "cwd", node("console.log(process.cwd())"));

    samePath(readFileSync(firstLine(r).log, "utf8").trim(), dir);
  });

  test("reads a green .NET run's totals", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const r = await wrapped(dir, temp, "unit", printing("dotnet-test-passed.txt", 0));

    assert.equal(r.code, 0, r.err);
    assert.ok(oneLine(r.out), r.out);
    assert.equal(firstLine(r).totals, "1220 passed, 0 failed, 0 skipped");
    assert.match(firstLine(r).duration, /^\d+\.\ds$/);
  });

  test("reads a red .NET run: the totals of both assemblies, then each failed test with 3 lines of its message", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const r = await wrapped(dir, temp, "all", printing("dotnet-test-failed.txt", 2));

    assert.equal(r.code, 2);
    assert.equal(firstLine(r).totals, "3 passed, 4 failed, 2 skipped");
    assert.deepEqual(r.out.trimEnd().split("\n").slice(1, 7), [
      "- A_stub_is_not_written_yet",
      "    [Test Failure] NotImplementedException: c000 tasks.md 1.1: the made-up stub.",
      "- A_case_ends_as_its_path_says(throws)",
      "    [Test Failure] ShouldAssertException: path",
      "    should be",
      '    "returns"',
    ]);
    assert.equal(r.out.trimEnd().split("\n").length, 15);
  });

  test("reads a green and a red Vitest run", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const green = await wrapped(dir, temp, "web", printing("vitest-passed.txt", 0));
    const red = await wrapped(dir, temp, "web", printing("vitest-failed.txt", 1));

    assert.equal(firstLine(green).totals, "23 passed, 0 failed, 0 skipped");
    assert.ok(oneLine(green.out), green.out);
    assert.equal(red.code, 1);
    assert.equal(firstLine(red).totals, "2 passed, 3 failed, 2 skipped, 1 failed suite");
    assert.deepEqual(red.out.trimEnd().split("\n").slice(3, 5), [
      "- src/alpha.test.js > a made-up group > a list holds what was added",
      "    AssertionError: expected [ 'first' ] to deeply equal [ 'first', 'second' ]",
    ]);
  });

  test("prints the last lines of the output when the command failed and no failed test is recognised", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const code =
      "for (let i = 1; i <= 40; i++) console.log('line ' + i); console.error('error MADEUP1: the build failed'); process.exit(1);";

    const r = await wrapped(dir, temp, "build", node(code));

    assert.equal(r.code, 1);
    const lines = r.out.trimEnd().split("\n");
    assert.equal(firstLine(r).totals, "totals not recognised");
    assert.equal(lines.length, 26);
    assert.equal(lines[1], "line 17");
    assert.equal(lines.at(-1), "error MADEUP1: the build failed");
  });

  test("stops a command at its time limit, with everything it started, and exits 124", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const pids = join(temp, "pids.json");
    write(
      temp,
      "sleeper.mjs",
      [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });',
        "writeFileSync(process.argv[2], JSON.stringify([process.pid, grandchild.pid]));",
        'console.log("started");',
        "setTimeout(() => {}, 120000);",
        "",
      ].join("\n"),
    );

    // 0.05 minutes: 3 seconds, enough for the command to start on a busy machine.
    const sleeper = [process.execPath, join(temp, "sleeper.mjs"), pids];
    const r = await wrapped(dir, temp, "slow", sleeper, { options: { timeout: "0.05" } });

    assert.equal(r.code, 124, r.out + r.err);
    assert.match(r.out, /^exit 124 \(stopped after 0\.05 min\) \| totals not recognised \| /);
    assert.deepEqual(r.out.trimEnd().split("\n").slice(1), ["started"]);
    // Whether a process still runs. One that has ended and only waits for its parent to collect it does not: on
    // Linux such a process still has its id (state Z in /proc), until whoever adopted it looks.
    const running = (pid) => {
      try {
        process.kill(pid, 0);
      } catch {
        return false;
      }
      try {
        return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
      } catch {
        return true;
      }
    };
    const deadline = Date.now() + 10_000;
    const all = JSON.parse(readFileSync(pids, "utf8"));
    while (all.some(running) && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 100));
    assert.deepEqual(all.filter(running), [], "the command and what it started are gone");
  });

  test("fails with one line and exit 127 for a command that is not there", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);

    const r = await wrapped(dir, temp, "none", ["no-such-command-made-up", "--version"]);

    assert.equal(r.code, 127);
    assert.equal(r.out, "");
    assert.match(r.err, /^ERROR: .*no-such-command-made-up/);
    assert.ok(oneLine(r.err), r.err);
  });

  test("fails with one line without a command, without a label, and for a time limit that is no number", async (t) => {
    const dir = repository(t);
    const temp = tempFolder(t);
    const command = node("process.exit(0)");

    for (const args of [
      ["--label", "x"],
      ["--label", "x", "--"],
      ["--", ...command],
      ["--label", "x", "--timeout", "soon", "--", ...command],
      ["--label", "x", "--timeout", "0", "--", ...command],
    ]) {
      const r = await tdd(dir, withChange("run", ...args), { env: tempEnv(temp) });

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal(existsSync(join(temp, "tdd-runs")), false);
  });

  // The tests allowed to fail: `run` reads the state file's `Allowed failures` section and says, in one line right
  // under its first, how many of the failed tests are on it and which are not.
  const allowing = (dir, key, value) =>
    tdd(dir, withChange("put", { section: "Allowed failures", key: key, value: value }));

  test("says which failed tests are not on the state file's list of allowed failures, an empty list too", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);

    const r = await wrapped(dir, temp, "all", printing("dotnet-test-failed.txt", 2));

    assert.equal(r.code, 2);
    assert.deepEqual(r.out.trimEnd().split("\n").slice(1, 3), [
      "allowed failures: 0 of 4 failed tests are on the list; NOT ALLOWED: A_stub_is_not_written_yet | " +
        "A_case_ends_as_its_path_says(throws) | A_list_holds_what_was_added | A_test_that_writes_output_and_fails",
      "- A_stub_is_not_written_yet",
    ]);
    assert.equal(r.out.trimEnd().split("\n").length, 16, "one line more than without a state file");
  });

  test("counts the failed tests that are on the list, and keeps the command's exit code", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);
    assert.equal((await allowing(dir, "A_stub_is_not_written_yet", "parked: question Q2, red commit 1a2b3c4")).code, 0);

    const one = await wrapped(dir, temp, "all", printing("dotnet-test-failed.txt", 2));
    for (const key of ["A_case_ends_as_its_path_says(throws)", "A_list_holds", "A_test_that_writes_output_and_fails"]) {
      await allowing(dir, key, "blocked finding 5, red commit 0f9e8d7");
    }
    const all = await wrapped(dir, temp, "all", printing("dotnet-test-failed.txt", 2));

    assert.equal(one.code, 2);
    assert.deepEqual(one.out.trimEnd().split("\n").slice(1, 3), [
      "allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: A_case_ends_as_its_path_says(throws) | " +
        "A_list_holds_what_was_added | A_test_that_writes_output_and_fails",
      "- A_stub_is_not_written_yet",
    ]);
    assert.equal(all.code, 2, "every failure is allowed, and the run is still red");
    assert.deepEqual(all.out.trimEnd().split("\n").slice(1, 3), [
      "allowed failures: 4 of 4 failed tests are on the list",
      "- A_stub_is_not_written_yet",
    ]);
  });

  test("goes back to not allowed once a test is dropped from the list", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);
    await allowing(dir, "a made-up group > a stub is not written yet", "parked: question Q2");
    const parked = await wrapped(dir, temp, "web", printing("vitest-failed.txt", 1));

    const drop = await tdd(
      dir,
      withChange("drop", { section: "Allowed failures", key: "a made-up group > a stub is not written yet" }),
    );
    const settled = await wrapped(dir, temp, "web", printing("vitest-failed.txt", 1));

    assert.match(parked.out.split("\n")[1], /^allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: /);
    assert.doesNotMatch(parked.out.split("\n")[1], /NOT ALLOWED: .*a stub is not written yet/);
    assert.equal(drop.code, 0, drop.err);
    assert.match(
      settled.out.split("\n")[1],
      /^allowed failures: 0 of 4 failed tests are on the list; NOT ALLOWED: src\/gamma\.test\.js \[ src\/gamma\.test\.js \] \| .* a stub is not written yet/,
    );
  });

  test("says that none failed for a green run while tests are on the list, and nothing while none is", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);

    const plain = await wrapped(dir, temp, "unit", printing("dotnet-test-passed.txt", 0));
    await allowing(dir, "A_parked_test", "parked: question Q2");
    const listed = await wrapped(dir, temp, "unit", printing("dotnet-test-passed.txt", 0));

    assert.ok(oneLine(plain.out), plain.out);
    assert.equal(listed.code, 0);
    assert.deepEqual(listed.out.trimEnd().split("\n").slice(1), [
      "allowed failures: 0 of 0 failed tests are on the list",
    ]);
  });

  test("puts the line on allowed failures before the last lines of a run that failed otherwise", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);
    await allowing(dir, "A_parked_test", "parked: question Q2");

    const r = await wrapped(
      dir,
      temp,
      "build",
      node("console.error('error MADEUP1: the build failed'); process.exit(1);"),
    );

    assert.deepEqual(r.out.trimEnd().split("\n").slice(1), [
      "allowed failures: 0 of 0 failed tests are on the list",
      "error MADEUP1: the build failed",
    ]);
  });

  test("in a triage, reads the triage's list and writes its logs under tdd-runs/pr-<id>", async (t) => {
    for (const of of ["change", "none"]) {
      const { dir } = await triaging(t, of);
      const temp = tempFolder(t);
      if (of === "change") {
        await tdd(dir, withChange("init", SWITCHES));
        await allowing(dir, "A_stub_is_not_written_yet", "the apply's list, which a triage does not read");
      }
      await tdd(dir, withPr("put", { section: "Allowed failures", key: "A_list_holds", value: "blocked finding 5" }));

      const r = await tdd(dir, withPr("run", { label: "all" }, "--", ...printing("dotnet-test-failed.txt", 2)), {
        env: tempEnv(temp),
      });

      assert.equal(r.code, 2, of);
      assert.match(
        r.out.split("\n")[1],
        /^allowed failures: 1 of 4 failed tests are on the list; NOT ALLOWED: A_stub/,
        of,
      );
      samePath(join(firstLine(r).log, ".."), join(temp, "tdd-runs", `pr-${PR}`));
    }
  });
});

describe("drop", { concurrency: true }, () => {
  test("removes one keyed bullet and says so in one line", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("put", { section: "Allowed failures", key: "A_made_up_test(1)", value: "parked: Q2" }));
    await tdd(
      dir,
      withChange("put", { section: "Allowed failures", key: "Another_test", value: "blocked\\nsince 1a2b3c4" }),
    );
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("drop", { section: "Allowed failures", key: "Another_test" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "dropped: Allowed failures / Another_test\n");
    assert.equal(sectionBody(read(dir, STATE), "Allowed failures"), "- **A_made_up_test(1):** parked: Q2");
    const eol = /\r\n/.test(before) ? "\r\n" : "\n";
    assert.equal(read(dir, STATE), before.replace(`- **Another_test:** blocked${eol}  since 1a2b3c4${eol}`, ""));
  });

  test("leaves the section empty when it held nothing else, and the file as `init` made it", async (t) => {
    const dir = await initialized(t);
    const fresh = read(dir, STATE);
    await tdd(dir, withChange("put", { section: "Allowed failures", key: "A_made_up_test(1)", value: "parked: Q2" }));

    const r = await tdd(dir, withChange("drop", { section: "allowed failures", key: " A_made_up_test(1) " }));

    assert.equal(r.code, 0, r.err);
    assert.equal(read(dir, STATE), fresh);
  });

  test("refuses a key the section does not have, naming those it has, and changes nothing", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("put", { section: "Allowed failures", key: "A_made_up_test(1)", value: "parked: Q2" }));
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("drop", { section: "Allowed failures", key: "A_made_up_test" }));

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.equal(r.err, 'ERROR: no key "A_made_up_test" in Allowed failures; its keys are: "A_made_up_test(1)"\n');
    assert.equal(read(dir, STATE), before);
  });

  test("fails with one line without a key or a section, for a section that is not there, and before `init`", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    for (const options of [
      { section: "Allowed failures" },
      { key: "A" },
      { section: "Disputes", key: "A" },
      { section: "Open", key: "A" },
    ]) {
      const r = await tdd(dir, withChange("drop", options));

      assert.equal(r.code, 1, JSON.stringify(options));
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal(read(dir, STATE), before);
    const none = await tdd(repository(t), withChange("drop", { section: "Open", key: "A" }));
    assert.match(none.err, /^ERROR: .*init/);
  });

  test("works on the reviews file with --file reviews, and creates neither a file nor a section", async (t) => {
    const dir = await initialized(t);

    const none = await tdd(dir, withChange("drop", { file: "reviews", section: "Chapter A", key: "Verdict" }));
    await tdd(dir, withChange("put", { file: "reviews", section: "Chapter A", key: "Verdict", value: "clean" }));
    const r = await tdd(dir, withChange("drop", { file: "reviews", section: "Chapter A", key: "Verdict" }));

    assert.equal(none.code, 1);
    assert.ok(oneLine(none.err), none.err);
    assert.equal(r.out, "dropped: Chapter A / Verdict\n");
    assert.equal(sectionBody(read(dir, REVIEWS), "Chapter A"), EMPTY);
  });
});

describe("the local file: --local, and what get prints", { concurrency: true }, () => {
  const local = (dir, of) => readFileSync(localFile(dir, of), "utf8");
  // The design files as the design-fetcher records them: what any machine can use in the state file, and each
  // folder of this machine in the local file.
  async function designFiles(dir) {
    const committed = await tdd(dir, withChange("set", { section: "Design files", stdin: true }), {
      input:
        "Fetched 2026-11-25.\n- **Design system:** version 7, as design.md names\n- **Screens design:** version 12\n",
    });
    assert.equal(committed.code, 0, committed.err);
    for (const [key, value] of [
      ["Design system folder", "C:/made/up/scratchpad/design-system"],
      ["Screens design folder", "C:/made/up/scratchpad/screens"],
    ]) {
      const r = await tdd(dir, withChange("put", { section: "Design files", local: true, key, value }));
      assert.equal(r.code, 0, r.err);
    }
  }

  test("put --local writes the value to the local file, never to the state file, and says that it is local", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    const r = await tdd(
      dir,
      withChange("put", { section: "design files", local: true, key: "Design system folder", value: "C:/made/up/ds" }),
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "put: Design files / Design system folder | local\n");
    assert.equal(read(dir, STATE), before, "the state file keeps every byte");
    assert.equal(keyValue(local(dir), "Design files", "Design system folder"), "C:/made/up/ds");
    assert.deepEqual(sectionNames(local(dir)), ["Run", "Design files"], "under the state file's name for the section");
    assert.deepEqual(await status(dir), [`?? ${STATE}`], "git never sees the local file");
    assert.deepEqual(leftInGitFolder(dir), [], "no lock is left");
  });

  test("get prints a section from both files: the state file's lines, then what only the local file holds", async (t) => {
    const dir = await initialized(t);
    await designFiles(dir);

    const one = await tdd(dir, withChange("get", { section: "Design files" }));
    const run = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(
      one.out,
      "Fetched 2026-11-25.\n- **Design system:** version 7, as design.md names\n- **Screens design:** version 12\n" +
        "- **Design system folder:** C:/made/up/scratchpad/design-system\n" +
        "- **Screens design folder:** C:/made/up/scratchpad/screens\n",
    );
    assert.match(run.out, /^- \*\*Status:\*\* applying\n/);
    assert.ok(
      run.out.endsWith(`- **Branch:** ${BRANCH}\n- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n`),
      run.out,
    );
    assert.equal(read(dir, STATE).includes("made/up"), false, "no folder of this machine in the state file");
  });

  test("get prints several sections, each from both files, under the state file's names", async (t) => {
    const dir = await initialized(t);
    await tdd(
      dir,
      withChange("put", { section: "Design files", local: true, key: "Design system folder", value: "C:/x" }),
    );

    const r = await tdd(dir, withChange("get", { section: ["design files", "Open"] }));

    assert.equal(r.out, `## Design files\n- **Design system folder:** C:/x\n\n## Open\n${EMPTY}\n`);
  });

  test("get prints a key that both files hold once, where the state file has it, with the local value", async (t) => {
    const dir = await initialized(t);
    // A state file from before the local file was there, or from another machine.
    for (const [key, value] of [
      ["Folder", "D:/another/machine/repo"],
      ["Code graph project", "another-machines-project"],
      ["Issue", "#67"],
    ]) {
      writeFileSync(join(dir, STATE), putKey(read(dir, STATE), "Run", key, value));
    }
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("get", { section: "Run" }));

    assert.ok(
      r.out.endsWith(
        `- **Branch:** ${BRANCH}\n- **Folder:** D:/another/machine/repo\n` +
          "- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n- **Issue:** #67\n",
      ),
      r.out,
    );
    assert.equal(read(dir, STATE), before, "the old lines are left as they are");
  });

  test("leaves an old line of this machine in the state file alone when init and index run again", async (t) => {
    const dir = await initialized(t);
    writeFileSync(join(dir, STATE), putKey(read(dir, STATE), "Run", "Code graph project", "another-machines-project"));
    rmSync(localFile(dir));
    const before = read(dir, STATE);
    const graph = fakeGraph(t);

    assert.equal((await tdd(dir, withChange("init"), { env: graph.env() })).code, 0);
    assert.equal((await tdd(dir, withChange("index"), { env: graph.env() })).code, 0);
    const run = await tdd(dir, withChange("get", { section: "Run" }));

    assert.equal(read(dir, STATE), before);
    assert.ok(run.out.endsWith("- **Code graph project:** made-up-project\n"), run.out);
    assert.equal(run.out.match(/Code graph project/g).length, 1);
  });

  test("set, add and drop take --local too, and each change stays in the local file", async (t) => {
    const dir = await initialized(t);
    const before = read(dir, STATE);

    const set = await tdd(
      dir,
      withChange("set", { section: "Design files", local: true, text: "a note\\nof this machine" }),
    );
    const add = await tdd(dir, withChange("add", { section: "Design files", local: true, line: "a bullet" }));
    const put = await tdd(
      dir,
      withChange("put", { section: "Design files", local: true, key: "Folder", value: "C:/x" }),
    );
    const first = local(dir);
    const drop = await tdd(dir, withChange("drop", { section: "Design files", local: true, key: "Folder" }));

    assert.equal(set.out, "set: Design files | 2 lines | local\n");
    assert.equal(add.out, "added: Design files | 3 lines | local\n");
    assert.equal(put.out, "put: Design files / Folder | local\n");
    assert.equal(drop.out, "dropped: Design files / Folder | local\n");
    assert.equal(sectionBody(first, "Design files"), "a note\nof this machine\n- a bullet\n- **Folder:** C:/x");
    assert.equal(sectionBody(local(dir), "Design files"), "a note\nof this machine\n- a bullet");
    assert.equal(read(dir, STATE), before);
  });

  test("a value put without --local goes to the state file, and the local value of the same key still wins in get", async (t) => {
    const dir = await initialized(t);
    await tdd(
      dir,
      withChange("put", { section: "Design files", local: true, key: "Design system folder", value: "C:/mine" }),
    );

    const r = await tdd(
      dir,
      withChange("put", { section: "Design files", key: "Design system folder", value: "C:/theirs" }),
    );
    const got = await tdd(dir, withChange("get", { section: "Design files" }));

    assert.equal(r.out, "put: Design files / Design system folder\n");
    assert.equal(keyValue(read(dir, STATE), "Design files", "Design system folder"), "C:/theirs");
    assert.equal(got.out, "- **Design system folder:** C:/mine\n");
  });

  test("the script's own reads are the state file's: commit takes the trailers from it, never from the local file", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("put", { section: "Run", local: true, key: "Commit trailers", value: "Local: no" }));
    await tdd(dir, withChange("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one" }));

    const r = await tdd(dir, withChange("commit", { type: "docs", tag: "plan", summary: "The state file" }));

    assert.equal(r.code, 0, r.err);
    assert.equal((await lastCommit(dir)).message, "docs(c900): [plan] The state file\n\nA-Trailer: one");
  });

  test("in a triage, --local writes the triage's local file and may open a section, as the triage's state file may", async (t) => {
    for (const of of ["change", "none"]) {
      const { dir, state } = await triaging(t, of);
      const before = readFileSync(state, "utf8");

      const r = await tdd(dir, withPr("put", { section: "Work", local: true, key: "Folder", value: "C:/made/up" }));
      const got = await tdd(dir, withPr("get", { section: ["Work", "Run"] }));

      assert.equal(r.out, "put: Work / Folder | local\n", of);
      assert.equal(readFileSync(state, "utf8"), before, of);
      assert.equal(keyValue(local(dir, `triage-${PR}`), "Work", "Folder"), "C:/made/up");
      assert.match(got.out, /^## Work\n- \*\*Folder:\*\* C:\/made\/up\n\n## Run\n- \*\*Status:\*\* triaging\n/);
      assert.ok(got.out.endsWith("- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n"), got.out);
    }
  });

  describe("refuses, in one line, and writes nothing", { concurrency: true }, () => {
    const refused = (r, message) => {
      assert.equal(r.code, 1, r.out + r.err);
      assert.equal(r.out, "");
      if (typeof message === "string") assert.equal(r.err, `ERROR: ${message}\n`);
      else assert.match(r.err, message);
      assert.ok(oneLine(r.err), r.err);
    };

    test("--local with --file reviews", async (t) => {
      const dir = await initialized(t);

      for (const command of [
        withChange("put", { file: "reviews", section: "Chapter A", local: true, key: "A", value: "x" }),
        withChange("set", { file: "reviews", section: "Chapter A", local: true, text: "x" }),
        withChange("add", { file: "reviews", section: "Chapter A", local: true, line: "x" }),
        withChange("drop", { file: "reviews", section: "Chapter A", local: true, key: "A" }),
      ]) {
        refused(
          await tdd(dir, command),
          "--local goes with the state file alone: the reviews file holds no value of this machine",
        );
      }
      assert.equal(existsSync(join(dir, REVIEWS)), false);
    });

    test("--local for a section an apply's state file does not have, naming those it has", async (t) => {
      const dir = await initialized(t);
      const before = local(dir);

      const r = await tdd(dir, withChange("put", { section: "Design file", local: true, key: "A", value: "x" }));

      refused(
        r,
        /^ERROR: no section "Design file" in .*\.tdd-state\.md; --local keeps this machine's values of one of its sections: Resume here, Run, .*, Design files\n$/,
      );
      assert.equal(local(dir), before);
    });

    test("--local before the state file is there", async (t) => {
      const dir = repository(t);

      refused(
        await tdd(dir, withChange("put", { section: "Run", local: true, key: "A", value: "x" })),
        `no ${STATE}: run init first`,
      );
      assert.equal(existsSync(localFile(dir)), false);
    });

    test("drop --local of a key or a section the local file does not have", async (t) => {
      const dir = await initialized(t);
      await tdd(dir, withChange("put", { section: "Open", key: "Q1", value: "in the state file" }));
      const before = local(dir);

      refused(
        await tdd(dir, withChange("drop", { section: "Run", local: true, key: "Status" })),
        '--local: no key "Status" in Run; its keys are: "Code graph project"',
      );
      refused(
        await tdd(dir, withChange("drop", { section: "Open", local: true, key: "Q1" })),
        /^ERROR: --local: no section "Open"; /,
      );
      assert.equal(local(dir), before);
      assert.equal(keyValue(read(dir, STATE), "Open", "Q1"), "in the state file");
    });

    test("get --local: get needs no flag", async (t) => {
      const dir = await initialized(t);

      refused(
        await tdd(dir, withChange("get", { section: "Run", local: true })),
        /^ERROR: unknown option --local; get takes: /,
      );
    });

    test("a text the local file cannot hold", async (t) => {
      const dir = await initialized(t);
      const before = local(dir);

      refused(
        await tdd(dir, withChange("set", { section: "Design files", local: true, text: "## A heading" })),
        /^ERROR: --local: the text holds a `## ` line, /,
      );
      assert.equal(local(dir), before);
    });
  });
});

describe("progress", { concurrency: true }, () => {
  test("prints exactly one line with the step and the clock's time, and needs no change and no repository", async (t) => {
    const outside = tempFolder(t);
    const before = clock();

    const r = await tdd(outside, ["progress", "--step", "Chapter B, slice 3"]);

    assert.equal(r.code, 0, r.err);
    const time = /^progress: Chapter B, slice 3 completed at (\d\d:\d\d)\n$/.exec(r.out)?.[1];
    assert.ok([before, clock()].includes(time), r.out);
  });

  test("takes --change, --pr and --root without looking at them", async (t) => {
    const outside = tempFolder(t);

    for (const more of [
      ["--change", "c901-not-there"],
      ["--pr", "not-started"],
      ["--root", outside],
    ]) {
      const r = await tdd(outside, ["progress", "--step", "Baseline", ...more]);

      assert.equal(r.code, 0, r.err);
      assert.match(r.out, /^progress: Baseline completed at \d\d:\d\d\n$/);
    }
  });

  test("fails with one line without a step, and for one that is empty or of two lines", async (t) => {
    const outside = tempFolder(t);

    for (const args of [[], ["--step", " "], ["--step", "one\\ntwo"], ["--step", "Baseline", "--done", "Baseline"]]) {
      const r = await tdd(outside, ["progress", ...args]);

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.ok(oneLine(r.err), r.err);
    }
  });
});

describe("commit --done", { concurrency: true }, () => {
  test("prints the step's progress line after the commit's own line", async (t) => {
    const dir = await initialized(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const before = clock();

    const r = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "close", summary: "Slice 3", tick: "5.1", done: "Chapter B, slice 3" }),
    );

    assert.equal(r.code, 0, r.err);
    const [made, progress, ...rest] = r.out.trimEnd().split("\n");
    assert.match(made, /^[0-9a-f]{7,} feat\(c900\): \[close\] Slice 3 \| ticked 5\.1 \| graph: skipped$/);
    const time = /^progress: Chapter B, slice 3 completed at (\d\d:\d\d)$/.exec(progress)?.[1];
    assert.ok([before, clock()].includes(time), r.out);
    assert.deepEqual(rest, []);
    assert.equal((await lastCommit(dir)).message, "feat(c900): [close] Slice 3", "the step is not in the message");
  });

  test("prints no progress line when there is nothing to commit, and none when the guard stops it", async (t) => {
    const dir = repository(t);

    const nothing = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "close", summary: "x", done: "Baseline" }),
    );
    write(dir, "tests/App.UnitTests/MappingTests.cs", "// changed by the implementer\n");
    const stopped = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "x", check: "green", done: "Baseline" }),
    );

    assert.equal(nothing.code, 4);
    assert.equal(nothing.out, "");
    assert.equal(stopped.code, 3);
    assert.doesNotMatch(stopped.out, /progress:/);
  });

  test("refuses a step that is empty or of two lines before anything is changed", async (t) => {
    const dir = await initialized(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const head = (await lastCommit(dir)).sha;

    for (const done of [" ", "one\\ntwo"]) {
      const r = await tdd(
        dir,
        withChange("commit", { type: "feat", tag: "close", summary: "x", tick: "5.1", resume: "Next.", done: done }),
      );

      assert.equal(r.code, 1, done);
      assert.match(r.err, /^ERROR: --done is the step's name on one line/);
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal((await lastCommit(dir)).sha, head);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
    assert.equal(sectionBody(read(dir, STATE), "Resume here"), EMPTY);
  });
});

describe("unguard", { concurrency: true }, () => {
  const GUARD = "tests/App.UnitTests/GuardTests.cs";
  const TESTS = "tests/App.UnitTests/MappingTests.cs";
  const short = async (dir) => (await lastCommit(dir)).sha.slice(0, 7);

  // Commits through the script, as the runner does, and answers the new commit's short hash. `whose` is
  // `withChange` or `withPr`.
  async function committed(dir, whose, options) {
    const r = await tdd(dir, whose("commit", options));
    assert.equal(r.code, 0, r.err);
    return short(dir);
  }

  // The red commit of a finding's guard test: a test file it adds and one it changes. `more` are further options
  // of the commit, such as `resume`, with which the commit carries the state file too.
  async function redCommit(dir, whose, tag, id, more = {}) {
    write(dir, GUARD, "// the guard test of a made-up finding\n");
    write(dir, TESTS, "// a test\n// and a helper the guard test needs\n");
    return committed(dir, whose, {
      type: "test",
      tag,
      summary: `${id}: A made-up guard, red`,
      body: "Guard test: A_made_up_guard_test",
      ...more,
    });
  }

  // An apply in a chapter's fix round: the state file is committed, finding B-1's guard test is red (its commit
  // carried the state file), a later commit fixed another finding and changed the state file again, and the state
  // file has a change that is not committed. `git revert` of the red commit is refused here.
  async function fixRound(t) {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    const red = await redCommit(dir, withChange, "chapter-review", "B-1", { resume: "Finding B-1: its guard is red." });
    write(dir, "src/App/Mapping.cs", "// the fix of another finding\n");
    await committed(dir, withChange, {
      type: "fix",
      tag: "chapter-review",
      summary: "B-2: Another made-up fix",
      resume: "Finding B-3 is next.",
    });
    const put = await tdd(dir, withChange("put", { section: "Open", key: "Q1", value: "answered: decline B-1" }));
    assert.equal(put.code, 0, put.err);
    return { dir, red };
  }

  const declined = (red, more = {}) =>
    withChange("unguard", {
      tag: "chapter-review",
      id: "B-1",
      red,
      outcome: "declined",
      body: "Declined by the owner: the case cannot happen.",
      ...more,
    });

  // What a refused `unguard` must leave as it was: the last commit, what git reports as changed, the state file
  // and the guard test's two files.
  const stands = async (dir) => ({
    head: (await lastCommit(dir)).sha,
    status: await status(dir),
    state: existsSync(join(dir, STATE)) ? read(dir, STATE) : null,
    guard: existsSync(join(dir, GUARD)) ? read(dir, GUARD) : null,
    tests: read(dir, TESTS),
  });
  const refused = (r, pattern) => {
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, "");
    assert.match(r.err, pattern);
    assert.ok(oneLine(r.err), r.err);
  };

  test("takes the guard test out and leaves the state file alone: its uncommitted change, and what a later commit did to it", async (t) => {
    const { dir, red } = await fixRound(t);
    const before = await stands(dir);
    const revert = await started("git", ["revert", "--no-commit", red], { cwd: dir });
    assert.notEqual(revert.code, 0, "git revert is refused here: the red commit carried the state file");
    assert.deepEqual(await stands(dir), before);

    const r = await tdd(dir, declined(red));

    assert.equal(r.code, 0, r.err);
    const made = await lastCommit(dir);
    assert.equal(
      r.out,
      `${made.sha.slice(0, 7)} test(c900): [chapter-review] B-1: guard removed, declined | reversed ${red} | ` +
        "graph: skipped\n",
    );
    assert.equal(
      made.message,
      "test(c900): [chapter-review] B-1: guard removed, declined\n\nDeclined by the owner: the case cannot happen.",
    );
    assert.deepEqual(made.files, [GUARD, TESTS]);
    assert.equal((await git(dir, "rev-parse", "HEAD~1")).trim(), before.head);
    assert.equal(existsSync(join(dir, GUARD)), false, "the file the red commit added is deleted");
    assert.equal(read(dir, TESTS), "// a test\n", "the file it changed is restored");
    assert.equal(read(dir, STATE), before.state, "the state file keeps every byte");
    assert.equal(sectionBody(before.state, "Resume here"), "Finding B-3 is next.");
    assert.equal(keyValue(before.state, "Open", "Q1"), "answered: decline B-1");
    assert.deepEqual(await status(dir), [` M ${STATE}`]);
    assert.equal(read(dir, "src/App/Mapping.cs"), "// the fix of another finding\n", "the later commit's work stays");
    assert.deepEqual(leftInGitFolder(dir), [], "no lock and no index of its own is left");
  });

  test("with --resume, then writes `Resume here` and commits the state file with the rest, as commit does; with --done, prints the progress line", async (t) => {
    const { dir, red } = await fixRound(t);
    await tdd(dir, withChange("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one" }));
    const before = clock();

    const r = await tdd(
      dir,
      declined(red, { outcome: "deferred", resume: "Finding B-3 is next.\\nB-1 is settled.", done: "Finding B-1" }),
    );

    assert.equal(r.code, 0, r.err);
    const [line, progress, ...rest] = r.out.trimEnd().split("\n");
    assert.match(
      line,
      new RegExp(
        `^[0-9a-f]{7} test\\(c900\\): \\[chapter-review\\] B-1: guard removed, deferred \\| reversed ${red} \\| graph: skipped$`,
      ),
    );
    assert.ok(
      [before, clock()].includes(/^progress: Finding B-1 completed at (\d\d:\d\d)$/.exec(progress)?.[1]),
      r.out,
    );
    assert.deepEqual(rest, []);
    const made = await lastCommit(dir);
    assert.equal(
      made.message,
      "test(c900): [chapter-review] B-1: guard removed, deferred\n\nDeclined by the owner: the case cannot happen.\n\n" +
        "A-Trailer: one",
    );
    assert.deepEqual(made.files, [STATE, GUARD, TESTS].sort());
    const state = read(dir, STATE);
    assert.equal(sectionBody(state, "Resume here"), "Finding B-3 is next.\nB-1 is settled.");
    assert.equal(keyValue(state, "Open", "Q1"), "answered: decline B-1", "what was not committed is, with the rest");
    assert.deepEqual(await status(dir), []);
  });

  test("never reverses what the red commit did to the reviews file and to tasks.md", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter B", line: "B-1: confirmed, to fix" }));
    const red = await redCommit(dir, withChange, "chapter-review", "B-1", { tick: "5.1", resume: "B-1: red." });
    assert.deepEqual((await lastCommit(dir)).files, [REVIEWS, STATE, TASKS, GUARD, TESTS].sort());
    const kept = { reviews: read(dir, REVIEWS), tasks: read(dir, TASKS), state: read(dir, STATE) };

    const r = await tdd(dir, declined(red));

    assert.equal(r.code, 0, r.err);
    assert.deepEqual((await lastCommit(dir)).files, [GUARD, TESTS]);
    assert.deepEqual({ reviews: read(dir, REVIEWS), tasks: read(dir, TASKS), state: read(dir, STATE) }, kept);
    assert.ok(kept.tasks.includes("- [x] 5.1 A balance"));
    assert.deepEqual(await status(dir), []);
  });

  for (const order of ["oldest first", "newest first", "one by one"]) {
    test(`reverses two red commits of one finding, the newest first, whichever order they are given in (${order})`, async (t) => {
      const { dir, red } = await fixRound(t);
      write(dir, GUARD, "// the guard test of a made-up finding, corrected\n");
      write(dir, "tests/App.UnitTests/GuardData.cs", "// what the corrected guard test reads\n");
      const again = await committed(dir, withChange, {
        type: "test",
        tag: "chapter-review",
        summary: "B-1: The guard corrected, red",
        path: [GUARD, "tests/App.UnitTests/GuardData.cs"],
      });
      const given = {
        "oldest first": `${red},${again}`,
        "newest first": `${again}, ${red}`,
        "one by one": [red, again],
      };

      const r = await tdd(dir, declined(given[order]));

      assert.equal(r.code, 0, r.err);
      assert.match(r.out, new RegExp(` \\| reversed ${again}, ${red} \\| graph: skipped\\n$`));
      assert.deepEqual((await lastCommit(dir)).files, ["tests/App.UnitTests/GuardData.cs", GUARD, TESTS].sort());
      assert.equal(existsSync(join(dir, GUARD)), false);
      assert.equal(existsSync(join(dir, "tests/App.UnitTests/GuardData.cs")), false);
      assert.equal(read(dir, TESTS), "// a test\n");
      assert.deepEqual(await status(dir), [` M ${STATE}`]);
    });
  }

  test("names a commit once when it is given twice, by its short and by its whole hash", async (t) => {
    const { dir, red } = await fixRound(t);
    const whole = (await git(dir, "rev-parse", red)).trim();

    const r = await tdd(dir, declined([red, whole, red.toUpperCase()]));

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(` \\| reversed ${red} \\| graph: skipped\\n$`));
  });

  test("leaves whatever else is changed or staged as it is", async (t) => {
    const { dir, red } = await fixRound(t);
    write(dir, "src/App/Other.cs", "// someone's work in progress\n");
    write(dir, "src/App/Staged.cs", "// staged by someone before\n");
    await git(dir, "add", "src/App/Staged.cs");
    write(dir, "src/App/Mapping.cs", "// the fix of another finding, being changed\n");

    const r = await tdd(dir, declined(red));

    assert.equal(r.code, 0, r.err);
    assert.deepEqual((await lastCommit(dir)).files, [GUARD, TESTS]);
    assert.deepEqual(await status(dir), [
      ` M ${STATE}`,
      " M src/App/Mapping.cs",
      "A  src/App/Staged.cs",
      "?? src/App/Other.cs",
    ]);
  });

  test("restores a file that is no text byte for byte, and one whose line breaks git converts", async (t) => {
    const dir = await initialized(t);
    await git(dir, "config", "core.autocrlf", "true");
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0d, 0x0a, 0x0a, 0x0d, 0xc3, 0x28]);
    writeFileSync(join(dir, "tests/App.UnitTests/Sample.bin"), bytes);
    write(dir, "tests/App.UnitTests/Windows.cs", "// one\r\n// two\r\n// three\r\n");
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and two files" });
    writeFileSync(join(dir, "tests/App.UnitTests/Sample.bin"), Buffer.from([0x00, 0xff, 0x80, 0x0a]));
    writeFileSync(join(dir, "tests/App.UnitTests/Added.bin"), Buffer.from([0x80, 0x00, 0xfe]));
    write(dir, "tests/App.UnitTests/Windows.cs", "// one\r\n// two, changed\r\n// three\r\n// four\r\n");
    const red = await committed(dir, withChange, { type: "test", tag: "chapter-review", summary: "B-1: A guard, red" });

    const r = await tdd(dir, declined(red));

    assert.equal(r.code, 0, r.err);
    assert.deepEqual(readFileSync(join(dir, "tests/App.UnitTests/Sample.bin")), bytes);
    assert.equal(existsSync(join(dir, "tests/App.UnitTests/Added.bin")), false);
    assert.equal(read(dir, "tests/App.UnitTests/Windows.cs"), "// one\r\n// two\r\n// three\r\n");
    assert.deepEqual(await status(dir), []);
  });

  for (const of of ["change", "none"]) {
    test(`works in a triage, for a merged group's id, and leaves the triage's state file alone (${of})`, async (t) => {
      const { dir, state } = await triaging(t, of);
      await tdd(dir, withPr("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one" }));
      const red = await redCommit(dir, withPr, "review", "3, 7", { resume: "Findings 3, 7: the guard is red." });
      write(dir, "src/App/Mapping.cs", "// the fix of another finding\n");
      await committed(dir, withPr, {
        type: "fix",
        tag: "review",
        summary: "4: Another made-up fix",
        resume: "5 is next.",
      });
      await tdd(dir, withPr("put", { section: "Round 1", key: "3, 7", value: "src/a.cs:19 · A title · blocked, Q1" }));
      const before = readFileSync(state, "utf8");

      const r = await tdd(
        dir,
        withPr("unguard", {
          tag: "review",
          id: "3, 7",
          red,
          outcome: "deferred",
          body: "Deferred to #123",
          done: "Finding 3, 7",
        }),
      );

      assert.equal(r.code, 0, r.err);
      const scope = of === "change" ? "c900" : "i900";
      const made = await lastCommit(dir);
      assert.match(
        r.out,
        new RegExp(
          `^${made.sha.slice(0, 7)} test\\(${scope}\\): \\[review\\] 3, 7: guard removed, deferred \\| reversed ${red} \\| ` +
            "graph: skipped\\nprogress: Finding 3, 7 completed at \\d\\d:\\d\\d\\n$",
        ),
      );
      assert.equal(
        made.message,
        `test(${scope}): [review] 3, 7: guard removed, deferred\n\nDeferred to #123\n\nA-Trailer: one`,
      );
      assert.deepEqual(made.files, [GUARD, TESTS]);
      assert.equal(existsSync(join(dir, GUARD)), false);
      assert.equal(read(dir, TESTS), "// a test\n");
      assert.equal(readFileSync(state, "utf8"), before, "the triage's state file keeps every byte");
      assert.deepEqual(await status(dir), of === "change" ? [` M ${TRIAGE}`] : []);
    });
  }

  test("in a triage, --resume writes the triage's `Resume here`, and commits its state file only when that is the working tree's", async (t) => {
    for (const of of ["change", "none"]) {
      const { dir, state } = await triaging(t, of);
      const red = await redCommit(dir, withPr, "review", "3");

      const r = await tdd(
        dir,
        withPr("unguard", {
          tag: "[review]",
          id: "3",
          red,
          outcome: "declined",
          body: "Declined by the owner: no.",
          resume: "Finding 4 is next.",
        }),
      );

      assert.equal(r.code, 0, r.err);
      assert.equal(sectionBody(readFileSync(state, "utf8"), "Resume here"), "Finding 4 is next.");
      assert.deepEqual((await lastCommit(dir)).files, of === "change" ? [TRIAGE, GUARD, TESTS].sort() : [GUARD, TESTS]);
      assert.deepEqual(await status(dir), []);
    }
  });

  describe("refuses, in one line, with nothing changed", { concurrency: true }, () => {
    test("a commit that is not a red commit of that tag and id", async (t) => {
      const { dir, red } = await fixRound(t);
      const fix = await short(dir);
      write(dir, "tests/App.UnitTests/OtherGuardTests.cs", "// the guard test of another finding\n");
      const other = await committed(dir, withChange, {
        type: "test",
        tag: "chapter-review",
        summary: "B-3: Another guard, red",
        path: "tests/App.UnitTests/OtherGuardTests.cs",
      });
      const before = await stands(dir);
      const not = (hash, subject, tag = "chapter-review", id = "B-1") =>
        new RegExp(
          `^ERROR: nothing was changed: --red ${hash} is not a red commit of finding ${id} with the tag ${tag}; ` +
            `its subject is "${subject}"\\n$`,
        );

      refused(
        await tdd(dir, declined(other)),
        not(other, "test\\(c900\\): \\[chapter-review\\] B-3: Another guard, red"),
      );
      refused(await tdd(dir, declined(fix)), not(fix, "fix\\(c900\\): \\[chapter-review\\] B-2: Another made-up fix"));
      refused(await tdd(dir, declined([red, other])), not(other, ".+"));
      refused(await tdd(dir, declined(red, { tag: "review" })), not(red, ".+", "review"));
      refused(await tdd(dir, declined(red, { id: "B-10" })), not(red, ".+", "chapter-review", "B-10"));
      refused(await tdd(dir, declined(red, { id: "B" })), not(red, ".+", "chapter-review", "B"));
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(leftInGitFolder(dir), []);
    });

    test("a hash that names no commit, something that is no hash, and a commit of another branch", async (t) => {
      const { dir, red } = await fixRound(t);
      // A red commit of the same finding that the branch does not hold: made on `main`, with no checkout.
      const subject = "test(c900): [chapter-review] B-1: A guard elsewhere, red";
      const elsewhere = (await git(dir, "commit-tree", "HEAD^{tree}", "-p", "main", "-m", subject)).trim().slice(0, 7);
      const before = await stands(dir);
      const names = (name) =>
        new RegExp(
          `^ERROR: nothing was changed: --red ${name} names no commit; give each red commit's hash, as commit ` +
            "printed it\\n$",
        );

      refused(await tdd(dir, declined("0123abc")), names("0123abc"));
      refused(await tdd(dir, declined("HEAD~1")), names("HEAD~1"));
      refused(await tdd(dir, declined(`${red},main`)), names("main"));
      refused(
        await tdd(dir, declined(elsewhere)),
        new RegExp(`^ERROR: nothing was changed: --red ${elsewhere} is not a commit of the current branch\\n$`),
      );
      assert.deepEqual(await stands(dir), before);
    });

    test("a red commit that changed nothing but the bookkeeping's own files", async (t) => {
      const dir = await initialized(t);
      await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
      await tdd(dir, withChange("add", { file: "reviews", section: "Chapter B", line: "B-1: confirmed" }));
      const empty = await committed(dir, withChange, {
        type: "test",
        tag: "chapter-review",
        summary: "B-1: Nothing but the records, red",
        tick: "5.1",
        resume: "B-1: red.",
      });
      const red = await redCommit(dir, withChange, "chapter-review", "B-1");
      const before = await stands(dir);

      const r = await tdd(dir, declined([red, empty]));

      refused(
        r,
        new RegExp(
          `^ERROR: nothing was changed: --red ${empty} holds no guard test; it changed only the bookkeeping's own ` +
            "files \\(the state file, the reviews file, tasks\\.md\\), which are never reversed\\n$",
        ),
      );
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(leftInGitFolder(dir), []);
    });

    test("a reverse that does not apply cleanly: a later commit changed the guard test", async (t) => {
      const { dir, red } = await fixRound(t);
      write(dir, GUARD, "// the guard test of a made-up finding, changed by a later commit\n");
      await committed(dir, withChange, {
        type: "test",
        tag: "chapter-review",
        summary: "B-4: A test reworked",
        path: GUARD,
      });
      const before = await stands(dir);

      const r = await tdd(dir, declined(red));

      refused(
        r,
        new RegExp(
          `^ERROR: nothing was changed: the reverse of ${red} does not apply cleanly; git says: .*GuardTests\\.cs.*\\n$`,
        ),
      );
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(leftInGitFolder(dir), []);
    });

    test("a reverse that does not apply cleanly: the guard test has uncommitted changes, or a file it would bring back is there", async (t) => {
      const { dir, red } = await fixRound(t);
      write(dir, GUARD, "// the guard test of a made-up finding, being edited\n");
      const edited = await stands(dir);

      const dirty = await tdd(dir, declined(red));

      refused(
        dirty,
        new RegExp(
          `^ERROR: nothing was changed: the reverse does not apply cleanly; uncommitted changes in ${GUARD}\\n$`,
        ),
      );
      assert.deepEqual(await stands(dir), edited);

      await git(dir, "checkout", "--", GUARD);
      await git(dir, "rm", "--quiet", "src/App/Mapping.cs");
      const back = await committed(dir, withChange, {
        type: "test",
        tag: "chapter-review",
        summary: "B-5: A file removed, red",
      });
      write(dir, "src/App/Mapping.cs", "// written anew, and not committed\n");
      const untracked = await stands(dir);

      const there = await tdd(dir, declined(back, { id: "B-5" }));

      refused(
        there,
        /^ERROR: nothing was changed: the reverse does not apply cleanly; uncommitted changes in src\/App\/Mapping\.cs\n$/,
      );
      assert.deepEqual(await stands(dir), untracked);
      assert.equal(read(dir, "src/App/Mapping.cs"), "// written anew, and not committed\n");
    });

    test("a call without its options, an outcome it does not know, and a text that the state file cannot hold", async (t) => {
      const { dir, red } = await fixRound(t);
      const before = await stands(dir);
      const all = { tag: "chapter-review", id: "B-1", red, outcome: "declined", body: "Declined by the owner: no." };
      const without = (name, more = {}) => withChange("unguard", { ...all, [name]: [], ...more });

      for (const [args, message] of [
        [without("red"), "unguard needs --red <commit>[,<commit>...]: the hashes of the finding's red commits"],
        [
          without("red", { red: " , " }),
          "unguard needs --red <commit>[,<commit>...]: the hashes of the finding's red commits",
        ],
        [without("id"), "unguard needs --id <id>: the finding's id, as its red commits' summaries start with it"],
        [
          without("id", { id: " " }),
          "unguard needs --id <id>: the finding's id, as its red commits' summaries start with it",
        ],
        [without("outcome"), "--outcome is one of: declined, deferred"],
        [without("outcome", { outcome: "refuted" }), "--outcome is one of: declined, deferred"],
        [
          without("body"),
          'unguard needs --body <text>: the outcome in one line, such as "Declined by the owner: <the reason>"',
        ],
        [without("tag"), "--tag is the step's name, such as red, green, wire or close"],
        [
          without("done", { done: " " }),
          "--done is the step's name on one line, such as Baseline or Chapter B, slice 3",
        ],
        [without("resume", { resume: "Next.\\n## Sneaky" }), null],
      ]) {
        const r = await tdd(dir, args);

        assert.equal(r.code, 1, args.join(" "));
        assert.equal(r.out, "");
        if (message !== null) assert.equal(r.err, `ERROR: ${message}\n`);
        assert.ok(oneLine(r.err), r.err);
      }
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(leftInGitFolder(dir), []);
    });

    test("on main, as commit is, in the words of whose branch it is", async (t) => {
      const dir = repository(t);
      await git(dir, "checkout", "--quiet", "main");
      const triage = await triaging(t, "none");
      await git(triage.dir, "checkout", "--quiet", "main");

      const apply = await tdd(dir, declined("0123abc"));
      const pr = await tdd(
        triage.dir,
        withPr("unguard", { tag: "review", id: "3", red: "0123abc", outcome: "declined", body: "x" }),
      );

      assert.equal(apply.err, "ERROR: unguard works on the change's branch, and this is main\n");
      assert.equal(pr.err, "ERROR: unguard works on the PR's branch, and this is main\n");
    });

    test("when git refuses the commit, here a hook: the guard test is put back, and `Resume here` too", async (t) => {
      const { dir, red } = await fixRound(t);
      write(dir, ".git/hooks/commit-msg", "#!/bin/sh\necho 'made-up hook: the message is refused' >&2\nexit 1\n");
      chmodSync(join(dir, ".git/hooks/commit-msg"), 0o755);
      const before = await stands(dir);

      const r = await tdd(dir, declined(red, { resume: "B-1 is settled." }));

      refused(
        r,
        /^ERROR: nothing was changed: no commit was made; git commit failed: .*made-up hook: the message is refused/,
      );
      assert.deepEqual(await stands(dir), before);
      assert.equal(sectionBody(read(dir, STATE), "Resume here"), "Finding B-3 is next.");
      assert.deepEqual(leftInGitFolder(dir), []);

      rmSync(join(dir, ".git/hooks/commit-msg"));
      const again = await tdd(dir, declined(red, { resume: "B-1 is settled." }));
      assert.equal(again.code, 0, `it can be run again: ${again.err}`);
    });
  });
});

describe("shelve and unshelve", { concurrency: true }, () => {
  const APP = "src/App/Mapping.cs";
  const TESTS = "tests/App.UnitTests/MappingTests.cs";
  const DRIVER = "tests/RevolutReader.AcceptanceTests/Drivers/FakeBank.cs";
  const NEW = "src/App/Parked/Half.cs";
  const shelvedRef = (key, account = CHANGE) => `refs/worktree/tdd/shelved/${account}/${key}`;
  const shelvedRefs = async (dir) =>
    (await git(dir, "for-each-ref", "--format=%(refname)", "refs/worktree/")).split("\n").filter(Boolean);
  const shelve = (dir, key, whose = withChange, how) => tdd(dir, whose("shelve", { key }), how);
  const unshelve = (dir, key, more = {}, whose = withChange, how) => tdd(dir, whose("unshelve", { key, ...more }), how);

  async function committed(dir, whose, options) {
    const r = await tdd(dir, whose("commit", options));
    assert.equal(r.code, 0, r.err);
  }

  // An apply with its state file committed, in the middle of a task: a changed file, a new one in a new folder and
  // a deleted one.
  async function midTask(t) {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    write(dir, APP, "// production code\n// half a task\n");
    write(dir, NEW, "// a new file of the task\n");
    rmSync(join(dir, DRIVER));
    return dir;
  }

  // Every file of the working tree with its bytes. (Not the folders: git knows none, and a folder that a deleted
  // file leaves empty goes with it.)
  function workingFiles(dir, folder = "") {
    return readdirSync(join(dir, folder), { withFileTypes: true })
      .filter((entry) => entry.name !== ".git")
      .flatMap((entry) => {
        const path = folder ? `${folder}/${entry.name}` : entry.name;
        return entry.isDirectory()
          ? workingFiles(dir, path)
          : [`${path} ${readFileSync(join(dir, path)).toString("base64")}`];
      })
      .sort();
  }

  // What a refused command must leave as it was, and what a put-back must bring back: the last commit, what git
  // reports as changed, the real index, the stash, the shelved work, and every file of the working tree.
  const stands = async (dir) => ({
    head: (await lastCommit(dir)).sha,
    status: await status(dir),
    index: await git(dir, "ls-files", "--stage"),
    stash: await git(dir, "stash", "list"),
    shelved: await shelvedRefs(dir),
    files: workingFiles(dir),
  });
  const refused = (r, message) => {
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, "");
    if (typeof message === "string") assert.equal(r.err, `ERROR: ${message}\n`);
    else assert.match(r.err, message);
    assert.ok(oneLine(r.err), r.err);
  };

  test("shelve sets aside a changed, a new and a deleted file, and takes the tree back to the last commit", async (t) => {
    const dir = await midTask(t);
    const before = await stands(dir);
    assert.deepEqual(before.status, [` M ${APP}`, ` D ${DRIVER}`, `?? ${NEW}`]);

    const r = await shelve(dir, "Q2");

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "shelved Q2: 3 files\n");
    const after = await stands(dir);
    assert.deepEqual(after.status, [], "the tree is the last commit again");
    assert.equal(read(dir, APP), "// production code\n");
    assert.equal(read(dir, DRIVER), "// a driver\n");
    assert.equal(existsSync(join(dir, "src/App/Parked")), false, "the new file is gone, and the folder it left empty");
    assert.deepEqual(
      { head: after.head, index: after.index, stash: after.stash },
      { head: before.head, index: before.index, stash: "" },
    );
    assert.deepEqual(after.shelved, [shelvedRef("Q2")]);
    assert.equal(
      (await git(dir, "rev-parse", `${shelvedRef("Q2")}^`)).trim(),
      before.head,
      "a commit on the last commit",
    );
    assert.deepEqual(
      (await git(dir, "diff", "--name-status", "--no-renames", "HEAD", shelvedRef("Q2"))).trim().split("\n"),
      [`M\t${APP}`, `A\t${NEW}`, `D\t${DRIVER}`],
    );
    assert.equal((await git(dir, "branch", "--contains", shelvedRef("Q2"))).trim(), "", "no branch holds it");
    assert.deepEqual(leftInGitFolder(dir), [], "no lock and no index of its own is left");
  });

  test("unshelve puts the work back as it was: the new file untracked, the deleted file deleted, nothing staged", async (t) => {
    const dir = await midTask(t);
    const before = await stands(dir);
    await shelve(dir, "Q2");

    const r = await unshelve(dir, "Q2");

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "put back Q2: 3 files\n");
    assert.deepEqual(await stands(dir), before);
    assert.deepEqual(leftInGitFolder(dir), []);
  });

  test("a git that writes to stderr as it works (GIT_TRACE=1) changes nothing: shelve, unshelve and unshelve --drop find the keys and the work as without it", async (t) => {
    const dir = await midTask(t);
    const traced = { env: { GIT_TRACE: "1" } };

    const answers = [
      await shelve(dir, "Q2", withChange, traced),
      await unshelve(dir, "Q2", {}, withChange, traced),
      await shelve(dir, "Q3", withChange, traced),
      await unshelve(dir, "Q3", { drop: true }, withChange, traced),
    ];

    assert.deepEqual(
      answers.map(({ code, out, err }) => ({ code, out, err })),
      [
        { code: 0, out: "shelved Q2: 3 files\n", err: "" },
        { code: 0, out: "put back Q2: 3 files\n", err: "" },
        { code: 0, out: "shelved Q3: 3 files\n", err: "" },
        { code: 0, out: "dropped Q3: 3 files\n", err: "" },
      ],
    );
    assert.deepEqual(await status(dir), [], "the work is thrown away");
    assert.deepEqual(await shelvedRefs(dir), []);
  });

  test("neither ever touches the state file, the reviews file or tasks.md, changed or new as they are", async (t) => {
    const dir = await midTask(t);
    await tdd(dir, withChange("put", { section: "Open", key: "Q2", value: "a question for the owner | shelved: Q2" }));
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));
    write(dir, TASKS, TASKS_TEXT.replace("- [ ] 5.1", "- [x] 5.1"));
    const books = () => [STATE, REVIEWS, TASKS].map((path) => readFileSync(join(dir, path)).toString("base64"));
    const before = books();

    const set = await shelve(dir, "Q2");

    assert.equal(set.out, "shelved Q2: 3 files\n", "the three files of the task, none of the bookkeeping's");
    assert.deepEqual(books(), before);
    assert.deepEqual(await status(dir), [` M ${STATE}`, ` M ${TASKS}`, `?? ${REVIEWS}`]);
    const inCommit = await git(dir, "diff", "--name-only", "HEAD", shelvedRef("Q2"));
    for (const path of [STATE, REVIEWS, TASKS]) assert.equal(inCommit.includes(path), false, path);

    // The next task: the bookkeeping moves on and is committed, then the answer comes and the work goes back.
    write(dir, TESTS, "// a test\n// the next task's test\n");
    await committed(dir, withChange, {
      type: "test",
      tag: "red",
      summary: "The next task, red",
      tick: "5.2",
      resume: "Task 5.2 is red.",
    });
    await tdd(dir, withChange("put", { section: "Open", key: "Q2", value: "answered: go on | still to do: put back" }));
    const later = books();

    const back = await unshelve(dir, "Q2");

    assert.equal(back.out, "put back Q2: 3 files\n");
    assert.deepEqual(books(), later, "what was recorded since stays, byte for byte");
    assert.equal(read(dir, APP), "// production code\n// half a task\n");
    assert.equal(read(dir, TESTS), "// a test\n// the next task's test\n", "the commit made since stays");
    assert.deepEqual(await status(dir), [` M ${STATE}`, ` M ${APP}`, ` D ${DRIVER}`, `?? ${NEW}`]);
  });

  test("unshelve merges the work with a later commit in the same file, when the two changed lines apart", async (t) => {
    const dir = await initialized(t);
    const lines = Array.from({ length: 12 }, (_, i) => `// line ${i + 1}`);
    write(dir, APP, `${lines.join("\n")}\n`);
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "A longer file" });
    write(dir, APP, `${["// line 1, half a task", ...lines.slice(1)].join("\n")}\n`);
    await shelve(dir, "Q1");
    write(dir, APP, `${[...lines.slice(0, 11), "// line 12, the next task"].join("\n")}\n`);
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "The next task" });

    const r = await unshelve(dir, "Q1");

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "put back Q1: 1 file\n");
    assert.equal(
      read(dir, APP),
      `${["// line 1, half a task", ...lines.slice(1, 11), "// line 12, the next task"].join("\n")}\n`,
    );
    assert.deepEqual(await status(dir), [` M ${APP}`]);
    assert.deepEqual(await shelvedRefs(dir), []);
  });

  test("unshelve is refused when a later commit changed the same lines, names the file, and changes nothing", async (t) => {
    const dir = await midTask(t);
    await shelve(dir, "Q2");
    write(dir, APP, "// production code\n// the next task wrote here\n");
    write(dir, TESTS, "// a test\n// more\n");
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "The next task" });
    const before = await stands(dir);

    const r = await unshelve(dir, "Q2");

    refused(
      r,
      `nothing was changed: the work shelved under Q2 does not go back cleanly: what was committed since changed the same lines in ${APP}`,
    );
    assert.deepEqual(await stands(dir), before);
    assert.deepEqual(before.shelved, [shelvedRef("Q2")], "the work is still kept");
    assert.deepEqual(leftInGitFolder(dir), []);
  });

  test("unshelve is refused when the working tree holds an uncommitted change or another file where the work goes", async (t) => {
    for (const [name, obstacle, blocked] of [
      ["a changed file of the work", (dir) => write(dir, APP, "// production code\n// someone else's line\n"), APP],
      ["another file where the new one goes", (dir) => write(dir, NEW, "// not the task's file\n"), NEW],
      ["a folder where the new file goes", (dir) => write(dir, `${NEW}/inner.cs`, "// x\n"), `${NEW}, ${NEW}/inner.cs`],
      [
        "a file where the new file's folder goes",
        (dir) => write(dir, "src/App/Parked", "a file\n"),
        `src/App/Parked, ${NEW}`,
      ],
      ["the deleted file, deleted already", (dir) => rmSync(join(dir, DRIVER)), DRIVER],
    ]) {
      const dir = await midTask(t);
      await shelve(dir, "Q2");
      obstacle(dir);
      const before = await stands(dir);

      const r = await unshelve(dir, "Q2");

      refused(
        r,
        "nothing was changed: the work shelved under Q2 does not go back cleanly: the working tree holds " +
          `uncommitted changes or other files in ${blocked}`,
      );
      assert.deepEqual(await stands(dir), before, name);
    }
  });

  test("unshelve takes a new file that already stands there with the same content as no obstacle", async (t) => {
    const dir = await midTask(t);
    const before = await stands(dir);
    await shelve(dir, "Q2");
    write(dir, NEW, "// a new file of the task\n");

    const r = await unshelve(dir, "Q2");

    assert.equal(r.out, "put back Q2: 3 files\n");
    assert.deepEqual(await stands(dir), before);
  });

  test("unshelve is refused while the working tree holds any other uncommitted change but in the bookkeeping's files, and --drop is not", async (t) => {
    const dir = await midTask(t);
    await shelve(dir, "Q2");
    write(dir, TESTS, "// a test\n// another task, parked too\n");
    await shelve(dir, "Q3");
    // Work of no shelved task, in none of the work's paths: a changed file, a deleted one and a new one.
    const EDGE = "tests/RevolutReader.IntegrationTests/Wiring/EdgeCases.cs";
    write(dir, TESTS, "// a test\n// the task in hand\n");
    rmSync(join(dir, EDGE));
    write(dir, "src/Other/Fresh.cs", "// the task in hand's new file\n");
    const before = await stands(dir);

    const back = await unshelve(dir, "Q2");

    refused(
      back,
      "nothing was changed: the work shelved under Q2 does not go back cleanly: the working tree holds " +
        `uncommitted changes or other files in src/Other/Fresh.cs, ${TESTS}, ${EDGE}`,
    );
    assert.deepEqual(await stands(dir), before, "the other work is left as it is, and the work still kept");

    const dropped = await unshelve(dir, "Q3", { drop: true });

    assert.equal(
      dropped.out,
      "dropped Q3: 1 file\n",
      "throwing work away writes no file, so other work is no obstacle",
    );
    assert.deepEqual(await stands(dir), { ...before, shelved: [shelvedRef("Q2")] });

    // The other work committed at its handoff, as the runner does: only the bookkeeping's files are changed then.
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "The task in hand" });
    await tdd(dir, withChange("put", { section: "Open", key: "Q2", value: "answered: go on" }));
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));

    const again = await unshelve(dir, "Q2");

    assert.equal(again.out, "put back Q2: 3 files\n", again.err);
    assert.deepEqual(await status(dir), [` M ${STATE}`, ` M ${APP}`, ` D ${DRIVER}`, `?? ${REVIEWS}`, `?? ${NEW}`]);
  });

  test("keeps a file that is no text byte for byte, and writes one whose line breaks git converts as git checks it out", async (t) => {
    const dir = await initialized(t);
    await git(dir, "config", "core.autocrlf", "true");
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x0d, 0x0a, 0x0a, 0x0d, 0xc3, 0x28]);
    writeFileSync(join(dir, "src/App/Sample.bin"), bytes);
    write(dir, "src/App/Windows.cs", "// one\r\n// two\r\n// three\r\n");
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and two files" });
    const changed = Buffer.from([0x00, 0xff, 0x80, 0x0a, 0x0d, 0x0d, 0x0a]);
    const added = Buffer.from([0x80, 0x00, 0xfe, 0x0d, 0x0a]);
    writeFileSync(join(dir, "src/App/Sample.bin"), changed);
    writeFileSync(join(dir, "src/App/Added.bin"), added);
    write(dir, "src/App/Windows.cs", "// one\r\n// two, changed\r\n// three\r\n// four\r\n");
    write(dir, "src/App/NewWindows.cs", "// new\r\n// file\r\n");
    const before = await stands(dir);

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 4 files\n");
    assert.deepEqual(readFileSync(join(dir, "src/App/Sample.bin")), bytes);
    assert.equal(read(dir, "src/App/Windows.cs"), "// one\r\n// two\r\n// three\r\n");
    assert.deepEqual(await status(dir), []);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 4 files\n");
    assert.deepEqual(readFileSync(join(dir, "src/App/Sample.bin")), changed);
    assert.deepEqual(readFileSync(join(dir, "src/App/Added.bin")), added);
    assert.equal(read(dir, "src/App/Windows.cs"), "// one\r\n// two, changed\r\n// three\r\n// four\r\n");
    assert.equal(read(dir, "src/App/NewWindows.cs"), "// new\r\n// file\r\n");
    assert.deepEqual(await stands(dir), before);
  });

  test("leaves ignored files alone, in the tree and out of the shelved work", async (t) => {
    const dir = await initialized(t);
    write(dir, ".gitignore", "bin/\n*.log\n");
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and what git ignores" });
    write(dir, "src/App/bin/App.dll", "a build's output\n");
    write(dir, "run.log", "a log\n");
    write(dir, APP, "// production code\n// half a task\n");

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 1 file\n");
    assert.equal(read(dir, "src/App/bin/App.dll"), "a build's output\n");
    assert.equal(read(dir, "run.log"), "a log\n");
    const kept = await git(dir, "ls-tree", "-r", "--name-only", shelvedRef("Q1"));
    assert.equal(/App\.dll|run\.log/.test(kept), false, kept);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 1 file\n");
    assert.equal(read(dir, "src/App/bin/App.dll"), "a build's output\n");
  });

  test("sets aside a change to a tracked file that a rule of .gitignore covers, in its folder or by its name", async (t) => {
    const dir = await initialized(t);
    write(dir, ".gitignore", "/tests/App.UnitTests/\nFakeBank.cs\n");
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and what git ignores" });
    write(dir, TESTS, "// a test\n// half a task\n");
    write(dir, DRIVER, "// a driver\n// half a task\n");
    const before = await stands(dir);
    assert.deepEqual(before.status, [` M ${TESTS}`, ` M ${DRIVER}`], "git tracks both all the same");

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 2 files\n", set.err);
    assert.deepEqual(await status(dir), []);
    assert.equal((await unshelve(dir, "Q1")).out, "put back Q1: 2 files\n");
    assert.deepEqual(await stands(dir), before);
  });

  test("takes what was staged as it stands in the working tree, puts it back unstaged, and never touches the stash", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    write(dir, TESTS, "// a test\n// someone's stash\n");
    await git(dir, "stash", "push", "--quiet", "-m", "someone's stash");
    const stash = await git(dir, "stash", "list");
    write(dir, APP, "// production code\n// staged, then changed again\n");
    await git(dir, "add", APP);
    write(dir, APP, "// production code\n// half a task\n");
    write(dir, NEW, "// a new file, staged\n");
    await git(dir, "add", NEW);
    write(dir, "src/App/Gone.cs", "// staged, then deleted\n");
    await git(dir, "add", "src/App/Gone.cs");
    rmSync(join(dir, "src/App/Gone.cs"));

    const set = await shelve(dir, "Q1");

    assert.equal(set.code, 0, set.err);
    assert.equal(set.out, "shelved Q1: 2 files\n");
    assert.deepEqual(await status(dir), [], "the index is the last commit's too");
    assert.equal(await git(dir, "stash", "list"), stash);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 2 files\n");
    assert.equal(read(dir, APP), "// production code\n// half a task\n");
    assert.deepEqual(await status(dir), [` M ${APP}`, `?? ${NEW}`], "nothing is staged");
    assert.equal(await git(dir, "stash", "list"), stash);
  });

  test("unshelve --drop throws the work away and leaves the tree as it is", async (t) => {
    const dir = await midTask(t);
    await shelve(dir, "Q2");
    const before = await stands(dir);

    const r = await unshelve(dir, "Q2", { drop: true });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, "dropped Q2: 3 files\n");
    assert.deepEqual(await stands(dir), { ...before, shelved: [] });
    refused(
      await unshelve(dir, "Q2"),
      "nothing was changed: no shelved work under the key Q2; no key holds shelved work",
    );
  });

  test("keeps the work of several keys apart, and names the keys that hold some when it refuses one", async (t) => {
    const dir = await midTask(t);
    assert.equal((await shelve(dir, "Q1")).out, "shelved Q1: 3 files\n");
    write(dir, TESTS, "// a test\n// another task, parked too\n");
    assert.equal((await shelve(dir, "Q2")).out, "shelved Q2: 1 file\n");
    const before = await stands(dir);

    const unknown = await unshelve(dir, "Q3");

    refused(unknown, "nothing was changed: no shelved work under the key Q3; the keys with shelved work: Q1, Q2");
    assert.deepEqual(await stands(dir), before);
    assert.equal((await unshelve(dir, "Q2")).out, "put back Q2: 1 file\n");
    refused(
      await unshelve(dir, "Q1"),
      "nothing was changed: the work shelved under Q1 does not go back cleanly: the working tree holds uncommitted " +
        `changes or other files in ${TESTS}`,
    );
    await committed(dir, withChange, { type: "test", tag: "red", summary: "The work of Q2, done" });
    assert.equal((await unshelve(dir, "Q1")).out, "put back Q1: 3 files\n");
    assert.deepEqual(await status(dir), [` M ${APP}`, ` D ${DRIVER}`, `?? ${NEW}`]);
    assert.equal(read(dir, TESTS), "// a test\n// another task, parked too\n");
    assert.deepEqual(await shelvedRefs(dir), []);
  });

  test("puts back nothing when the last commit holds the work already, and forgets the key", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    write(dir, APP, "// production code\n// half a task\n");
    await shelve(dir, "Q1");
    write(dir, APP, "// production code\n// half a task\n");
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "The same work, done again" });

    const r = await unshelve(dir, "Q1");

    assert.equal(r.out, "put back Q1: 0 files\n");
    assert.deepEqual(await status(dir), []);
    assert.deepEqual(await shelvedRefs(dir), []);
  });

  test("puts the work back onto a branch that was rewritten since, where git can (2.40), and refuses in one line where it cannot", async (t) => {
    const dir = await midTask(t);
    await shelve(dir, "Q2");
    write(dir, TESTS, "// a test\n// amended into the last commit\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "--amend", "--no-edit");
    const before = await stands(dir);
    const [, major, minor] = /(\d+)\.(\d+)/.exec(await git(dir, "--version")).map(Number);

    const r = await unshelve(dir, "Q2");

    if (major > 2 || minor >= 40) {
      assert.equal(r.out, "put back Q2: 3 files\n", r.err);
      assert.equal(read(dir, APP), "// production code\n// half a task\n");
      assert.deepEqual(await status(dir), [` M ${APP}`, ` D ${DRIVER}`, `?? ${NEW}`]);
    } else {
      refused(
        r,
        /^ERROR: nothing was changed: git merge-tree failed \(unshelve needs git 2\.40 or later once the branch /,
      );
      assert.deepEqual(await stands(dir), before);
    }
  });

  for (const of of ["change", "none"]) {
    test(`works in a triage, whose keys are its own, and leaves the triage's state file alone (${of})`, async (t) => {
      const { dir, state } = await triaging(t, of);
      if (of === "change")
        await committed(dir, withPr, { type: "docs", tag: "review", summary: "The triage's state file" });
      await tdd(dir, withPr("put", { section: "Open", key: "Q1", value: "a question | shelved: Q1" }));
      write(dir, APP, "// production code\n// half a fix\n");
      write(dir, NEW, "// a new file of the fix\n");
      const before = readFileSync(state, "utf8");

      const set = await shelve(dir, "Q1", withPr);

      assert.equal(set.code, 0, set.err);
      assert.equal(set.out, "shelved Q1: 2 files\n");
      assert.deepEqual(await shelvedRefs(dir), [shelvedRef("Q1", `triage-${PR}`)]);
      assert.equal(readFileSync(state, "utf8"), before);
      assert.deepEqual(await status(dir), of === "change" ? [` M ${TRIAGE}`] : []);

      const back = await unshelve(dir, "Q1", {}, withPr);

      assert.equal(back.out, "put back Q1: 2 files\n");
      assert.equal(readFileSync(state, "utf8"), before);
      assert.equal(read(dir, APP), "// production code\n// half a fix\n");
      assert.equal(read(dir, NEW), "// a new file of the fix\n");
    });
  }

  test("an apply's key and a triage's of the same name in one working tree do not meet", async (t) => {
    const { dir } = await triaging(t, "none");
    assert.equal((await tdd(dir, withChange("init", SWITCHES))).code, 0);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    write(dir, APP, "// production code\n// the apply's half\n");
    assert.equal((await shelve(dir, "Q1")).out, "shelved Q1: 1 file\n");
    write(dir, TESTS, "// a test\n// the triage's half\n");

    const ofTriage = await shelve(dir, "Q1", withPr);
    const unknown = await unshelve(dir, "Q2", {}, withPr);

    assert.equal(ofTriage.out, "shelved Q1: 1 file\n");
    assert.deepEqual(await shelvedRefs(dir), [shelvedRef("Q1"), shelvedRef("Q1", `triage-${PR}`)]);
    refused(unknown, "nothing was changed: no shelved work under the key Q2; the keys with shelved work: Q1");
    assert.equal((await unshelve(dir, "Q1", {}, withPr)).out, "put back Q1: 1 file\n");
    assert.deepEqual(await status(dir), [` M ${TESTS}`], "the triage's work, not the apply's");
    await committed(dir, withPr, { type: "test", tag: "review", summary: "1: the triage's half" });
    assert.equal((await unshelve(dir, "Q1")).out, "put back Q1: 1 file\n");
    assert.deepEqual(await status(dir), [` M ${APP}`], "the apply's work");
  });

  test("keeps the work in the working tree's own git folder: another working tree of the repository does not see it", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    const linked = join(tempFolder(t), "linked");
    await git(dir, "worktree", "add", "--quiet", "-b", "feat/c900-in-another-tree", linked, "HEAD");
    write(linked, APP, "// production code\n// half a task\n");

    const set = await shelve(linked, "Q1");

    assert.equal(set.code, 0, set.err);
    assert.equal(set.out, "shelved Q1: 1 file\n");
    assert.deepEqual(await shelvedRefs(linked), [shelvedRef("Q1")]);
    assert.deepEqual(await shelvedRefs(dir), [], "the main working tree has no such ref");
    refused(
      await unshelve(dir, "Q1"),
      "nothing was changed: no shelved work under the key Q1; no key holds shelved work",
    );
    assert.equal(
      (await git(dir, "for-each-ref", "refs/heads/", "refs/stash", "refs/remotes/")).includes("shelved"),
      false,
    );
    assert.equal((await unshelve(linked, "Q1")).out, "put back Q1: 1 file\n");
    assert.equal(read(linked, APP), "// production code\n// half a task\n");
  });

  describe("refuses, in one line, with nothing changed", { concurrency: true }, () => {
    test("shelve with nothing to set aside: a clean tree, and one with changes in the bookkeeping's own files only", async (t) => {
      const dir = await initialized(t);
      const nothing =
        "nothing was changed: nothing to set aside: the working tree has no uncommitted change but in the " +
        "bookkeeping's own files";

      const untracked = await shelve(dir, "Q1");
      await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
      const clean = await shelve(dir, "Q1");
      await tdd(dir, withChange("put", { section: "Open", key: "Q1", value: "a question" }));
      await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));
      write(dir, TASKS, TASKS_TEXT.replace("- [ ] 5.1", "- [x] 5.1"));
      const before = await stands(dir);
      const books = await shelve(dir, "Q1");

      refused(untracked, nothing);
      refused(clean, nothing);
      refused(books, nothing);
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(before.shelved, []);
    });

    test("shelve with nothing to set aside though git reports a path: a change that was staged and then taken back", async (t) => {
      const dir = await initialized(t);
      await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
      write(dir, APP, "// production code\n// staged\n");
      await git(dir, "add", APP);
      write(dir, APP, "// production code\n");
      const before = await stands(dir);

      const r = await shelve(dir, "Q1");

      refused(r, /^ERROR: nothing was changed: nothing to set aside: /);
      assert.deepEqual(await stands(dir), before);
    });

    test("shelve under a key that holds shelved work already", async (t) => {
      const dir = await midTask(t);
      await shelve(dir, "Q2");
      write(dir, TESTS, "// a test\n// another task\n");
      const before = await stands(dir);

      const r = await shelve(dir, "Q2");

      refused(
        r,
        "nothing was changed: the key Q2 holds shelved work already; put that back or drop it first " +
          "(unshelve --key Q2), or take another key",
      );
      assert.deepEqual(await stands(dir), before);
    });

    test("a key whose ref names no commit: refused in git's words, and never taken for a key that holds nothing", async (t) => {
      const dir = await midTask(t);
      await git(dir, "update-ref", shelvedRef("Q2"), "HEAD^{tree}");
      const before = await stands(dir);
      const noCommit = new RegExp(
        `^ERROR: nothing was changed: git rev-parse failed: ${shelvedRef("Q2")} names no commit: .*expected commit type`,
      );

      refused(await shelve(dir, "Q2"), noCommit);
      refused(await unshelve(dir, "Q2"), noCommit);
      refused(await unshelve(dir, "Q2", { drop: true }), noCommit);
      assert.deepEqual(await stands(dir), before);
    });

    test("a key that is not letters, digits, dots, dashes and underscores, or that git takes for no ref, and no key", async (t) => {
      const dir = await midTask(t);
      const before = await stands(dir);
      const KEY =
        /^ERROR: (un)?shelve needs --key <key>: the name the work is set aside under, of letters, digits, dots, dashes and underscores, such as Q2 \(no dot first or last, no two dots in a row, no \.lock at its end\)/;

      for (const key of ["Q 2", "a/b", "Q2!", "..", ".Q2", "Q2.", "Q..2", "Q2.lock", " "]) {
        refused(await shelve(dir, key), KEY);
        refused(await unshelve(dir, key), KEY);
      }
      refused(await tdd(dir, withChange("shelve")), KEY);
      refused(await tdd(dir, withChange("unshelve", { drop: true })), KEY);
      refused(await shelve(dir, "a/b"), /: "a\/b"\n$/);
      assert.deepEqual(await stands(dir), before);
    });

    test("without --change or --pr, with both, and for a triage that is not under way", async (t) => {
      const dir = await midTask(t);
      const before = await stands(dir);

      refused(
        await tdd(dir, ["shelve", "--key", "Q1"]),
        "--change <change-name> is missing (an apply's), or --pr <id> (a triage's)",
      );
      refused(
        await tdd(dir, ["unshelve", "--key", "Q1", "--change", CHANGE, "--pr", PR]),
        /^ERROR: --change and --pr are given together/,
      );
      refused(
        await shelve(dir, "Q1", withPr),
        `no triage is under way in this working tree: run triage-init --pr ${PR} first`,
      );
      assert.deepEqual(await stands(dir), before);
    });

    test("a refusal of the call itself, which starts with neither `nothing was changed:` nor `failed part-way:`: an unknown option, a misspelt --change", async (t) => {
      const dir = await midTask(t);
      const before = await stands(dir);

      refused(
        await tdd(dir, withChange("shelve", { key: "Q1", drop: true })),
        "unknown option --drop; shelve takes: --change, --pr, --root, --key",
      );
      refused(
        await tdd(dir, withChange("unshelve", { keys: "Q1" })),
        "unknown option --keys; unshelve takes: --change, --pr, --root, --key, --drop",
      );
      refused(
        await tdd(dir, ["shelve", "--change", "c900-add-made-up-thnig", "--key", "Q1"]),
        /^ERROR: no change folder openspec\/changes\/c900-add-made-up-thnig in .+, and none in its archive\n$/,
      );
      refused(
        await tdd(dir, ["unshelve", "--change", "C900-add-made-up-thing", "--key", "Q1"]),
        `--change C900-add-made-up-thing: the change's folder is named ${CHANGE}; give the name letter for letter`,
      );
      assert.deepEqual(await stands(dir), before);
    });

    test("while another command holds the lock", async (t) => {
      const dir = await midTask(t);
      leftLock(dir, process.pid, 0);
      const before = await stands(dir);

      const r = await shelve(dir, "Q1", withChange, { env: { TDD_LOCK_WAIT_MS: "150" } });

      refused(r, /^ERROR: nothing was changed: the state files are locked by process /);
      rmSync(join(gitFolder(dir), "state.lock"));
      assert.deepEqual(await stands(dir), before);
    });

    test("shelve when a path holds a repository of its own", async (t) => {
      const dir = await midTask(t);
      const nested = join(dir, "src", "Nested");
      mkdirSync(nested);
      await git(nested, "init", "--quiet");
      write(nested, "inner.cs", "// a file of another repository\n");
      const before = await stands(dir);
      assert.ok(before.status.includes("?? src/Nested/"), before.status.join(" | "));

      const r = await shelve(dir, "Q1");

      refused(r, "nothing was changed: src/Nested/ holds a repository of its own, which cannot be set aside");
      assert.deepEqual(await stands(dir), before);
      assert.deepEqual(leftInGitFolder(dir), []);
    });

    test("shelve when the index holds a change the working tree does not show: a file mode staged where the disk keeps none", async (t) => {
      const dir = await midTask(t);
      await git(dir, "config", "core.fileMode", "false");
      await git(dir, "update-index", "--chmod=+x", TESTS);
      const before = await stands(dir);
      assert.match(before.index, new RegExp(`^100755 .*\\t${TESTS}$`, "m"));

      const r = await shelve(dir, "Q1");

      refused(
        r,
        `nothing was changed: the index holds changes the working tree does not show in ${TESTS}: commit them or ` +
          "take them back first",
      );
      assert.deepEqual(await stands(dir), before, "the staged mode is still there");
    });

    test("shelve when a file is renamed in the case of its letters only, where the disk does not tell the two names apart", async (t) => {
      const dir = await midTask(t);
      const renamed = "src/App/MAPPING.cs";
      const caseBlind = existsSync(join(dir, renamed));
      await git(dir, "mv", APP, renamed);
      const before = await stands(dir);

      const r = await shelve(dir, "Q1");

      if (caseBlind) {
        // The file on disk answers to both names, so only the index says which one it has.
        refused(
          r,
          `nothing was changed: the index holds changes the working tree does not show in ${renamed}, ${APP}: ` +
            "commit them or take them back first",
        );
        assert.deepEqual(await stands(dir), before);
      } else {
        // A disk that tells the names apart shows the rename itself: it is set aside like any other.
        assert.equal(r.out, "shelved Q1: 4 files\n", r.err);
        assert.deepEqual(await status(dir), []);
        assert.equal((await unshelve(dir, "Q1")).out, "put back Q1: 4 files\n");
        assert.equal(read(dir, renamed), "// production code\n// half a task\n");
        assert.equal(existsSync(join(dir, APP)), false);
      }
    });

    test("shelve when the index no longer tracks a file kept on disk (git rm --cached): alone, with other work, and when the file is ignored", async (t) => {
      const refusal =
        `nothing was changed: the index holds changes the working tree does not show in ${TESTS}: commit them or ` +
        "take them back first";
      const untracking = async (dir) => git(dir, "rm", "--quiet", "--cached", TESTS);

      const alone = await initialized(t);
      await committed(alone, withChange, { type: "docs", tag: "plan", summary: "The state file" });
      await untracking(alone);
      const aloneBefore = await stands(alone);
      assert.deepEqual(aloneBefore.status, [`D  ${TESTS}`, `?? ${TESTS}`]);

      refused(await shelve(alone, "Q1"), refusal);
      assert.deepEqual(await stands(alone), aloneBefore, "the file is still untracked, and on disk");

      const withWork = await midTask(t);
      await untracking(withWork);
      write(withWork, TESTS, "// a test\n// changed on disk too\n");
      const workBefore = await stands(withWork);

      refused(await shelve(withWork, "Q1"), refusal);
      assert.deepEqual(await stands(withWork), workBefore, "the other work stays, and so does the untracking");

      const ignored = await initialized(t);
      write(ignored, ".gitignore", "/tests/App.UnitTests/\n");
      await committed(ignored, withChange, {
        type: "docs",
        tag: "plan",
        summary: "The state file and what git ignores",
      });
      await untracking(ignored);
      const ignoredBefore = await stands(ignored);
      assert.deepEqual(ignoredBefore.status, [`D  ${TESTS}`], "git reports the file as deleted, and not as new");

      refused(await shelve(ignored, "Q1"), refusal);
      assert.deepEqual(await stands(ignored), ignoredBefore);
    });

    test("shelve and unshelve for a change whose name git takes for no ref (two dots in a row, .lock at its end): the refusal names the change", async (t) => {
      const dir = await midTask(t);
      const changes = ["c901-a..b", "c902-made-up.lock"];
      for (const change of changes) write(dir, `openspec/changes/${change}/tasks.md`, TASKS_TEXT);
      const before = await stands(dir);

      for (const change of changes) {
        for (const command of ["shelve", "unshelve"]) {
          refused(
            await tdd(dir, [command, "--change", change, "--key", "Q1"]),
            `--change ${change}: ${command} keeps the work under refs/worktree/tdd/shelved/<change>/<key>, and git ` +
              "takes no ref named after this change (no two dots in a row, no .lock at its end)",
          );
        }
      }
      assert.deepEqual(await stands(dir), before);
    });

    test("shelve when taking a path back would delete ignored files: in a folder that replaced a file, and a file that replaced a folder", async (t) => {
      const dir = await initialized(t);
      write(dir, ".gitignore", "*.log\n/tests/App.UnitTests\n");
      await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and what git ignores" });
      rmSync(join(dir, APP));
      write(dir, `${APP}/keep.log`, "an ignored file\n");
      write(dir, `${APP}/new.cs`, "// a new file in the folder\n");
      const folder = await stands(dir);

      const inFolder = await shelve(dir, "Q1");

      refused(
        inFolder,
        "nothing was changed: taking the tree back to the last commit would delete ignored files that stand in " +
          `the way: ${APP}/keep.log`,
      );
      assert.deepEqual(await stands(dir), folder);
      assert.equal(read(dir, `${APP}/keep.log`), "an ignored file\n");

      rmSync(join(dir, APP), { recursive: true });
      await git(dir, "checkout", "--", APP);
      rmSync(join(dir, "tests/App.UnitTests"), { recursive: true });
      write(dir, "tests/App.UnitTests", "an ignored file where a folder was\n");
      const file = await stands(dir);
      assert.deepEqual(file.status, [` D ${TESTS}`], "git reports the deleted file, and not the ignored one");

      const asFile = await shelve(dir, "Q1");

      refused(
        asFile,
        "nothing was changed: taking the tree back to the last commit would delete ignored files that stand in " +
          "the way: tests/App.UnitTests",
      );
      assert.deepEqual(await stands(dir), file);
    });

    for (const [name, start, said] of [
      ["a merge", ["merge", "other"], "a merge"],
      ["a cherry-pick", ["cherry-pick", "other"], "a cherry-pick"],
      ["a rebase", ["rebase", "other"], "a rebase"],
    ]) {
      test(`shelve and unshelve while git is in the middle of ${name}: its conflict stays as it is`, async (t) => {
        const dir = await midTask(t);
        await shelve(dir, "Q1");
        await git(dir, "branch", "other");
        write(dir, APP, "// production code\n// this branch's line\n");
        await committed(dir, withChange, { type: "feat", tag: "green", summary: "This branch's line" });
        await git(dir, "checkout", "--quiet", "other");
        write(dir, APP, "// production code\n// the other branch's line\n");
        await git(dir, "commit", "--quiet", "-am", "feat: the other branch's line");
        await git(dir, "checkout", "--quiet", BRANCH);
        const stopped = await started("git", start, { cwd: dir });
        assert.notEqual(stopped.code, 0, "the two lines conflict");
        const before = await stands(dir);

        const set = await shelve(dir, "Q2");
        const back = await unshelve(dir, "Q1");
        const dropped = await unshelve(dir, "Q1", { drop: true });

        const refusal = `nothing was changed: git is in the middle of ${said} in this working tree: finish it or abort it first`;
        refused(set, refusal);
        refused(back, refusal);
        assert.equal(dropped.out, "dropped Q1: 3 files\n", "throwing the work away changes no file, so it may go on");
        assert.deepEqual(await stands(dir), { ...before, shelved: [] });
      });
    }

    test("shelve and unshelve while the index holds a conflict that is not settled, whatever started it", async (t) => {
      const dir = await midTask(t);
      await shelve(dir, "Q1");
      await git(dir, "branch", "other");
      write(dir, APP, "// production code\n// this branch's line\n");
      await committed(dir, withChange, { type: "feat", tag: "green", summary: "This branch's line" });
      await git(dir, "checkout", "--quiet", "other");
      write(dir, APP, "// production code\n// the other branch's line\n");
      await git(dir, "commit", "--quiet", "-am", "feat: the other branch's line");
      await git(dir, "checkout", "--quiet", BRANCH);
      await started("git", ["merge", "other"], { cwd: dir });
      rmSync(join(dir, ".git", "MERGE_HEAD"));
      const before = await stands(dir);

      const refusal =
        "nothing was changed: git is in the middle of a conflict that is not settled in this working tree: finish " +
        "it or abort it first";
      refused(await shelve(dir, "Q2"), refusal);
      refused(await unshelve(dir, "Q1"), refusal);
      assert.deepEqual(await stands(dir), before);
    });

    test("unshelve when a merge driver of the repository's own decides a file that both the work and a later commit changed", async (t) => {
      const dir = await initialized(t);
      write(dir, ".gitattributes", "*.lock merge=ours\n");
      write(dir, "deps.lock", "version 1\n");
      await git(dir, "config", "merge.ours.driver", "true");
      await committed(dir, withChange, { type: "build", tag: "setup", summary: "A lock file that merges as ours" });
      write(dir, "deps.lock", "version 2, the task's\n");
      write(dir, APP, "// production code\n// half a task\n");
      await shelve(dir, "Q1");
      write(dir, "deps.lock", "version 2, the next task's\n");
      await committed(dir, withChange, { type: "build", tag: "green", summary: "The next task's lock file" });
      const before = await stands(dir);

      const r = await unshelve(dir, "Q1");

      refused(
        r,
        "nothing was changed: the work shelved under Q1 cannot be merged with what was committed since: a merge " +
          "driver decides deps.lock",
      );
      assert.deepEqual(await stands(dir), before, "the work is still kept, and the tree as it was");
    });

    test("unshelve when git is told to overlook changes in a file it would write: skip-worktree, and assume-unchanged", async (t) => {
      for (const bit of ["skip-worktree", "assume-unchanged"]) {
        const dir = await midTask(t);
        await shelve(dir, "Q1");
        await git(dir, "update-index", `--${bit}`, APP);
        write(dir, APP, "// production code\n// a change git does not report\n");
        const before = await stands(dir);
        assert.deepEqual(before.status, [], bit);

        const r = await unshelve(dir, "Q1");

        refused(
          r,
          `nothing was changed: the work shelved under Q1 cannot be written: git is told to overlook changes in ${APP} ` +
            "(skip-worktree or assume-unchanged), so what the working tree holds there cannot be checked",
        );
        assert.deepEqual(await stands(dir), before, bit);
        assert.equal(read(dir, APP), "// production code\n// a change git does not report\n", bit);
      }
    });
  });

  test("unshelve goes on where a merge driver is set but only the work changed the file", async (t) => {
    const dir = await initialized(t);
    write(dir, ".gitattributes", "*.lock merge=ours\n");
    write(dir, "deps.lock", "version 1\n");
    await git(dir, "config", "merge.ours.driver", "true");
    await committed(dir, withChange, { type: "build", tag: "setup", summary: "A lock file that merges as ours" });
    write(dir, "deps.lock", "version 2, the task's\n");
    await shelve(dir, "Q1");
    write(dir, APP, "// production code\n// the next task\n");
    await committed(dir, withChange, { type: "feat", tag: "green", summary: "The next task" });

    const r = await unshelve(dir, "Q1");

    assert.equal(r.out, "put back Q1: 1 file\n", r.err);
    assert.equal(read(dir, "deps.lock"), "version 2, the task's\n");
  });

  test("sets aside a staged rename, and puts it back as a deleted file and a new one", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    const renamed = "src/App/Renamed.cs";
    await git(dir, "mv", APP, renamed);
    write(dir, renamed, "// production code\n// and a line more\n");
    assert.deepEqual(await status(dir), [`RM ${APP} -> ${renamed}`]);

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 2 files\n", set.err);
    assert.deepEqual(await status(dir), []);
    assert.equal(read(dir, APP), "// production code\n");
    assert.equal(existsSync(join(dir, renamed)), false);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 2 files\n");
    assert.deepEqual(await status(dir), [` D ${APP}`, `?? ${renamed}`]);
    assert.equal(read(dir, renamed), "// production code\n// and a line more\n");
  });

  test("takes a staged new file whose name is a pattern, or starts with a dash, as that file alone: a committed file the pattern matches stays as it is", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    const pattern = "src/App/[M]apping.cs";
    const dashed = "--all";
    write(dir, pattern, "// a new file, named like a pattern that matches Mapping.cs\n");
    write(dir, dashed, "a new file, named like an option\n");
    await git(dir, "--literal-pathspecs", "add", "--", pattern, dashed);
    const committedApp = await git(dir, "ls-files", "--stage", "--", APP);
    const before = await stands(dir);

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 2 files\n", set.err);
    assert.deepEqual(await status(dir), []);
    assert.equal(existsSync(join(dir, pattern)), false);
    assert.equal(existsSync(join(dir, dashed)), false);
    assert.equal(read(dir, APP), "// production code\n", "the file the pattern matches is not touched");
    assert.equal(await git(dir, "ls-files", "--stage", "--", APP), committedApp);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 2 files\n", back.err);
    assert.deepEqual(await status(dir), [`?? ${dashed}`, `?? ${pattern}`], "back, and unstaged");
    assert.equal(read(dir, pattern), "// a new file, named like a pattern that matches Mapping.cs\n");
    assert.equal(read(dir, dashed), "a new file, named like an option\n");
    assert.deepEqual(workingFiles(dir), before.files);
    assert.equal(await git(dir, "ls-files", "--stage", "--", APP), committedApp);
  });

  test("takes paths with spaces and letters outside ASCII as they are", async (t) => {
    const dir = await initialized(t);
    const tracked = "docs/Žluťoučký kůň/poznámky k úkolu.md";
    const fresh = "src/App/nový soubor (1).cs";
    write(dir, tracked, "# poznámky\n");
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file and some notes" });
    write(dir, tracked, "# poznámky\n\ndalší řádek\n");
    write(dir, fresh, "// nový\n");
    const before = await stands(dir);

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 2 files\n", set.err);
    assert.deepEqual(await status(dir), []);
    assert.equal(read(dir, tracked), "# poznámky\n");
    assert.equal(existsSync(join(dir, fresh)), false);

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 2 files\n", back.err);
    assert.deepEqual(await stands(dir), before);
  });

  test("sets aside a folder that replaced a file and a file that replaced a folder, and puts both back", async (t) => {
    const dir = await initialized(t);
    await committed(dir, withChange, { type: "docs", tag: "plan", summary: "The state file" });
    rmSync(join(dir, APP));
    write(dir, `${APP}/Part.cs`, "// the file became a folder\n");
    rmSync(join(dir, "tests/App.UnitTests"), { recursive: true });
    write(dir, "tests/App.UnitTests", "the folder became a file\n");
    const before = await stands(dir);
    assert.deepEqual(before.status, [` D ${APP}`, ` D ${TESTS}`, `?? ${APP}/Part.cs`, "?? tests/App.UnitTests"]);

    const set = await shelve(dir, "Q1");

    assert.equal(set.out, "shelved Q1: 4 files\n", set.err);
    assert.deepEqual(await status(dir), []);
    assert.equal(read(dir, APP), "// production code\n");
    assert.equal(read(dir, TESTS), "// a test\n");

    const back = await unshelve(dir, "Q1");

    assert.equal(back.out, "put back Q1: 4 files\n", back.err);
    assert.deepEqual(await stands(dir), before);
  });

  test("never touches a bookkeeping file of the other skill, or of another change: an apply's in a triage, a triage's in an apply", async (t) => {
    const { dir } = await triaging(t, "change");
    assert.equal((await tdd(dir, withChange("init", SWITCHES))).code, 0);
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));
    const other = "openspec/changes/c901-another/.tdd-state.md";
    write(dir, other, "# .tdd-state: c901-another\n");
    await git(dir, "add", "-A");
    await git(dir, "commit", "--quiet", "-m", "docs: every bookkeeping file");
    await tdd(dir, withChange("put", { section: "Open", key: "Q1", value: "the apply's question" }));
    await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "one more" }));
    await tdd(dir, withPr("put", { section: "Open", key: "Q1", value: "the triage's question" }));
    write(dir, other, "# .tdd-state: c901-another\n\nchanged by its own session\n");
    write(dir, "openspec/changes/c901-another/.chapter-reviews.md", "# Chapter reviews: c901-another\n");
    write(dir, APP, "// production code\n// half a fix\n");
    const books = [STATE, REVIEWS, TRIAGE, other, "openspec/changes/c901-another/.chapter-reviews.md"];
    const held = () => books.map((path) => read(dir, path));
    const before = held();

    for (const whose of [withPr, withChange]) {
      const set = await shelve(dir, "Q1", whose);

      assert.equal(set.out, "shelved Q1: 1 file\n", set.err);
      assert.deepEqual(held(), before);
      assert.deepEqual(await status(dir), [
        ` M ${REVIEWS}`,
        ` M ${TRIAGE}`,
        ` M ${STATE}`,
        ` M ${other}`,
        "?? openspec/changes/c901-another/.chapter-reviews.md",
      ]);

      const back = await unshelve(dir, "Q1", {}, whose);

      assert.equal(back.out, "put back Q1: 1 file\n", back.err);
      assert.deepEqual(held(), before);
      assert.equal(read(dir, APP), "// production code\n// half a fix\n");
    }
  });

  describe(
    "when a step fails after the first change (TDD_FAIL_STEP names the steps, or a filter fails for real)",
    { concurrency: true },
    () => {
      const failing = (step) => ({ env: { TDD_FAIL_STEP: step } });
      const failed = (r, message) => {
        assert.equal(r.code, 1, r.out + r.err);
        assert.equal(r.out, "");
        assert.ok(r.err.startsWith(`ERROR: ${message}`), r.err);
        assert.ok(oneLine(r.err), r.err);
      };
      // What TDD_FAIL_STEP makes a step say: before its work, or after it (`+`).
      const made = (step) =>
        `TDD_FAIL_STEP made the step ${step.replace("+", "")} fail ${step.endsWith("+") ? "after" : "before"} its work`;
      // The causes a line ends with: the failed step's, the one on the way back, and the reading's.
      const causes = (first, back, reading) =>
        `The cause: ${made(first)}${back ? `; on the way back: ${made(back)}` : ""}` +
        `${reading ? `; reading the state again: ${made(reading)}` : ""}\n`;
      const OUT = "the way out, once the cause is gone:";
      const THREE = (key) =>
        `${OUT} shelve --key <another> (takes what is left), then unshelve --key ${key}, then unshelve --key ` +
        "<another> --drop.";

      // Runs the way out a part-way line names, as the runner does once the cause is gone: each command in its
      // order, without the words in brackets after it, with `<another>` as `<key>-out`; a line that names no way
      // out, nothing. Each must succeed, but for the runner's one rule: when a way out starts with `shelve --key
      // <another>` and that is refused with nothing to set aside, the tree was at the last commit already, so the
      // next command runs and the final `--drop` of `<another>` does not ("nothing to set aside" stands for the
      // refusal). Answers what they printed.
      async function wayOut(dir, line, key) {
        const [, commands] = /the way out, once the cause is gone: (.*?)\. The cause: /.exec(line) ?? [];
        if (commands === undefined) {
          assert.doesNotMatch(line, /the way out/);
          return [];
        }
        const printed = [];
        const list = commands.split(", then ").map((command) => command.replace(/ \(.*\)$/, ""));
        let atLastCommit = false;
        for (const [i, command] of list.entries()) {
          if (atLastCommit && i === list.length - 1 && command === "unshelve --key <another> --drop") break;
          const [verb, ...args] = command.replaceAll("<another>", `${key}-out`).split(" ");
          const r = await tdd(dir, withChange(verb, ...args));
          const nothing = "ERROR: nothing was changed: nothing to set aside: ";
          if (i === 0 && command === "shelve --key <another>" && r.code === 1 && r.err.startsWith(nothing)) {
            atLastCommit = true;
            printed.push("nothing to set aside");
            continue;
          }
          assert.equal(r.code, 0, `${command}: ${r.err}`);
          printed.push(r.out.trim());
        }
        return printed;
      }

      // A repository whose file DATA goes through a filter git must run (`filter.broken`, required): its clean side
      // passes the file through, and once `breaks` its smudge side fails, so that git cannot write the file into
      // the working tree (it deletes the file there first, then stops): a write that fails for real, on every
      // system. Once `readsNoMore`, git writes the file and then cannot read it: the smudge side leaves a mark in
      // the git folder, and the clean side, which git runs to read the file (`git hash-object`), fails while the
      // mark is there. Once `failsOnce`, the smudge side fails the first time git runs it and leaves the mark, and
      // passes from then on. `mends` makes both sides pass again.
      const DATA = "src/App/Data.flt";
      async function filtered(t) {
        const dir = await initialized(t);
        write(dir, ".gitattributes", "*.flt filter=broken\n");
        write(dir, DATA, "data, as committed\n");
        await git(dir, "config", "filter.broken.clean", "cat");
        await git(dir, "config", "filter.broken.smudge", "cat");
        await git(dir, "config", "filter.broken.required", "true");
        await committed(dir, withChange, {
          type: "build",
          tag: "setup",
          summary: "The state file and a filtered file",
        });
        return dir;
      }
      const breaks = (dir) => git(dir, "config", "filter.broken.smudge", "false");
      const mark = (dir) => join(dir, ".git", "read-no-more");
      async function readsNoMore(dir) {
        const at = mark(dir).replaceAll("\\", "/");
        await git(dir, "config", "filter.broken.clean", `test ! -e '${at}' && cat`);
        await git(dir, "config", "filter.broken.smudge", `touch '${at}' && cat`);
      }
      async function failsOnce(dir) {
        const at = mark(dir).replaceAll("\\", "/");
        await git(
          dir,
          "config",
          "filter.broken.smudge",
          `if test -e '${at}'; then cat; else touch '${at}'; exit 1; fi`,
        );
      }
      async function mends(dir) {
        await git(dir, "config", "filter.broken.clean", "cat");
        await git(dir, "config", "filter.broken.smudge", "cat");
        rmSync(mark(dir), { force: true });
      }
      const SMUDGE = /git checkout(-index)? failed: .*smudge filter broken failed/;

      test("shelve: the ref cannot be written, and nothing was changed", async (t) => {
        const dir = await midTask(t);
        const before = await stands(dir);

        const r = await shelve(dir, "Q2", withChange, failing("keep"));

        assert.equal(
          r.err,
          `ERROR: nothing was changed: the work could not be kept under the key Q2: ${made("keep")}\n`,
        );
        assert.deepEqual(await stands(dir), before);
      });

      test("shelve: the ref may or may not be written, and cannot be read again: the line says only what is known and names no way out, and the runner's next shelve finds out", async (t) => {
        for (const [steps, written] of [
          ["keep,keyHolds", false],
          ["keep+,keyHolds", true],
        ]) {
          const dir = await midTask(t);
          const before = await stands(dir);

          const r = await shelve(dir, "Q2", withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: the working tree holds the work as it was, not touched yet, and whether the key " +
              `Q2 holds a copy of it could not be read. ${causes(steps.split(",")[0], undefined, "keyHolds")}`,
            steps,
          );
          assert.deepEqual(await stands(dir), written ? { ...before, shelved: [shelvedRef("Q2")] } : before, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), [], "the runner runs nothing and goes on");
          // It sets the work aside again: under the same key, or, when that key holds the copy, under another.
          const again = await shelve(dir, "Q2");
          if (written) {
            assert.equal(
              again.err,
              "ERROR: nothing was changed: the key Q2 holds shelved work already; put that back or drop it first " +
                "(unshelve --key Q2), or take another key\n",
            );
            assert.equal((await shelve(dir, "Q3")).out, "shelved Q3: 3 files\n");
          } else {
            assert.equal(again.out, "shelved Q2: 3 files\n", steps);
          }
          assert.deepEqual(await status(dir), [], steps);
        }
      });

      test("shelve: the ref is written though its step failed: the key holds a copy, and the way out removes it", async (t) => {
        const dir = await midTask(t);
        const before = await stands(dir);

        const r = await shelve(dir, "Q2", withChange, failing("keep+"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the working tree holds the work as it was, and the key Q2 holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${causes("keep+")}`,
        );
        assert.deepEqual(await stands(dir), { ...before, shelved: [shelvedRef("Q2")] });
        assert.deepEqual(await wayOut(dir, r.err, "Q2"), ["dropped Q2: 3 files"]);
        assert.deepEqual(await stands(dir), before);
      });

      test("shelve: the tree cannot be taken back, so the work is written back and the key freed: nothing is left to undo", async (t) => {
        for (const steps of ["clear+", "clear+,forget+"]) {
          const dir = await midTask(t);
          const before = await stands(dir);

          const r = await shelve(dir, "Q2", withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: nothing was set aside: the working tree holds the work again, and the key Q2 is " +
              `free; nothing is left to undo. ${causes("clear+", steps === "clear+" ? undefined : "forget+")}`,
          );
          assert.deepEqual(await stands(dir), before, `${steps}: the tree holds the work again`);
          assert.equal((await shelve(dir, "Q2")).out, "shelved Q2: 3 files\n", "the command can be run again");
        }
      });

      test("shelve: the tree holds the work again but the key cannot be freed, or the tree was never touched: the key holds a copy, and the way out removes it", async (t) => {
        for (const [steps, first, back] of [
          ["clear+,forget", "clear+", "forget"],
          ["clear,writeBack", "clear", "writeBack"],
          ["clear+,writeBack+", "clear+", "writeBack+"],
        ]) {
          const dir = await midTask(t);
          const before = await stands(dir);

          const r = await shelve(dir, "Q2", withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: the working tree holds the work again, and the key Q2 still holds a copy of it; " +
              `${OUT} unshelve --key Q2 --drop. ${causes(first, back)}`,
            steps,
          );
          assert.deepEqual(await stands(dir), { ...before, shelved: [shelvedRef("Q2")] }, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), ["dropped Q2: 3 files"]);
          assert.deepEqual(await stands(dir), before, steps);
        }
      });

      test("shelve: the tree holds the work again, but the key cannot be freed and cannot be read again: the line says so and names no way out, and the runner's next shelve finds out", async (t) => {
        for (const [steps, freed] of [
          ["clear+,forget,keyHolds", false],
          ["clear+,forget+,keyHolds", true],
        ]) {
          const dir = await midTask(t);
          const before = await stands(dir);

          const r = await shelve(dir, "Q2", withChange, failing(steps));

          const [first, back, reading] = steps.split(",");
          assert.equal(
            r.err,
            "ERROR: failed part-way: the working tree holds the work again, and whether the key Q2 still holds a " +
              `copy of it could not be read. ${causes(first, back, reading)}`,
            steps,
          );
          assert.deepEqual(await stands(dir), freed ? before : { ...before, shelved: [shelvedRef("Q2")] }, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), [], "the runner runs nothing and goes on");
          // It sets the work aside again: under the same key, or, when that key holds the copy, under another.
          const again = await shelve(dir, "Q2");
          if (freed) {
            assert.equal(again.out, "shelved Q2: 3 files\n", steps);
          } else {
            assert.match(again.err, /^ERROR: nothing was changed: the key Q2 holds shelved work already; /, steps);
            assert.equal((await shelve(dir, "Q3")).out, "shelved Q3: 3 files\n", steps);
          }
          assert.deepEqual(await status(dir), [], steps);
        }
      });

      test("shelve: a link among the work is read again as git keeps it, so that the tree is known to hold the work again", async (t) => {
        const dir = await midTask(t);
        try {
          symlinkSync("Mapping.cs", join(dir, "src/App/Link.cs"), "file");
        } catch (e) {
          if (e.code !== "EPERM") throw e;
          t.skip("this system lets no test make a link");
          return;
        }
        const before = await stands(dir);

        const r = await shelve(dir, "Q2", withChange, failing("clear+,writeBack+"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the working tree holds the work again, and the key Q2 still holds a copy of it; " +
            `${OUT} unshelve --key Q2 --drop. ${causes("clear+", "writeBack+")}`,
        );
        assert.deepEqual(await stands(dir), { ...before, shelved: [shelvedRef("Q2")] });
      });

      test("shelve: the tree is taken back but the work cannot be written back: it is set aside after all, and the way out puts it back", async (t) => {
        const dir = await midTask(t);
        const before = await stands(dir);

        const r = await shelve(dir, "Q2", withChange, failing("clear+,writeBack"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the work is set aside under the key Q2, and the working tree is at the last " +
            `commit; ${OUT} unshelve --key Q2. ${causes("clear+", "writeBack")}`,
        );
        assert.deepEqual(await status(dir), []);
        assert.deepEqual(await wayOut(dir, r.err, "Q2"), ["put back Q2: 3 files"]);
        assert.deepEqual(await stands(dir), before, "the work is back where the next shelve takes it");
      });

      test("shelve: the work cannot be written back and the tree cannot be read again: the line says so and names the paths, and its way out gets out from where the tree is, at the last commit or holding the work", async (t) => {
        for (const [steps, printed] of [
          ["clear+,writeBack,treeHolds", ["nothing to set aside", "put back Q2: 3 files"]],
          [
            "clear+,writeBack+,treeHolds",
            ["shelved Q2-out: 3 files", "put back Q2: 3 files", "dropped Q2-out: 3 files"],
          ],
        ]) {
          const dir = await midTask(t);
          const before = await stands(dir);

          const r = await shelve(dir, "Q2", withChange, failing(steps));

          const [first, back, reading] = steps.split(",");
          assert.equal(
            r.err,
            "ERROR: failed part-way: the work is safe under the key Q2, but the working tree could not be read in " +
              `full: ${APP}, ${DRIVER}, ${NEW} could not be read; ${THREE("Q2")} ${causes(first, back, reading)}`,
            steps,
          );
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), printed, steps);
          assert.deepEqual(await stands(dir), before, `${steps}: the work is back where the next shelve takes it`);
        }
      });

      test("shelve, for real: a file of the work that git writes back but cannot read again: the line names it, and its way out gets out", async (t) => {
        const dir = await filtered(t);
        write(dir, DATA, "data, half a task\n");
        write(dir, APP, "// production code\n// half a task\n");
        write(dir, NEW, "// a new file of the task\n");
        rmSync(join(dir, DRIVER));
        const before = await stands(dir);
        await readsNoMore(dir);

        const r = await shelve(dir, "Q2", withChange, failing("clear+,writeBack+"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the work is safe under the key Q2, but the working tree could not be read in full: " +
            `${DATA} could not be read; ${THREE("Q2")} ${causes("clear+", "writeBack+")}`,
        );
        await mends(dir);
        assert.deepEqual(await wayOut(dir, r.err, "Q2"), [
          "shelved Q2-out: 4 files",
          "put back Q2: 4 files",
          "dropped Q2-out: 4 files",
        ]);
        assert.deepEqual(await stands(dir), before, "the work is back where the next shelve takes it");
      });

      test("shelve, for real: a file git cannot write leaves the tree neither at the last commit nor as the work has it, the line says so and names both causes whole, and its way out gets out", async (t) => {
        const dir = await filtered(t);
        write(dir, DATA, "data, half a task\n");
        write(dir, APP, "// production code\n// half a task\n");
        write(dir, NEW, "// a new file of the task\n");
        rmSync(join(dir, DRIVER));
        const before = await stands(dir);
        await breaks(dir);

        const r = await shelve(dir, "Q2");

        failed(
          r,
          "failed part-way: the work is safe under the key Q2, but the working tree is neither at the last commit " +
            `nor as the work has it; ${THREE("Q2")} The cause: `,
        );
        assert.equal(existsSync(join(dir, DATA)), false, "git deleted the file, and could write neither side of it");
        assert.match(r.err, /; on the way back: /, "both causes");
        assert.match(r.err, new RegExp(`${SMUDGE.source}\\n$`), "the line is not cut");
        assert.deepEqual(await shelvedRefs(dir), [shelvedRef("Q2")], "the key holds the work");
        await mends(dir);
        await wayOut(dir, r.err, "Q2");
        assert.deepEqual(await stands(dir), before, "the work is back where the next shelve takes it");
        assert.equal((await shelve(dir, "Q2")).out, "shelved Q2: 4 files\n");
        assert.deepEqual(await status(dir), []);
      });

      test("unshelve: the work cannot be written, so the paths are taken back to what they were", async (t) => {
        const dir = await midTask(t);
        await shelve(dir, "Q2");
        write(dir, NEW, "// a new file of the task\n");
        const before = await stands(dir);

        const r = await unshelve(dir, "Q2", {}, withChange, failing("write+"));

        assert.equal(
          r.err,
          "ERROR: nothing was changed: the work shelved under Q2 could not be written and is still under the key. " +
            causes("write+"),
        );
        assert.deepEqual(await stands(dir), before, "also the new file that stood there already with the same content");
        assert.equal((await unshelve(dir, "Q2")).out, "put back Q2: 3 files\n", "the command can be run again");
      });

      test("unshelve: the work cannot be written and the paths are taken back, but the tree cannot be read again: no line says nothing was changed, and the way out gets out", async (t) => {
        const dir = await midTask(t);
        const work = await stands(dir);
        await shelve(dir, "Q2");

        const r = await unshelve(dir, "Q2", {}, withChange, failing("write+,treeHolds"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the work is still safe under the key Q2, but the working tree could not be read " +
            `in full: ${APP}, ${NEW}, ${DRIVER} could not be read; ${THREE("Q2")} ` +
            causes("write+", undefined, "treeHolds"),
        );
        assert.deepEqual(await wayOut(dir, r.err, "Q2"), ["nothing to set aside", "put back Q2: 3 files"]);
        assert.deepEqual(await stands(dir), work, "the work is back, and no key holds it");
      });

      // A filtered repository with a new file of the work set aside under Q1, and the same file standing there
      // again, untracked: a put-back writes it all the same, and git deletes it before it writes it.
      const STOOD = "src/App/New.flt";
      async function stoodThere(t) {
        const dir = await filtered(t);
        write(dir, STOOD, "a new file of the task\n");
        await shelve(dir, "Q1");
        write(dir, STOOD, "a new file of the task\n");
        const before = await stands(dir);
        assert.deepEqual(before.status, [`?? ${STOOD}`], "the same file stands there again, untracked");
        return { dir, before };
      }

      test("unshelve, for real: a new file of the work that stood there already, which git deletes and then cannot write: the way back writes it again, and nothing was changed", async (t) => {
        const { dir, before } = await stoodThere(t);
        await failsOnce(dir);

        const r = await unshelve(dir, "Q1");

        failed(
          r,
          "nothing was changed: the work shelved under Q1 could not be written and is still under the key. The " +
            "cause: ",
        );
        assert.match(r.err, /The cause: git checkout-index failed: /);
        assert.doesNotMatch(r.err, /on the way back/, "the way back did not fail");
        assert.deepEqual(await stands(dir), before, "the file that stood there stands there again, byte for byte");
        await mends(dir);
        assert.equal((await unshelve(dir, "Q1")).out, "put back Q1: 1 file\n", "the command can be run again");
      });

      test("unshelve, for real: a new file of the work that stood there already, which git can neither write nor write back: the line says the tree is neither, and its way out gets out", async (t) => {
        const { dir, before } = await stoodThere(t);
        await breaks(dir);

        const r = await unshelve(dir, "Q1");

        failed(
          r,
          "failed part-way: the work is still safe under the key Q1, but the working tree is neither as it was " +
            `before nor as the work has it; ${THREE("Q1")} The cause: `,
        );
        assert.match(r.err, new RegExp(`The cause: ${SMUDGE.source}; on the way back: ${SMUDGE.source}\\n$`));
        assert.equal(existsSync(join(dir, STOOD)), false, "git deleted the file, and could not write it back");
        await mends(dir);
        assert.deepEqual(await wayOut(dir, r.err, "Q1"), ["nothing to set aside", "put back Q1: 1 file"]);
        assert.deepEqual(await stands(dir), { ...before, shelved: [] }, "the file stands there again, as it was");
      });

      test("unshelve: neither written nor taken back, or taken back though its step failed: the tree is read again, and nothing was changed", async (t) => {
        for (const [steps, first, back] of [
          ["write,undo", "write", "undo"],
          ["write+,undo+", "write+", "undo+"],
        ]) {
          const dir = await midTask(t);
          await shelve(dir, "Q2");
          const before = await stands(dir);

          const r = await unshelve(dir, "Q2", {}, withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: nothing was changed: the work shelved under Q2 could not be written and is still under the key. " +
              causes(first, back),
            steps,
          );
          assert.deepEqual(await stands(dir), before, steps);
        }
      });

      test("unshelve: neither written nor taken back, and the tree cannot be read again: the line says so and names the paths, and its way out gets out from where the tree is, as it was or holding the work", async (t) => {
        for (const [steps, printed] of [
          ["write,undo,treeHolds", ["nothing to set aside", "put back Q2: 3 files"]],
          ["write+,undo,treeHolds", ["shelved Q2-out: 3 files", "put back Q2: 3 files", "dropped Q2-out: 3 files"]],
        ]) {
          const dir = await midTask(t);
          const work = await stands(dir);
          await shelve(dir, "Q2");

          const r = await unshelve(dir, "Q2", {}, withChange, failing(steps));

          const [first, back, reading] = steps.split(",");
          assert.equal(
            r.err,
            "ERROR: failed part-way: the work is still safe under the key Q2, but the working tree could not be read " +
              `in full: ${APP}, ${NEW}, ${DRIVER} could not be read; ${THREE("Q2")} ${causes(first, back, reading)}`,
            steps,
          );
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), printed, steps);
          assert.deepEqual(await stands(dir), work, `${steps}: the work is back, and no key holds it`);
        }
      });

      test("unshelve: written whole and not taken back, or the key cannot be freed: the key holds a copy, and the way out removes it", async (t) => {
        for (const [steps, first, back] of [
          ["write+,undo", "write+", "undo"],
          ["forget", "forget", undefined],
        ]) {
          const dir = await midTask(t);
          const work = await stands(dir);
          await shelve(dir, "Q2");

          const r = await unshelve(dir, "Q2", {}, withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: the work is back in the working tree, and the key Q2 still holds a copy of it; " +
              `${OUT} unshelve --key Q2 --drop. ${causes(first, back)}`,
            steps,
          );
          assert.deepEqual(await stands(dir), { ...work, shelved: [shelvedRef("Q2")] }, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), ["dropped Q2: 3 files"]);
          assert.deepEqual(await stands(dir), work, steps);
        }
      });

      test("unshelve: the key is freed though its step failed: the work is back, and nothing is left to undo", async (t) => {
        const dir = await midTask(t);
        const work = await stands(dir);
        await shelve(dir, "Q2");

        const r = await unshelve(dir, "Q2", {}, withChange, failing("forget+"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the work is back in the working tree, and the key Q2 is free; nothing is left to " +
            `undo. ${causes("forget+")}`,
        );
        assert.deepEqual(await stands(dir), work);
      });

      test("unshelve: the work is back, but the key cannot be freed and cannot be read again: the line says so and names no way out", async (t) => {
        for (const [steps, freed] of [
          ["forget,keyHolds", false],
          ["forget+,keyHolds", true],
        ]) {
          const dir = await midTask(t);
          const work = await stands(dir);
          await shelve(dir, "Q2");

          const r = await unshelve(dir, "Q2", {}, withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: the work is back in the working tree, and whether the key Q2 still holds a copy " +
              `of it could not be read. ${causes(steps.split(",")[0], undefined, "keyHolds")}`,
            steps,
          );
          assert.deepEqual(await stands(dir), freed ? work : { ...work, shelved: [shelvedRef("Q2")] }, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), [], "the runner runs nothing and goes on with the task");
        }
      });

      test("unshelve, for real: a file git can neither write nor take back, which git deletes before it writes: the line says the tree holds neither side, names both causes whole, and its way out gets out", async (t) => {
        const dir = await filtered(t);
        write(dir, DATA, "data, half a task\n");
        await shelve(dir, "Q1");
        await breaks(dir);

        const r = await unshelve(dir, "Q1");

        failed(
          r,
          "failed part-way: the work is still safe under the key Q1, but the working tree is neither as it was " +
            `before nor as the work has it; ${THREE("Q1")} The cause: `,
        );
        assert.match(r.err, new RegExp(`The cause: ${SMUDGE.source}; on the way back: ${SMUDGE.source}\\n$`));
        assert.ok(r.err.length > 310, "longer than a line that is cut, and whole");
        assert.equal(existsSync(join(dir, DATA)), false, "git deleted the file, and could write neither side of it");
        await mends(dir);
        assert.deepEqual(await wayOut(dir, r.err, "Q1"), [
          "shelved Q1-out: 1 file",
          "put back Q1: 1 file",
          "dropped Q1-out: 1 file",
        ]);
        assert.equal(read(dir, DATA), "data, half a task\n");
        assert.deepEqual(await status(dir), [` M ${DATA}`]);
      });

      test("unshelve, for real: a file of the work that git writes but cannot read again: the line names it, and its way out gets out", async (t) => {
        const dir = await filtered(t);
        write(dir, DATA, "data, half a task\n");
        write(dir, APP, "// production code\n// half a task\n");
        const work = await stands(dir);
        await shelve(dir, "Q1");
        await readsNoMore(dir);

        const r = await unshelve(dir, "Q1", {}, withChange, failing("write+,undo"));

        assert.equal(
          r.err,
          "ERROR: failed part-way: the work is still safe under the key Q1, but the working tree could not be read " +
            `in full: ${DATA} could not be read; ${THREE("Q1")} ${causes("write+", "undo")}`,
        );
        await mends(dir);
        assert.deepEqual(await wayOut(dir, r.err, "Q1"), [
          "shelved Q1-out: 2 files",
          "put back Q1: 2 files",
          "dropped Q1-out: 2 files",
        ]);
        assert.deepEqual(await stands(dir), work, "the work is back, and no key holds it");
      });

      test("unshelve, for real: written in part and taken back in part: the way out it names touches nothing but the put-back's paths", async (t) => {
        const dir = await filtered(t);
        write(dir, DATA, "data, half a task\n");
        write(dir, NEW, "// a new file of the task\n");
        rmSync(join(dir, DRIVER));
        const work = await stands(dir);
        await shelve(dir, "Q2");
        // What the bookkeeping records meanwhile, the one uncommitted change unshelve lets stand.
        await tdd(dir, withChange("put", { section: "Open", key: "Q2", value: "answered: go on" }));
        await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));
        const books = () => [STATE, REVIEWS].map((path) => read(dir, path));
        const recorded = books();
        await breaks(dir);

        const r = await unshelve(dir, "Q2");

        failed(
          r,
          "failed part-way: the work is still safe under the key Q2, but the working tree is neither as it was " +
            `before nor as the work has it; ${THREE("Q2")} The cause: `,
        );
        assert.match(r.err, new RegExp(`The cause: ${SMUDGE.source}; on the way back: ${SMUDGE.source}\\n$`));
        await mends(dir);
        // Git deleted the deleted file and the filtered one, and could take neither back.
        assert.deepEqual(await wayOut(dir, r.err, "Q2"), [
          "shelved Q2-out: 2 files",
          "put back Q2: 3 files",
          "dropped Q2-out: 2 files",
        ]);
        assert.deepEqual(books(), recorded, "what the bookkeeping recorded stays, byte for byte");
        const outsideBooks = (files) => files.filter((file) => !file.startsWith(`${FOLDER}/.`));
        assert.deepEqual(
          outsideBooks(workingFiles(dir)),
          outsideBooks(work.files),
          "and every other file holds the work",
        );
        assert.deepEqual(await shelvedRefs(dir), []);
      });

      test("unshelve --drop: the key cannot be freed, and nothing was changed; or it is freed though its step failed", async (t) => {
        for (const [steps, message] of [
          [
            "forget",
            "nothing was changed: the work shelved under Q2 could not be thrown away and is still under the key. " +
              causes("forget"),
          ],
          [
            "forget+",
            "failed part-way: the work shelved under Q2 is thrown away, as asked; nothing is left to undo. " +
              causes("forget+"),
          ],
        ]) {
          const dir = await midTask(t);
          await shelve(dir, "Q2");
          const before = await stands(dir);

          const r = await unshelve(dir, "Q2", { drop: true }, withChange, failing(steps));

          assert.equal(r.err, `ERROR: ${message}`, steps);
          assert.deepEqual(await stands(dir), steps === "forget" ? before : { ...before, shelved: [] }, steps);
        }
      });

      test("unshelve --drop: the key cannot be freed and cannot be read again: the line says only what is known and names no way out", async (t) => {
        for (const [steps, freed] of [
          ["forget,keyHolds", false],
          ["forget+,keyHolds", true],
        ]) {
          const dir = await midTask(t);
          await shelve(dir, "Q2");
          const before = await stands(dir);

          const r = await unshelve(dir, "Q2", { drop: true }, withChange, failing(steps));

          assert.equal(
            r.err,
            "ERROR: failed part-way: the working tree is unchanged, and whether the key Q2 still holds the shelved " +
              `work could not be read. ${causes(steps.split(",")[0], undefined, "keyHolds")}`,
            steps,
          );
          assert.deepEqual(await stands(dir), freed ? { ...before, shelved: [] } : before, steps);
          assert.deepEqual(await wayOut(dir, r.err, "Q2"), [], "the runner runs nothing and goes on");
        }
      });
    },
  );
});

describe("route", { concurrency: true }, () => {
  const confirmed = (more = {}) => ({
    verdict: "confirmed",
    evidence: true,
    kind: "behaviour",
    local: true,
    size: "small",
    specBehaviour: false,
    contractChange: false,
    ...more,
  });
  // Three findings, one for each outcome, as JSON.
  const FINDINGS = JSON.stringify([
    { id: "B-1", outside: false, reviewerDisagrees: false, verdicts: [confirmed()] },
    { id: "B-2", verdicts: [{ verdict: "refuted", evidence: true }] },
    { id: "B-3", verdicts: [confirmed({ local: false })] },
  ]);
  const ROUTED =
    "B-1 → FIX · behaviour\nB-2 → DECLINE · refuted with evidence\nB-3 → ASK · the fix is not local\n" +
    "FIX 1 · DECLINE 1 · ASK 1\n";

  test("sorts the findings given with --json, one line each and the counts, without a change or a repository", async (t) => {
    const outside = tempFolder(t);

    const r = await tdd(outside, ["route", "--json", FINDINGS]);

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, ROUTED);
    assert.equal(r.err, "");
    assert.deepEqual(readdirSync(outside), []);
  });

  test("reads the findings from a file with --in, from the folder it is called in or by its whole path", async (t) => {
    const dir = tempFolder(t);
    write(dir, "work/results.json", `\uFEFF${FINDINGS}\n`);

    const relative = await tdd(dir, ["route", "--in", "work/results.json"]);
    const absolute = await tdd(tempFolder(t), ["route", "--in", join(dir, "work", "results.json")]);

    assert.equal(relative.code, 0, relative.err);
    assert.equal(relative.out, ROUTED);
    assert.equal(absolute.out, ROUTED);
    assert.equal(read(dir, "work/results.json"), `\uFEFF${FINDINGS}\n`, "the file is left as it was");
  });

  test("reads the findings from standard input with --stdin", async (t) => {
    const r = await tdd(tempFolder(t), ["route", "--stdin"], { input: `${FINDINGS}\n` });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, ROUTED);
  });

  test("sorts a triage's two verdicts per finding, and says when only one of the two checks says so", async (t) => {
    const findings = JSON.stringify([
      { id: 1, verdicts: [confirmed({ kind: "docs" }), confirmed({ kind: "docs" })] },
      { id: 2, verdicts: [confirmed({ size: "large" }), confirmed()] },
      { id: 3, verdicts: [confirmed(), null] },
      {
        id: 4,
        verdicts: [
          { verdict: "refuted", evidence: true },
          { verdict: "refuted", evidence: false },
        ],
      },
    ]);

    const r = await tdd(tempFolder(t), ["route", "--json", findings]);

    assert.equal(
      r.out,
      "1 → FIX · docs\n2 → ASK · a large fix, and the two checks disagree on it\n" +
        "3 → ASK · a check returned no result\n4 → ASK · refuted without concrete evidence\n" +
        "FIX 1 · DECLINE 0 · ASK 3\n",
    );
  });

  test("works next to --change and inside a repository too, and changes nothing there", async (t) => {
    const dir = await initialized(t);
    const before = await status(dir);

    const r = await tdd(dir, [...withChange("route"), "--json", FINDINGS]);

    assert.equal(r.out, ROUTED);
    assert.deepEqual(await status(dir), before);
    assert.equal(existsSync(gitFolder(dir)), true, "only `init` made git's folder for the lock");
    assert.deepEqual(leftInGitFolder(dir), []);
  });

  test("needs exactly one of --json, --in, --stdin, --reports and --chapter", async (t) => {
    const dir = tempFolder(t);
    write(dir, "results.json", FINDINGS);
    write(dir, "reports/3-1.md", "VERDICT: unsure\n");

    for (const args of [
      [],
      ["--json", FINDINGS, "--stdin"],
      ["--json", FINDINGS, "--in", "results.json"],
      ["--json", FINDINGS, "--reports", "reports", "--ids", "3"],
      ["--in", "results.json", "--reports", "reports", "--ids", "3"],
      ["--stdin", "--reports", "reports", "--ids", "3"],
      ["--ids", "3"],
      ["--json", FINDINGS, "--change", CHANGE, "--chapter", "B"],
      ["--reports", "reports", "--ids", "3", "--chapter", "B"],
      ["--change", CHANGE],
    ]) {
      const r = await tdd(dir, ["route", ...args], { input: FINDINGS });

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.equal(
        r.err,
        "ERROR: route needs one of --json <text>, --in <file>, --stdin, --reports <folder> with --ids, and " +
          "--change <change-name> with --chapter <X>\n",
      );
    }
  });

  test("takes --ids with --reports only, and needs it there", async (t) => {
    const dir = tempFolder(t);
    write(dir, "results.json", FINDINGS);
    write(dir, "reports/3-1.md", "VERDICT: unsure\n");

    for (const [args, message] of [
      [["--json", FINDINGS, "--ids", "3"], "--ids goes with --reports <folder>: it names the findings there"],
      [["--in", "results.json", "--ids", "3"], "--ids goes with --reports <folder>: it names the findings there"],
      [["--stdin", "--ids", "3"], "--ids goes with --reports <folder>: it names the findings there"],
      [["--reports", "reports"], "route --reports needs --ids <id>[,<id>...]: the findings to sort"],
      [["--reports", "reports", "--ids", " , "], "route --reports needs --ids <id>[,<id>...]: the findings to sort"],
    ]) {
      const r = await tdd(dir, ["route", ...args], { input: FINDINGS });

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.equal(r.err, `ERROR: ${message}\n`);
    }
  });

  // A folder of the report files a triage's checks wrote: for each finding's id the lines of its first and of its
  // second check's report; null for a check that wrote none. The second check's report ends with its FIRST PASS
  // line, which says `agrees` unless the lines given hold one (`NO_FIRST_PASS` among them leaves it out).
  const REPORT = {
    confirmed: [
      "VERDICT: confirmed",
      "EVIDENCE: src/App/Mapping.cs:19, and the test A_made_up_test",
      "KIND: behaviour",
      "FIX: local · small · spec behaviour no · contract change no · return the field from the mapping",
    ],
    refuted: ["VERDICT: refuted", "EVIDENCE: design.md D4 decides it", "KIND: not applicable", "FIX: not applicable"],
  };
  const NO_FIRST_PASS = "(this second check wrote no FIRST PASS line)";
  function reports(t, findings) {
    const folder = join(tempFolder(t), "reports");
    mkdirSync(folder);
    for (const [id, checks] of Object.entries(findings)) {
      checks.forEach((given, i) => {
        if (given === null) return;
        const says = given.some((l) => l.startsWith("FIRST PASS:") || l === NO_FIRST_PASS);
        const lines = i === 1 && !says ? [...given, "FIRST PASS: agrees"] : given.filter((l) => l !== NO_FIRST_PASS);
        write(folder, `${id}-${i + 1}.md`, `# Finding ${id}\n\n${lines.join("\n")}\n\nALSO NOTICED: —\n`);
      });
    }
    return folder;
  }

  test("with --reports, sorts each finding of --ids from the report files of its two checks", async (t) => {
    const folder = reports(t, {
      1: [REPORT.confirmed, REPORT.confirmed],
      2: [REPORT.confirmed, REPORT.refuted],
      3: [REPORT.confirmed, null],
      4: [REPORT.refuted, REPORT.refuted],
      5: [REPORT.confirmed, REPORT.confirmed.map((l) => l.replace("FIX: local", "FIX: not local"))],
    });
    const before = readdirSync(folder);

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2,3,4,5"]);

    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "");
    assert.equal(
      r.out,
      "1 → FIX · behaviour\n2 → ASK · the two checks disagree on the verdict\n" +
        "3 → ASK · a check returned no result\n4 → DECLINE · refuted with evidence\n" +
        "5 → ASK · the fix is not local, and the two checks disagree on it\n" +
        "FIX 1 · DECLINE 1 · ASK 3\n",
    );
    assert.deepEqual(readdirSync(folder), before, "the folder is left as it was");
  });

  test("with --reports, sorts a finding with a report it cannot read as one without that check's result, says why on stderr, and goes on", async (t) => {
    const folder = reports(t, {
      1: [REPORT.confirmed, REPORT.confirmed],
      2: [REPORT.confirmed, REPORT.confirmed.map((l) => l.replace("KIND: behaviour", "KIND: bug"))],
      3: [["The finding is real."], REPORT.confirmed],
      4: [REPORT.refuted, REPORT.refuted],
    });

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2,3,4"]);

    assert.equal(r.code, 0, "the triage goes on with the other findings");
    assert.equal(
      r.out,
      "1 → FIX · behaviour\n2 → ASK · a check returned no result\n3 → ASK · a check returned no result\n" +
        "4 → DECLINE · refuted with evidence\nFIX 1 · DECLINE 1 · ASK 2\n",
    );
    assert.deepEqual(r.err.trimEnd().split("\n"), [
      'route: 2-2.md cannot be read as a report: KIND is "bug"; it is one of: behaviour, test-quality, docs, cleanup',
      "route: 3-1.md cannot be read as a report: it has no VERDICT line",
    ]);
  });

  test("with --reports, asks about a finding whose second check says it disagrees with the first, with on what", async (t) => {
    const long = `the fix ${"is larger than the first check says and ".repeat(4)}touches the contract`;
    const folder = reports(t, {
      1: [REPORT.confirmed, [...REPORT.confirmed, "FIRST PASS: disagrees: the fix also changes the made-up contract"]],
      2: [REPORT.refuted, [...REPORT.refuted, "FIRST PASS: disagrees: the guard it cites is never reached"]],
      3: [REPORT.confirmed, [...REPORT.confirmed, "FIRST PASS: agrees"]],
      4: [REPORT.confirmed, [...REPORT.refuted, "FIRST PASS: disagrees: design.md D4 decides it"]],
      5: [REPORT.confirmed, [...REPORT.confirmed, `FIRST PASS: disagrees: ${long}`]],
    });

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2,3,4,5"]);

    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "");
    assert.equal(
      r.out,
      "1 → ASK · the second check disagrees with the first: the fix also changes the made-up contract\n" +
        "2 → ASK · the second check disagrees with the first: the guard it cites is never reached\n" +
        "3 → FIX · behaviour\n" +
        "4 → ASK · the two checks disagree on the verdict\n" +
        `5 → ASK · the second check disagrees with the first: ${long.slice(0, 120)}…\n` +
        "FIX 1 · DECLINE 0 · ASK 4\n",
    );
    assert.ok(long.length > 120);
  });

  test("with --reports, a second check's report without its FIRST PASS line cannot be read as a report, nor a first check's with one", async (t) => {
    const folder = reports(t, {
      1: [REPORT.confirmed, [...REPORT.confirmed, NO_FIRST_PASS]],
      2: [REPORT.refuted, [...REPORT.refuted, "FIRST PASS: perhaps"]],
      3: [[...REPORT.confirmed, "FIRST PASS: agrees"], REPORT.confirmed],
      4: [REPORT.refuted, REPORT.refuted],
    });

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2,3,4"]);

    assert.equal(r.code, 0, "the triage goes on with the other findings");
    assert.equal(
      r.out,
      "1 → ASK · a check returned no result\n2 → ASK · a check returned no result\n" +
        "3 → ASK · a check returned no result\n4 → DECLINE · refuted with evidence\nFIX 0 · DECLINE 1 · ASK 3\n",
    );
    assert.deepEqual(r.err.trimEnd().split("\n"), [
      "route: 1-2.md cannot be read as a report: it has no FIRST PASS line, which a second check's report ends " +
        "with: agrees | disagrees: <on what>",
      'route: 2-2.md cannot be read as a report: FIRST PASS is "perhaps"; it is agrees | disagrees: <on what>',
      "route: 3-1.md cannot be read as a report: it has a FIRST PASS line, which only a second check's report has",
    ]);
  });

  test("with --json, asks about a finding whose second verdict carries `disagrees`, and refuses it on the first", async (t) => {
    const findings = JSON.stringify([
      { id: 1, verdicts: [confirmed(), confirmed({ disagrees: "the fix is larger than it says" })] },
      { id: 2, verdicts: [confirmed(), confirmed({ disagrees: true })] },
      { id: 3, verdicts: [confirmed(), confirmed({ disagrees: false })] },
    ]);
    const onTheFirst = JSON.stringify([{ id: 4, verdicts: [confirmed({ disagrees: true }), confirmed()] }]);

    const r = await tdd(tempFolder(t), ["route", "--json", findings]);
    const refused = await tdd(tempFolder(t), ["route", "--json", onTheFirst]);

    assert.equal(
      r.out,
      "1 → ASK · the second check disagrees with the first: the fix is larger than it says\n" +
        "2 → ASK · the second check disagrees with the first\n3 → FIX · behaviour\nFIX 1 · DECLINE 0 · ASK 2\n",
    );
    assert.equal(refused.code, 1);
    assert.equal(refused.out, "");
    assert.equal(
      refused.err,
      "ERROR: finding 4: verdicts[0].disagrees is true; only the second of two verdicts says whether it disagrees " +
        "with the first\n",
    );
  });

  test("with --reports, reads a report with a byte-order mark and CRLF line breaks, and one that is a folder as unreadable", async (t) => {
    const folder = reports(t, { 7: [REPORT.confirmed, REPORT.confirmed] });
    writeFileSync(join(folder, "7-1.md"), `﻿${REPORT.confirmed.join("\r\n")}\r\n`);
    mkdirSync(join(folder, "8-1.md"));

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "7,8"]);

    assert.equal(r.code, 0);
    assert.equal(r.out, "7 → FIX · behaviour\n8 → ASK · a check returned no result\nFIX 1 · DECLINE 0 · ASK 1\n");
    assert.match(r.err, /^route: 8-1\.md cannot be read as a report: .+\n$/);
    assert.ok(oneLine(r.err), r.err);
  });

  test("with --reports, takes the findings in the order of --ids, given at once or one by one, and only those", async (t) => {
    const folder = reports(t, {
      "B-1": [REPORT.confirmed, REPORT.confirmed],
      "B-2": [REPORT.refuted, REPORT.refuted],
      "B-3": [REPORT.confirmed, REPORT.confirmed],
    });

    const atOnce = await tdd(folder, ["route", "--reports", ".", "--ids", "B-2, B-1"]);
    const oneByOne = await tdd(folder, ["route", "--reports", folder, "--ids", "B-2", "--ids", "B-1"]);

    assert.equal(
      atOnce.out,
      "B-2 → DECLINE · refuted with evidence\nB-1 → FIX · behaviour\nFIX 1 · DECLINE 1 · ASK 0\n",
    );
    assert.equal(oneByOne.out, atOnce.out);
  });

  test("with --reports, refuses a folder that is not there, an id that is no id and an id given twice", async (t) => {
    const folder = reports(t, { 1: [REPORT.confirmed, REPORT.confirmed] });

    for (const [args, pattern] of [
      [["--reports", join(folder, "not-there"), "--ids", "1"], /^ERROR: --reports: no folder .*not-there\n$/],
      [["--reports", join(folder, "1-1.md"), "--ids", "1"], /^ERROR: --reports: no folder .*1-1\.md\n$/],
      [["--reports", folder, "--ids", "1,../1"], /^ERROR: not a finding's id: "\.\.\/1"; an id is letters, digits, /],
      [["--reports", folder, "--ids", "1,a b"], /^ERROR: not a finding's id: "a b"; /],
      [["--reports", folder, "--ids", "1,2,1"], /^ERROR: finding 1: the id is given twice\n$/],
    ]) {
      const r = await tdd(tempFolder(t), ["route", ...args]);

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.match(r.err, pattern);
      assert.ok(oneLine(r.err), r.err);
    }
  });

  // A folder of report files for --merged: 1 and 2 are fixed (2 is a docs fix), 3 and 4 declined, 5 is asked
  // about (its two checks disagree), 6 is fixed.
  const forGroups = (t) => {
    const docs = REPORT.confirmed.map((l) => l.replace("KIND: behaviour", "KIND: docs"));
    return reports(t, {
      1: [REPORT.confirmed, REPORT.confirmed],
      2: [docs, docs],
      3: [REPORT.refuted, REPORT.refuted],
      4: [REPORT.refuted, REPORT.refuted],
      5: [REPORT.confirmed, REPORT.refuted],
      6: [docs, docs],
    });
  };

  test("with --merged, sorts findings that have one cause as one: all fixed, all declined, or asked about when any is", async (t) => {
    const folder = forGroups(t);

    const r = await tdd(tempFolder(t), [
      "route",
      ...["--reports", folder, "--ids", "1,2,3,4,5,6"],
      ...["--merged", "2+1", "--merged", "3+4", "--merged", "6+5"],
    ]);

    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "");
    assert.equal(
      r.out,
      "1, 2 → FIX · behaviour\n3, 4 → DECLINE · refuted with evidence\n" +
        "5, 6 → ASK · 5: the two checks disagree on the verdict\nFIX 1 · DECLINE 1 · ASK 1\n",
    );
  });

  test("with --merged, a fixed group's kind is the first finding's unless one of them is a behaviour fix", async (t) => {
    const folder = forGroups(t);

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "6,2,1", "--merged", "6+2"]);

    assert.equal(r.out, "2, 6 → FIX · docs\n1 → FIX · behaviour\nFIX 2 · DECLINE 0 · ASK 0\n");
  });

  test("with --merged, findings of a group that come out fixed and declined are printed each on its own, with a note", async (t) => {
    const folder = forGroups(t);

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,3,6", "--merged", "3+1"]);

    assert.equal(r.code, 0, r.err);
    assert.equal(
      r.out,
      "1 → FIX · behaviour\n3 → DECLINE · refuted with evidence\n1, 3: not merged, their outcomes differ\n" +
        "6 → FIX · docs\nFIX 2 · DECLINE 1 · ASK 0\n",
    );
  });

  test("with --merged, names a group by its ids in rising order: by number, or as --ids has them when they are no numbers", async (t) => {
    const folder = reports(t, {
      2: [REPORT.confirmed, REPORT.confirmed],
      10: [REPORT.confirmed, REPORT.confirmed],
      9: [REPORT.confirmed, REPORT.confirmed],
      "B-2": [REPORT.refuted, REPORT.refuted],
      "B-10": [REPORT.refuted, REPORT.refuted],
    });

    const numbers = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "10,9,2", "--merged", "10+2+9"]);
    const names = await tdd(tempFolder(t), [
      "route",
      "--reports",
      folder,
      "--ids",
      "B-10,B-2",
      "--merged",
      " B-2 + B-10 ",
    ]);

    assert.equal(numbers.out, "2, 9, 10 → FIX · behaviour\nFIX 1 · DECLINE 0 · ASK 0\n");
    assert.equal(names.out, "B-10, B-2 → DECLINE · refuted with evidence\nFIX 0 · DECLINE 1 · ASK 0\n");
  });

  test("with --merged, refuses in one line a group of one, an id --ids does not name, and an id named twice or in two groups", async (t) => {
    const folder = forGroups(t);
    const sorted = ["--reports", folder, "--ids", "1,2,3,4"];

    for (const [args, message] of [
      [[...sorted, "--merged", "1"], "--merged 1: a group is two findings or more, as <id>+<id>"],
      [[...sorted, "--merged", "1+"], "--merged 1+: a group is two findings or more, as <id>+<id>"],
      [[...sorted, "--merged", "1,2"], "--merged 1,2: a group is two findings or more, as <id>+<id>"],
      [[...sorted, "--merged", "1+7"], "--merged 1+7: finding 7 is not among --ids"],
      [[...sorted, "--merged", "1+2+1"], "--merged 1+2+1: finding 1 is named twice"],
      [[...sorted, "--merged", "1+2", "--merged", "3+2"], "--merged 1+2 and --merged 3+2: finding 2 is in two groups"],
      [
        ["--json", FINDINGS, "--merged", "B-1+B-2"],
        "--merged goes with --reports <folder> and --ids: it names findings there that have one cause",
      ],
      [
        ["--change", CHANGE, "--chapter", "B", "--merged", "B-1+B-2"],
        "--merged goes with --reports <folder> and --ids: it names findings there that have one cause",
      ],
    ]) {
      const r = await tdd(tempFolder(t), ["route", ...args]);

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.equal(r.err, `ERROR: ${message}\n`);
    }
  });

  test("with --missing, sorts a finding for which a check returned nothing as one without results, whatever files an earlier start left", async (t) => {
    const folder = forGroups(t);
    const before = readdirSync(folder);

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2,3,4", "--missing", "1, 3"]);
    const oneByOne = await tdd(tempFolder(t), [
      "route",
      ...["--reports", folder, "--ids", "1,2,3,4"],
      ...["--missing", "1", "--missing", "3"],
    ]);
    const none = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "1,2", "--missing", ""]);

    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "", "the files of 1 and 3 are not read, so nothing is said of them");
    assert.equal(
      r.out,
      "1 → ASK · a check returned no result\n2 → FIX · docs\n3 → ASK · a check returned no result\n" +
        "4 → DECLINE · refuted with evidence\nFIX 1 · DECLINE 1 · ASK 2\n",
    );
    assert.equal(oneByOne.out, r.out);
    assert.equal(
      none.out,
      "1 → FIX · behaviour\n2 → FIX · docs\nFIX 2 · DECLINE 0 · ASK 0\n",
      "no id: none is missing",
    );
    assert.deepEqual(readdirSync(folder), before, "the folder is left as it was");
  });

  test("with --missing and --merged, a group asks when one of its findings is missing", async (t) => {
    const folder = forGroups(t);

    const r = await tdd(tempFolder(t), [
      "route",
      ...["--reports", folder, "--ids", "1,2,6", "--merged", "1+2", "--missing", "2"],
    ]);

    assert.equal(r.out, "1, 2 → ASK · 2: a check returned no result\n6 → FIX · docs\nFIX 1 · DECLINE 0 · ASK 1\n");
  });

  test("with --missing, refuses in one line an id --ids does not name, and the option without --reports", async (t) => {
    const folder = forGroups(t);
    const goesWith =
      "--missing goes with --reports <folder> and --ids: it names findings there for which a check returned nothing";

    for (const [args, message] of [
      [["--reports", folder, "--ids", "1,2", "--missing", "2,9"], "--missing: finding 9 is not among --ids"],
      [["--json", FINDINGS, "--missing", "B-1"], goesWith],
      [["--change", CHANGE, "--chapter", "B", "--missing", "B-1"], goesWith],
    ]) {
      const r = await tdd(tempFolder(t), ["route", ...args]);

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.equal(r.err, `ERROR: ${message}\n`);
    }
  });

  test("refuses the whole input in one line that names the finding and the field, and prints no outcome", async (t) => {
    const dir = tempFolder(t);
    const wrong = JSON.stringify([
      { id: "B-1", verdicts: [confirmed()] },
      { id: "B-2", verdicts: [confirmed({ size: "huge" })] },
    ]);
    write(dir, "results.json", wrong);

    for (const [args, input] of [
      [["--json", wrong], ""],
      [["--in", "results.json"], ""],
      [["--stdin"], wrong],
    ]) {
      const r = await tdd(dir, ["route", ...args], { input });

      assert.equal(r.code, 1, args[0]);
      assert.equal(r.out, "");
      assert.equal(
        r.err,
        'ERROR: finding B-2: verdicts[0].size is "huge"; it is one of: small, medium, large\n',
        args[0],
      );
    }
  });

  test("fails with one line for input that is no JSON, an empty one, and a file that is not there", async (t) => {
    const dir = tempFolder(t);

    for (const [args, input, pattern] of [
      [["--json", "B-1: confirmed"], "", /^ERROR: the input is not JSON: /],
      [["--json", ""], "", /^ERROR: the input is not JSON: /],
      [["--stdin"], "", /^ERROR: the input is not JSON: /],
      [["--json", '{"id":"B-1"}'], "", /^ERROR: the input is not a JSON array of findings\n$/],
      [["--in", "not-there.json"], "", /^ERROR: --in: no file not-there\.json\n$/],
      [["--in", "."], "", /^ERROR: --in: no file \.\n$/],
    ]) {
      const r = await tdd(dir, ["route", ...args], { input });

      assert.equal(r.code, 1, args.join(" "));
      assert.equal(r.out, "");
      assert.match(r.err, pattern);
      assert.ok(oneLine(r.err), r.err);
    }
  });
});

describe("report", { concurrency: true }, () => {
  // A check's report as review-verifier.md shapes it, for the finding `id`; `change` replaces or drops (null) the
  // line of a label, and `more` follows the last line (the second check's FIRST PASS line).
  const reportLines = (id, { change = {}, more = [] } = {}) =>
    [
      `ID: ${id}`,
      "VERDICT: confirmed",
      "EVIDENCE: src/App/Mapping.cs:19, and the test A_made_up_test",
      "SEVERITY: important",
      "KIND: behaviour",
      "FIX: local · small · spec behaviour no · contract change no · return the field from the mapping",
      "BUILDS ON IT: not applicable",
      "ALSO NOTICED: nothing",
      "NOTE: The reviewer read the made-up mapping right.",
      ...more,
    ]
      .map((line) => {
        const label = Object.keys(change).find((l) => line.startsWith(`${l}:`));
        return label === undefined ? line : change[label];
      })
      .filter((line) => line !== null);
  const reportText = (id, how) => `${reportLines(id, how).join("\n")}\n`;
  const FIRST_PASS = ["FIRST PASS: disagrees: the fix also changes the made-up contract"];
  const save = (cwd, file, input) => tdd(cwd, ["report", "--file", file, "--stdin"], { input });
  // Every file and folder under a folder, git's own among them: a refused command must have added none.
  const allIn = (folder) => readdirSync(folder, { recursive: true }).map(slashed).sort();

  test("saves a first check's report as the file named, creating its folder, and needs no change and no repository", async (t) => {
    const outside = tempFolder(t);
    const file = join(tempFolder(t), "triage-review", "109", "reports", "3-1.md");

    const r = await save(outside, file, reportText("3"));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.err, "");
    assert.equal(r.out, `report: ${slashed(file)} | confirmed\n`);
    assert.equal(readFileSync(file, "utf8"), reportText("3"));
    assert.deepEqual(readdirSync(join(file, "..")), ["3-1.md"], "no temporary file is left");
    assert.deepEqual(readdirSync(outside), []);
  });

  test("saves a second check's report, which ends with its FIRST PASS line, and prints its verdict", async (t) => {
    const folder = tempFolder(t);
    const refuted = reportText("B-2", {
      change: {
        VERDICT: "VERDICT: refuted",
        EVIDENCE: "EVIDENCE: design.md D4 decides it",
        KIND: "KIND: not applicable",
      },
      more: FIRST_PASS,
    });

    const agreed = await save(folder, join(folder, "3-2.md"), reportText("3", { more: ["FIRST PASS: agrees"] }));
    const disagreed = await save(folder, join(folder, "B-2-2.md"), refuted);
    const unsure = await save(
      folder,
      join(folder, "14-1.md"),
      reportText("14", { change: { VERDICT: "VERDICT: unsure" } }),
    );

    assert.equal(agreed.out, `report: ${slashed(join(folder, "3-2.md"))} | confirmed\n`, agreed.err);
    assert.equal(disagreed.out, `report: ${slashed(join(folder, "B-2-2.md"))} | refuted\n`, disagreed.err);
    assert.equal(unsure.out, `report: ${slashed(join(folder, "14-1.md"))} | unsure\n`, unsure.err);
    assert.equal(read(folder, "B-2-2.md"), refuted);
    assert.deepEqual(readdirSync(folder).sort(), ["14-1.md", "3-2.md", "B-2-2.md"]);
  });

  test("stores the text as given, with LF line breaks and one line break at its end", async (t) => {
    const folder = tempFolder(t);
    const lines = ["# Finding 3, first check", "", "  An indented line, and a tab\tin it.", ...reportLines("3")];

    const crlf = await save(folder, join(folder, "3-1.md"), `﻿${lines.join("\r\n")}\r\n\r\n  \r\n`);
    const bare = await save(folder, join(folder, "4-1.md"), reportLines("4").join("\n"));

    assert.equal(crlf.code, 0, crlf.err);
    assert.equal(read(folder, "3-1.md"), `${lines.join("\n")}\n`);
    assert.equal(bare.code, 0, bare.err);
    assert.equal(read(folder, "4-1.md"), `${reportLines("4").join("\n")}\n`);
  });

  test("writes a corrected report over the one it saved before", async (t) => {
    const folder = tempFolder(t);
    const file = join(folder, "3-1.md");
    await save(folder, file, reportText("3"));
    const corrected = reportText("3", { change: { KIND: "KIND: docs" } });

    const r = await save(folder, file, corrected);

    assert.equal(r.code, 0, r.err);
    assert.equal(read(folder, "3-1.md"), corrected);
    assert.deepEqual(readdirSync(folder), ["3-1.md"]);
  });

  test("takes the path with either kind of slash, and --change, --pr and --root without looking at them", async (t) => {
    const folder = tempFolder(t);
    const outside = tempFolder(t);

    for (const [n, more] of [
      ["--change", "c901-not-there"],
      ["--pr", "not-started"],
      ["--root", outside],
    ].entries()) {
      const file = join(folder, "reports", `${n + 1}-1.md`);

      const r = await tdd(outside, ["report", ...more, "--file", slashed(file), "--stdin"], {
        input: reportText(String(n + 1)),
      });

      assert.equal(r.out, `report: ${slashed(file)} | confirmed\n`, r.err);
      assert.equal(readFileSync(file, "utf8"), reportText(String(n + 1)));
    }
    assert.deepEqual(readdirSync(outside), []);
  });

  test("what it saves is what `route --reports` reads", async (t) => {
    const work = tempFolder(t);
    const folder = join(work, "reports");
    for (const [name, text] of [
      ["3-1.md", reportText("3")],
      ["3-2.md", reportText("3", { more: ["FIRST PASS: agrees"] })],
      ["4-1.md", reportText("4")],
      ["4-2.md", reportText("4", { more: FIRST_PASS })],
    ]) {
      assert.equal((await save(work, join(folder, name), text)).code, 0, name);
    }

    const r = await tdd(tempFolder(t), ["route", "--reports", folder, "--ids", "3,4"]);

    assert.equal(r.err, "");
    assert.equal(
      r.out,
      "3 → FIX · behaviour\n" +
        "4 → ASK · the second check disagrees with the first: the fix also changes the made-up contract\n" +
        "FIX 1 · DECLINE 0 · ASK 1\n",
    );
  });

  describe("refuses, in one line, and writes nothing", { concurrency: true }, () => {
    const refused = (r, message) => {
      assert.equal(r.code, 1, r.out + r.err);
      assert.equal(r.out, "");
      if (typeof message === "string") assert.equal(r.err, `ERROR: ${message}\n`);
      else assert.match(r.err, message);
      assert.ok(oneLine(r.err), r.err);
    };
    // The refusal of a path inside a repository, which names the repository's folder.
    const INSIDE =
      /^ERROR: --file lies inside a repository: a report is saved outside every repository, in the triage's work folder or, in an apply, in the chapter's reports folder \(the repository: (.+)\)\n$/;
    const refusedAsInside = (r, repository) => {
      refused(r, INSIDE);
      samePath(INSIDE.exec(r.err)[1], repository);
    };

    test("a text that cannot be read as a report, naming the line that is wrong", async (t) => {
      const folder = tempFolder(t);
      const first = (how) => save(folder, join(folder, "3-1.md"), reportText("3", how));
      const second = (how) => save(folder, join(folder, "3-2.md"), reportText("3", how));
      const not = (name, why) => `not saved: ${name} cannot be read as a report: ${why}`;

      refused(await save(folder, join(folder, "3-1.md"), ""), not("3-1.md", "it has no ID line"));
      refused(await save(folder, join(folder, "3-1.md"), "The finding is real.\n"), not("3-1.md", "it has no ID line"));
      refused(await first({ change: { ID: null } }), not("3-1.md", "it has no ID line"));
      refused(
        await first({ change: { ID: "ID: 4" } }),
        not("3-1.md", 'ID is "4"; it is 3, the finding that 3-1.md is about'),
      );
      refused(await first({ change: { VERDICT: null } }), not("3-1.md", "it has no VERDICT line"));
      refused(
        await first({ change: { VERDICT: "VERDICT: real" } }),
        not("3-1.md", 'VERDICT is "real"; it is one of: confirmed, refuted, unsure'),
      );
      refused(await first({ change: { EVIDENCE: null } }), not("3-1.md", "it has no EVIDENCE line"));
      refused(
        await first({ change: { KIND: "KIND: bug" } }),
        not("3-1.md", 'KIND is "bug"; it is one of: behaviour, test-quality, docs, cleanup'),
      );
      refused(
        await first({ change: { FIX: "FIX: local · tiny · spec behaviour no · contract change no · x" } }),
        not("3-1.md", `FIX's second part is "tiny"; it is one of: small, medium, large`),
      );
      refused(await first({ more: ["VERDICT: refuted"] }), not("3-1.md", "VERDICT is given twice"));
      refused(
        await first({ more: ["FIRST PASS: agrees"] }),
        not("3-1.md", "it has a FIRST PASS line, which only a second check's report has"),
      );
      refused(
        await second(),
        not(
          "3-2.md",
          "it has no FIRST PASS line, which a second check's report ends with: agrees | disagrees: <on what>",
        ),
      );
      refused(
        await second({ more: ["FIRST PASS: disagrees"] }),
        not("3-2.md", 'FIRST PASS is "disagrees"; it is agrees | disagrees: <on what>'),
      );
      assert.deepEqual(readdirSync(folder), []);
    });

    test("a text that cannot be read, leaving the report saved before as it was", async (t) => {
      const folder = tempFolder(t);
      await save(folder, join(folder, "3-1.md"), reportText("3"));

      const r = await save(folder, join(folder, "3-1.md"), reportText("3", { change: { KIND: "KIND: bug" } }));

      assert.equal(r.code, 1);
      assert.equal(read(folder, "3-1.md"), reportText("3"));
      assert.deepEqual(readdirSync(folder), ["3-1.md"]);
    });

    test("a path that is not absolute, and a file's name of another form", async (t) => {
      const folder = tempFolder(t);

      refused(await save(folder, "reports/3-1.md", reportText("3")), '--file is an absolute path: "reports/3-1.md"');
      refused(await save(folder, "3-1.md", reportText("3")), '--file is an absolute path: "3-1.md"');
      for (const name of ["3.md", "3-3.md", "3-1.txt", "notes.md", "3-1.md.sh", "run.cmd"]) {
        refused(
          await save(folder, join(folder, name), reportText("3")),
          `--file is named <id>-1.md for a first check's report and <id>-2.md for a second's: "${name}"`,
        );
      }
      assert.deepEqual(readdirSync(folder), []);
    });

    test("a call without --stdin or without --file, and a --file that is a folder", async (t) => {
      const folder = tempFolder(t);
      mkdirSync(join(folder, "3-1.md"));

      refused(
        await tdd(folder, ["report", "--file", join(folder, "4-1.md")], { input: reportText("4") }),
        "report needs --stdin: the report's text comes on standard input",
      );
      refused(
        await tdd(folder, ["report", "--stdin"], { input: reportText("4") }),
        "report needs --file <absolute path>: where the report is saved",
      );
      refused(
        await save(folder, join(folder, "3-1.md"), reportText("3")),
        `--file is a file, and ${slashed(join(folder, "3-1.md"))} is a folder`,
      );
      assert.deepEqual(readdirSync(folder), ["3-1.md"]);
    });

    test("a path inside the repository: in the working tree, in a folder that is not there yet, and in git's own folder", async (t) => {
      const dir = repository(t);
      const before = allIn(dir);

      for (const file of [
        join(dir, "3-1.md"),
        join(dir, "src", "App", "3-1.md"),
        join(dir, "not", "there", "yet", "3-1.md"),
        join(dir, FOLDER, "3-2.md"),
      ]) {
        const text = reportText("3", { more: file.endsWith("-2.md") ? FIRST_PASS : [] });
        refusedAsInside(await save(dir, file, text), dir);
        refusedAsInside(await save(tempFolder(t), file, text), dir);
      }
      refusedAsInside(await save(dir, join(dir, ".git", "tdd", "3-1.md"), reportText("3")), join(dir, ".git"));
      assert.deepEqual(allIn(dir), before);
      assert.deepEqual(await status(dir), []);
    });

    test("a path that reaches the repository through `..` or through a link", async (t) => {
      const dir = repository(t);
      const outside = tempFolder(t);
      symlinkSync(join(dir, "src"), join(outside, "link"), "junction");
      symlinkSync(dir, join(outside, "whole"), "junction");
      const before = allIn(dir);

      for (const file of [
        `${outside}${sep}..${sep}${basename(dir)}${sep}3-1.md`,
        `${outside}${sep}reports${sep}..${sep}..${sep}${basename(dir)}${sep}src${sep}3-1.md`,
        join(outside, "link", "3-1.md"),
        join(outside, "link", "App", "New", "3-1.md"),
        join(outside, "whole", "3-1.md"),
      ]) {
        refusedAsInside(await save(outside, file, reportText("3")), dir);
      }
      assert.deepEqual(allIn(dir), before);
      assert.deepEqual(readdirSync(outside).sort(), ["link", "whole"]);
    });

    test("a path inside a linked working tree, also when the command runs in another", async (t) => {
      const dir = repository(t);
      const linked = join(tempFolder(t), "linked");
      await git(dir, "worktree", "add", "--quiet", "-b", "feat/c901-another-made-up-thing", linked);

      refusedAsInside(await save(dir, join(linked, "reports", "3-1.md"), reportText("3")), linked);
      refusedAsInside(await save(linked, join(dir, "reports", "3-1.md"), reportText("3")), dir);
      assert.equal(existsSync(join(linked, "reports")), false);
      assert.equal(existsSync(join(dir, "reports")), false);
    });
  });
});

describe("a chapter review: reports, review and route --chapter", { concurrency: true }, () => {
  // Where a test's reports go: the commands keep them under the OS temp folder, which these variables name.
  const tempEnv = (dir) => ({ TEMP: dir, TMP: dir, TMPDIR: dir });
  // The folder's name is the chapter's in lower case, whatever the case the chapter is named in.
  const reportsOf = (temp, chapter = "B", change = CHANGE) =>
    join(temp, "tdd-runs", change, "reports", chapter.toLowerCase());
  const SECTION = "Chapter B review";

  // The lines of a verifier's report, by its verdict; `ID:` is put before them.
  const REPORT = {
    confirmed: [
      "VERDICT: confirmed",
      "EVIDENCE: src/App/Mapping.cs:12, and the test A_made_up_test",
      "SEVERITY: important",
      "KIND: behaviour",
      "FIX: local · small · spec behaviour no · contract change no · return nothing for a missing balance",
    ],
    refuted: ["VERDICT: refuted", "EVIDENCE: Mapping.cs:31 rounds once", "KIND: not applicable", "FIX: not applicable"],
    unsure: ["VERDICT: unsure"],
  };
  const docs = REPORT.confirmed.map((l) => l.replace("KIND: behaviour", "KIND: docs"));
  const notLocal = REPORT.confirmed.map((l) => l.replace("FIX: local", "FIX: not local"));

  // The reports folder of chapter B under `temp`, holding these findings' reports (the lines of each, by its id).
  function withReports(temp, findings, chapter = "B") {
    const folder = reportsOf(temp, chapter);
    mkdirSync(folder, { recursive: true });
    for (const [id, lines] of Object.entries(findings)) {
      write(folder, `${id}-1.md`, `# Finding ${id}\n\nID: ${id}\n${lines.join("\n")}\n\nALSO NOTICED: —\n`);
    }
    return folder;
  }

  // A record of chapter B: its two lines at the top (`counts` is the FINDINGS line without its label), then the
  // findings' lines.
  const record = (counts, ...lines) =>
    ["REVIEW: chapter B, 1a2b3c4..5d6e7f8, 6 commits, 9 files changed", `FINDINGS: ${counts}`, "", ...lines, ""].join(
      "\n",
    );
  const B1 = [
    "B-1 · important · confirmed · behaviour · src/App/Mapping.cs:12 · in the chapter",
    "  DEFECT: A missing balance maps to zero.",
    "  SCENARIO: A made-up account without a balance, then 0 is shown.",
    "  FIX: local · small · spec behaviour no · contract change no · return nothing for a missing balance",
    "  VERIFIER: MappingTests.cs:40 covers no missing balance.",
    "  BUILDS ON IT: nothing",
  ];
  const B2 = [
    "B-2 · not applicable · refuted · not applicable · src/App/Mapping.cs:30 · in the chapter",
    "  DEFECT: The amount is rounded twice.",
    "  VERIFIER: Mapping.cs:31 rounds once; the second call is a format.",
  ];
  const TWO = record("2 · confirmed 1 · refuted 1 · unsure 0 · no report 0", ...B1, "", ...B2);

  const reviewed = (dir, temp, text, more = {}) =>
    tdd(dir, withChange("review", { chapter: "B", stdin: true, ...more }), { input: text, env: tempEnv(temp) });
  const routedChapter = (dir, temp, chapter = "B") =>
    tdd(dir, ["route", "--change", CHANGE, "--chapter", chapter], { env: tempEnv(temp) });
  const refused = (r, message) => {
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, "");
    if (typeof message === "string") assert.equal(r.err, `ERROR: ${message}\n`);
    else assert.match(r.err, message);
    assert.ok(oneLine(r.err), r.err);
  };

  describe("reports", { concurrency: true }, () => {
    test("prints the chapter's reports folder under the temp folder's tdd-runs, with forward slashes, and creates it", async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);

      const r = await tdd(dir, withChange("reports", { chapter: "B" }), { env: tempEnv(temp) });

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, `${slashed(reportsOf(temp))}\n`);
      assert.ok(r.out.endsWith(`/tdd-runs/${CHANGE}/reports/b\n`), r.out);
      assert.equal(r.out.includes("\\"), false);
      assert.deepEqual(readdirSync(reportsOf(temp)), []);
      assert.deepEqual(await status(dir), [], "nothing in the working tree, and it needs no state file");
      assert.equal(existsSync(gitFolder(dir)), false, "no lock is taken");
    });

    test("names one folder for a chapter whatever the case its name is given in, as its section is one", async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);
      const of = (chapter) => tdd(dir, withChange("reports", { chapter }), { env: tempEnv(temp) });

      const [upper, lower, word] = [await of("B2"), await of("b2"), await of("Acceptance")];

      assert.equal(upper.out, lower.out);
      assert.ok(upper.out.endsWith("/reports/b2\n"), upper.out);
      assert.ok(word.out.endsWith("/reports/acceptance\n"), word.out);
      assert.deepEqual(readdirSync(join(temp, "tdd-runs", CHANGE, "reports")).sort(), ["acceptance", "b2"]);
    });

    test("keeps what the folder holds, and each chapter has its own", async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, { "B-1": REPORT.confirmed });

      const again = await tdd(dir, withChange("reports", { chapter: "B" }), { env: tempEnv(temp) });
      const other = await tdd(dir, withChange("reports", { chapter: "acceptance" }), { env: tempEnv(temp) });

      assert.equal(again.out, `${slashed(folder)}\n`);
      assert.deepEqual(readdirSync(folder), ["B-1-1.md"]);
      assert.equal(other.out, `${slashed(reportsOf(temp, "acceptance"))}\n`);
      assert.deepEqual(readdirSync(join(temp, "tdd-runs", CHANGE, "reports")).sort(), ["acceptance", "b"]);
    });

    test("with --new, empties the chapter's folder first, and nothing else under tdd-runs", async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted });
      const earlier = withReports(temp, { "A-1": REPORT.refuted }, "A");
      write(join(temp, "tdd-runs", CHANGE), "20261125-101500-unit.log", "a log of run\n");

      const r = await tdd(dir, withChange("reports", { chapter: "B", new: true }), { env: tempEnv(temp) });
      const fresh = await tdd(dir, withChange("reports", { chapter: "C", new: true }), { env: tempEnv(temp) });

      assert.equal(r.out, `${slashed(folder)}\n`);
      assert.deepEqual(readdirSync(folder), []);
      assert.deepEqual(readdirSync(earlier), ["A-1-1.md"]);
      assert.equal(read(join(temp, "tdd-runs", CHANGE), "20261125-101500-unit.log"), "a log of run\n");
      assert.equal(fresh.out, `${slashed(reportsOf(temp, "C"))}\n`, "a folder that is not there yet is created");
    });

    test("names a folder that report saves into: outside every repository", async (t) => {
      const dir = repository(t);
      const temp = tempFolder(t);
      const folder = (
        await tdd(dir, withChange("reports", { chapter: "B", new: true }), { env: tempEnv(temp) })
      ).out.trim();

      const r = await tdd(dir, ["report", "--file", `${folder}/B-1-1.md`, "--stdin"], {
        input: `ID: B-1\n${REPORT.confirmed.join("\n")}\n`,
      });

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, `report: ${folder}/B-1-1.md | confirmed\n`);
    });

    test("is refused, in one line, without a chapter, for a name that is no chapter's, and for a triage", async (t) => {
      const { dir } = await triaging(t);
      const temp = tempFolder(t);
      const env = tempEnv(temp);
      const CHAPTER =
        /^ERROR: --chapter <X> is the chapter's name, one word of letters, digits, dots, dashes and underscores such as A, B2 or acceptance/;

      refused(await tdd(dir, withChange("reports"), { env }), CHAPTER);
      for (const chapter of ["../B", "B/2", "a b", ".", " ", "A.", "A..", ".A", "A-", "_A", "chapter A"]) {
        refused(await tdd(dir, withChange("reports", { chapter }), { env }), CHAPTER);
      }
      refused(await tdd(dir, withChange("reports", { chapter: "A." }), { env }), /: "A\."\n$/);
      refused(
        await tdd(dir, withPr("reports", { chapter: "B" }), { env }),
        "reports is the apply's: it takes --change",
      );
      refused(
        await tdd(dir, ["reports", "--chapter", "B"], { env }),
        "reports needs --change <change-name>: it is the apply's",
      );
      refused(
        await tdd(dir, ["reports", "--change", "c901-not-there", "--chapter", "B"], { env }),
        /^ERROR: no change folder /,
      );
      assert.deepEqual(readdirSync(temp), [], "every one of them had the temp folder, and made nothing in it");
      assert.equal((await tdd(dir, withChange("reports", { chapter: "A.1_b-2" }), { env })).code, 0);
      assert.deepEqual(readdirSync(join(temp, "tdd-runs", CHANGE, "reports")), ["a.1_b-2"]);
    });
  });

  describe("review", { concurrency: true }, () => {
    test("records the reviewer's record in the reviews file, once it agrees with the reports, and says what it holds", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted });
      await tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: "clean" }));
      const before = read(dir, REVIEWS);

      const r = await reviewed(dir, temp, TWO);

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, "review: chapter B | 2 findings · confirmed 1 · refuted 1 · unsure 0 · no report 0\n");
      const text = read(dir, REVIEWS);
      assert.equal(sectionBody(text, SECTION), TWO.trim());
      assert.deepEqual(sectionNames(text), ["Chapter A", SECTION]);
      assert.ok(text.startsWith(before.trimEnd()), "the other sections keep every byte");
      assert.deepEqual(leftInGitFolder(dir), [], "no lock is left");
    });

    test("creates the reviews file when it is the first to write it, and takes a record without findings", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      const none = record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0");

      const r = await reviewed(dir, temp, none);

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, "review: chapter B | 0 findings · confirmed 0 · refuted 0 · unsure 0 · no report 0\n");
      assert.equal(sectionBody(read(dir, REVIEWS), SECTION), none.trim());
      assert.equal(existsSync(reportsOf(temp)), false, "it creates no reports folder");
    });

    test("replaces the chapter's record when the review runs again", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted });
      await reviewed(dir, temp, TWO);
      const one = record("1 · confirmed 1 · refuted 0 · unsure 0 · no report 0", ...B1);
      // The review that runs again empties the folder first (`reports --new`), and has its own reports.
      rmSync(join(folder, "B-2-1.md"));

      const r = await reviewed(dir, temp, one);

      assert.equal(r.out, "review: chapter B | 1 finding · confirmed 1 · refuted 0 · unsure 0 · no report 0\n");
      assert.equal(sectionBody(read(dir, REVIEWS), SECTION), one.trim());
    });

    test("takes no report for a finding whose report is missing or cannot be read, and a finding merged into another", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      withReports(temp, { "B-1": REPORT.confirmed, "B-3": docs, "B-5": ["The finding is real."] });
      const text = record(
        "3 · confirmed 1 · refuted 0 · unsure 0 · no report 2",
        ...B1,
        "  MERGED: B-3 · src/App/Mapping.cs:44",
        "  AFFECTS: B-5: its fix moves the method this one changes.",
        "B-4 · not applicable · no report · not applicable · src/App/Other.cs:3 · outside",
        "B-5 · not applicable · no report · not applicable · src/App/Other.cs:9 · in the chapter",
      );

      const r = await reviewed(dir, temp, text);

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, "review: chapter B | 3 findings · confirmed 1 · refuted 0 · unsure 0 · no report 2\n");
    });

    test("takes the chapter's name whatever its case: one section and one reports folder for B and b", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted });
      const one = record("1 · confirmed 1 · refuted 0 · unsure 0 · no report 0", ...B1);

      const upper = await reviewed(dir, temp, TWO);
      rmSync(join(folder, "B-2-1.md")); // the review that runs again has its own reports
      const lower = await reviewed(dir, temp, one, { chapter: "b" });
      const sorted = await routedChapter(dir, temp, "b");

      assert.equal(upper.code, 0, upper.err);
      assert.equal(lower.out, "review: chapter b | 1 finding · confirmed 1 · refuted 0 · unsure 0 · no report 0\n");
      assert.deepEqual(sectionNames(read(dir, REVIEWS)), [SECTION], "the same section, under the name it had");
      assert.equal(sectionBody(read(dir, REVIEWS), SECTION), one.trim());
      assert.equal(sorted.out, "B-1 → FIX · behaviour\nFIX 1 · DECLINE 0 · ASK 0\n");
    });

    test("takes a report file whose name differs from its finding's in the case of its letters alone as that finding's where the disk does not tell the two apart, and as no report where it does", async (t) => {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted });
      renameSync(join(folder, "B-2-1.md"), join(folder, "b-2-1.md"));
      const caseBlind = existsSync(join(folder, "B-2-1.md"));

      const r = await reviewed(dir, temp, TWO);

      if (caseBlind) {
        assert.equal(r.code, 0, r.err);
      } else {
        refused(
          r,
          `not recorded: line 11: finding B-2 says refuted, and it has no report B-2-1.md in ${slashed(folder)}; a ` +
            'finding whose verifier never reported says "no report"',
        );
      }
    });

    describe(
      "refuses, in one line that names the line and the finding, and writes nothing",
      { concurrency: true },
      () => {
        // An apply whose chapter B has the reports of B-1 (confirmed) and B-2 (refuted), changed by `reports`.
        async function chapter(t, reports = {}) {
          const dir = await initialized(t);
          const temp = tempFolder(t);
          const folder = withReports(temp, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted, ...reports });
          return { dir, temp, folder };
        }
        const nothingWritten = (dir) => assert.equal(existsSync(join(dir, REVIEWS)), false);

        test("a text that is not the record: its first line, its counts, a finding's first line", async (t) => {
          const { dir, temp } = await chapter(t);

          for (const [text, pattern] of [
            ["", /^ERROR: not recorded: the record is empty; it starts with "REVIEW: chapter B, …"\n$/],
            [
              TWO.replace("chapter B,", "chapter C,"),
              /^ERROR: not recorded: line 1: "REVIEW: chapter C, .*" is not the record's first line; /,
            ],
            [
              TWO.replace("FINDINGS: 2", "FINDINGS: 3"),
              /^ERROR: not recorded: line 2: FINDINGS says 3 · confirmed 1 · .*, and the findings' first lines say 2 · /,
            ],
            [
              TWO.replace("B-1 · important", "B-1 · major"),
              /^ERROR: not recorded: line 4: finding B-1: its second part is "major"; it is one of: important, nit, not applicable\n$/,
            ],
            [
              TWO.replace(" · in the chapter\n  DEFECT: A missing", "\n  DEFECT: A missing"),
              /^ERROR: not recorded: line 4: ".*" has 5 parts, and a finding's first line has six: .*; a line of a finding's details starts with two spaces\n$/,
            ],
          ]) {
            refused(await reviewed(dir, temp, text), pattern);
          }
          nothingWritten(dir);
        });

        test("a verdict or a confirmed finding's kind that is not its report's", async (t) => {
          const { dir, temp } = await chapter(t, { "B-1": docs, "B-2": REPORT.unsure });

          refused(
            await reviewed(dir, temp, TWO),
            "not recorded: line 4: finding B-1 says behaviour, and its report B-1-1.md says KIND: docs",
          );
          refused(
            await reviewed(dir, temp, TWO.replace("confirmed · behaviour", "confirmed · docs")),
            "not recorded: line 11: finding B-2 says refuted, and its report B-2-1.md says unsure",
          );
          nothingWritten(dir);
        });

        test("a verdict for a finding without a report, naming the folder, and no report for one that has a report", async (t) => {
          const { dir, temp, folder } = await chapter(t);
          rmSync(join(folder, "B-2-1.md"));
          const noReport = TWO.replace(
            "important · confirmed · behaviour",
            "not applicable · no report · not applicable",
          ).replace(
            "FINDINGS: 2 · confirmed 1 · refuted 1 · unsure 0 · no report 0",
            "FINDINGS: 2 · confirmed 0 · refuted 1 · unsure 0 · no report 1",
          );

          refused(
            await reviewed(dir, temp, TWO),
            `not recorded: line 11: finding B-2 says refuted, and it has no report B-2-1.md in ${slashed(folder)}; a finding ` +
              'whose verifier never reported says "no report"',
          );
          refused(
            await reviewed(dir, temp, noReport),
            'not recorded: line 4: finding B-1 says "no report", and its report B-1-1.md is there and says confirmed',
          );
          nothingWritten(dir);
        });

        test("a verdict for a finding whose report cannot be read", async (t) => {
          const { dir, temp } = await chapter(t, { "B-1": ["The finding is real."] });

          refused(
            await reviewed(dir, temp, TWO),
            'not recorded: line 4: finding B-1 says confirmed, and its report B-1-1.md cannot be read, which makes it "no ' +
              'report": it has no VERDICT line',
          );
          nothingWritten(dir);
        });

        test("a merged finding with a first line of its own, without a report, or with another verdict", async (t) => {
          const { dir, temp, folder } = await chapter(t, { "B-3": REPORT.refuted });
          const merged = record(
            "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0",
            ...B1,
            "  MERGED: B-3 · src/App/Mapping.cs:44",
          );

          refused(
            await reviewed(dir, temp, merged),
            "not recorded: line 4: finding B-1 (line 10) names B-3 as merged into it, and its report B-3-1.md says " +
              "refuted, not confirmed: findings are merged only when their verdicts are the same",
          );
          refused(
            await reviewed(dir, temp, merged.replace("B-3", "B-4")),
            `not recorded: line 4: finding B-1 (line 10) names B-4 as merged into it, and B-4 has no report B-4-1.md in ${slashed(folder)}`,
          );
          refused(
            await reviewed(dir, temp, TWO.replace("  BUILDS ON IT: nothing", "  MERGED: B-2 · src/App/Mapping.cs:30")),
            /^ERROR: not recorded: line 9: finding B-1: MERGED names B-2, which has a first line of its own \(line 11\); /,
          );
          nothingWritten(dir);
        });

        test("a MERGED line that names more than one finding, an AFFECTS line that names none of the record, and a REVIEWER DISAGREES line that says nothing", async (t) => {
          const { dir, temp } = await chapter(t, { "B-3": REPORT.confirmed });
          const withLine = (line) => TWO.replace("  BUILDS ON IT: nothing", line);

          refused(
            await reviewed(dir, temp, withLine("  MERGED: B-3, B-4 · src/App/Mapping.cs:44")),
            'not recorded: line 9: finding B-1: "MERGED: B-3, B-4 · src/App/Mapping.cs:44" is not "MERGED: <the other ' +
              "finding's id> · <its file:line>\": one MERGED line per finding merged in",
          );
          refused(
            await reviewed(dir, temp, withLine("  AFFECTS: B-9: both fixes change the same method.")),
            "not recorded: line 9: finding B-1: AFFECTS names B-9, which is no finding of this record",
          );
          refused(
            await reviewed(dir, temp, withLine("  AFFECTS: B-2 and its fix")),
            'not recorded: line 9: finding B-1: "AFFECTS: B-2 and its fix" is not "AFFECTS: <the other finding\'s id>: ' +
              '<one sentence>"',
          );
          refused(
            await reviewed(dir, temp, withLine("  REVIEWER DISAGREES:")),
            'not recorded: line 9: finding B-1: "REVIEWER DISAGREES:" names nothing you disagree on: say it in one ' +
              "sentence, or leave the line out when you agree",
          );
          for (const [said, start] of [
            [" none", "none"],
            [" No disagreement.", "No"],
            [" —", "—"],
            [" not applicable", "not applicable"],
            [" I agree with the verifier.", "I agree"],
          ]) {
            refused(
              await reviewed(dir, temp, withLine(`  REVIEWER DISAGREES:${said}`)),
              `not recorded: line 9: finding B-1: "REVIEWER DISAGREES:${said}" names nothing you disagree on: a line ` +
                `that starts with "${start}" agrees; start your sentence otherwise, or leave the line out when you agree`,
            );
          }
          nothingWritten(dir);
        });

        test("a report file that belongs to no finding of the record: its finding left out, or named after a MERGED line's dot", async (t) => {
          const { dir, temp, folder } = await chapter(t, { "B-3": REPORT.confirmed });
          const withLine = (line) => TWO.replace("  BUILDS ON IT: nothing", line);

          refused(
            await reviewed(dir, temp, TWO),
            `not recorded: the report B-3-1.md in ${slashed(folder)} belongs to no finding of the record: give it its ` +
              "line, or merge it",
          );
          refused(
            await reviewed(dir, temp, withLine("  MERGED: B-2 · B-3")),
            'not recorded: line 9: finding B-1: "MERGED: B-2 · B-3" is not "MERGED: <the other finding\'s id> · <its ' +
              'file:line>": one MERGED line per finding merged in',
          );
          nothingWritten(dir);
          const merged = await reviewed(dir, temp, withLine("  MERGED: B-3 · src/App/Mapping.cs:44"));
          assert.equal(merged.code, 0, merged.err);
        });

        test("without --stdin or a chapter, and for a triage", async (t) => {
          const { dir } = await triaging(t);
          const temp = tempFolder(t);
          const env = tempEnv(temp);

          refused(
            await tdd(dir, withChange("review", { chapter: "B" }), { env }),
            "review needs --stdin: the record's text comes on standard input",
          );
          refused(
            await tdd(dir, withChange("review", { stdin: true }), { input: TWO, env }),
            /^ERROR: --chapter <X> is the chapter's name, /,
          );
          refused(
            await tdd(dir, withChange("review", { chapter: "B.", stdin: true }), { input: TWO, env }),
            /^ERROR: --chapter <X> is the chapter's name, .*: "B\."\n$/,
          );
          refused(
            await tdd(dir, withPr("review", { chapter: "B", stdin: true }), { input: TWO, env }),
            "review is the apply's: it takes --change",
          );
          refused(
            await tdd(dir, ["review", "--chapter", "B", "--stdin"], { input: TWO, env }),
            "review needs --change <change-name>: it is the apply's",
          );
          // A record that is refused for its reports names the folder, the one under this test's temp folder, and
          // makes none: review only reads the folder, which is not there.
          refused(
            await tdd(dir, withChange("review", { chapter: "B", stdin: true }), { input: TWO, env }),
            `not recorded: line 4: finding B-1 says confirmed, and it has no report B-1-1.md in ${slashed(reportsOf(temp))}; ` +
              'a finding whose verifier never reported says "no report"',
          );
          nothingWritten(dir);
          assert.equal(existsSync(join(temp, "tdd-runs")), false, "review made no folder");
        });
      },
    );
  });

  describe("route --change <c> --chapter <X>", { concurrency: true }, () => {
    // An apply whose chapter B is reviewed: the reports of its findings' verifiers, and the record `review` wrote.
    async function reviewedChapter(t, reports, text) {
      const dir = await initialized(t);
      const temp = tempFolder(t);
      const folder = withReports(temp, reports);
      const r = await reviewed(dir, temp, text);
      assert.equal(r.code, 0, r.err);
      return { dir, temp, folder };
    }

    test("sorts the record's findings, each by the report of its verifier, and changes nothing", async (t) => {
      const text = record(
        "5 · confirmed 3 · refuted 1 · unsure 1 · no report 0",
        ...B1,
        "",
        ...B2,
        "B-3 · nit · confirmed · docs · docs/made-up.md:3 · in the chapter",
        "  REVIEWER DISAGREES: The sentence is true as it stands.",
        "B-4 · nit · unsure · not applicable · src/App/Other.cs:5 · in the chapter",
        "B-o1 · nit · confirmed · docs · src/Other/Old.cs:7 · outside",
      );
      const { dir, temp, folder } = await reviewedChapter(
        t,
        { "B-1": REPORT.confirmed, "B-2": REPORT.refuted, "B-3": docs, "B-4": REPORT.unsure, "B-o1": docs },
        text,
      );
      const before = [read(dir, REVIEWS), read(dir, STATE), readdirSync(folder)];

      const r = await routedChapter(dir, temp);

      assert.equal(r.code, 0, r.err);
      assert.equal(r.err, "");
      assert.equal(
        r.out,
        "B-1 → FIX · behaviour\nB-2 → DECLINE · refuted with evidence\n" +
          "B-3 → ASK · the reviewer disagrees with the verifier\nB-4 → ASK · unsure\n" +
          "B-o1 → ASK · outside the chapter\nFIX 1 · DECLINE 1 · ASK 3\n",
      );
      assert.deepEqual([read(dir, REVIEWS), read(dir, STATE), readdirSync(folder)], before);
      assert.deepEqual(leftInGitFolder(dir), [], "no lock is taken");
    });

    test("sorts a finding and those merged into it as one, the kept finding's id first", async (t) => {
      const text = record(
        "3 · confirmed 3 · refuted 0 · unsure 0 · no report 0",
        "B-2 · nit · confirmed · docs · docs/made-up.md:3 · in the chapter",
        "  MERGED: B-1 · docs/made-up.md:9",
        "B-3 · important · confirmed · behaviour · src/App/Mapping.cs:12 · in the chapter",
        "  MERGED: B-5 · src/App/Mapping.cs:40",
        "  MERGED: B-4",
        "B-6 · nit · confirmed · docs · docs/other.md:1 · in the chapter",
        "  MERGED: B-7 · docs/other.md:8",
      );
      const { dir, temp } = await reviewedChapter(
        t,
        {
          "B-1": REPORT.confirmed,
          "B-2": docs,
          "B-3": REPORT.confirmed,
          "B-4": notLocal,
          "B-5": docs,
          "B-6": docs,
          "B-7": docs,
        },
        text,
      );

      const r = await routedChapter(dir, temp);

      assert.equal(r.code, 0, r.err);
      assert.equal(
        r.out,
        "B-2, B-1 → FIX · behaviour\nB-3, B-5, B-4 → ASK · B-4: the fix is not local\nB-6, B-7 → FIX · docs\n" +
          "FIX 2 · DECLINE 0 · ASK 1\n",
      );
    });

    test("takes the fix's judgement from the report file, which the record does not hold", async (t) => {
      const { dir, temp, folder } = await reviewedChapter(t, { "B-1": REPORT.confirmed, "B-2": REPORT.refuted }, TWO);
      // The same verdict and kind, as the record has them; what else the report says is the report's alone.
      withReports(temp, {
        "B-1": notLocal,
        "B-2": REPORT.refuted.map((l) => l.replace(/^EVIDENCE: .*/, "EVIDENCE: none")),
      });

      const r = await routedChapter(dir, temp);

      assert.equal(r.err, "");
      assert.equal(
        r.out,
        "B-1 → ASK · the fix is not local\nB-2 → ASK · refuted without concrete evidence\nFIX 0 · DECLINE 0 · ASK 2\n",
      );
      assert.deepEqual(readdirSync(folder).sort(), ["B-1-1.md", "B-2-1.md"]);
    });

    test("takes no report that stopped agreeing with the record: another verdict or kind, or a file that came later for a finding with no report", async (t) => {
      const text = record(
        "4 · confirmed 2 · refuted 1 · unsure 0 · no report 1",
        ...B1,
        "  MERGED: B-5 · src/App/Mapping.cs:44",
        "",
        ...B2,
        "B-3 · not applicable · no report · not applicable · src/App/Other.cs:5 · in the chapter",
        "B-4 · nit · confirmed · docs · docs/made-up.md:3 · in the chapter",
      );
      const { dir, temp } = await reviewedChapter(
        t,
        { "B-1": REPORT.confirmed, "B-5": REPORT.confirmed, "B-2": REPORT.refuted, "B-4": docs },
        text,
      );
      // Each report is written over after the record was saved, and the verifier of B-3 reports after all.
      withReports(temp, {
        "B-5": REPORT.refuted,
        "B-2": REPORT.confirmed,
        "B-3": REPORT.confirmed,
        "B-4": REPORT.confirmed,
      });

      const r = await routedChapter(dir, temp);

      assert.equal(r.code, 0, "the apply goes on, and the owner is asked");
      assert.equal(
        r.out,
        "B-1, B-5 → ASK · B-5: a check returned no result\nB-2 → ASK · a check returned no result\n" +
          "B-3 → ASK · a check returned no result\nB-4 → ASK · a check returned no result\nFIX 0 · DECLINE 0 · ASK 4\n",
      );
      assert.deepEqual(r.err.trimEnd().split("\n"), [
        "route: B-5-1.md says refuted, and the record says confirmed",
        "route: B-2-1.md says confirmed, and the record says refuted",
        "route: B-3-1.md is there and says confirmed, and the record says no report",
        "route: B-4-1.md says KIND: behaviour, and the record says docs",
      ]);
    });

    test("asks about a finding with no report, and says on stderr when a report is missing though the record has its verdict, or cannot be read", async (t) => {
      const text = record(
        "4 · confirmed 1 · refuted 1 · unsure 0 · no report 2",
        ...B1,
        "",
        ...B2,
        "B-3 · not applicable · no report · not applicable · src/App/Other.cs:5 · in the chapter",
        "B-4 · not applicable · no report · not applicable · src/App/Other.cs:9 · in the chapter",
      );
      const { dir, temp, folder } = await reviewedChapter(
        t,
        { "B-1": REPORT.confirmed, "B-2": REPORT.refuted, "B-4": ["The finding is real."] },
        text,
      );
      rmSync(join(folder, "B-1-1.md"));
      write(folder, "B-2-1.md", "The finding is not real.\n");

      const r = await routedChapter(dir, temp);

      assert.equal(r.code, 0, "the apply goes on with what it has");
      assert.equal(
        r.out,
        "B-1 → ASK · a check returned no result\nB-2 → ASK · a check returned no result\n" +
          "B-3 → ASK · a check returned no result\nB-4 → ASK · a check returned no result\nFIX 0 · DECLINE 0 · ASK 4\n",
      );
      assert.deepEqual(
        r.err.trimEnd().split("\n"),
        [
          `route: B-1-1.md is missing in ${slashed(folder)}, and the record says confirmed`,
          "route: B-2-1.md cannot be read as a report: it has no VERDICT line",
        ],
        "nothing is said of B-3 and B-4: the record says that they have no report",
      );
    });

    test("names the fixed findings that wait for an asked one their fix touches, after the outcomes and before the counts", async (t) => {
      const text = record(
        "5 · confirmed 4 · refuted 0 · unsure 1 · no report 0",
        ...B1,
        "  MERGED: B-5 · src/App/Mapping.cs:44",
        "  AFFECTS: B-3: whether B-3 holds decides how this one is fixed.",
        "B-2 · nit · confirmed · docs · docs/made-up.md:3 · in the chapter",
        "B-3 · nit · unsure · not applicable · src/App/Other.cs:5 · in the chapter",
        "  AFFECTS: B-1: its answer decides how B-1 is fixed.",
        "  AFFECTS: B-4: and how the comment of B-4 reads.",
        "B-4 · nit · confirmed · docs · src/App/Other.cs:9 · in the chapter",
        "B-6 · nit · confirmed · cleanup · src/App/Other.cs:20 · in the chapter",
        "  AFFECTS: B-2: both change the same paragraph.",
      );
      const cleanup = REPORT.confirmed.map((l) => l.replace("KIND: behaviour", "KIND: cleanup"));
      const { dir, temp } = await reviewedChapter(
        t,
        {
          "B-1": REPORT.confirmed,
          "B-5": docs,
          "B-2": docs,
          "B-3": REPORT.unsure,
          "B-4": docs,
          "B-6": cleanup,
        },
        text,
      );

      const r = await routedChapter(dir, temp);

      assert.equal(r.err, "");
      assert.equal(
        r.out,
        "B-1, B-5 → FIX · behaviour\nB-2 → FIX · docs\nB-3 → ASK · unsure\nB-4 → FIX · docs\nB-6 → FIX · cleanup\n" +
          "B-1, B-5: waits for B-3\nB-4: waits for B-3\nFIX 4 · DECLINE 0 · ASK 1\n",
        "B-6 and B-2 touch each other and are both fixed: neither waits",
      );
    });

    test("sorts a chapter without findings: the counts alone", async (t) => {
      const { dir, temp } = await reviewedChapter(
        t,
        {},
        record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0"),
      );

      const r = await routedChapter(dir, temp);

      assert.equal(r.out, "FIX 0 · DECLINE 0 · ASK 0\n");
    });

    test("is refused, in one line, without a record, for a section that is none, for a triage, and next to --ids", async (t) => {
      const { dir } = await triaging(t);
      const temp = tempFolder(t);
      assert.equal((await tdd(dir, withChange("init", SWITCHES))).code, 0);

      refused(await routedChapter(dir, temp), `no ${REVIEWS} yet: no chapter review is recorded`);
      await tdd(dir, withChange("set", { file: "reviews", section: "Chapter A review", text: "No findings." }));
      refused(
        await routedChapter(dir, temp),
        `no section "Chapter B review" in ${REVIEWS}: the chapter's reviewer records it with review`,
      );
      refused(
        await routedChapter(dir, temp, "A"),
        `the section "Chapter A review" of ${REVIEWS} is no record of a review: line 1: "No findings." is not the ` +
          'record\'s first line; it starts with "REVIEW: chapter A, …"',
      );
      refused(
        await tdd(dir, ["route", "--pr", PR, "--chapter", "B"]),
        "route --chapter is the apply's: it takes --change",
      );
      refused(
        await tdd(dir, ["route", "--chapter", "B"]),
        "route --chapter needs --change <change-name>: it is the apply's",
      );
      refused(
        await tdd(dir, ["route", "--change", CHANGE, "--chapter", "B", "--ids", "B-1"]),
        "--ids goes with --reports <folder>: it names the findings there",
      );
      refused(
        await tdd(dir, ["route", "--change", CHANGE, "--chapter", "../B"]),
        /^ERROR: --chapter <X> is the chapter's name, /,
      );
    });
  });

  test("end to end, as the reviewer, its verifiers and the main session run them: reports, report, review, route", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);
    const env = tempEnv(temp);

    const folder = (await tdd(dir, withChange("reports", { chapter: "B", new: true }), { env })).out.trim();
    for (const [id, lines] of [
      ["B-1", REPORT.confirmed],
      ["B-2", REPORT.refuted],
    ]) {
      const saved = await tdd(dir, ["report", "--file", `${folder}/${id}-1.md`, "--stdin"], {
        input: `ID: ${id}\n${lines.join("\n")}\n`,
        env,
      });
      assert.equal(saved.code, 0, saved.err);
    }
    const recorded = await reviewed(dir, temp, TWO);
    const sorted = await routedChapter(dir, temp);

    assert.equal(recorded.out, "review: chapter B | 2 findings · confirmed 1 · refuted 1 · unsure 0 · no report 0\n");
    assert.equal(
      sorted.out,
      "B-1 → FIX · behaviour\nB-2 → DECLINE · refuted with evidence\nFIX 1 · DECLINE 1 · ASK 0\n",
    );
    assert.equal(sorted.err, "");
    assert.deepEqual(
      await status(dir),
      [`?? ${REVIEWS}`, `?? ${STATE}`],
      "the reports are no files of the working tree",
    );
  });
});

describe("triage-init", { concurrency: true }, () => {
  // The keys `triage-init` writes into `Run`, in the file's order: none of them a value of this machine. The code
  // graph's project goes to the triage's local file.
  const RUN_KEYS = ["Status", "PR", "Round", "Scope", "Source", "Branch"];
  const localProject = (dir, pr = PR) =>
    keyValue(readFileSync(prLocalFile(dir, pr), "utf8"), "Run", "Code graph project");

  test("with a change, creates the state file in the change's folder and the pointer to it", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, change: CHANGE }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, startLine(`created ${TRIAGE}`, 1, work));
    const text = read(dir, TRIAGE);
    assert.equal(text.split(/\r?\n/)[0], `# Review triage: ${CHANGE}`);
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 1"]);
    assert.deepEqual(sectionKeys(text, "Run"), RUN_KEYS);
    assert.equal(keyValue(text, "Run", "Status"), "triaging");
    assert.equal(keyValue(text, "Run", "PR"), PR);
    assert.equal(keyValue(text, "Run", "Round"), "1");
    assert.equal(keyValue(text, "Run", "Scope"), "c900");
    assert.equal(keyValue(text, "Run", "Source"), "pr");
    assert.equal(keyValue(text, "Run", "Branch"), BRANCH);
    assert.equal(localProject(dir), "not indexed: skipped (TDD_NO_GRAPH=1)");
    assert.equal(
      readFileSync(prLocalFile(dir), "utf8"),
      `# This machine's values: triage-${PR}\n\n## Run\n\n- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n`,
    );
    for (const name of sectionNames(text).filter((n) => n !== "Run")) assert.equal(sectionBody(text, name), EMPTY);

    const points = pointer(dir);
    assert.deepEqual(Object.keys(points), ["pr", "round", "change", "scope", "work", "state"]);
    assert.deepEqual(
      { pr: points.pr, round: points.round, change: points.change, scope: points.scope },
      { pr: PR, round: 1, change: CHANGE, scope: "c900" },
    );
    samePath(points.work, work);
    samePath(points.state, join(dir, TRIAGE));
    assert.deepEqual(await status(dir), [`?? ${TRIAGE}`], "the pointer is not in the working tree");
    assert.deepEqual(readdirSync(work), [], "nothing is written to the work folder");
  });

  test("holds no value of this machine in the state file: not the work folder, the repository's, or the code graph's project", async (t) => {
    for (const of of ["change", "none"]) {
      const { dir, work, state } = await triaging(t, of);

      const text = readFileSync(state, "utf8");

      assert.deepEqual(sectionKeys(text, "Run"), RUN_KEYS, of);
      assert.equal(keyValue(text, "Run", "Work folder"), null, of);
      assert.equal(keyValue(text, "Run", "Folder"), null, of);
      assert.equal(keyValue(text, "Run", "Code graph project"), null, of);
      for (const path of [work, slashed(work), dir, slashed(dir)]) assert.equal(text.includes(path), false, path);
      samePath(pointer(dir).work, work);
      assert.equal(localProject(dir), "not indexed: skipped (TDD_NO_GRAPH=1)", of);
    }
  });

  test("without a change, keeps the state file in git's folder, next to the pointer, where git status never lists it", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, scope: "i900" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, startLine(`created ${slashed(prState(dir))}`, 1, work));
    const text = readFileSync(prState(dir), "utf8");
    assert.equal(text.split("\n")[0], `# Review triage: PR ${PR}`);
    assert.equal(text.includes("\r"), false, "LF: git never sees the file");
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 1"]);
    assert.deepEqual(sectionKeys(text, "Run"), RUN_KEYS);
    assert.equal(keyValue(text, "Run", "Scope"), "i900");
    const points = pointer(dir);
    assert.deepEqual(
      { pr: points.pr, round: points.round, change: points.change, scope: points.scope },
      { pr: PR, round: 1, change: null, scope: "i900" },
    );
    samePath(points.state, prState(dir));
    samePath(points.work, work);
    assert.deepEqual(leftInGitFolder(dir), [`triage-${PR}.md`, "triage.json"]);
    assert.deepEqual(await status(dir), [], "nothing in the working tree");
    assert.equal(await git(dir, "status", "--porcelain", "--untracked-files=all", "--ignored"), "", "nor ignored");
    assert.deepEqual(readdirSync(work), [], "nothing is written to the work folder");
  });

  test("prints the work folder with forward slashes", async (t) => {
    const dir = repository(t);
    const work = join(tempFolder(t), "triage-review", "109");

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, scope: "i900" }));

    const printed = / \| work: (.+)\n$/.exec(r.out)?.[1];
    assert.ok(printed, r.out);
    assert.equal(printed.includes("\\"), false, printed);
    assert.ok(printed.endsWith("/triage-review/109"), printed);
    samePath(printed, work);
  });

  test("with an archived change, creates the state file in the change's folder in the archive", async (t) => {
    const dir = await archivedRepository(t);
    const work = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "2", work: work, change: CHANGE }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, startLine(`created ${ARCHIVED}/.review-triage.md`, 2, work));
    assert.deepEqual(sectionNames(read(dir, `${ARCHIVED}/.review-triage.md`)), [...TRIAGE_SECTIONS, "Round 2"]);
    assert.equal(pointer(dir).change, CHANGE);
    samePath(pointer(dir).state, join(dir, ARCHIVED, ".review-triage.md"));
    assert.equal(existsSync(join(dir, FOLDER)), false);
  });

  test("takes the scope from the change, another one when given, and needs one without a change", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);

    const none = await tdd(dir, withPr("triage-init", { round: "1", work: work }));
    assert.equal(none.code, 1);
    assert.equal(
      none.err,
      "ERROR: triage-init needs --scope <scope> without --change: the scope of the round's commits\n",
    );
    assert.equal(existsSync(gitFolder(dir)), false, "no pointer");

    await tdd(dir, withPr("triage-init", { round: "1", work: work, change: CHANGE, scope: "c900b" }));
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Scope"), "c900b");
    assert.equal(pointer(dir).scope, "c900b");
  });

  test("records the source: pr unless chat is given, and keeps it at a later start that names none", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);
    const start = (more) => tdd(dir, withPr("triage-init", { round: "1", work: work, change: CHANGE, ...more }));

    await start({});
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Source"), "pr");
    await start({ source: "chat" });
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Source"), "chat");
    await start({});
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Source"), "chat");
    await start({ source: "pr" });
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Source"), "pr");
  });

  test("takes the PR's number with its #, and any token of letters, digits and dashes", async (t) => {
    for (const [given, id] of [
      ["#109", "109"],
      ["local", "local"],
      ["trial-2", "trial-2"],
    ]) {
      const dir = repository(t);

      const r = await tdd(dir, [
        "triage-init",
        "--pr",
        given,
        "--round",
        "1",
        "--work",
        tempFolder(t),
        "--scope",
        "i900",
      ]);

      assert.equal(r.code, 0, r.err);
      assert.equal(pointer(dir).pr, id);
      assert.equal((await tdd(dir, ["get", "--pr", given, "--section", "Run"])).out.split("\n")[1], `- **PR:** ${id}`);
    }
  });

  test("creates the work folder when it is not there", async (t) => {
    for (const whose of [{ scope: "i900" }, { change: CHANGE }]) {
      const dir = repository(t);
      const work = join(tempFolder(t), "triage-review", "109-r2");

      const r = await tdd(dir, withPr("triage-init", { round: "2", work: work, ...whose }));

      assert.equal(r.code, 0, r.err);
      assert.deepEqual(readdirSync(work), []);
    }
  });

  test("writes a new state file in the change's folder as git would check it out", async (t) => {
    for (const [attributes, crlf] of [
      ["*.md text eol=crlf\n", true],
      ["*.md text eol=lf\n", false],
    ]) {
      const dir = repository(t);
      write(dir, ".gitattributes", attributes);

      await tdd(dir, withPr("triage-init", { round: "1", work: tempFolder(t), change: CHANGE }));

      const text = read(dir, TRIAGE);
      assert.equal(/\r\n/.test(text), crlf);
      assert.equal(/(?<!\r)\n/.test(text), !crlf);
    }
  });

  // A triage whose first round is closed: findings recorded, an agent, an open question, the commit trailers.
  // The state file `triage-init` made is filled in with state.mjs's own functions, as the section commands do it.
  async function afterRoundOne(t, of) {
    const started = await triaging(t, of);
    let text = readFileSync(started.state, "utf8");
    text = setSection(text, "Resume here", "Round 1 is closed.");
    text = putKey(text, "Agents", "Runner", "r1s2t3, 61k tokens");
    text = addBullet(text, "Open", "finding 2: deferred to an issue");
    text = putKey(text, "Allowed failures", "A_parked_test", "blocked finding 2");
    text = putKey(text, "Run", "Commit trailers", "A-Trailer: one\nB-Trailer: two");
    text = putKey(text, "Round 1", "1", "src/a.cs:19 · A made-up title · FIX · 1a2b3c4 · posted");
    text = putKey(text, "Round 1", "2", "src/b.ts:142 · Another · ASK → defer · — · posted");
    writeFileSync(started.state, putKey(text, "Run", "Status", "done"));
    return started;
  }

  test("for a later round, keeps everything, updates Run and appends the round's section", async (t) => {
    const { dir, state, shown } = await afterRoundOne(t, "change");
    const before = readFileSync(state, "utf8");
    const eol = /\r\n/.test(before) ? "\r\n" : "\n";
    const laterWork = join(tempFolder(t), "109-r2");

    const r = await tdd(dir, withPr("triage-init", { round: "2", work: laterWork, change: CHANGE }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, startLine(`exists: ${shown}`, "2, a new section", laterWork));
    const after = readFileSync(state, "utf8");
    assert.equal(
      after,
      before.replace("- **Status:** done", "- **Status:** triaging").replace("- **Round:** 1", "- **Round:** 2") +
        `${eol}## Round 2${eol}${eol}${EMPTY}${eol}`,
    );
    assert.equal(keyValue(after, "Run", "Commit trailers"), "A-Trailer: one\nB-Trailer: two");
    assert.deepEqual(sectionNames(after), [...TRIAGE_SECTIONS, "Round 1", "Round 2"]);
    assert.deepEqual({ round: pointer(dir).round, work: pointer(dir).work }, { round: 2, work: laterWork });
    assert.deepEqual(readdirSync(laterWork), [], "a new round takes the folder given, and creates it");
  });

  test("a PR without a change keeps one state file across rounds started with different work folders", async (t) => {
    const { dir, work, state } = await afterRoundOne(t, "none");
    const before = readFileSync(state);
    const roundOne = before.subarray(before.indexOf("## Round 1"));
    const laterWork = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "2", work: laterWork, scope: "i900" }));
    await tdd(dir, withPr("put", { section: "Round 2", key: "1", value: "src/c.cs:7 · A later one · FIX" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, startLine(`exists: ${slashed(prState(dir))}`, "2, a new section", laterWork));
    const after = readFileSync(state);
    const at = after.indexOf("## Round 1");
    assert.deepEqual(after.subarray(at, at + roundOne.length), roundOne, "round 1 byte for byte");
    assert.deepEqual(sectionNames(after.toString()), [...TRIAGE_SECTIONS, "Round 1", "Round 2"]);
    assert.equal(keyValue(after.toString(), "Round 2", "1"), "src/c.cs:7 · A later one · FIX");
    assert.equal(keyValue(after.toString(), "Run", "Commit trailers"), "A-Trailer: one\nB-Trailer: two");
    samePath(pointer(dir).state, state);
    samePath(pointer(dir).work, laterWork);
    assert.deepEqual(leftInGitFolder(dir), [`triage-${PR}.md`, "triage.json"], "one state file");
    assert.deepEqual([readdirSync(work), readdirSync(laterWork)], [[], []], "no state file in a work folder");
    assert.deepEqual(await status(dir), []);
  });

  for (const of of ["change", "none"]) {
    test(`a rerun of the same round keeps the work folder in use while it is there, and takes the one given when it is gone (${of})`, async (t) => {
      const { dir, work, shown } = await triaging(t, of);
      const whose = of === "none" ? { scope: "i900" } : { change: CHANGE };
      const another = join(tempFolder(t), "another-session");
      const rerun = () => tdd(dir, withPr("triage-init", { round: "1", work: another, ...whose }));

      const kept = await rerun();
      assert.equal(kept.out, startLine(`exists: ${shown}`, 1, work));
      samePath(pointer(dir).work, work);
      assert.equal(existsSync(another), false, "the folder given is not created while it is not used");

      rmSync(work, { recursive: true });
      const taken = await rerun();
      assert.equal(taken.out, startLine(`exists: ${shown}`, 1, another));
      samePath(pointer(dir).work, another);
      assert.deepEqual(readdirSync(another), []);

      const again = await tdd(dir, withPr("triage-init", { round: "1", work: tempFolder(t), ...whose }));
      assert.equal(again.out, startLine(`exists: ${shown}`, 1, another), "and that one is kept from then on");
    });
  }

  test("a new round takes the work folder given, also while the earlier round's is still there", async (t) => {
    const { dir, work } = await triaging(t, "none");
    const laterWork = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "2", work: laterWork, scope: "i900" }));

    assert.equal(r.out, startLine(`exists: ${slashed(prState(dir))}`, "2, a new section", laterWork));
    assert.equal(existsSync(work), true);
    samePath(pointer(dir).work, laterWork);
  });

  test("keeps the work folder only for the same PR: another PR's start takes the folder given", async (t) => {
    const { dir } = await triaging(t, "none");
    const otherWork = tempFolder(t);

    const r = await tdd(dir, ["triage-init", "--pr", "110", "--round", "1", "--work", otherWork, "--scope", "i901"]);

    assert.equal(r.out, startLine(`created ${slashed(prState(dir, "110"))}`, 1, otherWork));
    samePath(pointer(dir).work, otherWork);
    assert.deepEqual(leftInGitFolder(dir), ["triage-109.md", "triage-110.md", "triage.json"]);
  });

  test("takes the work folder given when the pointer cannot be read, and writes the pointer anew", async (t) => {
    const { dir, shown } = await triaging(t, "change");
    writeFileSync(join(gitFolder(dir), "triage.json"), "not json");
    const work = tempFolder(t);

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, change: CHANGE }));

    assert.equal(r.out, startLine(`exists: ${shown}`, 1, work));
    samePath(pointer(dir).work, work);
  });

  test("leaves the values of a machine in a Run that has them from before, as they are, and get prints the local project", async (t) => {
    const { dir, state, work, shown } = await triaging(t, "change");
    let older = readFileSync(state, "utf8");
    for (const [key, value] of [
      ["Work folder", "<scratchpad>/triage-review/109/"],
      ["Folder", "a made-up folder"],
      ["Code graph project", "another-machines-project"],
    ]) {
      older = putKey(older, "Run", key, value);
    }
    writeFileSync(state, older);

    const r = await tdd(dir, withPr("triage-init", { round: "2", work: tempFolder(t), change: CHANGE }));
    const run = await tdd(dir, withPr("get", { section: "Run" }));

    assert.equal(r.code, 0, r.err);
    const after = readFileSync(state, "utf8");
    assert.equal(keyValue(after, "Run", "Work folder"), "<scratchpad>/triage-review/109/");
    assert.equal(keyValue(after, "Run", "Folder"), "a made-up folder");
    assert.equal(keyValue(after, "Run", "Code graph project"), "another-machines-project");
    assert.equal(keyValue(after, "Run", "Round"), "2");
    assert.equal(after.includes(slashed(work)), false, shown);
    assert.equal(run.out.match(/Code graph project/g).length, 1, "once, with this machine's value");
    assert.ok(run.out.includes("- **Code graph project:** not indexed: skipped (TDD_NO_GRAPH=1)\n"), run.out);
  });

  for (const of of ["change", "archived", "none"]) {
    test(`leaves an earlier round's section byte for byte, round after round (${of})`, async (t) => {
      const { dir, work, state } = await afterRoundOne(t, of);
      const before = readFileSync(state);
      const roundOne = before.subarray(before.indexOf("## Round 1"));
      const whose = of === "none" ? { scope: "i900" } : { change: CHANGE };

      for (const round of ["2", "3"]) {
        const r = await tdd(dir, withPr("triage-init", { round: round, work: work, ...whose }));
        assert.equal(r.code, 0, r.err);
        await tdd(dir, withPr("put", { section: `Round ${round}`, key: "1", value: "src/c.cs:7 · A later one · FIX" }));
      }

      const after = readFileSync(state);
      const at = after.indexOf("## Round 1");
      assert.deepEqual(after.subarray(at, at + roundOne.length), roundOne);
      assert.deepEqual(sectionNames(after.toString()), [...TRIAGE_SECTIONS, "Round 1", "Round 2", "Round 3"]);
      assert.equal(keyValue(after.toString(), "Round 3", "1"), "src/c.cs:7 · A later one · FIX");
    });
  }

  for (const of of ["change", "none"]) {
    test(`for a rerun of the same round, changes nothing in a round under way (${of})`, async (t) => {
      const { dir, work, state, shown } = await triaging(t, of);
      await tdd(dir, withPr("put", { section: "Round 1", key: "1", value: "src/a.cs:19 · A made-up title · FIX" }));
      await tdd(dir, withPr("set", { section: "Resume here", text: "The fix round: finding 2 is next." }));
      const before = readFileSync(state);
      const whose = of === "none" ? { scope: "i900" } : { change: CHANGE };

      const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, ...whose }));

      assert.equal(r.code, 0, r.err);
      assert.equal(r.out, startLine(`exists: ${shown}`, 1, work));
      assert.deepEqual(readFileSync(state), before);
    });
  }

  test("for a rerun of a round that was closed, sets the status back and changes nothing else", async (t) => {
    const { dir, work, state } = await afterRoundOne(t, "none");
    const before = readFileSync(state, "utf8");

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, scope: "i900" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(state, "utf8"), before.replace("- **Status:** done", "- **Status:** triaging"));
  });

  test("takes an earlier round's number too: Run says it, and no section is added or removed", async (t) => {
    const { dir, work, state, shown } = await afterRoundOne(t, "none");
    await tdd(dir, withPr("triage-init", { round: "2", work: work, scope: "i900" }));

    const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, scope: "i900" }));

    assert.equal(r.out, startLine(`exists: ${shown}`, 1, work));
    const text = readFileSync(state, "utf8");
    assert.equal(keyValue(text, "Run", "Round"), "1");
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 1", "Round 2"]);
    assert.equal(pointer(dir).round, 1);
  });

  test("indexes the code graph at every start, outside the lock, and records the project", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);
    const graph = fakeGraph(t);
    const start = (round, mode) =>
      tdd(dir, withPr("triage-init", { round: round, work: work, change: CHANGE }), { env: graph.env(mode) });

    const first = await start("1");
    assert.equal(first.out, startLine(`created ${TRIAGE}`, 1, work, "made-up-project"));
    assert.equal(localProject(dir), "made-up-project");

    const failed = await start("2", "fail");
    assert.equal(failed.code, 0, failed.err);
    assert.match(failed.out, /^exists: .* \| round 2, a new section \| graph: failed: .*the index is locked/);
    assert.match(localProject(dir), /^not indexed: .*the index is locked/);
    assert.equal(keyValue(read(dir, TRIAGE), "Run", "Code graph project"), null, "never in the state file");

    const calls = graph.received();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].slice(0, 4), ["cli", "--quiet", "index_repository", "--repo-path"]);
    samePath(calls[0][4], dir);
  });

  test("refuses a state file that is another PR's triage, and leaves it and the pointer as they were", async (t) => {
    const { dir, work, state } = await triaging(t, "change");
    const before = readFileSync(state);

    const r = await tdd(dir, ["triage-init", "--pr", "110", "--round", "1", "--work", work, "--change", CHANGE]);

    assert.equal(r.code, 1);
    assert.equal(r.err, `ERROR: ${TRIAGE} is the triage of PR ${PR}, not of PR 110\n`);
    assert.deepEqual(readFileSync(state), before);
    assert.equal(pointer(dir).pr, PR);
  });

  test("points at the triage started last in the working tree", async (t) => {
    const { dir } = await triaging(t, "change");
    const work = tempFolder(t);

    const r = await tdd(dir, ["triage-init", "--pr", "110", "--round", "1", "--work", work, "--scope", "i901"]);

    assert.equal(r.code, 0, r.err);
    assert.deepEqual(
      { pr: pointer(dir).pr, change: pointer(dir).change, scope: pointer(dir).scope },
      { pr: "110", change: null, scope: "i901" },
    );
    assert.equal(
      (await tdd(dir, withPr("get", { section: "Run" }))).code,
      1,
      "the earlier PR's is no longer under way",
    );
    assert.equal((await tdd(dir, ["get", "--pr", "110", "--section", "Run"])).code, 0);
  });

  test("refuses on main, on master and on a detached HEAD, and creates nothing", async (t) => {
    for (const checkout of [["main"], ["-b", "master"], ["--detach"]]) {
      const dir = repository(t);
      const work = tempFolder(t);
      await git(dir, "checkout", "--quiet", ...checkout);

      const r = await tdd(dir, withPr("triage-init", { round: "1", work: work, change: CHANGE }));

      assert.equal(r.code, 1, checkout.join(" "));
      assert.match(r.err, /^ERROR: triage-init works on the PR's branch, and /);
      assert.ok(oneLine(r.err), r.err);
      assert.equal(existsSync(join(dir, TRIAGE)), false);
      assert.equal(existsSync(gitFolder(dir)), false);
    }
  });

  test("refuses what it cannot go by, each in one line, and creates nothing", async (t) => {
    const dir = repository(t);
    const work = tempFolder(t);
    write(work, "a-file.txt", "made up\n");
    const whole = { pr: PR, round: "1", work: work, change: CHANGE };

    for (const [options, pattern] of [
      [{ ...whole, pr: [] }, /--pr <id>/],
      [{ ...whole, pr: "a b" }, /--pr is the PR's number/],
      [{ ...whole, pr: "../109" }, /--pr is the PR's number/],
      [{ ...whole, round: [] }, /--round <n>/],
      [{ ...whole, round: "0" }, /--round <n>/],
      [{ ...whole, round: "two" }, /--round <n>/],
      [{ ...whole, round: "1.5" }, /--round <n>/],
      [{ ...whole, work: [] }, /--work <absolute folder>/],
      [{ ...whole, work: "relative/work" }, /--work is an absolute path/],
      [{ ...whole, work: join(work, "a-file.txt") }, /--work is a folder/],
      [{ ...whole, source: "mail" }, /--source is one of: pr, chat/],
      [{ ...whole, scope: "a b" }, /--scope is the scope/],
      [{ ...whole, change: "c901-not-there" }, /c901-not-there/],
      [{ ...whole, change: `../changes/${CHANGE}` }, /not a path/],
      [{ ...whole, change: [], scope: "i900", work: join(dir, "work") }, /--work lies inside the repository/],
    ]) {
      const r = await tdd(dir, ["triage-init", ...optionsAsArguments(options)]);

      assert.equal(r.code, 1, JSON.stringify(options));
      assert.equal(r.out, "");
      assert.match(r.err, pattern);
      assert.match(r.err, /^ERROR: /);
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal(existsSync(join(dir, TRIAGE)), false);
    assert.equal(existsSync(join(gitFolder(dir), "triage.json")), false);
    assert.deepEqual(readdirSync(work), ["a-file.txt"]);
    assert.equal(existsSync(join(dir, "work")), false, "no work folder is made for a start that is refused");
    assert.deepEqual(await status(dir), []);
  });
});

describe("a triage's commands, with --pr", { concurrency: true }, () => {
  for (const of of ["change", "archived", "none"]) {
    test(`get, set, add, put and drop work on the triage's state file (${of})`, async (t) => {
      const { dir, state } = await triaging(t, of);

      const set = await tdd(dir, withPr("set", { section: "Resume here", text: "Gathering.\\nSix findings." }));
      const add = await tdd(dir, withPr("add", { section: "Open", line: "finding 5: asked" }));
      const put = await tdd(dir, withPr("put", { section: "Round 1", key: "3", value: "src/a.cs:19 · A title · FIX" }));
      await tdd(dir, withPr("put", { section: "Round 1", key: "4", value: "src/b.cs:2 · Another · DECLINE" }));
      const drop = await tdd(dir, withPr("drop", { section: "Round 1", key: "4" }));
      const get = await tdd(dir, withPr("get", { section: ["Round 1", "open", "Resume here"] }));

      assert.equal(set.out, "set: Resume here | 2 lines\n", set.err);
      assert.equal(add.out, "added: Open | 1 line\n", add.err);
      assert.equal(put.out, "put: Round 1 / 3\n", put.err);
      assert.equal(drop.out, "dropped: Round 1 / 4\n", drop.err);
      assert.equal(
        get.out,
        "## Round 1\n- **3:** src/a.cs:19 · A title · FIX\n\n## Open\n- finding 5: asked\n\n" +
          "## Resume here\nGathering.\nSix findings.\n",
      );
      assert.equal(keyValue(readFileSync(state, "utf8"), "Round 1", "3"), "src/a.cs:19 · A title · FIX");
    });
  }

  test("set, add and put create a section the triage's state file does not have yet, at the end", async (t) => {
    const { dir, state } = await triaging(t, "none");

    const put = await tdd(dir, withPr("put", { section: "Round 2", key: "1", value: "src/a.cs:19 · A title · FIX" }));
    const add = await tdd(dir, withPr("add", { section: "Notes", line: "a made-up note" }));
    const set = await tdd(dir, withPr("set", { section: "Close", text: "All threads answered." }));
    const again = await tdd(dir, withPr("put", { section: "round 2", key: "2", value: "src/b.cs:2 · Another · ASK" }));

    assert.equal(put.out, "put: Round 2 / 1 | new section\n", put.err);
    assert.equal(add.out, "added: Notes | 1 line | new section\n", add.err);
    assert.equal(set.out, "set: Close | 1 line | new section\n", set.err);
    assert.equal(again.out, "put: Round 2 / 2\n", again.err);
    assert.deepEqual(sectionNames(readFileSync(state, "utf8")), [
      ...TRIAGE_SECTIONS,
      "Round 1",
      "Round 2",
      "Notes",
      "Close",
    ]);
  });

  test("get and drop do not create a section, and say which sections there are", async (t) => {
    const { dir, state } = await triaging(t, "change");
    const before = readFileSync(state);

    const get = await tdd(dir, withPr("get", { section: "Round 2" }));
    const drop = await tdd(dir, withPr("drop", { section: "Round 2", key: "1" }));

    assert.equal(get.code, 1);
    assert.match(get.err, /Round 2.*Resume here, Run, Agents, Open, Allowed failures, Round 1/);
    assert.equal(drop.code, 1);
    assert.ok(oneLine(drop.err), drop.err);
    assert.deepEqual(readFileSync(state), before);
  });

  test("is refused in one line while no triage is under way in the working tree", async (t) => {
    const dir = await initialized(t);

    for (const args of [
      withPr("get", { section: "Run" }),
      withPr("set", { section: "Open", text: "x" }),
      withPr("check", { step: "green" }),
      withPr("commit", { type: "fix", tag: "review", summary: "3: x" }),
      withPr("index"),
      withPr("run", { label: "x" }, "--", process.execPath, "-e", "0"),
    ]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, 1, args[0]);
      assert.equal(r.out, "");
      assert.equal(
        r.err,
        `ERROR: no triage is under way in this working tree: run triage-init --pr ${PR} first\n`,
        args[0],
      );
    }
  });

  test("is refused in one line when the triage under way is another PR's", async (t) => {
    const { dir, state } = await triaging(t, "change");
    const before = readFileSync(state);

    for (const args of [
      ["get", "--pr", "110", "--section", "Run"],
      ["put", "--pr", "110", "--section", "Run", "--key", "Status", "--value", "done"],
      ["commit", "--pr", "#110", "--type", "fix", "--tag", "review", "--summary", "3: x"],
    ]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, 1, args[0]);
      assert.equal(r.err, `ERROR: the triage under way in this working tree is PR ${PR}'s, not PR 110's\n`);
    }
    assert.deepEqual(readFileSync(state), before);
    assert.equal((await tdd(dir, ["get", "--pr", `#${PR}`, "--section", "Run"])).code, 0, "the # is taken");
  });

  test("is refused when the pointer's state file is gone, naming the command that makes it", async (t) => {
    const { dir, state } = await triaging(t, "none");
    rmSync(state);

    for (const args of [withPr("get", { section: "Run" }), withPr("add", { section: "Open", line: "x" })]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, 1);
      assert.match(r.err, /^ERROR: no .*triage-109\.md: run triage-init first\n$/);
    }
  });

  test("is refused for init, which is the apply's, and with --file reviews, which a triage has not", async (t) => {
    const { dir } = await triaging(t, "change");

    const init = await tdd(dir, withPr("init", SWITCHES));
    const reviews = await tdd(dir, withPr("get", { file: "reviews", section: "Chapter A" }));
    const written = await tdd(dir, withPr("set", { file: "reviews", section: "Chapter A", text: "x" }));

    assert.equal(init.err, "ERROR: init is the apply's: it takes --change\n");
    assert.equal(reviews.err, "ERROR: --file reviews: a triage has no reviews file, only its state file\n");
    assert.equal(written.code, 1);
    assert.equal(existsSync(join(dir, REVIEWS)), false);
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("with --change alone everything is the apply's, next to a triage of the same change", async (t) => {
    const { dir } = await triaging(t, "change");
    await tdd(dir, withChange("init", SWITCHES));
    await tdd(dir, withChange("set", { section: "Resume here", text: "The apply's." }));
    await tdd(dir, withPr("set", { section: "Resume here", text: "The triage's." }));

    const apply = await tdd(dir, withChange("get", { section: ["Resume here", "Run"] }));
    const triage = await tdd(dir, withPr("get", { section: ["Resume here", "Run"] }));

    assert.match(apply.out, /^## Resume here\nThe apply's\.\n\n## Run\n- \*\*Status:\*\* applying\n/);
    assert.match(triage.out, /^## Resume here\nThe triage's\.\n\n## Run\n- \*\*Status:\*\* triaging\n/);
  });

  test("commit takes the scope and the trailers from the triage, and writes its Resume here", async (t) => {
    const { dir } = await triaging(t, "change");
    await tdd(dir, withPr("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one" }));
    write(dir, "src/App/Mapping.cs", "// the fix\n");

    const r = await tdd(
      dir,
      withPr("commit", {
        type: "fix",
        tag: "review",
        summary: "3: A made-up fix",
        resume: "Finding 4 is next.",
        done: "Finding 3",
      }),
    );

    assert.equal(r.code, 0, r.err);
    assert.match(
      r.out,
      /^[0-9a-f]{7,} fix\(c900\): \[review\] 3: A made-up fix \| graph: skipped\nprogress: Finding 3 completed at \d\d:\d\d\n$/,
    );
    const made = await lastCommit(dir);
    assert.equal(made.message, "fix(c900): [review] 3: A made-up fix\n\nA-Trailer: one");
    assert.deepEqual(made.files, [TRIAGE, "src/App/Mapping.cs"]);
    assert.equal(sectionBody(read(dir, TRIAGE), "Resume here"), "Finding 4 is next.");
    assert.deepEqual(await status(dir), []);
  });

  test("commit for a PR without a change: the scope given at the start, and the state file in git's folder is never committed", async (t) => {
    const { dir, state } = await triaging(t, "none");
    await tdd(dir, withPr("put", { section: "Run", key: "Commit trailers", value: "A-Trailer: one" }));
    write(dir, "src/App/Mapping.cs", "// the fix\n");
    write(dir, "src/App/Other.cs", "// not for this commit\n");

    const whole = await tdd(
      dir,
      withPr("commit", { type: "test", tag: "review", summary: "3: A guard test, red", resume: "Finding 3, the fix." }),
    );
    write(dir, "src/App/Mapping.cs", "// the fix, again\n");
    const paths = await tdd(
      dir,
      withPr("commit", {
        type: "fix",
        tag: "review",
        summary: "3: A made-up fix",
        resume: "Finding 4 is next.",
        path: "src/App/Mapping.cs",
      }),
    );

    assert.equal(whole.code, 0, whole.err);
    assert.equal(paths.code, 0, paths.err);
    const made = await lastCommit(dir);
    assert.equal(made.message, "fix(i900): [review] 3: A made-up fix\n\nA-Trailer: one");
    assert.deepEqual(made.files, ["src/App/Mapping.cs"]);
    assert.equal(sectionBody(readFileSync(state, "utf8"), "Resume here"), "Finding 4 is next.");
    assert.deepEqual(await status(dir), []);
  });

  test("commit --tick ticks the change's tasks in a triage that has a change, and is refused in one that has none", async (t) => {
    const withChangeOf = await triaging(t, "archived");
    const without = await triaging(t, "none");
    write(withChangeOf.dir, "src/App/Mapping.cs", "// the fix\n");
    write(without.dir, "src/App/Mapping.cs", "// the fix\n");
    const commit = withPr("commit", { type: "fix", tag: "review", summary: "3: A made-up fix", tick: "5.1" });

    const ticked = await tdd(withChangeOf.dir, commit);
    const refused = await tdd(without.dir, commit);

    assert.equal(ticked.code, 0, ticked.err);
    assert.match(ticked.out, / \| ticked 5\.1 \| /);
    assert.ok(read(withChangeOf.dir, `${ARCHIVED}/tasks.md`).includes("- [x] 5.1 A balance"));
    assert.equal(refused.code, 1);
    assert.equal(refused.err, "ERROR: --tick: a triage without a change has no tasks.md\n");
    assert.deepEqual(await status(without.dir), [" M src/App/Mapping.cs"]);
  });

  test("commit refuses on main as for an apply, in the triage's words", async (t) => {
    const { dir } = await triaging(t, "none");
    await git(dir, "checkout", "--quiet", "main");
    write(dir, "src/App/Mapping.cs", "// the fix\n");

    const r = await tdd(dir, withPr("commit", { type: "fix", tag: "review", summary: "3: x" }));

    assert.equal(r.err, "ERROR: commit works on the PR's branch, and this is main\n");
  });

  test("check lets the triage's own state file through, and no other file under openspec/", async (t) => {
    for (const of of ["change", "archived"]) {
      const { dir, shown } = await triaging(t, of);
      write(dir, "src/App/Mapping.cs", "// the fix\n");

      const clean = await tdd(dir, withPr("check", { step: "green" }));
      write(dir, shown.replace(".review-triage.md", ".tdd-state.md"), "# written past the script\n");
      write(dir, shown.replace(".review-triage.md", "design.md"), "# Design, changed\n");
      const stopped = await tdd(dir, withPr("check", { step: "green" }));

      assert.equal(clean.code, 0, clean.out);
      assert.deepEqual(clean.out.trimEnd().split("\n"), [
        "ok: 2 changed paths",
        "   M src/App/Mapping.cs",
        `  ?? ${shown}`,
      ]);
      assert.equal(stopped.code, 3);
      assert.deepEqual(stopped.out.trimEnd().split("\n"), [
        "violations (2):",
        `   M ${shown.replace(".review-triage.md", "design.md")}`,
        `  ?? ${shown.replace(".review-triage.md", ".tdd-state.md")}`,
        "other changed paths (2):",
        "   M src/App/Mapping.cs",
        `  ?? ${shown}`,
      ]);
    }
  });

  test("check has no own file for a PR without a change: its state file is not in the working tree", async (t) => {
    const { dir } = await triaging(t, "none");

    const clean = await tdd(dir, withPr("check", { step: "close" }));
    write(dir, TRIAGE, "# not this triage's\n");
    const stopped = await tdd(dir, withPr("commit", { type: "fix", tag: "review", summary: "3: x", check: "green" }));

    assert.equal(clean.out, "ok: 0 changed paths\n");
    assert.equal(stopped.code, 3);
    assert.match(stopped.out, new RegExp(`^violations \\(1\\):\\n {2}\\?\\? ${TRIAGE.replace(/\./g, "\\.")}\\n`));
  });

  test("index needs the triage only to find the working tree", async (t) => {
    const { dir } = await triaging(t, "none");
    const graph = fakeGraph(t);

    const r = await tdd(join(dir, "src", "App"), withPr("index"), { env: graph.env() });

    assert.equal(r.out, "graph: made-up-project\n");
    samePath(graph.received()[0][4], dir);
  });
});

describe("the lock", { concurrency: true }, () => {
  // The lock's wait limit cut to a third of a second: a command that finds the lock held is refused then.
  const impatient = { TDD_LOCK_WAIT_MS: "300" };
  const lockFile = (dir) => join(gitFolder(dir), "state.lock");
  const refusedAsLocked = (r, pid) => {
    assert.equal(r.code, 1, r.out + r.err);
    assert.equal(r.out, "");
    assert.match(r.err, new RegExp(`^ERROR: the state files are locked by process ${pid}, .*; run it again `));
    assert.ok(oneLine(r.err), r.err);
  };

  test("loses no update when many commands write the same state file at once", async (t) => {
    const dir = await initialized(t);
    const numbers = Array.from({ length: 10 }, (_, i) => i + 1);

    const ended = await Promise.all([
      ...numbers.map((n) => tdd(dir, withChange("add", { section: "Open", line: `question ${n}` }))),
      ...numbers.map((n) => tdd(dir, withChange("put", { section: "Agents", key: `Agent ${n}`, value: `a${n}` }))),
      tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." })),
    ]);

    for (const r of ended) assert.equal(r.code, 0, r.err);
    const text = read(dir, STATE);
    assert.deepEqual(sectionBody(text, "Open").split("\n").sort(), numbers.map((n) => `- question ${n}`).sort());
    assert.deepEqual(sectionKeys(text, "Agents").sort(), numbers.map((n) => `Agent ${n}`).sort());
    assert.equal(sectionBody(text, "Resume here"), "Chapter B, group 7.");
    assert.deepEqual(sectionNames(text), STATE_SECTIONS);
    assert.deepEqual(leftInGitFolder(dir), [], "no lock is left");
    assert.deepEqual(readdirSync(join(dir, FOLDER)).sort(), [".tdd-state.md", "design.md", "tasks.md"]);
  });

  test("loses no update across the files of a working tree: the reviews file, and a triage's file in git's folder", async (t) => {
    const { dir, state } = await triaging(t, "none");
    await tdd(dir, withChange("init", SWITCHES));
    const numbers = Array.from({ length: 6 }, (_, i) => i + 1);

    const ended = await Promise.all([
      ...numbers.map((n) => tdd(dir, withPr("put", { section: "Round 1", key: String(n), value: `finding ${n}` }))),
      ...numbers.map((n) =>
        tdd(dir, withChange("add", { file: "reviews", section: "Chapter A", line: `finding ${n}` })),
      ),
      ...numbers.map((n) => tdd(dir, withChange("add", { section: "Open", line: `question ${n}` }))),
    ]);

    for (const r of ended) assert.equal(r.code, 0, r.err);
    assert.deepEqual(sectionKeys(readFileSync(state, "utf8"), "Round 1").sort(), numbers.map(String));
    assert.equal(sectionBody(read(dir, REVIEWS), "Chapter A").split("\n").length, 6);
    assert.equal(sectionBody(read(dir, STATE), "Open").split("\n").length, 6);
    assert.deepEqual(leftInGitFolder(dir), [`triage-${PR}.md`, "triage.json"], "no lock, no leftover");
  });

  test("lets a reader through while writers write: `get` never fails and never sees half a file", async (t) => {
    const dir = await initialized(t);
    const long = Array.from({ length: 400 }, (_, i) => `- a made-up line ${i + 1}`).join("\n");
    await tdd(dir, withChange("set", { section: "What the code holds now", stdin: true }), { input: long });

    const ended = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        i % 2 === 0
          ? tdd(dir, withChange("add", { section: "Open", line: `question ${i}` }))
          : tdd(dir, withChange("get", { section: ["What the code holds now", "Design files"] })),
      ),
    );

    for (const [i, r] of ended.entries()) {
      assert.equal(r.code, 0, r.err);
      if (i % 2 === 1) assert.equal(r.out, `## What the code holds now\n${long}\n\n## Design files\n${EMPTY}\n`);
    }
  });

  test("refuses every writing command in one line while the lock is held, and changes nothing", async (t) => {
    const { dir, work } = await triaging(t, "change");
    await tdd(dir, withChange("init", SWITCHES));
    await tdd(dir, withChange("put", { section: "Allowed failures", key: "A_parked_test", value: "parked: Q2" }));
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    const temp = tempFolder(t);
    const graph = fakeGraph(t);
    const held = () => ({
      state: read(dir, STATE),
      triage: read(dir, TRIAGE),
      head: null,
      local: readFileSync(localFile(dir), "utf8"),
      code: read(dir, "src/App/Mapping.cs"),
    });
    const before = { ...held(), head: (await lastCommit(dir)).sha };
    leftLock(dir, process.pid, 5_000);

    const commands = [
      withChange("init", { "after-chapter": "stop" }),
      withChange("set", { section: "Open", text: "x" }),
      withChange("add", { section: "Open", line: "x" }),
      withChange("put", { section: "Run", key: "Status", value: "done" }),
      withChange("put", { section: "Design files", local: true, key: "Design system folder", value: "C:/x" }),
      withChange("drop", { section: "Allowed failures", key: "A_parked_test" }),
      withChange("add", { file: "reviews", section: "Chapter A", line: "x" }),
      withChange("review", { chapter: "B", stdin: true }),
      withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: "5.1", resume: "Next." }),
      withChange("unguard", { tag: "chapter-review", id: "B-1", red: before.head, outcome: "declined", body: "x" }),
      withChange("index"),
      withPr("set", { section: "Open", text: "x" }),
      withPr("triage-init", { round: "2", work: work, change: CHANGE }),
    ];
    const ended = await Promise.all(
      commands.map((args) =>
        tdd(dir, args, {
          // `index` finds a project to write, with the stand-in for the code graph; `review` gets a record.
          env: { ...impatient, ...graph.env(), TEMP: temp, TMP: temp, TMPDIR: temp },
          input:
            "REVIEW: chapter B, 1a2b3c4..5d6e7f8, 1 commit, 1 file changed\n" +
            "FINDINGS: 0 · confirmed 0 · refuted 0 · unsure 0 · no report 0\n",
        }),
      ),
    );
    const shelved = await tdd(dir, withChange("shelve", { key: "Q1" }), { env: impatient });
    const unshelved = await tdd(dir, withChange("unshelve", { key: "Q1" }), { env: impatient });

    for (const r of ended) refusedAsLocked(r, process.pid);
    for (const r of [shelved, unshelved]) {
      assert.equal(r.code, 1, r.out + r.err);
      assert.match(
        r.err,
        new RegExp(`^ERROR: nothing was changed: the state files are locked by process ${process.pid}, `),
      );
    }
    assert.deepEqual({ ...held(), head: (await lastCommit(dir)).sha }, before);
    assert.equal(read(dir, TASKS), TASKS_TEXT);
    assert.equal(existsSync(join(dir, REVIEWS)), false);
    assert.equal(pointer(dir).round, 1);
    assert.equal(JSON.parse(readFileSync(lockFile(dir), "utf8")).pid, process.pid, "the lock is left to its owner");
  });

  test("refuses `init` creating a state file while the lock is held", async (t) => {
    const dir = repository(t);
    leftLock(dir, process.pid, 5_000);

    refusedAsLocked(await tdd(dir, withChange("init", SWITCHES), { env: impatient }), process.pid);
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("lets every command that only reads through while the lock is held", async (t) => {
    const dir = await initialized(t);
    const temp = tempFolder(t);
    const env = { ...impatient, TEMP: temp, TMP: temp, TMPDIR: temp };
    // A chapter's record, written before the lock is there, for `route --chapter` to read.
    const record =
      "REVIEW: chapter B, 1a2b3c4..5d6e7f8, 1 commit, 1 file changed\n" +
      "FINDINGS: 0 · confirmed 0 · refuted 0 · unsure 0 · no report 0\n";
    const recorded = await tdd(dir, withChange("review", { chapter: "B", stdin: true }), { env, input: record });
    assert.equal(recorded.code, 0, recorded.err);
    leftLock(dir, process.pid, 5_000);
    const findings = '[{"id":1,"verdicts":[{"verdict":"unsure"}]}]';
    const saved = join(tempFolder(t), "1-1.md");

    for (const args of [
      withChange("get", { section: "Run" }),
      withChange("get", { file: "reviews", section: ["Chapter B review", "Chapter B"] }),
      withChange("check", { step: "green" }),
      // The code graph is switched off here, so `index` has no project to write and takes no lock.
      withChange("index"),
      withChange("run", { label: "x" }, "--", process.execPath, "-e", "0"),
      withChange("reports", { chapter: "B", new: true }),
      ["route", "--change", CHANGE, "--chapter", "B"],
      ["route", "--json", findings],
      ["report", "--file", saved, "--stdin"],
      ["progress", "--step", "Baseline"],
    ]) {
      const r = await tdd(dir, args, { env, input: "ID: 1\nVERDICT: unsure\n" });

      assert.equal(r.code, 0, `${args[0]}: ${r.err}`);
    }
    assert.equal(readFileSync(saved, "utf8"), "ID: 1\nVERDICT: unsure\n");
  });

  test("takes over a stale lock, one older than a minute, and leaves none", async (t) => {
    const dir = await initialized(t);
    leftLock(dir, 4242, 61_000);

    const r = await tdd(dir, withChange("add", { section: "Open", line: "a dispute" }), { env: impatient });

    assert.equal(r.code, 0, r.err);
    assert.equal(sectionBody(read(dir, STATE), "Open"), "- a dispute");
    assert.deepEqual(leftInGitFolder(dir), []);
  });

  test("takes the stale age and the wait limit from the environment", async (t) => {
    const dir = await initialized(t);
    leftLock(dir, 4242, 2_000);
    const add = withChange("add", { section: "Open", line: "a dispute" });
    const started = Date.now();

    const waited = await tdd(dir, add, { env: { TDD_LOCK_WAIT_MS: "600" } });
    const took = Date.now() - started;
    const stale = await tdd(dir, add, { env: { TDD_LOCK_WAIT_MS: "600", TDD_LOCK_STALE_MS: "1000" } });

    refusedAsLocked(waited, 4242);
    assert.ok(took >= 600, `refused after ${took} ms`);
    assert.equal(stale.code, 0, stale.err);
  });

  test("commit holds the lock until git has committed, and has released it when the code graph is indexed", async (t) => {
    const dir = await initialized(t);
    const out = tempFolder(t);
    // git's own hook says whether the lock is there while the commit is made; the stand-in for the code graph's
    // command line says the same for the index.
    write(
      dir,
      ".git/hooks/pre-commit",
      `#!/bin/sh\nif [ -f .git/tdd/state.lock ]; then echo held; else echo free; fi > "$LOCK_SEEN_BY_GIT"\n`,
    );
    chmodSync(join(dir, ".git/hooks/pre-commit"), 0o755);
    const graph = fakeGraph(t);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");

    const r = await tdd(
      dir,
      withChange("commit", { type: "feat", tag: "green", summary: "Mapping", resume: "Next." }),
      {
        env: { ...graph.env(), LOCK_SEEN_BY_GIT: join(out, "git.txt"), FAKE_GRAPH_LOCK: lockFile(dir) },
      },
    );

    assert.equal(r.code, 0, r.err);
    assert.equal(read(out, "git.txt").trim(), "held");
    assert.deepEqual(graph.lockSeen(), [false]);
    assert.deepEqual(leftInGitFolder(dir), []);
  });

  test("init and triage-init index the code graph outside the lock", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);
    const env = { ...graph.env(), FAKE_GRAPH_LOCK: lockFile(dir) };

    const init = await tdd(dir, withChange("init", SWITCHES), { env });
    const triage = await tdd(dir, withPr("triage-init", { round: "1", work: tempFolder(t), change: CHANGE }), { env });

    assert.equal(init.code, 0, init.err);
    assert.equal(triage.code, 0, triage.err);
    assert.deepEqual(graph.lockSeen(), [false, false]);
  });

  test("releases the lock when a command is refused or fails inside it", async (t) => {
    const dir = await initialized(t);
    write(dir, ".git/hooks/commit-msg", "#!/bin/sh\necho 'made-up hook: the message is refused' >&2\nexit 1\n");
    chmodSync(join(dir, ".git/hooks/commit-msg"), 0o755);
    write(dir, "src/App/Mapping.cs", "// the mapping\n");
    write(dir, "tests/App.UnitTests/MappingTests.cs", "// changed by the implementer\n");

    for (const [args, code] of [
      [withChange("set", { section: "Disputes", text: "x" }), 1],
      [withChange("drop", { section: "Open", key: "not there" }), 1],
      [withChange("commit", { type: "feat", tag: "green", summary: "Mapping", tick: "9.9" }), 1],
      [withChange("commit", { type: "feat", tag: "green", summary: "Mapping", check: "green" }), 3],
      [withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }), 1],
      [withChange("commit", { type: "feat", tag: "green", summary: "Mapping", path: "src/App/Unchanged.cs" }), 1],
    ]) {
      const r = await tdd(dir, args);

      assert.equal(r.code, code, `${args.join(" ")}: ${r.err}`);
      assert.deepEqual(leftInGitFolder(dir), [], args.join(" "));
    }
    const clean = repository(t);
    const nothing = await tdd(clean, withChange("commit", { type: "feat", tag: "green", summary: "Mapping" }));
    assert.equal(nothing.code, 4);
    assert.deepEqual(leftInGitFolder(clean), []);
  });

  test("a linked working tree has a lock and a pointer of its own", async (t) => {
    const dir = repository(t);
    const linked = join(tempFolder(t), "linked");
    await git(dir, "worktree", "add", "--quiet", "-b", "feat/c901-another-made-up-thing", linked);
    leftLock(dir, process.pid, 5_000);

    const r = await tdd(linked, withPr("triage-init", { round: "1", work: tempFolder(t), change: CHANGE }), {
      env: impatient,
    });
    const own = await tdd(linked, withPr("add", { section: "Open", line: "a question" }), { env: impatient });
    const main = await tdd(dir, withPr("get", { section: "Open" }), { env: impatient });

    assert.equal(r.code, 0, r.err);
    assert.equal(own.code, 0, own.err);
    assert.equal(main.code, 1, "the main working tree has no triage under way");
    assert.equal(existsSync(join(gitFolder(dir), "triage.json")), false);
    assert.equal(existsSync(join(dir, ".git", "worktrees", "linked", "tdd", "triage.json")), true);
  });
});
