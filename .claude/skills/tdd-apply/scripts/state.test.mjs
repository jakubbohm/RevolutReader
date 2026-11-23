// Tests for state.mjs's pure functions: how a state file's text is read and changed by section (the body of a
// section, replacing it, appending a bullet, a keyed bullet's value), what a new state file and a new reviews file
// hold, and that an edit keeps the file's own line endings and every other line as it was. Texts in, texts out:
// nothing here touches a file, git or the code graph, and every change name and value is made up.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addBullet,
  EMPTY,
  keyValue,
  newReviewsText,
  newStateText,
  putKey,
  sectionBody,
  sectionName,
  sectionNames,
  setSection,
  STATE_SECTIONS,
} from "./state.mjs";

// A small state file of three sections, with the line endings a test asks for.
const sample = (eol = "\n") =>
  [
    "# .tdd-state: c900-add-made-up-thing",
    "",
    "## Resume here",
    "",
    "Chapter A, group 2.",
    "",
    "## Run",
    "",
    "- **Status:** applying",
    "- **Review mode:** acceptance",
    "",
    "## Open",
    "",
    EMPTY,
    "",
  ].join(eol);

describe("newStateText", () => {
  test("holds the title, then every section in order, each empty but Run", () => {
    const text = newStateText("c900-add-made-up-thing", [["Status", "applying"]], "\n");

    assert.equal(text.split("\n")[0], "# .tdd-state: c900-add-made-up-thing");
    assert.deepEqual(sectionNames(text), [
      "Resume here",
      "Run",
      "Chapter plan",
      "Agents",
      "Standing rules",
      "What the code holds now",
      "Baseline",
      "Acceptance tests",
      "Open",
      "Design files",
    ]);
    assert.deepEqual(sectionNames(text), STATE_SECTIONS);
    for (const name of STATE_SECTIONS.filter((n) => n !== "Run")) assert.equal(sectionBody(text, name), EMPTY);
    assert.equal(sectionBody(text, "Run"), "- **Status:** applying");
  });

  test("writes Run's keyed bullets in the order given", () => {
    const text = newStateText(
      "c900-add-made-up-thing",
      [
        ["Status", "applying"],
        ["Started", "2026-11-23"],
        ["Issue", "#67"],
      ],
      "\n",
    );

    assert.equal(sectionBody(text, "Run"), "- **Status:** applying\n- **Started:** 2026-11-23\n- **Issue:** #67");
  });

  test("uses the line endings it is given, and ends with one", () => {
    const crlf = newStateText("c900-add-made-up-thing", [["Status", "applying"]], "\r\n");
    const lf = newStateText("c900-add-made-up-thing", [["Status", "applying"]], "\n");

    assert.equal(crlf.replace(/\r\n/g, "\n"), lf);
    assert.equal(/(?<!\r)\n/.test(crlf), false, "no bare LF in the CRLF text");
    assert.ok(crlf.endsWith(`${EMPTY}\r\n`) && !crlf.endsWith("\r\n\r\n"));
    assert.ok(lf.endsWith(`${EMPTY}\n`) && !lf.endsWith("\n\n"));
  });
});

describe("newReviewsText", () => {
  test("holds the title and no section yet", () => {
    const text = newReviewsText("c900-add-made-up-thing", "\r\n");

    assert.equal(text, "# Chapter reviews: c900-add-made-up-thing\r\n");
    assert.deepEqual(sectionNames(text), []);
  });
});

describe("sectionBody", () => {
  test("gives a section's lines without the blank lines around them", () => {
    assert.equal(sectionBody(sample(), "Run"), "- **Status:** applying\n- **Review mode:** acceptance");
    assert.equal(sectionBody(sample(), "Resume here"), "Chapter A, group 2.");
  });

  test("gives the last section's body, also without a final line ending", () => {
    assert.equal(sectionBody(sample(), "Open"), EMPTY);
    assert.equal(sectionBody(sample().trimEnd(), "Open"), EMPTY);
  });

  test("gives LF line breaks for a CRLF file", () => {
    assert.equal(sectionBody(sample("\r\n"), "Run"), "- **Status:** applying\n- **Review mode:** acceptance");
  });

  test("keeps the blank lines and sub-headings inside a body", () => {
    const text = "# t\n\n## Agents\n\n### Chapter A\n\n- test-writer: a1\n\n### Chapter B\n\n- implementer: b2\n";

    assert.equal(
      sectionBody(text, "Agents"),
      "### Chapter A\n\n- test-writer: a1\n\n### Chapter B\n\n- implementer: b2",
    );
  });

  test("finds a section whatever the case of its name and the spaces around it", () => {
    assert.equal(sectionBody(sample(), "resume HERE"), "Chapter A, group 2.");
    assert.equal(sectionBody(sample(), "  Run "), "- **Status:** applying\n- **Review mode:** acceptance");
  });

  test("gives null for a section the file does not have", () => {
    assert.equal(sectionBody(sample(), "Agents"), null);
  });
});

