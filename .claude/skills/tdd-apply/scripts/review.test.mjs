// Tests for review.mjs's pure functions: how the record of a chapter review is read (its two lines at the top, a
// finding's first line, the three details that are read, every text that is refused), how it is held against the
// reports of the findings' verifiers, and how its findings are handed to the sorting rules: each with the verdict
// of a report that still agrees with the record, the merged ones as groups, and the ties between findings whose
// fixes touch. Texts and objects in, objects out: nothing here touches a file or git, and every id, path and
// finding is made up. (That `tdd.mjs review` writes the record and `tdd.mjs route --chapter` sorts it from the
// report files is tested in tdd.test.mjs.)
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { checkRecord, readRecord, recordFindings, recordSummary, reviewSection } from "./review.mjs";
import { route, routeReport, waiting } from "./route.mjs";

// A record of chapter B with these findings' lines under its two lines at the top; `counts` is the FINDINGS line
// without its label.
const record = (counts, ...lines) =>
  ["REVIEW: chapter B, 1a2b3c4..5d6e7f8, 6 commits, 9 files changed", `FINDINGS: ${counts}`, "", ...lines].join("\n");

// A finding's lines as the reviewer writes them: its first line, then its details.
const B1 = [
  "B-1 · important · confirmed · behaviour · src/App/Mapping.cs:12 · in the chapter",
  "  DEFECT: A missing balance maps to zero.",
  "  SCENARIO: A made-up account without a balance, then 0 is shown.",
  "  FIX: local · small · spec behaviour no · contract change no · return nothing for a missing balance",
  "  VERIFIER: MappingTests.cs:40 covers no missing balance.",
  "  BUILDS ON IT: nothing",
];
const B2 = [
  "B-2 · not applicable · refuted · not applicable · src/App/Mapping.cs:30 · in the chapter",
  "  DEFECT: The amount is rounded twice.",
  "  VERIFIER: Mapping.cs:31 rounds once; the second call is a format.",
];
const B4 = "B-4 · nit · confirmed · docs · docs/made-up.md:3 · in the chapter";
const ONE = record("1 · confirmed 1 · refuted 0 · unsure 0 · no report 0", ...B1);
const TWO_CONFIRMED = "2 · confirmed 2 · refuted 0 · unsure 0 · no report 0";

const confirmed = (kind = "behaviour") => ({
  verdict: {
    verdict: "confirmed",
    evidence: true,
    kind,
    local: true,
    size: "small",
    specBehaviour: false,
    contractChange: false,
  },
});
const refuted = () => ({ verdict: { verdict: "refuted", evidence: true } });
const unsure = () => ({ verdict: { verdict: "unsure" } });
const MISSING = { missing: true };

// A reader of report files for `checkRecord` and `recordFindings`: `reports` holds what each finding's file
// holds, and every other finding's file is missing.
const reportsOf = (reports) => (id) => reports[id] ?? MISSING;

describe("reviewSection", () => {
  test("names the reviews file's section of a chapter's record", () => {
    assert.equal(reviewSection("B"), "Chapter B review");
    assert.equal(reviewSection("acceptance"), "Chapter acceptance review");
  });
});

