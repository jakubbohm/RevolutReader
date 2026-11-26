// The lock and the atomic writes of tdd.mjs. The main session records the owner's answer while a runner and its
// agents write the same state file: without both, one command's change is lost when two read the file, change it
// and write it back at the same time, and a reader can see half a file.
//
// - The lock: one per working tree, the file `state.lock` in the folder given (tdd.mjs gives `<git folder>/tdd`,
//   never tracked and never in the working tree). It is created exclusively and holds its owner's process id and
//   the time. A command that finds it waits in short sleeps, up to 15 seconds, and is then refused in one line. A
//   lock older than 60 seconds is stale, left by a command that was killed: it is removed and taken.
// - The lock is released when the work returns or throws, and when the process ends itself inside it. A process
//   that is ended from outside (a signal, a kill, Windows ending it) leaves its lock, which then goes stale. No
//   signal is held back to prevent that: the work may be waiting for git, and must stay stoppable.
// - A write is atomic: the text goes to a temporary file in the target's folder, which is then renamed over the
//   target. A reader, who takes no lock, sees the old file or the new one, never a half.
// - On Windows a rename over a file that another process holds open is refused for that moment, and so is a read
//   during such a rename: both are tried again for a short while.
// - TDD_LOCK_WAIT_MS and TDD_LOCK_STALE_MS set the wait limit and the stale age in milliseconds: for the tests
//   only, which cannot wait 15 or 60 seconds.
import { randomBytes } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

export const LOCK_FILE = "state.lock";
const WAIT_MS = 15_000;
const STALE_MS = 60_000;
const RETRY_MS = 2_000; // how long a rename or a read that Windows refuses is tried again

// The codes Windows answers while another process holds the file open or is replacing it.
const BUSY = ["EPERM", "EACCES", "EBUSY"];

// Waits without giving the turn to anything else: every caller here is in the middle of a synchronous command.
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// A setting in milliseconds from the environment, or its default when it is not a number above 0.
function milliseconds(env, name, byDefault) {
  const given = Number(env[name]);
  return env[name] !== undefined && env[name] !== "" && Number.isFinite(given) && given > 0 ? given : byDefault;
}

// A time span for a message: seconds, to a tenth.
const seconds = (ms) => `${Math.round(ms / 100) / 10} s`;

// Runs `action` and, on Windows, tries it again for a short while (`patience`, in milliseconds) when the file is
// busy; elsewhere a refusal is final at once.
function patiently(action, { platform = process.platform, patience = RETRY_MS } = {}) {
  const until = Date.now() + patience;
  for (;;) {
    try {
      return action();
    } catch (e) {
      if (platform !== "win32" || !BUSY.includes(e.code) || Date.now() >= until) throw e;
      sleep(25);
    }
  }
}

// A file's text. A reader takes no lock: on Windows it may arrive while a writer renames the new file over the
// old one, and then tries again. `how.read` stands in for the real read in a test.
export function readText(path, { read = readFileSync, ...how } = {}) {
  return patiently(() => read(path, "utf8"), how);
}

// Renames `from` over `to`; `how.rename` stands in for the real rename in a test.
export function renameOver(from, to, { rename = renameSync, ...how } = {}) {
  patiently(() => rename(from, to), how);
}

// Writes the text to the file so that a reader never sees a half: to a temporary file next to it, flushed to the
// disk, then renamed over it. The temporary file is removed when anything fails.
export function writeAtomic(path, text, how) {
  const temporary = join(dirname(path), `${basename(path)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    const fd = openSync(temporary, "wx");
    try {
      writeSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameOver(temporary, path, how);
  } catch (e) {
    rmSync(temporary, { force: true });
    throw e;
  }
}

// What the lock file holds: its owner's process id and the time it was taken. The text is also the lock's
// identity: a command releases only the lock that holds its own text.
const lockText = () => JSON.stringify({ pid: process.pid, time: new Date().toISOString() });

// The lock as it stands: its text, its owner's process id and its age in milliseconds; null when it is gone. A
// lock whose text cannot be read (its owner is between creating and writing it) is as old as the file.
function heldLock(path) {
  try {
    const text = readFileSync(path, "utf8");
    let held = {};
    try {
      held = JSON.parse(text) ?? {};
    } catch {
      // not written yet, or not a lock of ours: the file's own time decides
    }
    const since = Date.parse(held.time);
    return { text, pid: held.pid, age: Date.now() - (Number.isNaN(since) ? statSync(path).mtimeMs : since) };
  } catch {
    return null;
  }
}

// Removes a stale lock. Two commands may find the same stale lock: the rename hands it to exactly one of them, and
// a command that got a fresh lock instead (another command took over between its look and its rename) puts that
// lock back as it was. The instant between that rename and the putting back is the one gap left: a third command
// arriving in it would hold the lock next to the fresh one's owner.
function removeStale(path, stale) {
  const aside = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.stale`;
  try {
    renameSync(path, aside);
  } catch {
    return; // gone already: released, or taken over by another command
  }
  try {
    const text = readFileSync(aside, "utf8");
    if (text !== stale.text) writeFileSync(path, text, { flag: "wx" });
  } catch {
    // a newer lock stands there already; nothing to put back
  } finally {
    rmSync(aside, { force: true });
  }
}

// Takes the lock in the folder, waiting for it as the header says, and answers the function that releases it.
function takeLock(folder, env) {
  const wait = milliseconds(env, "TDD_LOCK_WAIT_MS", WAIT_MS);
  const staleAfter = milliseconds(env, "TDD_LOCK_STALE_MS", STALE_MS);
  mkdirSync(folder, { recursive: true });
  const path = join(folder, LOCK_FILE);
  const until = Date.now() + wait;
  for (;;) {
    const mine = lockText();
    try {
      writeFileSync(path, mine, { flag: "wx" });
      return () => {
        try {
          if (readFileSync(path, "utf8") === mine) rmSync(path, { force: true });
        } catch {
          // gone already: taken over as stale
        }
      };
    } catch (e) {
      // EEXIST: another command holds it. On Windows a lock that is just being removed answers as busy instead.
      if (e.code !== "EEXIST" && !(process.platform === "win32" && BUSY.includes(e.code))) throw e;
    }
    const held = heldLock(path);
    if (held !== null && held.age > staleAfter) {
      removeStale(path, held);
      continue;
    }
    if (Date.now() >= until) {
      const owner = typeof held?.pid === "number" ? `process ${held.pid}` : "another command";
      const age = held === null ? "" : `, its lock ${seconds(held.age)} old`;
      throw new Error(
        `the state files are locked by ${owner}${age}, and stayed locked for the ${seconds(wait)} this command ` +
          `waited; run it again (the lock: ${path})`,
      );
    }
    sleep(20 + Math.floor(Math.random() * 40));
  }
}

// Runs `work` while holding the folder's lock and answers what it answers. `work` is synchronous: it reads,
// changes and writes, and the lock is released when it returns or throws, and when it ends the process.
export function withLock(folder, work, { env = process.env } = {}) {
  const release = takeLock(folder, env);
  process.once("exit", release);
  try {
    return work();
  } finally {
    release();
    process.off("exit", release);
  }
}
