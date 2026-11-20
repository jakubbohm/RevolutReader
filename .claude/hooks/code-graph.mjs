// Keeps the code graph (codebase-memory-mcp) current where the server's own refresh does not reach
// (CLAUDE.md § Code navigation; docs/software-factory/lessons.md R-71). The server indexes the folder a session
// starts in only when it has no project yet, and watches only that folder. Registered in .claude/settings.json for:
//
// - SessionStart (startup, resume): starts a background refresh of the session's folder, so commits made while no
//   session was open there (a pull) are in the graph; the same run deletes this repository's projects whose folder
//   no longer exists (a removed worktree). A folder with no project yet is left to the server's auto_index. The hook
//   itself returns at once; it reports only when the previous refresh of this folder failed.
// - PostToolUse on EnterWorktree: indexes the worktree the session just entered, which the server neither indexes
//   nor watches, and tells the session the project's name.
//
// Never blocks anything: a failure becomes a line of context, and the session reads files instead. Each background
// run writes one log per folder in the temp directory (path below), so the next session start can report a failure.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = "codebase-memory-mcp";
const LOG_DIR = join(tmpdir(), "codebase-memory-hooks");

const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const logPath = (folder) => join(LOG_DIR, `${norm(folder).replace(/[^a-z0-9]+/g, "-")}.log`);

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

// One tool of the graph's command line; its answer is the tool's JSON text on stdout.
function cli(tool, args, timeoutMs) {
  const r = spawnSync(CLI, ["cli", "--quiet", tool, ...args], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  if (r.error) throw new Error(`${CLI} ${tool}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${CLI} ${tool} exited ${r.status}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return JSON.parse(r.stdout);
}

function say(event, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));
}

// The background part, started detached by SessionStart: refresh, then delete projects of removed folders.
function refresh(folder) {
  const lines = [];
  let failed = null;
  try {
    const { projects = [] } = cli("list_projects", ["--format", "json", "--limit", "500"], 60_000);
    if (projects.some((p) => p.root_path && norm(p.root_path) === norm(folder))) {
      const { project } = cli("index_repository", ["--repo-path", folder], 600_000);
      lines.push(`refreshed ${project}`);
    } else {
      lines.push("no project yet: left to the server's auto_index");
    }
    const common = git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const repo = common && norm(dirname(common));
    for (const p of repo ? projects : []) {
      const root = p.root_path && norm(p.root_path);
      if (root && (root === repo || root.startsWith(`${repo}/`)) && !existsSync(p.root_path)) {
        cli("delete_project", ["--project", p.name], 60_000);
        lines.push(`deleted ${p.name} (its folder is gone)`);
      }
    }
  } catch (e) {
    failed = e.message.replace(/\s+/g, " ");
  }
  mkdirSync(LOG_DIR, { recursive: true });
  const head = `${new Date().toISOString()} ${failed ? `failed: ${failed}` : "ok"}`;
  writeFileSync(logPath(folder), [head, folder, ...lines].join("\n") + "\n");
}

function sessionStart(input) {
  const folder = input.cwd && git(input.cwd, ["rev-parse", "--show-toplevel"]);
  if (!folder) return;
  const log = logPath(folder);
  const last = existsSync(log) ? readFileSync(log, "utf8").split("\n")[0] : "";
  spawn(process.execPath, [fileURLToPath(import.meta.url), "--refresh", folder], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
  if (/^\S+ failed:/.test(last)) {
    say(
      "SessionStart",
      `Code graph: the last background refresh of this folder failed (${last}). Its project may be behind the ` +
        `files; read the file wherever it matters. A new refresh is running now; its log: ${log}`,
    );
  }
}

function enterWorktree(input) {
  // The docs guarantee `cwd` as the worktree's root after EnterWorktree; `worktreePath` is the tool's own answer.
  const start = input.cwd ?? input.tool_response?.worktreePath;
  const folder = start && git(start, ["rev-parse", "--show-toplevel"]);
  if (!folder) return;
  try {
    const { project } = cli("index_repository", ["--repo-path", folder], 120_000);
    say(
      "PostToolUse",
      `Code graph: this session now works in ${folder}, indexed just now as the project \`${project}\`. Pass ` +
        `that name as \`project\` to the codebase-memory-mcp tools. The server does not watch this folder: after ` +
        `changing code here, run \`index_repository\` with this path before searching it again (CLAUDE.md § Code navigation).`,
    );
  } catch (e) {
    say(
      "PostToolUse",
      `Code graph: indexing ${folder} failed (${e.message}). Read files directly, or run \`index_repository\` ` +
        `with this path and use the project it answers.`,
    );
  }
}

if (process.argv[2] === "--refresh") {
  refresh(process.argv[3]);
} else {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    if (input.hook_event_name === "SessionStart") sessionStart(input);
    else if (input.hook_event_name === "PostToolUse" && input.tool_name === "EnterWorktree") enterWorktree(input);
  } catch (e) {
    process.stderr.write(`code-graph hook: ${e.message}\n`);
  }
}
process.exitCode = 0;
