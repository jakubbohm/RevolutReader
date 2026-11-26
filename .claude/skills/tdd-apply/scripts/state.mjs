// The state files of /tdd-apply and /triage-review as texts of sections: the apply's state file, its chapter
// reviews file and a triage's state file. Reading a section's body, replacing it, appending a bullet, and keyed
// bullets (`- **<key>:** <value>`): putting one, reading its value, dropping it. Shared by tdd.mjs, which reads
// and writes the files, and by the hook .claude/hooks/tdd-resume.mjs, which only reads. Texts in, texts out:
// nothing here touches a file.
//
// - A section is a `## <name>` line and the lines up to the next one; a `## ` line inside a code fence is not a
//   heading. A section's body is its lines without the blank lines around them, and an empty body is the single
//   line `—`.
// - A name finds its section whatever its case and the spaces around it: the state file's names are fixed, and in
//   the reviews file `chapter a` must not open a second section next to `Chapter A`.
// - An edit changes only the section's own lines and keeps the file's line endings (those of its first line break)
//   and whether it ends with one.
// - A state file has a second file that is never committed, the local file, for the values that are true on this
//   machine only (the code graph's project, the folders of the fetched design files): a file of the same form,
//   whose sections are named as the state file's. A reader gets one section from both (`overlaidBody`).

export const STATE_FILE = ".tdd-state.md";
export const REVIEWS_FILE = ".chapter-reviews.md";
export const TRIAGE_FILE = ".review-triage.md";

// The section of both state files that lists the tests allowed to fail: each a keyed bullet, the key the test's
// whole name as the test runner prints it, the value why and since when. What comes before the name up to a `.`
// (a .NET namespace and class) or a ` > ` (a Vitest file, and groups), and a .NET test's arguments after it, may
// be left out; never any other part of a name (test-output.mjs, `coversName`).
export const ALLOWED_FAILURES = "Allowed failures";

// The apply's state file's sections, in the file's order.
export const STATE_SECTIONS = [
  "Resume here",
  "Run",
  "Chapter plan",
  "Agents",
  "Standing rules",
  "What the code holds now",
  "Baseline",
  "Acceptance tests",
  "Open",
  ALLOWED_FAILURES,
  "Design files",
];

// A triage's state file's fixed sections, in the file's order; one section per round follows them.
export const TRIAGE_SECTIONS = ["Resume here", "Run", "Agents", "Open", ALLOWED_FAILURES];

// The name of a round's section in a triage's state file. Its findings are keyed bullets, the key the finding's
// number.
export const roundSection = (round) => `Round ${round}`;

// The body of an empty section.
export const EMPTY = "—";

// A new file of sections: its title, then every section named, empty but `Run`, which holds `run`'s
// `[key, value]` pairs as keyed bullets in the order given.
function newText(title, names, run, eol) {
  const lines = [title];
  for (const name of names) {
    const body = name === "Run" ? run.flatMap(([key, value]) => keyedItem(key, value)) : [EMPTY];
    lines.push("", `## ${name}`, "", ...body);
  }
  return lines.join(eol) + eol;
}

// A new state file of an apply: its title, then every section, empty but `Run`.
export function newStateText(change, run, eol) {
  return newText(`# .tdd-state: ${change}`, STATE_SECTIONS, run, eol);
}

// A new chapter reviews file: its title; a chapter's section is appended when it is first written.
export function newReviewsText(change, eol) {
  return `# Chapter reviews: ${change}${eol}`;
}

// A new local file: its title (`of` says whose state file it goes with: the change's name, or `triage-<id>`); a
// section is appended when it is first written.
export function newLocalText(of, eol) {
  return `# This machine's values: ${of}${eol}`;
}

// The name of a local file in the working tree's git folder: `<change>.local.md` or `triage-<id>.local.md`.
export const localFileName = (of) => `${of}.local.md`;

// The key of the local file's `Run` that holds the id of the run's main session: the session that started or
// resumed the run last, as Claude Code's ${CLAUDE_SESSION_ID} gave it to the skill. The compaction hook
// (.claude/hooks/tdd-resume.mjs) compares it with the id of the session it runs in. A session id is true on one
// machine only, so it is the local file's.
export const MAIN_SESSION = "Main session";

// A session id as Claude Code gives it, a UUID, or null for any other value: an empty one, the placeholder that
// Claude Code left unsubstituted, a value of another shape. Such a value records no id.
export function sessionId(value) {
  const id = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : null;
}

