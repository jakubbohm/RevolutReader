// Tests for installs.mjs's pure functions: which folders have an npm install to check, and whether an install is
// what its lockfile says. Texts and names in, texts and objects out: nothing here touches a file, git or npm, and
// every package, version and address is made up. The lockfiles are built here, as texts: no file named
// package-lock.json is committed for a test, so that the check never takes one for a folder to install. (That
// `tdd.mjs install` finds the folders with git, reads the files and runs npm is tested in tdd.test.mjs.)
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { installDifferences, installFolders, installState, LOCKFILE, RECORD } from "./installs.mjs";

// A package as a lockfile's `packages` map holds it, from a registry: its version, where it came from and the
// hash of what was unpacked.
const from = (version, more = {}) => ({
  version,
  resolved: `https://registry.example.com/made-up/-/made-up-${version}.tgz`,
  integrity: `sha512-made-up-${version}`,
  ...more,
});

// The root project's own entry, which only the committed lockfile has. Its range lets 1.2.3 and 1.2.4 both in.
const ROOT = { name: "made-up-project", version: "0.0.0", devDependencies: { "made-up-dep": "^1.2.0" } };

// A committed lockfile's text, and the text of npm's record of an install (node_modules/.package-lock.json), which
// has the same form without the root project's entry.
const lockfile = (packages, more = {}) =>
  JSON.stringify({ name: "made-up-project", version: "0.0.0", lockfileVersion: 3, requires: true, packages, ...more });
const locking = (packages) => lockfile({ "": ROOT, ...packages });
const recording = (packages) => lockfile(packages);

// An install's state with every recorded package's folder in place, unless `gone` names it.
const stateOf = ({ locked, recorded, modules = true, gone = [] }) =>
  installState({
    lockfile: typeof locked === "string" ? locked : locking(locked),
    record: recorded === null || typeof recorded === "string" ? recorded : recording(recorded),
    modules,
    holds: (path) => !gone.includes(path),
  });

const OK = { state: "ok", why: null };
const stale = (why) => ({ state: "stale", why });

// Three packages as they are locked, and as an install on this machine records them: the plain one, a scoped one
// that only tests need, and one nested under another's own node_modules.
const THREE = {
  "node_modules/made-up-dep": from("1.2.4"),
  "node_modules/@made-up/scoped": from("3.0.0", { dev: true }),
  "node_modules/made-up-dep/node_modules/made-up-nested": from("0.9.1"),
};

describe("the files' names", () => {
  test("are the lockfile and npm's record of the install, from the install folder", () => {
    assert.equal(LOCKFILE, "package-lock.json");
    assert.equal(RECORD, "node_modules/.package-lock.json");
  });
});

describe("installFolders", () => {
  test("gives the folder of each tracked package-lock.json, from the repository's root, in the order of the names", () => {
    const tracked = [
      "tools/made-up-client/package-lock.json",
      "tools/made-up-client/package.json",
      "src/Made.Up.Web/package-lock.json",
      "src/Made.Up.Web/src/main.ts",
      "README.md",
    ];

    assert.deepEqual(installFolders(tracked), ["src/Made.Up.Web", "tools/made-up-client"]);
  });

  test("gives `.` for a lockfile in the repository's root", () => {
    assert.deepEqual(installFolders(["package-lock.json", "a/package-lock.json"]), [".", "a"]);
  });

  test("takes no file whose name only ends or starts like the lockfile's, and none with letters of another case", () => {
    const tracked = [
      "a/not-package-lock.json",
      "b/package-lock.json.bak",
      "c/package-lock.json/x.txt",
      "d/npm-shrinkwrap.json",
      "e/Package-Lock.json",
    ];

    assert.deepEqual(installFolders(tracked), []);
  });

  test("leaves out a lockfile under a folder named fixtures or node_modules, at any depth and in any case of letters", () => {
    const tracked = [
      ".claude/skills/made-up/scripts/fixtures/package-lock.json",
      "tests/Fixtures/an-npm-project/package-lock.json",
      "fixtures/deep/down/package-lock.json",
      "src/web/node_modules/made-up-dep/package-lock.json",
      "node_modules/package-lock.json",
      "src/web/package-lock.json",
    ];

    assert.deepEqual(installFolders(tracked), ["src/web"]);
  });

  test("keeps a folder whose name only contains those words", () => {
    const tracked = ["fixtures-maker/package-lock.json", "tools/my_node_modules/package-lock.json"];

    assert.deepEqual(installFolders(tracked), ["fixtures-maker", "tools/my_node_modules"]);
  });

  test("gives nothing for a repository without a lockfile", () => {
    assert.deepEqual(installFolders([]), []);
    assert.deepEqual(installFolders(["src/App/Mapping.cs"]), []);
  });
});

