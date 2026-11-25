// The record of a chapter review in /tdd-apply: what the chapter-reviewer saves of its findings before it hands
// back (`tdd.mjs review`), and what the main session's `tdd.mjs route --change <c> --chapter <X>` sorts the findings
// from. Texts and objects in, objects out: nothing here reads a file, so the tests call it directly.
//
// The record is the reviewer's hand-back, from its first line to the last line of its last finding:
//
//   REVIEW: chapter <X>, <range>, <n> commits, <m> files changed
//   FINDINGS: <total> · confirmed <a> · refuted <b> · unsure <c> · no report <d>
//
//   <id> · <important | nit | not applicable> · <confirmed | refuted | unsure | no report> ·
//        <behaviour | test-quality | docs | cleanup | not applicable> · <file>:<line> · <in the chapter | outside>
//     DEFECT: …        (a finding's details: the lines under its first line, each starting with spaces)
//     MERGED: <the other finding's id> · <its file:line>
//     AFFECTS: <the other finding's id>: <one sentence>
//     REVIEWER DISAGREES: <one sentence>
//
// - A finding's first line is all on one line, its six parts separated by the middle dot. Every line under it that
//   starts with a space belongs to it, up to the next finding's first line. With no finding, the two lines at the
//   top are the whole record. The chapter's name in the first line is read without regard to case.
// - Of the details, three are read:
//   `MERGED:` names a finding with the same cause that was merged into this one: one line for each such finding,
//   its id and nothing else before the middle dot, and after it nothing but its place. That finding has no first
//   line of its own, and both keep their own report.
//   `AFFECTS:` names a finding whose fix touches this one's: a finding of the record, by its id, then what the two
//   fixes do to each other. One line is enough to tie the two, whichever of them it stands under.
//   `REVIEWER DISAGREES:` says that the reviewer still disagrees with the finding's verifier, and on what. A
//   reviewer who agrees leaves the line out: one that is empty, or starts with `no`, `none`, `nothing`, `n/a`, `not
//   applicable`, `agree`, `agrees`, `agreed`, `I agree` (each as a whole word, in any case) or a dash, is refused,
//   since the line's presence is what sends the finding to the owner.
// - What the record says of a verdict is the verifier's, which saved its report as the file `<id>-1.md`
//   (route.mjs). `checkRecord` holds the record against those reports, so that no finding is recorded with a verdict
//   or a kind its report does not have, and none is left out: every report file belongs to a finding's first line
//   or to a MERGED line. The sorting reads the verdicts from the reports again, and takes only a
//   report that still agrees with the record (`recordFindings`): a file that came or changed after the record was
//   written decides nothing.
//
// A record that cannot be read is refused in one line that names the finding and the line, so that the reviewer
// corrects it and saves it again.
import { KINDS, reportFile, VERDICTS } from "./route.mjs";

// The name of the reviews file's section that holds a chapter's record.
export const reviewSection = (chapter) => `Chapter ${chapter} review`;

const NOT_APPLICABLE = "not applicable";
const NO_REPORT = "no report";
const SEVERITIES = ["important", "nit", NOT_APPLICABLE];
const RECORDED_VERDICTS = [...VERDICTS, NO_REPORT];
const RECORDED_KINDS = [...KINDS, NOT_APPLICABLE];
const PLACES = ["in the chapter", "outside"];

// The labels of a finding's details. A line that starts with one of them is a detail also without spaces before
// it; any other line that starts at the margin is a finding's first line.
const DETAILS = ["DEFECT", "SCENARIO", "FIX", "VERIFIER", "BUILDS ON IT", "MERGED", "AFFECTS", "REVIEWER DISAGREES"];

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// A place, `<file>:<line>`: a finding's fifth part, and what a MERGED line names after its middle dot.
const PLACE = /^\S.*:\d+\S*$/;
// What a detail holds after its label when it is read: an id, then for MERGED the middle dot and the place (or
// nothing), for AFFECTS a colon and the sentence.
const MERGED = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\s*·\s*([^·]*))?$/;
const AFFECTS = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*:\s*\S/;
// How a REVIEWER DISAGREES line starts when the reviewer has nothing to disagree on: it is empty, or its first
// words are one of these (in any case), or it starts with a dash. A sentence that disagrees starts otherwise.
const NO_DISAGREEMENT =
  /^(?:$|[—–-]|(?:no|none|nothing|n\/a|not\s+applicable|agree|agrees|agreed|i\s+agree)(?![\p{L}\p{N}]))/iu;
