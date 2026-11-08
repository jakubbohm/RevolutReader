// The verification step of /triage-review (.claude/skills/triage-review/SKILL.md, § 2). The skill runs it by
// name (Workflow tool, name "triage-review-verify") with the args below; it is not meant to run on its own,
// because it needs the findings file the skill writes. The rules it applies: docs/conventions/testing.md
// § Code review after the apply.
//
// Read-only: no agent edits a file, builds or runs tests. The agents share one working tree, and the fix round
// proves each finding with a failing guard test anyway.
//
// Args (one object):
//   pr            the PR number, for the labels and the prompts
//   findingsPath  absolute path of findings.json: an array of { id, path, line, title, body, ... }
//   ids           the finding ids to verify, e.g. [1, 2, 3]
//   diffPath      absolute path of the PR's diff against its base, so "local" can be judged
//   intentPaths   absolute paths of the files that say what the change intends: proposal.md, design.md and the
//                 delta specs; for a Direct PR the saved issue text
//   scope         one sentence on what the PR does (optional)
//
// Returns { pr, routed: [{ id, outcome: 'fix' | 'decline' | 'ask', reason, investigation, refutation }], missing: [ids] }.
export const meta = {
  name: 'triage-review-verify',
  description: 'Verify code-review findings read-only: an investigator and a skeptic per finding, then route each one to fix, decline or ask',
  whenToUse: 'Only from /triage-review (its § 2), with args { pr, findingsPath, ids, diffPath, intentPaths, scope? }',
  phases: [
    { title: 'Investigate', detail: 'one agent per finding: real, not real or unclear, with evidence, and the shape of the fix' },
    { title: 'Refute', detail: 'one skeptic per finding: tries to overturn the verdict and the fix judgement' },
  ],
}

const { pr, findingsPath, ids, diffPath, intentPaths = [], scope = '' } = args ?? {}
if (!pr || !findingsPath || !Array.isArray(ids) || ids.length === 0 || !diffPath) {
  throw new Error('triage-review-verify needs args { pr, findingsPath, ids (a non-empty array), diffPath, intentPaths }')
}

// What the investigator returns. Evidence must be checkable by the orchestrator: a file:line, a test name or a
// recorded decision; the orchestrator opens it before a finding is declined.
const INVESTIGATION = {
  type: 'object',
  required: ['id', 'verdict', 'evidence', 'kind', 'specBehaviour', 'fix'],
  properties: {
    id: { type: 'integer' },
    verdict: { type: 'string', enum: ['real', 'not-real', 'unclear'] },
    evidence: {
      type: 'string',
      description: 'Concrete and checkable: file:line of the guard or of the failing path, a test name, a design decision (design.md D<n>, an ADR) or a spec scenario name. Empty only for unclear.',
    },
    kind: {
      type: 'string',
      enum: ['behaviour', 'test-quality', 'docs', 'cleanup'],
      description: 'behaviour: an observable outcome changes; test-quality: a test is wrong, weak or misleading; docs: comments, documentation, naming; cleanup: structure with no behaviour change',
    },
    specBehaviour: {
      type: 'boolean',
      description: 'true when the fix would change behaviour a spec scenario or requirement describes (openspec/specs/ or the change\'s delta specs)',
    },
    fix: {
      type: 'object',
      required: ['local', 'files', 'needsFailingTest', 'contractChange', 'size', 'sketch'],
      properties: {
        local: {
          type: 'boolean',
          description: 'only files the diff touches or the finding names; no new dependency, no new setting, no Bicep change, no migration',
        },
        files: { type: 'array', items: { type: 'string' } },
        needsFailingTest: { type: 'boolean', description: 'behaviour and test-quality: true; docs and cleanup: false' },
        contractChange: { type: 'boolean', description: 'endpoints, request or response shapes, openapi.json' },
        size: {
          type: 'string',
          enum: ['small', 'medium', 'large'],
          description: 'small: one or two files, a few lines; medium: a few files inside the change\'s own area; large: a new component, a redesign, or anything touching Bicep, settings or dependencies',
        },
        sketch: { type: 'string', description: 'one line: what the fix changes' },
      },
    },
    notes: { type: 'string' },
  },
}

