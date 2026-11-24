// The sorting rules of a review's findings, one rule set for /tdd-apply's chapter review and /triage-review: whether
// a checked finding is fixed, declined or asked about (`tdd.mjs route`). Texts and objects in, objects and lines
// out: nothing here reads a file or calls git, so the tests call the rules directly.
//
// The input is a JSON array with one element per finding, and it carries no free text:
//
//   [{ "id": "B-1", "outside": false, "reviewerDisagrees": false,
//      "verdicts": [{ "verdict": "confirmed", "evidence": true, "kind": "behaviour",
//                     "local": true, "size": "small", "specBehaviour": false, "contractChange": false }] }]
//
// - `id`: a text or a number. `outside` (default false): the finding lies outside the chapter. `reviewerDisagrees`
//   (default false): the reviewer still disagrees with the verifier.
// - `verdicts`: one check's verdict in the chapter review, two in the triage (the first pass, the second pass). An
//   element may be null: that check returned no result.
// - `verdict`: confirmed, refuted or unsure. A refuted verdict needs `evidence`: whether its report cites something
//   concrete and checkable. A confirmed verdict needs the other five fields, which are not read otherwise.
// - `disagrees` (the second of two verdicts only, default false): whether the second check, which read the first
//   one's report, disagrees with it. True, false, or the text of what it disagrees on, which the reason then
//   carries. The second check exists to overturn the first, so its own word goes to the owner even where the two
//   verdicts and every field of the two fixes are the same.
// - A field the rules do not know is not read. A value they do not know, a missing field, no verdict, more than
//   two, `disagrees` on another verdict than the second, or an id given twice is refused for the whole input, in
//   one line that names the finding and the field.
//
// In the triage the verdicts come from files instead: each of a finding's two checks saves its report as a file,
// `<id>-1.md` (the first check) and `<id>-2.md` (the second), and `readReport` turns a report into a verdict, so
// that no model retypes one. A report is labelled lines, the label first on its line; every other line is not
// read:
//
//   VERDICT: confirmed | refuted | unsure
//   EVIDENCE: <text>        (`evidence` is false when the text is empty or `none`, in any case; true otherwise)
//   KIND: behaviour | test-quality | docs | cleanup | not applicable
//   FIX: <local | not local> · <small | medium | large> · spec behaviour <yes | no> · contract change <yes | no> ·
//        <one-line sketch>   (all on one line; the separator is the middle dot, with any space around it)
//   FIRST PASS: agrees | disagrees: <on what>        (the second check's report only, and there always)
//
// An unsure report needs its VERDICT only, a refuted one EVIDENCE too (its KIND and FIX say `not applicable` and
// are not read), a confirmed one all four, in exactly these words. A second check's report needs its FIRST PASS
// line whatever its verdict: that line is what the second check is for. A first check's report has none. A report
// that says anything else cannot be read: its check counts as one that returned no result, which rule 1 sends to
// the owner.
//
// A check saves its report through `tdd.mjs report`, which reads it with the same code before it writes the file
// (`readReportOf`): the file's name says the finding and the check (`reportOf`), and the report's `ID:` line must
// name that finding. So a report that cannot be read is refused while its writer can still correct it.
//
// RULES below is the order: the first rule that matches decides.

export const OUTCOMES = ["FIX", "DECLINE", "ASK"];
const VERDICTS = ["confirmed", "refuted", "unsure"];
const KINDS = ["behaviour", "test-quality", "docs", "cleanup"];
const SIZES = ["small", "medium", "large"];

// The label the chapter-reviewer's hand-back puts before its input line; the line may be passed with it.
const LABEL = /^\s*ROUTE INPUT:/;

// What a confirmed finding's fix may be that sends it to the owner, in the rules' order: which verdicts say so,
// and the reason.
const FIX_QUESTIONS = [
  [(v) => v.specBehaviour, "the fix changes behaviour a spec describes"],
  [(v) => v.contractChange, "the fix changes the API contract"],
  [(v) => !v.local, "the fix is not local"],
  [(v) => v.size === "large", "a large fix"],
];

const ask = (reason) => ({ outcome: "ASK", reason });
const differ = (verdicts, field) => new Set(verdicts.map((v) => v[field])).size > 1;

