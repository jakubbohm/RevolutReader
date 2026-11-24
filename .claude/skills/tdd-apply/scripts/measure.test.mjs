// Tests for measure.mjs: its pure parts called directly, and the whole report on a made-up run.
//
// The run in fixtures/measure/ is invented from the first character to the last: a shop, a change `c001-add-gift-
// wrap`, a main session that starts a runner, which starts a test-writer. Only its shape follows what Claude Code
// writes (the folder layout, and the keys the script reads plus a few it must ignore). No text, path, name, id or
// number in it comes from a real transcript. What happens in it, in UTC on one made-up morning:
//
//   09:00:00  the owner starts /tdd-apply; the main session writes the state file and starts the runner
//   09:00:20  the runner runs the baseline through the wrapper: one command of ten minutes
//   09:10:30  its note "Baseline completed at 10:10" finds the main session idle and starts a turn (one API call)
//   09:10:36  the test-writer, started by the runner: a graph lookup, Read, Grep, two shell reads, Write, Edit,
//             an edit through a python script, a bare `dotnet test`, a script file from a temp folder
//   09:13:36  the runner builds outside the wrapper and commits
//   09:13:58  the owner asks how far it is; the second note arrives while the main session answers
//   09:14:30  the main session asks the owner with a dialog; the run stands still until 09:26:30
//   09:26:36  the end of the first session
//
// The main session writes its cache for 1 hour, the agents for 5 minutes, and the main session's last call has no
// split of its cache write at all. The token numbers the tests expect are worked out by hand from the fixture.
//
// The run goes on in a second made-up session (`1b2c…`), which the tests of the steps and of a run in two sessions
// use: the owner starts /tdd-apply again at 10:00:00, and one runner closes three slices of chapter A (10:12:00,
// 10:20:00, 10:31:00), fixes two findings (10:36:00, 10:42:00; a first commit of the second one, at 10:40:00, is
// refused) and ends with the close checks (10:44:00). Each step is named by `commit --done` or `progress --step`
// and followed by a note to the main session. Between the second and the third slice the run stands still for six
// minutes, until the owner types at 10:26:12. Its token numbers are not asserted.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  agentType,
  classifyShell,
  classifyTool,
  contextNumbers,
  inputKind,
  loadRun,
  nested,
  noteNumbers,
  parseArguments,
  progressStep,
  readTranscript,
  readUsage,
  report,
  shellCommands,
  stepCalls,
  stepStatistics,
  stepsOf,
  stepTimes,
  toolNumbers,
  weighted,
  weightedByType,
  workingTime,
} from "./measure.mjs";

const SESSION = "0a1b2c3d-1111-4222-8333-444455556666";
const RUNNER = "a11aa22bb33cc44dd";
const WRITER = "a55ee66ff77008899";
const SECOND_SESSION = "1b2c3d4e-2222-4333-8444-555566667777";
const SECOND_RUNNER = "a77aa88bb99cc00dd";
const fixturePath = (name) => fileURLToPath(new URL(`./fixtures/measure/${name}`, import.meta.url));
const MAIN_PATH = fixturePath(`${SESSION}.jsonl`);
const SECOND_MAIN_PATH = fixturePath(`${SECOND_SESSION}.jsonl`);
const fixtureText = (name) => readFileSync(fixturePath(name), "utf8");
const mainTranscript = () => readTranscript(fixtureText(`${SESSION}.jsonl`), { main: true });
const runnerTranscript = () => readTranscript(fixtureText(`${SESSION}/subagents/agent-${RUNNER}.jsonl`));
const writerTranscript = () => readTranscript(fixtureText(`${SESSION}/subagents/agent-${WRITER}.jsonl`));
const utc = (clock) => Date.parse(`2026-03-02T${clock}Z`);

// A repository on a POSIX path and one on a Windows drive, as the transcript's `cwd` names them.
const POSIX = { root: "/work/shop", cwd: "/work/shop" };
const DRIVE = { root: "D:\\work\\shop", cwd: "D:\\work\\shop" };
const TDD = "node .claude/skills/tdd-apply/scripts/tdd.mjs";

describe("readUsage and weighted", () => {
  test("splits a cache write by how long it was written for", () => {
    const usage = {
      input_tokens: 10,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 4000,
      output_tokens: 70,
      cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 300 },
    };

    assert.deepEqual(readUsage(usage), {
      input: 10,
      write5m: 200,
      write1h: 300,
      read: 4000,
      output: 70,
      context: 4510,
    });
  });

  test("counts a cache write without the split as written for 5 minutes", () => {
    const usage = { input_tokens: 5, cache_creation_input_tokens: 800, cache_read_input_tokens: 0, output_tokens: 1 };

    assert.deepEqual(readUsage(usage), { input: 5, write5m: 800, write1h: 0, read: 0, output: 1, context: 805 });
  });

  test("reads a usage with nothing but input and output", () => {
    assert.deepEqual(readUsage({ input_tokens: 7, output_tokens: 3 }), {
      input: 7,
      write5m: 0,
      write1h: 0,
      read: 0,
      output: 3,
      context: 7,
    });
  });

  test("weights the five price classes", () => {
    // 100 + 1.25 × 200 + 2 × 300 + 0.1 × 4000 + 5 × 50
    assert.equal(weighted({ input: 100, write5m: 200, write1h: 300, read: 4000, output: 50 }), 1600);
  });
});

describe("shellCommands", () => {
  const words = (command, options) => shellCommands(command, options).map((c) => c.words);

  test("splits a call at ; && || | and line breaks", () => {
    assert.deepEqual(words("git status; dotnet build && echo ok || echo no | tail -3\nls"), [
      ["git", "status"],
      ["dotnet", "build"],
      ["echo", "ok"],
      ["echo", "no"],
      ["tail", "-3"],
      ["ls"],
    ]);
  });

  test("keeps a quoted text as one word, separators and all", () => {
    assert.deepEqual(words(`grep -n "a; b | c" 'd && e' f\\ g`), [["grep", "-n", "a; b | c", "d && e", "f g"]]);
  });

  test("puts a variable the call sets where it is used: split into words unquoted, whole in quotes", () => {
    assert.deepEqual(words(`T="node tdd.mjs"; C=c001; $T run --change $C; echo "$T" \${C}`), [
      ["T=node tdd.mjs"],
      ["C=c001"],
      ["node", "tdd.mjs", "run", "--change", "c001"],
      ["echo", "node tdd.mjs", "c001"],
    ]);
  });

  test("leaves a variable the call does not set as written, and one in single quotes", () => {
    assert.deepEqual(words(`T=x; cat "$HOME/a" $OTHER '$T'`), [["T=x"], ["cat", "$HOME/a", "$OTHER", "$T"]]);
  });

  test("names the files output is redirected into, and no other redirection", () => {
    const [first, second, third] = shellCommands(
      "dotnet test > out/run.log 2>&1; echo x >> notes.txt 2>/dev/null; cmd >&2",
    );

    assert.deepEqual(first, { words: ["dotnet", "test"], writes: ["out/run.log"], heredocs: [] });
    assert.deepEqual(second, { words: ["echo", "x"], writes: ["notes.txt", "/dev/null"], heredocs: [] });
    assert.deepEqual(third, { words: ["cmd"], writes: [], heredocs: [] });
  });

  test("does not take the file a command reads from as a word of it", () => {
    assert.deepEqual(shellCommands("sort < names.txt > sorted.txt"), [
      { words: ["sort"], writes: ["sorted.txt"], heredocs: [] },
    ]);
  });

  test("gives a here-document's text to its command and goes on after it", () => {
    const commands = shellCommands("cat > a.txt <<'EOF'\nfirst; line\n$T | second\nEOF\necho done");

    assert.deepEqual(commands, [
      { words: ["cat"], writes: ["a.txt"], heredocs: ["first; line\n$T | second"] },
      { words: ["echo", "done"], writes: [], heredocs: [] },
    ]);
  });

  test("reads a here-document whose lines end in CRLF", () => {
    assert.deepEqual(
      shellCommands("python - <<EOF\r\nprint(1)\r\nEOF\r\nls").map((c) => [c.words, c.heredocs]),
      [
        [["python", "-"], ["print(1)"]],
        [["ls"], []],
      ],
    );
  });

  test("lists a command inside $( ) before the command that holds it", () => {
    assert.deepEqual(words('echo "$(cat a.txt | head -1)" end'), [
      ["cat", "a.txt"],
      ["head", "-1"],
      ["echo", "$(cat a.txt | head -1)", "end"],
    ]);
  });

  test("skips a comment, an arithmetic test and a [[ ]] test, whose > compares", () => {
    assert.deepEqual(shellCommands("ls # > not.txt\nif (( n > 3 )); then echo big; fi; [[ $a > $b ]] && echo more"), [
      { words: ["ls"], writes: [], heredocs: [] },
      { words: ["if"], writes: [], heredocs: [] },
      { words: ["then", "echo", "big"], writes: [], heredocs: [] },
      { words: ["fi"], writes: [], heredocs: [] },
      { words: ["echo", "more"], writes: [], heredocs: [] },
    ]);
  });

  test("reads PowerShell: a backslash is a letter, the backtick escapes, a here-string is one word", () => {
    assert.deepEqual(words("Get-Content D:\\work\\a.txt; echo a` b", { powershell: true }), [
      ["Get-Content", "D:\\work\\a.txt"],
      ["echo", "a b"],
    ]);
    assert.deepEqual(words("node -e @'\nconsole.log(1); // x\n'@ ; ls", { powershell: true }), [
      ["node", "-e", "console.log(1); // x"],
      ["ls"],
    ]);
  });
});

