// Tests for route.mjs's pure functions: every sorting rule, the order the rules are applied in, the wording when
// only one of two checks says something, every input that is refused, how a check's report is read into a verdict
// (the first check's and the second's, and every report that cannot be read), what a report must say to be saved
// as a finding's report file, and the lines `tdd.mjs route` prints. Objects and texts in, objects and lines out:
// nothing here touches a file or git, and every id, path and report is made up. (That the command reads its input
// from --json, --in, --stdin and a folder of report files, and that `tdd.mjs report` writes such a file, is tested
// in tdd.test.mjs.)
//
//   node --test ".claude/skills/tdd-apply/scripts/*.test.mjs"
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  OUTCOMES,
  readFindings,
  readReport,
  readReportOf,
  reportFile,
  reportOf,
  route,
  routeFinding,
  routeReport,
} from "./route.mjs";

// A confirmed verdict whose fix is the smallest there is, changed by `more`.
const confirmed = (more = {}) => ({
  verdict: "confirmed",
  evidence: true,
  kind: "behaviour",
  local: true,
  size: "small",
  specBehaviour: false,
  contractChange: false,
  ...more,
});
const refuted = (evidence = true) => ({ verdict: "refuted", evidence });
const unsure = () => ({ verdict: "unsure" });

// A finding with these verdicts, as `readFindings` hands it on.
const finding = (verdicts, more = {}) => ({ id: "B-1", outside: false, reviewerDisagrees: false, verdicts, ...more });
const routed = (verdicts, more) => routeFinding(finding(verdicts, more));
const asks = (reason) => ({ outcome: "ASK", reason });

describe("routeFinding: each rule", () => {
  test("1: a check that returned no result is asked about", () => {
    assert.deepEqual(routed([null]), asks("a check returned no result"));
    assert.deepEqual(routed([confirmed(), null]), asks("a check returned no result"));
    assert.deepEqual(routed([null, refuted()]), asks("a check returned no result"));
    assert.deepEqual(routed([null, null]), asks("a check returned no result"));
  });

  test("2: an unsure verdict is asked about", () => {
    assert.deepEqual(routed([unsure()]), asks("unsure"));
    assert.deepEqual(routed([confirmed(), unsure()]), asks("unsure"));
    assert.deepEqual(routed([unsure(), unsure()]), asks("unsure"));
  });

  test("3: two verdicts that differ are asked about", () => {
    assert.deepEqual(routed([confirmed(), refuted()]), asks("the two checks disagree on the verdict"));
    assert.deepEqual(routed([refuted(), confirmed()]), asks("the two checks disagree on the verdict"));
  });

  test("4: a finding whose second check disagrees with the first is asked about, with what it disagrees on", () => {
    const second = (verdict, disagrees) => ({ ...verdict, disagrees });

    assert.deepEqual(
      routed([confirmed(), second(confirmed(), "the fix also changes the made-up contract")]),
      asks("the second check disagrees with the first: the fix also changes the made-up contract"),
    );
    assert.deepEqual(
      routed([refuted(), second(refuted(), "the guard it cites does not cover an empty list")]),
      asks("the second check disagrees with the first: the guard it cites does not cover an empty list"),
    );
    assert.deepEqual(
      routed([confirmed(), second(confirmed(), true)]),
      asks("the second check disagrees with the first"),
    );
  });

  test("4: a second check that agrees, or says nothing of it, decides nothing", () => {
    const fixed = { outcome: "FIX", reason: "behaviour" };

    assert.deepEqual(routed([confirmed(), { ...confirmed(), disagrees: false }]), fixed);
    assert.deepEqual(routed([confirmed(), confirmed()]), fixed);
    assert.deepEqual(routed([confirmed()]), fixed);
    assert.equal(routed([refuted(), { ...refuted(), disagrees: false }]).outcome, "DECLINE");
  });

  test("4: the second check's words are put on one line and cut at 120 characters", () => {
    const long = "a".repeat(119) + "bcd";
    const reasonOf = (disagrees) => routed([confirmed(), { ...confirmed(), disagrees }]).reason;

    assert.equal(
      reasonOf("  the size:\n  it is   large  "),
      "the second check disagrees with the first: the size: it is large",
    );
    assert.equal(reasonOf("a".repeat(120)), `the second check disagrees with the first: ${"a".repeat(120)}`);
    assert.equal(reasonOf(long), `the second check disagrees with the first: ${"a".repeat(119)}b…`);
  });

  test("5: a finding the reviewer still disagrees on is asked about, confirmed or refuted", () => {
    const disagrees = { reviewerDisagrees: true };

    assert.deepEqual(routed([confirmed()], disagrees), asks("the reviewer disagrees with the verifier"));
    assert.deepEqual(routed([refuted()], disagrees), asks("the reviewer disagrees with the verifier"));
  });

  test("6: a refuted finding is declined when every verdict has evidence, and asked about otherwise", () => {
    const declined = { outcome: "DECLINE", reason: "refuted with evidence" };

    assert.deepEqual(routed([refuted()]), declined);
    assert.deepEqual(routed([refuted(), refuted()]), declined);
    assert.deepEqual(routed([refuted(false)]), asks("refuted without concrete evidence"));
    assert.deepEqual(routed([refuted(), refuted(false)]), asks("refuted without concrete evidence"));
    assert.deepEqual(routed([refuted(false), refuted()]), asks("refuted without concrete evidence"));
  });

  test("7: two confirmed verdicts of different kinds are asked about", () => {
    assert.deepEqual(
      routed([confirmed({ kind: "behaviour" }), confirmed({ kind: "docs" })]),
      asks("the two checks disagree on the kind"),
    );
  });

  test("8: a fix that changes behaviour a spec describes is asked about", () => {
    const spec = confirmed({ specBehaviour: true });

    assert.deepEqual(routed([spec]), asks("the fix changes behaviour a spec describes"));
    assert.deepEqual(routed([spec, spec]), asks("the fix changes behaviour a spec describes"));
  });

  test("9: a fix that changes the API contract is asked about", () => {
    const contract = confirmed({ contractChange: true });

    assert.deepEqual(routed([contract]), asks("the fix changes the API contract"));
    assert.deepEqual(routed([contract, contract]), asks("the fix changes the API contract"));
  });

  test("10: a fix that is not local is asked about", () => {
    const wide = confirmed({ local: false });

    assert.deepEqual(routed([wide]), asks("the fix is not local"));
    assert.deepEqual(routed([wide, wide]), asks("the fix is not local"));
  });

  test("11: a large fix is asked about, a medium one is not", () => {
    const large = confirmed({ size: "large" });

    assert.deepEqual(routed([large]), asks("a large fix"));
    assert.deepEqual(routed([large, large]), asks("a large fix"));
    assert.equal(routed([confirmed({ size: "medium" })]).outcome, "FIX");
  });

  test("12: a confirmed finding outside the chapter is asked about", () => {
    assert.deepEqual(routed([confirmed()], { outside: true }), asks("outside the chapter"));
  });

  test("13: any other confirmed finding is fixed, with its kind", () => {
    for (const kind of ["behaviour", "test-quality", "docs", "cleanup"]) {
      assert.deepEqual(routed([confirmed({ kind })]), { outcome: "FIX", reason: kind });
      assert.deepEqual(routed([confirmed({ kind }), confirmed({ kind })]), { outcome: "FIX", reason: kind });
    }
  });

  test("evidence decides nothing for a confirmed finding", () => {
    assert.equal(routed([confirmed({ evidence: false })]).outcome, "FIX");
    assert.equal(routed([confirmed({ evidence: false }), confirmed({ evidence: true })]).outcome, "FIX");
  });

  test("a refuted finding outside the chapter is still declined: `outside` is about a fix", () => {
    assert.equal(routed([refuted()], { outside: true }).outcome, "DECLINE");
  });
});