// A triage's state file at the start of a round. With no text before (`before` is null): a new file of the title
// (`of` says whose triage: the change's name, or the PR), the fixed sections, `Run` holding `run`'s pairs, and
// the round's section. With the text of an earlier round or an earlier start of this one: that text with `run`'s
// pairs put into `Run` (a key it has is replaced where it stands; whatever else `Run` holds stays), a fixed
// section it lacks appended, and the round's section appended when it is not there. Nothing else changes: an
// earlier round's section keeps every byte.
export function triageText(before, of, run, round, eol) {
  const rounds = roundSection(round);
  if (before === null) return newText(`# Review triage: ${of}`, [...TRIAGE_SECTIONS, rounds], run, eol);
  let text = before;
  for (const [key, value] of run) text = putKey(text, "Run", key, value, { create: true });
  for (const name of [...TRIAGE_SECTIONS, rounds]) {
    if (sectionBody(text, name) === null) text = setSection(text, name, "", { create: true });
  }
  return text;
}

// The names of the text's sections, in order.
export function sectionNames(text) {
  const { lines } = open(text);
  return sectionsOf(lines).map((s) => s.name);
}

// A section's name as the text has it, or null when the text has no such section.
export function sectionName(text, name) {
  const { lines } = open(text);
  return find(sectionsOf(lines), name)?.name ?? null;
}

// A section's body with LF line breaks, or null when the text has no such section.
export function sectionBody(text, name) {
  const { lines } = open(text);
  const section = find(sectionsOf(lines), name);
  return section ? bodyOf(lines, section).join("\n") : null;
}

// The text with the section's body replaced by `body` (any line breaks; an empty one becomes the placeholder).
// A section the text does not have is an error, or with `create` is appended at the end.
export function setSection(text, name, body, { create = false } = {}) {
  return edit(text, name, create, () => toLines(body));
}

// The text with the bullet `- <line>` appended to the section, in place of the placeholder when the section is
// empty. A line of several lines stays one list item: its later lines are indented.
export function addBullet(text, name, line, { create = false } = {}) {
  if (!line.trim()) throw new Error("the bullet has no text");
  return edit(text, name, create, (body) => [...filled(body), ...item(line)]);
}

// The text with the keyed bullet `- **<key>:** <value>` put into the section: in place of the bullet that has the
// key, else appended. A value of several lines stays one list item: its later lines are indented by two spaces.
export function putKey(text, name, key, value, { create = false } = {}) {
  if (!key.trim() || /[\r\n]/.test(key)) throw new Error("a key is one line of text");
  return edit(text, name, create, (body) => {
    const lines = filled(body);
    const at = keyedAt(lines, key.trim());
    if (at) lines.splice(at.from, at.to - at.from, ...keyedItem(key, value));
    else lines.push(...keyedItem(key, value));
    return lines;
  });
}

// The text with the section's keyed bullet of this key removed, its later lines included; a section that held
// nothing else is left empty. A key the section does not have is an error that names the keys it has: a key
// mistyped must not look dropped.
export function dropKey(text, name, key) {
  if (!key.trim() || /[\r\n]/.test(key)) throw new Error("a key is one line of text");
  return edit(text, name, false, (body) => {
    const lines = filled(body);
    const at = keyedAt(lines, key.trim());
    if (!at) {
      const keys = keysAmong(lines).map((k) => `"${k}"`);
      const has = keys.length > 0 ? `its keys are: ${keys.join(", ")}` : "it has no keyed bullet";
      throw new Error(`no key "${key.trim()}" in ${name.trim()}; ${has}`);
    }
    lines.splice(at.from, at.to - at.from);
    return lines;
  });
}

// The keys of the section's keyed bullets, in order; none when the section is not there.
export function sectionKeys(text, name) {
  const body = sectionBody(text, name);
  return body === null ? [] : keysAmong(body.split("\n"));
}

// The value of the section's keyed bullet, its later lines without their indent; null when the section or the key
// is not there.
export function keyValue(text, name, key) {
  const body = sectionBody(text, name);
  if (body === null) return null;
  const lines = body.split("\n");
  const at = keyedAt(lines, key.trim());
  if (!at) return null;
  const first = lines[at.from].slice(keyPrefix(key.trim()).length).trim();
  const rest = lines.slice(at.from + 1, at.to).map((l) => l.replace(/^ {1,2}/, ""));
  return [first, ...rest].join("\n");
}

// One section as a reader gets it from the state file and its local file: the state file's body (`body`) with the
// local file's (`local`) laid over it, both as `sectionBody` answers them. A keyed bullet of the local body stands
// in place of the state file's bullet of the same key, so a key that both hold is there once, with this machine's
// value; whatever else the local body holds follows the state file's lines, in its own order. Null when neither
// file has the section.
export function overlaidBody(body, local) {
  if (body === null || local === null) return body ?? local;
  const lines = filled(body.split("\n"));
  const more = [];
  const extra = filled(local.split("\n"));
  for (let i = 0; i < extra.length;) {
    const [key] = keysAmong([extra[i]]);
    if (key === undefined) {
      more.push(extra[i++]);
      continue;
    }
    const { to } = keyedAt(extra.slice(i), key);
    const bullet = extra.slice(i, i + to);
    const at = keyedAt(lines, key);
    if (at) lines.splice(at.from, at.to - at.from, ...bullet);
    else more.push(...bullet);
    i += to;
  }
  const whole = trimmed([...lines, ...more]);
  return whole.length > 0 ? whole.join("\n") : EMPTY;
}