describe("classifyShell: runs through the wrapper and bare ones", () => {
  const runs = (command, where = POSIX) => {
    const { wrapped, bare } = classifyShell(command, where);
    return { wrapped, bare };
  };

  test("counts a run through tdd.mjs run, and not the command it wraps", () => {
    assert.deepEqual(runs(`${TDD} run --change c001 --label unit -- dotnet test --project tests/Unit`), {
      wrapped: 1,
      bare: 0,
    });
  });

  test("finds the wrapper behind a variable, and counts every run of a call", () => {
    const command = `T="${TDD}"; C="--change c001"; $T run $C --label a -- dotnet test 2>&1 | tail -30; $T run $C --label b -- npm --prefix src/Web test`;

    assert.deepEqual(runs(command), { wrapped: 2, bare: 0 });
  });

  test("counts no run for the script's other commands, or for reading the script", () => {
    assert.deepEqual(runs(`${TDD} commit --change c001 --type test --tag red --summary "dotnet test is red"`), {
      wrapped: 0,
      bare: 0,
    });
    assert.deepEqual(runs(`${TDD} progress --step "Baseline"; cat .claude/skills/tdd-apply/scripts/tdd.mjs`), {
      wrapped: 0,
      bare: 0,
    });
  });

  test("counts a wrapped and a bare run of one call apart", () => {
    assert.deepEqual(runs(`dotnet build && ${TDD} run --change c001 --label unit -- dotnet test`), {
      wrapped: 1,
      bare: 1,
    });
  });

  for (const command of [
    "dotnet test",
    "dotnet build src/Shop.Api",
    "dotnet format whitespace Shop.slnx --verify-no-changes",
    "dotnet run --project tests/Unit",
    "npm test",
    "npm --prefix src/Web test -- src/a.test.ts",
    "npm --prefix src/Web run lint",
    "npx vitest run src/a.test.ts",
    "node_modules/.bin/vitest run",
    "tsc --noEmit",
    'node --test "scripts/*.test.mjs"',
    "timeout 600 dotnet test --project tests/Unit",
    "cd src/Web && npm run typecheck",
    "FORCE_COLOR=0 npm test",
    "if ! dotnet build; then echo failed; fi",
  ]) {
    test(`counts as a bare run: ${command}`, () => {
      assert.equal(runs(command).bare, 1);
    });
  }

  for (const command of [
    "dotnet --version",
    "npm ci",
    "npm --prefix tools/api-client install",
    "git status --porcelain",
    "echo dotnet test",
    'grep -rn "dotnet test" docs',
    "node scripts/build-icons.mjs --test",
    "docker info",
  ]) {
    test(`counts as no run: ${command}`, () => {
      assert.deepEqual(runs(command), { wrapped: 0, bare: 0 });
    });
  }

  test("counts every bare run of a call", () => {
    assert.equal(runs("dotnet build 2>&1 | tail -3; dotnet test | grep failed; npm --prefix src/Web run lint").bare, 3);
  });
});

describe("classifyShell: files changed through the shell", () => {
  const edits = (command, where = POSIX, powershell = false) =>
    classifyShell(command, { ...where, powershell }).scriptEdit;

  for (const command of [
    "sed -i 's/Wrap/GiftWrap/' src/Shop.Api/Order.cs",
    "sed -i.bak -e 's/a/b/' -e 's/c/d/' src/a.cs",
    "sed -E -i 's/a+/b/' src/a.cs",
    "perl -pi -e 's/a/b/' src/a.cs",
    "perl -0pi -e 's/a\\nb/c/' src/a.cs",
    "echo done > notes.txt",
    "echo more >> docs/notes.md",
    "git diff > change.patch",
    "cat > src/New.cs <<'EOF'\nclass New {}\nEOF",
    "cat <<EOF > src/New.cs\nclass New {}\nEOF",
    "printf 'x' | tee src/a.txt",
    "dotnet test 2>&1 | tee -a run.log",
    "python - <<'EOF'\nfrom pathlib import Path\nPath('src/a.cs').write_text('x')\nEOF",
    "python3 -c \"open('src/a.cs', 'w').write('x')\"",
    "python - <<'EOF'\ns = open(p, encoding='utf-8', newline='').read()\nopen(p, 'w', encoding='utf-8', newline='').write(s)\nEOF",
    "node -e \"const fs=require('fs');fs.writeFileSync('src/a.ts', fs.readFileSync('src/a.ts','utf8').replace('a','b'))\"",
    "node --input-type=module <<'EOF'\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('src/a.ts', 'x');\nEOF",
    "find src -name '*.cs' -exec sed -i 's/a/b/' {} +",
    "grep -rl Wrap src | xargs sed -i 's/Wrap/GiftWrap/'",
    "for f in src/a.cs src/b.cs; do sed -i 's/a/b/' \"$f\"; done",
    "patch -p1 < fix.patch",
    "git apply fix.patch",
    "awk -i inplace '{ print }' src/a.txt",
    "bash -c \"sed -i 's/a/b/' src/a.cs\"",
    'OUT=$(pwd)/x.txt; echo x > "$OUT"',
    "echo x > /work/shop/src/a.txt",
  ]) {
    test(`counts as an edit: ${command.split("\n")[0]}`, () => {
      assert.equal(edits(command), true);
    });
  }

  for (const command of [
    "dotnet test > /dev/null 2>&1",
    "dotnet test 2>&1 | tail -30",
    "dotnet test > /tmp/run.log 2>&1",
    'npm test > "$TEMP/web.log" 2>&1',
    'W="/scratch/run-7"; dotnet test > "$W/unit.txt" 2>&1; echo "exit $?" >> "$W/exit.txt"',
    'LOG=$(mktemp); dotnet test > "$LOG"',
    "echo x > ~/notes.txt",
    "echo x > .git/tdd/note.txt",
    "cd /tmp && echo x > note.txt",
    "sed -n '1,40p' src/a.cs",
    "sed -i 's/a/b/' /tmp/scratch.txt",
    "cat src/a.cs | tee /dev/null",
    "python - <<'EOF'\nprint(open('src/a.cs').read())\nEOF",
    "python - <<'EOF'\nimport os\nprint(open(os.path.join(d, 'data.txt'), 'r').read())\nEOF",
    "node -e \"console.log(require('fs').readFileSync('src/a.ts','utf8').length)\"",
    "git apply --check fix.patch",
    "git stash apply",
    "git commit -q -F - <<'EOF'\nfeat: a > b\n\nwriteFileSync and sed -i are only words here\nEOF",
    `${TDD} set --change c001 --section Open --stdin <<'EOF'\n- Q1: which wrap > which box\nEOF`,
    'echo "a > b" && grep -c ">" src/a.html',
    "if (( count > 3 )); then echo many; fi",
    "git restore -- src/a.cs",
    "dotnet format whitespace Shop.slnx",
  ]) {
    test(`counts as no edit: ${command.split("\n")[0]}`, () => {
      assert.equal(edits(command), false);
    });
  }

  test("tells inside from outside the repository on a Windows drive, also in Git Bash's spelling", () => {
    assert.equal(edits("echo x > D:/work/shop/src/a.txt", DRIVE), true);
    assert.equal(edits("echo x > /d/work/shop/src/a.txt", DRIVE), true);
    assert.equal(edits('echo x > "D:\\\\Work\\\\Shop\\\\src\\\\a.txt"', DRIVE), true);
    assert.equal(edits("echo x > /d/work/shop-notes/a.txt", DRIVE), false);
    assert.equal(edits("echo x > /c/Users/someone/AppData/Local/Temp/a.txt", DRIVE), false);
    assert.equal(edits("cd /d/work/shop/src && echo x > ../docs/a.txt", DRIVE), true);
    assert.equal(edits("cd /d/work/shop/src && echo x > ../../other/a.txt", DRIVE), false);
  });

  test("takes a relative path as the repository's when the transcript does not say where that is", () => {
    const nowhere = { root: null, cwd: null };

    assert.equal(edits("echo x > src/a.txt", nowhere), true);
    assert.equal(edits("echo x > /tmp/a.txt", nowhere), false);
    assert.equal(classifyShell("cat src/a.cs; cat /somewhere/else.cs", nowhere).reads, 1);
  });

  test("counts PowerShell's own ways of writing a file", () => {
    assert.equal(edits("Set-Content -Path src\\a.txt -Value 'x'", DRIVE, true), true);
    assert.equal(edits("(Get-Content src\\a.cs) -replace 'a', 'b' | Set-Content src\\a.cs", DRIVE, true), true);
    assert.equal(edits("dotnet test | Out-File -FilePath run.log", DRIVE, true), true);
    assert.equal(edits("[System.IO.File]::WriteAllText('src\\a.txt', $text)", DRIVE, true), true);
    assert.equal(edits("dotnet test | Out-File $env:TEMP\\run.log", DRIVE, true), false);
    assert.equal(edits("dotnet test > $null", DRIVE, true), false);
  });

  test("marks a script file from outside the repository, which the text cannot judge", () => {
    const outside = (command) => classifyShell(command, POSIX);

    assert.deepEqual(outside("node /tmp/sort-usings.mjs src/a.cs"), {
      scriptEdit: false,
      outsideScript: true,
      reads: 0,
      wrapped: 0,
      bare: 0,
    });
    assert.equal(outside('S="/scratch/run-7"; python "$S/rename.py" src').outsideScript, true);
    assert.equal(outside("node tools/api-client/regenerate.mjs").outsideScript, false);
    assert.equal(outside(`${TDD} get --change c001 --section Open`).outsideScript, false);
  });
});

