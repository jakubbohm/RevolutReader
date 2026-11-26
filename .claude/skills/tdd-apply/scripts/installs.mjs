// Which folders of a repository have an npm install, and whether an install is what its lockfile says: the rule
// behind `tdd.mjs install`, which checks every install when /tdd-apply or /triage-review starts and has npm make
// the ones that are not there or not current (docs/conventions/testing.md § Test-first workflow). Texts and names
// in, texts and objects out: nothing here touches a file, git or npm.
//
// An install is per checkout: a new worktree or clone has no node_modules, and a lockfile that changed since the
// last install (a pull, a merge) leaves the one that is there behind. Tests then fail for no reason of the code,
// or, worse, run on other packages than CI's.
//
// The rule compares two files of the install folder:
// - `package-lock.json`, which git tracks: what is to be installed;
// - `node_modules/.package-lock.json`: what npm installed. npm writes it at the end of every install, from the
//   tree it just made, in the lockfile's own form, without the root project's entry ("hidden lockfile":
//   npm's documentation of package-lock.json, § Hidden Lockfiles; read for npm 11.19.1, 2026-11-26).
// Of both files' `packages` maps only the entries of installed packages count: those whose path has a
// `node_modules/` in it. The root project (`""`) and a linked folder of the repository itself (a workspace) are
// no installed packages.
//
// An install is `ok` when all of this holds:
// - every locked package that is not marked `optional` is recorded;
// - every recorded package is locked;
// - each package in both files is the same in both: the same `version`; the same `resolved` (where it came from)
//   and the same `integrity` (the hash of what was unpacked) wherever both files give one; a link in both or in
//   neither;
// - the folder of each such package holds a `package.json`: a folder emptied after the install (an `npm ci` that
//   failed while it cleared node_modules) is seen, although the record still names it.
// Otherwise it is `missing` when there is no node_modules folder, and `stale` when there is one.
//
// What the rule leaves open, and why:
// - An optional package may be absent. npm leaves one out when it is for another system, or when its install
//   failed, and the lockfile cannot say which: its entry does not always carry the package's `os` and `cpu`, and
//   an engine range would need npm's own code to read. One that is installed must still be the locked one. So an
//   optional package that this system needs and that is not there is not seen here: the tests that need it fail.
// - `npm ls` is no substitute: it checks the tree against the ranges of package.json, so a lockfile's step
//   inside a range passes it.
// - npm's own test of whether it may trust its record (no package folder newer than the record) is not used: a
//   tool that writes into its own package folder would make a good install look stale at every start.
// - A lockfile that locks nothing to install is `ok` whatever is there: npm then makes no node_modules at all.
// - Whether package.json and the lockfile agree is not judged here: `npm ci` refuses to install when they do not,
//   and CI runs it. Nor is a folder provided for that also holds an `npm-shrinkwrap.json`, which npm would read in
//   the lockfile's place.

// The lockfile, and npm's record of what it installed, from the install folder.
export const LOCKFILE = "package-lock.json";
export const RECORD = "node_modules/.package-lock.json";

// The folders under which a lockfile is never an install to check: a package's own files, and a test's made-up
// ones. A test of these scripts builds its lockfiles as it runs and commits none.
const NEVER_UNDER = ["node_modules", "fixtures"];

// The install folders among the paths git tracks, from the repository's root with forward slashes, `.` for the
// root itself, in the order of their names: every folder that holds a tracked `package-lock.json`, but none with
// a folder named `node_modules` or `fixtures` on its path, in any case of letters.
export function installFolders(tracked) {
  const folders = tracked
    .filter((path) => path === LOCKFILE || path.endsWith(`/${LOCKFILE}`))
    .map((path) => path.slice(0, -LOCKFILE.length - 1) || ".")
    .filter((folder) => !folder.split("/").some((name) => NEVER_UNDER.includes(name.toLowerCase())));
  return [...new Set(folders)].sort();
}

// Whether an entry of a `packages` map is an installed package: its path has a node_modules in it.
const isPackage = (path) => /(^|\/)node_modules\//.test(path);

