// Tests for lock.mjs, for real: several processes that take the lock and write the same file at once, a stale
// lock, a lock that is never released, and readers during atomic writes. Each test has a folder of its own in the
// OS temp folder; the processes are Node running a small helper script written there, which imports lock.mjs. The
// wait limit and the stale age are set through TDD_LOCK_WAIT_MS and TDD_LOCK_STALE_MS, so no test waits 15 or 60
// seconds. (That every writing command of tdd.mjs takes the lock is tested in tdd.test.mjs.)
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { LOCK_FILE, readText, renameOver, withLock, writeAtomic } from "./lock.mjs";

// What a helper process does, by its first argument; the folder of the lock is its second.
const HELPER = `
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readText, withLock, writeAtomic } from ${JSON.stringify(new URL("./lock.mjs", import.meta.url).href)};

const [mode, folder, ...args] = process.argv.slice(2);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const until = (path) => {
  while (!existsSync(path)) sleep(10);
};
const modes = {
  // Adds 1 to the number in a file, so many times, each time under the lock.
  count([file, times]) {
    for (let i = 0; i < Number(times); i++) {
      withLock(folder, () => writeAtomic(file, String(Number(readFileSync(file, "utf8")) + 1)));
    }
  },
  // Takes the lock, says so by writing its process id to a file, and holds it until another file is there. With
  // a third file, it writes that one after it released the lock.
  hold([held, release, released]) {
    withLock(folder, () => {
      writeFileSync(held, String(process.pid));
      until(release);
    });
    if (released) writeFileSync(released, "released");
  },
  // Rewrites a file, so many times, as one character repeated to a length.
  rewrite([file, character, times, length]) {
    for (let i = 0; i < Number(times); i++) writeAtomic(file, character.repeat(Number(length)));
  },
  // Ends the process inside the lock, with an exit code.
  exit([code]) {
    withLock(folder, () => process.exit(Number(code)));
  },
  // Reads a file, so many times, and fails when a read is not one character repeated to the length.
  read([file, times, length]) {
    for (let i = 0; i < Number(times); i++) {
      const text = readText(file);
      if (text.length !== Number(length) || text !== text[0].repeat(text.length)) {
        throw new Error("read a half-written file: " + text.length + " characters");
      }
    }
  },
};
try {
  modes[mode](args);
} catch (e) {
  process.stderr.write(e.message + "\\n");
  process.exitCode = 1;
}
`;

// A folder of its own in the OS temp folder, with the helper script in it, removed when the test ends.
function tempFolder(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "tdd-lock-test-")));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  writeFileSync(join(dir, "helper.mjs"), HELPER);
  mkdirSync(join(dir, "lock"));
  return dir;
}

// Starts a helper process in the test's folder, taking the lock in its `lock` folder; `done` answers its exit
// code and what it printed, and the process is ended with the test at the latest.
function helper(t, dir, mode, args, env = {}) {
  const child = spawn(process.execPath, [join(dir, "helper.mjs"), mode, join(dir, "lock"), ...args], {
    env: { ...process.env, TDD_LOCK_WAIT_MS: "", TDD_LOCK_STALE_MS: "", ...env },
    windowsHide: true,
  });
  t.after(() => child.kill("SIGKILL"));
  const printed = { out: [], err: [] };
  child.stdout.on("data", (chunk) => printed.out.push(chunk));
  child.stderr.on("data", (chunk) => printed.err.push(chunk));
  const done = new Promise((ended, failed) => {
    child.once("error", failed);
    child.once("close", (code, signal) => {
      ended({ code, signal, out: Buffer.concat(printed.out).toString(), err: Buffer.concat(printed.err).toString() });
    });
  });
  return { child, done };
}

// Waits until the file is there, and fails when it is not within 20 seconds.
async function appears(path) {
  const until = Date.now() + 20_000;
  while (!existsSync(path)) {
    assert.ok(Date.now() < until, `${path} did not appear`);
    await new Promise((wait) => setTimeout(wait, 20));
  }
}

const lockOf = (dir) => join(dir, "lock", LOCK_FILE);
// A lock file as a command that took it so long ago would have left it.
const leftLock = (dir, pid, agoMs) =>
  writeFileSync(lockOf(dir), JSON.stringify({ pid, time: new Date(Date.now() - agoMs).toISOString() }));