describe("classifyShell: plain reads of repository files", () => {
  const reads = (command, where = POSIX, powershell = false) => classifyShell(command, { ...where, powershell }).reads;

  for (const [command, count] of [
    ["cat src/Shop.Api/Order.cs", 1],
    ["head -n 40 src/a.cs", 1],
    ["head -40 src/a.cs", 1],
    ["tail -5 docs/notes.md", 1],
    ["sed -n '10,60p' src/a.cs", 1],
    ["sed -n -e '1p' -e '9p' src/a.cs", 1],
    ["cat src/a.cs src/b.cs src/c.cs", 1],
    ["cat src/a.cs; sed -n 1,5p src/b.cs", 2],
    ["cat src/a.cs | head -40", 1],
    ["cd src && cat a.cs && cd .. && tail -3 docs/b.md", 2],
    ["cat /work/shop/src/a.cs", 1],
    ['D=openspec/changes/c001; sed -n 1,30p "$D/tasks.md"', 1],
    ['echo "$(cat src/a.cs)"', 1],
  ]) {
    test(`counts ${count}: ${command}`, () => {
      assert.equal(reads(command), count);
    });
  }

  for (const command of [
    "dotnet test 2>&1 | tail -30",
    'grep -n "Wrap" src/a.cs | head -20',
    "git show HEAD:src/a.cs | sed -n '1,40p'",
    "cat /tmp/tdd-runs/c001/unit.log",
    "tail -50 /home/someone/.claude/projects/shop/tool-results/toolu_1.txt",
    'tail -f "$LOG"',
    "cat <<'EOF'\nsrc/a.cs\nEOF",
    "cat > src/a.txt <<'EOF'\nx\nEOF",
    "cd /tmp && cat a.txt",
    'cd "$SCRATCH" && cat a.txt',
    "sed -i 's/a/b/' src/a.cs",
    "wc -l src/a.cs; ls src",
    "cat .git/HEAD",
  ]) {
    test(`counts none: ${command.split("\n")[0]}`, () => {
      assert.equal(reads(command), 0);
    });
  }

  test("counts PowerShell's Get-Content on a file of the repository", () => {
    assert.equal(reads("Get-Content -Path src\\a.cs -TotalCount 20", DRIVE, true), 1);
    assert.equal(reads("Get-Content src\\a.cs | Select-Object -First 5", DRIVE, true), 1);
    assert.equal(reads("Get-Content C:\\Users\\someone\\AppData\\Local\\Temp\\run.log -Tail 20", DRIVE, true), 0);
  });
});

describe("classifyTool", () => {
  const kind = (name, input) => classifyTool(name, input, POSIX).kind;

  test("names each tool's kind", () => {
    assert.equal(kind("mcp__codebase-memory-mcp__search_graph"), "graph");
    assert.equal(kind("mcp__codebase-memory-mcp__get_code_snippet"), "graph");
    assert.equal(kind("Read"), "read");
    assert.equal(kind("Grep"), "search");
    assert.equal(kind("Glob"), "search");
    assert.equal(kind("Edit"), "edit");
    assert.equal(kind("Write"), "edit");
    assert.equal(kind("Agent"), "agent");
    assert.equal(kind("SendMessage"), "message");
    assert.equal(kind("ToolSearch"), "other");
    assert.equal(kind("mcp__another-server__search"), "other");
  });

  test("keeps the code graph's index calls apart from its lookups", () => {
    assert.equal(kind("mcp__codebase-memory-mcp__index_repository"), "index");
    assert.equal(kind("mcp__codebase-memory-mcp__index_status"), "index");
  });

  test("reads a shell call's command, for Bash and for PowerShell", () => {
    assert.deepEqual(classifyTool("Bash", { command: "sed -i 's/a/b/' src/a.cs; dotnet build" }, POSIX), {
      kind: "shell",
      shell: { scriptEdit: true, outsideScript: false, reads: 0, wrapped: 0, bare: 1 },
      steps: [],
    });
    assert.deepEqual(classifyTool("PowerShell", { command: "Get-Content src\\a.cs" }, DRIVE), {
      kind: "shell",
      shell: { scriptEdit: false, outsideScript: false, reads: 1, wrapped: 0, bare: 0 },
      steps: [],
    });
    assert.equal(classifyTool("Bash", undefined, POSIX).kind, "shell");
  });

  test("keeps the steps a shell call reports through the bookkeeping script", () => {
    assert.deepEqual(classifyTool("Bash", { command: `${TDD} progress --step "Baseline"` }, POSIX).steps, [
      { kind: "progress", step: "Baseline" },
    ]);
  });
});

describe("stepCalls", () => {
  test("reads a commit's tag, summary and the step it names", () => {
    const command = `${TDD} commit --change c001 --type feat --tag close --summary "The order remembers its wrap" --tick 2.1,2.2 --done "Chapter A, slice 1"`;

    assert.deepEqual(stepCalls(command), [
      { kind: "commit", tag: "close", summary: "The order remembers its wrap", done: "Chapter A, slice 1" },
    ]);
  });

  test("reads a commit that names no step, as transcripts from before the option have them", () => {
    assert.deepEqual(stepCalls(`${TDD} commit --change c001 --type test --tag red --summary "Slice 2, red"`), [
      { kind: "commit", tag: "red", summary: "Slice 2, red", done: null },
    ]);
  });

  test("reads a progress call's step", () => {
    assert.deepEqual(stepCalls(`${TDD} progress --step "Close checks"`), [{ kind: "progress", step: "Close checks" }]);
  });

  test("finds the script behind the call's own variables, among other commands, each call in order", () => {
    const command = `git status --porcelain && T="${TDD}"; C="--change c001"; $T commit $C --type fix --tag chapter-review --summary "A-1: fixed" --done "Finding A-1" | head -2; $T progress --step="Close checks"`;

    assert.deepEqual(stepCalls(command), [
      { kind: "commit", tag: "chapter-review", summary: "A-1: fixed", done: "Finding A-1" },
      { kind: "progress", step: "Close checks" },
    ]);
  });

  test("takes no other command for a step", () => {
    for (const command of [
      `${TDD} run --change c001 --label unit -- dotnet test`,
      `${TDD} get --change c001 --section "Resume here"`,
      `${TDD} progress`,
      'git commit -m "feat: slice 1" --done "x"',
      `grep -n "commit --done" .claude/skills/tdd-apply/scripts/tdd.mjs`,
      `echo "${TDD} commit --tag close --done 'Chapter A, slice 1'"`,
      "",
    ]) {
      assert.deepEqual(stepCalls(command), [], command);
    }
  });
});

describe("progressStep", () => {
  test("reads the step of a progress line", () => {
    assert.equal(progressStep("Baseline completed at 10:10"), "Baseline");
    assert.equal(progressStep("Chapter A, slice 3 completed at 9:05"), "Chapter A, slice 3");
    assert.equal(progressStep("Finding B-2 completed at 23:59:07\n"), "Finding B-2");
  });

  test("looks past the lines the harness puts before an agent's message", () => {
    assert.equal(
      progressStep("<made-up-notice/>\nA sentence the harness adds.\nClose checks completed at 16:24"),
      "Close checks",
    );
  });

  test("takes nothing else for a progress note", () => {
    assert.equal(progressStep("Baseline completed at 10:10\nand the acceptance tests are next"), null);
    assert.equal(progressStep("The baseline completed at 10:10, 41 tests green"), null);
    assert.equal(progressStep("Baseline completed at 25:10"), null);
    assert.equal(progressStep("Baseline completed"), null);
    assert.equal(progressStep("[Subagent hand-back] ACCEPTANCE DONE"), null);
    assert.equal(progressStep(""), null);
    assert.equal(progressStep(undefined), null);
  });
});

