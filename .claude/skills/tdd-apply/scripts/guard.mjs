// The guard that the implementer changed no test code and no OpenSpec artifact (docs/conventions/testing.md
// § Test-first workflow), for /tdd-apply's task groups and for the fixes of a review's findings alike: which paths
// are forbidden in which step, how git's status list is read, and the report `tdd.mjs check` prints. Nothing here
// calls git.
//
// Keep the path rules consistent with .claude/hooks/deny-test-edits.mjs, the second layer, which stops the
// implementer's Edit and Write calls on the same paths before they happen. This guard is the primary one: it also
// sees what a shell command wrote. The two differ only where they must:
// - the hook sees absolute paths and cannot know the step, so it lets both allowed folders through in every step;
//   the guard sees paths from the repository's root and allows each folder only in its steps;
// - the guard also refuses the frontend's test kit (src/RevolutReader.Web/src/test/) and any folder whose name
//   contains `Tests`, as the skill's rule says; the hook has neither rule.

// The steps the guard knows: a `[green]`, a `[wire]` and a `[close]` handoff.
export const STEPS = ["green", "wire", "close"];

// Folders the implementer may write in, in the steps that allow it.
const ALLOWED = [
  { steps: ["wire", "close"], folder: /^tests\/RevolutReader\.AcceptanceTests\/Drivers\//i }, // real driver methods
  { steps: ["wire"], folder: /^tests\/RevolutReader\.IntegrationTests\/Wiring\//i }, // adapter edge-case tests
];

const TEST_CODE = [
  /(^|\/)tests\//i, // any tests/ folder
  /(^|\/)[^/]*Tests[^/]*\//, // a folder whose name contains Tests: RevolutReader.UnitTests/, HarnessSelfTests/
  /\.Tests?\//i, // Foo.Tests/ or Foo.Test/ projects, in any case (the hook's rule)
  /Tests?\.csproj$/i, // RevolutReader.UnitTests.csproj, Foo.Tests.csproj
  /^src\/RevolutReader\.Web\/src\/test\//i, // the frontend's test kit
  /\.(test|spec)\.[cm]?[jt]sx?$/i, // *.test.ts, *.spec.tsx, *.test.mjs, ...
];

const OPENSPEC = /(^|\/)openspec\//i; // specs, design and tasks are not the implementer's to change

// The bookkeeping's own files, which the main session and the runner write through tdd.mjs and the implementer
// never touches: they lie under openspec/ and pass all the same. `own` says whose they are:
// - a change's name: an apply's state file and chapter reviews file in the change's folder under
//   openspec/changes;
// - a list of paths from the repository's root: those files themselves. tdd.mjs gives the list: the same two
//   files wherever the change's folder lies (an archived change's is under openspec/changes/archive), or in a
//   triage its state file alone, .review-triage.md, when that lies in the repository.
const ownFiles = (own) =>
  typeof own === "string"
    ? [`openspec/changes/${own}/.tdd-state.md`, `openspec/changes/${own}/.chapter-reviews.md`]
    : own.map(normal);

// A path from the repository's root with forward slashes and no `./` before it.
const normal = (path) => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

// Whether a changed path (from the repository's root, either kind of slash) is one the implementer must not have
// changed in this step: test code or an OpenSpec artifact, outside the step's allowed folders and not one of the
// bookkeeping's own files (`own`, above).
export function isForbidden(path, step, own) {
  if (!STEPS.includes(step)) throw new Error(`unknown step "${step}"; the steps are: ${STEPS.join(", ")}`);
  const p = normal(path);
  if (ALLOWED.some((a) => a.steps.includes(step) && a.folder.test(p))) return false;
  if (ownFiles(own).includes(p)) return false;
  return OPENSPEC.test(p) || TEST_CODE.some((r) => r.test(p));
}

// The entries of `git status --porcelain -z`: each one's two status letters and its path, and for a rename or a
// copy the path it came from, which git gives as the entry after it. With `-z` git quotes no path, so a path with
// spaces, quotes or letters outside ASCII arrives as it is.
export function parseStatus(z) {
  const entries = [];
  const records = z.split("\0");
  for (let i = 0; i < records.length; i++) {
    if (records[i].length < 4) continue; // the empty text after the last NUL
    const entry = { status: records[i].slice(0, 2), path: records[i].slice(3) };
    if (/[RC]/.test(entry.status)) entry.from = records[++i];
    entries.push(entry);
  }
  return entries;
}

// The changed paths split into those the step forbids and the others, each in git's order. A rename counts by
// both its paths, since the old one is gone; a copy by its new path only. `own` is `isForbidden`'s.
export function guard(entries, step, own) {
  const violations = [];
  const others = [];
  for (const entry of entries) {
    const paths = entry.from !== undefined && entry.status.includes("R") ? [entry.path, entry.from] : [entry.path];
    (paths.some((p) => isForbidden(p, step, own)) ? violations : others).push(entry);
  }
  return { violations, others };
}

const LISTED = 60; // the most paths a list names

// The check's report as lines: `ok: <n> changed paths` (the same words for any count, so that a reader can match
// them) and the changed paths, or the violations and then the other changed paths; each path with git's status
// letters, a rename as `old -> new`, each list cut after 60 paths.
export function guardReport({ violations, others }) {
  const list = (entries) => [
    ...entries.slice(0, LISTED).map((e) => `  ${e.status} ${e.from === undefined ? "" : `${e.from} -> `}${e.path}`),
    ...(entries.length > LISTED ? [`  … and ${entries.length - LISTED} more`] : []),
  ];
  if (violations.length === 0) return [`ok: ${others.length} changed paths`, ...list(others)];
  return [
    `violations (${violations.length}):`,
    ...list(violations),
    ...(others.length > 0 ? [`other changed paths (${others.length}):`, ...list(others)] : []),
  ];
}