describe("installState: an install that is what the lockfile says", () => {
  test("is ok when every locked package is recorded with the same version, source and hash", () => {
    assert.deepEqual(stateOf({ locked: THREE, recorded: THREE }), OK);
  });

  test("does not look for the root project's own entry, which npm's record never has", () => {
    const locked = locking(THREE);

    assert.ok(Object.hasOwn(JSON.parse(locked).packages, ""));
    assert.deepEqual(stateOf({ locked, recorded: THREE }), OK);
  });

  test("is ok without the optional packages of other systems, which npm does not install here", () => {
    const locked = {
      ...THREE,
      "node_modules/@made-up/binding-linux-x64": from("4.0.0", { optional: true, os: ["linux"], cpu: ["x64"] }),
      "node_modules/@made-up/binding-darwin-arm64": from("4.0.0", { optional: true, dev: true, os: ["darwin"] }),
      "node_modules/@made-up/binding-win32-x64": from("4.0.0", { optional: true, os: ["win32"], cpu: ["x64"] }),
    };
    const recorded = {
      ...THREE,
      "node_modules/@made-up/binding-win32-x64": locked["node_modules/@made-up/binding-win32-x64"],
    };

    assert.deepEqual(stateOf({ locked, recorded }), OK);
  });

  test("is ok without an optional package that names no system: the lockfile cannot say why npm left it out", () => {
    const locked = {
      ...THREE,
      "node_modules/@made-up/wasm": from("4.0.0", { optional: true, dev: true }),
      "node_modules/@made-up/wasm-runtime": from("1.1.0", { optional: true, dev: true }),
    };

    assert.deepEqual(stateOf({ locked, recorded: THREE }), OK);
  });

  test("is ok when only one of the two files names a package's source or its hash", () => {
    const { resolved, integrity, ...bare } = from("1.2.4");
    const recorded = { ...THREE, "node_modules/made-up-dep": bare };

    assert.ok(resolved && integrity);
    assert.deepEqual(stateOf({ locked: THREE, recorded }), OK);
    assert.deepEqual(stateOf({ locked: recorded, recorded: THREE }), OK);
  });

  test("compares a bundled package, which has neither source nor hash, by its version", () => {
    const bundled = { version: "2.0.0", inBundle: true };
    const locked = { ...THREE, "node_modules/made-up-dep/node_modules/made-up-bundled": bundled };

    assert.deepEqual(stateOf({ locked, recorded: locked }), OK);
    assert.deepEqual(
      stateOf({
        locked,
        recorded: {
          ...locked,
          "node_modules/made-up-dep/node_modules/made-up-bundled": { ...bundled, version: "2.0.1" },
        },
      }),
      stale(
        "differs from the lockfile in 1 package: node_modules/made-up-dep/node_modules/made-up-bundled (2.0.0 locked, 2.0.1 installed)",
      ),
    );
  });

  test("is ok for two packages without a version, such as a folder of the repository itself", () => {
    const local = { resolved: "file:../made-up-local" };
    const locked = { ...THREE, "node_modules/made-up-local": local };

    assert.deepEqual(stateOf({ locked, recorded: locked }), OK);
  });

  test("reads both files with a byte-order mark before them", () => {
    assert.deepEqual(stateOf({ locked: `﻿${locking(THREE)}`, recorded: `﻿${recording(THREE)}` }), OK);
  });
});