// The shapes a refusal names. A finding's first line in short: the refusal of one part names that part's words,
// and the whole has to fit the one line a refusal is.
const FINDING_SHAPE = "<id> · <severity> · <verdict> · <kind> · <file>:<line> · <in the chapter | outside>";
const COUNTS_SHAPE = "FINDINGS: <total> · confirmed <a> · refuted <b> · unsure <c> · no report <d>";
const MERGED_SHAPE = "MERGED: <the other finding's id> · <its file:line>";
const AFFECTS_SHAPE = "AFFECTS: <the other finding's id>: <one sentence>";

// A line as a refusal quotes it: cut when long, so that the refusal's last words still fit the one line it is.
const QUOTED = 60;
const quoted = (line) => JSON.stringify(line.length > QUOTED ? `${line.slice(0, QUOTED)}…` : line);

// A text without the byte-order mark some shells put before it.
const withoutByteOrderMark = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

// The counts a record's second line gives, as its text: `<total> · confirmed <a> · …`.
const countsText = ({ total, confirmed, refuted, unsure, noReport }) =>
  `${total} · confirmed ${confirmed} · refuted ${refuted} · unsure ${unsure} · no report ${noReport}`;

// What `tdd.mjs review` prints of a record after `review: chapter <X> | `: the number of findings, then how many
// have each verdict.
export function recordSummary({ counts }) {
  const { total, confirmed, refuted, unsure, noReport } = counts;
  const findings = `${total} ${total === 1 ? "finding" : "findings"}`;
  return `${findings} · confirmed ${confirmed} · refuted ${refuted} · unsure ${unsure} · no report ${noReport}`;
}