// What rule 4's reason says, and the most characters of the second check's own words it carries after that.
const SECOND_DISAGREES = "the second check disagrees with the first";
const ON_WHAT = 120;

// The second check's words on what it disagrees with, on one line and cut when long.
const onWhat = (said) => {
  const words = said.trim().replace(/\s+/g, " ");
  return words.length > ON_WHAT ? `${words.slice(0, ON_WHAT)}…` : words;
};

// The rules, in order. Each answers the outcome and its reason, or nothing when it does not match. From rule 2 on
// every verdict is there, from rule 4 on the verdicts agree, and from rule 7 on they are confirmed.
const RULES = [
  // 1
  ({ verdicts }) => verdicts.includes(null) && ask("a check returned no result"),
  // 2
  ({ verdicts }) => verdicts.some((v) => v.verdict === "unsure") && ask("unsure"),
  // 3
  ({ verdicts }) => differ(verdicts, "verdict") && ask("the two checks disagree on the verdict"),
  // 4: the second check's own word on the first, with what it disagrees on when it says so
  ({ verdicts }) => {
    const said = verdicts[1]?.disagrees;
    if (!said) return false;
    return ask(said === true ? SECOND_DISAGREES : `${SECOND_DISAGREES}: ${onWhat(said)}`);
  },
  // 5
  ({ reviewerDisagrees }) => reviewerDisagrees && ask("the reviewer disagrees with the verifier"),
  // 6
  ({ verdicts }) => {
    if (verdicts[0].verdict !== "refuted") return false;
    return verdicts.every((v) => v.evidence)
      ? { outcome: "DECLINE", reason: "refuted with evidence" }
      : ask("refuted without concrete evidence");
  },
  // 7
  ({ verdicts }) => differ(verdicts, "kind") && ask("the two checks disagree on the kind"),
  // 8 to 11: when only one of two checks says so, the reason says that too
  ({ verdicts }) => {
    for (const [says, reason] of FIX_QUESTIONS) {
      const saying = verdicts.filter(says).length;
      if (saying > 0) return ask(saying < verdicts.length ? `${reason}, and the two checks disagree on it` : reason);
    }
    return false;
  },
  // 12
  ({ outside }) => outside && ask("outside the chapter"),
  // 13
  ({ verdicts }) => ({ outcome: "FIX", reason: verdicts[0].kind }),
];

// One finding's outcome (FIX, DECLINE or ASK) and its reason; a FIX's reason is the fix's kind. The finding is
// one that `readFindings` let through.
export function routeFinding(finding) {
  for (const rule of RULES) {
    const decided = rule(finding);
    if (decided) return decided;
  }
  throw new Error("no rule matched"); // the last rule always does
}

// Every finding with its outcome and reason, in the input's order.
export function route(findings) {
  return findings.map((finding) => ({ id: finding.id, ...routeFinding(finding) }));
}

// The lines `route` prints: one per finding, `<id> → <outcome> · <reason>`, then the three counts.
export function routeReport(routed) {
  const count = (outcome) => routed.filter((r) => r.outcome === outcome).length;
  return [
    ...routed.map((r) => `${r.id} → ${r.outcome} · ${r.reason}`),
    OUTCOMES.map((outcome) => `${outcome} ${count(outcome)}`).join(" · "),
  ];
}

// The findings an input text holds, checked: each with its id as text, `outside` and `reviewerDisagrees` as true
// or false, and its verdicts as given (a second verdict's `disagrees` too). Throws with one line for an input the
// rules cannot read.
export function readFindings(text) {
  let input;
  try {
    input = JSON.parse(String(text ?? "").replace(LABEL, ""));
  } catch (e) {
    throw new Error(`the input is not JSON: ${e.message}`);
  }
  if (!Array.isArray(input)) throw new Error("the input is not a JSON array of findings");
  const seen = new Set();
  return input.map((given, i) => {
    const finding = readFinding(given, `element ${i + 1}`);
    if (seen.has(finding.id)) throw new Error(`finding ${finding.id}: the id is given twice`);
    seen.add(finding.id);
    return finding;
  });
}

