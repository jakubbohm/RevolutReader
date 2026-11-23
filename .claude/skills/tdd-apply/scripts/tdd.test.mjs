// Tests for tdd.mjs: its pure functions, and every command run as the orchestrator runs it, `node tdd.mjs …`, in a
// throwaway git repository in the OS temp folder (a made-up change with its tasks, some code and a test). Nothing
// here reaches the network, Docker or the real code graph: the graph's command line is switched off
// (TDD_NO_GRAPH=1) or replaced by a small fake (TDD_GRAPH_CLI), and the commands `run` wraps are Node one-liners
// and, for the Windows shim, npm running a script of a made-up package. Every name, text and path is made up.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { EMPTY, keyValue, sectionBody, sectionNames, STATE_SECTIONS } from "./state.mjs";
import { changeScope, commitMessage, logFileName, newlines, tickTasks, windowsCommandLine } from "./tdd.mjs";

const SCRIPT = fileURLToPath(new URL("./tdd.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const CHANGE = "c900-add-made-up-thing";
const BRANCH = "feat/c900-add-made-up-thing";
const FOLDER = `openspec/changes/${CHANGE}`;
const STATE = `${FOLDER}/.tdd-state.md`;
const REVIEWS = `${FOLDER}/.chapter-reviews.md`;
const TASKS = `${FOLDER}/tasks.md`;
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

// Runs the script as the orchestrator does. The code graph is switched off unless a test's `env` says otherwise.
function tdd(cwd, args, { env = {}, input } = {}) {
  // npm, which one `run` test wraps, must not look for its own updates: no test reaches the network.
  const quiet = { TDD_NO_GRAPH: "1", TDD_GRAPH_CLI: "", NPM_CONFIG_UPDATE_NOTIFIER: "false" };
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

// A repository whose change has the state file of a fresh `init`.
async function initialized(t) {
  const dir = repository(t);
  const r = await tdd(dir, withChange("init", { review: "acceptance", checkpoint: "stop" }));
  assert.equal(r.code, 0, r.err);
  return dir;
}

// A stand-in for the code graph's command line, outside the repository: it records its arguments and answers as
// FAKE_GRAPH_MODE says (a project, a failure, or text that is not JSON). On Windows it is a .cmd file, which also
// proves the script can start one.
function fakeGraph(t) {
  const dir = tempFolder(t);
  const calls = join(dir, "calls.jsonl");
  write(
    dir,
    "fake-graph.mjs",
    [
      'import { appendFileSync } from "node:fs";',
      'appendFileSync(process.env.FAKE_GRAPH_CALLS, JSON.stringify(process.argv.slice(2)) + "\\n");',
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
  });
});

describe("init", { concurrency: true }, () => {
  test("creates the state file with every section and the run's facts", async (t) => {
    const dir = repository(t);
    const day = today();

    const r = await tdd(dir, withChange("init", { review: "all", checkpoint: "continue" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `created ${STATE} | graph: skipped\n`);
    const text = read(dir, STATE);
    assert.equal(text.split(/\r?\n/)[0], `# .tdd-state: ${CHANGE}`);
    assert.deepEqual(sectionNames(text), STATE_SECTIONS);
    const keys = sectionBody(text, "Run")
      .split("\n")
      .map((l) => /^- \*\*(.+?):\*\*/.exec(l)?.[1]);
    assert.deepEqual(keys, [
      "Status",
      "Started",
      "Review mode",
      "Checkpoint mode",
      "Branch",
      "Folder",
      "Code graph project",
    ]);
    assert.equal(keyValue(text, "Run", "Status"), "applying");
    assert.ok([day, today()].includes(keyValue(text, "Run", "Started")));
    assert.equal(keyValue(text, "Run", "Review mode"), "all");
    assert.equal(keyValue(text, "Run", "Checkpoint mode"), "continue");
    assert.equal(keyValue(text, "Run", "Branch"), BRANCH);
    samePath(keyValue(text, "Run", "Folder"), dir);
    assert.equal(keyValue(text, "Run", "Code graph project"), "not indexed: skipped (TDD_NO_GRAPH=1)");
    for (const name of STATE_SECTIONS.filter((n) => n !== "Run")) assert.equal(sectionBody(text, name), EMPTY);
  });

  test("indexes the repository and records the code graph's project", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(dir, withChange("init", { review: "acceptance", checkpoint: "stop" }), {
      env: graph.env(),
    });

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `created ${STATE} | graph: made-up-project\n`);
    assert.equal(keyValue(read(dir, STATE), "Run", "Code graph project"), "made-up-project");
    const [call] = graph.received();
    assert.deepEqual(call.slice(0, 4), ["cli", "--quiet", "index_repository", "--repo-path"]);
    samePath(call[4], dir);
    assert.equal(call.length, 5);
  });

  test("still creates the file when the index fails, and records why", async (t) => {
    const dir = repository(t);
    const graph = fakeGraph(t);

    const r = await tdd(dir, withChange("init", { review: "acceptance", checkpoint: "stop" }), {
      env: graph.env("fail"),
    });

    assert.equal(r.code, 0, r.err);
    assert.match(r.out, new RegExp(`^created ${STATE.replace(/\./g, "\\.")} \\| graph: failed: .*the index is locked`));
    assert.match(keyValue(read(dir, STATE), "Run", "Code graph project"), /^not indexed: .*the index is locked/);
  });

  test("records the issue only when one is given, with or without its #", async (t) => {
    for (const issue of ["67", "#67"]) {
      const dir = repository(t);

      assert.equal((await tdd(dir, withChange("init", { review: "all", checkpoint: "stop", issue: issue }))).code, 0);

      const text = read(dir, STATE);
      assert.equal(keyValue(text, "Run", "Issue"), "#67");
      assert.equal(sectionBody(text, "Run").split("\n").at(-1), "- **Issue:** #67");
    }
  });

  test("refuses an issue that is no number, and a mode it does not know", async (t) => {
    const dir = repository(t);

    for (const args of [
      ["--review", "all", "--checkpoint", "stop", "--issue", "sixty-seven"],
      ["--review", "everything", "--checkpoint", "stop"],
      ["--review", "all", "--checkpoint", "sometimes"],
    ]) {
      const r = await tdd(dir, withChange("init", ...args));

      assert.equal(r.code, 1, args.join(" "));
      assert.ok(oneLine(r.err), r.err);
    }
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("needs both modes to create the file", async (t) => {
    const dir = repository(t);

    assert.equal((await tdd(dir, withChange("init", { review: "all" }))).code, 1);
    assert.equal((await tdd(dir, withChange("init", { checkpoint: "stop" }))).code, 1);
    assert.equal(existsSync(join(dir, STATE)), false);
  });

  test("changes nothing in a file that exists, and says that it exists", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." }));
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("init"));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `exists: ${STATE} | review: acceptance | checkpoint: stop\n`);
    assert.equal(read(dir, STATE), before);
  });

  test("changes only the modes given in a file that exists", async (t) => {
    const dir = await initialized(t);
    await tdd(dir, withChange("set", { section: "Resume here", text: "Chapter B, group 7." }));
    const before = read(dir, STATE);

    const r = await tdd(dir, withChange("init", { review: "all", issue: "99" }));

    assert.equal(r.code, 0, r.err);
    assert.equal(r.out, `exists: ${STATE} | review: all (was acceptance) | checkpoint: stop\n`);
    assert.equal(read(dir, STATE), before.replace("- **Review mode:** acceptance", "- **Review mode:** all"));

    const again = await tdd(dir, withChange("init", { review: "all", checkpoint: "continue" }));

    assert.equal(again.out, `exists: ${STATE} | review: all | checkpoint: continue (was stop)\n`);
    assert.equal(keyValue(read(dir, STATE), "Run", "Checkpoint mode"), "continue");
  });

  test("refuses on main, on master and on a detached HEAD, and creates nothing", async (t) => {
    for (const checkout of [["main"], ["-b", "master"], ["--detach"]]) {
      const dir = repository(t);
      await git(dir, "checkout", "--quiet", ...checkout);

      const r = await tdd(dir, withChange("init", { review: "all", checkpoint: "stop" }));

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

      assert.equal((await tdd(dir, withChange("init", { review: "all", checkpoint: "stop" }))).code, 0);
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

      await tdd(dir, withChange("init", { review: "all", checkpoint: "stop" }));

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

    const r = await tdd(dir, withChange("get", { section: ["Run", "Disputes"] }));

    assert.equal(r.code, 1);
    assert.equal(r.out, "");
    assert.match(r.err, /Disputes.*Resume here, Run, Chapter plan/);
    assert.ok(oneLine(r.err), r.err);
  });

  test("fails when no section is asked for, and before `init`", async (t) => {
    const dir = repository(t);

    assert.match((await tdd(dir, withChange("get", { section: "Run" }))).err, /^ERROR: .*init/);
    assert.equal((await tdd(dir, withChange("get", { section: "Run" }))).code, 1);

    await tdd(dir, withChange("init", { review: "all", checkpoint: "stop" }));
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

  test("lets the orchestrator's own two files through", async (t) => {
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
});