// The record a text holds, for the chapter named: its findings in order, each with its id, the number of its
// first line, its severity, verdict, kind and place as written, `outside`, `reviewerDisagrees`, the findings
// merged into it (`merged`) and those its fix touches (`affects`), each with its id and line number; and the
// counts of its second line. Throws, in one line that names the line and the finding, for a text that is not such
// a record.
export function readRecord(text, chapter) {
  const lines = withoutByteOrderMark(String(text ?? ""))
    .split(/\r?\n/)
    .map((line, i) => ({ line: line.trimEnd(), number: i + 1 }));
  const filled = lines.filter(({ line }) => line.trim() !== "");
  const refuse = (number, what) => {
    throw new Error(`line ${number}: ${what}`);
  };

  const [first, second, ...rest] = filled;
  if (first === undefined) throw new Error(`the record is empty; it starts with "REVIEW: chapter ${chapter}, …"`);
  const opening = `REVIEW: chapter ${chapter}`;
  const opens = first.line.slice(0, opening.length).toLowerCase() === opening.toLowerCase();
  if (!opens || /^[A-Za-z0-9._-]/.test(first.line.slice(opening.length))) {
    refuse(first.number, `${quoted(first.line)} is not the record's first line; it starts with "${opening}, …"`);
  }
  const said = /^FINDINGS: *(\d+) *· *confirmed +(\d+) *· *refuted +(\d+) *· *unsure +(\d+) *· *no report +(\d+)$/.exec(
    second?.line ?? "",
  );
  if (said === null) {
    if (second === undefined) throw new Error(`the record has no second line; it is "${COUNTS_SHAPE}"`);
    refuse(second.number, `${quoted(second.line)} is not the record's second line; it is "${COUNTS_SHAPE}"`);
  }
  const [total, confirmed, refuted, unsure, noReport] = said.slice(1).map(Number);

  const findings = [];
  for (const { line, number } of rest) {
    const detail = DETAILS.find((label) => line.trimStart().startsWith(`${label}:`));
    if (/^\s/.test(line) || detail !== undefined) {
      const finding = findings.at(-1);
      if (finding === undefined) {
        refuse(
          number,
          `${quoted(line.trim())} belongs to no finding; a finding starts with its line "${FINDING_SHAPE}"`,
        );
      }
      if (detail !== undefined) readDetail(finding, detail, line.trim(), number, refuse);
      continue;
    }
    findings.push(readFindingLine(line, number, refuse));
  }

  // What the lines say together.
  const firstLineOf = new Map();
  for (const finding of findings) {
    if (firstLineOf.has(finding.id)) {
      refuse(finding.line, `finding ${finding.id}: the id is given twice, also on line ${firstLineOf.get(finding.id)}`);
    }
    firstLineOf.set(finding.id, finding.line);
  }
  const mergedInto = new Map();
  for (const finding of findings) {
    for (const other of finding.merged) {
      const refuseMerged = (what) => refuse(other.line, `finding ${finding.id}: MERGED names ${other.id}, ${what}`);
      if (finding.verdict === NO_REPORT) refuseMerged("and a finding with no report is never merged");
      if (other.id === finding.id) refuseMerged("the finding itself");
      if (firstLineOf.has(other.id)) {
        refuseMerged(
          `which has a first line of its own (line ${firstLineOf.get(other.id)}); a finding that is merged into ` +
            "another has none",
        );
      }
      if (mergedInto.has(other.id)) refuseMerged(`which is merged already, into ${mergedInto.get(other.id)}`);
      mergedInto.set(other.id, finding.id);
    }
  }
  for (const finding of findings) {
    for (const other of finding.affects) {
      const refuseAffects = (what) => refuse(other.line, `finding ${finding.id}: AFFECTS names ${other.id}, ${what}`);
      if (!firstLineOf.has(other.id) && !mergedInto.has(other.id)) refuseAffects("which is no finding of this record");
      if ((mergedInto.get(other.id) ?? other.id) === finding.id) {
        refuseAffects(other.id === finding.id ? "the finding itself" : "which is merged into this finding");
      }
    }
  }
  const counted = {
    total: findings.length,
    confirmed: findings.filter((f) => f.verdict === "confirmed").length,
    refuted: findings.filter((f) => f.verdict === "refuted").length,
    unsure: findings.filter((f) => f.verdict === "unsure").length,
    noReport: findings.filter((f) => f.verdict === NO_REPORT).length,
  };
  const counts = { total, confirmed, refuted, unsure, noReport };
  if (countsText(counts) !== countsText(counted)) {
    refuse(
      second.number,
      `FINDINGS says ${countsText(counts)}, and the findings' first lines say ${countsText(counted)}`,
    );
  }
  return { chapter, findings, counts };
}

// Takes what one of a finding's details says into the finding: the three that are read, each in its exact form.
// `line` is the detail's line without the spaces around it. `refuse` throws with the line's number.
function readDetail(finding, detail, line, number, refuse) {
  const value = line.slice(detail.length + 1).trim();
  const refuseLine = (what) => refuse(number, `finding ${finding.id}: ${quoted(line)} ${what}`);
  if (detail === "MERGED") {
    const [, id, place] = MERGED.exec(value) ?? [];
    if (id === undefined || (place !== undefined && !PLACE.test(place.trim()))) {
      refuseLine(`is not "${MERGED_SHAPE}": one MERGED line per finding merged in`);
    }
    finding.merged.push({ id, line: number });
  }
  if (detail === "AFFECTS") {
    const [, id] = AFFECTS.exec(value) ?? [];
    if (id === undefined) refuseLine(`is not "${AFFECTS_SHAPE}"`);
    finding.affects.push({ id, line: number });
  }
  if (detail === "REVIEWER DISAGREES") {
    const said = NO_DISAGREEMENT.exec(value)?.[0];
    if (said === "") {
      refuseLine("names nothing you disagree on: say it in one sentence, or leave the line out when you agree");
    }
    if (said !== undefined) {
      refuseLine(
        `names nothing you disagree on: a line that starts with "${said}" agrees; start your sentence otherwise, or ` +
          "leave the line out when you agree",
      );
    }
    finding.reviewerDisagrees = true;
  }
}

