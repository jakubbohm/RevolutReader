// The check of /triage-review (.claude/skills/triage-review/SKILL.md, § 2). The skill's main session runs it by
// name (Workflow tool, name "triage-review-verify") with the args below. It is not meant to run on its own: it
// needs the findings file that the skill's gather writes (gather-findings.mjs).
//
// What it does. Every finding is checked twice by an agent of one definition, .claude/agents/review-verifier.md:
// a first verifier, then a second one that gets the first's report and tries to overturn it (a pipeline: a
// finding's second check starts as soon as its first is in). Each verifier writes its report to a file outside
// the repository. When all checks are in, ONE more agent reads the reports side by side and says which findings
// are one defect, which fixes affect each other, and which of the verifiers' side remarks hold.
//
// What it does not do. It parses no report and sorts nothing: a workflow script can read no file and cannot be
// tested. The main session sorts the findings from the report files, with tested code:
// `tdd.mjs route --reports <reportsDir> --ids <ids>`. So a verifier is called without a schema: it returns its
// report as plain text, as its definition says, and the script uses that text only to tell a check that returned
// something from one that returned nothing (`missing`); it never returns it. It passes no model and no effort
// for the verifiers either: their definition sets both.
//
// Read-only: no agent edits a file of the repository, builds, or runs tests or the app. The agents share one
// working tree, and the fix round proves each finding with a failing guard test anyway.
//
// Args (one object; every path absolute):
//   pr            the pull request's id
//   change        the OpenSpec change's name, or null for a pull request without one
//   findingsPath  findings.json: an array of { id, path, line, title, body, ... }
//   ids           the numbers of the findings to check, e.g. [1, 2, 3]
//   diffPath      the pull request's diff against its base
//   intentPaths   the files that say what the pull request is meant to do: the change's proposal.md, design.md
//                 and specs; without a change, the saved issue
//   reportsDir    the folder of the report files: <reportsDir>/<id>-1.md is a finding's first check,
//                 <reportsDir>/<id>-2.md its second
//
// Returns { pr, ids, reportsDir, merged, affects, newFindings, missing, together }, all of it small:
//   merged        [{ ids, cause }]: findings with one cause that one fix settles
//   affects       [{ ids, how }]: findings whose fixes affect each other
//   newFindings   [{ path, line, body }]: side remarks that hold, in the shape post-findings.mjs posts
//                 (line is null for the whole file)
//   missing       the ids for which a check returned nothing; the main session's sorting makes them asks
//   together      'done', or why the three lists above are empty without anyone having looked: 'no result'
//                 (the last agent returned nothing) or 'not run' (no check returned a report)
export const meta = {
  name: 'triage-review-verify',
  description: 'Check code-review findings read-only: two review-verifier checks per finding, the second trying to overturn the first, then one agent that reads all reports together',
  whenToUse: 'Only from /triage-review (its § 2), with args { pr, change, findingsPath, ids, diffPath, intentPaths, reportsDir }',
  phases: [
    { title: 'First check', detail: 'one review-verifier per finding: confirmed, refuted or unsure, with evidence and the shape of the fix' },
    { title: 'Second check', detail: 'a second review-verifier per finding: it gets the first report and tries to overturn it' },
    { title: 'Together', detail: 'one agent over all reports: findings that are one defect, fixes that affect each other, side remarks that hold' },
  ],
}

const { pr, change = null, findingsPath, ids, diffPath, intentPaths = [], reportsDir } = args ?? {}
const isText = value => typeof value === 'string' && value.trim() !== ''
const isId = value => Number.isInteger(value) || isText(value)
if (
  !isId(pr) || !isText(findingsPath) || !isText(diffPath) || !isText(reportsDir) ||
  !Array.isArray(ids) || ids.length === 0 || !ids.every(isId) || !Array.isArray(intentPaths)
) {
  throw new Error(
    'triage-review-verify needs args { pr, change (or null), findingsPath, ids (a non-empty array), diffPath, ' +
      'intentPaths (an array), reportsDir }',
  )
}