describe("inputKind", () => {
  const prompt = (content, extra = {}) => ({ type: "user", message: { role: "user", content }, ...extra });
  const framed = (body) => `A message:\n<agent-message from="a0b1c2">\n${body}\n</agent-message>\n\n(a note)`;

  test("takes what the owner typed and his commands for the owner's", () => {
    assert.equal(inputKind(prompt("start chapter A", { origin: { kind: "human" } })), "owner");
    assert.equal(inputKind(prompt("<command-name>/tdd-apply</command-name>", { origin: { kind: "human" } })), "owner");
  });

  test("tells an older transcript's prompts by their text", () => {
    assert.equal(inputKind(prompt("start chapter A")), "owner");
    assert.equal(inputKind(prompt("<command-name>/compact</command-name>")), "owner");
    assert.equal(
      inputKind(prompt("<local-command-caveat>A made-up caveat.</local-command-caveat>", { isMeta: true })),
      "owner",
    );
    assert.equal(inputKind(prompt("<local-command-stdout>Done</local-command-stdout>")), "machine");
    assert.equal(
      inputKind(prompt([{ type: "text", text: "Base directory for this skill: /work/shop" }], { isMeta: true })),
      "machine",
    );
    assert.equal(
      inputKind(prompt("<system-reminder>A made-up reminder.</system-reminder>", { isMeta: true })),
      "machine",
    );
    assert.equal(
      inputKind(prompt("This session is being continued from an earlier one.", { isCompactSummary: true })),
      "machine",
    );
    assert.equal(inputKind(prompt("<task-notification><task-id>t1</task-id></task-notification>")), "notification");
  });

  test("tells an agent's note, its final report and any other message of it apart", () => {
    const peer = (body, more = {}) => prompt(framed(body), { isMeta: true, origin: { kind: "peer", body, ...more } });

    assert.equal(inputKind(peer("Baseline completed at 10:10")), "note");
    assert.equal(inputKind(peer("[Subagent hand-back] DONE", { handback: true })), "handback");
    assert.equal(inputKind(peer("Slice 2 completed at 10:40", { handback: true })), "handback");
    assert.equal(inputKind(peer("May I split chapter B?")), "agent");
    assert.equal(inputKind(prompt(framed("Baseline completed at 10:10"))), "note");
    assert.equal(inputKind(prompt(framed("[Subagent hand-back] DONE"))), "handback");
  });

  test("takes a message from another session for input from outside, and other machine input for the machine's", () => {
    const outside = '<cross-session-message from="another">go on</cross-session-message>';

    assert.equal(inputKind(prompt(outside, { isMeta: true, origin: { kind: "peer" } })), "session");
    assert.equal(
      inputKind(prompt("<task-notification>x</task-notification>", { origin: { kind: "task-notification" } })),
      "notification",
    );
    assert.equal(inputKind(prompt("something new", { origin: { kind: "coordinator" } })), "machine");
  });
});

describe("readTranscript", () => {
  test("counts each API call once, with its last record's usage, and no synthetic answer", () => {
    const { calls } = mainTranscript();

    assert.equal(calls.length, 8);
    assert.deepEqual(
      calls.map((call) => call.context),
      [20012, 20720, 21126, 21430, 21785, 22290, 23197, 23387],
    );
    assert.deepEqual(calls[0], {
      at: utc("09:00:04"),
      turn: 0,
      model: "claude-sample-1",
      input: 12,
      write5m: 0,
      write1h: 20000,
      read: 0,
      output: 300,
      context: 20012,
    });
    // The last call's cache write has no split: counted as written for 5 minutes.
    assert.equal(calls[7].write5m, 23382);
    assert.equal(calls[7].write1h, 0);
  });

  test("names what started each turn of the main session, and the turn each call belongs to", () => {
    const { turns, calls } = mainTranscript();

    assert.deepEqual(turns, [
      { at: utc("09:00:00"), kind: "owner" },
      { at: utc("09:10:30"), kind: "note" },
      { at: utc("09:13:58"), kind: "owner" },
      { at: utc("09:14:25"), kind: "handback" },
    ]);
    assert.deepEqual(
      calls.map((call) => call.turn),
      [0, 0, 0, 1, 2, 2, 3, 3],
    );
  });

  test("keeps the owner's inputs as events, named without their text", () => {
    const owner = mainTranscript().events.filter((event) => event.kind === "owner");

    assert.deepEqual(owner, [
      { at: utc("09:00:00"), kind: "owner", label: "command /tdd-apply" },
      { at: utc("09:13:58"), kind: "owner", label: "typed" },
      { at: utc("09:26:30"), kind: "owner", label: "answer to a question dialog" },
    ]);
  });

  test("notes a progress note that arrived while the session was working, which starts no turn", () => {
    assert.deepEqual(mainTranscript().absorbed, [utc("09:14:04")]);
  });

  test("tells no prompt apart in an agent's transcript", () => {
    const { turns, events, absorbed } = runnerTranscript();

    assert.deepEqual(turns, []);
    assert.deepEqual(absorbed, []);
    assert.equal(
      events.every((event) => event.kind === "work"),
      true,
    );
    assert.equal(events.length, 19);
  });

  test("classifies each tool call once, from the folder the session runs in", () => {
    const { tools, cwd } = writerTranscript();

    assert.equal(cwd, "D:\\work\\sample-shop");
    assert.deepEqual(
      tools.map((tool) => [tool.name, tool.kind]),
      [
        ["mcp__codebase-memory-mcp__search_graph", "graph"],
        ["Read", "read"],
        ["Grep", "search"],
        ["Bash", "shell"],
        ["Write", "edit"],
        ["Edit", "edit"],
        ["Bash", "shell"],
        ["Bash", "shell"],
        ["Bash", "shell"],
      ],
    );
    assert.deepEqual(
      tools.filter((tool) => tool.kind === "shell").map((tool) => tool.shell),
      [
        { scriptEdit: false, outsideScript: false, reads: 2, wrapped: 0, bare: 0 },
        { scriptEdit: true, outsideScript: false, reads: 0, wrapped: 0, bare: 0 },
        { scriptEdit: false, outsideScript: false, reads: 0, wrapped: 0, bare: 1 },
        // The script file from a temp folder: an edit because the harness recorded a changed file after it.
        { scriptEdit: true, outsideScript: true, reads: 0, wrapped: 0, bare: 0 },
      ],
    );
  });

  // One record of an agent's transcript, made up here.
  const record = (type, clock, content, extra = {}) =>
    JSON.stringify({
      type,
      timestamp: `2026-03-02T${clock}Z`,
      cwd: "/work/shop",
      message: { content, ...extra.message },
      ...extra.top,
    });
  const shellCall = (id, clock, command) =>
    record("assistant", clock, [{ type: "tool_use", id, name: "Bash", input: { command } }], {
      message: { id: `msg_${id}`, model: "claude-sample-1", usage: { input_tokens: 1, output_tokens: 1 } },
    });
  const shellResult = (id, clock, toolUseResult) =>
    record("user", clock, [{ type: "tool_result", tool_use_id: id, content: "ok" }], { top: { toolUseResult } });

  test("counts a script file from outside as no edit when the harness recorded no changed file", () => {
    const text = [
      shellCall("t1", "10:00:00", "node /tmp/count-lines.mjs src"),
      shellResult("t1", "10:00:01", { stdout: "12", stderr: "" }),
      shellCall("t2", "10:00:02", "node /tmp/count-lines.mjs src"),
      shellResult("t2", "10:00:03", { stdout: "", bashEditDiff: { files: [], moreFiles: 0 } }),
    ].join("\n");

    assert.deepEqual(
      readTranscript(text).tools.map((tool) => tool.shell.scriptEdit),
      [false, false],
    );
  });

  test("skips a line cut off mid-write and reads lines that end in CRLF", () => {
    const whole = shellCall("t1", "10:00:00", "dotnet build");
    const text = `${whole}\r\n${shellResult("t1", "10:00:09", {})}\r\n${whole.slice(0, 80)}`;
    const { calls, tools, events } = readTranscript(text);

    assert.equal(calls.length, 1);
    assert.equal(tools.length, 1);
    assert.equal(events.length, 2);
  });

  test("counts a tool call that the transcript holds twice once", () => {
    const call = shellCall("t1", "10:00:00", "dotnet build");

    assert.equal(readTranscript(`${call}\n${call}`).tools.length, 1);
  });

  test("takes the usage of a call's last record, at the time of its first", () => {
    const part = (clock, output) =>
      record("assistant", clock, [{ type: "text", text: "x" }], {
        message: { id: "msg_1", model: "claude-sample-1", usage: { input_tokens: 500, output_tokens: output } },
      });
    const { calls } = readTranscript([part("10:00:00", 1), part("10:00:04", 240)].join("\n"));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].at, utc("10:00:00"));
    assert.equal(calls[0].output, 240);
  });

  test("takes a message from another session and a local command for input from outside", () => {
    const prompt = (clock, text, top = {}) => record("user", clock, text, { top });
    const text = [
      prompt("10:00:00", "<local-command-caveat>A made-up caveat.</local-command-caveat>", { isMeta: true }),
      prompt("10:00:00", "<command-name>/effort</command-name>\n<command-args>high</command-args>"),
      prompt("10:00:01", "<local-command-stdout>Effort set.</local-command-stdout>"),
      prompt("10:30:00", 'A message:\n<cross-session-message from="another">go on</cross-session-message>', {
        isMeta: true,
        origin: { kind: "peer", name: "another" },
      }),
    ].join("\n");

    assert.deepEqual(readTranscript(text, { main: true }).events, [
      { at: utc("10:00:00"), kind: "owner", label: "local command" },
      { at: utc("10:00:00"), kind: "owner", label: "command /effort" },
      { at: utc("10:00:01"), kind: "work" },
      { at: utc("10:30:00"), kind: "owner", label: "message from another session" },
    ]);
  });

  test("keeps the steps a runner's calls report, and marks the call whose result is a non-zero exit", () => {
    const { tools } = readTranscript(fixtureText(`${SECOND_SESSION}/subagents/agent-${SECOND_RUNNER}.jsonl`));
    const reported = tools.filter((tool) => tool.steps?.length > 0);

    assert.deepEqual(
      reported.map((tool) => [tool.at, tool.failed === true, tool.steps[0].done ?? tool.steps[0].step]),
      [
        [utc("10:12:00"), false, "Chapter A, slice 1"],
        [utc("10:20:00"), false, "Chapter A, slice 2"],
        [utc("10:31:00"), false, "Chapter A, slice 3"],
        [utc("10:36:00"), false, "Finding A-1"],
        [utc("10:40:00"), true, "Finding A-2"],
        [utc("10:42:00"), false, "Finding A-2"],
        [utc("10:44:00"), false, "Close checks"],
      ],
    );
  });
});