// A finding as its first line says it. `refuse` throws with the line's number.
function readFindingLine(line, number, refuse) {
  const parts = line.split("·").map((part) => part.trim());
  if (parts.length !== 6) {
    refuse(
      number,
      `${quoted(line)} has ${parts.length === 1 ? "one part" : `${parts.length} parts`}, and a finding's first line ` +
        `has six: "${FINDING_SHAPE}"; a line of a finding's details starts with two spaces`,
    );
  }
  const [id, severity, verdict, kind, place, where] = parts;
  if (!ID.test(id)) {
    refuse(number, `the id is ${quoted(id)}; an id is letters, digits, dots, dashes and underscores, such as B-1`);
  }
  const oneOf = (name, given, allowed) => {
    if (!allowed.includes(given)) {
      refuse(number, `finding ${id}: its ${name} part is ${quoted(given)}; it is one of: ${allowed.join(", ")}`);
    }
  };
  oneOf("second", severity, SEVERITIES);
  oneOf("third", verdict, RECORDED_VERDICTS);
  oneOf("fourth", kind, RECORDED_KINDS);
  if (!PLACE.test(place)) {
    refuse(number, `finding ${id}: its fifth part is ${quoted(place)}; it is <file>:<line>`);
  }
  oneOf("sixth", where, PLACES);
  return {
    id,
    line: number,
    severity,
    verdict,
    kind,
    place,
    outside: where === "outside",
    reviewerDisagrees: false,
    merged: [],
    affects: [],
  };
}

// The ids of a record's findings: each finding's, then those merged into it.
export const recordIds = (record) =>
  record.findings.flatMap((finding) => [finding.id, ...finding.merged.map((other) => other.id)]);

// Holds a record against the reports of its findings' verifiers. `reportOf(id)` answers what the finding's report
// file holds: { verdict } (a verdict as `readReport` gives it), { missing: true } when the file is not there, or
// { unreadable: <why> } when it cannot be read as a report; `where` names the place of the report files for a
// refusal, and `filed` holds the names of the first checks' report files there (`<id>-1.md`). Throws, in one line
// that names the finding and its line, for the first finding that does not agree with its report:
// - its verdict is the report's, and for a confirmed finding its kind too;
// - it says `no report` exactly when the report is missing or cannot be read;
// - a finding merged into it has a report with the same verdict.
// Then, in one line that names the file, for the first report file that belongs to no finding of the record: a
// finding is never dropped by leaving its line out.
export function checkRecord(record, reportOf, where = "the chapter's reports folder", filed = []) {
  for (const finding of record.findings) {
    const refuse = (what) => {
      throw new Error(`line ${finding.line}: finding ${finding.id} ${what}`);
    };
    const file = reportFile(finding.id, 1);
    const report = reportOf(finding.id);
    if (finding.verdict === NO_REPORT) {
      if (report.verdict !== undefined) {
        refuse(`says "no report", and its report ${file} is there and says ${report.verdict.verdict}`);
      }
    } else {
      const never = `a finding whose verifier never reported says "no report"`;
      if (report.missing) refuse(`says ${finding.verdict}, and it has no report ${file} in ${where}; ${never}`);
      if (report.unreadable !== undefined) {
        const why = report.unreadable;
        refuse(`says ${finding.verdict}, and its report ${file} cannot be read, which makes it "no report": ${why}`);
      }
      if (report.verdict.verdict !== finding.verdict) {
        refuse(`says ${finding.verdict}, and its report ${file} says ${report.verdict.verdict}`);
      }
      if (finding.verdict === "confirmed" && report.verdict.kind !== finding.kind) {
        refuse(`says ${finding.kind}, and its report ${file} says KIND: ${report.verdict.kind}`);
      }
    }
    for (const other of finding.merged) {
      const merged = reportOf(other.id);
      const theirs = reportFile(other.id, 1);
      const named = `(line ${other.line}) names ${other.id} as merged into it`;
      if (merged.missing) refuse(`${named}, and ${other.id} has no report ${theirs} in ${where}`);
      if (merged.unreadable !== undefined) {
        refuse(`${named}, and its report ${theirs} cannot be read: ${merged.unreadable}`);
      }
      if (merged.verdict.verdict !== finding.verdict) {
        refuse(
          `${named}, and its report ${theirs} says ${merged.verdict.verdict}, not ${finding.verdict}: findings are ` +
            "merged only when their verdicts are the same",
        );
      }
    }
  }
  const own = new Set(recordIds(record).map((id) => reportFile(id, 1)));
  const stray = filed.find((name) => !own.has(name));
  if (stray !== undefined) {
    throw new Error(
      `the report ${stray} in ${where} belongs to no finding of the record: give it its line, or merge it`,
    );
  }
}