describe("withLock", { concurrency: true }, () => {
  test("holds the lock file while the work runs, answers what the work answers, and releases it", (t) => {
    const dir = tempFolder(t);

    const answer = withLock(join(dir, "lock"), () => {
      const held = JSON.parse(readFileSync(lockOf(dir), "utf8"));
      assert.equal(held.pid, process.pid);
      assert.ok(Math.abs(Date.now() - Date.parse(held.time)) < 5000, held.time);
      return "the work's answer";
    });

    assert.equal(answer, "the work's answer");
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
  });

  test("creates the lock's folder when it is not there", (t) => {
    const dir = tempFolder(t);
    const folder = join(dir, "not", "there", "yet");

    assert.equal(
      withLock(folder, () => existsSync(join(folder, LOCK_FILE))),
      true,
    );
  });

  test("releases the lock when the work throws, and hands the error on", (t) => {
    const dir = tempFolder(t);

    assert.throws(
      () =>
        withLock(join(dir, "lock"), () => {
          throw new Error("a made-up failure");
        }),
      /a made-up failure/,
    );
    assert.equal(existsSync(lockOf(dir)), false);
  });

  test("loses no update when several processes change the same file at once", async (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "count.txt");
    writeFileSync(file, "0");

    const ended = await Promise.all([1, 2, 3, 4, 5, 6].map(() => helper(t, dir, "count", [file, "25"]).done));

    for (const r of ended) assert.equal(r.code, 0, r.err);
    assert.equal(readFileSync(file, "utf8"), "150");
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
    assert.deepEqual(readdirSync(dir).sort(), ["count.txt", "helper.mjs", "lock"]);
  });

  test("waits for a lock that is held and takes it when it is released", async (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "count.txt");
    writeFileSync(file, "0");
    const holder = helper(t, dir, "hold", [join(dir, "held"), join(dir, "release")]);
    await appears(join(dir, "held"));

    const waiter = helper(t, dir, "count", [file, "1"]);
    await new Promise((wait) => setTimeout(wait, 300));
    assert.equal(readFileSync(file, "utf8"), "0", "the waiter waits while the lock is held");
    writeFileSync(join(dir, "release"), "");

    assert.equal((await waiter.done).code, 0);
    assert.equal((await holder.done).code, 0);
    assert.equal(readFileSync(file, "utf8"), "1");
    assert.equal(existsSync(lockOf(dir)), false);
  });

  test("is refused in one line when the lock is not released within the wait limit", async (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "count.txt");
    writeFileSync(file, "0");
    const holder = helper(t, dir, "hold", [join(dir, "held"), join(dir, "release")]);
    await appears(join(dir, "held"));
    const started = Date.now();

    const r = await helper(t, dir, "count", [file, "1"], { TDD_LOCK_WAIT_MS: "300" }).done;

    assert.equal(r.code, 1);
    assert.ok(Date.now() - started >= 300, "it waited the limit");
    assert.match(r.err, new RegExp(`^the state files are locked by process ${holder.child.pid}, .*run it again`));
    assert.equal(r.err.trim().split("\n").length, 1, r.err);
    assert.equal(readFileSync(file, "utf8"), "0");
    assert.equal(JSON.parse(readFileSync(lockOf(dir), "utf8")).pid, holder.child.pid, "the holder's lock stands");
  });

  test("takes over a stale lock, one older than a minute, without waiting", (t) => {
    const dir = tempFolder(t);
    leftLock(dir, 4242, 61_000);

    // A wait limit of one millisecond: had it waited for the lock, it would have been refused.
    const answer = withLock(join(dir, "lock"), () => JSON.parse(readFileSync(lockOf(dir), "utf8")).pid, {
      env: { TDD_LOCK_WAIT_MS: "1" },
    });

    assert.equal(answer, process.pid);
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
  });

  test("does not take over a lock that is younger than a minute", (t) => {
    const dir = tempFolder(t);
    leftLock(dir, 4242, 50_000);

    assert.throws(
      () => withLock(join(dir, "lock"), () => "taken", { env: { TDD_LOCK_WAIT_MS: "200" } }),
      /locked by process 4242, its lock 5\d(\.\d)? s old, and stayed locked for the 0\.2 s this command waited/,
    );
    assert.equal(JSON.parse(readFileSync(lockOf(dir), "utf8")).pid, 4242);
  });

  test("takes the stale age from TDD_LOCK_STALE_MS", (t) => {
    const dir = tempFolder(t);
    leftLock(dir, 4242, 2_000);

    const answer = withLock(join(dir, "lock"), () => "taken", {
      env: { TDD_LOCK_WAIT_MS: "200", TDD_LOCK_STALE_MS: "1000" },
    });

    assert.equal(answer, "taken");
  });

  test("goes by the file's own time for a lock whose text it cannot read", (t) => {
    const dir = tempFolder(t);
    const env = { TDD_LOCK_WAIT_MS: "200" };
    writeFileSync(lockOf(dir), "");

    assert.throws(() => withLock(join(dir, "lock"), () => "taken", { env }), /locked by another command/);

    const longAgo = new Date(Date.now() - 120_000);
    utimesSync(lockOf(dir), longAgo, longAgo);
    assert.equal(
      withLock(join(dir, "lock"), () => "taken", { env }),
      "taken",
    );
  });

  test("keeps its defaults for a setting that is no number above 0", (t) => {
    const dir = tempFolder(t);
    leftLock(dir, 4242, 61_000);

    const answer = withLock(join(dir, "lock"), () => "taken", {
      env: { TDD_LOCK_WAIT_MS: "soon", TDD_LOCK_STALE_MS: "-5" },
    });

    assert.equal(answer, "taken");
  });

  test("leaves the lock alone at its release when another command took it over as stale meanwhile", async (t) => {
    const dir = tempFolder(t);
    const slow = helper(t, dir, "hold", [join(dir, "slow-held"), join(dir, "slow-release"), join(dir, "slow-done")]);
    await appears(join(dir, "slow-held"));
    // The second command finds the first one's lock stale after 100 ms, takes it over and holds it.
    const second = helper(t, dir, "hold", [join(dir, "second-held"), join(dir, "second-release")], {
      TDD_LOCK_STALE_MS: "100",
    });
    await appears(join(dir, "second-held"));

    writeFileSync(join(dir, "slow-release"), "");
    await appears(join(dir, "slow-done"));

    assert.equal(JSON.parse(readFileSync(lockOf(dir), "utf8")).pid, second.child.pid, "the second's lock stands");
    writeFileSync(join(dir, "second-release"), "");
    assert.equal((await second.done).code, 0);
    assert.equal((await slow.done).code, 0);
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
  });

  test("releases the lock when the work ends the process", async (t) => {
    const dir = tempFolder(t);

    const r = await helper(t, dir, "exit", ["7"]).done;

    assert.equal(r.code, 7);
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
  });

  test("a command ended from outside leaves its lock, which the next one takes over once it is stale", async (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "count.txt");
    writeFileSync(file, "0");
    const holder = helper(t, dir, "hold", [join(dir, "held"), join(dir, "release")]);
    await appears(join(dir, "held"));

    holder.child.kill("SIGKILL");
    await holder.done;
    assert.equal(JSON.parse(readFileSync(lockOf(dir), "utf8")).pid, holder.child.pid, "its lock is left");
    const next = await helper(t, dir, "count", [file, "1"], { TDD_LOCK_STALE_MS: "150" }).done;

    assert.equal(next.code, 0, next.err);
    assert.equal(readFileSync(file, "utf8"), "1");
    assert.deepEqual(readdirSync(join(dir, "lock")), []);
  });
});