describe("sectionName", () => {
  test("gives the name as the file has it, and null for a section it does not have", () => {
    assert.equal(sectionName(sample(), " resume HERE"), "Resume here");
    assert.equal(sectionName(sample(), "Agents"), null);
  });
});

describe("sectionNames", () => {
  test("gives none for a text without a section", () => {
    assert.deepEqual(sectionNames("# only a title\n\nand a paragraph\n"), []);
    assert.deepEqual(sectionNames(""), []);
  });

  test("does not take a `## ` line inside a code fence for a heading", () => {
    const text = "# t\n\n## Open\n\n```md\n## Not a section\n```\n\nafter the fence\n\n## Run\n\n—\n";

    assert.deepEqual(sectionNames(text), ["Open", "Run"]);
    assert.equal(sectionBody(text, "Open"), "```md\n## Not a section\n```\n\nafter the fence");
  });

  test("ends a code fence only at a closing fence: the same character, as long, and nothing after it", () => {
    const text = [
      "# t",
      "",
      "## Open",
      "",
      "````md",
      "```",
      "## Still inside: a shorter fence closes nothing",
      "````js",
      "## Still inside: a fence with a language after it closes nothing",
      "~~~~",
      "## Still inside: another character closes nothing",
      "````",
      "",
      "## Run",
      "",
      "—",
      "",
    ].join("\n");

    assert.deepEqual(sectionNames(text), ["Open", "Run"]);
  });
});

