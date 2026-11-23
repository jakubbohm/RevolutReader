// Tells a session that was just compacted where its /tdd-apply stands (GitHub issue 67, cut context growth in
// /tdd-apply). Compaction drops what the orchestrator knew; the change's state file holds it. Registered in
// .claude/settings.json for SessionStart with the matcher `compact`.
//
// For every change under openspec/changes/ (never the archive) whose state file says `Status: applying`, it adds
// to the session's context: that /tdd-apply is under way for the change and that this session is its main
// session, the command that reads the state file by section, and the file's `Resume here`, `Agents` and `Open`
// sections. The whole text is cut at 4,000 characters, with a note that names the command for the rest.
//
// Never blocks a session: with no such change it prints nothing, and any error becomes one line on stderr, nothing
// on stdout and exit 0. The sections are read with the tdd-apply scripts' own functions (state.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LIMIT = 4000;
const SHOWN = ["Resume here", "Agents", "Open"];
const GET = (change) => `node .claude/skills/tdd-apply/scripts/tdd.mjs get --change ${change} --section`;

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

// What the session is told about one change that is being applied; null for a change that is not.
function account(state, change, text) {
  if (state.keyValue(text, "Run", "Status")?.trim().toLowerCase() !== "applying") return null;
  const intro =
    `/tdd-apply is under way for \`${change}\`: its state file says \`Status: applying\`. This session is its main ` +
    `session, the orchestrator. Read the state file by section, never whole: \`${GET(change)} "<name>"\` ` +
    `(its sections: ${state.sectionNames(text).join(", ")}). Its ${SHOWN.join(", ")} sections as they stand:`;
  const sections = SHOWN.map(
    (name) => `## ${name}\n${state.sectionBody(text, name) ?? "(the state file has no such section)"}`,
  );
  return [intro, ...sections].join("\n\n");
}

async function sessionStart(input) {
  const root =
    typeof input.cwd === "string" && existsSync(input.cwd) ? git(input.cwd, ["rev-parse", "--show-toplevel"]) : null;
  const changes = root && join(root, "openspec", "changes");
  if (!changes || !existsSync(changes)) return;
  const state = await import("../skills/tdd-apply/scripts/state.mjs");
  const accounts = [];
  const applying = [];
  for (const entry of readdirSync(changes, { withFileTypes: true })) {
    const file = join(changes, entry.name, state.STATE_FILE);
    if (!entry.isDirectory() || entry.name === "archive" || !existsSync(file)) continue;
    const told = account(state, entry.name, readFileSync(file, "utf8"));
    if (told === null) continue;
    accounts.push(told);
    applying.push(entry.name);
  }
  if (accounts.length === 0) return;

  let text = accounts.join("\n\n");
  if (text.length > LIMIT) {
    const rest = applying.map((change) => `\`${GET(change)} ${SHOWN.map((name) => `"${name}"`).join(" --section ")}\``);
    const note = `\n… cut at 4,000 characters; read the rest with ${rest.join(" and ")}`;
    text = text.slice(0, Math.max(0, LIMIT - note.length)) + note;
  }
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }),
  );
}

try {
  const input = JSON.parse(readFileSync(0, "utf8"));
  if (input === null || typeof input !== "object") throw new Error("its input is not a JSON object");
  if (input.hook_event_name === "SessionStart") await sessionStart(input);
} catch (e) {
  process.stderr.write(`tdd-resume hook: ${String(e?.message ?? e).replace(/\s+/g, " ")}\n`);
}
process.exitCode = 0;