describe("routeFinding: when only one of two checks says so", () => {
  for (const [name, more, reason] of [
    ["8", { specBehaviour: true }, "the fix changes behaviour a spec describes"],
    ["9", { contractChange: true }, "the fix changes the API contract"],
    ["10", { local: false }, "the fix is not local"],
    ["11", { size: "large" }, "a large fix"],
  ]) {
    test(`${name}: the reason ends with the disagreement, whichever check says it`, () => {
      const disagreeing = asks(`${reason}, and the two checks disagree on it`);

      assert.deepEqual(routed([confirmed(more), confirmed()]), disagreeing);
      assert.deepEqual(routed([confirmed(), confirmed(more)]), disagreeing);
      assert.deepEqual(routed([confirmed(more), confirmed(more)]), asks(reason));
      assert.deepEqual(routed([confirmed(more)]), asks(reason));
    });
  }

  test("a medium and a small fix are no disagreement the owner is asked about", () => {
    assert.equal(routed([confirmed({ size: "medium" }), confirmed({ size: "small" })]).outcome, "FIX");
  });
});

describe("routeFinding: the order of the rules", () => {
  // Everything a confirmed verdict can say that sends its fix to the owner.
  const everything = { specBehaviour: true, contractChange: true, local: false, size: "large" };
  const all = { outside: true, reviewerDisagrees: true };

  test("1 before 2: a missing result wins over an unsure verdict", () => {
    assert.equal(routed([unsure(), null], all).reason, "a check returned no result");
  });

  test("2 before 3: an unsure verdict wins over two verdicts that differ", () => {
    assert.equal(routed([unsure(), confirmed(everything)], all).reason, "unsure");
    assert.equal(routed([refuted(), unsure()], all).reason, "unsure");
  });

  // What the second check says of the first, on a verdict.
  const disagreeing = (verdict) => ({ ...verdict, disagrees: "the size" });
  const SECOND = "the second check disagrees with the first: the size";

  test("1, 2 and 3 before 4: a missing result, an unsure verdict and two verdicts that differ win over the second check's disagreement", () => {
    assert.equal(routed([null, disagreeing(confirmed())], all).reason, "a check returned no result");
    assert.equal(routed([confirmed(), disagreeing(unsure())], all).reason, "unsure");
    assert.equal(
      routed([refuted(), disagreeing(confirmed(everything))], all).reason,
      "the two checks disagree on the verdict",
    );
  });

  test("4 before 5: the second check's disagreement wins over the reviewer's", () => {
    assert.equal(routed([confirmed(), disagreeing(confirmed())], all).reason, SECOND);
    assert.equal(routed([refuted(), disagreeing(refuted())], all).reason, SECOND);
  });

  test("4 before 6: the second check's disagreement wins over a decline", () => {
    assert.deepEqual(routed([refuted(), disagreeing(refuted())]), asks(SECOND));
    assert.deepEqual(routed([refuted(false), disagreeing(refuted(false))]), asks(SECOND));
  });

  test("4 before 7 and 8: the second check's disagreement wins over two kinds and over what the fix would be", () => {
    assert.equal(routed([confirmed({ kind: "docs" }), disagreeing(confirmed({ kind: "cleanup" }))]).reason, SECOND);
    assert.equal(routed([confirmed(everything), disagreeing(confirmed(everything))], { outside: true }).reason, SECOND);
    assert.equal(routed([confirmed(), disagreeing(confirmed({ size: "large" }))]).reason, SECOND);
  });

  test("3 before 5: two verdicts that differ win over the reviewer's disagreement", () => {
    assert.equal(routed([refuted(), confirmed(everything)], all).reason, "the two checks disagree on the verdict");
  });

  test("5 before 6: the reviewer's disagreement wins over a decline", () => {
    assert.equal(routed([refuted(), refuted()], all).reason, "the reviewer disagrees with the verifier");
    assert.equal(routed([refuted(false)], all).reason, "the reviewer disagrees with the verifier");
  });

  test("5 before 7: the reviewer's disagreement wins over two kinds", () => {
    assert.equal(
      routed([confirmed({ kind: "docs" }), confirmed({ kind: "cleanup" })], all).reason,
      "the reviewer disagrees with the verifier",
    );
  });

  test("7 before 8: two kinds win over a spec's behaviour", () => {
    assert.equal(
      routed([confirmed({ ...everything, kind: "docs" }), confirmed({ ...everything, kind: "cleanup" })], {
        outside: true,
      }).reason,
      "the two checks disagree on the kind",
    );
  });

  test("8 before 9, 9 before 10, 10 before 11, 11 before 12, 12 before 13", () => {
    const outside = { outside: true };
    const reasonOf = (more) => routed([confirmed(more)], outside).reason;

    assert.equal(reasonOf(everything), "the fix changes behaviour a spec describes");
    assert.equal(reasonOf({ ...everything, specBehaviour: false }), "the fix changes the API contract");
    assert.equal(reasonOf({ local: false, size: "large" }), "the fix is not local");
    assert.equal(reasonOf({ size: "large" }), "a large fix");
    assert.equal(reasonOf({}), "outside the chapter");
    assert.deepEqual(routed([confirmed()]), { outcome: "FIX", reason: "behaviour" });
  });

  test("among 8 to 11, the earlier rule wins also when a later one is said by both checks", () => {
    const r = routed([confirmed({ specBehaviour: true, size: "large" }), confirmed({ size: "large" })]);

    assert.equal(r.reason, "the fix changes behaviour a spec describes, and the two checks disagree on it");
  });
});