// Each finding once, in the order given: two checks of one finding would write the same report files.
const numbers = [...new Set(ids)]
const folder = reportsDir.trim().replace(/[\\/]+$/, '')
const reportFile = (id, check) => `${folder}/${id}-${check}.md`
const intent = intentPaths.length > 0 ? intentPaths.join(', ') : 'none'

// A verifier's brief: the labelled lines that review-verifier.md reads for a pull request's review (its § What
// you are given), in its order, and nothing more. The second check's brief has one more line, FIRST REPORT, which
// makes that verifier the second pass (its § The second pass). Everything else the verifier needs is in its
// definition: what to check, the report's shape, that it writes the report to REPORT FILE and returns it.
function brief(id, check) {
  return [
    `PR: ${pr}`,
    `CHANGE: ${isText(change) ? change : 'none'}`,
    `DIFF: ${diffPath}`,
    `INTENT: ${intent}`,
    `FINDING: ${id} in ${findingsPath}`,
    `REPORT FILE: ${reportFile(id, check)}`,
    ...(check === 2 ? [`FIRST REPORT: ${reportFile(id, 1)}`] : []),
  ].join('\n')
}

// A verifier returns its report as plain text, the same text it wrote to its report file. The script reads
// nothing from it: it only sees whether the check returned something (null: the agent was skipped or died).
const verifier = (id, check) =>
  agent(brief(id, check), {
    label: `finding ${id}, check ${check}`,
    phase: check === 1 ? 'First check' : 'Second check',
    agentType: 'review-verifier',
  })
const returned = result => isText(result)

const plural = n => (n === 1 ? '' : 's')
log(`${numbers.length} finding${plural(numbers.length)}: two review-verifier checks each, then one agent over all reports`)

// No barrier between the findings. Without a first report there is nothing to overturn, so the second check
// does not run, and both count as missing.
const checked = await pipeline(
  numbers,
  id => verifier(id, 1),
  (first, id) =>
    returned(first)
      ? verifier(id, 2).then(second => ({ id, first: true, second: returned(second) }))
      : { id, first: false, second: false },
)
const checks = numbers.map((id, i) => checked[i] ?? { id, first: false, second: false })
const missing = checks.filter(c => !c.first || !c.second).map(c => c.id)
if (missing.length > 0) {
  log(`a check returned nothing for finding${plural(missing.length)} ${missing.join(', ')}: the main session's sorting makes ${missing.length === 1 ? 'it an ask' : 'them asks'}`)
}

// The report files the checks said they wrote. A second report is there only with its first.
const reports = checks.flatMap(c => [c.first && reportFile(c.id, 1), c.second && reportFile(c.id, 2)].filter(Boolean))

// What the last agent returns. Short on purpose: the main session reads it whole. The schema uses only the
// keywords every JSON Schema tool takes (type, properties, required, items, description); the limits are in the
// descriptions and in the prompt, and LIMITS below holds the script to them.
const LIMITS = { sentence: 300, newFindings: 10 }
const GROUP_IDS = { type: 'array', items: { type: 'integer' }, description: 'the numbers of the findings in the group: two or more' }
const TOGETHER = {
  type: 'object',
  required: ['merged', 'affects', 'newFindings'],
  properties: {
    merged: {
      type: 'array',
      description: 'groups of checked findings that have one cause which one fix settles; empty when there is none',
      items: {
        type: 'object',
        required: ['ids', 'cause'],
        properties: {
          ids: GROUP_IDS,
          cause: { type: 'string', description: 'one sentence of at most 300 characters: the one cause, and the one fix that settles all of them' },
        },
      },
    },
    affects: {
      type: 'array',
      description: 'groups of checked findings that stay separate but whose fixes touch each other; empty when there is none',
      items: {
        type: 'object',
        required: ['ids', 'how'],
        properties: {
          ids: GROUP_IDS,
          how: { type: 'string', description: 'one sentence of at most 300 characters: what the one fix changes for the other' },
        },
      },
    },
    newFindings: {
      type: 'array',
      description: 'side remarks of the verifiers that hold after you checked the code path, at most ten; empty when there is none',
      items: {
        type: 'object',
        required: ['path', 'line', 'body'],
        properties: {
          path: { type: 'string', description: 'a file the pull request changes, as the diff names it' },
          line: { type: 'integer', description: 'the line in the file as it is now; 0 for the whole file' },
          body: { type: 'string', description: 'first line "<severity>: <summary>", an empty line, then the failure scenario; at most 1,200 characters in all' },
        },
      },
    },
  },
}

