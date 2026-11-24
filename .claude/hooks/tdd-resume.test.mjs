// Tests for tdd-resume.mjs, run as Claude Code runs it: the hook's JSON on standard input, its answer on standard
// output. Each test has a throwaway git repository in the OS temp folder with made-up state files and, for a
// triage, the pointer to its state file, written with the tdd-apply scripts' own functions; one test lets
// `tdd.mjs triage-init` write them. Nothing here reaches the network or the code graph.
//
//   node --test ".claude/hooks/*.test.mjs"
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { addBullet, newStateText, putKey, setSection, triageText } from "../skills/tdd-apply/scripts/state.mjs";
import { pointerText } from "../skills/tdd-apply/scripts/triage.mjs";

const HOOK = fileURLToPath(new URL("./tdd-resume.mjs", import.meta.url));
const TDD = fileURLToPath(new URL("../skills/tdd-apply/scripts/tdd.mjs", import.meta.url));
const CHANGE = "c900-add-made-up-thing";
const GET = (change) => `node .claude/skills/tdd-apply/scripts/tdd.mjs get --change ${change} --section`;
const GET_TRIAGE = (pr) => `node .claude/skills/tdd-apply/scripts/tdd.mjs get --pr ${pr} --section`;

function started(file, args, { cwd, input, env } = {}) {
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
    // A program that ends without reading its input (git here) may have closed the pipe before this end reaches
    // it: that is no failure of the program, whose exit code and output the test still judges.
    child.stdin.on("error", () => {});
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
    ["Human test review", "acceptance"],
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

// The folder of the working tree's own files in git's folder, where the triage's pointer lies.
async function gitFolder(dir) {
  const r = await started("git", ["rev-parse", "--git-path", "tdd"], { cwd: dir });
  assert.equal(r.code, 0, r.err);
  return resolve(dir, r.out.trim());
}

// The work folder of the made-up triage: some session's scratchpad, which only the pointer holds.
const WORK = join(tmpdir(), "a-made-up-scratchpad", "triage-review", "109");
// A folder's path as the hook prints it: with forward slashes on every system.
const slashed = (path) => path.split(sep).join("/");
// How a triage's account begins: whose it is, the round, the work folder, and what the state file says.
const triageUnderWay = (whose, round, work = WORK) =>
  `/triage-review is under way for ${whose}, round ${round}, with the work folder \`${slashed(work)}\`: ` +
  "its state file says `Status: triaging`. ";
// Where the triage of a PR without a change keeps its state file: in git's folder, next to the pointer.
const prStateFile = async (dir, pr = "109") => join(await gitFolder(dir), `triage-${pr}.md`);

// A triage's state file at `state` (an absolute path) and the working tree's pointer to it, as `tdd.mjs
// triage-init` writes them: PR 109, round 2, the made-up work folder, without a change unless `pointer` says
// otherwise. `status` is the state file's, and `edit` changes its text.
async function triage(dir, state, { status = "triaging", edit = (text) => text, ...pointer } = {}) {
  const points = { pr: "109", round: 2, change: null, scope: "i900", work: WORK, state, ...pointer };
  const run = [
    ["Status", status],
    ["PR", points.pr],
    ["Round", String(points.round)],
  ];
  mkdirSync(dirname(state), { recursive: true });
  writeFileSync(state, edit(triageText(null, points.change ?? `PR ${points.pr}`, run, points.round, "\n")));
  const folder = await gitFolder(dir);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "triage.json"), pointerText(points));
}

// The made-up state of a triage in its fix round.
const fixing = (text) => {
  let state = setSection(text, "Resume here", "The fix round: finding 3 is next.\nFindings 1 and 2 are fixed.");
  state = putKey(state, "Agents", "Runner", "r1s2t3, 61k tokens");
  return addBullet(state, "Open", "finding 5: asked, waiting for the owner");
};

