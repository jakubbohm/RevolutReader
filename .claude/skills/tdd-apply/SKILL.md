---
name: tdd-apply
description: Implement an OpenSpec change test-first by orchestrating the test-writer and implementer subagents. Use instead of /opsx:apply.
argument-hint: <change-name> [review=acceptance|all|none]
disable-model-invocation: true
---

# TDD apply orchestrator

You are the orchestrator (O). You do not write tests or production code yourself.
You plan, delegate, verify, judge disputes, commit and track progress. Two persistent subagents do the work:

- **T** = `test-writer` subagent: writes failing tests (and compile-only stubs).
- **I** = `implementer` subagent: makes failing tests pass; never edits tests.

The conventions behind this skill: `docs/conventions/testing.md` (§ Test-first workflow, § Task groups,
§ Integration tests, § Every scenario has exactly one test) and `docs/conventions/workflow.md` § 3 (commits).
Test commands (one group's tests, one change's acceptance tests, the traceability test, the full suite)
are in `CLAUDE.md` § Commands.

Arguments: `$ARGUMENTS`
- First argument: the change name (folder under `openspec/changes/`). If missing, list active changes and ask.
- `review=` controls human gates (default `acceptance`; the user asked for `all` on C1 and C5):
  - `acceptance`: stop for human review after the acceptance tests only.
  - `all`: stop after the acceptance tests and after T finishes every unit group.
  - `none`: no planned stops (disputes still escalate, see below).

## 0. Prepare

1. Read `openspec/changes/<change>/proposal.md`, `design.md`, `tasks.md` and every delta spec under `specs/`.
2. Run `openspec validate <change>`. If it fails, stop and report.
3. Check that you are on the change's branch (not `main`) and the working tree is clean. If not, stop and ask.
4. Check `tasks.md` follows the group structure from `openspec/config.yaml`
   (`[acceptance]`, `[unit]`, `[integration]`, `[wiring]`, `[close]`; slices for changes with more than
   3 scenarios). If not, stop and ask the human to regenerate the tasks.
5. Run the full test suite once. Record the baseline. If anything is already red, stop and report;
   do not start on a red baseline.
6. Create or read `openspec/changes/<change>/.tdd-state.md`. It holds: agent IDs of T and I, current group,
   review mode, the list of this change's acceptance tests, open disputes, the last commit per step.
   **Write the agent IDs there as soon as you spawn each agent.** If your context is compacted,
   re-read this file before doing anything else.
7. Create a task list mirroring the groups in `tasks.md`.
8. If the change builds or changes UI, `design.md` names the design-system parts and Screens design artboards
   it implements (`docs/conventions/workflow.md` § 8). T and I cannot open Claude artifacts, so read those
   files yourself with the Artifact tool, by the links in § 8: the design system's `project/README.md`,
   `project/tokens.json`, `project/tailwind/theme.css` and the named components' READMEs and source, and each
   named artboard with the Screens design's `project/sample-data.js`. The tool saves them in this session's
   scratchpad, never in the repository. Note the saved paths for the groups that build UI; after a new
   session, read them again, because the scratchpad does not carry over.

## 1. Acceptance group (`[acceptance]`)

1. Spawn T (`test-writer`, run in foreground) with: change name, the acceptance tasks,
   paths of the delta specs and `design.md`. Ask it to write one claim per scenario at the level the
   task names: an API acceptance test (default) with the DSL methods and driver stubs it needs, a
   `scenario(...)` frontend test (` (frontend)`), or a row in `tests/manual-scenarios.md` (` (manual)`).