describe("readFindings", () => {
  const text = (findings) => JSON.stringify(findings);
  const one = (more = {}) => ({ id: "B-1", verdicts: [confirmed()], ...more });

  test("reads the findings in order, with `outside` and `reviewerDisagrees` false unless given", () => {
    const findings = readFindings(
      text([one(), { id: "B-2", outside: true, reviewerDisagrees: true, verdicts: [refuted(), null] }]),
    );

    assert.deepEqual(findings, [
      { id: "B-1", outside: false, reviewerDisagrees: false, verdicts: [confirmed()] },
      { id: "B-2", outside: true, reviewerDisagrees: true, verdicts: [refuted(), null] },
    ]);
  });

  test("takes an id that is a number, and a text's id without the spaces around it", () => {
    assert.deepEqual(
      readFindings(text([one({ id: 3 }), one({ id: " 14 " })])).map((f) => f.id),
      ["3", "14"],
    );
  });

  test("takes the line with the label the chapter-reviewer's hand-back puts before it", () => {
    assert.equal(readFindings(`ROUTE INPUT: ${text([one()])}`)[0].id, "B-1");
    assert.equal(readFindings(`  ROUTE INPUT:${text([one()])}\n`)[0].id, "B-1");
  });

  test("takes an empty list", () => {
    assert.deepEqual(readFindings("[]"), []);
  });

  test("does not read a field it does not know", () => {
    const findings = readFindings(
      text([one({ title: "a made-up title", verdicts: [confirmed({ sketch: "a made-up sketch" })] })]),
    );

    assert.equal(routeFinding(findings[0]).outcome, "FIX");
  });

  test("does not read a fix's fields of a verdict that is not confirmed, nor evidence unless it is refuted", () => {
    const findings = readFindings(
      text([
        one({ id: 1, verdicts: [{ verdict: "unsure", kind: "nonsense", size: 7 }] }),
        one({ id: 2, verdicts: [{ verdict: "refuted", evidence: false, local: "nonsense" }] }),
        one({ id: 3, verdicts: [confirmed({ evidence: undefined })] }),
      ]),
    );

    assert.deepEqual(
      route(findings).map((r) => r.outcome),
      ["ASK", "ASK", "FIX"],
    );
  });

  test("takes `disagrees` on the second of two verdicts: true, false or the text, whatever the verdict", () => {
    const findings = readFindings(
      text([
        one({ id: 1, verdicts: [confirmed(), confirmed({ disagrees: "the fix is larger than it says" })] }),
        one({ id: 2, verdicts: [confirmed(), confirmed({ disagrees: true })] }),
        one({ id: 3, verdicts: [confirmed(), confirmed({ disagrees: false })] }),
        one({ id: 4, verdicts: [refuted(), { ...refuted(), disagrees: "the test it cites covers another case" }] }),
        one({ id: 5, verdicts: [null, confirmed({ disagrees: true })] }),
      ]),
    );

    assert.deepEqual(routeReport(route(findings)), [
      "1 → ASK · the second check disagrees with the first: the fix is larger than it says",
      "2 → ASK · the second check disagrees with the first",
      "3 → FIX · behaviour",
      "4 → ASK · the second check disagrees with the first: the test it cites covers another case",
      "5 → ASK · a check returned no result",
      "FIX 1 · DECLINE 0 · ASK 4",
    ]);
  });

  describe("refuses, for the whole input, in one line that names the finding and the field", () => {
    const refused = (findings, pattern) => {
      assert.throws(
        () => readFindings(typeof findings === "string" ? findings : text(findings)),
        (e) => {
          assert.match(e.message, pattern);
          assert.equal(e.message.includes("\n"), false, e.message);
          return true;
        },
      );
    };

    test("a text that is no JSON, and JSON that is no list", () => {
      refused("", /not JSON/);
      refused("B-1: confirmed", /not JSON/);
      refused(`${text([one()])} and more`, /not JSON/);
      refused(text(one()), /not a JSON array/);
      refused("null", /not a JSON array/);
    });

    test("an element that is no finding", () => {
      refused([one(), "B-2"], /element 2 .*not a finding/);
      refused([null], /element 1 .*not a finding/);
      refused([[one()]], /element 1 .*not a finding/);
    });

    test("an id that is missing, empty, of several lines or neither a text nor a number", () => {
      refused([one({ id: undefined })], /element 1 of the input: id is missing/);
      refused([one(), one({ id: " " })], /element 2 of the input: id is " "/);
      refused([one({ id: "B\n1" })], /element 1 of the input: id is "B\\n1"/);
      refused([one({ id: true })], /element 1 of the input: id is true/);
      refused([one({ id: null })], /element 1 of the input: id is null/);
    });

    test("an id given twice, also once as a number and once as a text", () => {
      refused([one(), one({ id: "B-2" }), one()], /finding B-1: the id is given twice/);
      refused([one({ id: 4 }), one({ id: "4" })], /finding 4: the id is given twice/);
    });

    test("`outside` or `reviewerDisagrees` that is not true or false", () => {
      refused([one({ outside: "no" })], /finding B-1: outside is "no"; it is true or false/);
      refused([one({ reviewerDisagrees: 1 })], /finding B-1: reviewerDisagrees is 1; it is true or false/);
      refused([one({ outside: null })], /finding B-1: outside is null/);
    });

    test("no verdicts, none in the list, more than two, and a verdict that is no object", () => {
      refused([one({ verdicts: undefined })], /finding B-1: verdicts is missing; it is a list of one or two/);
      refused([one({ verdicts: confirmed() })], /finding B-1: verdicts is \{.*it is a list of one or two/);
      refused([one({ verdicts: [] })], /finding B-1: verdicts holds 0 elements/);
      refused([one({ verdicts: [confirmed(), confirmed(), confirmed()] })], /finding B-1: verdicts holds 3 elements/);
      refused([one({ verdicts: ["confirmed"] })], /finding B-1: verdicts\[0\] is "confirmed"; it is a verdict or null/);
    });

    test("a verdict it does not know, or none", () => {
      refused(
        [one({ verdicts: [confirmed(), { verdict: "real" }] })],
        /finding B-1: verdicts\[1\]\.verdict is "real"; it is one of: confirmed, refuted, unsure/,
      );
      refused([one({ verdicts: [{}] })], /finding B-1: verdicts\[0\]\.verdict is missing/);
    });

    test("a refuted verdict without `evidence`, or with one that is not true or false", () => {
      refused([one({ verdicts: [{ verdict: "refuted" }] })], /finding B-1: verdicts\[0\]\.evidence is missing/);
      refused(
        [one({ verdicts: [refuted(), { verdict: "refuted", evidence: "src/a.cs:3" }] })],
        /finding B-1: verdicts\[1\]\.evidence is "src\/a\.cs:3"; it is true or false/,
      );
    });

    test("`disagrees` that is neither true, false nor a text, and one on another verdict than the second", () => {
      const second = (disagrees) => [one({ verdicts: [confirmed(), confirmed({ disagrees })] })];

      refused(second(1), /finding B-1: verdicts\[1\]\.disagrees is 1; it is true, false or the text/);
      refused(second(""), /finding B-1: verdicts\[1\]\.disagrees is ""; it is true, false or the text of what/);
      refused(second("  "), /finding B-1: verdicts\[1\]\.disagrees is " {2}"; it is true, false or the text/);
      refused(second(null), /finding B-1: verdicts\[1\]\.disagrees is null; it is true, false or the text/);
      refused(
        [one({ verdicts: [confirmed({ disagrees: true }), confirmed()] })],
        /finding B-1: verdicts\[0\]\.disagrees is true; only the second of two verdicts says whether it disagrees/,
      );
      refused(
        [one({ verdicts: [{ verdict: "unsure", disagrees: "the kind" }] })],
        /finding B-1: verdicts\[0\]\.disagrees is "the kind"; only the second of two verdicts/,
      );
    });

    for (const [field, wrong, rule] of [
      ["kind", "bug", /it is one of: behaviour, test-quality, docs, cleanup/],
      ["size", "huge", /it is one of: small, medium, large/],
      ["local", "yes", /it is true or false/],
      ["specBehaviour", 0, /it is true or false/],
      ["contractChange", null, /it is true or false/],
    ]) {
      test(`a confirmed verdict whose ${field} is missing or unknown`, () => {
        const second = (more) => [one({ id: "B-7", verdicts: [confirmed(), confirmed(more)] })];

        refused(second({ [field]: undefined }), new RegExp(`finding B-7: verdicts\\[1\\]\\.${field} is missing`));
        refused(second({ [field]: wrong }), new RegExp(`finding B-7: verdicts\\[1\\]\\.${field} is `));
        refused(second({ [field]: wrong }), rule);
      });
    }

    test("a confirmed verdict's missing field even when an earlier rule would decide the finding", () => {
      refused([one({ verdicts: [null, confirmed({ kind: undefined })] })], /finding B-1: verdicts\[1\]\.kind/);
      refused([one(), one({ id: "B-2", verdicts: [unsure(), confirmed({ size: "?" })] })], /finding B-2: .*size/);
    });
  });
});

describe("readReport", () => {
  // A check's report as a verifier writes it: its labelled lines among the text around them.
  const report = (lines, eol = "\n") =>
    [
      "# Finding 3, first check",
      "",
      "The mapping drops a made-up field.",
      "",
      ...lines,
      "",
      "ALSO NOTICED: nothing.",
    ].join(eol) + eol;
  const CONFIRMED = [
    "VERDICT: confirmed",
    "EVIDENCE: src/App/Mapping.cs:19, and the test A_made_up_test",
    "KIND: behaviour",
    "FIX: local · small · spec behaviour no · contract change no · return the field from the mapping",
  ];
  const withLine = (label, line) =>
    CONFIRMED.map((l) => (l.startsWith(`${label}:`) ? line : l)).filter((l) => l !== null);

  test("reads a confirmed report: the verdict, the evidence, the kind and the fix's four facts", () => {
    assert.deepEqual(readReport(report(CONFIRMED)), {
      verdict: "confirmed",
      evidence: true,
      kind: "behaviour",
      local: true,
      size: "small",
      specBehaviour: false,
      contractChange: false,
    });
  });

  test("reads every word a confirmed report's kind and fix may hold", () => {
    const read = (kind, fix) => readReport(report([CONFIRMED[0], CONFIRMED[1], `KIND: ${kind}`, `FIX: ${fix}`]));

    for (const kind of ["behaviour", "test-quality", "docs", "cleanup"]) {
      assert.equal(read(kind, "local · small · spec behaviour no · contract change no · a sketch").kind, kind);
    }
    assert.deepEqual(read("docs", "not local · large · spec behaviour yes · contract change yes · a sketch"), {
      verdict: "confirmed",
      evidence: true,
      kind: "docs",
      local: false,
      size: "large",
      specBehaviour: true,
      contractChange: true,
    });
    assert.equal(read("docs", "local · medium · spec behaviour no · contract change no · a sketch").size, "medium");
  });

  test("reads a refuted report, whose kind and fix say `not applicable` and are not read", () => {
    const refuted = [
      "VERDICT: refuted",
      "EVIDENCE: design.md D4 decides it",
      "KIND: not applicable",
      "FIX: not applicable",
    ];

    assert.deepEqual(readReport(report(refuted)), { verdict: "refuted", evidence: true });
    assert.deepEqual(readReport(report(refuted.slice(0, 2))), { verdict: "refuted", evidence: true });
    assert.deepEqual(readReport(report([...refuted.slice(0, 2), "KIND: nonsense", "FIX: nonsense"])), {
      verdict: "refuted",
      evidence: true,
    });
  });

  test("reads an unsure report by its verdict alone", () => {
    assert.deepEqual(readReport(report(["VERDICT: unsure"])), { verdict: "unsure" });
    assert.deepEqual(readReport(report(["VERDICT: unsure", "EVIDENCE: none", "KIND: nonsense", "FIX: nonsense"])), {
      verdict: "unsure",
    });
    assert.deepEqual(readReport("VERDICT: unsure"), { verdict: "unsure" });
  });

  test("takes the evidence as false when its text is empty or `none`, in any case, and as true otherwise", () => {
    const evidence = (line) => readReport(report(["VERDICT: refuted", line])).evidence;

    assert.equal(evidence("EVIDENCE:"), false);
    assert.equal(evidence("EVIDENCE:   "), false);
    assert.equal(evidence("EVIDENCE: none"), false);
    assert.equal(evidence("EVIDENCE: None"), false);
    assert.equal(evidence("EVIDENCE:  NONE  "), false);
    assert.equal(evidence("EVIDENCE: none found in src/App/Mapping.cs:19"), true);
    assert.equal(evidence("EVIDENCE: src/App/Mapping.cs:19"), true);
    assert.equal(evidence("EVIDENCE: the test A_made_up_test"), true);
    assert.equal(readReport(report(withLine("EVIDENCE", "EVIDENCE: none"))).evidence, false);
  });

  test("reads a report with a byte-order mark and CRLF line breaks the same", () => {
    assert.deepEqual(readReport(`﻿${report(CONFIRMED, "\r\n")}`), readReport(report(CONFIRMED)));
    assert.deepEqual(readReport(`﻿${CONFIRMED.join("\r\n")}`), readReport(report(CONFIRMED)));
  });

  test("takes any amount of space around the fix's separators and inside its parts, and after a label", () => {
    const spaced = "FIX:not  local·medium   ·   spec   behaviour  yes ·contract change   no·a sketch";

    assert.deepEqual(readReport(report(["VERDICT:confirmed", "EVIDENCE:x", "KIND:  cleanup ", spaced])), {
      verdict: "confirmed",
      evidence: true,
      kind: "cleanup",
      local: false,
      size: "medium",
      specBehaviour: true,
      contractChange: false,
    });
  });

  test("does not read the fix's sketch: one with separators of its own, an empty one, or none", () => {
    const fix = "FIX: local · small · spec behaviour no · contract change no";
    const expected = readReport(report(CONFIRMED));

    assert.deepEqual(readReport(report(withLine("FIX", `${fix} · move A · then B · large`))), expected);
    assert.deepEqual(readReport(report(withLine("FIX", `${fix} ·`))), expected);
    assert.deepEqual(readReport(report(withLine("FIX", fix))), expected);
  });

  test("does not read a line that is not labelled, nor a label that is not first on its line", () => {
    const text = report([
      "> VERDICT: refuted",
      "  VERDICT: refuted",
      "- KIND: docs",
      "**FIX:** not local · large · spec behaviour yes · contract change yes · quoted",
      "verdict: refuted",
      "The first check's VERDICT: refuted, which this one overturns.",
      ...CONFIRMED,
    ]);

    assert.deepEqual(readReport(text), readReport(report(CONFIRMED)));
  });

  describe("refuses, in one line, a text that cannot be read as a report", () => {
    const refused = (lines, pattern) => {
      assert.throws(
        () => readReport(Array.isArray(lines) ? report(lines) : lines),
        (e) => {
          assert.match(e.message, pattern);
          assert.equal(e.message.includes("\n"), false, e.message);
          return true;
        },
      );
    };

    test("no verdict: an empty text, a text without labels, a label of another case", () => {
      refused("", /^it has no VERDICT line$/);
      refused("The finding is real.\n", /^it has no VERDICT line$/);
      refused(["Verdict: confirmed", ...CONFIRMED.slice(1)], /^it has no VERDICT line$/);
    });

    test("a verdict that is not one of the three words", () => {
      refused(withLine("VERDICT", "VERDICT: real"), /^VERDICT is "real"; it is one of: confirmed, refuted, unsure$/);
      refused(withLine("VERDICT", "VERDICT: Confirmed"), /^VERDICT is "Confirmed"/);
      refused(withLine("VERDICT", "VERDICT: confirmed, mostly"), /^VERDICT is "confirmed, mostly"/);
      refused(withLine("VERDICT", "VERDICT:"), /^VERDICT is ""/);
    });

    test("a label given twice", () => {
      refused([...CONFIRMED, "VERDICT: refuted"], /^VERDICT is given twice$/);
      refused([...CONFIRMED, CONFIRMED[3]], /^FIX is given twice$/);
    });

    test("a line that holds a long text, of which it quotes 80 characters, so that what the line may hold still fits", () => {
      const long = "a made-up sketch that goes on and on, ".repeat(8).trim();
      const quoted = `"${long.slice(0, 80)}…"`;

      refused(
        withLine("FIX", `FIX: ${long}`),
        new RegExp(`^FIX is ${quoted}; it is <local \\| not local> · .* · <sketch>$`),
      );
      refused(
        withLine("KIND", `KIND: ${long}`),
        new RegExp(`^KIND is ${quoted}; it is one of: behaviour, test-quality, docs, cleanup$`),
      );
      refused(withLine("KIND", `KIND: ${"k".repeat(80)}`), new RegExp(`^KIND is "${"k".repeat(80)}"; it is one of: `));
    });

    test("a refuted or a confirmed report without its evidence line", () => {
      refused(["VERDICT: refuted", "KIND: not applicable", "FIX: not applicable"], /^it has no EVIDENCE line$/);
      refused(withLine("EVIDENCE", null), /^it has no EVIDENCE line$/);
    });

    test("a confirmed report without its kind, or with one that is not a kind", () => {
      refused(withLine("KIND", null), /^it has no KIND line$/);
      refused(withLine("KIND", "KIND: bug"), /^KIND is "bug"; it is one of: behaviour, test-quality, docs, cleanup$/);
      refused(withLine("KIND", "KIND: not applicable"), /^KIND is "not applicable"; it is one of: /);
      refused(withLine("KIND", "KIND: Behaviour"), /^KIND is "Behaviour"/);
    });

    test("a confirmed report without its fix, or with one of fewer than its four facts", () => {
      refused(withLine("FIX", null), /^it has no FIX line$/);
      refused(withLine("FIX", "FIX: not applicable"), /^FIX is "not applicable"; it is <local \| not local> · /);
      refused(withLine("FIX", "FIX: local · small · spec behaviour no"), /^FIX is "local · small · spec behaviour no"/);
      refused(
        withLine("FIX", "FIX: local, small, spec behaviour no, contract change no, a sketch"),
        /^FIX is "local, /,
      );
      refused(withLine("FIX", "FIX: local - small - spec behaviour no - contract change no - a sketch"), /^FIX is /);
    });

    for (const [name, fix, pattern] of [
      [
        "first",
        "nearly local · small · spec behaviour no · contract change no · x",
        /^FIX's first part is "nearly local"; it is one of: local, not local$/,
      ],
      [
        "second",
        "local · tiny · spec behaviour no · contract change no · x",
        /^FIX's second part is "tiny"; it is one of: small, medium, large$/,
      ],
      [
        "third",
        "local · small · spec behaviour maybe · contract change no · x",
        /^FIX's third part is "spec behaviour maybe"; it is one of: spec behaviour yes, spec behaviour no$/,
      ],
      ["third", "local · small · no · contract change no · x", /^FIX's third part is "no"/],
      ["third", "local · small · spec behavior no · contract change no · x", /^FIX's third part is "spec behavior no"/],
      [
        "fourth",
        "local · small · spec behaviour no · contract change · x",
        /^FIX's fourth part is "contract change"; it is one of: contract change yes, contract change no$/,
      ],
      ["fourth", "local · small · spec behaviour no · contract yes · x", /^FIX's fourth part is "contract yes"/],
      ["first", "small · local · spec behaviour no · contract change no · x", /^FIX's first part is "small"/],
    ]) {
      test(`a fix whose ${name} part is not one of its words: ${fix.split(" · ")[["first", "second", "third", "fourth"].indexOf(name)]}`, () => {
        refused(withLine("FIX", `FIX: ${fix}`), pattern);
      });
    }
  });

  describe("the second check's report", () => {
    const REFUTED = ["VERDICT: refuted", "EVIDENCE: design.md D4 decides it", "KIND: not applicable"];
    const second = (lines, firstPass) => readReport(report([...lines, `FIRST PASS: ${firstPass}`]), 2);

    test("says whether it disagrees with the first: false for `agrees`, else the text of what it disagrees on", () => {
      const first = readReport(report(CONFIRMED));

      assert.deepEqual(second(CONFIRMED, "agrees"), { ...first, disagrees: false });
      assert.deepEqual(second(CONFIRMED, "disagrees: the fix also changes the made-up contract"), {
        ...first,
        disagrees: "the fix also changes the made-up contract",
      });
      assert.deepEqual(second(REFUTED, "agrees"), { verdict: "refuted", evidence: true, disagrees: false });
      assert.deepEqual(second(REFUTED, "disagrees: the guard it cites is never reached"), {
        verdict: "refuted",
        evidence: true,
        disagrees: "the guard it cites is never reached",
      });
      assert.deepEqual(second(["VERDICT: unsure"], "disagrees: it is not settled"), {
        verdict: "unsure",
        disagrees: "it is not settled",
      });
    });

    test("takes any amount of space in the line, and the line wherever it stands among the others", () => {
      assert.equal(second(CONFIRMED, "  agrees  ").disagrees, false);
      assert.equal(second(CONFIRMED, "disagrees:   the   size,\tit is large ").disagrees, "the size, it is large");
      assert.equal(second(CONFIRMED, "disagrees:the size").disagrees, "the size");
      assert.equal(readReport(report(["FIRST PASS: agrees", ...CONFIRMED]), 2).disagrees, false);
      assert.equal(readReport(`﻿${[...CONFIRMED, "FIRST PASS:agrees"].join("\r\n")}\r\n`, 2).disagrees, false);
    });

    describe("refuses, in one line", () => {
      const refused = (lines, check, pattern) => {
        assert.throws(
          () => readReport(report(lines), check),
          (e) => {
            assert.match(e.message, pattern);
            assert.equal(e.message.includes("\n"), false, e.message);
            return true;
          },
        );
      };
      const NO_LINE =
        /^it has no FIRST PASS line, which a second check's report ends with: agrees \| disagrees: <on what>$/;

      test("a second check's report without its FIRST PASS line, whatever its verdict", () => {
        refused(CONFIRMED, 2, NO_LINE);
        refused(REFUTED, 2, NO_LINE);
        refused(["VERDICT: unsure"], 2, NO_LINE);
        refused([...CONFIRMED, "First pass: agrees"], 2, NO_LINE);
        refused([...CONFIRMED, "  FIRST PASS: agrees"], 2, NO_LINE);
      });

      test("a FIRST PASS line that says neither `agrees` nor on what it disagrees", () => {
        for (const said of [
          "",
          "disagrees",
          "disagrees:",
          "Agrees",
          "agrees.",
          "agrees, mostly",
          "yes",
          "disagrees - the size",
        ]) {
          refused(
            [...CONFIRMED, `FIRST PASS: ${said}`],
            2,
            new RegExp(`^FIRST PASS is "${said}"; it is agrees \\| disagrees: <on what>$`),
          );
        }
      });

      test("a FIRST PASS line given twice", () => {
        refused(
          [...CONFIRMED, "FIRST PASS: agrees", "FIRST PASS: disagrees: the size"],
          2,
          /^FIRST PASS is given twice$/,
        );
      });

      test("what is wrong with the verdict or the fix before what is wrong with the FIRST PASS line", () => {
        refused([...withLine("KIND", "KIND: bug"), "FIRST PASS: maybe"], 2, /^KIND is "bug"/);
        refused(withLine("VERDICT", null), 2, /^it has no VERDICT line$/);
      });

      test("a first check's report that has a FIRST PASS line, which is the second's alone", () => {
        const theSecondsAlone = /^it has a FIRST PASS line, which only a second check's report has$/;

        refused([...CONFIRMED, "FIRST PASS: agrees"], 1, theSecondsAlone);
        refused([...REFUTED, "FIRST PASS: disagrees: the size"], 1, theSecondsAlone);
        refused([...CONFIRMED, "FIRST PASS: agrees"], undefined, theSecondsAlone); // the first check's by default
      });
    });
  });

  test("names a finding's two report files", () => {
    assert.equal(reportFile("3", 1), "3-1.md");
    assert.equal(reportFile("B-2", 2), "B-2-2.md");
  });

  test("reads the finding and the check back from a report file's name, and nothing from any other name", () => {
    assert.deepEqual(reportOf("3-1.md"), { id: "3", check: 1 });
    assert.deepEqual(reportOf("3-2.md"), { id: "3", check: 2 });
    assert.deepEqual(reportOf("B-2-2.md"), { id: "B-2", check: 2 });
    assert.deepEqual(reportOf("a_made.up-id-1.md"), { id: "a_made.up-id", check: 1 });
    assert.deepEqual(reportOf(reportFile("14", 2)), { id: "14", check: 2 });
    for (const name of [
      "3.md",
      "3-3.md",
      "3-0.md",
      "3-1.MD",
      "3-1.md.txt",
      "3-1.txt",
      "-1.md",
      "notes.md",
      "3 -1.md",
      "3-1 .md",
      "reports/3-1.md",
      "..\\3-1.md",
      "",
      undefined,
    ]) {
      assert.equal(reportOf(name), null, String(name));
    }
  });

  describe("readReportOf: a report that is saved as a finding's report file", () => {
    const first = { id: "3", check: 1 };
    const second = { id: "3", check: 2 };
    const saved = (lines) => `${lines.join("\n")}\n`;

    test("is read as `readReport` reads it, when its ID line names the finding of the file", () => {
      assert.deepEqual(readReportOf(saved(["ID: 3", ...CONFIRMED]), first), readReport(report(CONFIRMED)));
      assert.deepEqual(readReportOf(saved(["ID:   3  ", ...CONFIRMED, "FIRST PASS: agrees"]), second), {
        ...readReport(report(CONFIRMED)),
        disagrees: false,
      });
      assert.deepEqual(readReportOf(saved(["ID: B-2", "VERDICT: unsure"]), { id: "B-2", check: 1 }), {
        verdict: "unsure",
      });
      assert.deepEqual(
        readReportOf(`﻿${["ID: 3", ...CONFIRMED].join("\r\n")}\r\n`, first),
        readReport(report(CONFIRMED)),
      );
    });

    describe("refuses, in one line that names the line that is wrong", () => {
      const refused = (lines, of, pattern) => {
        assert.throws(
          () => readReportOf(saved(lines), of),
          (e) => {
            assert.match(e.message, pattern);
            assert.equal(e.message.includes("\n"), false, e.message);
            return true;
          },
        );
      };

      test("a report without an ID line, with two, or with the id of another finding", () => {
        refused(CONFIRMED, first, /^it has no ID line$/);
        refused(["Id: 3", ...CONFIRMED], first, /^it has no ID line$/);
        refused(["ID: 3", ...CONFIRMED, "ID: 3"], first, /^ID is given twice$/);
        refused(["ID: 4", ...CONFIRMED], first, /^ID is "4"; it is 3, the finding that 3-1\.md is about$/);
        refused(["ID: #3", ...CONFIRMED], first, /^ID is "#3"; it is 3, the finding that 3-1\.md is about$/);
        refused(["ID: finding 3", ...CONFIRMED], first, /^ID is "finding 3"; it is 3, /);
        refused(
          ["ID:", ...CONFIRMED, "FIRST PASS: agrees"],
          second,
          /^ID is ""; it is 3, the finding that 3-2\.md is about$/,
        );
      });

      test("everything `readReport` refuses, for the check the file's name says", () => {
        refused(["ID: 3", ...withLine("KIND", "KIND: bug")], first, /^KIND is "bug"; it is one of: /);
        refused(["ID: 3"], first, /^it has no VERDICT line$/);
        refused(["ID: 3", ...CONFIRMED], second, /^it has no FIRST PASS line, /);
        refused(["ID: 3", ...CONFIRMED, "FIRST PASS: agrees"], first, /^it has a FIRST PASS line, /);
        refused(["ID: 3", ...CONFIRMED, "FIRST PASS: perhaps"], second, /^FIRST PASS is "perhaps"; /);
      });
    });
  });

  test("gives verdicts the rules take as they are", () => {
    const refuted = { verdict: "refuted", evidence: true };

    assert.deepEqual(
      routed([
        readReport(report(CONFIRMED)),
        readReport(report([...CONFIRMED, "FIRST PASS: disagrees: the fix is not small"]), 2),
      ]),
      asks("the second check disagrees with the first: the fix is not small"),
    );
    assert.deepEqual(
      routed([readReport(report(CONFIRMED)), readReport(report([...CONFIRMED, "FIRST PASS: agrees"]), 2)]),
      { outcome: "FIX", reason: "behaviour" },
    );
    assert.deepEqual(routed([readReport(report(CONFIRMED)), readReport(report(CONFIRMED))]), {
      outcome: "FIX",
      reason: "behaviour",
    });
    assert.deepEqual(routed([readReport(report(CONFIRMED)), refuted]), asks("the two checks disagree on the verdict"));
    assert.deepEqual(routed([readReport(report(CONFIRMED)), null]), asks("a check returned no result"));
    assert.deepEqual(
      routed([
        readReport(report(CONFIRMED)),
        readReport(report(withLine("FIX", "FIX: not local · small · spec behaviour no · contract change no · x"))),
      ]),
      asks("the fix is not local, and the two checks disagree on it"),
    );
  });
});

describe("routeReport", () => {
  test("prints one line per finding in the input's order, then the three counts", () => {
    const findings = readFindings(
      JSON.stringify([
        { id: "B-1", verdicts: [confirmed()] },
        { id: "B-2", verdicts: [refuted()] },
        { id: "B-3", verdicts: [confirmed({ local: false })] },
      ]),
    );

    assert.deepEqual(routeReport(route(findings)), [
      "B-1 → FIX · behaviour",
      "B-2 → DECLINE · refuted with evidence",
      "B-3 → ASK · the fix is not local",
      "FIX 1 · DECLINE 1 · ASK 1",
    ]);
  });

  test("prints the counts alone for no finding, each outcome named", () => {
    assert.deepEqual(OUTCOMES, ["FIX", "DECLINE", "ASK"]);
    assert.deepEqual(routeReport(route([])), ["FIX 0 · DECLINE 0 · ASK 0"]);
  });

  test("counts every finding of an outcome", () => {
    const findings = [1, 2, 3].map((id) => finding([confirmed({ kind: "docs" })], { id: String(id) }));

    assert.deepEqual(routeReport(route([...findings, finding([unsure(), null], { id: "4" })])), [
      "1 → FIX · docs",
      "2 → FIX · docs",
      "3 → FIX · docs",
      "4 → ASK · a check returned no result",
      "FIX 3 · DECLINE 0 · ASK 1",
    ]);
  });
});