describe("installState: an install that is not what the lockfile says", () => {
  test("is stale after a lockfile bump inside package.json's range, which `npm ls` does not see", () => {
    const recorded = { ...THREE, "node_modules/made-up-dep": from("1.2.3") };

    assert.equal(ROOT.devDependencies["made-up-dep"], "^1.2.0", "both versions are in the range");
    assert.deepEqual(
      stateOf({ locked: THREE, recorded }),
      stale("differs from the lockfile in 1 package: node_modules/made-up-dep (1.2.4 locked, 1.2.3 installed)"),
    );
  });

  test("is stale when a locked package is not recorded: a plain one, one only tests need, a peer, a devOptional one", () => {
    for (const flags of [{}, { dev: true }, { peer: true }, { devOptional: true }, { dev: true, peer: true }]) {
      const locked = { ...THREE, "node_modules/made-up-more": from("5.0.0", flags) };

      assert.deepEqual(
        stateOf({ locked, recorded: THREE }),
        stale("differs from the lockfile in 1 package: node_modules/made-up-more (not installed)"),
        JSON.stringify(flags),
      );
    }
  });

  test("is stale when an optional package is installed in another version", () => {
    const locked = { ...THREE, "node_modules/@made-up/binding-win32-x64": from("4.0.1", { optional: true }) };
    const recorded = { ...THREE, "node_modules/@made-up/binding-win32-x64": from("4.0.0", { optional: true }) };

    assert.deepEqual(
      stateOf({ locked, recorded }),
      stale(
        "differs from the lockfile in 1 package: node_modules/@made-up/binding-win32-x64 (4.0.1 locked, 4.0.0 installed)",
      ),
    );
  });

  test("is stale when a package is installed that the lockfile does not have", () => {
    const recorded = { ...THREE, "node_modules/made-up-extra": from("7.0.0", { extraneous: true }) };

    assert.deepEqual(
      stateOf({ locked: THREE, recorded }),
      stale("differs from the lockfile in 1 package: node_modules/made-up-extra (not in the lockfile)"),
    );
  });

  test("is stale when the version is the same and the source or the hash is another, such as a git commit", () => {
    const git = (commit) => ({ version: "1.0.0", resolved: `git+ssh://git@example.com/made-up/repo.git#${commit}` });
    const locked = { ...THREE, "node_modules/made-up-git": git("aaaaaaa") };

    assert.deepEqual(
      stateOf({ locked, recorded: { ...THREE, "node_modules/made-up-git": git("bbbbbbb") } }),
      stale("differs from the lockfile in 1 package: node_modules/made-up-git (1.0.0 from another source)"),
    );
    assert.deepEqual(
      stateOf({
        locked: THREE,
        recorded: { ...THREE, "node_modules/made-up-dep": { ...from("1.2.4"), integrity: "sha512-made-up-other" } },
      }),
      stale("differs from the lockfile in 1 package: node_modules/made-up-dep (1.2.4 with another hash)"),
    );
  });

  test("is stale when a recorded package's folder holds no package.json: the folder was emptied after the install", () => {
    assert.deepEqual(
      stateOf({ locked: THREE, recorded: THREE, gone: ["node_modules/@made-up/scoped"] }),
      stale("differs from the lockfile in 1 package: node_modules/@made-up/scoped (its folder holds no package.json)"),
    );
  });

  test("names the first three packages that differ, in the lockfile's order, and counts the others", () => {
    const names = ["a", "b", "c", "d", "e"].map((letter) => `node_modules/made-up-${letter}`);
    const locked = Object.fromEntries(names.map((name) => [name, from("2.0.0")]));
    const recorded = Object.fromEntries(names.map((name) => [name, from("1.0.0")]));

    assert.deepEqual(
      stateOf({ locked, recorded }),
      stale(
        "differs from the lockfile in 5 packages: node_modules/made-up-a (2.0.0 locked, 1.0.0 installed), " +
          "node_modules/made-up-b (2.0.0 locked, 1.0.0 installed), " +
          "node_modules/made-up-c (2.0.0 locked, 1.0.0 installed) and 2 more",
      ),
    );
  });

  test("is stale when node_modules is there without npm's record, or with one that cannot be read", () => {
    assert.deepEqual(
      stateOf({ locked: THREE, recorded: null }),
      stale("no node_modules/.package-lock.json, npm's record of what it installed"),
    );
    for (const record of ["", "not json", '{ "packages": ', "[]", "null", JSON.stringify({ lockfileVersion: 3 })]) {
      const state = stateOf({ locked: THREE, recorded: record });

      assert.equal(state.state, "stale", record);
      assert.match(state.why, /^node_modules\/\.package-lock\.json cannot be read: /, record);
      assert.ok(!state.why.includes("\n"), record);
    }
  });

  test("is missing when there is no node_modules folder", () => {
    assert.deepEqual(stateOf({ locked: THREE, recorded: null, modules: false }), { state: "missing", why: null });
  });
});