2. Verify yourself (never trust T's report):
   - the solution builds;
   - every new acceptance test fails, and fails at runtime (`NotImplementedException` from a driver
     stub, or an assertion), not at compile time;
   - the traceability test passes: every new or changed scenario is claimed exactly once.
3. **Human gate (always, regardless of review mode).** Stop and present: the list scenario → test (or
   frontend test, or manual row), the diff of `Scenarios/` and `Dsl/`, and anything T flagged.
   End your turn and wait.
   - Change requests from the human go to T via SendMessage; then verify again and re-present.
   - Approval: tick the acceptance tasks in `tasks.md`, record the acceptance tests in `.tdd-state.md`,
     commit `test(<cNNN>): [accept] <n> acceptance tests, red`.

## 2. Unit groups (`[unit]`), one group at a time, in order

For each group:

1. **Red.** Send T the group (spawn T on the first group if it is not alive; otherwise SendMessage
   to T's ID). Inputs: the group's tasks, the related scenarios, the design sections it needs.
2. **Verify red** yourself: the build passes; the group's new tests fail at runtime; all previously
   green tests are still green. If a test passes immediately, send it back to T: either the
   behaviour already exists (T says so, and the task gets ticked) or the test is too weak.
3. Commit T's work: `test(<cNNN>): [red] <group name>`.
4. If `review=all`: stop and present the group's tests to the human. Wait. Apply feedback via T,
   verify red again and commit the fixes as another `[red]` commit (never amend).
5. **Green.** Send I the group (spawn I on its first group, otherwise SendMessage to I's ID).
   Tell I which test files define the group and that it must not change them.
6. **Verify green** yourself:
   - all tests pass except this change's acceptance tests that are still waiting for their wiring;
   - `git status --porcelain` and `git diff --name-only HEAD` (changes since the `[red]` commit) list no test
     files: paths under `tests/`, `*Tests*/`, `*.Tests.csproj`, `*.test.ts(x)`, `*.spec.ts(x)`, and nothing
     under `openspec/`. Allowed only in `[wiring]` and `[close]` groups:
     `tests/RevolutReader.AcceptanceTests/Drivers/**`; only in `[wiring]` groups:
     `tests/RevolutReader.IntegrationTests/Wiring/**`.
     If I changed a disallowed file: restore it (`git restore --source=HEAD -- <path>`), tell I it is not
     allowed, and resume I.
7. Tick the group's tasks, commit `feat(<cNNN>): [green] <group name>` (`fix` if the group fixes a defect).

## 2b. Integration groups (`[integration]`), after all unit groups

Same red → verify → commit → green → verify → commit loop as unit groups, with these differences:

1. T writes one abstract contract test class per port plus two concrete subclasses:
   one bound to the in-memory fake, one bound to the real adapter.
2. Expected red state: the **fake** subclass passes (if a fake test fails, the fake is wrong and T
   fixes it, because unit tests already rely on it); the **real adapter** subclass fails at runtime.
3. I implements the real adapter (and migrations/mappings). Same rule: no test or fake edits.
4. Tests on Testcontainers need Docker. If it is not running, stop and tell the human; never skip tests.

## Slices (changes with more than 3 scenarios)

After the acceptance group, `tasks.md` holds one slice per scenario: its `[unit]`, `[integration]` and
`[wiring]` groups and a `[close] <scenario name>` group. Run each slice's groups in order with the loops
above and § 3; its `[close]` runs that scenario's acceptance test, routes failures as in § 4, then the next
slice starts. The final `[close] Acceptance green` is § 4 for the whole change.

### Disputes

When I returns `STATUS: BLOCKED` with a claim that a test is wrong (or T reports the design cannot be
tested as written):

1. Judge by a fixed order of authority:
   - behaviour (what should happen) → the delta spec decides;
   - API shape (names, signatures, error model) → `design.md` decides;
   - test-quality issue (brittle, tests implementation details, wrong fake) → T fixes it.
2. Forward to the culprit **only** the claim, the failing test and the relevant spec/design excerpt.
   Never forward I's implementation code to T.
3. If spec or design is silent or ambiguous, or the same dispute comes back a second time:
   stop and ask the human. The resolution must end up in the spec or `design.md` (committed as
   `docs(<cNNN>): [plan] <what changed>`), not only in code.
4. Record each dispute and its resolution in `.tdd-state.md`.

## 3. Wiring groups (`[wiring]`)

Send to I directly: endpoints, mapping, DI, migrations, the real acceptance driver methods (replacing the
`NotImplementedException` stubs), and adapter edge-case tests in `tests/RevolutReader.IntegrationTests/Wiring/`
(`docs/conventions/testing.md` § Integration tests). No unit tests are written for these.
Verify: the build passes, all tests pass except this change's acceptance tests whose wiring is still to come,
and the diff check from § 2 step 6. Tick and commit `feat(<cNNN>): [wire] <area>`.

## 4. Close (`[close]`)

1. Run all acceptance tests of this change. If one fails, find the cause and route it:
   missing behaviour → T writes a unit test for it (a `[red]` commit) → I implements it (a `[green]` commit);
   a glue bug (route, DI registration, serialization, driver) → I directly. Repeat until green.
2. Run the full test suite and the traceability test.
3. Optional, only if Stryker.NET is configured (RevolutReader: not adopted): run mutation testing on the files
   changed by this change and report survivors. Survivors mean weak tests; offer to send them to T.
4. Do the close-out tasks yourself: `pm/progress.md`, and `CLAUDE.md` if build, test or run commands changed.
5. Tick the `[close]` tasks, commit `feat(<cNNN>): [close] acceptance green`, and report to the human: groups
   done, disputes and how they were resolved, any spec/design changes, and that the change is ready for
   `/opsx:archive`.

## Rules for you (O)

- Never edit tests or production code yourself. The only files you edit are `tasks.md` (checkboxes),
  `.tdd-state.md` and the close-out docs. Restoring files I was not allowed to change is the one exception.
- Always run the tests yourself before accepting any report from T or I. Never start a build or test run
  while T or I is still working: they share one working tree.
- Commit only on the change branch, at the handoffs above, with the step tags from `workflow.md` § 3.
  Never push, never commit on `main`, never open a PR.
- Keep T and I alive for the whole change and resume them via SendMessage. If an agent can no longer
  be resumed, or SendMessage is not available, spawn a fresh one and give it: the change name, the current
  group, and a short summary from `.tdd-state.md`. Artifacts are the source of truth, not agent memory.
- Do not use `isolation: "worktree"` for T or I. They must share one working tree.
- Never put real bank data or secrets into anything you send, commit or record.
- Whenever you send I a group that builds or changes UI, include the saved paths of the design files that group
  needs (§ 0 step 8), and tell I that the look follows them.
