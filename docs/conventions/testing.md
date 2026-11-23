# RevolutReader — Testing conventions

**Status:** decided in F0-1 (2026-11-04), one decision at a time with the user · **Sources:** the user's Claude session on TDD and BDD (2026-10-22) and the kit it produced; DoseUp's `docs/conventions/testing.md` and `docs/adr/0003-testing-stack.md`; [spikes/enable-banking-mock/](../../spikes/enable-banking-mock/README.md) · **Mirror:** `.claude/rules/testing.md` · Where RevolutReader simplifies, the full version is kept for the software factory: [software-factory/lessons.md](../software-factory/lessons.md) R-12 to R-21; the project's side: [divergences.md](../software-factory/divergences.md).

Already fixed elsewhere:

- kickoff ch. 7 and 8: TDD + BDD;
- [README.md § Backend code](README.md#backend-code): read endpoints have an exact-shape test; the anonymous-endpoint allowlist is checked by a test;
- [workflow.md § 4](workflow.md#4-cicd): every CI check blocks or is deleted.

## The approach

- **Every OpenSpec scenario is an executable specification:** exactly one acceptance test, written before the code (§ Acceptance tests).
- **Double-loop TDD.** Outer loop: all acceptance tests of a change are written first and fail. Inner loop, one task group at a time: unit tests fail first, then the implementation makes them pass. The acceptance tests go green at the end.
- **Test-first is enforced by separate agents,** not by discipline: a test-writer writes the failing tests, an implementer makes them pass and may not change them, an orchestrator verifies every step (§ Test-first workflow).
- **Every test is behavioural:** it asserts observable outcomes through a public interface (a returned result, a response, a stored state, a request sent to the fake bank), never internal calls or private state. Hand-written in-memory fakes, no mocking framework.

## Acceptance tests: executable specifications

Farley's four layers (LMAX style), in plain C#. No Gherkin and no Reqnroll: OpenSpec scenarios already are the readable Given/When/Then layer, and `.feature` files would be a second copy of the spec.

| Layer | Answers | Knows about |
|---|---|---|
| Test case (`Scenarios/`) | what the system should do | domain concepts only: balance, transaction, allowed user |
| DSL (`Dsl/`) | how intent becomes calls; defaults; unique names per test (aliasing) | the domain, not channels |
| Driver (`Drivers/`) | how to talk to the system: HTTP, the fake bank, sign-in tokens, the clock; remembers earlier steps, so test cases pass no IDs | URLs, JSON, status codes |
| System under test | the real app | nothing about tests |

- **A port's capability is driven through the port itself** (c004 design.md D1): when a port that later changes build on has its own spec (the bank adapter, `bank-reads`), its driver takes the port from the test's own app copy (`Services`, so with the production wiring: settings, `HttpClient` and the bank client's retries, at a zero wait, § Fake bank) instead of calling an endpoint. The other three layers are unchanged; the observable outcomes are the results the port returns and the requests the fake bank received.
- **The test-case layer is the spec.** The implementer never changes it; changing a test case is a spec change and needs the user's approval.
- **Lifecycle of one acceptance test:** the acceptance group writes the test case, the DSL methods and driver methods that throw `NotImplementedException` (red); the unit and integration groups leave it alone; the wiring group writes the endpoint and the real driver method (it now runs against the app); close makes it green.
- **Common mistakes:** implementation leaking into a test case (HTTP calls, status codes, selectors: a test case that would change if the channel changed is in the wrong layer); edge-case combinations at this level (they belong in unit tests); shared seeded data instead of aliasing.
- **The harness is a one-time setup:** C1 builds it with one trivial scenario green end to end (a walking skeleton), before any real feature.

## Task groups

`openspec/config.yaml` shapes `tasks.md` so that it is the test list:

1. `## 1. [acceptance] Acceptance tests`: one task per new or changed scenario, `Acceptance: <capability> / <scenario name>`, with ` (frontend)` or ` (manual)` when the scenario is verified at that level (§ Every scenario has exactly one test).
2. `## N. [unit] <Component>`: one group per component that carries rules; each task is one behaviour, phrased like the test name.
3. `## N. [integration] <Port>`: only for a new or changed port contract (§ Integration tests).
4. `## N. [wiring] <Area>`: plumbing without rules (endpoints, mapping, DI, migrations, driver methods). No unit tests: the acceptance tests cover it.
5. `## N. [close] Acceptance green`: all acceptance tests of the change pass; then the close-out tasks (`CLAUDE.md` if build, test or run commands changed).

- **Never a "write tests" task:** a test is part of every behaviour task.
- **One group per round trip** between the agents: one component, not one checkbox and not the whole change.
- **More than 3 scenarios: slice per scenario.** All acceptance tests are still written and reviewed first; then each scenario gets its own unit, integration and wiring groups and a `[close]` group that turns its acceptance test green, before the next scenario starts. The final `[close]` runs them all.
- **A sliced change suggests its chapters** in a short paragraph before group 1: group 1 alone, then runs of consecutive slices that touch the same code. `/tdd-apply` gives each chapter a fresh pair of agents (§ Test-first workflow) and confirms the split with the owner at the acceptance gate.

## Test-first workflow

A change is implemented with **`/tdd-apply <change> [review=acceptance|all] [checkpoint=stop|continue]`** instead of `/opsx:apply` ([`.claude/skills/tdd-apply/`](../../.claude/skills/tdd-apply/SKILL.md), agents in [`.claude/agents/`](../../.claude/agents/)). The exception is a tooling-only change (`skip_specs: true`, e.g. CI): it has no scenario and nothing to test first, so it is applied directly with `/opsx:apply` and its task groups are named after its work ([workflow.md § 6](workflow.md#6-openspec)).

- **Three roles, three contexts.** The **orchestrator** (the session running the skill) plans, delegates, verifies and judges; it edits only `tasks.md` checkboxes, `.tdd-state.md`, the close-out docs and the spec or design fix of a dispute the user resolved (see Disputes below). The **test-writer** subagent writes failing tests and compile-only stubs. The **implementer** subagent makes them pass. Separate contexts are what stop tests from mirroring an implementation the same agent already has in mind. The agents' definitions set their reasoning effort: the test-writer high, the implementer medium (2026-11-21, [lessons.md R-71](../software-factory/lessons.md)); the orchestrator passes another level for a chapter only when the owner asks.
- **A fresh pair of subagents per chapter** ([#67](https://github.com/jakubbohm/RevolutReader/issues/67), 2026-11-21; [lessons.md R-77](../software-factory/lessons.md)). Before the first group the orchestrator splits the apply into chapters, starting from the split `tasks.md` suggests (§ Task groups): the acceptance group alone, then runs of consecutive slices that touch the same code. Each chapter gets a fresh test-writer and implementer, resumed with SendMessage from group to group within it. A chapter ends early, at the close of the slice in progress, once either agent's context passes 250k tokens, which each agent's completion notice reports. Each chapter except the first and the last ends with a checkpoint: the full suite green except later chapters' acceptance tests, `.tdd-state.md` rewritten for resuming and committed, and, with the default `checkpoint=stop`, a stop, so that the owner can compact the orchestrator. With `checkpoint=continue` the next chapter starts at once, and the orchestrator's context keeps growing across chapters until Claude Code compacts it automatically, at a moment nobody chooses; the orchestrator then re-reads `.tdd-state.md`. The chapter plan, the agents' IDs and last token counts, the current group, the review and checkpoint modes and open disputes live in `openspec/changes/<change>/.tdd-state.md`. Running `/tdd-apply <change>` again in a new session resumes from it: no new chapter plan and no acceptance group, and the baseline expects the acceptance tests not yet closed to be red. The artifacts and tests stay the source of truth: a fresh agent, or one replacing an agent that cannot be resumed, is briefed from the state file. One shared working tree, no worktree isolation. Why: one pair for a whole change outgrows its context (C9a's test-writer reached 906k tokens), while a pair per slice rereads the design and the conventions for every slice.
- **No read bans.** The implementer reads the tests (they are its specification); the test-writer reads production code (real types). In a dispute the test-writer decides against the spec and design without reading the disputed implementation.
- **Code they do not change is read through the code graph** ([#67](https://github.com/jakubbohm/RevolutReader/issues/67), 2026-11-09; kept current since 2026-11-10). The orchestrator indexes the worktree in codebase-memory-mcp before the first group and again after every commit it makes, and puts the project's name in every brief. The server refreshes by itself only the folder its session started in ([CLAUDE.md § Code navigation](../../CLAUDE.md#code-navigation)), so indexing after every commit keeps the graph current whether the session started in the worktree or entered it. Both agents have the graph's read tools (their definitions list `mcp__codebase-memory-mcp__*` and withhold indexing, deleting and the graph's own ADRs). They read a pattern to follow, a type's members or a method as a single symbol (`search_graph` by name and kind, then `get_code_snippet`; callers through `trace_path`). They read as files what changed since the last commit, what they will change, small files they need most of, and the specs, the design, the conventions and other files that are not code; a search that finds nothing, or a snippet that does not show its symbol, sends them to the file. Why: in C8a's apply, file reads were a quarter to a half of each agent's context, mostly whole files read once as models. What the probes found: [lessons.md R-71](../software-factory/lessons.md).
- **The implementer rule:**
  - *How:* production quality — the real implementation per `design.md` and the conventions; no hardcoded results, no shortcuts; refactor while green.
  - *What:* only the behaviour the failing tests ask for. If more seems needed, don't code it and don't drop it: report it as a missing test.
  - Bug guards (`ArgumentNullException.ThrowIfNull`) are quality. Expected states (a Result value such as "the bank is busy") are behaviour and need a test.
  - Why it matters here: a retry on Enable Banking's 429 would burn the 4 unattended requests a day; returning more transaction fields than the UI shows breaks the exact-shape rule and exposes bank data.
- **The orchestrator verifies, never trusts a report.**
  - After red: the build passes; every new test fails at runtime (a `NotImplementedException` stub or an assertion), never at compile time; every previously green test is still green.
  - After green: all tests pass except this change's acceptance tests still waiting for their wiring; the green step's diff touches no test file outside the implementer's folders (`Drivers/` in wiring and close, `IntegrationTests/Wiring/` in wiring). A violation is reverted and the implementer resumed.
  - A hook blocks the implementer's test edits as a second layer; the diff check is the one to rely on. The hook ([`.claude/hooks/deny-test-edits.mjs`](../../.claude/hooks/deny-test-edits.mjs)) is registered in `.claude/settings.json`, so it runs for every session and subagent, and it blocks only the subagent whose `agent_type` is `implementer`. **C1's check (2026-11-05, Claude Code 2.1.318, VS Code extension):** declared in the implementer's frontmatter, the hook never ran, even with an absolute path and `onFailure: "block"` (a temporary log in the script stayed empty). Registered in the project settings, it ran and blocked the implementer's probe write to `Scenarios/`, let its write to `Drivers/` through, and let the main session's writes through. The implementer changed no disallowed file in C1, so the diff check had nothing to restore.
- **Human gates.** Your reading routine after propose (below). The acceptance tests, always: there you review how the spec was translated. With `review=all`, also the tests of each unit and each integration group. **Default `acceptance`; `all` for C1 and C5,** the first two changes using the workflow. Unresolved or repeated disputes always reach you, and so do the chapter checkpoints unless you choose `checkpoint=continue`.
- **Disputes:** behaviour is decided by the delta spec, API shape by `design.md`, test quality by the test-writer. The orchestrator forwards only the claim, the failing test and the spec or design excerpt, never the implementation. A silent or ambiguous spec, or the same dispute a second time, goes to the user; the resolution lands in the spec or the design, not only in code.
- **Commits at every handoff,** on the change branch, tagged by step ([workflow.md § 3](workflow.md#3-git)). Committing the test-writer's red tests before the implementer starts is what makes the diff check reliable.
- **Close:** a failing acceptance test caused by missing behaviour goes to the test-writer as a new unit test, then to the implementer; a glue bug (route, DI registration, serialization) goes straight to the implementer. Then the full suite and the traceability check.

### Your reading routine (about 5 minutes per change, after propose, before apply)

1. Proposal TL;DR: is this the right thing, with the right scope?
2. The list of scenario names: is anything missing, or there that shouldn't be? Missing scenarios are the most common and the most expensive problem.
3. Read in full only the scenarios that are risky or surprising.
4. Design TL;DR: do you agree with the decisions and the integration points?

The acceptance-test gate is then the second check, not the first. If a TL;DR does not match its artifact, read the whole artifact: the tests follow the body, not the TL;DR. Specs get no TL;DR (it would interfere with merging delta specs on archive); their scenario names must work as a checklist on their own.

### Code review after the apply

When the change is built and its draft PR is open ([workflow.md § 6](workflow.md#6-openspec), a change's path, step 3), the owner runs Claude Code's `/code-review` on it (xhigh effort, with `--comment`, so every finding is a thread on the PR anchored to its file and line). A review run without `--comment` leaves its findings in the conversation only: the triage posts them to the PR first, as review comments, so every finding is a thread all the same, numbered like the others and answered in its thread, and a later round sees it (the owner, 2026-11-22, [lessons.md R-59](../software-factory/lessons.md)). The findings are then worked through with **`/triage-review <PR>`** ([`.claude/skills/triage-review/`](../../.claude/skills/triage-review/SKILL.md)), never with the review's own `--fix` (the user, 2026-11-08; the first two reviews, PR #26 and #33, were triaged by hand the same way):

- **Every finding is verified first,** read-only, by a saved workflow ([`.claude/workflows/triage-review-verify.js`](../../.claude/workflows/triage-review-verify.js)): an investigator decides real, not real or unclear with concrete evidence (the guard or test that rules it out, the design decision that intended it, or the code path that confirms it), a skeptic tries to overturn the verdict, and plain code routes the result. A high-effort review reports many findings and some are wrong, so nothing is fixed or declined on the review's word alone, and the orchestrator opens every piece of evidence before a finding is declined.
- **Fix:** a confirmed finding whose fix is local (only files the PR touches or the finding names; no new dependency, setting, Bicep change, API contract change or spec change) and not large. The same roles as the apply: the test-writer writes the guard test that reproduces it, the orchestrator verifies that it fails at runtime and commits, the implementer fixes it, the orchestrator verifies the suite and that the diff changed no test file, and commits ([workflow.md § 3](workflow.md#3-git), `[review]`). A guard test that passes at once refutes the finding: it stays as a guard, and the finding is declined with it as the evidence. Docs, naming and dead-code findings have no failing test and go to the implementer directly, except a docs finding under `openspec/`, which the orchestrator fixes itself because the implementer cannot write there; test-quality findings go to the test-writer.
- **Decline:** only a refuted finding, and only with the evidence, written as a reply in its thread; the thread is resolved. When in doubt the finding is asked, never declined.
- **Ask:** everything else goes to the owner, an overview first and then one finding at a time with the trade-off and a recommendation: a disputed verdict, a fix that changes behaviour a spec describes (a spec change, never a quick fix), a contract change, a fix outside the PR's files, a large fix. The owner's answer is fix now, decline with their reason, or defer: a GitHub issue, or a heads-up in the design of the step it belongs to.
- **Each thread is answered as soon as its finding is handled,** not at the close: the reply gives the commit, the evidence or the owner's decision, and the thread is resolved. Only an ask the owner leaves undecided is answered at the close, its thread left open. So the threads are the complete record of a round that stops part-way, also for a Direct PR, whose state file is lost with its session (the owner, 2026-11-23, [lessons.md R-59](../software-factory/lessons.md)).
- **Fixes run one after another** in one working tree; only the verification runs in parallel. Parallel fixes would need a worktree per finding and would either merge the test-writer and the implementer into one agent or double them; left out until a round proves too slow.
- **Close:** the full suite and checks, a reply in each thread of an ask left undecided, one summary comment on the PR, and the state file `openspec/changes/<change>/.review-triage.md`, committed. A Direct PR has no change folder: its state file stays in the session's scratchpad, and its threads, summary comments and commits are the record. Another `/code-review` on the fix range is the owner's call, before `/opsx:archive` ([workflow.md § 6](workflow.md#6-openspec), a change's path).
- **A later round** triages another `/code-review` on the same PR: only the threads still open (its new findings, and any ask left undecided); the resolved ones stay as they are, except that a rerun after an interrupted round takes back the threads that round already closed, which are all the findings it handled, with their outcomes, into its summary, without a second reply, and an open finding with that round's commits resumes where its commits stop. Findings are numbered in the order their comments were posted on the PR, which is when each comment's review was submitted (a pending review's comments wait until it is), the ones the triage posted from the conversation included, so a round's numbers continue after the last round's and every `[review]` commit names one finding of the PR. Each round has its own summary comment, headed with its round, and its own section in the state file (a Direct PR: a state file of its own).

## Integration tests

Broad integration (everything wired together) is what the acceptance tests do. Integration tests here are narrow: one adapter at a time.

| What | When | Who |
|---|---|---|
| Port contract: the behaviours `design.md` states for a port (concurrency, idempotency, failure modes), run against both the in-memory fake the unit tests use and the real adapter, so the fake stays honest | before the implementation, in an `[integration]` group | test-writer |
| Happy-path persistence and glue | — (the acceptance tests cover it) | — |
| Adapter edge cases the acceptance tests cannot reach cheaply: a migration on existing data, a tricky query, serialization quirks, the Enable Banking client's handling of each error response | after the implementation, in a `[wiring]` group, in `IntegrationTests/Wiring/` | implementer |

- Contract tests exist only for ports with an in-memory fake, so most changes have no `[integration]` group. The Enable Banking client has no fake unless a unit test genuinely needs one (§ Fake bank).
- **How a contract runs against both** (C7b, c010 design.md D12; the first is the transaction store's): an abstract class holds the tests, written only against the port (`IntegrationTests/Account/TransactionStoreContract`), and one subclass per implementation, marked `[InheritsTests]`, gives each test a new, empty store: `InMemoryTransactionStoreContract` for the fake, `TableTransactionStoreContract` for the adapter on Azurite (§ Storage). The fake lives in the unit-test project, next to the tests that use it; the integration project compiles the same file as a link (`<Compile Include="…" Link="…" />`), so the fake the unit tests trust is the one the contract checks. The second is the push device store's (C8a, c011 design.md D11): `IntegrationTests/Push/PushDeviceStoreContract`, with `InMemoryPushDeviceStoreContract` and `TablePushDeviceStoreContract`, the same way.
- Tests needing Docker (Testcontainers) stop with a message when Docker is not running; they are never skipped silently.

## Where tests live

```
tests/
├─ RevolutReader.AcceptanceTests/     one test per OpenSpec scenario, app inside the test process
│  ├─ Scenarios/<capability>/         the test cases: domain language only, they are the spec
│  ├─ Dsl/                            domain-language helpers: defaults, unique names per test
│  ├─ Drivers/                        the only layer that knows HTTP: API calls, fake bank, sign-in tokens, clock,
│  │                                  Azurite, scenario dates
│  ├─ Traceability/                   the check that every scenario has exactly one test
│  └─ Conventions/                    structural checks that need the running app: the anonymous-endpoint
│                                     allowlist, the harness's environment
├─ RevolutReader.UnitTests/           domain rules, no I/O; paths mirror src/
├─ RevolutReader.IntegrationTests/    our adapters against their fakes: the Enable Banking client against the
│                                     fake bank server; the store's contract, on its fake and on Azurite (Testcontainers)
└─ manual-scenarios.md                scenarios checked by hand at handover

src/RevolutReader.Web/src/            the frontend's tests sit next to its code (below)
.claude/skills/triage-review/scripts/ the triage scripts' tests sit next to them (below)
```

- **One project per test layer, named after the layer** (as DoseUp). `dotnet test` runs everything; CI selects a layer by project, never by tags on tests.
- **Mirroring is mechanical** (as DoseUp): a test file sits at its target's path with the project swapped (`src/.../Balance.cs` ↔ `tests/RevolutReader.UnitTests/.../BalanceTests.cs`). Acceptance tests mirror the specs instead: one file per capability, one test per scenario. Unit tests are named after their behaviour task.
- **Who may edit what** (the orchestrator's diff check enforces it; a hook that blocks the implementer is the second layer, § Test-first workflow): the test-writer owns `tests/`; the implementer may edit only `RevolutReader.AcceptanceTests/Drivers/` in the wiring and close steps, and `RevolutReader.IntegrationTests/Wiring/`, where it writes adapter edge-case tests after the implementation.
- **Shared fakes only when two test projects need the same one;** no `tests/Fakes/` project up front. A fake the contract tests also need is compiled into the integration project as a link (§ Integration tests).
- **Frontend tests live next to the frontend code** (Vitest with Testing Library and jsdom; decided in C3, c003 design.md D1):
  - a unit test sits next to its target as `<file>.test.ts(x)`, e.g. `src/app/device.ts` ↔ `src/app/device.test.ts`;
  - scenario tests go one file per capability, `src/scenarios/<capability>.test.tsx` (`.test.ts` when it has no JSX, as `push-display`'s, which since C9b opens the app through `renderApp` without JSX), each test a `scenario("<capability>", "<exact scenario name>", …)`;
  - the helpers live in `src/test/`: `setup.ts`, `scenario.ts`, `renderApp.tsx`, `server.ts` (the fake server), `clock.ts` (the test clock), `banners.ts` (a banner found by its tone and title) and the kit's own self-test, `server.test.ts`.

  The implementer may not edit `*.test.ts(x)`, as with every test file; `src/test/` belongs to the test-writer.
- **Frontend scenarios that wait or store** (C7a, c009 design.md D8):
  - **The test clock** (`clock.ts`): `startTestClock()` fakes `setTimeout`, `setInterval` and `Date` only, from a fixed start, and `setup.ts` stops it after every test. The real event loop keeps running, because React's scheduling, the fake IndexedDB and the fake server's immediate answers need it.
  - **Moving it:** `timePasses(ms)` moves it one timer at a time and gives the app real turns after each, so a timer the app starts in response starts at the right time; `timePasses(0)` lets what is due now happen. A single `advanceTimersByTimeAsync` started effect timers too late. The screen is read with `getBy…` and `queryBy…` after it: `findBy…` and `waitFor` move the clock themselves, in 50 ms steps. Taps go through `userOnTheTestClock()`; Testing Library's own event wrapper finds the clock through the `jest` global `startTestClock` sets, without which a tap waits forever.
  - **Times shown** are relative to the test clock (`ago(2 * MINUTE)` → "před 2 min"), so no time zone is needed.
  - **The phone's storage** is `fake-indexeddb` (`setup.ts`), the same browser API, so the app's storage code runs unchanged. It is emptied in place before every test, not replaced, since the app's idb-keyval store keeps its connection open. `phoneKeeps(…)` and `keptBalance()` set and read the stored balance. Since C9b, `phoneStorageBusy()` holds a `readwrite` transaction open on the balance's store, so the app's own write starts but cannot finish until the function it returns frees the store (c015 design.md D4: the message is shown without waiting for the write). Free it in a `finally`, or the next test's emptying waits behind it.
  - **The fake server** (`server.ts`) answers each address with the test's answers in order, the last repeating; `after(ms, answer)` delays one on the test clock; requests honour their `AbortSignal` (`aborted …` in the timeline). It keeps every open request until it ends, as a browser's network stack does: Node's `Request` follows the app's abort signal only through a weak reference, so otherwise a garbage collection during a wait cuts that link and the app's abort never arrives. It also answers `GET /health`, models `goOffline()`/`goOnline()` and `leaveApp()`/`returnToApp()`, and answers a balance no scenario names when a test sets none, as the backend's `BankDsl.DEFAULT_BALANCE` (lesson R-15). `renderApp`'s `reopen()` closes the app and opens it again; `timesSent(request)` counts what it sent. The kit's self-test `server.test.ts` forces a collection (`gc()`, which `vite.config.ts` gives the test workers with `--expose-gc`) and checks that an aborted open request still ends (lesson R-99). A test that fails only in full runs is first reproduced under memory pressure, by hand and never in CI: `npm run test:gc-pressure` ([`CLAUDE.md` § Commands](../../CLAUDE.md#commands)) preloads `gcPressure.mjs` into every test worker, which forces a full collection every 5 ms, so such a failure shows on every run.
- **The triage scripts' tests sit next to them** as `*.test.mjs` in `.claude/skills/triage-review/scripts/`, run with Node's own runner (`node --test`, no dependency; the owner, 2026-11-22, [lessons.md R-103](../software-factory/lessons.md)). Only their pure parts are tested, on made-up comment and file objects: nothing calls `gh` or the network. CI runs them in its `frontend` job; the command is in [CLAUDE.md § Commands](../../CLAUDE.md#commands).

## Every scenario has exactly one test: the traceability check

- **One automated test** in `RevolutReader.AcceptanceTests/Traceability/` compares the scenarios in the specs with the tests that claim them. It runs with every `dotnet test`, so a missing test fails the build; the orchestrator runs the same test.
- **Scenarios** are the `#### Scenario: <name>` headings of the main specs (`openspec/specs/`) with each active change's delta applied **per requirement**, in change-id order: ADDED adds the requirement, MODIFIED replaces its scenarios, REMOVED drops them, RENAMED renames it and keeps them. `openspec/changes/archive/` is ignored. Reading every heading literally would count a modified requirement's scenarios twice and keep demanding a test for a removed one (C1, design.md D7).
- **Each scenario is verified at exactly one level and claimed exactly once:**

  | Level | Claimed by | Example |
  |---|---|---|
  | API acceptance test (the default) | an attribute on the TUnit test | `[Scenario("account-detail", "Balance shown in CZK")]` |
  | Frontend test (rules only the browser can show) | a `scenario(...)` helper in Vitest, with string literals so the check can read them | `scenario("account-detail", "Amounts formatted in Czech", () => …)` |
  | Manual at handover (device-only behaviour, e.g. how a push notification appears on iOS) | a row in `tests/manual-scenarios.md`: capability, scenario, why manual, the handover step that checks it (M5, M7), date last checked | the file doubles as the handover checklist |

- **The check fails when:** a scenario has no claim; a scenario is claimed twice; a claim names a scenario that does not exist (renamed or removed); two scenarios in one capability share a name; a scenario or requirement heading sits inside a code fence, where its scenarios would otherwise need no claim: inside an example, below a fence left unclosed, or below a line OpenSpec reads as a fence, such as ```` ```json``` ```` at the start of a line.
- **It checks existence, not results.** While a change is being implemented, its new acceptance tests exist and fail ([workflow.md § 6](workflow.md#6-openspec)).
- **Frontend claims** (c003 design.md D7): the check reads every `scenario(` call in `src/RevolutReader.Web/src/**/*.test.ts` and `*.test.tsx`.
  - A call whose capability and name are string literals (single or double quotes; line breaks allowed between the arguments) is a claim.
  - Any other `scenario(` call is reported as unreadable, with its file and line, so a claim can never vanish silently: a template literal, a variable, a missing name, even a call in a comment.
  - Name frontend test files `*.test.ts(x)`: Vitest also runs `*.spec.*` files, but the check doesn't read them.
  - The helper itself sits in `src/test/scenario.ts`, which is not a test file, and names the test `<capability> / <name>`.
- **When it arrived:** C1 built the check with the .NET attribute and the manual list; C3 added the frontend claims.
- No browser end-to-end tests: frontend rules are tested on components, device rules by hand (trade-off: [software-factory/divergences.md R-19](../software-factory/divergences.md); full version: [lessons.md R-19](../software-factory/lessons.md)).

## Acceptance-test harness: the app runs inside the test process

- Each acceptance test starts its own copy of the API inside the test process (TUnit.AspNetCore, TUnit's version of the ASP.NET Core test host), **in environment `Production`**, so it runs on the base `appsettings.json` (production truth) without Development-only behaviour; a test in `Conventions/` guards it. Before it starts, the test replaces only what it must control: the Enable Banking settings, Microsoft's sign-in, the cookie keys, the clock, the web root, the store's settings and the CNB's address (the web root since C3, the Enable Banking settings since C5, the store's since C7b, the CNB's since c017, § Fake CNB, the rest since C6). Everything else is production code.
- **Every app copy gets the fake bank's settings** (c004 design.md D6), because the app refuses to start without them: `Drivers/FakeBank` starts a WireMock.Net server per test before the app copy and writes its address, made-up application, session and account ids, an RSA key generated once per test run, a 5 s request timeout (short enough for the slow-bank scenario, long enough for a busy full run) and a zero retry wait (§ Fake bank) into the app copy's `EnableBanking` section. Tests that never read the bank get them too. FastEndpoints runs inside this host (proven in C1).
- **Every app copy gets the fake Microsoft's settings and three test services** (c007 design.md D6), because the app refuses to start without its sign-in settings: `Drivers/FakeMicrosoft` starts a WireMock.Net server per test before the app copy, writes `SignIn:Authority` (the fake's address), a made-up client id and secret, and the allowlist `lucie@example.com,petr@example.com` (Petr since C8a, § Test sign-in), and adds in `ConfigureTestServices`: plain-HTTP metadata allowed for the fake, ephemeral Data Protection keys, and a `FakeTimeProvider` as the app's only `TimeProvider` (§ Test sign-in, § Time and the background job). Tests that never sign in get them too.
- **Every app copy gets the store's settings** (c010 design.md D12), because the app refuses to start without `ConnectionStrings:tables`: `Drivers/AzuriteStorage` writes the test session's Azurite connection string and a table name no other app copy uses (§ Storage). They go in as host settings (`UseSetting`), because the app checks the connection while it registers the store, before a source added with `ConfigureAppConfiguration` arrives. Tests that never read the transactions get them too.
- **Every app copy's log lines are captured** (c016 design.md D7): `Drivers/CapturedLogEvents` (in `CapturedTelemetry.cs`) is added to each app copy as a logger provider and keeps every line that names its event, with its structured values. A capability whose outcome shows only in the telemetry is read there, as the owner reads it: push-arrivals' scenarios read the delays from the `PushArrived` lines' `DelaySeconds` through `Drivers/ArrivalDriver`, because the owner reads arrivals only through the queries in [deployment.md § Push arrivals](../operations/deployment.md#push-arrivals-c016). It is added in `ConfigureWebHostBuilder`, so the `Conventions/` guards that override `ConfigureTestServices` keep it.
- **The web root is a stand-in page folder** (c003 design.md D6):
  - `Drivers/StandInPages/` holds a tiny `index.html`. It's copied to the test output and set as every test app's web root (`UseWebRoot` in `AcceptanceTest`).
  - The tests check the backend's serving rules (which addresses get the page, which never do), not the frontend build. "The app's page" in the DSL means a successful `text/html` answer whose body is the stand-in page.
  - Nothing in the deployed app can switch it on: it's set in test code, not in a setting.
  - The real build is covered by the frontend tests, the CI build, the local checks against the API serving the build (c003 design.md D9) and the first deployment (C4).
- **One app copy per test,** because the app is configured for exactly one bank account, and tests sharing an app would fight over what the bank returns. **Cost measured in C1 (2026-11-05, owner's machine, Debug build, .NET 11 RC3, TUnit 1.80.0):** the first app copy in a run costs about 0.25 s (start-up and warm-up), each further copy tens of milliseconds when the tests run in parallel; a scenario test with its HTTP call takes about 60 ms; the acceptance project's 17 tests (5 app copies) run in about 0.9 s. No fallback needed; if it ever is: one copy per test class, with that class's tests run one after another.
- **Not covered:** the Aspire wiring and the hosting configuration. Running the app locally (`aspire start`) and the first deployment (C4) cover them.
- **No test needs a real secret:** the harness generates throwaway keys at runtime.
- This is a project-only exception to DoseUp's harness, which starts the real running app: [software-factory/divergences.md R-12](../software-factory/divergences.md).

## Fake bank: a local fake server in front of our real Enable Banking client

Evidence: [spikes/enable-banking-mock/](../../spikes/enable-banking-mock/README.md).

- **Automated tests** (every run, CI) point our real Enable Banking client at **WireMock.Net**, a fake HTTP server running inside the test (2.21.0, 2026-10-28, Apache-2.0). Each test sets up its own responses and checks the requests the app sent: the user's PSU headers on reads the user triggers, the phone's on the account check it triggers, no PSU headers on unattended reads ([ADR-0001-bank-data-access § Decision](../adr/0001-bank-data-access.md#decision), as amended by [ADR-0008-phone-triggered-check](../adr/0008-phone-triggered-check.md)).
- **The bank client's retries run in every test, with a zero wait** (c008 design.md D7): both harnesses, the acceptance tests' `Drivers/FakeBank` and the integration tests' `BankOnWireMock`, set `EnableBanking:RetryDelay` to zero (an edge test that checks a wait sets its own), so a retried request goes out at once. Not only for speed: the resilience library takes its clock from the app's services, and every acceptance app copy runs on a `FakeTimeProvider` that moves only when a test moves it, so a longer wait would never end; a zero wait does not depend on the clock. The production numbers are pinned by a unit test of the retry options, and the 0.8 s wait is declared in `appsettings.json`.
- **The fake responses are copied from real responses of Enable Banking's Mock ASPSP** (made-up data): the spike's `evidence/`, plus new captures when a change needs more (e.g. paging past 10 transactions). What the mock cannot produce (429 `ASPSP_RATE_LIMIT_EXCEEDED`, expired or revoked sessions, Revolut-specific fields) is written from the API reference and the M1 findings, with a comment saying so.
- **Never from the real account:** no recording against the real API (WireMock's record-and-playback is not used), and no real account data in test data or in the Mock ASPSP.
- **Enable Banking's Mock ASPSP** (sandbox application, test data entered in the Control Panel) is used for:
  - capturing realistic responses;
  - checking our real client against the real API on demand (C5), before the one final check against Revolut;
  - local development: the app on the owner's machine reads the mock, never the real account. A session needs the owner's approval with the Control Panel login, once per up to 180 days.
- **No CI job against the mock:** it would need the sandbox key and session as CI secrets and a human approval to start, and every test would share one data set.
- **No in-memory fake of the bank client** unless a unit test genuinely needs one.
- **The fake bank can hold its next balance answer** (C9a, c014 design.md D16): `Drivers/FakeBank`'s `HoldTheNextBalanceAnswer()` holds the next balance request until `ReleaseTheHeldAnswer()`; `WaitUntilTheHeldRequestArrives()` wakes when the request arrives (at most 10 s, never polling); everything else is answered meanwhile, and disposing the fake bank releases a held request. A test lines up "while the first is still reading the bank" this way, never by waiting real time.
- How this relates to the software factory: [software-factory/lessons.md R-13](../software-factory/lessons.md); what the project gives up: [divergences.md R-13](../software-factory/divergences.md).

## Storage: the real adapter on Azurite

Decided in C7b (c010 design.md D12), from [ADR-0005-data-storage § Decision](../adr/0005-data-storage.md#decision), item 3.

- **Storage is never faked** (§ Defaults: fake only what you don't own): the acceptance tests and the integration tests run the real Table adapter against Azurite, Microsoft's storage emulator, in a container started by Testcontainers (`Testcontainers.Azurite`).
- **One container per test session,** a TUnit shared data source (`Shared = SharedType.PerTestSession`), started before the first test that needs it and removed when the session ends: `Drivers/AzuriteStorage` in the acceptance project, `Storage/AzuriteTables` in the integration project.
- **The image is pinned:** `mcr.microsoft.com/azure-storage/azurite:3.37.0`, in both classes (the package's default image constant is obsolete).
- **A table of its own** for each app copy and each contract test: `t` and a new GUID's 32 hex digits, a valid `Transactions:TableName`. Tests stay apart without cleanup, and the adapter creates its table when it is missing.
- **Docker must be running:** every acceptance test that starts an app copy needs Azurite, so `dotnet test` needs Docker ([`CLAUDE.md` § Commands](../../CLAUDE.md#commands)). Without it the tests stop with a message saying so (§ Integration tests).

## Fake push service: a local fake in front of our real push sending

Decided in C8's explore (#51, S9) and built in C8a (c011 design.md D7), with [ADR-0010-web-push](../adr/0010-web-push.md).

- **A WireMock.Net server per test,** `Drivers/FakePushService`, stands in for Apple's or Google's push service, as `Drivers/FakeBank` stands in for the bank. It starts before the app copy. Its `Configure` writes the `Push` section:
  - a made-up VAPID pair, generated once per test run;
  - a made-up message key, made per test;
  - a made-up app address as `Subject`;
  - the fake's own origin as a known push service (`Push:Services:FakePushService`). That entry is plain `http` on a loopback host, which only a loopback entry allows.
- **A test device plays the phone:** `Drivers/TestDevice` makes its own P-256 key pair and 16-byte secret, as a browser does. Its push address points at the fake. The test signs in, registers the device through the real API, and sends through the message endpoint with the key. A scenario with two accounts signs in Petr, the second allowed user, as well (§ Test sign-in).
- **The fake checks what Apple would, and more,** and answers 403 when a check fails, so a wrong push counts as failed and the scenario goes red:
  - **The token:** an ES256 JWT signed with the app's VAPID key, `k` that key, `aud` the fake's scheme and host, `exp` in the future and at most 24 hours ahead, `sub` an `https:` address (RFC 8292).
  - **The headers:** `TTL` present; `Urgency`, when present, one of RFC 8030's four values (a push without it is of normal urgency); `Content-Encoding: aes128gcm`.
  - **The body** decrypts with the device's own key and secret, by **the tests' own RFC 8291 decryption** on .NET's cryptography, never the library's, so the library never checks itself. The decrypted JSON holds the expected message.
- **Gone and failed devices** are the fake's answers: 410 for a device the app must delete, 500 once for one counted as failed and kept.
- **The test-writer owns the fake push service and the test device,** as every fake: their checks are the only test that pushes follow RFC 8291 and RFC 8292, so the implementer, whose sending they judge, never writes or edits them. Self-tests in `HarnessSelfTests/` prove the checks bite:
  - the decryption reproduces RFC 8291 Appendix A;
  - the fake refuses another signing key, a wrong `exp` or `aud`, no `TTL`, an unknown `Urgency` and another encoding;
  - the fake accepts a correct push built by the test's own code.
- **The frontend's stand-ins:** jsdom has no notifications, no push and no service worker.
  - **The page's side:** `src/test/push.ts` stands in for `Notification`, `PushManager` with the service worker registration, and a `PushSubscription`, and it records what was asked of it. Every test's cleanup removes it. `src/test/server.ts` answers the three push addresses; a failing answer is set like any other (e.g. `subscription: serverError`). Since C8b, two helpers build on the stand-ins: `src/test/taps.ts` tells whether the permission question was asked while a tap's event was being dispatched (iOS asks only then), and `src/test/serviceWorkerReady.ts` plays a registration that never becomes ready.
  - **The service worker's side** (since C8b, c012 design.md D9, D10): `src/test/serviceWorker.ts` stands in for the members of the worker's scope that `listenForPushes` uses (its origin, `showNotification`, the app's open windows), so the push handling is tested as plain functions. Its helpers fire a push, as a browser that shows Declarative Web Push messages itself or as one that does not, and a tap on a shown notification; it records what was shown, closed, focused and opened.
    - **What a browser that reads Declarative Web Push hands the push event** (since C9b, c015 design.md D2, D8), as the [W3C Push API draft](https://w3c.github.io/push-api/)'s "Receiving a push message" says: no data of its own (`event.data` is `null`), and the notification it proposes (`event.notification`) carries a copy of the message's `notification.data` as its `data` (`null` when the message has none). So a test of that kind of browser finds a push's balance only where Safari would hand it over. Every other push is as before, and the event still fires for a message without `"mutable": true` (C8b's model; the draft and WebKit's post differ there, and the handler does not depend on it).
    - **The worker's own requests** (since c016, design.md D7): the stand-in's `fetch` hands each request to the fake server (`globalThis.fetch`, from `src/test/server.ts`), so a push's report of its arrival shows in the timeline and in `bodiesSent()`, and gets the answer the test set (`answerWith({ arrivals: … })`: 204 by default, 401 after a sign-out, or any trouble such as `serverError`, `after(ms, …)` or `goOffline()`). The worker and the page are one app on one origin, but the stand-in's origin and the fake server's page are made up apart: an address on the worker's own origin reaches the fake server as the same path on the page's origin, and any other address goes as it is and gets a 404.
  - **The remembered "Teď ne"** (C8b) lives in `localStorage`: `emptyThePhone()` clears it with the phone's IndexedDB before every test, a reopened app finds it as the phone kept it, and `phoneRemembersNotNow()` sets it before a launch.
- **What tests cannot show:** that Apple accepts our token and encryption. That is the manual check on the iPhone (C8b, [tests/manual-scenarios.md](../../tests/manual-scenarios.md)).

## Fake CNB: a local fake server in front of the Czech National Bank's API

Decided in c017 (design.md D10), with [ADR-0011-koruna-rate](../adr/0011-koruna-rate.md).

- **A WireMock.Net server per test,** `Drivers/FakeCnb`, stands in for `api.cnb.cz`, as `Drivers/FakeBank` stands in for the bank. It starts before every app copy, on the app copy's clock (`FakeCnb.Start(clock)`), and its `Configure` writes the `Cnb` section: its loopback address and a 2 s limit. So **no test reaches the real CNB**; the integration tests' app copies (`Wiring/MadeUpSettings`) point `Cnb:Address` at an unreached loopback port, as they do the bank.
- **Its answers are the CNB's real answer, captured on 2026-11-21:** `Drivers/CnbDaily.json`, the daily rates as the app asks for them (no `lang`, so with Czech names; 30 currencies, public data), with only the euro's `rate` and `validFor` replaced. It answers only a GET of exactly `/cnbapi/exrates/daily` with no query; anything else gets a 404, which the app reads as a failed ask.
- **By default it answers 25.125 for the clock's UTC date when it starts,** a rate no scenario names ([lessons.md R-15](../software-factory/lessons.md)), so a scenario never passes on the default. A test sets the answer through the DSL (`Dsl/RateDsl`): a rate and its day (shifted by the scenario calendar, § Time and the background job), a server error, or an answer that never comes within the limit (held past 2 s of real time and freed when the fake is disposed). It counts every request as it arrives (`RequestsTheCnbReceived`).
- **The kept rate is real storage:** each app copy gets a `KorunaRates` table of its own (§ Storage). "The kept rate is …" writes through the app copy's own `IKorunaRateStore` before the scenario's first request that needs a rate (the app reads the row once, on first need); "no rate is kept" reads it and throws when one is, as the DSL's other "is not" steps check.
- **The limit stays 2 s in the tests,** as in production: a shorter one could turn a slow fake under a busy parallel run into a failed ask and a wrong rate in an unrelated scenario. The one scenario that waits for it takes 2 s.
- **The test-writer owns the fake,** as every fake. Self-tests in `HarnessSelfTests/FakeCnbSelfTests` prove its default answer (the capture intact, UTF-8, the euro replaced) and that it answers nothing else.

## Test sign-in: fake the signature, never the security code

The principle is DoseUp's (its software-factory entry F-68). The mechanics differ, because the backend runs the sign-in itself and keeps a login cookie ([ADR-0003-sign-in](../adr/0003-sign-in.md), Q2): [software-factory/lessons.md R-24](../software-factory/lessons.md).

- **A fake Microsoft in front of the real handlers** (c007 design.md D6): `Drivers/FakeMicrosoft` serves the discovery document (naming the real personal-account issuer), the public half of an RSA key generated once per test run, and the token endpoint, which answers the ID token the driver set up for this sign-in, signed with that key. The OpenID Connect and cookie handlers, the issuer check, reading the user, the allowlist check (Q1), the cookie names and lifetimes, the 401/403 responses and the rule against writes from other sites all run production code. Only Microsoft's endpoints are faked.
- **Plain-HTTP metadata is allowed with `ConfigureAll<OpenIdConnectOptions>`, not `PostConfigure`:** the handler's own post-configure step checks `RequireHttpsMetadata` and runs before a post-configure step a test adds, so that one comes too late (tried 2026-11-08 on .NET 11 RC3: "The MetadataAddress or Authority must use HTTPS"). Every configure step runs before every post-configure step.
- **The visitor's browser:** `SignInDriver` walks the real round trip with its own `HttpClient`: base address `https://localhost`, so `Secure` cookies flow (the test server takes the scheme from the address); no automatic redirects; cookies kept. It starts the sign-in, reads `state`, `nonce`, `redirect_uri` and `prompt` from the redirect, programs the token answer, and posts the return as Microsoft's page would, with cross-site fetch metadata.
- **Test users are data** (`Dsl/Visitor`): Lucie (allowed), Petr (allowed, since C8a, for the scenarios with two accounts), a stranger (signed in, not on the allowlist), and a work or school account (another issuer, with Lucie's allowed address, so only the issuer check can keep it out). An anonymous visitor needs no value: every test starts signed out. More kinds only when the specs need them. The addresses are made up; the real list never reaches tests, CI or GitHub ([ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)).
- **The allowlist is fixed when the app copy starts,** so the DSL's "is on the allowlist" and "is not on the allowlist" steps set nothing up. They check the app copy's configured list and throw when it differs from what the scenario states, so a scenario never rests on a list it only assumes ([lessons.md R-15](../software-factory/lessons.md): a DSL default differs from every value a scenario names).
- **A step that needs a signed-in user checks it:** the DSL signs in, then asks who is signed in, and throws unless the API names that user. A broken sign-in therefore can't make a scenario that expects "not signed in" pass.
- The plain-HTTP metadata and the ephemeral keys exist only in test code (§ Acceptance-test harness); the deployed app's authority is Microsoft's, in `appsettings.json`, and its handler requires HTTPS metadata.
- **Rejected:**
  - a fake sign-in scheme that lets everyone in: it skips the code under test;
  - real Microsoft test accounts: secrets, throttling, an outside dependency;
  - an extra trusted signing key in the app's configuration plus a session cookie made by the harness (the plan here before C6): it skips the code flow, the issuer check and the cookie's creation, which are the code under test in a backend that keeps the login.

  Microsoft's own pages are not under automated test: C6 checks them locally and after deployment, and the iPhone Home Screen app by hand ([tests/manual-scenarios.md](../../tests/manual-scenarios.md)).

## Fake servers listen on loopback only

Decided 2026-11-20, after the tests kept bringing up Windows Defender Firewall's prompt ([lessons.md R-80](../software-factory/lessons.md)).

- **Every WireMock.Net server a test starts listens on `127.0.0.1`, at a free port,** never on every network interface. Started without an address, WireMock.Net listens on all of them (Kestrel's `ListenAnyIP`; 2.21.0, its source read 2026-11-20). On Windows a program that does brings up Windows Defender Firewall's prompt, which needs an administrator, once for every path the test executables run from: the main checkout, every worktree and every throwaway copy. While the tests ran, the fakes could also be reached from the network.
- **One way to start one:** `LoopbackWireMock.Start(settings)`, in the acceptance project's `Drivers/` and compiled into the integration project as a link, as the stores' in-memory fakes are (§ Integration tests). The address is the helper's own; settings that name one are a bug. It has to be the IP address: WireMock.Net listens on every interface for `localhost` with port 0. A fake's address is therefore `http://127.0.0.1:<port>`.
- **The build enforces it:** `BannedSymbols.txt` bans WireMock.Net's own start methods, all seven overloads, so a new fake that skips the helper does not compile. The self-test `HarnessSelfTests/LoopbackWireMockSelfTests` reads the system's list of listening TCP sockets and checks that the helper's server is on the loopback address and nowhere else, so a WireMock.Net update that changes how it listens is caught, on Windows and on CI's Linux alike.
- **The other servers the tests start already listen on loopback:** `ConnectionBreakingServer` and the held port in `FailedPushTests`. The app copies run on the in-memory test server and open no port, and Azurite's port is opened by Docker, not by the test process. Checked 2026-11-20 by sampling the test processes' listening sockets through a whole `dotnet test`: `127.0.0.1` only.

## Time and the background job

- **The clock is `FakeTimeProvider`** (Microsoft.Extensions.TimeProvider.Testing, 10.11.0, 2026-10-14), swapped in by the harness, so a test can state "it is 2026-11-10 06:00". Since C6 every app copy runs on it (`FakeMicrosoft.Clock`), started at the real current time: Microsoft's ID token is checked against the real clock, so a test moves the clock only after signing in. The app takes the time only from `TimeProvider` ([README.md § C# style beyond tooling](README.md#c-style-beyond-tooling)).
- **Scenario dates are relative to the clock** (C7b, c010 design.md D12). The clock starts at the real time and only moves forward, so a scenario's "today is 2026-11-20" cannot be set on it. `Drivers/ScenarioCalendar` maps the scenario's dates onto the clock instead: the scenario names its today (the DSL's `TodayIs`), which becomes the clock's today (the UTC date of its time, as the app takes today), and every other date keeps its distance in days. The driver shifts the dates it writes (to the fake bank, the store and the API's query) and shifts back the dates it reads, so test cases keep the spec's dates. Moving the clock moves the scenario's today with it. This holds because the rules count days only; a rule that depends on the calendar itself (a weekday, the end of a month) needs another way.
- **A scenario on a weekday names its day and time** (c017, design.md D10): the koruna rate is asked for again from 08:00 UTC on the next weekday, so its scenarios say "today is Monday 2026-11-23 at 09:00 UTC". `ScenarioCalendar.TodayIsAt(day, utcTime)` moves the clock forward to the coming day with the same weekday as `day`, at `utcTime` UTC, and maps the scenario's dates onto it; their distances are then multiples of 7 days, so every date keeps its weekday. Like `DaysPass`, it runs only after signing in. The weekday rule itself is unit-tested as a plain function with any dates (`RateAsking`), so the acceptance tests only show it end to end. A rule that depends on the end of a month would still need another way.
- **Tests start the background check directly** ("run the check now") instead of waiting for a scheduler. So the check is ordinary app code, and whatever schedules it only calls it — an input to Q4 (job hosting, F0-2), recorded in [pm/progress.md](../../pm/progress.md#q4--job-hosting-registry-and-costs). Since C9a the check has no scheduler at all: the owner's iPhone triggers it ([ADR-0008](../adr/0008-phone-triggered-check.md)), so the tests call its endpoint, `POST /api/account/check`, as the phone does (`Drivers/AccountCheckDriver`, c014 design.md D16).
- **A burst of checks is lined up by holding the bank, never by waiting** (C9a, c014 design.md D16): the driver holds the first check's balance answer (§ Fake bank), sends the other calls, waits until the app copy's `AccountCheckQueue.CallersWaiting` counts them (read through its services; the queue raises no event, so the driver reads it every 10 ms, at most 10 s), then releases the answer. A caller that stops waiting cancels its call while the bank is held. Every wait on the real clock is bounded and ends on the event it waits for, never a fixed pause: the held request's arrival, the queue's count, and a push the app sends after its request has ended (`PushDsl.Eventually`, at most 10 s, waking on each push).

## Test framework and assertions

- **TUnit.**
- **Shouldly** for assertions (`balance.ShouldBe(120.50m)`), as in DoseUp: reads well, synchronous where the code is synchronous, not tied to the test framework. The stable 4.3.0 (2025-01-23), not the 5.0 preview (5.0.0-preview.2, 2026-07-18).
- **No snapshot testing** (tools like Verify that save the code's actual output as the expected result): the expected result could only exist after the code, which defeats test-first. Exact-shape tests compare against expected JSON written by hand.

## Defaults

- **Fake only what you don't own** (as DoseUp): the bank, the sign-in signature, the clock and, since C8a, the push services. Everything else is real, including the database in a test container.
- **Isolation by construction** (as DoseUp): one app copy per test and unique names from the DSL; no cleanup between tests.
- **Zero automatic re-runs** (as DoseUp): a flaky test is fixed or deleted.
- **Not adopted** ([software-factory/divergences.md R-14](../software-factory/divergences.md)): mutation testing (the close step runs Stryker.NET only if it is configured); architecture tests (ArchUnitNET), until a structural rule needs enforcing; browser end-to-end tests (Playwright). The cheapest later addition would be one Playwright smoke test against the deployed app.

## Decided later

- **Database tests:** decided in C7b and described in § Storage (Azurite in a test container, [ADR-0005-data-storage](../adr/0005-data-storage.md)).
- **Fake push-notification service:** decided in C8's explore ([#51](https://github.com/jakubbohm/RevolutReader/issues/51), S9), built in C8a and described in § Fake push service.
- **Test commands:** decided in C1 and listed in [`CLAUDE.md` § Commands](../../CLAUDE.md#commands) (one group's tests, one change's acceptance tests, the traceability check, the full suite).