// What differs between a package as locked and as recorded, in a few words; null when nothing does.
function mismatch(want, has) {
  if (Boolean(want.link) !== Boolean(has.link)) {
    return want.link ? "locked as a link, installed as a folder" : "locked as a folder, installed as a link";
  }
  const differs = (field) =>
    typeof want[field] === "string" && typeof has[field] === "string" && want[field] !== has[field];
  if (want.link) return differs("resolved") ? "a link to another folder" : null;
  if (want.version !== has.version) {
    return `${want.version ?? "no version"} locked, ${has.version ?? "no version"} installed`;
  }
  const version = want.version === undefined ? "" : `${want.version} `;
  if (differs("resolved")) return `${version}from another source`;
  if (differs("integrity")) return `${version}with another hash`;
  return null;
}

// The packages in which an install differs from its lockfile, each with its path and what differs: the locked
// ones in the lockfile's order, then those installed that the lockfile does not have. `locked` and `recorded` are
// the two files' `packages` maps, and `holds` says whether a package's folder (its path in the map) holds a
// package.json: it is asked only for a package the two maps agree on.
export function installDifferences(locked, recorded, holds) {
  const differences = [];
  for (const [path, want] of Object.entries(locked)) {
    if (!isPackage(path)) continue;
    if (!Object.hasOwn(recorded, path)) {
      if (want.optional !== true) differences.push({ path, what: "not installed" });
      continue;
    }
    const what = mismatch(want, recorded[path]) ?? (holds(path) ? null : "its folder holds no package.json");
    if (what !== null) differences.push({ path, what });
  }
  for (const path of Object.keys(recorded)) {
    if (isPackage(path) && !Object.hasOwn(locked, path)) differences.push({ path, what: "not in the lockfile" });
  }
  return differences;
}

// A file's text as JSON, without the byte-order mark some tools put before it. Throws with a reason on one line.
function parsed(text) {
  try {
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new Error(e.message.replace(/\s+/g, " ").trim());
  }
}

// A lockfile's `packages` map; null when the text holds none.
const packagesOf = (data) => {
  const packages = data !== null && typeof data === "object" ? data.packages : undefined;
  return packages !== null && typeof packages === "object" && !Array.isArray(packages) ? packages : null;
};

const NAMED = 3; // the most packages a reason names

// The state of one folder's install: `ok`, `missing` or `stale`, and for `stale` in `why` what is wrong, on one
// line. `lockfile` is the text of the folder's package-lock.json; `record` the text of its
// node_modules/.package-lock.json, or null when that file is not there; `modules` says whether the node_modules
// folder is there; `holds` is `installDifferences`'s. Throws, with one line, for a lockfile it cannot judge: one
// that is no JSON, or has no `packages` map (npm wrote none until its version 6).
export function installState({ lockfile, record, modules, holds }) {
  let data;
  try {
    data = parsed(lockfile);
  } catch (e) {
    throw new Error(`${LOCKFILE} cannot be read: ${e.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${LOCKFILE} cannot be read: it holds no object`);
  }
  const locked = packagesOf(data);
  if (locked === null) {
    const version =
      data.lockfileVersion === undefined ? "no lockfileVersion" : `lockfileVersion ${data.lockfileVersion}`;
    throw new Error(`${LOCKFILE} has no "packages" map (${version}): the check reads lockfileVersion 2 or 3`);
  }

  let recorded = {};
  let unread = null;
  if (record !== null) {
    try {
      recorded = packagesOf(parsed(record));
      if (recorded === null) throw new Error('it holds no "packages" map');
    } catch (e) {
      [recorded, unread] = [{}, e.message];
    }
  }

  const differences = installDifferences(locked, recorded, holds);
  if (differences.length === 0) return { state: "ok", why: null };
  if (!modules) return { state: "missing", why: null };
  if (record === null) return { state: "stale", why: `no ${RECORD}, npm's record of what it installed` };
  if (unread !== null) return { state: "stale", why: `${RECORD} cannot be read: ${unread}` };
  const named = differences.slice(0, NAMED).map(({ path, what }) => `${path} (${what})`);
  const more = differences.length > NAMED ? ` and ${differences.length - NAMED} more` : "";
  const count = `${differences.length} package${differences.length === 1 ? "" : "s"}`;
  return { state: "stale", why: `differs from the lockfile in ${count}: ${named.join(", ")}${more}` };
}