// The name of the file that holds a finding's report: of its first check (1) or its second (2).
export const reportFile = (id, check) => `${id}-${check}.md`;

// The finding and the check a report file's name says: `3-1.md` is the first check's report on finding 3,
// `B-2-2.md` the second's on finding B-2. Null for a name of any other form.
export function reportOf(name) {
  const [, id, check] = /^([A-Za-z0-9][A-Za-z0-9._-]*)-([12])\.md$/.exec(String(name ?? "")) ?? [];
  return id === undefined ? null : { id, check: Number(check) };
}

// The labels the rules read in a report, and the one that says whose report it is.
const LABELLED = ["VERDICT", "EVIDENCE", "KIND", "FIX", "FIRST PASS"];
const ID = "ID";
// The shapes of a FIX line and of a FIRST PASS line, for the messages that refuse one.
const FIX_SHAPE =
  "<local | not local> · <small | medium | large> · spec behaviour <yes | no> · contract change <yes | no> · <sketch>";
const FIRST_PASS_SHAPE = "agrees | disagrees: <on what>";

// What a refusal says a line of a report holds: its value, of which a long one is cut. The message goes on to say
// what the line may hold, and the whole of it has to fit the one line a refusal is.
const QUOTED = 80;
const holds = (value) => found(value.length > QUOTED ? `${value.slice(0, QUOTED)}…` : value);

// The values of a text's labelled lines, by label: of each line that starts with one of the labels and a colon,
// what follows, without the space around it and with one space wherever there is any. Every other line is not
// read. The text may start with a byte-order mark and have CRLF line breaks. Throws for a label given twice.
function labelledLines(text, labels) {
  const labelled = {};
  for (const line of String(text ?? "")
    .replace(/^﻿/, "")
    .split(/\r?\n/)) {
    const label = labels.find((l) => line.startsWith(`${l}:`));
    if (label === undefined) continue;
    if (Object.hasOwn(labelled, label)) throw new Error(`${label} is given twice`);
    labelled[label] = line
      .slice(label.length + 1)
      .trim()
      .replace(/\s+/g, " ");
  }
  return labelled;
}

// The verdict a check's report holds, as a finding's `verdicts` take it: the first check's (`check` 1) or the
// second's (2), which also says whether it disagrees with the first (`disagrees`: false, or the text of what it
// disagrees on). The text may start with a byte-order mark and have CRLF line breaks. Throws, with what is wrong
// in one line, for a text that cannot be read as that report: a label missing or given twice, a value that is not
// one of its words, a second check's report without its FIRST PASS line, or a first check's with one.
export function readReport(text, check = 1) {
  const labelled = labelledLines(text, LABELLED);
  const value = (label) => {
    if (!Object.hasOwn(labelled, label)) throw new Error(`it has no ${label} line`);
    return labelled[label];
  };
  const oneOf = (name, given, allowed) => {
    if (!allowed.includes(given)) throw new Error(`${name} ${holds(given)}; it is one of: ${allowed.join(", ")}`);
    return given;
  };

  // What the report says of the finding and its fix.
  const judged = () => {
    const verdict = oneOf("VERDICT", value("VERDICT"), VERDICTS);
    if (verdict === "unsure") return { verdict };
    const evidence = value("EVIDENCE") !== "" && value("EVIDENCE").toLowerCase() !== "none";
    if (verdict === "refuted") return { verdict, evidence };

    const kind = oneOf("KIND", value("KIND"), KINDS);
    const parts = value("FIX")
      .split("·")
      .map((part) => part.trim());
    if (parts.length < 4) throw new Error(`FIX ${holds(value("FIX"))}; it is ${FIX_SHAPE}`);
    const [place, size, spec, contract] = parts;
    const yes = (name, given, words) => oneOf(name, given, [`${words} yes`, `${words} no`]) === `${words} yes`;
    return {
      verdict,
      evidence,
      kind,
      local: oneOf("FIX's first part", place, ["local", "not local"]) === "local",
      size: oneOf("FIX's second part", size, SIZES),
      specBehaviour: yes("FIX's third part", spec, "spec behaviour"),
      contractChange: yes("FIX's fourth part", contract, "contract change"),
    };
  };

  const verdict = judged();
  const said = labelled["FIRST PASS"];
  if (check !== 2) {
    if (said !== undefined) throw new Error("it has a FIRST PASS line, which only a second check's report has");
    return verdict;
  }
  if (said === undefined) {
    throw new Error(`it has no FIRST PASS line, which a second check's report ends with: ${FIRST_PASS_SHAPE}`);
  }
  if (said === "agrees") return { ...verdict, disagrees: false };
  const [, what] = /^disagrees: ?(.+)$/.exec(said) ?? [];
  if (what === undefined) throw new Error(`FIRST PASS ${holds(said)}; it is ${FIRST_PASS_SHAPE}`);
  return { ...verdict, disagrees: what };
}