describe("installState: links and a repository's own packages", () => {
  const LINKED = {
    "node_modules/made-up-workspace": { resolved: "packages/made-up-workspace", link: true },
    "packages/made-up-workspace": { version: "0.0.0", dependencies: { "made-up-dep": "1.2.4" } },
    "packages/made-up-workspace/node_modules/made-up-inner": from("6.0.0"),
    "node_modules/made-up-dep": from("1.2.4"),
  };

  test("is ok when a locked link is recorded as a link to the same folder", () => {
    assert.deepEqual(stateOf({ locked: LINKED, recorded: LINKED }), OK);
  });

  test("does not look for a linked folder itself, which is no installed package, in either file", () => {
    const { "packages/made-up-workspace": target, ...withoutTarget } = LINKED;

    assert.ok(target);
    assert.deepEqual(stateOf({ locked: LINKED, recorded: withoutTarget }), OK);
    assert.deepEqual(stateOf({ locked: withoutTarget, recorded: LINKED }), OK);
  });

  test("is stale when a link is installed as a folder, a folder as a link, or the link leads elsewhere", () => {
    const one = (path, entry) => ({ ...LINKED, [path]: entry });
    const path = "node_modules/made-up-workspace";

    assert.deepEqual(
      stateOf({ locked: LINKED, recorded: one(path, from("0.0.0")) }),
      stale(`differs from the lockfile in 1 package: ${path} (locked as a link, installed as a folder)`),
    );
    assert.deepEqual(
      stateOf({ locked: one(path, from("0.0.0")), recorded: LINKED }),
      stale(`differs from the lockfile in 1 package: ${path} (locked as a folder, installed as a link)`),
    );
    assert.deepEqual(
      stateOf({ locked: LINKED, recorded: one(path, { resolved: "packages/another", link: true }) }),
      stale(`differs from the lockfile in 1 package: ${path} (a link to another folder)`),
    );
  });

  test("compares a package installed under a linked folder's own node_modules like any other", () => {
    const inner = "packages/made-up-workspace/node_modules/made-up-inner";
    const { [inner]: _, ...without } = LINKED;

    assert.deepEqual(
      stateOf({ locked: LINKED, recorded: without }),
      stale(`differs from the lockfile in 1 package: ${inner} (not installed)`),
    );
  });
});

describe("installState: a lockfile with nothing to install", () => {
  test("is ok whatever is there: no node_modules, one without a record, one with a record of nothing", () => {
    for (const locked of [{}, { "packages/made-up-workspace": { version: "0.0.0" } }]) {
      assert.deepEqual(stateOf({ locked, recorded: null, modules: false }), OK);
      assert.deepEqual(stateOf({ locked, recorded: null }), OK);
      assert.deepEqual(stateOf({ locked, recorded: {} }), OK);
    }
  });

  test("is ok without node_modules when every locked package is optional and none is installed", () => {
    const locked = { "node_modules/@made-up/binding-linux-x64": from("4.0.0", { optional: true, os: ["linux"] }) };

    assert.deepEqual(stateOf({ locked, recorded: null, modules: false }), OK);
  });
});

describe("installState: a lockfile it cannot judge", () => {
  test("refuses, in one line, a lockfile that is no JSON or holds no object", () => {
    for (const text of ["", "not json", '{ "packages": {', "[]", "null", '"text"']) {
      assert.throws(
        () => stateOf({ locked: text, recorded: THREE }),
        (e) => /^package-lock\.json cannot be read: /.test(e.message) && !e.message.includes("\n"),
        text,
      );
    }
  });

  test("refuses a lockfile without a packages map, which npm wrote until version 6, and names its version", () => {
    const old = JSON.stringify({
      name: "made-up-project",
      lockfileVersion: 1,
      dependencies: { "made-up-dep": { version: "1.2.4" } },
    });

    assert.throws(
      () => stateOf({ locked: old, recorded: THREE }),
      (e) =>
        e.message ===
        'package-lock.json has no "packages" map (lockfileVersion 1): the check reads lockfileVersion 2 or 3',
    );
    assert.throws(
      () => stateOf({ locked: JSON.stringify({ packages: [] }), recorded: THREE }),
      (e) => e.message.startsWith('package-lock.json has no "packages" map (no lockfileVersion): '),
    );
  });
});

describe("installDifferences", () => {
  test("gives each package that differs with what differs, the locked ones first, and none for a match", () => {
    const locked = { ...THREE, "node_modules/made-up-more": from("5.0.0") };
    const recorded = {
      ...THREE,
      "node_modules/made-up-dep": from("1.2.3"),
      "node_modules/made-up-extra": from("7.0.0"),
    };

    const always = () => true;

    assert.deepEqual(installDifferences(THREE, THREE, always), []);
    assert.deepEqual(installDifferences(locked, recorded, always), [
      { path: "node_modules/made-up-dep", what: "1.2.4 locked, 1.2.3 installed" },
      { path: "node_modules/made-up-more", what: "not installed" },
      { path: "node_modules/made-up-extra", what: "not in the lockfile" },
    ]);
  });

  test("asks only for the folders of packages that are recorded as the lockfile has them", () => {
    const asked = [];
    const recorded = {
      "node_modules/made-up-dep": from("1.2.3"),
      "node_modules/@made-up/scoped": THREE["node_modules/@made-up/scoped"],
    };

    installDifferences(THREE, recorded, (path) => asked.push(path) > 0);

    assert.deepEqual(asked, ["node_modules/@made-up/scoped"]);
  });
});