describe("contextNumbers", () => {
  test("gives the main session's context, output and what it took in", () => {
    // Taken in: 408 + 156 + 264 + 335 + 445 + 862 + 10; and 20012 + 2480 + (925 - 30) = 23387.
    assert.deepEqual(contextNumbers(mainTranscript().calls), {
      calls: 8,
      first: 20012,
      last: 23387,
      peak: 23387,
      output: 925,
      takenIn: 2480,
      cuts: 0,
    });
  });

  test("gives the runner's and the test-writer's", () => {
    assert.deepEqual(contextNumbers(runnerTranscript().calls), {
      calls: 8,
      first: 24003,
      last: 27594,
      peak: 27594,
      output: 1490,
      takenIn: 2501,
      cuts: 0,
    });
    assert.deepEqual(contextNumbers(writerTranscript().calls), {
      calls: 8,
      first: 24502,
      last: 35866,
      peak: 35866,
      output: 1850,
      takenIn: 9814,
      cuts: 0,
    });
  });

  test("counts a step in which the context got smaller as a cut, and its peak before it", () => {
    const calls = [
      { context: 100_000, output: 1_000 },
      { context: 150_000, output: 2_000 },
      { context: 40_000, output: 500 },
      { context: 60_000, output: 700 },
    ];

    // Taken in: 49,000 before the cut and 19,500 after it.
    assert.deepEqual(contextNumbers(calls), {
      calls: 4,
      first: 100_000,
      last: 60_000,
      peak: 150_000,
      output: 4_200,
      takenIn: 68_500,
      cuts: 1,
    });
  });

  test("gives zeros for no call", () => {
    assert.deepEqual(contextNumbers([]), { calls: 0, first: 0, last: 0, peak: 0, output: 0, takenIn: 0, cuts: 0 });
  });
});

describe("toolNumbers", () => {
  test("counts the test-writer's tool calls by kind", () => {
    assert.deepEqual(toolNumbers(writerTranscript().tools), {
      graph: 1,
      index: 0,
      read: 1,
      search: 1,
      edit: 2,
      shell: 4,
      scriptEdits: 2,
      shellReads: 2,
      wrappedRuns: 0,
      bareRuns: 1,
      agents: 0,
      messages: 0,
      other: 0,
    });
  });

  test("counts the runner's: two runs through the wrapper in one call, one bare build", () => {
    assert.deepEqual(toolNumbers(runnerTranscript().tools), {
      graph: 0,
      index: 0,
      read: 0,
      search: 0,
      edit: 0,
      shell: 4,
      scriptEdits: 0,
      shellReads: 0,
      wrappedRuns: 2,
      bareRuns: 1,
      agents: 1,
      messages: 2,
      other: 2,
    });
  });

  test("counts no edit for the main session's bookkeeping, whatever the harness recorded after it", () => {
    const numbers = toolNumbers(mainTranscript().tools);

    assert.equal(numbers.shell, 2);
    assert.equal(numbers.scriptEdits, 0);
    assert.equal(numbers.agents, 1);
    assert.equal(numbers.other, 1);
  });
});

describe("workingTime", () => {
  const runEvents = () => [
    ...mainTranscript().events.map((event) => ({ ...event, source: "main" })),
    ...runnerTranscript().events.map((event) => ({ ...event, source: "runner" })),
    ...writerTranscript().events.map((event) => ({ ...event, source: "test-writer" })),
  ];

  test("takes the standstills that ended with the owner's input off the run's time", () => {
    const time = workingTime(runEvents());

    assert.equal(time.start, utc("09:00:00"));
    assert.equal(time.end, utc("09:26:36"));
    assert.equal(time.span, 1_596_000);
    assert.equal(time.waits, 738_000); // 18 s before the typed question, 12 min before the answer
    assert.equal(time.working, 858_000);
    assert.deepEqual(time.inputs, [
      { at: utc("09:00:00"), wait: 0, label: "command /tdd-apply" },
      { at: utc("09:13:58"), wait: 18_000, label: "typed" },
      { at: utc("09:26:30"), wait: 720_000, label: "answer to a question dialog" },
    ]);
  });

  test("lists a standstill over 2 minutes that no input ended, as working time", () => {
    const time = workingTime(runEvents());

    assert.deepEqual(time.standstills, [{ at: utc("09:10:20"), gap: 600_000, before: "runner", after: "runner" }]);
    assert.equal(time.idle, 600_000);
  });

  test("measures inside a window only", () => {
    const time = workingTime(runEvents(), { from: utc("09:10:00"), to: utc("09:20:00") });

    assert.equal(time.start, utc("09:10:20"));
    assert.equal(time.end, utc("09:14:30"));
    assert.equal(time.waits, 18_000);
    assert.equal(time.working, 250_000 - 18_000);
    assert.deepEqual(time.standstills, []);
  });

  test("counts the whole run's standstill, not one transcript's", () => {
    const events = [
      { at: 0, kind: "work", source: "main" },
      { at: 500_000, kind: "work", source: "agent" },
      { at: 600_000, kind: "owner", label: "typed", source: "main" },
    ];

    assert.equal(workingTime(events).waits, 100_000);
    assert.deepEqual(workingTime(events).standstills, [{ at: 500_000, gap: 500_000, before: "main", after: "agent" }]);
  });

  test("answers null when the window holds no event", () => {
    assert.equal(workingTime(runEvents(), { from: utc("12:00:00") }), null);
    assert.equal(workingTime([]), null);
  });
});

