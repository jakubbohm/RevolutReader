// Which folders of a repository have an npm install, and whether an install is what its lockfile says: the rule
// behind `tdd.mjs install`, which checks every install when /tdd-apply or /triage-review starts and has npm make
// the ones that are not there or not current (docs/conventions/testing.md § Test-first workflow). Also how that
// command's one time limit is shared among its installs (`installTime`). Texts, names and numbers in, texts and
// objects out: nothing here touches a file, a clock, git or npm.
//
// An install is per checkout: a new worktree or clone has no node_modules, and a lockfile that changed since the
// last install (a pull, a merge) leaves the one that is there behind. Tests then fail for no reason of the code,
// or, worse, run on other packages than CI's.
//
// The rule reads two files of the install folder and, of each installed package's own folder, only whether it
// holds a `package.json`. The two files:
// - `package-lock.json`, which git tracks: what is to be installed;
// - `node_modules/.package-lock.json`: what npm installed. npm writes it in every install, when it has unpacked
//   and built every package, from the tree it just made, in the lockfile's own form, without the root project's
//   entry ("hidden lockfile": npm's documentation of package-lock.json, § Hidden Lockfiles; read for npm
//   11.19.1, 2026-11-26).
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
// The two files are not treated alike when the text of one cannot be read: no JSON, no `packages` map, or a
// package's entry that npm does not write (no object, or a `version`, `resolved`, `integrity` or `link` of
// another kind). Such a record is read as a record of nothing, which makes the install `stale`, with that
// reason, wherever the lockfile locks a package that must be installed: the record is npm's own, and `npm ci`
// writes it again. Such a lockfile is an error, and nothing is installed from it: it is the project's, and
// nothing here may guess what it means.
//
// A record that is there and cannot be opened or read is another matter, and no state of the install: another
// program holds the file, the system does not give it out, a folder stands in its place (`notThere` says which
// failures mean that there is no record). `tdd.mjs install` tells it as an error of that folder, with the file
// and the system's words, and installs nothing there. The install may be a good one, and `npm ci` would empty
// node_modules first and then most likely fail on that same file.
//
// An install that was stopped half-way never reads `ok`, which is why running the check again is the way on
// after one. `npm ci` is started only where the install is `missing` or `stale`. It first removes everything
// node_modules holds, the record with it, and writes the record again only when every package is unpacked and
// built. Until then the folder has the record it had, or none, and so the state it had, or `stale`. (npm 11.19.1,
// read 2026-11-26: lib/commands/ci.js 97-110; in `@npmcli/arborist`, lib/arborist/reify.js 139 and 269-274.)
//
// What the rule leaves open, and why:
// - npm writes its record before it runs the root project's own scripts: the `predependencies`, `dependencies`
//   and `postdependencies` of the folder's package.json (reify.js 275-294), then its `preinstall`, `install`,
//   `postinstall`, `prepublish`, `preprepare`, `prepare` and `postprepare` (ci.js 112-132; the same version and
//   day). When one of them fails, `npm ci` fails, and the next check still reads the folder as `ok`, although
//   that script, and those after it, did not run to their end. No package.json of this repository has such a
//   script (2026-11-26); a project that has one needs more than this check.
// - The rule is asked when a run starts or resumes (`tdd.mjs install`), and after that only when a runner stops
//   because an install looks incomplete. A lockfile that changes while a run is under way (a merge, or work that
//   `tdd.mjs unshelve` puts back) is not checked again before then.
// - An optional package may be absent. npm leaves one out when it is for another system, or when its install
//   failed, and the lockfile cannot say which: its entry does not always carry the package's `os` and `cpu`, and
//   an engine range would need npm's own code to read. One that is installed must still be the locked one. So an
//   optional package that this system needs and that is not there is not seen here: the tests that need it fail.
// - A dev package (`dev` in the lockfile) counts like any other, and is never left out as npm's configuration
//   may leave it out (`omit=dev`, or NODE_ENV=production, which sets that default): the tests run on the dev
//   packages. So `tdd.mjs install` runs `npm ci` with npm's `include` setting naming `dev` (`includingDev`
//   there), which overrides that omission, and an install made without them reads `stale`. (npm 11.19.1, read
//   2026-11-26: `@npmcli/config`, the definitions of `omit` and `include`.)
// - `npm ls` is no substitute: it checks the tree against the ranges of package.json, so a lockfile's step
//   inside a range passes it.
// - npm's own test of whether it may trust its record (no package folder newer than the record) is not used: a
//   tool that writes into its own package folder would make a good install look stale at every start.
// - A lockfile that locks nothing that must be installed (no package, or optional ones alone) is `ok` with no
//   node_modules, and with one that has no record or one whose text cannot be read: npm then makes no
//   node_modules at all. (A package that a record still names is `not in the lockfile`, there as anywhere.)
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

// Whether a failure to read npm's record says that there is none: no such file, or no node_modules folder to
// hold one. `error` is what reading the file threw. Any other failure is a record that is there and cannot be
// opened or read (another program holds it, the system does not give it out, a folder stands in its place), and
// is no state of the install: the header says why.
export const notThere = (error) => error?.code === "ENOENT" || error?.code === "ENOTDIR";

// A text on one line: each run of blanks and line breaks in it as one blank. A line break is every character
// that ends a line somewhere, Unicode's next line (U+0085) with those JavaScript counts as blanks.
const onOneLine = (text) => String(text).replace(/[\s\x85]+/g, " ").trim();