// The last agent's prompt. It is the workflow's default agent, so everything it must know is here.
const together = `You look at the checked findings of a code review side by side. The review is of pull request ${pr} of this repository${isText(change) ? `, which implements the OpenSpec change ${change}` : ''}. Each finding was checked twice, each time by a verifier that saw only that one finding and wrote a report on it. Nobody has compared the findings with each other yet, and nobody has followed up what the verifiers noticed on the way. Those two things are your whole job.

WHAT YOU READ

- The findings: ${findingsPath}, a JSON array. The checked findings are the elements whose "id" is one of: ${numbers.join(', ')}. Read the whole of each: its path, line, title and body. The array may hold other findings, which were not checked in this run; you need them only for step 3a.
- The reports, one file per check. A file named <number>-1.md is that finding's first check, <number>-2.md its second:
${reports.map(file => `  ${file}`).join('\n')}
  A report is a list of labelled lines: ID, VERDICT (confirmed, refuted or unsure), EVIDENCE, SEVERITY, KIND, FIX, BUILDS ON IT, ALSO NOTICED, NOTE, and in a second check FIRST PASS. If a file of the list is not there, go on without it.
- The pull request's diff against its base: ${diffPath}.
- The files that say what the pull request is meant to do: ${intent}.
- The code as it is now, wherever a step below tells you to check a code path.

RULES

- Read-only. Do not edit or write any file. Do not build, and do not run tests or the app: other agents share this working tree. Read-only git is yours (git log, git diff, git show).
- You never change a verdict and never comment on one. Whether a finding is real, how severe it is, what kind it is and what shape its fix has are the verifiers' judgements, and code sorts the findings from the reports as they stand. If you think a verdict is wrong, that is not yours to say, here or in any text you return.
- Never put real bank data (balances, amounts, counterparties, transaction texts, account identifiers) or secrets into your answer. Describe such a value; never quote it.
- Your answer is the three lists below and nothing else. Each may be empty, and an empty list is a full answer: add an entry only when you can give its reason.

1. merged: findings that are one defect

A group is two or more checked findings that have ONE cause which ONE fix settles: the same defect reported at two places, or two symptoms of the same wrong lines.
- Merge findings only when every report of every finding in the group gives the same VERDICT. If one of those reports says otherwise, or a finding has fewer than two reports, do not merge them.
- Findings that are alike but need separate fixes are not merged. Neither are findings that only lie in the same file.
- A finding is in at most one group.
For each group return "ids", the findings' numbers (two or more), and "cause", one sentence of at most 300 characters that names the one cause and the one fix that settles all of them.

2. affects: findings whose fixes touch each other

A group is two or more checked findings that stay separate fixes, but the fixes depend on each other: fixing one changes how another must be fixed, or both fixes change the same lines. Judge it from the reports' FIX lines and from the code they name; read that code.
- Do not list a merged group again here.
- A finding that all its reports refute has no fix: leave it out.
For each group return "ids" (two or more numbers) and "how", one sentence of at most 300 characters that says what the one fix changes for the other.

3. newFindings: what the verifiers noticed on the way

A report's ALSO NOTICED line names things its verifier saw that looked wrong and are not its finding. Nobody has checked them. Take every remark of every such line that is not "nothing":
a. Leave it out if it says the same as a finding in the findings file, checked or not, or as a remark you have already taken.
b. Read its code path yourself, from the code as it is now. Look for what would rule the defect out: a guard, an invariant, a caller that never passes that input, an existing test that pins the behaviour, a decision in the files that say what the pull request is meant to do.
c. Keep it only if the defect still holds after that AND you can state a concrete failure scenario: which input or which sequence of events leads to which wrong outcome. Leave out what you cannot settle from reading, what is a matter of taste, and a defect in code that the pull request neither changes nor depends on.
Return at most ten. If more than ten hold, return the ten whose wrong outcome is the gravest.
For each remark you keep return:
- "path": a file the pull request changes, written as the diff names it (its "diff --git a/<path> b/<path>" lines). If the defect lies in a file the pull request does not change, give the changed file it concerns most.
- "line": the defect's line in that file as it is now. 0 when it concerns the whole file, or when the defect lies in another file than "path".
- "body": the finding as /code-review --comment writes one. Its first line is the severity and a one-line summary, in the form "<severity>: <summary>", at most 110 characters. The severity is "important" (wrong behaviour that can happen in normal operation, data shown wrong, a rule about bank data broken) or "nit" (real but unlikely, or docs and tests only). Then an empty line. Then the failure scenario in two to five sentences: the input or the events, the code path with its file and line, and the wrong outcome. If the defect's real place is not "path" and "line", the scenario starts with that place, written <file>:<line>. Name no issue and no pull request of another repository. At most 1,200 characters in all.`