describe("writeAtomic", { concurrency: true }, () => {
  test("writes a new file and replaces one that is there, leaving nothing else in the folder", (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "lock", "state.md");

    writeAtomic(file, "first\n");
    assert.equal(readFileSync(file, "utf8"), "first\n");
    writeAtomic(file, "second, with letters outside ASCII: žluťoučký — …\r\n");

    assert.equal(readFileSync(file, "utf8"), "second, with letters outside ASCII: žluťoučký — …\r\n");
    assert.deepEqual(readdirSync(join(dir, "lock")), ["state.md"]);
  });

  test("leaves the target and the folder as they were when the write fails", (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "lock", "state.md");
    writeAtomic(file, "as it was\n");
    const refused = Object.assign(new Error("a made-up refusal"), { code: "EIO" });

    assert.throws(
      () =>
        writeAtomic(file, "never written\n", {
          rename: () => {
            throw refused;
          },
        }),
      /a made-up refusal/,
    );
    assert.equal(readFileSync(file, "utf8"), "as it was\n");
    assert.deepEqual(readdirSync(join(dir, "lock")), ["state.md"]);
    assert.throws(() => writeAtomic(join(dir, "no-such-folder", "state.md"), "x"), { code: "ENOENT" });
  });

  test("never shows a reader half a file, whoever writes meanwhile", async (t) => {
    const dir = tempFolder(t);
    const file = join(dir, "big.txt");
    const length = 300_000;
    writeFileSync(file, "a".repeat(length));

    const ended = await Promise.all([
      helper(t, dir, "rewrite", [file, "b", "60", String(length)]).done,
      helper(t, dir, "rewrite", [file, "c", "60", String(length)]).done,
      ...[1, 2, 3].map(() => helper(t, dir, "read", [file, "150", String(length)]).done),
    ]);

    for (const r of ended) assert.equal(r.code, 0, r.err);
    assert.match(readFileSync(file, "utf8"), /^(b+|c+)$/);
    assert.deepEqual(readdirSync(dir).sort(), ["big.txt", "helper.mjs", "lock"]);
  });
});