describe("setSection", () => {
  test("replaces the body and leaves every other line as it was", () => {
    const text = setSection(sample(), "Resume here", "Chapter B, group 7.\nThe last commit is [green].");

    assert.equal(sectionBody(text, "Resume here"), "Chapter B, group 7.\nThe last commit is [green].");
    assert.equal(text, sample().replace("Chapter A, group 2.", "Chapter B, group 7.\nThe last commit is [green]."));
  });

  test("keeps a CRLF file CRLF, the new body's lines included", () => {
    const text = setSection(sample("\r\n"), "Resume here", "first\nsecond");

    assert.equal(/(?<!\r)\n/.test(text), false, "no bare LF");
    assert.equal(text, sample("\r\n").replace("Chapter A, group 2.", "first\r\nsecond"));
  });

  test("keeps an LF file LF when the new body comes with CRLF", () => {
    const text = setSection(sample(), "Resume here", "first\r\nsecond");

    assert.equal(text.includes("\r"), false);
    assert.equal(sectionBody(text, "Resume here"), "first\nsecond");
  });

  test("replaces the last section's body and keeps the file's final line ending as it was", () => {
    assert.equal(setSection(sample(), "Open", "- a dispute"), sample().replace(EMPTY, "- a dispute"));
    assert.equal(
      setSection(sample().trimEnd(), "Open", "- a dispute"),
      sample().trimEnd().replace(EMPTY, "- a dispute"),
    );
  });

  test("writes the placeholder for an empty body", () => {
    assert.equal(sectionBody(setSection(sample(), "Resume here", ""), "Resume here"), EMPTY);
    assert.equal(sectionBody(setSection(sample(), "Resume here", " \n\n"), "Resume here"), EMPTY);
  });

  test("drops the blank lines around the new body, and keeps those inside it", () => {
    const text = setSection(sample(), "Resume here", "\n\nfirst\n\nsecond\n\n");

    assert.equal(sectionBody(text, "Resume here"), "first\n\nsecond");
    assert.equal(text, sample().replace("Chapter A, group 2.", "first\n\nsecond"));
  });

  test("refuses a section the file does not have, naming those it has", () => {
    assert.throws(() => setSection(sample(), "Agents", "x"), /Agents.*Resume here, Run, Open/s);
  });

  test("with `create`, appends a missing section at the end", () => {
    const text = setSection(sample(), "Chapter A", "Reviewed: no findings.", { create: true });

    assert.deepEqual(sectionNames(text), ["Resume here", "Run", "Open", "Chapter A"]);
    assert.equal(text, `${sample()}\n## Chapter A\n\nReviewed: no findings.\n`);
  });

  test("with `create`, appends the first section to a file that holds only its title, in the file's line endings", () => {
    const text = setSection(newReviewsText("c900-add-made-up-thing", "\r\n"), "Chapter A", "one\ntwo", {
      create: true,
    });

    assert.equal(text, "# Chapter reviews: c900-add-made-up-thing\r\n\r\n## Chapter A\r\n\r\none\r\ntwo\r\n");
  });

  test("with `create`, still replaces a section the file has", () => {
    const text = setSection(sample(), "open", "- a dispute", { create: true });

    assert.deepEqual(sectionNames(text), ["Resume here", "Run", "Open"]);
    assert.equal(sectionBody(text, "Open"), "- a dispute");
  });

  test("refuses a body with a `## ` line, which would start a new section", () => {
    assert.throws(() => setSection(sample(), "Open", "before\n## Sneaky\nafter"), /## /);
  });

  test("takes a body whose `## ` line is inside a code fence, and sub-headings", () => {
    const body = "### Detail\n\n```\n## inside a fence\n```";

    const text = setSection(sample(), "Open", body);

    assert.equal(sectionBody(text, "Open"), body);
    assert.deepEqual(sectionNames(text), ["Resume here", "Run", "Open"]);
  });

  test("refuses a body that leaves a code fence open, which would swallow the sections after it", () => {
    assert.throws(() => setSection(sample(), "Resume here", "```\nnever closed"), /fence/);
  });

  test("with `create`, gives a text without any line its first section, with no blank line before it", () => {
    assert.equal(setSection("", "Chapter A", "one", { create: true }), "## Chapter A\n\none");
  });
});

describe("addBullet", () => {
  test("replaces the placeholder with the bullet", () => {
    const text = addBullet(sample(), "Open", "a dispute about the error model");

    assert.equal(sectionBody(text, "Open"), "- a dispute about the error model");
    assert.equal(text, sample().replace(EMPTY, "- a dispute about the error model"));
  });

  test("appends after the lines the section already has", () => {
    const text = addBullet(sample(), "Run", "a note");

    assert.equal(sectionBody(text, "Run"), "- **Status:** applying\n- **Review mode:** acceptance\n- a note");
  });

  test("keeps a bullet of several lines one list item, its later lines indented", () => {
    const text = addBullet(sample(), "Open", "a dispute\nits resolution");

    assert.equal(sectionBody(text, "Open"), "- a dispute\n  its resolution");
  });

  test("keeps a CRLF file CRLF", () => {
    const text = addBullet(sample("\r\n"), "Open", "one\ntwo");

    assert.equal(text, sample("\r\n").replace(EMPTY, "- one\r\n  two"));
  });

  test("refuses a missing section, and with `create` appends it", () => {
    assert.throws(() => addBullet(sample(), "Chapter A", "x"), /Chapter A/);

    const text = addBullet(sample(), "Chapter A", "no findings", { create: true });

    assert.equal(sectionBody(text, "Chapter A"), "- no findings");
  });

  test("refuses an empty bullet", () => {
    assert.throws(() => addBullet(sample(), "Open", "  "));
  });
});

describe("putKey", () => {
  test("appends a keyed bullet the section does not have yet", () => {
    const text = putKey(sample(), "Run", "Branch", "feat/c900-add-made-up-thing");

    assert.equal(
      sectionBody(text, "Run"),
      "- **Status:** applying\n- **Review mode:** acceptance\n- **Branch:** feat/c900-add-made-up-thing",
    );
  });

  test("replaces the placeholder with the first keyed bullet", () => {
    assert.equal(sectionBody(putKey(sample(), "Open", "Dispute 1", "open"), "Open"), "- **Dispute 1:** open");
  });

  test("replaces an existing key's value where it stands", () => {
    const text = putKey(sample(), "Run", "Status", "done");

    assert.equal(text, sample().replace("- **Status:** applying", "- **Status:** done"));
  });

  test("replaces an existing key's value of several lines as a whole", () => {
    const before = putKey(sample(), "Run", "Status", "applying\nsince the morning\nstill");

    const after = putKey(before, "Run", "Status", "done");

    assert.equal(after, sample().replace("- **Status:** applying", "- **Status:** done"));
  });

  test("replaces a value with a blank line inside it as a whole, and reads it back whole", () => {
    const before = putKey(sample(), "Run", "Status", "applying\n\nsecond paragraph");
    assert.equal(keyValue(before, "Run", "Status"), "applying\n\nsecond paragraph");
    assert.equal(keyValue(before, "Run", "Review mode"), "acceptance");

    const after = putKey(before, "Run", "Status", "done");

    assert.equal(after, sample().replace("- **Status:** applying", "- **Status:** done"));
  });

  test("keeps a value of several lines one list item, its later lines indented by two spaces", () => {
    const text = putKey(
      sample(),
      "Run",
      "Commit trailers",
      "Co-Authored-By: Someone <someone@example.com>\nA-Second: line",
    );

    assert.equal(
      sectionBody(text, "Run"),
      "- **Status:** applying\n- **Review mode:** acceptance\n" +
        "- **Commit trailers:** Co-Authored-By: Someone <someone@example.com>\n  A-Second: line",
    );
  });

  test("leaves no space at the end of the key's line when the value starts on the next one", () => {
    const text = putKey(sample(), "Run", "Notes", "\nfirst\nsecond");

    assert.equal(sectionBody(text, "Run").split("\n").slice(-3).join("\n"), "- **Notes:**\n  first\n  second");
    assert.equal(putKey(text, "Run", "Notes", "none"), putKey(sample(), "Run", "Notes", "none"));
  });

  test("does not take a key that only starts like another for it", () => {
    const text = putKey(sample(), "Run", "Review", "x");

    assert.equal(keyValue(text, "Run", "Review mode"), "acceptance");
    assert.equal(keyValue(text, "Run", "Review"), "x");
  });

  test("keeps a CRLF file CRLF", () => {
    const text = putKey(sample("\r\n"), "Run", "Status", "done\nat noon");

    assert.equal(text, sample("\r\n").replace("- **Status:** applying", "- **Status:** done\r\n  at noon"));
  });

  test("refuses a missing section, and with `create` appends it", () => {
    assert.throws(() => putKey(sample(), "Chapter A", "Verdict", "clean"), /Chapter A/);

    const text = putKey(sample(), "Chapter A", "Verdict", "clean", { create: true });

    assert.equal(sectionBody(text, "Chapter A"), "- **Verdict:** clean");
  });

  test("refuses an empty key and a key of several lines", () => {
    assert.throws(() => putKey(sample(), "Run", " ", "x"));
    assert.throws(() => putKey(sample(), "Run", "a\nb", "x"));
  });
});

describe("keyValue", () => {
  test("gives a keyed bullet's value", () => {
    assert.equal(keyValue(sample(), "Run", "Status"), "applying");
    assert.equal(keyValue(sample("\r\n"), "Run", "Review mode"), "acceptance");
  });

  test("gives a value of several lines without their indent", () => {
    const text = putKey(sample("\r\n"), "Run", "Commit trailers", "First: one\nSecond: two");

    assert.equal(keyValue(text, "Run", "Commit trailers"), "First: one\nSecond: two");
  });

  test("gives null for a key or a section that is not there", () => {
    assert.equal(keyValue(sample(), "Run", "Branch"), null);
    assert.equal(keyValue(sample(), "Agents", "Status"), null);
  });

  test("gives an empty text for a key without a value", () => {
    const text = putKey(sample(), "Run", "Issue", "");

    assert.equal(sectionBody(text, "Run").split("\n").at(-1), "- **Issue:**");
    assert.equal(keyValue(text, "Run", "Issue"), "");
  });
});
