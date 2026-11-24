// Tests for state.mjs's pure functions: how a state file's text is read and changed by section (the body of a
// section, replacing it, appending a bullet, a keyed bullet's value, dropping a keyed bullet), what a new state
// file, a new reviews file and a triage's state file at the start of a round hold, and that an edit keeps the
// file's own line endings and every other line as it was. Texts in, texts out: nothing here touches a file, git or
// the code graph, and every change name and value is made up.
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addBullet,
  ALLOWED_FAILURES,
  dropKey,
  EMPTY,
  keyValue,
  newReviewsText,
  newStateText,
  putKey,
  roundSection,
  sectionBody,
  sectionKeys,
  sectionName,
  sectionNames,
  setSection,
  STATE_SECTIONS,
  TRIAGE_SECTIONS,
  triageText,
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
    "- **Human test review:** acceptance",
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
      "Allowed failures",
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
    assert.equal(sectionBody(sample(), "Run"), "- **Status:** applying\n- **Human test review:** acceptance");
    assert.equal(sectionBody(sample(), "Resume here"), "Chapter A, group 2.");
  });

  test("gives the last section's body, also without a final line ending", () => {
    assert.equal(sectionBody(sample(), "Open"), EMPTY);
    assert.equal(sectionBody(sample().trimEnd(), "Open"), EMPTY);
  });

  test("gives LF line breaks for a CRLF file", () => {
    assert.equal(sectionBody(sample("\r\n"), "Run"), "- **Status:** applying\n- **Human test review:** acceptance");
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
    assert.equal(sectionBody(sample(), "  Run "), "- **Status:** applying\n- **Human test review:** acceptance");
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

    assert.equal(sectionBody(text, "Run"), "- **Status:** applying\n- **Human test review:** acceptance\n- a note");
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
      "- **Status:** applying\n- **Human test review:** acceptance\n- **Branch:** feat/c900-add-made-up-thing",
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
    assert.equal(keyValue(before, "Run", "Human test review"), "acceptance");

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
      "- **Status:** applying\n- **Human test review:** acceptance\n" +
        "- **Commit trailers:** Co-Authored-By: Someone <someone@example.com>\n  A-Second: line",
    );
  });

  test("leaves no space at the end of the key's line when the value starts on the next one", () => {
    const text = putKey(sample(), "Run", "Notes", "\nfirst\nsecond");

    assert.equal(sectionBody(text, "Run").split("\n").slice(-3).join("\n"), "- **Notes:**\n  first\n  second");
    assert.equal(putKey(text, "Run", "Notes", "none"), putKey(sample(), "Run", "Notes", "none"));
  });

  test("does not take a key that only starts like another for it", () => {
    const text = putKey(sample(), "Run", "Human test", "x");

    assert.equal(keyValue(text, "Run", "Human test review"), "acceptance");
    assert.equal(keyValue(text, "Run", "Human test"), "x");
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

describe("dropKey", () => {
  // The sample with two tests allowed to fail, the second with a value of several lines.
  const parked = (eol = "\n") => {
    let text = `${sample(eol)}${eol}## ${ALLOWED_FAILURES}${eol}${eol}${EMPTY}${eol}`;
    text = putKey(text, ALLOWED_FAILURES, "A_made_up_test(1)", "parked: question Q2, red commit 1a2b3c4");
    return putKey(
      text,
      ALLOWED_FAILURES,
      "src/a.test.ts > a made-up group > a test",
      "blocked finding 5\nsince 0f9e8d7",
    );
  };

  test("removes the keyed bullet and leaves every other line as it was", () => {
    const text = dropKey(parked(), ALLOWED_FAILURES, "A_made_up_test(1)");

    assert.equal(
      sectionBody(text, ALLOWED_FAILURES),
      "- **src/a.test.ts > a made-up group > a test:** blocked finding 5\n  since 0f9e8d7",
    );
    assert.equal(text, parked().replace("- **A_made_up_test(1):** parked: question Q2, red commit 1a2b3c4\n", ""));
  });

  test("removes a bullet of several lines whole", () => {
    const text = dropKey(parked(), ALLOWED_FAILURES, "src/a.test.ts > a made-up group > a test");

    assert.equal(
      sectionBody(text, ALLOWED_FAILURES),
      "- **A_made_up_test(1):** parked: question Q2, red commit 1a2b3c4",
    );
  });

  test("leaves the section empty when it held nothing else", () => {
    const one = dropKey(parked(), ALLOWED_FAILURES, "A_made_up_test(1)");

    const text = dropKey(one, ALLOWED_FAILURES, " src/a.test.ts > a made-up group > a test ");

    assert.equal(sectionBody(text, ALLOWED_FAILURES), EMPTY);
    assert.equal(text, `${sample()}\n## ${ALLOWED_FAILURES}\n\n${EMPTY}\n`);
  });

  test("removes a key where it stands among others, also in the middle", () => {
    const text = dropKey(putKey(sample(), "Run", "Branch", "feat/made-up"), "Run", "Human test review");

    assert.equal(sectionBody(text, "Run"), "- **Status:** applying\n- **Branch:** feat/made-up");
  });

  test("keeps a CRLF file CRLF", () => {
    const text = dropKey(parked("\r\n"), ALLOWED_FAILURES, "A_made_up_test(1)");

    assert.equal(/(?<!\r)\n/.test(text), false, "no bare LF");
    assert.deepEqual(sectionKeys(text, ALLOWED_FAILURES), ["src/a.test.ts > a made-up group > a test"]);
  });

  test("refuses a key the section does not have, naming the keys it has", () => {
    assert.throws(
      () => dropKey(parked(), ALLOWED_FAILURES, "A_made_up_test"),
      /no key "A_made_up_test" in Allowed failures; its keys are: "A_made_up_test\(1\)", "src\/a\.test\.ts > /,
    );
    assert.throws(() => dropKey(sample(), "Open", "A"), /no key "A" in Open; it has no keyed bullet/);
  });

  test("does not take a key that only starts like another, nor a plain bullet, for it", () => {
    const text = addBullet(parked(), ALLOWED_FAILURES, "A_made_up_test: a plain bullet");

    assert.throws(() => dropKey(text, ALLOWED_FAILURES, "A_made_up_test"), /no key/);
  });

  test("refuses a section the file does not have, an empty key and a key of several lines", () => {
    assert.throws(() => dropKey(sample(), "Agents", "A"), /no section "Agents"/);
    assert.throws(() => dropKey(parked(), ALLOWED_FAILURES, " "));
    assert.throws(() => dropKey(parked(), ALLOWED_FAILURES, "a\nb"));
  });
});

describe("sectionKeys", () => {
  test("gives the keys of a section's keyed bullets, in order", () => {
    assert.deepEqual(sectionKeys(sample(), "Run"), ["Status", "Human test review"]);
    assert.deepEqual(sectionKeys(sample("\r\n"), "run"), ["Status", "Human test review"]);
  });

  test("gives none for an empty section and for a section that is not there", () => {
    assert.deepEqual(sectionKeys(sample(), "Open"), []);
    assert.deepEqual(sectionKeys(sample(), "Agents"), []);
  });

  test("takes only the lines that start a keyed bullet: no plain bullet, and no later line of a value", () => {
    let text = putKey(sample(), "Open", "A_test(with: a colon)", "why\n- **Not a key:** an indented line");
    text = addBullet(text, "Open", "a plain bullet");
    text = putKey(text, "Open", "Another", "");

    assert.deepEqual(sectionKeys(text, "Open"), ["A_test(with: a colon)", "Another"]);
  });
});

describe("triageText", () => {
  const run = (round, more = []) => [["Status", "triaging"], ["PR", "109"], ["Round", String(round)], ...more];

  test("for a new file, holds the title, the fixed sections in order, Run's facts and the round's section", () => {
    const text = triageText(null, "c900-add-made-up-thing", run(1), 1, "\n");

    assert.equal(text.split("\n")[0], "# Review triage: c900-add-made-up-thing");
    assert.deepEqual(TRIAGE_SECTIONS, ["Resume here", "Run", "Agents", "Open", "Allowed failures"]);
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 1"]);
    assert.equal(roundSection(1), "Round 1");
    assert.equal(sectionBody(text, "Run"), "- **Status:** triaging\n- **PR:** 109\n- **Round:** 1");
    for (const name of sectionNames(text).filter((n) => n !== "Run")) assert.equal(sectionBody(text, name), EMPTY);
    assert.ok(text.endsWith(`## Round 1\n\n${EMPTY}\n`));
  });

  test("starts a new file at the round given, and uses the line endings given", () => {
    const text = triageText(null, "PR 109", run(3), 3, "\r\n");

    assert.equal(text.split("\r\n")[0], "# Review triage: PR 109");
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 3"]);
    assert.equal(/(?<!\r)\n/.test(text), false, "no bare LF");
  });

  // A triage after its first round: the findings recorded, an agent, an open question and the commit trailers.
  const afterRoundOne = (eol = "\n") => {
    let text = triageText(null, "c900-add-made-up-thing", run(1, [["Source", "pr"]]), 1, eol);
    text = putKey(text, "Run", "Commit trailers", "A-Trailer: one");
    text = putKey(text, "Run", "Status", "done");
    text = putKey(text, "Agents", "Runner", "r1s2t3");
    text = setSection(text, "Resume here", "Round 1 is closed.");
    text = putKey(text, "Round 1", "1", "src/a.cs:19 · A made-up title · FIX · 1a2b3c4 · posted");
    return putKey(text, "Round 1", "2", "src/b.ts:142 · Another · DECLINE · — · posted\n  with a second line");
  };

  test("for a later round, changes Run's facts where they stand and appends the round's section", () => {
    const before = afterRoundOne();

    const text = triageText(before, "ignored for a file that exists", run(2), 2, "\r\n");

    assert.equal(
      text,
      `${before
        .replace("- **Status:** done", "- **Status:** triaging")
        .replace("- **Round:** 1", "- **Round:** 2")}\n## Round 2\n\n${EMPTY}\n`,
    );
    assert.equal(keyValue(text, "Run", "Commit trailers"), "A-Trailer: one");
    assert.equal(keyValue(text, "Run", "Source"), "pr");
  });

  test("leaves an earlier round's section byte for byte", () => {
    const before = afterRoundOne("\r\n");
    const roundOne = before.slice(before.indexOf("## Round 1"));

    const text = triageText(triageText(before, "x", run(2), 2, "\n"), "x", run(3), 3, "\n");

    assert.ok(text.includes(roundOne), "round 1 as it was");
    assert.deepEqual(sectionNames(text), [...TRIAGE_SECTIONS, "Round 1", "Round 2", "Round 3"]);
    assert.equal(/(?<!\r)\n/.test(text), false, "the file's own line endings, not those given");
  });

  test("for a rerun of the same round, changes nothing but what Run's facts changed", () => {
    const before = afterRoundOne();

    assert.equal(
      triageText(before, "x", run(1), 1, "\n"),
      before.replace("- **Status:** done", "- **Status:** triaging"),
    );
    const underWay = triageText(before, "x", run(1), 1, "\n");
    assert.equal(triageText(underWay, "x", run(1), 1, "\n"), underWay);
  });

  test("appends a fact Run does not hold yet, after those it holds", () => {
    const text = triageText(afterRoundOne(), "x", run(1, [["Branch", "fix/made-up-thing"]]), 1, "\n");

    assert.deepEqual(sectionKeys(text, "Run"), ["Status", "PR", "Round", "Source", "Commit trailers", "Branch"]);
  });

  test("gives a file that lacks a fixed section that section, at the end, and keeps the rest", () => {
    const before = "# Review triage: an older file\n\nA line before any section.\n\n## Agents\n\n| a | table |\n";

    const text = triageText(before, "x", run(2), 2, "\n");

    assert.ok(text.startsWith(before));
    assert.deepEqual(sectionNames(text), ["Agents", "Run", "Resume here", "Open", "Allowed failures", "Round 2"]);
    assert.equal(sectionBody(text, "Agents"), "| a | table |");
    assert.equal(keyValue(text, "Run", "Round"), "2");
  });
});

describe("keyValue", () => {
  test("gives a keyed bullet's value", () => {
    assert.equal(keyValue(sample(), "Run", "Status"), "applying");
    assert.equal(keyValue(sample("\r\n"), "Run", "Human test review"), "acceptance");
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