// The record's findings as `route` takes them: `findings`, each with the verdict of its report, `groups`, the
// merged ones (a finding merged into another follows it, with its own report's verdict and the other's place and
// reviewer: together they are one group, the kept finding first), and `ties`, the pairs of findings whose fixes
// touch each other (an AFFECTS line under either; a finding merged into another counts as that one).
//
// `reportOf` and `where` are `checkRecord`'s. A report decides only while it agrees with the record, as it did
// when the record was written: the same verdict and, for a confirmed finding, the same kind. Any other report is a
// check that returned no result (the verdict is null), and so is every report of a finding the record gives `no
// report`, whatever file is there now. `said` holds one line for each report that was not taken, but for a `no
// report` finding without a readable file, which is what the record says.
export function recordFindings(record, reportOf, where = "the chapter's reports folder") {
  const findings = [];
  const groups = [];
  const said = [];
  const keptOf = new Map();
  for (const finding of record.findings) {
    const { outside, reviewerDisagrees, verdict: recorded } = finding;
    // The verdict of a report that agrees with the record; `own` says that it is the finding's own report, whose
    // kind the record has too.
    const verdictOf = (id, own) => {
      const file = reportFile(id, 1);
      const report = reportOf(id);
      const not = (what) => {
        said.push(`${file} ${what}`);
        return null;
      };
      if (recorded === NO_REPORT) {
        const there = report.verdict === undefined ? null : report.verdict.verdict;
        return there === null ? null : not(`is there and says ${there}, and the record says no report`);
      }
      if (report.missing) return not(`is missing in ${where}, and the record says ${recorded}`);
      if (report.unreadable !== undefined) return not(`cannot be read as a report: ${report.unreadable}`);
      if (report.verdict.verdict !== recorded) {
        return not(`says ${report.verdict.verdict}, and the record says ${recorded}`);
      }
      if (own && recorded === "confirmed" && report.verdict.kind !== finding.kind) {
        return not(`says KIND: ${report.verdict.kind}, and the record says ${finding.kind}`);
      }
      return report.verdict;
    };
    const member = (id, own) => ({ id, outside, reviewerDisagrees, verdicts: [verdictOf(id, own)] });
    findings.push(member(finding.id, true), ...finding.merged.map((other) => member(other.id, false)));
    if (finding.merged.length > 0) groups.push([finding.id, ...finding.merged.map((other) => other.id)]);
    for (const other of finding.merged) keptOf.set(other.id, finding.id);
  }
  const ties = record.findings.flatMap((finding) =>
    finding.affects.map((other) => [finding.id, keptOf.get(other.id) ?? other.id]),
  );
  return { findings, groups, ties, said };
}