describe("readRecord", () => {
  test("reads a record without findings: its two lines are the whole of it", () => {
    const read = readRecord(
      "REVIEW: chapter B, 1a2b3c4..5d6e7f8, 6 commits, 9 files changed\nFINDINGS: 0 · confirmed 0 · refuted 0 · unsure 0 · no report 0\n",
      "B",
    );

    assert.deepEqual(read.findings, []);
    assert.deepEqual(read.counts, { total: 0, confirmed: 0, refuted: 0, unsure: 0, noReport: 0 });
    assert.equal(read.chapter, "B");
  });

  test("reads each finding's first line: its id, severity, verdict, kind, place and whether it is outside", () => {
    const read = readRecord(
      record(
        "3 · confirmed 1 · refuted 1 · unsure 0 · no report 1",
        ...B1,
        "",
        ...B2,
        "",
        "B-o1 · not applicable · no report · not applicable · src/Other/Old.cs:7 · outside",
        "  DEFECT: An older made-up defect.",
      ),
      "B",
    );
    const plain = { reviewerDisagrees: false, merged: [], affects: [] };

    assert.deepEqual(read.findings, [
      {
        id: "B-1",
        line: 4,
        severity: "important",
        verdict: "confirmed",
        kind: "behaviour",
        place: "src/App/Mapping.cs:12",
        outside: false,
        ...plain,
      },
      {
        id: "B-2",
        line: 11,
        severity: "not applicable",
        verdict: "refuted",
        kind: "not applicable",
        place: "src/App/Mapping.cs:30",
        outside: false,
        ...plain,
      },
      {
        id: "B-o1",
        line: 15,
        severity: "not applicable",
        verdict: "no report",
        kind: "not applicable",
        place: "src/Other/Old.cs:7",
        outside: true,
        ...plain,
      },
    ]);
    assert.deepEqual(read.counts, { total: 3, confirmed: 1, refuted: 1, unsure: 0, noReport: 1 });
  });

  test("reads the three details it knows: the findings merged in, those whose fix it touches, and that the reviewer disagrees", () => {
    const read = readRecord(
      record(
        TWO_CONFIRMED,
        ...B1,
        "  MERGED: B-3 · src/App/Mapping.cs:44",
        "  MERGED: B-5",
        "  AFFECTS: B-4: both fixes change the same method.",
        B4,
        "  AFFECTS: B-1: both fixes change the same method.",
        "  AFFECTS: B-5: and it names a merged one by its own id.",
        "  REVIEWER DISAGREES: The sentence is true as it stands.",
      ),
      "B",
    );

    assert.deepEqual(read.findings[0].merged, [
      { id: "B-3", line: 10 },
      { id: "B-5", line: 11 },
    ]);
    assert.deepEqual(read.findings[0].affects, [{ id: "B-4", line: 12 }]);
    assert.equal(read.findings[0].reviewerDisagrees, false);
    assert.deepEqual(read.findings[1].merged, []);
    assert.deepEqual(read.findings[1].affects, [
      { id: "B-1", line: 14 },
      { id: "B-5", line: 15 },
    ]);
    assert.equal(read.findings[1].reviewerDisagrees, true);
  });

  test("takes CRLF line breaks, a byte-order mark, blank lines anywhere and any space around the middle dots", () => {
    const text = `${String.fromCharCode(0xfeff)}\r\n${record(
      "1·confirmed 1 ·refuted 0· unsure 0  ·  no report 0",
      "",
      "B-1·important ·confirmed·  behaviour · src/App/Mapping.cs:12·in the chapter",
      "",
      "  DEFECT: A missing balance maps to zero.",
      "  MERGED:B-3·src/App/Mapping.cs:44",
      "  MERGED:   B-5   ·   src/App/Other.cs:9",
    ).replace(/\n/g, "\r\n")}\r\n\r\n`;

    const read = readRecord(text, "B");

    assert.equal(read.findings.length, 1);
    assert.equal(read.findings[0].id, "B-1");
    assert.equal(read.findings[0].line, 6, "the line's number in the text as given");
    assert.deepEqual(
      read.findings[0].merged.map((other) => other.id),
      ["B-3", "B-5"],
    );
  });

  test("takes the chapter's name in the first line whatever the case of its letters, as a section is found", () => {
    assert.equal(readRecord(ONE, "b").findings.length, 1);
    assert.equal(readRecord(ONE.replace("chapter B,", "chapter b,"), "B").findings.length, 1);
    assert.equal(readRecord(ONE.replace("chapter B,", "chapter Acceptance,"), "acceptance").chapter, "acceptance");
  });

  test("takes a labelled detail that starts at the margin as a detail, not as a finding", () => {
    const read = readRecord(
      record(
        "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0",
        B1[0],
        "FIX: local · small · spec behaviour no · contract change no · a sketch with · five · dots",
        "REVIEWER DISAGREES: It is no defect.",
        "MERGED: B-2 · src/App/Mapping.cs:30",
      ),
      "B",
    );

    assert.equal(read.findings.length, 1);
    assert.equal(read.findings[0].reviewerDisagrees, true);
    assert.deepEqual(read.findings[0].merged, [{ id: "B-2", line: 7 }]);
  });

  test("takes a place with a range of lines, and a chapter's name of several characters", () => {
    const text = [
      "REVIEW: chapter acceptance, 1a2b3c4..5d6e7f8, 2 commits, 4 files changed",
      "FINDINGS: 1 · confirmed 0 · refuted 0 · unsure 1 · no report 0",
      "acc-1 · nit · unsure · test-quality · tests/App.AcceptanceTests/Scenarios/Made up.cs:12-19 · in the chapter",
    ].join("\n");

    assert.equal(
      readRecord(text, "acceptance").findings[0].place,
      "tests/App.AcceptanceTests/Scenarios/Made up.cs:12-19",
    );
  });

  describe("refuses, in one line that names the line", () => {
    const refused = (text, pattern, chapter = "B") => {
      assert.throws(
        () => readRecord(text, chapter),
        (e) => {
          assert.match(e.message, pattern);
          assert.equal(e.message.includes("\n"), false, e.message);
          assert.ok(e.message.length <= 285, `${e.message.length} characters: ${e.message}`);
          return true;
        },
      );
    };
    const COUNTS = "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0";
    const withFirstLine = (line) => record(COUNTS, line, ...B1.slice(1));

    test("an empty text, and one whose first line is not the record's or names another chapter", () => {
      refused("", /^the record is empty; it starts with "REVIEW: chapter B, …"$/);
      refused("\n \n", /^the record is empty; /);
      refused(
        `FINDINGS: ${COUNTS}`,
        /^line 1: "FINDINGS: 1 · .*" is not the record's first line; it starts with "REVIEW: chapter B, …"$/,
      );
      refused(
        ONE,
        /^line 1: "REVIEW: chapter B, .*" is not the record's first line; it starts with "REVIEW: chapter A, …"$/,
        "A",
      );
      refused(ONE.replace("chapter B,", "chapter B2,"), /^line 1: .* it starts with "REVIEW: chapter B, …"$/);
      refused(ONE.replace("REVIEW: chapter B,", "Review of chapter B,"), /^line 1: /);
    });

    test("a second line that is not the counts", () => {
      const first = "REVIEW: chapter B, 1a2b3c4..5d6e7f8, 6 commits, 9 files changed";
      const shape = /it is "FINDINGS: <total> · confirmed <a> · refuted <b> · unsure <c> · no report <d>"$/;

      refused(first, shape);
      refused(first, /^the record has no second line; /);
      refused(`${first}\n${B1[0]}`, /^line 2: "B-1 · important · .*" is not the record's second line; /);
      refused(`${first}\nFINDINGS: 1`, shape);
      refused(`${first}\nFINDINGS: one · confirmed 1 · refuted 0 · unsure 0 · no report 0`, shape);
      refused(`${first}\nFINDINGS: 1 · confirmed 1 · refuted 0 · unsure 0`, shape);
      refused(`${first}\n\nFINDINGS: 1 · confirmed 1 · unsure 0 · refuted 0 · no report 0`, /^line 3: /);
    });

    test("counts that are not what the findings' first lines say", () => {
      refused(
        record("2 · confirmed 2 · refuted 0 · unsure 0 · no report 0", ...B1),
        /^line 2: FINDINGS says 2 · confirmed 2 · refuted 0 · unsure 0 · no report 0, and the findings' first lines say 1 · confirmed 1 · refuted 0 · unsure 0 · no report 0$/,
      );
      refused(record("1 · confirmed 0 · refuted 1 · unsure 0 · no report 0", ...B1), /^line 2: FINDINGS says /);
      refused(record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0", ...B1), /^line 2: FINDINGS says /);
      refused(record(COUNTS), /^line 2: FINDINGS says 1 · .*, and the findings' first lines say 0 · /);
    });

    test("a line at the margin that is no finding's first line: too few parts or too many", () => {
      const six =
        /, and a finding's first line has six: "<id> · <severity> · <verdict> · <kind> · <file>:<line> · <in the chapter \| outside>"; a line of a finding's details starts with two spaces$/;

      refused(
        record(COUNTS, ...B1, "A note the reviewer added at the margin."),
        /^line 10: "A note the reviewer added at the margin\." has one part/,
      );
      refused(record(COUNTS, ...B1, "A note the reviewer added at the margin."), six);
      refused(
        withFirstLine("B-1 · important · confirmed · behaviour · src/App/Mapping.cs:12"),
        /^line 4: ".*" has 5 parts, and a finding's/,
      );
      refused(withFirstLine(`${B1[0]} · and more`), /^line 4: ".*…" has 7 parts, /);
      refused(withFirstLine(`${"a very long line ".repeat(20)}`), six);
    });

    test("a first line whose part holds another word", () => {
      const first = (line) => withFirstLine(line);

      refused(
        first("B 1 · important · confirmed · behaviour · a.cs:1 · in the chapter"),
        /^line 4: the id is "B 1"; an id is letters, digits, dots, dashes and underscores, such as B-1$/,
      );
      refused(
        first(" · important · confirmed · behaviour · a.cs:1 · in the chapter".trimStart()),
        /^line 4: the id is ""; /,
      );
      refused(
        first("B-1 · major · confirmed · behaviour · a.cs:1 · in the chapter"),
        /^line 4: finding B-1: its second part is "major"; it is one of: important, nit, not applicable$/,
      );
      refused(
        first("B-1 · important · agreed · behaviour · a.cs:1 · in the chapter"),
        /^line 4: finding B-1: its third part is "agreed"; it is one of: confirmed, refuted, unsure, no report$/,
      );
      refused(
        first("B-1 · important · confirmed · bug · a.cs:1 · in the chapter"),
        /^line 4: finding B-1: its fourth part is "bug"; it is one of: behaviour, test-quality, docs, cleanup, not applicable$/,
      );
      refused(
        first("B-1 · important · confirmed · behaviour · a.cs · in the chapter"),
        /^line 4: finding B-1: its fifth part is "a\.cs"; it is <file>:<line>$/,
      );
      refused(
        first("B-1 · important · confirmed · behaviour · a.cs:1 · inside"),
        /^line 4: finding B-1: its sixth part is "inside"; it is one of: in the chapter, outside$/,
      );
    });

    test("an id given twice", () => {
      refused(
        record("2 · confirmed 2 · refuted 0 · unsure 0 · no report 0", ...B1, ...B1),
        /^line 10: finding B-1: the id is given twice, also on line 4$/,
      );
    });

    test("a detail before the first finding", () => {
      refused(
        record(COUNTS, "  DEFECT: Nothing above it.", ...B1),
        /^line 4: "DEFECT: Nothing above it\." belongs to no finding; a finding starts with its line "<id> · /,
      );
    });

    test("a MERGED line that is not one id, then nothing or the middle dot and the place: one line per finding merged in", () => {
      const merged = (line) => record(COUNTS, ...B1, line);
      const shape =
        / is not "MERGED: <the other finding's id> · <its file:line>": one MERGED line per finding merged in$/;

      for (const line of [
        "  MERGED:",
        "  MERGED: (the second one)",
        "  MERGED: B-2, B-3 · src/App/Mapping.cs:30",
        "  MERGED: B-2 B-3",
        "  MERGED: B-2 and B-3 · src/App/Mapping.cs:30",
        "  MERGED: B-2 · B-3 · src/App/Mapping.cs:30",
        "  MERGED: B-2 src/App/Mapping.cs:30",
        "  MERGED: B-2 ·",
        "  MERGED: B-2; B-3",
        "  MERGED: B-2 · B-3",
        "  MERGED: B-2 · and B-3 too",
        "  MERGED: B-2 · src/App/Mapping.cs",
      ]) {
        refused(merged(line), shape);
        refused(merged(line), /^line 10: finding B-1: "MERGED:/);
      }
    });

    test("a MERGED line that names the finding itself, one with a first line of its own, or one merged already", () => {
      const merged = (...lines) => record(COUNTS, ...B1, ...lines);

      refused(
        merged("  MERGED: B-1 · src/App/Mapping.cs:12"),
        /^line 10: finding B-1: MERGED names B-1, the finding itself$/,
      );
      refused(
        record(TWO_CONFIRMED, ...B1, "  MERGED: B-4 · docs/made-up.md:3", B4),
        /^line 10: finding B-1: MERGED names B-4, which has a first line of its own \(line 11\); a finding that is merged into another has none$/,
      );
      refused(
        record(TWO_CONFIRMED, ...B1, "  MERGED: B-3 · a.cs:1", B4, "  MERGED: B-3 · a.cs:1"),
        /^line 12: finding B-4: MERGED names B-3, which is merged already, into B-1$/,
      );
      refused(
        merged("  MERGED: B-3 · a.cs:1", "  MERGED: B-3"),
        /^line 11: finding B-1: MERGED names B-3, which is merged already, into B-1$/,
      );
    });

    test("a finding with no report that has a finding merged into it", () => {
      refused(
        record(
          "1 · confirmed 0 · refuted 0 · unsure 0 · no report 1",
          "B-1 · not applicable · no report · not applicable · a.cs:1 · in the chapter",
          "  MERGED: B-3 · a.cs:9",
        ),
        /^line 5: finding B-1: MERGED names B-3, and a finding with no report is never merged$/,
      );
    });

    test("an AFFECTS line that is not an id, a colon and a sentence", () => {
      const shape = / is not "AFFECTS: <the other finding's id>: <one sentence>"$/;

      for (const line of [
        "  AFFECTS:",
        "  AFFECTS: B-4",
        "  AFFECTS: B-4:",
        "  AFFECTS: the other one: both fixes change the same method.",
        "  AFFECTS: B-4, B-5: both fixes change the same method.",
        "  AFFECTS: B-4 · both fixes change the same method.",
      ]) {
        refused(record(TWO_CONFIRMED, ...B1, line, B4), shape);
        refused(record(TWO_CONFIRMED, ...B1, line, B4), /^line 10: finding B-1: "AFFECTS:/);
      }
    });

    test("an AFFECTS line that names no finding of the record, the finding itself, or one merged into it", () => {
      refused(
        record(COUNTS, ...B1, "  AFFECTS: B-9: both fixes change the same method."),
        /^line 10: finding B-1: AFFECTS names B-9, which is no finding of this record$/,
      );
      refused(
        record(COUNTS, ...B1, "  AFFECTS: B-1: it touches itself."),
        /^line 10: finding B-1: AFFECTS names B-1, the finding itself$/,
      );
      refused(
        record(COUNTS, ...B1, "  MERGED: B-3 · a.cs:1", "  AFFECTS: B-3: they are one already."),
        /^line 11: finding B-1: AFFECTS names B-3, which is merged into this finding$/,
      );
    });

    test("a REVIEWER DISAGREES line that names nothing the reviewer disagrees on: empty, or starting with words that agree or a dash", () => {
      const disagrees = (said) =>
        readRecord(record(COUNTS, ...B1, `  REVIEWER DISAGREES:${said}`), "B").findings[0].reviewerDisagrees;

      for (const said of ["", " "]) {
        refused(
          record(COUNTS, ...B1, `  REVIEWER DISAGREES:${said}`),
          /^line 10: finding B-1: "REVIEWER DISAGREES:" names nothing you disagree on: say it in one sentence, or leave the line out when you agree$/,
        );
      }
      for (const [said, start] of [
        [" no", "no"],
        [" No.", "No"],
        [" No disagreement.", "No"],
        [" No, the verifier is right.", "No"],
        [" No test covers it, so it is a defect.", "No"],
        [" none", "none"],
        [" NONE", "NONE"],
        [" none — agrees with the verifier", "none"],
        [" nothing", "nothing"],
        [" Nothing to add.", "Nothing"],
        [" —", "—"],
        [" – the verifier is right", "–"],
        [" -", "-"],
        [" n/a", "n/a"],
        [" N/A.", "N/A"],
        [" not applicable", "not applicable"],
        [" Not applicable.", "Not applicable"],
        [" agree", "agree"],
        [" Agrees with the verifier.", "Agrees"],
        [" Agreed.", "Agreed"],
        [" agreed", "agreed"],
        [" AGREED", "AGREED"],
        [" Agreed with the verifier: it is a defect.", "Agreed"],
        [" I agree", "I agree"],
        [" i agree with both.", "i agree"],
      ]) {
        refused(
          record(COUNTS, ...B1, `  REVIEWER DISAGREES:${said}`),
          new RegExp(
            `^line 10: finding B-1: ".*" names nothing you disagree on: a line that starts with "${start}" agrees; ` +
              "start your sentence otherwise, or leave the line out when you agree$",
          ),
        );
      }
      for (const said of [
        " The kind is docs, not behaviour.",
        " Not a defect: Mapping.cs:31 rounds once.",
        " Nobody calls it with a missing balance.",
        " Now that the test exists, it is test-quality.",
        " Agreement on the verdict, not on the kind: it is docs.",
        " Agreeable as the fix reads, the kind is docs.",
        " Disagree: it is outside the chapter.",
        " Nonetheless it is a nit.",
      ]) {
        assert.equal(disagrees(said), true, `a sentence that starts otherwise is a disagreement:${said}`);
      }
    });
  });
});

describe("recordSummary", () => {
  test("gives the number of findings and how many have each verdict", () => {
    const counts = (text) => recordSummary(readRecord(text, "B"));

    assert.equal(counts(ONE), "1 finding · confirmed 1 · refuted 0 · unsure 0 · no report 0");
    assert.equal(
      counts(record("2 · confirmed 1 · refuted 1 · unsure 0 · no report 0", ...B1, ...B2)),
      "2 findings · confirmed 1 · refuted 1 · unsure 0 · no report 0",
    );
    assert.equal(
      counts(record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0")),
      "0 findings · confirmed 0 · refuted 0 · unsure 0 · no report 0",
    );
  });
});

describe("checkRecord", () => {
  const two = record("2 · confirmed 1 · refuted 1 · unsure 0 · no report 0", ...B1, ...B2);
  const refused = (text, reports, pattern) => {
    assert.throws(
      () => checkRecord(readRecord(text, "B"), reportsOf(reports), "/made/up/reports/b"),
      (e) => {
        assert.match(e.message, pattern);
        assert.equal(e.message.includes("\n"), false, e.message);
        return true;
      },
    );
  };

  test("lets a record through whose findings say what their reports say", () => {
    checkRecord(readRecord(two, "B"), reportsOf({ "B-1": confirmed(), "B-2": refuted() }));
    checkRecord(readRecord(record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0"), "B"), reportsOf({}));
  });

  test("does not hold a refuted or unsure finding's kind against its report, nor any severity", () => {
    const text = record(
      "2 · confirmed 0 · refuted 1 · unsure 1 · no report 0",
      "B-1 · nit · unsure · docs · a.cs:1 · in the chapter",
      "B-2 · important · refuted · cleanup · a.cs:2 · in the chapter",
    );

    checkRecord(readRecord(text, "B"), reportsOf({ "B-1": unsure(), "B-2": refuted() }));
  });

  test("refuses a verdict that is not the report's", () => {
    refused(
      two,
      { "B-1": refuted(), "B-2": refuted() },
      /^line 4: finding B-1 says confirmed, and its report B-1-1\.md says refuted$/,
    );
    refused(
      two,
      { "B-1": confirmed(), "B-2": unsure() },
      /^line 10: finding B-2 says refuted, and its report B-2-1\.md says unsure$/,
    );
  });

  test("refuses a confirmed finding's kind that is not the report's", () => {
    refused(
      two,
      { "B-1": confirmed("docs"), "B-2": refuted() },
      /^line 4: finding B-1 says behaviour, and its report B-1-1\.md says KIND: docs$/,
    );
  });

  test("refuses a verdict for a finding whose report is missing or cannot be read: it says no report", () => {
    refused(
      two,
      { "B-2": refuted() },
      /^line 4: finding B-1 says confirmed, and it has no report B-1-1\.md in \/made\/up\/reports\/b; a finding whose verifier never reported says "no report"$/,
    );
    refused(
      two,
      { "B-1": { unreadable: "it has no VERDICT line" }, "B-2": refuted() },
      /^line 4: finding B-1 says confirmed, and its report B-1-1\.md cannot be read, which makes it "no report": it has no VERDICT line$/,
    );
  });

  test("lets no report through exactly when the report is missing or cannot be read", () => {
    const text = record(
      "2 · confirmed 0 · refuted 0 · unsure 0 · no report 2",
      "B-1 · not applicable · no report · not applicable · a.cs:1 · in the chapter",
      "B-2 · not applicable · no report · not applicable · a.cs:2 · outside",
    );

    checkRecord(readRecord(text, "B"), reportsOf({ "B-2": { unreadable: "it has no VERDICT line" } }));
    refused(
      text,
      { "B-1": confirmed() },
      /^line 4: finding B-1 says "no report", and its report B-1-1\.md is there and says confirmed$/,
    );
  });

  test("holds a merged finding's report against the finding it is merged into", () => {
    const merged = record(
      "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
    );

    checkRecord(readRecord(merged, "B"), reportsOf({ "B-1": confirmed(), "B-3": confirmed("docs") }));
    refused(
      merged,
      { "B-1": confirmed() },
      /^line 4: finding B-1 \(line 10\) names B-3 as merged into it, and B-3 has no report B-3-1\.md in \/made\/up\/reports\/b$/,
    );
    refused(
      merged,
      { "B-1": confirmed(), "B-3": { unreadable: 'KIND is "bug"' } },
      /^line 4: finding B-1 \(line 10\) names B-3 as merged into it, and its report B-3-1\.md cannot be read: KIND is "bug"$/,
    );
    refused(
      merged,
      { "B-1": confirmed(), "B-3": refuted() },
      /^line 4: finding B-1 \(line 10\) names B-3 as merged into it, and its report B-3-1\.md says refuted, not confirmed: findings are merged only when their verdicts are the same$/,
    );
  });

  test("refuses a report file that belongs to no finding of the record, and lets through one that a finding or a MERGED line names", () => {
    const merged = record(
      "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
    );
    const reports = { "B-1": confirmed(), "B-3": confirmed() };
    const filed =
      (...names) =>
      () =>
        checkRecord(readRecord(merged, "B"), reportsOf(reports), "/made/up/reports/b", names);

    filed("B-1-1.md", "B-3-1.md")();
    filed()();
    assert.throws(filed("B-1-1.md", "B-3-1.md", "B-2-1.md"), {
      message:
        "the report B-2-1.md in /made/up/reports/b belongs to no finding of the record: give it its line, or merge it",
    });
    assert.throws(filed("B-1-1.md", "b-3-1.md"), /^Error: the report b-3-1\.md in /, "names are compared as they are");
    const none = readRecord(record("0 · confirmed 0 · refuted 0 · unsure 0 · no report 0"), "B");
    assert.throws(() => checkRecord(none, reportsOf({}), "/made/up/reports/b", ["B-1-1.md"]), {
      message:
        "the report B-1-1.md in /made/up/reports/b belongs to no finding of the record: give it its line, or merge it",
    });
  });
});

describe("recordFindings", () => {
  const sorted = (text, reports) => recordFindings(readRecord(text, "B"), reportsOf(reports), "/made/up/reports/b");

  test("gives each finding with its report's verdict, its place and whether the reviewer disagrees", () => {
    const text = record(
      "3 · confirmed 1 · refuted 1 · unsure 0 · no report 1",
      ...B1,
      ...B2,
      "  REVIEWER DISAGREES: It rounds twice for a made-up amount.",
      "B-o1 · not applicable · no report · not applicable · src/Other/Old.cs:7 · outside",
    );

    const { findings, groups, ties, said } = sorted(text, { "B-1": confirmed(), "B-2": refuted() });

    assert.deepEqual(findings, [
      { id: "B-1", outside: false, reviewerDisagrees: false, verdicts: [confirmed().verdict] },
      { id: "B-2", outside: false, reviewerDisagrees: true, verdicts: [refuted().verdict] },
      { id: "B-o1", outside: true, reviewerDisagrees: false, verdicts: [null] },
    ]);
    assert.deepEqual([groups, ties, said], [[], [], []]);
  });

  test("puts a finding merged into another right after it, as one group with the kept finding first", () => {
    const text = record(
      "2 · confirmed 1 · refuted 1 · unsure 0 · no report 0",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
      ...B2,
    );

    const { findings, groups, said } = sorted(text, {
      "B-1": confirmed(),
      "B-3": confirmed("docs"),
      "B-2": refuted(),
    });

    assert.deepEqual(
      findings.map((f) => f.id),
      ["B-1", "B-3", "B-2"],
    );
    assert.deepEqual(groups, [["B-1", "B-3"]]);
    assert.deepEqual(said, [], "a merged finding's kind is its own report's: only its verdict is the kept one's");
    assert.deepEqual(routeReport(route(findings, groups)), [
      "B-1, B-3 → FIX · behaviour",
      "B-2 → DECLINE · refuted with evidence",
      "FIX 1 · DECLINE 1 · ASK 0",
    ]);
  });

  test("gives a merged finding the kept one's place and reviewer", () => {
    const text = record(
      "1 · confirmed 1 · refuted 0 · unsure 0 · no report 0",
      "B-o1 · nit · confirmed · docs · src/Other/Old.cs:7 · outside",
      "  MERGED: B-o2 · src/Other/Old.cs:19",
      "  REVIEWER DISAGREES: Both are true as they stand.",
    );

    const { findings } = sorted(text, { "B-o1": confirmed("docs"), "B-o2": confirmed("docs") });

    assert.deepEqual(findings, [
      { id: "B-o1", outside: true, reviewerDisagrees: true, verdicts: [confirmed("docs").verdict] },
      { id: "B-o2", outside: true, reviewerDisagrees: true, verdicts: [confirmed("docs").verdict] },
    ]);
  });

  test("takes no report that no longer agrees with the record, and says why for each", () => {
    const text = record(
      "5 · confirmed 3 · refuted 1 · unsure 0 · no report 1",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
      ...B2,
      B4,
      "B-5 · nit · confirmed · cleanup · a.cs:5 · in the chapter",
      "B-6 · not applicable · no report · not applicable · a.cs:6 · in the chapter",
    );

    const { findings, said } = sorted(text, {
      "B-1": confirmed("docs"),
      "B-3": refuted(),
      "B-2": unsure(),
      "B-5": { unreadable: "it has no VERDICT line" },
      "B-6": confirmed(),
    });

    assert.deepEqual(
      findings.map((f) => [f.id, f.verdicts[0]]),
      [
        ["B-1", null],
        ["B-3", null],
        ["B-2", null],
        ["B-4", null],
        ["B-5", null],
        ["B-6", null],
      ],
    );
    assert.deepEqual(said, [
      "B-1-1.md says KIND: docs, and the record says behaviour",
      "B-3-1.md says refuted, and the record says confirmed",
      "B-2-1.md says unsure, and the record says refuted",
      "B-4-1.md is missing in /made/up/reports/b, and the record says confirmed",
      "B-5-1.md cannot be read as a report: it has no VERDICT line",
      "B-6-1.md is there and says confirmed, and the record says no report",
    ]);
  });

  test("says nothing of a finding with no report whose file is missing or cannot be read: the record says so", () => {
    const text = record(
      "2 · confirmed 0 · refuted 0 · unsure 0 · no report 2",
      "B-1 · not applicable · no report · not applicable · a.cs:1 · in the chapter",
      "B-2 · not applicable · no report · not applicable · a.cs:2 · in the chapter",
    );

    const { findings, said } = sorted(text, { "B-2": { unreadable: "it has no VERDICT line" } });

    assert.deepEqual(
      findings.map((f) => f.verdicts),
      [[null], [null]],
    );
    assert.deepEqual(said, []);
  });

  test("gives the ties of the AFFECTS lines, a finding merged into another counting as that one", () => {
    const text = record(
      "3 · confirmed 3 · refuted 0 · unsure 0 · no report 0",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
      "  AFFECTS: B-4: both fixes change the same method.",
      B4,
      "  AFFECTS: B-1: both fixes change the same method.",
      "B-5 · nit · confirmed · cleanup · a.cs:5 · in the chapter",
      "  AFFECTS: B-3: it uses what the merged one removes.",
    );

    const { ties } = sorted(text, {});

    assert.deepEqual(ties, [
      ["B-1", "B-4"],
      ["B-4", "B-1"],
      ["B-5", "B-1"],
    ]);
  });

  test("with the sorting: a fixed finding waits for the asked one that a line under either of them ties it to", () => {
    const text = record(
      "4 · confirmed 3 · refuted 0 · unsure 1 · no report 0",
      ...B1,
      "  MERGED: B-3 · src/App/Mapping.cs:44",
      B4,
      "  AFFECTS: B-6: the sentence names what that fix renames.",
      "B-5 · nit · confirmed · cleanup · a.cs:5 · in the chapter",
      "B-6 · nit · unsure · not applicable · a.cs:6 · in the chapter",
      "  AFFECTS: B-3: whether it holds decides how the merged one is fixed.",
    );

    const { findings, groups, ties } = sorted(text, {
      "B-1": confirmed(),
      "B-3": confirmed(),
      "B-4": confirmed("docs"),
      "B-5": confirmed("cleanup"),
      "B-6": unsure(),
    });
    const routed = route(findings, groups);

    assert.deepEqual(routeReport(routed, waiting(routed, groups, ties)), [
      "B-1, B-3 → FIX · behaviour",
      "B-4 → FIX · docs",
      "B-5 → FIX · cleanup",
      "B-6 → ASK · unsure",
      "B-1, B-3: waits for B-6",
      "B-4: waits for B-6",
      "FIX 3 · DECLINE 0 · ASK 1",
    ]);
  });
});