// The text as lines, with its line ending and whether it ends with one.
function open(text) {
  const eol = /\r?\n/.exec(text)?.[0] ?? "\n";
  const final = /\r?\n$/.test(text);
  return { eol, final, lines: text.replace(/\r?\n$/, "").split(/\r?\n/) };
}

// The sections among the lines: each one's name, the index of its heading and of the line after its last.
function sectionsOf(lines) {
  return scan(lines).sections;
}

// The lines' sections, and whether the lines end inside a code fence. A fence opens at a line of three or more
// backticks or tildes (a language may follow) and closes at a line of the same character, at least as many, and
// nothing else.
function scan(lines) {
  const sections = [];
  let fence = null; // the marks that opened the code fence the line is inside
  lines.forEach((line, i) => {
    const marks = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      const closes = marks && marks[0] === fence[0] && marks.length >= fence.length && line.trim() === marks;
      if (closes) fence = null;
    } else if (marks) {
      fence = marks;
    } else {
      const name = /^## +(.+?)\s*$/.exec(line)?.[1];
      if (name) sections.push({ name, heading: i });
    }
  });
  sections.forEach((s, k) => (s.end = sections[k + 1]?.heading ?? lines.length));
  return { sections, openFence: fence !== null };
}

const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const find = (sections, name) => sections.find((s) => same(s.name, name));

// A section's lines without the blank ones around them.
function bodyOf(lines, section) {
  return trimmed(lines.slice(section.heading + 1, section.end));
}

function trimmed(lines) {
  let from = 0;
  let to = lines.length;
  while (from < to && !lines[from].trim()) from++;
  while (to > from && !lines[to - 1].trim()) to--;
  return lines.slice(from, to);
}

// A body given as text, as lines without the blank ones around them.
const toLines = (body) => trimmed(body.replace(/\r\n?/g, "\n").split("\n"));

// A body's lines to append to: none for the placeholder.
const filled = (body) => (body.length === 1 && body[0].trim() === EMPTY ? [] : [...body]);

// A list item's lines: `- ` and the text, its later lines indented by two spaces.
function item(text) {
  const [first, ...rest] = toLines(text);
  return [`- ${first}`.trimEnd(), ...rest.map((l) => (l.trim() ? `  ${l}` : ""))];
}

const keyPrefix = (key) => `- **${key}:**`;
const keyedItem = (key, value) => item(`**${key.trim()}:** ${value}`.trimEnd());

// The keys of the keyed bullets among a body's lines: of each line that starts one, the text up to the first
// `:**` that a space or the line's end follows.
const keysAmong = (lines) => lines.map((l) => /^- \*\*(.+?):\*\*(?= |$)/.exec(l)?.[1]).filter(Boolean);

// Where the keyed bullet stands among the body's lines: its first line and the line after its last; null when no
// bullet has the key. Its later lines are the indented ones that follow, with any blank lines between them.
function keyedAt(lines, key) {
  const from = lines.findIndex((l) => l === keyPrefix(key) || l.startsWith(`${keyPrefix(key)} `));
  if (from === -1) return null;
  let to = from + 1;
  for (let i = to; i < lines.length; i++) {
    if (/^\s+\S/.test(lines[i])) to = i + 1;
    else if (lines[i].trim()) break;
  }
  return { from, to };
}

// The text with one section's body changed by `change` (the body's lines in, the new ones out).
function edit(text, name, create, change) {
  const { eol, final, lines } = open(text);
  const sections = sectionsOf(lines);
  let section = find(sections, name);
  if (!section && !create) {
    const names = sections.map((s) => s.name).join(", ");
    throw new Error(`no section "${name.trim()}"; the sections are: ${names || "none yet"}`);
  }
  if (!section) {
    if (!name.trim() || /[\r\n]/.test(name)) throw new Error("a section's name is one line of text");
    while (lines.length > 0 && !lines.at(-1).trim()) lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(`## ${name.trim()}`);
    section = { heading: lines.length - 1, end: lines.length };
  }
  const body = trimmed(change(bodyOf(lines, section)));
  const inBody = scan(body);
  if (inBody.sections.length > 0) {
    throw new Error("the text holds a `## ` line, which would start a new section; use `### ` or deeper inside one");
  }
  if (inBody.openFence) {
    throw new Error("the text leaves a code fence open, which would swallow the sections after it; close the fence");
  }
  const last = section.end === lines.length;
  const block = ["", ...(body.length > 0 ? body : [EMPTY]), ...(last ? [] : [""])];
  lines.splice(section.heading + 1, section.end - section.heading - 1, ...block);
  return lines.join(eol) + (final ? eol : "");
}
