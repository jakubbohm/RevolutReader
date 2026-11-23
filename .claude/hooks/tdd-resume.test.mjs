// Tests for tdd-resume.mjs, run as Claude Code runs it: the hook's JSON on standard input, its answer on standard
// output. Each test has a throwaway git repository in the OS temp folder with made-up state files, written with
// the tdd-apply scripts' own functions. Nothing here reaches the network or the code graph.
//
//   node --test ".claude/hooks/*.test.mjs"
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { addBullet, newStateText, putKey, setSection } from "../skills/tdd-apply/scripts/state.mjs";

const HOOK = fileURLToPath(new URL("./tdd-resume.mjs", import.meta.url));
const CHANGE = "c900-add-made-up-thing";
const GET = (change) => `node .claude/skills/tdd-apply/scripts/tdd.mjs get --change ${change} --section`;

function started(file, args, { cwd, input } = {}) {
  return new Promise((done, failed) => {
    const child = spawn(file, args, { cwd, windowsHide: true });
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

// A folder of its own in the OS temp folder, removed when the test ends.
function tempFolder(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tdd-resume-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

// An empty git repository.
async function repository(t) {
  const dir = tempFolder(t);
  const r = await started("git", ["init", "--quiet"], { cwd: dir });
  assert.equal(r.code, 0, r.err);
  return dir;
}

// A state file as `tdd.mjs init` writes it, with the status and the line endings given, then changed by `change`.
function stateFile(dir, folder, { status = "applying", eol = "\n", change = (text) => text } = {}) {
  const run = [
    ["Status", status],
    ["Started", "2026-11-23"],
    ["Review mode", "acceptance"],
  ];
  mkdirSync(join(dir, "openspec", "changes", folder), { recursive: true });
  const name = folder.split("/").at(-1);
  writeFileSync(join(dir, "openspec", "changes", folder, ".tdd-state.md"), change(newStateText(name, run, eol)));
}

// The made-up state of an apply in its second chapter.
const underWay = (text) => {
  let state = setSection(text, "Resume here", "Chapter B, group 7 (red).\nThe last commit is [green] of group 6.");
  state = putKey(state, "Agents", "Test-writer (B)", "a1b2c3, 41k tokens");
  state = putKey(state, "Agents", "Implementer (B)", "d4e5f6, 18k tokens");
  return addBullet(state, "Open", "a dispute about the error model, with the test-writer");
};

// Runs the hook as a SessionStart after a compaction in `cwd`, and answers its exit code, the context it added
// (null when it added none) and what it wrote to stderr.
async function hook(cwd, input = { hook_event_name: "SessionStart", source: "compact", cwd }) {
  const r = await started(process.execPath, [HOOK], {
    cwd,
    input: typeof input === "string" ? input : JSON.stringify(input),
  });
  let context = null;
  if (r.out !== "") {
    const answer = JSON.parse(r.out);
    assert.deepEqual(Object.keys(answer), ["hookSpecificOutput"]);
    assert.equal(answer.hookSpecificOutput.hookEventName, "SessionStart");
    context = answer.hookSpecificOutput.additionalContext;
    assert.equal(typeof context, "string");
  }
  return { code: r.code, context, out: r.out, err: r.err };
}

describe("tdd-resume hook", { concurrency: true }, () => {
  test("for a change that is being applied, says so and adds its Resume here, Agents and Open sections", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });

    const r = await hook(dir);

    assert.equal(r.code, 0);
    assert.equal(r.err, "");
    const [intro, ...sections] = r.context.split("\n\n");
    assert.match(intro, /^\/tdd-apply is under way for `c900-add-made-up-thing`/);
    assert.match(intro, /this session is its main session/i);
    assert.ok(intro.includes(`\`${GET(CHANGE)} "<name>"\``), intro);
    assert.deepEqual(sections, [
      "## Resume here\nChapter B, group 7 (red).\nThe last commit is [green] of group 6.",
      "## Agents\n- **Test-writer (B):** a1b2c3, 41k tokens\n- **Implementer (B):** d4e5f6, 18k tokens",
      "## Open\n- a dispute about the error model, with the test-writer",
    ]);
  });

  test("names the sections the state file has, so that the session can ask for any of them", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE);

    const { context } = await hook(dir);

    assert.ok(
      context.includes(
        "Resume here, Run, Chapter plan, Agents, Standing rules, What the code holds now, Baseline, Acceptance tests, Open, Design files",
      ),
      context,
    );
  });

  test("reads a CRLF state file the same, and answers with LF line breaks", async (t) => {
    const dir = await repository(t);
    const other = await repository(t);
    stateFile(dir, CHANGE, { eol: "\r\n", change: underWay });
    stateFile(other, CHANGE, { change: underWay });

    const r = await hook(dir);

    assert.equal(r.context.includes("\r"), false);
    assert.equal(r.context, (await hook(other)).context);
  });

  test("finds the repository from a folder inside it", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });
    mkdirSync(join(dir, "src", "App"), { recursive: true });

    const r = await hook(join(dir, "src", "App"));

    assert.match(r.context, /^\/tdd-apply is under way for `c900-add-made-up-thing`/);
  });

  test("takes the status whatever its case", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { status: "Applying" });

    assert.notEqual((await hook(dir)).context, null);
  });

  test("prints nothing for a change whose apply is done", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { status: "done", change: underWay });

    const r = await hook(dir);

    assert.deepEqual(r, { code: 0, context: null, out: "", err: "" });
  });

  test("prints nothing for an archived change, whatever its status", async (t) => {
    const dir = await repository(t);
    stateFile(dir, `archive/2026-11-23-${CHANGE}`, { change: underWay });
    stateFile(dir, "archive", { change: underWay });

    const r = await hook(dir);

    assert.deepEqual(r, { code: 0, context: null, out: "", err: "" });
  });

  test("prints nothing without a state file, without changes, and without an openspec folder", async (t) => {
    const withFolder = await repository(t);
    mkdirSync(join(withFolder, "openspec", "changes", CHANGE), { recursive: true });
    const withoutChanges = await repository(t);
    mkdirSync(join(withoutChanges, "openspec", "changes"), { recursive: true });
    const bare = await repository(t);

    for (const dir of [withFolder, withoutChanges, bare]) {
      assert.deepEqual(await hook(dir), { code: 0, context: null, out: "", err: "" });
    }
  });

  test("adds every change that is being applied, and only those", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });
    stateFile(dir, "c901-another-made-up-thing", {
      change: (text) => setSection(text, "Resume here", "Chapter A, group 2."),
    });
    stateFile(dir, "c902-a-finished-thing", { status: "done" });

    const { context } = await hook(dir);

    assert.match(context, /^\/tdd-apply is under way for `c900-add-made-up-thing`/);
    assert.match(context, /\n\n\/tdd-apply is under way for `c901-another-made-up-thing`/);
    assert.ok(context.includes("## Resume here\nChapter A, group 2."));
    assert.equal(context.includes("c902"), false);
  });

  test("cuts the text at 4,000 characters, with a note that names the command for the rest", async (t) => {
    const dir = await repository(t);
    const long = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of a made-up, much too long account.`).join("\n");
    stateFile(dir, CHANGE, { change: (text) => underWay(setSection(text, "Open", long)) });

    const { context } = await hook(dir);

    assert.ok(context.length <= 4000, `${context.length} characters`);
    assert.ok(context.length > 3900, `${context.length} characters`);
    assert.ok(context.includes("## Resume here\nChapter B, group 7 (red)."));
    assert.ok(context.includes("Line 1 of a made-up"));
    assert.equal(context.includes("Line 200 of a made-up"), false);
    assert.ok(
      context.endsWith(`${GET(CHANGE)} "Resume here" --section "Agents" --section "Open"\``),
      context.slice(-300),
    );
    assert.match(context, /cut at 4,000 characters/);
  });

  test("does not cut a text of just under 4,000 characters", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });
    const short = (await hook(dir)).context;
    const room = 4000 - short.length - "\n".length;
    stateFile(dir, CHANGE, {
      change: (text) => addBullet(underWay(text), "Open", "x".repeat(room - "- ".length)),
    });

    const { context } = await hook(dir);

    assert.equal(context.length, 4000);
    assert.doesNotMatch(context, /cut at 4,000 characters/);
  });

  test("puts a placeholder where the state file lacks one of the three sections", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: (text) => underWay(text).replace("## Agents", "## Somebody renamed this") });

    const { context } = await hook(dir);

    assert.ok(context.includes("## Agents\n(the state file has no such section)"), context);
    assert.ok(context.includes("## Open\n- a dispute about the error model"));
  });

  test("prints nothing for another event", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });

    const r = await hook(dir, { hook_event_name: "PostToolUse", tool_name: "EnterWorktree", cwd: dir });

    assert.deepEqual(r, { code: 0, context: null, out: "", err: "" });
  });

  test("prints nothing outside a git repository and without a folder to start from", async (t) => {
    const outside = tempFolder(t);

    assert.deepEqual(await hook(outside), { code: 0, context: null, out: "", err: "" });
    assert.deepEqual(await hook(outside, { hook_event_name: "SessionStart", source: "compact" }), {
      code: 0,
      context: null,
      out: "",
      err: "",
    });
  });

  test("never blocks the session: input that is no JSON gives one line on stderr, nothing on stdout, exit 0", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });

    for (const input of ["", "not json", "[1, 2", "null"]) {
      const r = await hook(dir, input);

      assert.equal(r.code, 0, input);
      assert.equal(r.out, "", input);
      assert.match(r.err, /^tdd-resume hook: .+\n$/, input);
      assert.equal(r.err.trim().split("\n").length, 1, r.err);
    }
  });

  test("never blocks the session: a state file it cannot read gives one line on stderr, nothing on stdout, exit 0", async (t) => {
    const dir = await repository(t);
    mkdirSync(join(dir, "openspec", "changes", CHANGE, ".tdd-state.md"), { recursive: true });

    const r = await hook(dir);

    assert.equal(r.code, 0);
    assert.equal(r.out, "");
    assert.match(r.err, /^tdd-resume hook: .+\n$/);
    assert.equal(r.err.trim().split("\n").length, 1, r.err);
  });
});
