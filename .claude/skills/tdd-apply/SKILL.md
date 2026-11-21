---
name: tdd-apply
description: Implement an OpenSpec change test-first by orchestrating the test-writer and implementer subagents. Use instead of /opsx:apply.
argument-hint: <change-name> [review=acceptance|all|none]
disable-model-invocation: true
---

# TDD apply orchestrator

You are the orchestrator (O). You do not write tests or production code yourself.
You plan, delegate, verify, judge disputes, commit and track progress. Two subagents do the work, a fresh pair
for each chapter of the apply (§ Chapters):

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
  - `none`: no review stops (disputes still escalate, and every chapter's end still stops, see below).

## 0. Prepare

1. Read `openspec/changes/<change>/proposal.md`, `design.md`, `tasks.md` and every delta spec under `specs/`.
2. Run `openspec validate <change>`. If it fails, stop and report.
3. Check that you are on the change's branch (not `main`) and the working tree is clean. If not, stop and ask.
4. Check `tasks.md` follows the group structure from `openspec/config.yaml`
   (`[acceptance]`, `[unit]`, `[integration]`, `[wiring]`, `[close]`; slices for changes with more than
   3 scenarios). If not, stop and ask the human to regenerate the tasks.
5. Run the full test suite once (`CLAUDE.md` § Commands: `dotnet test` and the frontend tests). Record the
   baseline. If anything is already red, stop and report; do not start on a red baseline. One red is
   expected: the repository traceability check reporting "Not claimed" for exactly this change's own
   scenarios, which group 1 claims. Anything more is a red baseline. A change's `design.md` may name one
   more accepted exception, for its first run only (c003: the frontend has no test files yet).
6. Create or read `openspec/changes/<change>/.tdd-state.md`. It holds: a "Resume here" section, the chapter
   plan, the agent IDs of T and I per chapter (the current pair marked, each agent's last token count), the
   standing rules for T and I, current group, review mode, the list of this change's acceptance tests, open
   disputes, the last commit per step. **Write the agent IDs there as soon as you spawn each agent.** If your
   context is compacted, re-read this file before doing anything else.
7. Create a task list mirroring the groups in `tasks.md`.
8. If the change builds or changes UI, `design.md` names the design-system parts and Screens design artboards
   it implements (`docs/conventions/workflow.md` § 8). T and I cannot open Claude artifacts, so read those
   files yourself with the Artifact tool, by the links in § 8: the design system's `project/README.md`,
   `project/tokens.json`, `project/tailwind/theme.css` and the named components' READMEs and source, and each
   named artboard with the Screens design's `project/sample-data.js`. The tool saves them in this session's
   scratchpad, never in the repository. Note the saved paths for the groups that build UI; after a new
   session, read them again, because the scratchpad does not carry over.
9. Index the worktree in the code graph (codebase-memory-mcp; in this session its tools are deferred, so load
   them with ToolSearch first): `index_repository` with the worktree's absolute path. Its project is named after
   the path (e.g. `D-source-jakubbohm-RevolutReader-.claude-worktrees-<name>`). Write the name into
   `.tdd-state.md` and put it in every brief to T and I: they read code they do not change through the graph, as
   their definitions say. **Index it again after every commit you make** (Rules for you, below), so the graph
   always holds the last commit: the server refreshes by itself only the folder this session started in, and the
   project's code-graph hook indexes an entered worktree only once, on entering (`CLAUDE.md` § Code navigation).
   An index in place takes seconds, and it works the same whether this session started in the worktree or
   entered it. Read code you do not change through the graph yourself, too.
10. Plan the chapters (§ Chapters, step 1), starting from the chapters `tasks.md` suggests, and write the plan
    into `.tdd-state.md`.

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
   frontend test, or manual row), the diff of `Scenarios/` and `Dsl/`, anything T flagged, and the chapter
   plan (§ Chapters, step 1). End your turn and wait.
   - Change requests from the human go to T via SendMessage; then verify again and re-present.
   - Approval: tick the acceptance tasks in `tasks.md`, record the acceptance tests and the agreed chapter plan
     in `.tdd-state.md`, commit `test(<cNNN>): [accept] <n> acceptance tests, red`. This T is then retired: the
     acceptance group is a chapter of its own.

## 2. Unit groups (`[unit]`), one group at a time, in order

For each group:

1. **Red.** Send T the group (at a chapter's first group, spawn a fresh T with the chapter brief, § Chapters;
   otherwise SendMessage to the chapter's T). Inputs: the group's tasks, the related scenarios, the design
   sections it needs.
2. **Verify red** yourself: the build passes; the group's new tests fail at runtime; all previously
   green tests are still green. If a test passes immediately, send it back to T: either the
   behaviour already exists (T says so, and the task gets ticked) or the test is too weak.
3. Commit T's work: `test(<cNNN>): [red] <group name>`.
4. If `review=all`: stop and present the group's tests to the human. Wait. Apply feedback via T,
   verify red again and commit the fixes as another `[red]` commit (never amend).
5. **Green.** Send I the group (at the chapter's first group for I, spawn a fresh I with the chapter brief;
   otherwise SendMessage to the chapter's I). Tell I which test files define the group and that it must not
   change them.
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
slice starts. The final `[close] Acceptance green` is § 4 for the whole change. Consecutive slices form the
chapters (§ Chapters).

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

## Chapters

An agent's context keeps every file it read and all its thinking, so one pair of agents for a whole change
outgrows it (C9a: the test-writer at 906k tokens), while a fresh pair per slice rereads the design and the
conventions for every slice (`docs/software-factory/lessons.md` R-77). The apply therefore runs in chapters, each
with a fresh T and I.

1. **Plan** (§ 0 step 10), before group 1:
   - Group 1, the acceptance group, is a chapter of its own. Its T is retired once the human approves the
     acceptance tests (§ 1 step 3).
   - Split the slices into chapters of consecutive slices that touch the same code: the same component, area
     or test kit (for example the backend foundation, the API slices, the frontend pieces, the guards and the
     deployment). Propose suggests this split in `tasks.md`, before group 1 (`openspec/config.yaml`, tasks
     rules): take it over, and change it only where it breaks these rules or the sizing below, saying why. A
     change proposed before that rule has no suggestion; split it yourself. The final
     `[close] Acceptance green` belongs to the last chapter. A change without slices (3 scenarios or fewer) is
     group 1 and one chapter.
   - Size by content, not by a count of groups: what one group adds to an agent's context has ranged from
     about 5k to 50k tokens. Chapters of four to nine slices ran well (C8a, C8b). The token budget (step 3)
     catches a chapter planned too large.
   - Write the plan into `.tdd-state.md`, name each chapter (A, B, …) with its groups, and present it at the
     acceptance gate.
2. **Within a chapter,** resume its T and I with SendMessage group by group (§ 2, § 2b, § 3).
3. **Token budget.** Each completion notice of T or I ends with its context size (`subagent_tokens` in its
   `<usage>` block). Record it in `.tdd-state.md` for that agent. When either agent passes **250k tokens**,
   end the chapter early: after the next slice's `[close]` commit (without slices, after the next group's
   commit), run the checkpoint (step 5), and the rest of the chapter becomes a new chapter with a fresh pair.
   Where a notice shows no size, chapters end only where they were planned.
4. **A fresh agent** is spawned at the chapter's first group that needs it: T at the first red, I at the first
   green. Brief it with: the change name, the chapter and its groups, the review mode, the code graph's project
   (§ 0 step 9), the standing rules for T and I from `.tdd-state.md`, a short account of what the code holds
   now, the design sections the chapter needs and, for UI, the saved design files (§ 0 step 8). Tell it that it
   starts mid-change: the specs, `design.md`, the tests and the commits are the source of truth, not an earlier
   agent's memory. The same brief replaces an agent that cannot be resumed.
5. **Checkpoint at each chapter's end,** after its last commit, except the last chapter, where § 4's report
   takes its place:
   1. Run the full suite (`dotnet test` and the frontend tests) and the traceability test: everything passes
      except the acceptance tests of later chapters.
   2. Rewrite `.tdd-state.md` for resuming: "Resume here" names the next chapter and its first group; what the
      code holds now, briefly per area; the standing rules for T and I; the retired pair marked with their last
      token counts. Commit it: `docs(<cNNN>): [close] chapter <name>'s state`.
   3. Stop, in every review mode: only the human can compact your context. Report the chapter (groups done,
      test totals, disputes, the agents' last token counts) and give a ready command:
      `/compact /tdd-apply <change>: chapter <name> is done and committed (<sha>). Re-read .tdd-state.md and
      the tdd-apply skill, then start chapter <next> with a fresh test-writer and implementer.`
      Ask with AskUserQuestion whether to compact first and then continue, continue without compacting, or
      stop here. End your turn and wait.

## Frontend groups

A group whose tests are Vitest tests (`src/RevolutReader.Web/`) follows the same loops. There, "builds" means
`npm --prefix src/RevolutReader.Web run typecheck` passes, lint (`run lint`) stays clean, and "the tests" are
`npm --prefix src/RevolutReader.Web test` next to `dotnet test`. A new frontend test fails at runtime: an
assertion, or a stub that throws.

## Rules for you (O)

- Never edit tests or production code yourself. The only files you edit are `tasks.md` (checkboxes),
  `.tdd-state.md` and the close-out docs. Restoring files I was not allowed to change is the one exception.
- Always run the tests yourself before accepting any report from T or I. Never start a build or test run
  while T or I is still working: they share one working tree.
- Commit only on the change branch, at the handoffs above, with the step tags from `workflow.md` § 3.
  Never push, never commit on `main`, never open a PR.
- After every commit, run `index_repository` on the worktree (§ 0 step 9) before you brief T or I again.
- Keep each chapter's T and I alive for that chapter and resume them via SendMessage; every chapter starts
  with a fresh pair (§ Chapters). If an agent can no longer be resumed, or SendMessage is not available, spawn
  a fresh one with the chapter brief (§ Chapters, step 4). Artifacts are the source of truth, not agent memory.
- Their definitions set T's effort to high and I's to medium (`docs/software-factory/lessons.md` R-71). Pass the
  Agent tool's `effort` only when the human asks for another level for a chapter (it then also holds when the
  agent is resumed), and record that in `.tdd-state.md`.
- Do not use `isolation: "worktree"` for T or I. They must share one working tree.
- Never put real bank data or secrets into anything you send, commit or record.
- Whenever you send I a group that builds or changes UI, include the saved paths of the design files that group
  needs (§ 0 step 8), and tell I that the look follows them.