// Where a change's triage keeps its state file.
const triageFile = (dir, folder) => join(dir, "openspec", "changes", folder, ".review-triage.md");

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
  test("for a change that is being applied, says so and adds its Resume here, Open and Agents sections, in that order", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });

    const r = await hook(dir);

    assert.equal(r.code, 0);
    assert.equal(r.err, "");
    const [intro, ...sections] = r.context.split("\n\n");
    assert.match(intro, /^\/tdd-apply is under way for `c900-add-made-up-thing`/);
    assert.match(intro, /this session is its main session/i);
    assert.ok(intro.includes(`\`${GET(CHANGE)} "<name>"\``), intro);
    assert.ok(intro.endsWith("Its Resume here, Open, Agents sections as they stand:"), intro);
    assert.deepEqual(sections, [
      "## Resume here\nChapter B, group 7 (red).\nThe last commit is [green] of group 6.",
      "## Open\n- a dispute about the error model, with the test-writer",
      "## Agents\n- **Test-writer (B):** a1b2c3, 41k tokens\n- **Implementer (B):** d4e5f6, 18k tokens",
    ]);
  });

  test("says whose session is meant: the main session's, and not that of an agent it started", async (t) => {
    const dir = await repository(t);
    const triaged = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });
    await triage(triaged, await prStateFile(triaged), { edit: fixing });

    for (const [status, { context }] of [
      ["applying", await hook(dir)],
      ["triaging", await hook(triaged)],
    ]) {
      assert.ok(
        context.includes(
          `its state file says \`Status: ${status}\`. This session is its main session. An agent that the main ` +
            "session started (a runner, a reviewer) is not meant by this note and goes on with its work. Read the " +
            "state file by section, never whole: ",
        ),
        context,
      );
      assert.doesNotMatch(context, /orchestrator/i);
    }
  });

  test("names the sections the state file has, so that the session can ask for any of them", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE);

    const { context } = await hook(dir);

    assert.ok(
      context.includes(
        "Resume here, Run, Chapter plan, Agents, Standing rules, What the code holds now, Baseline, Acceptance tests, Open, Allowed failures, Design files",
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
      context.endsWith(`${GET(CHANGE)} "Resume here" --section "Open" --section "Agents"\``),
      context.slice(-300),
    );
    assert.match(context, /cut at 4,000 characters/);
  });

  test("cuts the list of agents, which comes last, and never what is open before it", async (t) => {
    const dir = await repository(t);
    const open = Array.from({ length: 12 }, (_, i) => `- Q${i + 1}: a made-up question that waits for the owner`);
    const agents = Array.from({ length: 200 }, (_, i) => `- **Agent ${i + 1}:** a${i + 1}, retired at 150k tokens`);
    stateFile(dir, CHANGE, {
      change: (text) => setSection(setSection(underWay(text), "Open", open.join("\n")), "Agents", agents.join("\n")),
    });

    const { context } = await hook(dir);

    assert.ok(context.length <= 4000 && context.length > 3900, `${context.length} characters`);
    assert.ok(context.includes("## Resume here\nChapter B, group 7 (red).\nThe last commit is [green] of group 6."));
    assert.ok(context.includes(`## Open\n${open.join("\n")}\n\n## Agents\n- **Agent 1:** a1, retired`), context);
    assert.equal(context.includes("**Agent 200:**"), false);
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

describe("tdd-resume hook: a triage", { concurrency: true }, () => {
  test("for a triage under way, says so and adds its Resume here, Open and Agents sections, in that order", async (t) => {
    const dir = await repository(t);
    await triage(dir, triageFile(dir, CHANGE), { edit: fixing, change: CHANGE, scope: "c900" });

    const r = await hook(dir);

    assert.equal(r.code, 0);
    assert.equal(r.err, "");
    const [intro, ...sections] = r.context.split("\n\n");
    assert.ok(intro.startsWith(triageUnderWay("PR 109 of `c900-add-made-up-thing`", 2)), intro);
    assert.match(intro, /this session is its main session/i);
    assert.ok(intro.includes(`\`${GET_TRIAGE("109")} "<name>"\``), intro);
    assert.ok(intro.includes("(its sections: Resume here, Run, Agents, Open, Allowed failures, Round 2)"), intro);
    assert.deepEqual(sections, [
      "## Resume here\nThe fix round: finding 3 is next.\nFindings 1 and 2 are fixed.",
      "## Open\n- finding 5: asked, waiting for the owner",
      "## Agents\n- **Runner:** r1s2t3, 61k tokens",
    ]);
  });

  test("covers a round after the change was archived, where it looks for no apply", async (t) => {
    const dir = await repository(t);
    const archived = `archive/2026-11-23-${CHANGE}`;
    stateFile(dir, archived, { change: underWay });
    await triage(dir, triageFile(dir, archived), { edit: fixing, round: 3, change: CHANGE, scope: "c900" });

    const r = await hook(dir);

    assert.ok(r.context.startsWith(triageUnderWay("PR 109 of `c900-add-made-up-thing`", 3)), r.context);
    assert.ok(r.context.includes("(its sections: Resume here, Run, Agents, Open, Allowed failures, Round 3)"));
    assert.ok(r.context.includes("## Open\n- finding 5: asked, waiting for the owner"));
    assert.equal(r.context.includes("/tdd-apply is under way"), false);
  });

  test("covers a PR without a change, whose state file lies in git's folder, next to the pointer", async (t) => {
    const dir = await repository(t);
    await triage(dir, await prStateFile(dir, "local"), { edit: fixing, pr: "local", round: 1 });

    const r = await hook(dir);

    assert.ok(r.context.startsWith(triageUnderWay("PR local", 1)), r.context);
    assert.ok(r.context.includes(`\`${GET_TRIAGE("local")} "<name>"\``), r.context);
    assert.ok(r.context.includes("## Resume here\nThe fix round: finding 3 is next."));
  });

  test("names the work folder, which the session can no longer read from the state file, with forward slashes", async (t) => {
    const dir = await repository(t);
    const work = join(tempFolder(t), "another session", "triage-review", "109-r2");
    await triage(dir, await prStateFile(dir), { edit: fixing, work: work });

    const { context } = await hook(dir);

    const named = /^\/triage-review is under way for PR 109, round 2, with the work folder `([^`]+)`: /.exec(
      context,
    )?.[1];
    assert.equal(named, slashed(work));
    assert.equal(named.includes("\\"), false, named);
    assert.ok(named.endsWith("/another session/triage-review/109-r2"), named);
    assert.equal(context.split(slashed(work)).length, 2, "said once, in the first sentence");
  });

  test("reads the pointer from a folder inside the working tree", async (t) => {
    const dir = await repository(t);
    await triage(dir, await prStateFile(dir), { edit: fixing });
    mkdirSync(join(dir, "src", "App"), { recursive: true });

    const r = await hook(join(dir, "src", "App"));

    assert.ok(r.context.startsWith(triageUnderWay("PR 109", 2)), r.context);
  });

  test("takes the status whatever its case, and a CRLF state file the same", async (t) => {
    const dir = await repository(t);
    const other = await repository(t);
    await triage(dir, await prStateFile(dir), {
      status: "Triaging",
      edit: (text) => fixing(text).replace(/\n/g, "\r\n"),
    });
    await triage(other, await prStateFile(other), { edit: fixing });

    const r = await hook(dir);

    assert.equal(r.context.includes("\r"), false);
    assert.equal(r.context, (await hook(other)).context);
  });

  test("prints nothing for a triage that is done", async (t) => {
    const dir = await repository(t);
    await triage(dir, triageFile(dir, CHANGE), { status: "done", edit: fixing });

    assert.deepEqual(await hook(dir), { code: 0, context: null, out: "", err: "" });
  });

  test("prints nothing when the pointer's state file is gone", async (t) => {
    const dir = await repository(t);
    await triage(dir, await prStateFile(dir), { edit: fixing });
    rmSync(await prStateFile(dir));

    assert.deepEqual(await hook(dir), { code: 0, context: null, out: "", err: "" });
  });

  test("goes by the pointer alone: a triage's state file without one adds nothing", async (t) => {
    const dir = await repository(t);
    const elsewhere = await repository(t);
    await triage(elsewhere, triageFile(dir, CHANGE), { edit: fixing });

    assert.deepEqual(await hook(dir), { code: 0, context: null, out: "", err: "" });
    assert.notEqual((await hook(elsewhere)).context, null);
  });

  test("a linked working tree has a pointer of its own", async (t) => {
    const dir = await repository(t);
    const linked = join(tempFolder(t), "linked");
    const git = async (...args) => {
      const r = await started("git", ["-c", "user.name=A Tester", "-c", "user.email=tester@example.com", ...args], {
        cwd: dir,
      });
      assert.equal(r.code, 0, r.err);
    };
    await git("commit", "--quiet", "--allow-empty", "-m", "chore: the made-up repository");
    await git("worktree", "add", "--quiet", "-b", "fix/made-up-thing", linked);
    await triage(linked, await prStateFile(linked, "110"), { edit: fixing, pr: "110", round: 1 });

    assert.ok((await hook(linked)).context.startsWith(triageUnderWay("PR 110", 1)));
    assert.deepEqual(await hook(dir), { code: 0, context: null, out: "", err: "" });
  });

  test("adds an apply and a triage that are both under way, the apply first", async (t) => {
    const dir = await repository(t);
    stateFile(dir, CHANGE, { change: underWay });
    await triage(dir, await prStateFile(dir), { edit: fixing });

    const { context } = await hook(dir);

    assert.match(context, /^\/tdd-apply is under way for `c900-add-made-up-thing`/);
    assert.ok(context.includes(`\n\n${triageUnderWay("PR 109", 2)}`), context);
    assert.ok(context.includes("## Open\n- a dispute about the error model, with the test-writer"));
    assert.ok(context.includes("## Open\n- finding 5: asked, waiting for the owner"));
  });

  test("cuts an apply and a triage together at 4,000 characters, with a note that names both commands", async (t) => {
    const dir = await repository(t);
    const long = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of a made-up, much too long account.`).join("\n");
    stateFile(dir, CHANGE, { change: underWay });
    await triage(dir, await prStateFile(dir), { edit: (text) => fixing(setSection(text, "Open", long)) });

    const { context } = await hook(dir);

    assert.ok(context.length <= 4000, `${context.length} characters`);
    assert.ok(context.length > 3900, `${context.length} characters`);
    assert.match(context, /cut at 4,000 characters/);
    assert.ok(context.includes("Line 1 of a made-up"));
    assert.equal(context.includes("Line 200 of a made-up"), false);
    const sections = '"Resume here" --section "Open" --section "Agents"';
    assert.ok(
      context.endsWith(`read the rest with \`${GET(CHANGE)} ${sections}\` and \`${GET_TRIAGE("109")} ${sections}\``),
      context.slice(-400),
    );
  });

  test("cuts a triage alone at 4,000 characters, with a note that names its command", async (t) => {
    const dir = await repository(t);
    const long = Array.from({ length: 200 }, (_, i) => `Line ${i + 1} of a made-up, much too long account.`).join("\n");
    await triage(dir, await prStateFile(dir), { edit: (text) => fixing(setSection(text, "Open", long)) });

    const { context } = await hook(dir);

    assert.ok(context.length <= 4000 && context.length > 3900, `${context.length} characters`);
    assert.ok(
      context.endsWith(`${GET_TRIAGE("109")} "Resume here" --section "Open" --section "Agents"\``),
      context.slice(-300),
    );
  });

  test("reads what `tdd.mjs triage-init` writes, for a PR without a change and for a change's", async (t) => {
    for (const change of [null, CHANGE]) {
      const dir = tempFolder(t);
      const work = tempFolder(t);
      const init = await started("git", ["init", "--quiet", "--initial-branch=fix/made-up-thing"], { cwd: dir });
      assert.equal(init.code, 0, init.err);
      if (change) mkdirSync(join(dir, "openspec", "changes", change), { recursive: true });
      const tdd = (...args) =>
        started(process.execPath, [TDD, ...args], { cwd: dir, env: { ...process.env, TDD_NO_GRAPH: "1" } });
      const whose = change ? ["--change", change] : ["--scope", "i900"];

      const began = await tdd("triage-init", "--pr", "109", "--round", "1", "--work", work, ...whose);
      assert.equal(began.code, 0, began.err);
      const set = await tdd("set", "--pr", "109", "--section", "Resume here", "--text", "Gathering the findings.");
      assert.equal(set.code, 0, set.err);
      const r = await hook(dir);

      assert.equal(r.err, "");
      const of = change ? ` of \`${change}\`` : "";
      assert.ok(r.context.startsWith(triageUnderWay(`PR 109${of}`, 1, work)), r.context);
      assert.ok(began.out.endsWith(` | work: ${slashed(work)}\n`), "the same folder `triage-init` printed");
      assert.ok(r.context.includes("## Resume here\nGathering the findings.\n\n## Open\n—\n\n## Agents\n—"), r.context);
      assert.equal(r.context.includes("Work folder"), false, "the state file holds no work folder");
    }
  });

  test("never blocks the session: a pointer it cannot read gives one line on stderr, nothing on stdout, exit 0", async (t) => {
    for (const pointer of ["", "not json", '{ "pr": "109" }', "null"]) {
      const dir = await repository(t);
      stateFile(dir, CHANGE, { change: underWay });
      const folder = await gitFolder(dir);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "triage.json"), pointer);

      const r = await hook(dir);

      assert.equal(r.code, 0, pointer);
      assert.equal(r.out, "", pointer);
      assert.match(r.err, /^tdd-resume hook: the triage's pointer .+\n$/, pointer);
      assert.equal(r.err.trim().split("\n").length, 1, r.err);
    }
  });
});