// One agent over everything, once all checks are in. With one finding it still runs: that finding's reports may
// carry side remarks. Without any report there is nothing to read.
let found = null
if (reports.length === 0) {
  log('no check returned a report: nothing to read together')
} else {
  found = await agent(together, { label: 'all reports together', phase: 'Together', schema: TOGETHER })
  if (found === null) log('the agent that reads all reports together returned nothing: nobody compared the findings')
}

// The groups as the main session takes them: only findings that were checked, each once, and each finding in one
// merged group at most (a later group that shares a finding with an earlier one is left out).
const known = new Map(numbers.map(id => [String(id), id]))
const group = ids => [...new Set((Array.isArray(ids) ? ids : []).map(id => known.get(String(id))))].filter(id => id !== undefined)
const sentence = text => String(text ?? '').trim().slice(0, LIMITS.sentence)
const taken = new Set()
const merged = []
for (const g of found?.merged ?? []) {
  const members = group(g?.ids)
  if (members.length < 2 || members.some(id => taken.has(id))) continue
  members.forEach(id => taken.add(id))
  merged.push({ ids: members, cause: sentence(g.cause) })
}
const affects = (found?.affects ?? [])
  .map(g => ({ ids: group(g?.ids), how: sentence(g?.how) }))
  .filter(g => g.ids.length >= 2)
const held = (found?.newFindings ?? [])
  .filter(f => isText(f?.path) && isText(f?.body))
  .map(f => ({ path: f.path.trim(), line: Number.isInteger(f.line) && f.line > 0 ? f.line : null, body: f.body.trim() }))
const newFindings = held.slice(0, LIMITS.newFindings)
const leftOut = held.length - newFindings.length
if (leftOut > 0) log(`${leftOut} new finding${plural(leftOut)} beyond the first ${LIMITS.newFindings} left out`)
if (found !== null) log(`together: merged ${merged.length} · affects ${affects.length} · new findings ${newFindings.length}`)

return {
  pr,
  ids: numbers,
  reportsDir: folder,
  merged,
  affects,
  newFindings,
  missing,
  together: reports.length === 0 ? 'not run' : found === null ? 'no result' : 'done',
}
