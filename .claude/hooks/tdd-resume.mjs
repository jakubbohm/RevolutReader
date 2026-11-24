// Tells a session that was just compacted where its /tdd-apply or its /triage-review stands (GitHub issue 67, cut
// context growth in /tdd-apply). Compaction drops what the main session knew; the state file holds it. Registered
// in .claude/settings.json for SessionStart with the matcher `compact`.
//
// - An apply: for every change under openspec/changes/ (never the archive) whose state file says
//   `Status: applying`, it adds to the session's context that /tdd-apply is under way for the change and that this
//   session is its main session, the command that reads the state file by section, and the file's `Resume here`,
//   `Agents` and `Open` sections.
// - A triage: when the working tree's pointer (`triage.json` in git's folder, written by `tdd.mjs triage-init`)
//   names a state file that is there and says `Status: triaging`, it adds the same for /triage-review, with the
//   PR, the round and the work folder, which no state file holds: it is a path of this machine, and the pointer
//   alone has it. The pointer covers what the folders cannot: a PR without an OpenSpec change, whose state file
//   lies in git's folder too, and a round after the change was archived.
// - Everything it prints is cut at 4,000 characters, with a note that names the commands for the rest.
//
// Never blocks a session: with nothing under way it prints nothing, and any error becomes one line on stderr,
// nothing on stdout and exit 0. The files are read with the tdd-apply scripts' own functions (state.mjs for the
// sections, triage.mjs for the pointer, lock.mjs for a read that a write does not disturb), and without the lock:
// every write is atomic, so a reader sees the old file or the new one.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const LIMIT = 4000;
const SHOWN = ["Resume here", "Agents", "Open"];
// The command that reads a state file by section; `whose` is `--change <name>` or `--pr <id>`.
const GET = (whose) => `node .claude/skills/tdd-apply/scripts/tdd.mjs get ${whose} --section`;

function git(cwd, args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

// What the session is told about one state file: `under` says what is under way, `status` what the file says, and
// `whose` names it to the command. Then the file's three sections as they stand.
function account(scripts, text, { under, status, whose }) {
  const intro =
    `${under}: its state file says \`Status: ${status}\`. This session is its main session, the orchestrator. ` +
    `Read the state file by section, never whole: \`${GET(whose)} "<name>"\` ` +
    `(its sections: ${scripts.sectionNames(text).join(", ")}). Its ${SHOWN.join(", ")} sections as they stand:`;
  const sections = SHOWN.map(
    (name) => `## ${name}\n${scripts.sectionBody(text, name) ?? "(the state file has no such section)"}`,
  );
  return [intro, ...sections].join("\n\n");
}

const statusOf = (scripts, text) => scripts.keyValue(text, "Run", "Status")?.trim().toLowerCase();

// The changes that are being applied: for each, its account and how the command names it.
function applies(scripts, root) {
  const changes = join(root, "openspec", "changes");
  if (!existsSync(changes)) return [];
  const found = [];
  for (const entry of readdirSync(changes, { withFileTypes: true })) {
    const file = join(changes, entry.name, scripts.STATE_FILE);
    if (!entry.isDirectory() || entry.name === "archive" || !existsSync(file)) continue;
    const text = scripts.readText(file);
    if (statusOf(scripts, text) !== "applying") continue;
    const whose = `--change ${entry.name}`;
    const under = `/tdd-apply is under way for \`${entry.name}\``;
    found.push({ whose, account: account(scripts, text, { under, status: "applying", whose }) });
  }
  return found;
}

// The triage under way in this working tree, when the pointer names one whose state file says so.
function triages(scripts, cwd) {
  const folder = git(cwd, ["rev-parse", "--git-path", "tdd"]);
  const pointerFile = folder && join(resolve(cwd, folder), scripts.POINTER_FILE);
  if (!pointerFile || !existsSync(pointerFile)) return [];
  const pointer = scripts.readPointer(scripts.readText(pointerFile));
  if (!existsSync(pointer.state)) return [];
  const text = scripts.readText(pointer.state);
  if (statusOf(scripts, text) !== "triaging") return [];
  const whose = `--pr ${pointer.pr}`;
  const of = pointer.change === null ? "" : ` of \`${pointer.change}\``;
  // The work folder with forward slashes on every system, as `triage-init` prints it.
  const work = pointer.work.split(sep).join("/");
  const under =
    `/triage-review is under way for PR ${pointer.pr}${of}, round ${pointer.round}, ` +
    `with the work folder \`${work}\``;
  return [{ whose, account: account(scripts, text, { under, status: "triaging", whose }) }];
}

async function sessionStart(input) {
  const cwd = typeof input.cwd === "string" && existsSync(input.cwd) ? input.cwd : null;
  const root = cwd && git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return;
  const scripts = {
    ...(await import("../skills/tdd-apply/scripts/state.mjs")),
    ...(await import("../skills/tdd-apply/scripts/triage.mjs")),
    ...(await import("../skills/tdd-apply/scripts/lock.mjs")),
  };
  const underWay = [...applies(scripts, root), ...triages(scripts, cwd)];
  if (underWay.length === 0) return;

  let text = underWay.map((one) => one.account).join("\n\n");
  if (text.length > LIMIT) {
    const rest = underWay.map((one) => `\`${GET(one.whose)} ${SHOWN.map((name) => `"${name}"`).join(" --section ")}\``);
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