describe("stepsOf", () => {
  // A runner's tool call that reports steps, as readTranscript keeps it.
  const call = (clock, ...steps) => ({ at: utc(clock), kind: "shell", steps });
  const commit = (tag, summary, done = null) => ({ kind: "commit", tag, summary, done });
  const progress = (step) => ({ kind: "progress", step });

  test("lists the run's steps in time order, each with who reported it and what it is", () => {
    const callers = [
      {
        who: "runner a77aa88b",
        tools: readTranscript(fixtureText(`${SECOND_SESSION}/subagents/agent-${SECOND_RUNNER}.jsonl`)).tools,
      },
      { who: "runner a11aa22b", tools: runnerTranscript().tools },
    ];

    assert.deepEqual(stepsOf(callers), [
      { at: utc("09:10:24"), who: "runner a11aa22b", text: "Baseline", kind: "other" },
      { at: utc("09:13:37"), who: "runner a11aa22b", text: "Acceptance tests", kind: "other" },
      { at: utc("10:12:00"), who: "runner a77aa88b", text: "Chapter A, slice 1", kind: "slice" },
      { at: utc("10:20:00"), who: "runner a77aa88b", text: "Chapter A, slice 2", kind: "slice" },
      { at: utc("10:31:00"), who: "runner a77aa88b", text: "Chapter A, slice 3", kind: "slice" },
      { at: utc("10:36:00"), who: "runner a77aa88b", text: "Finding A-1", kind: "finding" },
      { at: utc("10:42:00"), who: "runner a77aa88b", text: "Finding A-2", kind: "finding" },
      { at: utc("10:44:00"), who: "runner a77aa88b", text: "Close checks", kind: "other" },
    ]);
  });

  test("takes only the named steps of a run that names them: a commit without --done is none", () => {
    const tools = [
      call("10:00:00", commit("red", "Slice 1, red")),
      call("10:05:00", commit("close", "Slice 1", "Chapter B, slice 1")),
      call("10:06:00", commit("chapter", "Chapter B")),
      call("10:09:00", commit("close", "Group 4", "Chapter C, group 4")),
      call("10:10:00", progress("Close checks")),
    ];

    assert.deepEqual(
      stepsOf([{ who: "runner", tools }]).map((step) => [step.text, step.kind]),
      [
        ["Chapter B, slice 1", "slice"],
        ["Chapter C, group 4", "group"],
        ["Close checks", "other"],
      ],
    );
  });

  test("tells the steps of a transcript from before --done by the commits' tags", () => {
    const tools = [
      call("10:00:00", commit("accept", "Three acceptance tests")),
      call("10:01:00", commit("red", "Slice 1, red")),
      call("10:02:00", commit("green", "Slice 1, green")),
      call("10:03:00", commit("wire", "Slice 1, wired")),
      call("10:04:00", commit("close", "The order remembers its wrap")),
      call("10:05:00", commit("chapter-review", "A-1: fixed")),
      call("10:06:00", commit("review", "3: fixed")),
      call("10:07:00", commit("chapter", "Chapter A")),
      call("10:08:00", commit("plan", "Two tasks added")),
      call("10:09:00", commit("close", null)),
      call("10:10:00", commit(null, "No tag given")),
    ];

    assert.deepEqual(
      stepsOf([{ who: "runner", tools }]).map((step) => [step.text, step.kind]),
      [
        ["accept: Three acceptance tests", "other"],
        ["close: The order remembers its wrap", "slice"],
        ["chapter-review: A-1: fixed", "finding"],
        ["review: 3: fixed", "finding"],
        ["chapter: Chapter A", "other"],
        ["close", "slice"],
      ],
    );
  });

  test("gives no step for a call that failed, and every step of a call that reports two", () => {
    const tools = [
      { ...call("10:00:00", commit("close", "Slice 1", "Chapter A, slice 1")), failed: true },
      call("10:02:00", commit("close", "Slice 1", "Chapter A, slice 1"), progress("Close checks")),
      { at: utc("10:03:00"), kind: "read" },
    ];

    assert.deepEqual(
      stepsOf([{ who: "runner", tools }]).map((step) => [step.at, step.text]),
      [
        [utc("10:02:00"), "Chapter A, slice 1"],
        [utc("10:02:00"), "Close checks"],
      ],
    );
  });

  test("gives no step for a run without one", () => {
    assert.deepEqual(stepsOf([{ who: "runner", tools: writerTranscript().tools }]), []);
    assert.deepEqual(stepsOf([]), []);
  });
});

describe("stepTimes and stepStatistics", () => {
  const step = (clock, kind = "other") => ({ at: utc(clock), who: "runner", text: clock, kind });

  test("measures each step from the one before it, the first from the run's start", () => {
    const timed = stepTimes([step("10:10:00"), step("10:25:00"), step("10:27:30")], {
      start: utc("10:00:00"),
      inputs: [],
    });

    assert.deepEqual(
      timed.map((s) => s.working),
      [600_000, 900_000, 150_000],
    );
    assert.equal(timed[1].text, "10:25:00");
  });

  test("takes off each step the waits for input that fall before it and after the step before", () => {
    const inputs = [
      { at: utc("10:00:00"), wait: 0, label: "command /tdd-apply" },
      { at: utc("10:04:00"), wait: 120_000, label: "typed" },
      { at: utc("10:20:00"), wait: 300_000, label: "typed" },
      { at: utc("10:21:00"), wait: 30_000, label: "typed" },
      { at: utc("10:40:00"), wait: 600_000, label: "typed" },
    ];
    const timed = stepTimes([step("10:10:00"), step("10:25:00"), step("10:27:30")], { start: utc("10:00:00"), inputs });

    // 10 min less 2; 15 min less 5 and a half; the wait at 10:40 comes after the last step.
    assert.deepEqual(
      timed.map((s) => s.working),
      [480_000, 570_000, 150_000],
    );
  });

  test("counts the steps of a kind, with their average and median working time", () => {
    const timed = [
      { kind: "slice", working: 761_000 },
      { kind: "finding", working: 300_000 },
      { kind: "slice", working: 300_000 },
      { kind: "other", working: 5_000_000 },
      { kind: "slice", working: 480_000 },
      { kind: "finding", working: 360_000 },
    ];

    assert.deepEqual(stepStatistics(timed, "slice"), { count: 3, average: 1_541_000 / 3, median: 480_000 });
    assert.deepEqual(stepStatistics(timed, "finding"), { count: 2, average: 330_000, median: 330_000 });
    assert.deepEqual(stepStatistics(timed, "group"), { count: 0, average: 0, median: 0 });
  });
});

