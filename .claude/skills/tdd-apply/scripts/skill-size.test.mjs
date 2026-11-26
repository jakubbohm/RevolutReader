// The size limit of a SKILL.md. After a compaction Claude Code attaches a skill again as its first 5,000 tokens
// only, so a longer SKILL.md loses its end exactly when the session knows least. The limit here is 15,000
// characters: 3 characters a token, the cautious rate (to be checked against a real compaction).
//
// A SKILL.md puts first what must survive: the role, the rules, the commands, what to do after a compaction.
// Detail that only one situation needs may live in a second file in the skill's folder, which SKILL.md names with
// the situation that needs it. When this test fails, move such detail out; never raise the limit to make room.
//
// The characters are counted as git stores the file, with LF line breaks, so that a Windows working tree and
// Linux count the same. FILES lists the files checked, from the repository's root.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const LIMIT = 15_000;
const FILES = [".claude/skills/tdd-apply/SKILL.md", ".claude/skills/triage-review/SKILL.md"];

// The repository's root: this file lies four folders below it.
const ROOT = new URL("../../../../", import.meta.url);

// A text's size in characters, its line breaks counted as one each.
const characters = (text) => [...text.replace(/\r\n/g, "\n")].length;

describe("the size of a SKILL.md", () => {
  for (const file of FILES) {
    test(`${file} is at most ${LIMIT.toLocaleString("en-US")} characters`, () => {
      const size = characters(readFileSync(fileURLToPath(new URL(file, ROOT)), "utf8"));

      assert.ok(
        size <= LIMIT,
        `${file} is ${size} characters, ${size - LIMIT} over the ${LIMIT} that survive a compaction: ` +
          "move detail that only one situation needs into a second file of the skill",
      );
    });
  }

  test("counts a line break as one character whatever the file's line endings, and a letter outside ASCII as one", () => {
    assert.equal(characters("one\r\ntwo\r\n"), 8);
    assert.equal(characters("one\ntwo\n"), 8);
    assert.equal(characters("kůň — …"), 7);
    assert.equal(characters(""), 0);
  });
});