// The verdict of a report that is to be saved as a finding's report file: `of` is what the file's name says,
// `reportOf`'s answer. It is `readReport`'s for that check, and the report must also say whose it is: its `ID:`
// line names the finding of the file. Throws as `readReport` does, in one line that names the line that is wrong.
export function readReportOf(text, { id, check }) {
  const labelled = labelledLines(text, [ID]);
  if (!Object.hasOwn(labelled, ID)) throw new Error(`it has no ${ID} line`);
  if (labelled[ID] !== id) {
    throw new Error(`${ID} ${holds(labelled[ID])}; it is ${id}, the finding that ${reportFile(id, check)} is about`);
  }
  return readReport(text, check);
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const found = (value) => (value === undefined ? "is missing" : `is ${JSON.stringify(value)}`);

function readFinding(given, place) {
  if (!isObject(given)) throw new Error(`${place} of the input is not a finding: an object with an id and verdicts`);
  const id = typeof given.id === "number" ? String(given.id) : typeof given.id === "string" ? given.id.trim() : "";
  if (!id || /[\r\n]/.test(id)) {
    throw new Error(`${place} of the input: id ${found(given.id)}; it is a text of one line or a number`);
  }
  const refuse = (field, what, rule) => {
    throw new Error(`finding ${id}: ${field} ${what}; ${rule}`);
  };
  const flag = (holder, field, name = field) => {
    if (typeof holder[field] !== "boolean") refuse(name, found(holder[field]), "it is true or false");
    return holder[field];
  };
  const oneOf = (holder, field, allowed, name) => {
    if (!allowed.includes(holder[field])) refuse(name, found(holder[field]), `it is one of: ${allowed.join(", ")}`);
  };

  const { verdicts } = given;
  if (!Array.isArray(verdicts)) refuse("verdicts", found(verdicts), "it is a list of one or two verdicts");
  if (verdicts.length < 1 || verdicts.length > 2) {
    refuse("verdicts", `holds ${verdicts.length} elements`, "it is a list of one or two verdicts");
  }
  verdicts.forEach((verdict, k) => {
    if (verdict === null) return;
    const name = (field) => `verdicts[${k}].${field}`;
    if (!isObject(verdict)) refuse(`verdicts[${k}]`, found(verdict), "it is a verdict or null");
    oneOf(verdict, "verdict", VERDICTS, name("verdict"));
    const said = verdict.disagrees;
    if (said !== undefined && k !== 1) {
      refuse(
        name("disagrees"),
        found(said),
        "only the second of two verdicts says whether it disagrees with the first",
      );
    }
    if (said !== undefined && typeof said !== "boolean" && !(typeof said === "string" && said.trim())) {
      refuse(name("disagrees"), found(said), "it is true, false or the text of what it disagrees on");
    }
    if (verdict.verdict === "refuted") flag(verdict, "evidence", name("evidence"));
    if (verdict.verdict !== "confirmed") return;
    oneOf(verdict, "kind", KINDS, name("kind"));
    oneOf(verdict, "size", SIZES, name("size"));
    for (const field of ["local", "specBehaviour", "contractChange"]) flag(verdict, field, name(field));
  });
  return {
    id,
    outside: given.outside === undefined ? false : flag(given, "outside"),
    reviewerDisagrees: given.reviewerDisagrees === undefined ? false : flag(given, "reviewerDisagrees"),
    verdicts,
  };
}