describe("noteNumbers", () => {
  test("counts the turn a progress note started and what it cost, and the note that started none", () => {
    const numbers = noteNumbers(mainTranscript());

    assert.equal(numbers.turns, 1);
    assert.equal(numbers.absorbed, 1);
    assert.equal(numbers.calls, 1);
    assert.equal(numbers.toolCalls, 0);
    // 4 + 2 × 300 + 0.1 × 21126 + 5 × 20
    assert.ok(Math.abs(numbers.weighted - 2816.6) < 1e-6);
  });

  test("counts only the notes inside the window", () => {
    assert.deepEqual(noteNumbers(mainTranscript(), { from: utc("09:12:00") }), {
      turns: 0,
      absorbed: 1,
      calls: 0,
      toolCalls: 0,
      weighted: 0,
    });
  });

  test("shows a main session that acted on a note: its tool call and every API call of that turn", () => {
    const line = (type, clock, content, extra = {}) =>
      JSON.stringify({ type, timestamp: `2026-03-02T${clock}Z`, message: { content, ...extra.message }, ...extra.top });
    const answer = (id, clock, block) =>
      line("assistant", clock, [block], {
        message: { id, model: "claude-sample-1", usage: { input_tokens: 1000, output_tokens: 100 } },
      });
    const text = [
      line("user", "10:00:00", '<agent-message from="a0b1">\nSlice 2 completed at 11:00\n</agent-message>'),
      answer("m1", "10:00:02", { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/work/shop/a.cs" } }),
      line("user", "10:00:03", [{ type: "tool_result", tool_use_id: "t1", content: "x" }]),
      answer("m2", "10:00:05", { type: "text", text: "Slice 2 completed at 11:00" }),
      line("user", "10:05:00", "go on"),
      answer("m3", "10:05:02", { type: "text", text: "Going on." }),
    ].join("\n");

    assert.deepEqual(noteNumbers(readTranscript(text, { main: true })), {
      turns: 1,
      absorbed: 0,
      calls: 2,
      toolCalls: 1,
      weighted: 3000,
    });
  });
});

describe("agentType", () => {
  test("names an agent by its type, the runner's old name as the runner", () => {
    assert.equal(agentType({ agentType: "runner" }), "runner");
    assert.equal(agentType({ agentType: "chapter-runner" }), "runner");
    assert.equal(agentType({ agentType: "test-writer" }), "test-writer");
    assert.equal(agentType({ agentType: "general-purpose" }), "general-purpose");
  });

  test("names a skill's own agent by its name and a workflow's agent by its phase", () => {
    assert.equal(agentType({ agentType: "general-purpose", name: "code-review" }), "code-review");
    assert.equal(
      agentType({ agentType: "workflow-subagent", inWorkflowRun: true, workflowPhase: "Verify" }),
      "workflow verify",
    );
    assert.equal(
      agentType({ agentType: "workflow-subagent", inWorkflowRun: true, description: "second-pass:4" }),
      "workflow second-pass",
    );
    assert.equal(
      agentType({ agentType: "review-verifier", inWorkflowRun: true, workflowPhase: "Verify" }),
      "review-verifier",
    );
  });

  test("names an agent without a meta file unknown", () => {
    assert.equal(agentType({}), "unknown");
    assert.equal(agentType(), "unknown");
  });
});

describe("weightedByType", () => {
  const members = () => [
    { type: "main session", calls: mainTranscript().calls },
    { type: "runner", calls: runnerTranscript().calls },
    { type: "test-writer", calls: writerTranscript().calls },
  ];
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

  test("adds each type's calls up by price class, the most expensive type first", () => {
    const { rows } = weightedByType(members());

    assert.deepEqual(
      rows.map((row) => [
        row.type,
        row.model,
        row.agents,
        row.calls,
        row.input,
        row.write5m,
        row.write1h,
        row.read,
        row.output,
      ]),
      [
        ["main session", "sample-1", 1, 8, 52, 23382, 23150, 127363, 925],
        ["test-writer", "sample-2", 1, 8, 16, 20850, 0, 232956, 1850],
        ["runner", "sample-1", 1, 8, 24, 12570, 0, 193784, 1490],
      ],
    );
    near(rows[0].weighted, 92940.8);
    near(rows[1].weighted, 58624.1);
    near(rows[2].weighted, 42564.9);
  });

  test("totals the run", () => {
    const { total } = weightedByType(members());

    assert.deepEqual(
      [total.agents, total.calls, total.input, total.write5m, total.write1h, total.read, total.output],
      [3, 24, 92, 56802, 23150, 554103, 4265],
    );
    near(total.weighted, 194129.8);
  });

  test("counts two agents of one type as one row, and one type on two models as two", () => {
    const call = (model) => ({ model, input: 100, write5m: 0, write1h: 0, read: 0, output: 0 });
    const { rows, total } = weightedByType([
      { type: "runner", calls: [call("claude-sample-1"), call("claude-sample-1")] },
      { type: "runner", calls: [call("claude-sample-1")] },
      { type: "review-verifier", calls: [call("claude-sample-1"), call("claude-sample-2")] },
      { type: "implementer", calls: [] },
    ]);

    assert.deepEqual(
      rows.map((row) => [row.type, row.model, row.agents, row.calls, row.weighted]),
      [
        ["runner", "sample-1", 2, 3, 300],
        ["review-verifier", "sample-1", 1, 1, 100],
        ["review-verifier", "sample-2", 1, 1, 100],
      ],
    );
    assert.equal(total.agents, 3);
    assert.equal(total.weighted, 500);
  });
});

describe("nested", () => {
  test("puts each agent under the one that started it, by the time of its first record", () => {
    const agents = [
      { id: "verifier", first: 50, meta: { parentAgentId: "reviewer" } },
      { id: "reviewer", first: 40, meta: {} },
      { id: "implementer", first: 30, meta: { parentAgentId: "runner" } },
      { id: "writer", first: 20, meta: { parentAgentId: "runner" } },
      { id: "runner", first: 10, meta: {} },
      { id: "stray", first: 5, meta: { parentAgentId: "not in this run" } },
    ];

    assert.deepEqual(
      nested(agents).map((agent) => [agent.id, agent.depth]),
      [
        ["stray", 1],
        ["runner", 1],
        ["writer", 2],
        ["implementer", 2],
        ["reviewer", 1],
        ["verifier", 2],
      ],
    );
  });
});

describe("loadRun", () => {
  test("finds the session's agents next to its transcript, with their meta files", () => {
    const run = loadRun(MAIN_PATH);

    assert.equal(run.id, SESSION);
    assert.deepEqual(
      run.agents.map((agent) => [agent.id, agent.meta.agentType, agent.meta.parentAgentId]),
      [
        [RUNNER, "runner", undefined],
        [WRITER, "test-writer", RUNNER],
      ],
    );
    assert.equal(run.transcript.turns.length, 4);
    assert.equal(run.agents[0].transcript.calls.length, 8);
  });

  test("finds a workflow's agents one folder deeper, reads only agents' transcripts, and takes a missing meta file", () => {
    const folder = mkdtempSync(join(tmpdir(), "measure-test-"));
    try {
      const deep = join(folder, "session-1", "subagents", "workflows", "wf_made-up");
      mkdirSync(deep, { recursive: true });
      const line = JSON.stringify({ type: "user", timestamp: "2026-03-02T10:00:00Z", message: { content: "go" } });
      writeFileSync(join(folder, "session-1.jsonl"), `${line}\n`);
      writeFileSync(join(deep, "agent-a0b1c2d3e4f5.jsonl"), `${line}\n`);
      writeFileSync(
        join(deep, "agent-a0b1c2d3e4f5.meta.json"),
        JSON.stringify({ agentType: "workflow-subagent", inWorkflowRun: true, workflowPhase: "Verify" }),
      );
      writeFileSync(join(deep, "journal.jsonl"), `${line}\n`);
      writeFileSync(join(folder, "session-1", "subagents", "agent-a9b8c7d6e5f4.jsonl"), `${line}\n`);

      const run = loadRun(join(folder, "session-1.jsonl"));

      assert.deepEqual(run.agents.map((agent) => [agent.id, agentType(agent.meta)]).sort(), [
        ["a0b1c2d3e4f5", "workflow verify"],
        ["a9b8c7d6e5f4", "unknown"],
      ]);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("reads a session that started no agent", () => {
    const folder = mkdtempSync(join(tmpdir(), "measure-test-"));
    try {
      writeFileSync(join(folder, "alone.jsonl"), "");

      assert.deepEqual(loadRun(join(folder, "alone.jsonl")).agents, []);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe("report", () => {
  const lines = (window) => report([loadRun(MAIN_PATH)], window);
  // The cells after the first of the line that starts so.
  const rowOf = (all, start) =>
    all
      .find((line) => line.startsWith(start))
      ?.trim()
      .split(/\s{2,}/)
      .slice(1);

  test("opens with the run's time and who took part", () => {
    assert.equal(lines()[0], "RUN  2026-03-02 09:00:00 → 2026-03-02 09:26:36 UTC · 1 main session, 2 agents");
  });

  test("prints the main session first, then each agent under the one that started it, with its context", () => {
    const all = lines();
    const from = all.findIndex((line) => line.startsWith("AGENTS: CONTEXT"));

    assert.deepEqual(all.slice(from + 1, from + 5), [
      "who                       start   min  calls  first  last  peak  output  taken in  description",
      "main 0a1b2c3d             09:00  26.6      8    20k   23k   23k      1k        2k",
      "  runner a11aa22b         09:00  14.1      8    24k   28k   28k      1k        3k  Gift wrap: the acceptance chapter",
      "    test-writer a55ee66f  09:10   2.9      8    25k   36k   36k      2k       10k  Gift wrap: three acceptance tests",
    ]);
  });

  test("cuts a long description to the room the numbers leave", () => {
    const run = loadRun(MAIN_PATH);
    run.agents[0].meta.description = "A description of this runner that goes on and on, well past the end of any line";
    const row = report([run]).find((line) => line.startsWith("  runner a11aa22b "));

    assert.equal(row.length, 118);
    assert.ok(row.endsWith("  3k  A description of this runner that …"), row);
  });

  test("prints each agent's tool calls by kind", () => {
    const all = lines();
    const from = all.findIndex((line) => line.startsWith("AGENTS: TOOL CALLS"));

    assert.deepEqual(all.slice(from + 1, from + 5), [
      "who                       graph index Read search edit | shell edits reads tdd-run bare | Agent Send other",
      "main 0a1b2c3d                 0     0    0      0    0 |     2     0     0       0    0 |     1    0     1",
      "  runner a11aa22b             0     0    0      0    0 |     4     0     0       2    1 |     1    2     2",
      "    test-writer a55ee66f      1     0    1      1    2 |     4     2     2       0    1 |     0    0     0",
    ]);
  });

  test("says what the shell counts hold", () => {
    const all = lines().join("\n");

    assert.match(all, /edits {4}calls that change a file of the repository without Edit or Write/);
    assert.match(all, /reads {4}commands whose plain purpose is to read a file of the repository/);
    assert.match(all, /Not counted: `\| tail` on a command's output/);
  });

  test("prints the working time, the inputs with their waits and the other standstills", () => {
    const all = lines();

    assert.deepEqual(rowOf(all, "  from first to last record"), ["26.6 min"]);
    assert.deepEqual(rowOf(all, "  waits for input from outside"), ["12.3 min"]);
    assert.deepEqual(rowOf(all, "  working"), ["14.3 min"]);
    assert.ok(all.includes("    2026-03-02 09:00:00   0.0 min  command /tdd-apply"));
    assert.ok(all.includes("    2026-03-02 09:13:58   0.3 min  typed"));
    assert.ok(all.includes("    2026-03-02 09:26:30  12.0 min  answer to a question dialog"));
    assert.ok(all.includes("    2026-03-02 09:10:20  10.0 min  inside runner a11aa22b"));
  });

  test("prints the steps the runner reported, with the working minutes of each", () => {
    const all = lines();
    const from = all.findIndex((line) => line.startsWith("STEPS"));

    assert.deepEqual(all.slice(from, from + 5), [
      "STEPS (UTC; the last column is the working minutes since the step before, for the first step since the start)",
      "  2026-03-02 09:10:24  Baseline          runner a11aa22b  10.4",
      "  2026-03-02 09:13:37  Acceptance tests  runner a11aa22b   3.2",
      "  slices: 0",
      '  A step is a runner\'s `tdd.mjs commit … --done "<step>"` or `tdd.mjs progress --step "<step>"`. In a',
    ]);
    assert.match(
      all.join("\n"),
      /A call that was refused \(the transcript records a non-zero exit\) is not\n {2}counted\./,
    );
  });

  test("prints a run that went on in a second session as one: its steps, and the slices' and findings' times", () => {
    const all = report([loadRun(MAIN_PATH), loadRun(SECOND_MAIN_PATH)]);
    const from = all.findIndex((line) => line.startsWith("STEPS"));

    assert.equal(all[0], "RUN  2026-03-02 09:00:00 → 2026-03-02 10:44:40 UTC · 2 main sessions, 3 agents");
    // The first slice: 58 min 23 s since the step before it, less the waits of 18 s, 12 min and 33 min 24 s. The
    // third: 11 min less the 6 min the run stood still until the owner typed. The refused commit of 10:40 is not
    // there.
    assert.deepEqual(all.slice(from + 1, from + 11), [
      "  2026-03-02 09:10:24  Baseline            runner a11aa22b  10.4",
      "  2026-03-02 09:13:37  Acceptance tests    runner a11aa22b   3.2",
      "  2026-03-02 10:12:00  Chapter A, slice 1  runner a77aa88b  12.7",
      "  2026-03-02 10:20:00  Chapter A, slice 2  runner a77aa88b   8.0",
      "  2026-03-02 10:31:00  Chapter A, slice 3  runner a77aa88b   5.0",
      "  2026-03-02 10:36:00  Finding A-1         runner a77aa88b   5.0",
      "  2026-03-02 10:42:00  Finding A-2         runner a77aa88b   6.0",
      "  2026-03-02 10:44:00  Close checks        runner a77aa88b   2.0",
      "  slices: 3, average 8.6 min, median 8.0 min",
      "  findings: 2, average 5.5 min, median 5.5 min",
    ]);
    assert.deepEqual(rowOf(all, "  from first to last record"), ["104.7 min"]);
    assert.deepEqual(rowOf(all, "  waits for input from outside"), ["51.7 min"]);
    assert.deepEqual(rowOf(all, "  working"), ["53.0 min"]);
    assert.ok(all.includes("    2026-03-02 10:00:00  33.4 min  command /tdd-apply"));
    assert.ok(all.includes("  received 8: 7 started a turn of the main session, 1 arrived while it was working"));
    // Each session's agents stand under their own main session.
    const context = all.findIndex((line) => line.startsWith("AGENTS: CONTEXT"));
    assert.deepEqual(
      all.slice(context + 2, context + 7).map((line) => line.slice(0, 24).trimEnd()),
      ["main 0a1b2c3d", "  runner a11aa22b", "    test-writer a55ee66f", "main 1b2c3d4e", "  runner a77aa88b"],
    );
  });

  test("prints the steps of a transcript from before --done by their commits' tags, a runner's only", () => {
    const line = (type, clock, content, message = {}) =>
      JSON.stringify({ type, timestamp: `2026-03-02T${clock}Z`, cwd: "/work/shop", message: { content, ...message } });
    const shell = (id, clock, command) =>
      line("assistant", clock, [{ type: "tool_use", id, name: "Bash", input: { command } }], {
        id: `msg_${id}`,
        model: "claude-sample-1",
        usage: { input_tokens: 1000, output_tokens: 100 },
      });
    const commit = (tag, summary) => `${TDD} commit --change c000 --type feat --tag ${tag} --summary "${summary}"`;
    const main = [
      line("user", "08:00:00", "start"),
      shell("m1", "08:00:02", commit("chapter", "The main session's own")),
    ];
    const runner = [
      line("user", "08:00:10", "CHAPTER: A"),
      shell("r1", "08:02:00", commit("red", "Slice 1, red")),
      shell("r2", "08:06:10", commit("close", "The cart keeps its coupon")),
      shell("r3", "08:14:10", commit("close", "The total takes the coupon off")),
      shell("r4", "08:15:10", commit("chapter", "Chapter A")),
    ];
    const old = {
      id: "0f0e0d0c-made-up",
      transcript: readTranscript(main.join("\n"), { main: true }),
      agents: [
        { id: "a0f0e0d0c0b0a", meta: { agentType: "chapter-runner" }, transcript: readTranscript(runner.join("\n")) },
      ],
    };
    const all = report([old]);
    const from = all.findIndex((line) => line.startsWith("STEPS"));

    assert.deepEqual(all.slice(from + 1, from + 5), [
      "  2026-03-02 08:06:10  close: The cart keeps its coupon       runner a0f0e0d0  6.2",
      "  2026-03-02 08:14:10  close: The total takes the coupon off  runner a0f0e0d0  8.0",
      "  2026-03-02 08:15:10  chapter: Chapter A                     runner a0f0e0d0  1.0",
      "  slices: 2, average 7.1 min, median 7.1 min",
    ]);
  });

  test("says so when the window holds no step", () => {
    const all = lines({ to: utc("09:05:00") });
    const from = all.findIndex((line) => line.startsWith("STEPS"));

    assert.deepEqual(all.slice(from + 1, from + 3), ["  none", "  slices: 0"]);
  });

  test("prints the weighted tokens by agent type, and their total", () => {
    const all = lines();
    const from = all.findIndex((line) => line.startsWith("WEIGHTED TOKENS"));

    assert.deepEqual(all.slice(from + 1, from + 6), [
      "type          model     agents  calls  input  write 5m  write 1h  cache read  output  weighted",
      "main session  sample-1       1      8     0k       23k       23k        127k      1k     0.09M",
      "test-writer   sample-2       1      8     0k       21k        0k        233k      2k     0.06M",
      "runner        sample-1       1      8     0k       13k        0k        194k      1k     0.04M",
      "TOTAL                        3     24     0k       57k       23k        554k      4k     0.19M",
    ]);
  });

  test("prints what the progress notes cost the main session", () => {
    const all = lines();
    const from = all.findIndex((line) => line.startsWith("PROGRESS NOTES"));

    assert.deepEqual(all.slice(from + 1), [
      "  received 2: 1 started a turn of the main session, 1 arrived while it was working",
      "  the turns they started cost 3k weighted tokens (3k a turn) in 1 API call, with 0 tool calls (the rule: none)",
    ]);
  });

  test("prints nothing of what was said: no prompt, no command, no report", () => {
    const all = lines().join("\n");

    for (const said of ["how far is it", "ACCEPTANCE", "sort-usings", "Approve", "c001", "ShopDriver"]) {
      assert.equal(all.includes(said), false, said);
    }
  });

  test("keeps every line inside a terminal's width", () => {
    assert.deepEqual(
      lines().filter((line) => line.length > 118),
      [],
    );
  });

  test("measures a window cut out of the session", () => {
    const all = lines({ from: utc("09:10:00"), to: utc("09:14:10") });

    assert.equal(all[0], "RUN  2026-03-02 09:10:20 → 2026-03-02 09:14:06 UTC · 1 main session, 2 agents");
    // The main session's three calls of the window: the note's turn and the answer to the owner's question.
    assert.deepEqual(rowOf(all, "main 0a1b2c3d").slice(0, 7), ["09:10", "3.6", "3", "21k", "22k", "22k", "0k"]);
    assert.deepEqual(rowOf(all, "  waits for input from outside"), ["0.3 min"]);
    assert.ok(all.includes("  received 2: 1 started a turn of the main session, 1 arrived while it was working"));
  });

  test("leaves out an agent with no record in the window", () => {
    const all = lines({ to: utc("09:05:00") });

    assert.equal(all[0], "RUN  2026-03-02 09:00:00 → 2026-03-02 09:00:20 UTC · 1 main session, 1 agent");
    assert.equal(
      all.some((line) => line.includes("test-writer a55ee66f")),
      false,
    );
  });

  test("says so when the window holds no record", () => {
    assert.deepEqual(lines({ from: utc("12:00:00") }), ["No record in the window."]);
  });
});

describe("parseArguments", () => {
  test("takes the transcripts and the window", () => {
    assert.deepEqual(
      parseArguments(["a.jsonl", "--from", "2026-03-02T09:00:00Z", "b.jsonl", "--to", "2026-03-02T10:00:00Z"]),
      {
        paths: ["a.jsonl", "b.jsonl"],
        window: { from: utc("09:00:00"), to: utc("10:00:00") },
      },
    );
    assert.deepEqual(parseArguments(["a.jsonl"]), { paths: ["a.jsonl"], window: {} });
  });

  test("refuses a time it cannot read, an option it does not know and no transcript", () => {
    assert.throws(() => parseArguments(["a.jsonl", "--from", "yesterday"]), /--from needs an ISO time/);
    assert.throws(() => parseArguments(["a.jsonl", "--to"]), /--to needs an ISO time/);
    assert.throws(() => parseArguments(["a.jsonl", "--since", "x"]), /unknown option --since/);
    assert.throws(() => parseArguments(["--from", "2026-03-02T09:00:00Z"]), /name the main session's transcript/);
  });
});

describe("the command line", () => {
  const script = fileURLToPath(new URL("./measure.mjs", import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

  test("prints the report of a run", () => {
    const { status, stdout, stderr } = run(MAIN_PATH, "--from", "2026-03-02T09:00:00Z");

    assert.equal(status, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /^RUN {2}2026-03-02 09:00:00 → 2026-03-02 09:26:36 UTC · 1 main session, 2 agents\n/);
    assert.match(stdout, /\n {2}received 2: 1 started a turn of the main session, 1 arrived while it was working\n/);
  });

  test("refuses a transcript that is not there in one line", () => {
    const { status, stdout, stderr } = run(fixturePath("no-such-session.jsonl"));

    assert.equal(status, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^ERROR: no such file: .*no-such-session\.jsonl\n$/);
  });

  test("prints how it is called when called with nothing", () => {
    const { status, stdout } = run();

    assert.equal(status, 1);
    assert.match(stdout, /measure\.mjs <main session's transcript \.jsonl>/);
  });
});