describe("a file that is busy", () => {
  // Windows refuses a rename over a file another process holds open, and a read during such a rename, with one of
  // these codes; the stand-ins below refuse so many times and then let the real call through.
  const busy = (code) => Object.assign(new Error(`${code}: a made-up refusal`), { code });
  const refusing = (times, code, real) => {
    const calls = { count: 0 };
    const call = (...args) => {
      calls.count++;
      if (calls.count <= times) throw busy(code);
      return real(...args);
    };
    return { call, calls };
  };

  test("on Windows, a rename that is refused as busy is tried again until it goes through", () => {
    for (const code of ["EPERM", "EACCES", "EBUSY"]) {
      const renamed = [];
      const rename = refusing(3, code, (from, to) => renamed.push([from, to]));

      renameOver("a.tmp", "a.md", { rename: rename.call, platform: "win32" });

      assert.equal(rename.calls.count, 4, code);
      assert.deepEqual(renamed, [["a.tmp", "a.md"]]);
    }
  });

  test("on Windows, the trying ends after a short while, with the refusal itself", () => {
    const rename = refusing(Infinity, "EPERM", () => {});

    assert.throws(() => renameOver("a.tmp", "a.md", { rename: rename.call, platform: "win32", patience: 120 }), {
      code: "EPERM",
    });
    assert.ok(rename.calls.count > 2, `${rename.calls.count} tries`);
  });

  test("another refusal is final at once, and so is every refusal on another system", () => {
    const missing = refusing(Infinity, "ENOENT", () => {});
    const elsewhere = refusing(Infinity, "EPERM", () => {});

    assert.throws(() => renameOver("a.tmp", "a.md", { rename: missing.call, platform: "win32" }), { code: "ENOENT" });
    assert.throws(() => renameOver("a.tmp", "a.md", { rename: elsewhere.call, platform: "linux" }), { code: "EPERM" });
    assert.equal(missing.calls.count, 1);
    assert.equal(elsewhere.calls.count, 1);
  });

  test("on Windows, a read that is refused as busy is tried again; a file that is not there is not", () => {
    const read = refusing(2, "EBUSY", () => "the text");
    const missing = refusing(Infinity, "ENOENT", () => "");

    assert.equal(readText("a.md", { read: read.call, platform: "win32" }), "the text");
    assert.equal(read.calls.count, 3);
    assert.throws(() => readText("a.md", { read: missing.call, platform: "win32" }), { code: "ENOENT" });
    assert.equal(missing.calls.count, 1);
  });

  test("reads a real file's text", (t) => {
    const dir = tempFolder(t);

    assert.equal(readText(join(dir, "helper.mjs")), HELPER);
    assert.throws(() => readText(join(dir, "not-there.md")), { code: "ENOENT" });
  });
});