// What the skeptic returns. agrees = true only when neither the verdict nor the fix judgement could be overturned.
const REFUTATION = {
  type: 'object',
  required: ['id', 'agrees', 'argument', 'confidence'],
  properties: {
    id: { type: 'integer' },
    agrees: { type: 'boolean' },
    argument: { type: 'string', description: 'the counter-evidence (file:line, a test, a decision), or why the verdict stands' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    correctedVerdict: { type: 'string', enum: ['real', 'not-real', 'unclear'], description: 'only when agrees is false' },
    correctedFix: { type: 'string', description: 'what is wrong in the fix judgement, only when agrees is false' },
  },
}

function context(id) {
  return [
    `The finding: the element whose "id" is ${id} in ${findingsPath} (a JSON array). Read the whole element: its file, line, title and body.`,
    `The PR's diff against its base: ${diffPath}. What the change intends: ${intentPaths.length ? intentPaths.join(', ') : 'no intent files given'}.`,
    scope ? `What the PR does: ${scope}` : '',
    'Rules: read-only. Do not edit any file, do not build, do not run tests or the app: other agents share this working tree. ' +
      'Reason from the code, the diff, the intent files and the existing tests (tests/ and *.test.ts(x)). ' +
      'Never put bank data or secrets in your output. Return only the structured result.',
  ].filter(Boolean).join('\n')
}

const investigate = id => `You verify one finding of a code review on pull request #${pr} of this repository.
${context(id)}

Decide whether the finding is real:
- real: the failure scenario can happen as described, or the claim holds. Evidence: the code path (file:line) that shows it.
- not-real: a guard, an invariant, an existing test or a recorded decision rules it out. Evidence: that guard (file:line), that test's name, or that decision (design.md D<n>, an ADR, a spec scenario). A finding that contradicts a recorded decision is not-real with the decision as its evidence, unless the decision itself looks wrong: then unclear, and say why in notes.
- unclear: you could not settle it from reading. When in doubt, unclear, never not-real.

Then judge the fix the finding asks for: its kind; whether it changes behaviour a spec describes; whether it changes the API contract; whether it is local; whether it needs a failing test first; its size; and a one-line sketch. The schema says what each value means.`

const refute = (id, investigation) => `You are the skeptic for finding #${id} of the code review on pull request #${pr} of this repository. The investigator concluded:
${JSON.stringify(investigation, null, 2)}
${context(id)}

Try to overturn it. If it says real: look for the guard, the test or the recorded decision that rules the scenario out, and for a reason the scenario cannot happen. If it says not-real: look for a path around the cited guard, a case the cited test does not cover, or a reading of the cited decision that does not cover this finding. Check the fix judgement too (kind, spec behaviour, contract change, local, size): a wrong one sends the finding down the wrong path. Return agrees = true only when you could not overturn the verdict or the fix judgement. Give your argument either way, your confidence, and the corrected verdict or fix judgement when you disagree.`

// Routing in plain code, so the same inputs always give the same outcome. Everything uncertain is an ask.
function route(investigation, refutation) {
  if (!investigation) return { outcome: 'ask', reason: 'the investigator returned no result' }
  if (!refutation) return { outcome: 'ask', reason: 'the skeptic returned no result' }
  if (!refutation.agrees || refutation.confidence === 'low') {
    return { outcome: 'ask', reason: `the skeptic ${refutation.agrees ? 'agrees with low confidence' : 'disagrees'}: ${refutation.argument}` }
  }
  if (investigation.verdict === 'unclear') return { outcome: 'ask', reason: `unclear: ${investigation.notes || investigation.evidence || 'no reason given'}` }
  if (investigation.verdict === 'not-real') {
    return investigation.evidence?.trim()
      ? { outcome: 'decline', reason: investigation.evidence }
      : { outcome: 'ask', reason: 'judged not real, but without concrete evidence' }
  }
  const fix = investigation.fix ?? {}
  if (investigation.specBehaviour) return { outcome: 'ask', reason: 'the fix changes behaviour a spec describes: a spec change, never a quick fix' }
  if (fix.contractChange) return { outcome: 'ask', reason: 'the fix changes the API contract' }
  if (!fix.local) return { outcome: 'ask', reason: `the fix is not local: ${(fix.files ?? []).join(', ') || 'files not named'}` }
  if (fix.size === 'large') return { outcome: 'ask', reason: `a large fix: ${fix.sketch ?? ''}` }
  return { outcome: 'fix', reason: investigation.evidence }
}

log(`${ids.length} findings, ${ids.length * 2} read-only agents (an investigator and a skeptic each)`)

const results = await pipeline(
  ids,
  id => agent(investigate(id), { label: `investigate:${id}`, phase: 'Investigate', schema: INVESTIGATION }),
  (investigation, id) => investigation === null
    ? { id, investigation: null, refutation: null }
    : agent(refute(id, investigation), { label: `refute:${id}`, phase: 'Refute', schema: REFUTATION })
        .then(refutation => ({ id, investigation, refutation })),
)

const routed = results.filter(Boolean).map(r => ({ ...r, ...route(r.investigation, r.refutation) }))
const count = outcome => routed.filter(r => r.outcome === outcome).length
log(`fix ${count('fix')} · decline ${count('decline')} · ask ${count('ask')}`)

const missing = ids.filter(id => !routed.some(r => r.id === id))
if (missing.length) log(`no result for findings ${missing.join(', ')}: they go to the owner as asks`)

return { pr, routed, missing }
