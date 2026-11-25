// What tells tdd.mjs and the hook .claude/hooks/tdd-resume.mjs which triage is under way in a working tree: the
// pointer, the PR's id, and where a change's folder lies once it is archived. Texts and names in, texts and
// objects out: nothing here touches a file or calls git. (The triage's state file as a text is state.mjs's.)
//
// The pointer is the file `triage.json` in `<git folder>/tdd`, the folder `git rev-parse --git-path tdd` answers:
// a working tree has its own, it is never tracked and never in the working tree, and only `tdd.mjs triage-init`
// writes it. It holds { pr, round, change (null for a PR without an OpenSpec change), scope, work, state }: the
// PR's id, the round, the change's name, the scope of the round's commits, the work folder and the state file,
// both as absolute paths.
//
// - The state file of a PR without a change lies in the same folder, as `triage-<id>.md`: a session's scratchpad is
//   gone with the session, and the working tree's git folder is the one place that every round and every session
//   of the PR finds again without a tracked file. Nothing in the working tree says that such a triage is under
//   way: the pointer does.
// - The work folder is some session's scratchpad. Only the pointer holds it, never a tracked file: it is a path of
//   one machine.

export const POINTER_FILE = "triage.json";

// The name a PR's triage has among what a working tree's git folder keeps for the bookkeeping: its state file when
// the PR has no change, its local file (this machine's values) and its shelved work. An apply's name there is its
// change's.
export const triageAccount = (pr) => `triage-${pr}`;

// The name of the state file of a PR without a change, in the pointer's folder.
export const prStateFile = (pr) => `${triageAccount(pr)}.md`;

// A PR's id as the pointer holds it: the PR's number, with or without its `#`, or for a trial without a PR any
// token of letters, digits and dashes, such as `local`. Throws for anything else.
export function prId(given) {
  const id = String(given ?? "")
    .trim()
    .replace(/^#/, "");
  if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(id)) {
    throw new Error("--pr is the PR's number, or a token of letters, digits and dashes such as local");
  }
  return id;
}

// The pointer file's text.
export function pointerText({ pr, round, change, scope, work, state }) {
  return `${JSON.stringify({ pr, round, change: change ?? null, scope, work, state }, null, 2)}\n`;
}

// The pointer a pointer file's text holds. Throws when it is not one the script wrote.
export function readPointer(text) {
  let pointer;
  try {
    pointer = JSON.parse(text);
  } catch (e) {
    throw new Error(`the triage's pointer is not JSON: ${e.message}`);
  }
  const isText = (value) => typeof value === "string" && value !== "";
  const whole =
    pointer !== null &&
    typeof pointer === "object" &&
    ["pr", "scope", "work", "state"].every((field) => isText(pointer[field])) &&
    Number.isInteger(pointer.round) &&
    (pointer.change === null || isText(pointer.change));
  if (!whole) throw new Error("the triage's pointer lacks a field: pr, round, change, scope, work or state");
  const { pr, round, change, scope, work, state } = pointer;
  return { pr, round, change, scope, work, state };
}

// Among the names of the folders in openspec/changes/archive, those of this change: its name after the day it was
// archived (2026-11-23-c018-add-approximate-payment-time).
export function archivedAs(names, change) {
  return names.filter((name) => /^\d{4}-\d{2}-\d{2}-/.test(name) && name.slice(11) === change);
}
