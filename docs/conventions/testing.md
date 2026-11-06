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

- **A port's capability is driven through the port itself** (c004 design.md D1): when a port that later changes build on has its own spec (the bank adapter, `bank-reads`), its driver takes the port from the test's own app copy (`Services`, so with the production wiring: settings, `HttpClient`, no retries) instead of calling an endpoint. The other three layers are unchanged; the observable outcomes are the results the port returns and the requests the fake bank received.
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
5. `## N. [close] Acceptance green`: all acceptance tests of the change pass; then the close-out tasks (`pm/progress.md`, `CLAUDE.md`).

- **Never a "write tests" task:** a test is part of every behaviour task.
- **One group per round trip** between the agents: one component, not one checkbox and not the whole change.
- **More than 3 scenarios: slice per scenario.** All acceptance tests are still written and reviewed first; then each scenario gets its own unit, integration and wiring groups and a `[close]` group that turns its acceptance test green, before the next scenario starts. The final `[close]` runs them all.

## Test-first workflow

A change is implemented with **`/tdd-apply <change> [review=acceptance|all|none]`** instead of `/opsx:apply` ([`.claude/skills/tdd-apply/`](../../.claude/skills/tdd-apply/SKILL.md), agents in [`.claude/agents/`](../../.claude/agents/)). The exception is a tooling-only change (`skip_specs: true`, e.g. CI): it has no scenario and nothing to test first, so it is applied directly with `/opsx:apply` and its task groups are named after its work ([workflow.md § 6](workflow.md#6-openspec)).

- **Three roles, three contexts.** The **orchestrator** (the session running the skill) plans, delegates, verifies and judges; it edits only `tasks.md` checkboxes, `.tdd-state.md` and the close-out docs. The **test-writer** subagent writes failing tests and compile-only stubs. The **implementer** subagent makes them pass. Separate contexts are what stop tests from mirroring an implementation the same agent already has in mind.
- **Persistent subagents:** each is spawned once per change and resumed with SendMessage; their IDs, the current group, the review mode and open disputes live in `openspec/changes/<change>/.tdd-state.md`. The artifacts and tests stay the source of truth: an agent that cannot be resumed is replaced by a fresh one with a summary. One shared working tree, no worktree isolation.
- **No read bans.** The implementer reads the tests (they are its specification); the test-writer reads production code (real types). In a dispute the test-writer decides against the spec and design without reading the disputed implementation.
- **The implementer rule:**
  - *How:* production quality — the real implementation per `design.md` and the conventions; no hardcoded results, no shortcuts; refactor while green.
  - *What:* only the behaviour the failing tests ask for. If more seems needed, don't code it and don't drop it: report it as a missing test.
  - Bug guards (`ArgumentNullException.ThrowIfNull`) are quality. Expected states (a Result value such as "the bank is busy") are behaviour and need a test.
  - Why it matters here: a retry on Enable Banking's 429 would burn the 4 unattended requests a day; returning more transaction fields than the UI shows breaks the exact-shape rule and exposes bank data.
- **The orchestrator verifies, never trusts a report.**
  - After red: the build passes; every new test fails at runtime (a `NotImplementedException` stub or an assertion), never at compile time; every previously green test is still green.
  - After green: all tests pass except this change's acceptance tests still waiting for their wiring; the green step's diff touches no test file outside the implementer's folders (`Drivers/` in wiring and close, `IntegrationTests/Wiring/` in wiring). A violation is reverted and the implementer resumed.
  - A hook blocks the implementer's test edits as a second layer; the diff check is the one to rely on. The hook ([`.claude/hooks/deny-test-edits.mjs`](../../.claude/hooks/deny-test-edits.mjs)) is registered in `.claude/settings.json`, so it runs for every session and subagent, and it blocks only the subagent whose `agent_type` is `implementer`. **C1's check (2026-11-05, Claude Code 2.1.318, VS Code extension):** declared in the implementer's frontmatter, the hook never ran, even with an absolute path and `onFailure: "block"` (a temporary log in the script stayed empty). Registered in the project settings, it ran and blocked the implementer's probe write to `Scenarios/`, let its write to `Drivers/` through, and let the main session's writes through. The implementer changed no disallowed file in C1, so the diff check had nothing to restore.
- **Human gates.** Your reading routine after propose (below). The acceptance tests, always: there you review how the spec was translated. With `review=all`, also each group's unit tests. **Default `acceptance`; `all` for C1 and C5,** the first two changes using the workflow. Unresolved or repeated disputes always reach you.
- **Disputes:** behaviour is decided by the delta spec, API shape by `design.md`, test quality by the test-writer. The orchestrator forwards only the claim, the failing test and the spec or design excerpt, never the implementation. A silent or ambiguous spec, or the same dispute a second time, goes to the user; the resolution lands in the spec or the design, not only in code.
- **Commits at every handoff,** on the change branch, tagged by step ([workflow.md § 3](workflow.md#3-git)). Committing the test-writer's red tests before the implementer starts is what makes the diff check reliable.
- **Close:** a failing acceptance test caused by missing behaviour goes to the test-writer as a new unit test, then to the implementer; a glue bug (route, DI registration, serialization) goes straight to the implementer. Then the full suite and the traceability check.

### Your reading routine (about 5 minutes per change, after propose, before apply)

1. Proposal TL;DR: is this the right thing, with the right scope?
2. The list of scenario names: is anything missing, or there that shouldn't be? Missing scenarios are the most common and the most expensive problem.
3. Read in full only the scenarios that are risky or surprising.
4. Design TL;DR: do you agree with the decisions and the integration points?

The acceptance-test gate is then the second check, not the first. If a TL;DR does not match its artifact, read the whole artifact: the tests follow the body, not the TL;DR. Specs get no TL;DR (it would interfere with merging delta specs on archive); their scenario names must work as a checklist on their own.

## Integration tests

Broad integration (everything wired together) is what the acceptance tests do. Integration tests here are narrow: one adapter at a time.

| What | When | Who |
|---|---|---|
| Port contract: the behaviours `design.md` states for a port (concurrency, idempotency, failure modes), run against both the in-memory fake the unit tests use and the real adapter, so the fake stays honest | before the implementation, in an `[integration]` group | test-writer |
| Happy-path persistence and glue | — (the acceptance tests cover it) | — |
| Adapter edge cases the acceptance tests cannot reach cheaply: a migration on existing data, a tricky query, serialization quirks, the Enable Banking client's handling of each error response | after the implementation, in a `[wiring]` group, in `IntegrationTests/Wiring/` | implementer |

- Contract tests exist only for ports with an in-memory fake, so most changes have no `[integration]` group. The Enable Banking client has no fake unless a unit test genuinely needs one (§ Fake bank).
- Tests needing Docker (Testcontainers) stop with a message when Docker is not running; they are never skipped silently.

## Where tests live

```
tests/
├─ RevolutReader.AcceptanceTests/     one test per OpenSpec scenario, app inside the test process
│  ├─ Scenarios/<capability>/         the test cases: domain language only, they are the spec
│  ├─ Dsl/                            domain-language helpers: defaults, unique names per test
│  ├─ Drivers/                        the only layer that knows HTTP: API calls, fake bank, sign-in tokens, clock
│  ├─ Traceability/                   the check that every scenario has exactly one test
│  └─ Conventions/                    structural checks that need the running app: the anonymous-endpoint
│                                     allowlist, the harness's environment
├─ RevolutReader.UnitTests/           domain rules, no I/O; paths mirror src/
├─ RevolutReader.IntegrationTests/    our adapters against their fakes: the Enable Banking client against the
│                                     fake bank server; later the database (Testcontainers)
└─ manual-scenarios.md                scenarios checked by hand at handover

src/RevolutReader.Web/src/            the frontend's tests sit next to its code (below)
```

- **One project per test layer, named after the layer** (as DoseUp). `dotnet test` runs everything; CI selects a layer by project, never by tags on tests.
- **Mirroring is mechanical** (as DoseUp): a test file sits at its target's path with the project swapped (`src/.../Balance.cs` ↔ `tests/RevolutReader.UnitTests/.../BalanceTests.cs`). Acceptance tests mirror the specs instead: one file per capability, one test per scenario. Unit tests are named after their behaviour task.
- **Who may edit what** (the orchestrator's diff check enforces it; a hook that blocks the implementer is the second layer, § Test-first workflow): the test-writer owns `tests/`; the implementer may edit only `RevolutReader.AcceptanceTests/Drivers/` in the wiring and close steps, and `RevolutReader.IntegrationTests/Wiring/`, where it writes adapter edge-case tests after the implementation.
- **Shared fakes only when two test projects need the same one;** no `tests/Fakes/` project up front.
- **Frontend tests live next to the frontend code** (Vitest with Testing Library and jsdom; decided in C3, c003 design.md D1):
  - a unit test sits next to its target as `<file>.test.ts(x)`, e.g. `src/app/device.ts` ↔ `src/app/device.test.ts`;
  - scenario tests go one file per capability, `src/scenarios/<capability>.test.tsx`, each test a `scenario("<capability>", "<exact scenario name>", …)`;
  - the helpers live in `src/test/`: `setup.ts`, `scenario.ts`, `renderApp.tsx`.

  The implementer may not edit `*.test.ts(x)`, as with every test file; `src/test/` belongs to the test-writer.

## Every scenario has exactly one test: the traceability check

- **One automated test** in `RevolutReader.AcceptanceTests/Traceability/` compares the scenarios in the specs with the tests that claim them. It runs with every `dotnet test`, so a missing test fails the build; the orchestrator runs the same test.
- **Scenarios** are the `#### Scenario: <name>` headings of the main specs (`openspec/specs/`) with each active change's delta applied **per requirement**, in change-id order: ADDED adds the requirement, MODIFIED replaces its scenarios, REMOVED drops them, RENAMED renames it and keeps them. `openspec/changes/archive/` is ignored. Reading every heading literally would count a modified requirement's scenarios twice and keep demanding a test for a removed one (C1, design.md D7).
- **Each scenario is verified at exactly one level and claimed exactly once:**

  | Level | Claimed by | Example |
  |---|---|---|
  | API acceptance test (the default) | an attribute on the TUnit test | `[Scenario("account-detail", "Balance shown in CZK")]` |
  | Frontend test (rules only the browser can show) | a `scenario(...)` helper in Vitest, with string literals so the check can read them | `scenario("account-detail", "Amounts formatted in Czech", () => …)` |
  | Manual at handover (device-only behaviour, e.g. how a push notification appears on iOS) | a row in `tests/manual-scenarios.md`: capability, scenario, why manual, the handover step that checks it (M5, M7), date last checked | the file doubles as the handover checklist |

- **The check fails when:** a scenario has no claim; a scenario is claimed twice; a claim names a scenario that does not exist (renamed or removed); two scenarios in one capability share a name.
- **It checks existence, not results.** While a change is being implemented, its new acceptance tests exist and fail ([workflow.md § 6](workflow.md#6-openspec)).
- **Frontend claims** (c003 design.md D7): the check reads every `scenario(` call in `src/RevolutReader.Web/src/**/*.test.ts` and `*.test.tsx`.
  - A call whose capability and name are string literals (single or double quotes; line breaks allowed between the arguments) is a claim.
  - Any other `scenario(` call is reported as unreadable, with its file and line, so a claim can never vanish silently: a template literal, a variable, a missing name, even a call in a comment.
  - Name frontend test files `*.test.ts(x)`: Vitest also runs `*.spec.*` files, but the check doesn't read them.
  - The helper itself sits in `src/test/scenario.ts`, which is not a test file, and names the test `<capability> / <name>`.
- **When it arrived:** C1 built the check with the .NET attribute and the manual list; C3 added the frontend claims.
- No browser end-to-end tests: frontend rules are tested on components, device rules by hand (trade-off: [software-factory/divergences.md R-19](../software-factory/divergences.md); full version: [lessons.md R-19](../software-factory/lessons.md)).

## Acceptance-test harness: the app runs inside the test process

- Each acceptance test starts its own copy of the API inside the test process (TUnit.AspNetCore, TUnit's version of the ASP.NET Core test host), **in environment `Production`**, so it runs on the base `appsettings.json` (production truth) without Development-only behaviour; a test in `Conventions/` guards it. Before it starts, the test replaces only what it must control: the Enable Banking settings, the sign-in signing key, the clock and the web root (so far the web root, since C3, and the Enable Banking settings, since C5). Everything else is production code.
- **Every app copy gets the fake bank's settings** (c004 design.md D6), because the app refuses to start without them: `Drivers/FakeBank` starts a WireMock.Net server per test before the app copy and writes its address, made-up application, session and account ids, an RSA key generated once per test run and a 1 s request timeout into the app copy's `EnableBanking` section. Tests that never read the bank get them too. FastEndpoints runs inside this host (proven in C1).
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

- **Automated tests** (every run, CI) point our real Enable Banking client at **WireMock.Net**, a fake HTTP server running inside the test (2.21.0, 2026-10-28, Apache-2.0). Each test sets up its own responses and checks the requests the app sent: the user's PSU headers on reads the user triggers, no PSU headers and at most 4 calls a day on background reads ([ADR-0001-bank-data-access § Decision](../adr/0001-bank-data-access.md#decision)).
- **The fake responses are copied from real responses of Enable Banking's Mock ASPSP** (made-up data): the spike's `evidence/`, plus new captures when a change needs more (e.g. paging past 10 transactions). What the mock cannot produce (429 `ASPSP_RATE_LIMIT_EXCEEDED`, expired or revoked sessions, Revolut-specific fields) is written from the API reference and the M1 findings, with a comment saying so.
- **Never from the real account:** no recording against the real API (WireMock's record-and-playback is not used), and no real account data in test data or in the Mock ASPSP.
- **Enable Banking's Mock ASPSP** (sandbox application, test data entered in the Control Panel) is used for:
  - capturing realistic responses;
  - checking our real client against the real API on demand (C5), before the one final check against Revolut;
  - local development: the app on the owner's machine reads the mock, never the real account. A session needs the owner's approval with the Control Panel login, once per up to 180 days.
- **No CI job against the mock:** it would need the sandbox key and session as CI secrets and a human approval to start, and every test would share one data set.
- **No in-memory fake of the bank client** unless a unit test genuinely needs one.
- How this relates to the software factory: [software-factory/lessons.md R-13](../software-factory/lessons.md); what the project gives up: [divergences.md R-13](../software-factory/divergences.md).

## Test sign-in: fake the signature, never the security code

Same as DoseUp (its software-factory entry F-68), so no software-factory entry here.

- Tests sign their own tokens with a throwaway key generated at runtime, and the harness adds that key as a second trusted signer to the API's sign-in configuration. Checking the token, reading the user from it, the allowlist check (Q1) and the 401/403 responses all run production code.
- **Test users are data:** an allowed user, a signed-in stranger (valid token, not on the allowlist), an anonymous visitor (no token). More kinds only when the specs need them. The harness sets the allowlist to made-up addresses. The real list never reaches tests, CI or GitHub ([ADR-0004-account-allowlist](../adr/0004-account-allowlist.md)).
- The extra trusted key exists only inside the test process (§ Acceptance-test harness); the deployed app has no setting that could switch it on.
- **Rejected:** a fake sign-in scheme that lets everyone in (it skips the code under test); real Microsoft test accounts (secrets, throttling, an outside dependency). Microsoft's own sign-in is not under automated test; C6 checks it locally and after deployment.
- **The backend keeps a login cookie** ([ADR-0003-sign-in](../adr/0003-sign-in.md), Q2). So the harness creates the session cookie from a self-signed token and skips only the Microsoft sign-in redirect. C6 settles the mechanics.

## Time and the background job

- **The clock is `FakeTimeProvider`** (Microsoft.Extensions.TimeProvider.Testing, 10.11.0, 2026-10-14), swapped in by the harness, so a test can state "it is 2026-11-10 06:00". The app takes the time only from `TimeProvider` ([README.md § C# style beyond tooling](README.md#c-style-beyond-tooling)).
- **Tests start the background check directly** ("run the check now") instead of waiting for a scheduler. So the check is ordinary app code, and whatever schedules it only calls it — an input to Q4 (job hosting, F0-2), recorded in [pm/progress.md](../../pm/progress.md#q4--job-hosting-registry-and-costs).

## Test framework and assertions

- **TUnit.**
- **Shouldly** for assertions (`balance.ShouldBe(120.50m)`), as in DoseUp: reads well, synchronous where the code is synchronous, not tied to the test framework. The stable 4.3.0 (2025-01-23), not the 5.0 preview (5.0.0-preview.2, 2026-07-18).
- **No snapshot testing** (tools like Verify that save the code's actual output as the expected result): the expected result could only exist after the code, which defeats test-first. Exact-shape tests compare against expected JSON written by hand.

## Defaults

- **Fake only what you don't own** (as DoseUp): the bank, the sign-in signature and the clock. Everything else is real, including the database in a test container.
- **Isolation by construction** (as DoseUp): one app copy per test and unique names from the DSL; no cleanup between tests.
- **Zero automatic re-runs** (as DoseUp): a flaky test is fixed or deleted.
- **Not adopted** ([software-factory/divergences.md R-14](../software-factory/divergences.md)): mutation testing (the close step runs Stryker.NET only if it is configured); architecture tests (ArchUnitNET), until a structural rule needs enforcing; browser end-to-end tests (Playwright). The cheapest later addition would be one Playwright smoke test against the deployed app.

## Decided later

- **Database tests:** F0-2 chose Azure Table Storage ([ADR-0005-data-storage](../adr/0005-data-storage.md)). Database tests run against Azurite in a test container (`Testcontainers.Azurite`, with the image pinned explicitly). The change that first stores data (C7 or its first slice) sets them up.
- **Fake push-notification service:** C8.
- **Test commands:** decided in C1 and listed in [`CLAUDE.md` § Commands](../../CLAUDE.md#commands) (one group's tests, one change's acceptance tests, the traceability check, the full suite).
