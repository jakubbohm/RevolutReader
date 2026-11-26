// Tests for triage.mjs's pure functions: a PR's id, the pointer's text and its reading, the name of the state file
// of a PR without a change, and the folders of an archived change. Texts and names in, texts and objects out: nothing here touches a file or git, and every name
// and path is made up. (That `tdd.mjs triage-init` writes the pointer and the other commands go by it is tested
// in tdd.test.mjs; that the hook reads it, in .claude/hooks/tdd-resume.test.mjs.)
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { archivedAs, POINTER_FILE, pointerText, prId, prStateFile, readPointer } from "./triage.mjs";

const pointer = (more = {}) => ({
  pr: "109",
  round: 2,
  change: "c900-add-made-up-thing",
  scope: "c900",
  work: "/made/up/scratchpad/triage-review/109-r2",
  state: "/made/up/repo/openspec/changes/c900-add-made-up-thing/.review-triage.md",
  ...more,
});

describe("prId", () => {
  test("is the PR's number, with or without its #, and the spaces around it dropped", () => {
    assert.equal(prId("109"), "109");
    assert.equal(prId("#109"), "109");
    assert.equal(prId(" 109 "), "109");
  });

  test("is any token of letters, digits and dashes, for a trial without a PR", () => {
    assert.equal(prId("local"), "local");
    assert.equal(prId("trial-2"), "trial-2");
    assert.equal(prId("C018-Replay"), "C018-Replay");
  });

  test("refuses anything else: nothing, a path, spaces inside, a dash at an end", () => {
    for (const given of [undefined, "", " ", "#", "a b", "../109", "109/2", "pr_109", "-109", "109-", "a--b", "1.5"]) {
      assert.throws(() => prId(given), /--pr is the PR's number/, String(given));
    }
  });
});

describe("pointerText and readPointer", () => {
  test("is called triage.json", () => {
    assert.equal(POINTER_FILE, "triage.json");
  });

  test("has next to it the state file of a PR without a change, named after the PR's id", () => {
    assert.equal(prStateFile("109"), "triage-109.md");
    assert.equal(prStateFile("local"), "triage-local.md");
    assert.notEqual(prStateFile(prId("json")), POINTER_FILE, "no id makes it the pointer's own name");
  });

  test("hold the PR, the round, the change, the scope, the work folder and the state file, and nothing else", () => {
    const text = pointerText({ ...pointer(), more: "not kept" });

    assert.deepEqual(Object.keys(JSON.parse(text)), ["pr", "round", "change", "scope", "work", "state"]);
    assert.deepEqual(readPointer(text), pointer());
    assert.ok(text.endsWith("}\n"));
  });

  test("hold null for a PR without a change, also when none is given", () => {
    const { change, ...without } = pointer();

    assert.equal(change, "c900-add-made-up-thing");
    assert.equal(JSON.parse(pointerText(without)).change, null);
    assert.deepEqual(readPointer(pointerText(pointer({ change: null }))), pointer({ change: null }));
  });

  test("keep a Windows path as it is", () => {
    const state = "C:\\made up\\work\\109\\state.md";

    assert.equal(readPointer(pointerText(pointer({ state }))).state, state);
  });

  test("reading refuses a text that is no JSON, in one line", () => {
    for (const text of ["", "not json", '{ "pr": "109"']) {
      assert.throws(
        () => readPointer(text),
        (e) => /^the triage's pointer is not JSON: /.test(e.message) && !e.message.includes("\n"),
        text,
      );
    }
  });

  test("reading refuses a pointer that lacks a field or holds one of the wrong kind", () => {
    const wrong = [
      "null",
      "[]",
      '"109"',
      JSON.stringify({ pr: "109" }),
      ...["pr", "round", "change", "scope", "work", "state"].map((field) => {
        const { [field]: _, ...rest } = pointer();
        return JSON.stringify(rest);
      }),
      JSON.stringify(pointer({ pr: 109 })),
      JSON.stringify(pointer({ round: "2" })),
      JSON.stringify(pointer({ round: 1.5 })),
      JSON.stringify(pointer({ change: "" })),
      JSON.stringify(pointer({ scope: "" })),
      JSON.stringify(pointer({ state: null })),
    ];

    for (const text of wrong) assert.throws(() => readPointer(text), /the triage's pointer lacks a field/, text);
  });
});

describe("archivedAs", () => {
  const names = [
    "2026-11-22-c017-add-daily-koruna-rate",
    "2026-11-23-c900-add-made-up-thing",
    "2026-11-24-c900-add-made-up-thing-too",
    "2026-11-25-also-c900-add-made-up-thing",
    "c900-add-made-up-thing",
    "notes-c900-add-made-up-thing",
  ];

  test("gives the folder that is the change's name after the day it was archived", () => {
    assert.deepEqual(archivedAs(names, "c900-add-made-up-thing"), ["2026-11-23-c900-add-made-up-thing"]);
    assert.deepEqual(archivedAs(names, "c017-add-daily-koruna-rate"), ["2026-11-22-c017-add-daily-koruna-rate"]);
  });

  test("gives none for a change that is not there, and for a name that only ends or starts the same", () => {
    assert.deepEqual(archivedAs(names, "c901-not-there"), []);
    assert.deepEqual(archivedAs(names, "add-made-up-thing"), []);
    assert.deepEqual(archivedAs(names, "c900-add-made-up"), []);
    assert.deepEqual(archivedAs([], "c900-add-made-up-thing"), []);
  });

  test("gives every folder of a change archived on two days", () => {
    const twice = [...names, "2026-12-01-c900-add-made-up-thing"];

    assert.deepEqual(archivedAs(twice, "c900-add-made-up-thing"), [
      "2026-11-23-c900-add-made-up-thing",
      "2026-12-01-c900-add-made-up-thing",
    ]);
  });
});