// A file's text as JSON, without the byte-order mark some tools put before it.
const parsed = (text) => JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// A lockfile's `packages` map; null when the text holds none.
const packagesOf = (data) => {
  const packages = data !== null && typeof data === "object" ? data.packages : undefined;
  return packages !== null && typeof packages === "object" && !Array.isArray(packages) ? packages : null;
};

// What makes a `packages` map one that npm does not write, in a few words; null when nothing does. It looks at
// the entries of installed packages alone, and in each at what the rule reads: the entry is an object, its
// `version`, `resolved` and `integrity` are strings where it has them, and its `link` is true or false.
function malformed(packages) {
  for (const [path, entry] of Object.entries(packages)) {
    if (!isPackage(path)) continue;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return `its entry ${path} is no object`;
    for (const field of ["version", "resolved", "integrity"]) {
      if (entry[field] !== undefined && typeof entry[field] !== "string") {
        return `in its entry ${path}, "${field}" is no string`;
      }
    }
    if (entry.link !== undefined && typeof entry.link !== "boolean") {
      return `in its entry ${path}, "link" is neither true nor false`;
    }
  }
  return null;
}

const NAMED = 3; // the most packages a reason names

// The state of one folder's install: `ok`, `missing` or `stale`, and for `stale` in `why` what is wrong.
// `lockfile` is the text of the folder's package-lock.json. `record` is the text of npm's record of the install,
// the folder's node_modules/.package-lock.json, or null when that file is not there (`notThere`). `modules` says
// whether the node_modules folder is there; `holds` is `installDifferences`'s.
//
// The two files are not treated alike. Throws for a lockfile it cannot judge: one that is no JSON, or has no
// `packages` map (npm wrote none until its version 6), or holds a package's entry that npm does not write
// (`malformed`). The lockfile is the owner's, and nothing here may guess what it means. A record whose text
// cannot be read, in any of those ways, is no error: it is read as a record of nothing, so the install is
// `stale` wherever the lockfile locks a package that must be installed, with that reason in `why`, because the
// record is npm's own and `npm ci` writes it again.
//
// A `why`, and the message of what is thrown, is on one line whatever the two files hold: a package's path, a
// version and a JSON error's words all come from them (`onOneLine`).
export function installState({ lockfile, record, modules, holds }) {
  const refuse = (what) => {
    throw new Error(onOneLine(what));
  };
  const stale = (why) => ({ state: "stale", why: onOneLine(why) });

  let data;
  try {
    data = parsed(lockfile);
  } catch (e) {
    refuse(`${LOCKFILE} cannot be read: ${e.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    refuse(`${LOCKFILE} cannot be read: it holds no object`);
  }
  const locked = packagesOf(data);
  if (locked === null) {
    const version =
      data.lockfileVersion === undefined ? "no lockfileVersion" : `lockfileVersion ${data.lockfileVersion}`;
    refuse(`${LOCKFILE} has no "packages" map (${version}): the check reads lockfileVersion 2 or 3`);
  }
  const wrong = malformed(locked);
  if (wrong !== null) refuse(`${LOCKFILE} cannot be read: ${wrong}`);

  let recorded = {};
  let unread = null;
  if (record !== null) {
    try {
      recorded = packagesOf(parsed(record));
      if (recorded === null) throw new Error('it holds no "packages" map');
      const unwritten = malformed(recorded);
      if (unwritten !== null) throw new Error(unwritten);
    } catch (e) {
      [recorded, unread] = [{}, e.message];
    }
  }

  const differences = installDifferences(locked, recorded, holds);
  if (differences.length === 0) return { state: "ok", why: null };
  if (!modules) return { state: "missing", why: null };
  if (record === null) return stale(`no ${RECORD}, npm's record of what it installed`);
  if (unread !== null) return stale(`${RECORD} cannot be read: ${unread}`);
  const named = differences.slice(0, NAMED).map(({ path, what }) => `${path} (${what})`);
  const more = differences.length > NAMED ? ` and ${differences.length - NAMED} more` : "";
  const count = `${differences.length} package${differences.length === 1 ? "" : "s"}`;
  return stale(`differs from the lockfile in ${count}: ${named.join(", ")}${more}`);
}

// The part of `tdd.mjs install`'s time limit that must be left for the install of a `stale` folder to start: a
// third. `npm ci` empties node_modules before it installs, so one that is stopped at the limit leaves less than
// was there, and an install that is behind and still usable must not be given up for one that has seconds to
// run. No figure follows from how long an install takes: that depends on the folder, the cache and the network
// (the one install timed here, 33 packages, took 5 seconds, 2026-11-26). A third is a share of the limit, so it
// follows a --timeout, and with the 9 minutes of the default it leaves an install at least 3.
const LEAST_LEFT = 1 / 3;

// Whether `npm ci` may start in a folder, and how long it may then run. `tdd.mjs install` has one time limit for
// all its folders: `limitMs`, of which `usedMs` are used when this folder's turn comes. `state` is the folder's,
// `missing` or `stale`.
// - An install may run for all that is left of the limit, and no longer: it gets what the ones before it left.
// - In a `stale` folder it starts only while LEAST_LEFT of the limit is left.
// - In a `missing` folder it starts while any time is left: there is no node_modules to lose.
// Answers `{ start: true, forMs }` or, for an install that is not to start, `{ start: false, left }`: how much
// was left, in the words that stand before "of the time limit", `less than a third` or `none`.
export function installTime({ limitMs, usedMs, state }) {
  const left = limitMs - usedMs;
  if (state === "stale" && left < limitMs * LEAST_LEFT) return { start: false, left: "less than a third" };
  if (left <= 0) return { start: false, left: "none" };
  return { start: true, forMs: left };
}
