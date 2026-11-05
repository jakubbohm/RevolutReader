# Design: c001-add-backend-foundation

## TL;DR

- **Setup first, outside the TDD loop:** Claude updates the Aspire CLI and templates (13.6.4) and the TUnit templates (1.80.0), generates the projects from the templates, adapts them to the conventions, and commits a green build with no tests (`[setup]`). `/tdd-apply` starts from there (§ Bootstrap).
- **Pinned versions (verified 2026-11-05):** .NET SDK 11.0.100-rc.3, FastEndpoints 8.3.0, Aspire 13.6.4, TUnit 1.80.0, Mvc.Testing 11.0.0-rc.3 (D2).
- **Health check:** `GET /health` is a FastEndpoints endpoint, anonymous, with no dependencies and no handler. The template's health checks are removed (D3).
- **Errors:** `AddProblemDetails` + `UseStatusCodePages` turn every body-less error into a problem description. The case → status table starts with 404 (D4).
- **No default HTTP retries:** the template's resilience handler on every HttpClient is removed. **Hard to notice if reverted:** a retry on 429 would burn the bank's 4 unattended requests a day (D5).
- **Test setup:** one app copy per test (TUnit.AspNetCore), environment `Production`, nothing swapped yet (D6). The traceability check applies an active change's delta per requirement and ignores the archive (D7). The anonymous-endpoint check reads endpoint metadata (D8).
- **New public interfaces:** `GET /health`; `HealthEndpoint`; `[Scenario]` attribute; acceptance base `AcceptanceTest`; DSL `Health`, `Api`; drivers `HealthDriver`, `ApiDriver`.
- **Integration points:** none outside the process. No bank, storage, Entra, Bicep or API contract export yet.

## Context

- The repository has conventions, ADRs and empty `src/` and `tests/` folders, and no code. See proposal.md § Why.
- Installed on the owner's machine (checked 2026-11-05): SDKs 8.0.427, 10.0.403 and 11.0.100-rc.3.26522.148; Aspire CLI 13.4.6; templates Aspire.ProjectTemplates 13.4.6 and TUnit.Templates 1.44.39; Node 24.14.0. Docker is not running, and C1 does not need it.
- DoseUp (the owner's other project) runs the same stack on .NET 11 previews: FastEndpoints 8.2.0, a C# 15 `union` for its results (`ApiResult`), ServiceDefaults from the Aspire template, an AppHost on `net10.0`. Its acceptance tests start the real app through Aspire. RevolutReader runs the app inside the test process instead ([divergences.md R-12](../../../docs/software-factory/divergences.md)).

## Goals / Non-Goals

**Goals:**

- A solution that builds with the conventions enforced (formatting, analyzers, banned time APIs) and starts locally with `aspire start`.
- The acceptance-test setup, proven by the two scenarios going green end to end through FastEndpoints.
- The traceability check and the anonymous-endpoint check, both of which every later change relies on.
- Measured facts for testing.md: the cost of one app copy per test, and whether the implementer's hook fires.

**Non-Goals** (design level; the scope is in proposal.md § Non-goals):

- No route prefix for `/api` yet: the first `/api` endpoint (C5 or C6) sets FastEndpoints' `RoutePrefix`.
- No `UseExceptionHandler` and no FastEndpoints `Errors.UseProblemDetails()`. Each arrives with the first change whose scenario produces that error (500 in C5, validation errors in the first change with a validated request).
- No authentication or authorization services (C6).
- No clock, bank or sign-in swap in the test setup. Each is added by the change that first needs it.

## Bootstrap (done before `/tdd-apply`, not in tasks.md)

`/tdd-apply` needs a green build to start from, and the test-writer may add only method signatures to production code. So an empty repository cannot enter the loop. Claude does this once, directly, on the change branch, after the user approves the artifacts. None of it is behaviour.

1. **Tools.** `aspire update --self` (13.4.6 → 13.6.4). Install the templates `Aspire.ProjectTemplates::13.6.4` and `TUnit.Templates::1.80.0`. Refresh the repo's Aspire skills (`.claude/skills/aspire*`, which still describe 13.4) with the CLI's `aspire agent` command. Review its diff: keep the skill updates; nothing may change `CLAUDE.md` or add MCP configuration without the user's approval.
2. **Generate** from the CLI templates:
   - `RevolutReader.slnx`;
   - `src/RevolutReader.Api` (empty web app);
   - `src/RevolutReader.AppHost` and `src/RevolutReader.ServiceDefaults` (Aspire templates);
   - `tests/RevolutReader.AcceptanceTests`, `tests/RevolutReader.UnitTests`, `tests/RevolutReader.IntegrationTests` (TUnit template, sample tests deleted).
3. **Adapt to the conventions:**
   - `global.json`: SDK `11.0.100-rc.3.26522.148` with `rollForward: disable`, and `"test": { "runner": "Microsoft.Testing.Platform" }`.
   - `Directory.Build.props` as in docs/conventions/README.md § Static analysis.
   - `Directory.Packages.props`: every version from D2. Versions removed from the csproj files.
   - `BannedSymbols.txt`: `DateTime.Now`, `DateTime.UtcNow`, `DateTime.Today`, `DateTimeOffset.Now` and `DateTimeOffset.UtcNow`, each pointing to `TimeProvider`.
   - Target framework `net11.0` everywhere, except the AppHost if Aspire 13.6.4 needs `net10.0` there (as in DoseUp). Check this at generation.
   - ServiceDefaults reduced as D3 and D5 say: health checks and the resilience handler removed, each with a comment saying why.
   - The API's `Program.cs` holds only `AddServiceDefaults`, build and run. No FastEndpoints yet: it refuses to start with zero endpoints, so I wires it with the first endpoint (tasks 2.1).
   - The AppHost holds `AddProject<Projects.RevolutReader_Api>("api")`.
   - `dotnet format` run until the build passes under `.editorconfig`.
   - *Found during setup (2026-11-05):*
     - `nuget.config` with nuget.org only: the machine's global sources include a feed that answers 404, and central package management refuses several unmapped sources (NU1507). This is the same file as DoseUp's.
     - `.editorconfig` gets explicit severities for IDE0055 (layout), IDE0008 (no `var`) and IDE0161 (file-scoped namespaces). Without them these rules stayed silent in the build, so "the build is the format gate" (docs/conventions/README.md § Formatting) was not true. RCS1002 and the banned time APIs already fail the build: Roslynator 5.0.1 still has RCS1002. A probe file showed all five failing the build. IDE0055 does not flag LF line endings, so files the agents write do not fail on them.
     - ServiceDefaults lives in namespace `RevolutReader.ServiceDefaults` as `ServiceDefaultsExtensions`, as in DoseUp. The template's class name `Extensions` collides with a framework namespace (CA1724).
     - The OpenTelemetry packages are at 1.20.1, not the template's 1.17.0: TUnit.AspNetCore needs at least 1.20.1, and the tests and production should run the same version.
     - `aspire.config.json` sits at the repository root, pointing to the AppHost, so `aspire start` works from the root.
     - `Program` is visible to the test project without a `public partial class Program` declaration (compile probe).
4. **Check:** `dotnet build` passes. `dotnet test` reports that no tests ran (MTP exit code 8). This is the accepted baseline for C1's `/tdd-apply` step 0, once; from group 1 on, the suite has tests. Nothing ignores exit code 8 permanently: an empty run must stay visible.
5. **Commit** `build(c001): [setup] solution, projects and build rules` (the `[setup]` tag is added to docs/conventions/workflow.md § 3 in close).

**C1-only shape of group 1.** Besides one task per scenario, group 1 holds the test foundation the test-writer owns: the harness, the traceability check (with its own tests), `tests/manual-scenarios.md` and the anonymous-endpoint check. They are test code, so the implementer may not write them, and the orchestrator's first verification needs the traceability check to exist. **Expected state after group 1:** the foundation's own tests pass from the start (the traceability self-tests, the repository traceability check, "only allowlisted endpoints answer without sign-in"). Red until wiring are the two scenarios (driver stubs) and "every allowlisted endpoint exists". C1 has no component that carries rules, so it has no `[unit]` groups. With `review=all`, the human gate after group 1 is therefore the only planned review.

## Decisions

### D1 — Solution layout

```
RevolutReader.slnx · global.json · nuget.config · aspire.config.json
Directory.Build.props · Directory.Packages.props · BannedSymbols.txt
src/
  RevolutReader.Api/              Program.cs · Health/HealthEndpoint.cs · appsettings.json
  RevolutReader.ServiceDefaults/  ServiceDefaultsExtensions.cs (OpenTelemetry, service discovery)
  RevolutReader.AppHost/          AppHost.cs (local only)
tests/
  RevolutReader.AcceptanceTests/  Scenarios/ServiceHealth/ · Scenarios/ApiErrors/ · Dsl/ · Drivers/ · Traceability/ · Conventions/
  RevolutReader.UnitTests/        empty
  RevolutReader.IntegrationTests/ empty
  manual-scenarios.md             table header only
```

- The API is the one web host. It will also serve the built frontend (C3, ADR-0002-frontend-hosting), so it is named after its role in the solution, not "Web".
- Features live in folders named after the capability (`Health/`). Use-case folders arrive with the first handler.
- `Conventions/` is new in the acceptance project, for structural checks that need the running app (D8). testing.md § Where tests live gets the line.
- **Alternative rejected:** the Aspire starter template (`aspire-starter`) brings a Blazor or React frontend and a sample API that would all be deleted.

### D2 — Versions (verified on nuget.org, 2026-11-05)

| Package | Version | Note |
|---|---|---|
| .NET SDK | 11.0.100-rc.3.26522.148 | GA expected 2026-11-10 (.NET Conf); move in a follow-up PR |
| FastEndpoints | 8.3.0 (2026-08-20) | built for net10.0, runs on net11.0. 9.0.0-beta.7 (net11.0) rejected: a beta. Its 8.1 and 8.3 release notes warn of bugfix-only mode for lack of sponsors, irrelevant for ~2 months |
| Aspire.AppHost.Sdk and Aspire hosting | 13.6.4 (2026-10-24) | |
| Microsoft.Extensions.ServiceDiscovery | 10.11.0 | |
| OpenTelemetry packages | as the 13.6.4 template sets them, moved to central versions | |
| TUnit, TUnit.AspNetCore | 1.80.0 (2026-11-04) | built up to net10.0 |
| Microsoft.AspNetCore.Mvc.Testing | 11.0.0-rc.3.26522.148 | pinned directly: TUnit.AspNetCore would otherwise pull 10.0.14 |
| Shouldly | 4.3.0 | testing.md |
| Microsoft.CodeAnalysis.BannedApiAnalyzers | 5.6.0 | |
| Roslynator.Analyzers | 5.0.1 | if RCS1002 no longer exists in 5.x, stay on 4.16.1 |

Not added in C1: Microsoft.Extensions.TimeProvider.Testing, WireMock.Net, Testcontainers. The changes that first need them add them.

**C# union types** ship in C# 15, the default language version for `net11.0`, with no preview switch (Microsoft Learn, What's new in C# 15, updated 2026-10-23). This confirms the shape in docs/conventions/README.md § Backend code. One caveat for C5: a default (uninitialized) union is empty, and a `switch` over it throws `SwitchExpressionException`.

### D3 — The health check is a FastEndpoints endpoint at `/health`

- `HealthEndpoint` answers `GET /health` with 200 and `text/plain` `Healthy`. It is `AllowAnonymous()`, the first entry on the anonymous-endpoint allowlist.
- No handler: there is no use case to own, and the thin-endpoint rule is about use cases. It has no constructor dependencies, so it cannot reach the bank or storage. A scenario proving "no bank request during a health check" becomes possible once the fake bank exists (C5).
- The path stays outside `/api`. It is a probe, not part of the client API: C3 keeps it out of the OpenAPI document, and C3's page fallback cannot cover it because a matched endpoint always wins over the fallback.
- The template's `AddDefaultHealthChecks` / `MapDefaultEndpoints` are removed from ServiceDefaults. Kept, they would map the same `/health` route in Development, a second route for the same path, and would make the health scenario pass without FastEndpoints.
- The AppHost polls it: `.WithHttpHealthCheck("/health")`. C4 points the Container Apps probes at it.
- **Alternatives:**
  - The template's ASP.NET Core health checks, mapped in every environment. Standard, but then nothing in C1 proves FastEndpoints inside the TUnit host, which is a roadmap check, and FastEndpoints cannot be wired without an endpoint.
  - `/api/health`. It would mix the probe into the client API and its OpenAPI document.

### D4 — Problem descriptions for every body-less error

- `builder.Services.AddProblemDetails()` + `app.UseStatusCodePages()`: any 400–599 response leaving the pipeline without a body gets an RFC 9457 body (`type`, `title`, `status`, `traceId`). An address with no endpoint produces 404 → `{ "title": "Not Found", "status": 404, … }`.
- The case → status table in docs/conventions/README.md § Backend code starts with one row: *the API does not serve the address → 404 Not Found* (scenario: api-errors / Unknown API address answers with a problem description). Each later case adds its row in the change whose scenario produces it: 500 unhandled error (C5), 401/403 (C6), bank cases (C5).
- **Interaction for C6:** with an authorization fallback policy, an anonymous request to an unknown `/api` address may get 401 before routing decides 404. C6 decides which answer is right and, if it changes this scenario, modifies the requirement.

### D5 — No default retries on outgoing HTTP calls

- The template's `ConfigureHttpClientDefaults(http => http.AddStandardResilienceHandler())` is removed from ServiceDefaults. The standard handler retries 408, 429 and 5xx. On Enable Banking, a retried 429 burns the 4 requests a day allowed without the account holder (ADR-0001-bank-data-access § Decision), and it would do so silently, from code nobody reads.
- Service discovery for HttpClients stays (harmless, used by Aspire references).
- Rule recorded in docs/conventions/README.md § Backend code: *an outgoing HTTP client gets no retries unless its own change decides a policy; the bank client never retries.*
- **Alternative rejected:** keep the default and opt the bank client out. A forgotten opt-out is invisible, and every future client inherits retries without anyone deciding.
- Software factory: a lesson (divergence from DoseUp, which keeps the template default).

### D6 — Acceptance-test harness

- `ApiFactory : TestWebApplicationFactory<Program>` is the session-wide factory. `AcceptanceTest : WebApplicationTest<ApiFactory, Program>` is the base of every scenario class: TUnit.AspNetCore gives each test its own isolated app copy (`WithWebHostBuilder` per test), which is the one-copy-per-test rule from testing.md.
- **Environment `Production`**, set in `ConfigureWebHostBuilder`. Tests then run on the base `appsettings.json` (production truth), and Development-only behaviour such as the developer exception page stays out of them. Later changes supply test values for `"<secret>"` settings in `ConfigureTestConfiguration`. Alternative rejected: the default `Development`, because it would test a configuration that never deploys.
- **Nothing is swapped in C1:** no bank, no sign-in key, no clock. The extension points are TUnit.AspNetCore's `ConfigureTestServices` / `ConfigureTestConfiguration` overrides.
- `Program` must be visible to the test project. ASP.NET Core generates it public for top-level statements (analyzer ASP0027 calls an explicit declaration unnecessary). If the build says otherwise, add `public partial class Program;`.
- Drivers get their `HttpClient` from `Factory.CreateClient()` of the test's own app copy.
- **Fallback if TUnit.AspNetCore fails on .NET 11:** drop it and derive from Mvc.Testing's `WebApplicationFactory<Program>`, one per test, created and disposed in the base class. Same layers, same tests.
- **Measurement (close):** time per acceptance test, mostly app start, recorded in testing.md § Acceptance-test harness. If it is too slow, testing.md already names the fallback: one copy per test class, with that class's tests run one after another.

### D7 — Traceability check

- **Scenarios required:**
  1. Read `openspec/specs/<capability>/spec.md` into requirements, each with its `#### Scenario:` names.
  2. Apply each active change in `openspec/changes/<change>/specs/<capability>/spec.md` (never `openspec/changes/archive/`), in change-id order. ADDED adds the requirement; MODIFIED replaces that requirement's scenarios; REMOVED drops them; RENAMED renames the requirement and keeps its scenarios.
  3. The result is the set of (capability, scenario name) pairs.

  testing.md's literal reading (every scenario heading of the specs and the active deltas) would see a MODIFIED requirement's scenarios twice and report a duplicate name. It would also keep demanding a test for a scenario the change deleted.
- **Claims:**
  - `[Scenario("<capability>", "<exact name>")]` on test methods of the acceptance assembly (reflection);
  - rows of the table in `tests/manual-scenarios.md` (columns: capability, scenario, why manual, handover step, date last checked);
  - from C3, `scenario("…", "…", …)` literals in the frontend tests.
- **Fails, listing every problem at once:** a scenario with no claim; a scenario claimed more than once (across all levels); a claim naming no existing scenario; two scenarios with the same name in one capability.
- **Shape:** a pure function from (spec texts, claims) to a list of problems, plus one `[Test]` that reads the repository and asserts the list is empty. The repository root is found by walking up from the test assembly's folder to the folder containing `openspec/`.
- **Self-tests** (the test-writer's, in `Traceability/`) feed the pure function in-memory spec text:
  - an unclaimed scenario is reported;
  - a scenario claimed twice is reported;
  - a claim naming an unknown scenario is reported;
  - duplicate names in one capability are reported;
  - a modified requirement replaces the main spec's scenarios;
  - a removed requirement's scenarios are no longer required;
  - a manual row counts as a claim.

  Discovery ignoring `archive/` is checked once against a temporary folder. Without these, a check that always passes would look the same as a working one.

### D8 — Anonymous-endpoint check

- In `Conventions/`, a test starts the app and reads its `EndpointDataSource`. An endpoint counts as open without sign-in when it carries `IAllowAnonymous` metadata, or no authorization metadata at all.
- Two assertions: every open endpoint is on the allowlist; every allowlist entry exists, so the list cannot rot. Entries are written as `"<METHOD> <route>"`. C1's list is `GET /health`. The second assertion keeps the test red until task 2.1 adds the endpoint.
- The allowlist lives in the test project, so an anonymous endpoint shows up in the test diff and the implementer cannot add one unnoticed.
- **For C6:** once a fallback policy exists, endpoints without metadata are protected by it. C6 updates the rule (an endpoint is open only with `IAllowAnonymous`).

### D9 — The Result type: shape fixed now, type built in C5

Decided with the user (2026-11-05; roadmap change log). Shape, recorded in docs/conventions/README.md § Backend code: a C# 15 `union` whose case types are records nested in it (as DoseUp's `ApiResult`), returned by handlers; endpoints map each case to the HTTP result through the case → status table. Nothing in C1 returns an expected failure, so a test-first run has nothing to build the type from.

### D10 — Test commands (for CLAUDE.md § Commands; each run once as written during close)

| Purpose | Command |
|---|---|
| Build | `dotnet build` |
| Full suite (includes the traceability check) | `dotnet test` |
| One test layer | `dotnet test --project tests/RevolutReader.<Layer>Tests` |
| One group's tests (by class) | `dotnet test --project <project> --treenode-filter "/*/*/<Class>/*"` |
| One change's acceptance tests | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/<Class>/(<Test1>)\|(<Test2>)"`, test names from `.tdd-state.md`; a whole capability: `"/*/*/<Capability>Scenarios/*"` |
| Traceability check alone | `dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/TraceabilityTests/*"` |
| Run the app | `aspire start` / `aspire stop` |
| Fix formatting | `dotnet format whitespace RevolutReader.slnx` |

- Scenario classes are named `<Capability>Scenarios`, one per capability (testing.md: one file per capability).
- Tags on tests are not used for selection (testing.md § Where tests live).
- `dotnet test --filter` is not supported by TUnit (it reports zero tests). If the SDK rejects the flags without it, put `--` before `--treenode-filter`. Close records the exact form that worked.

## Public API sketch

Production (`src/RevolutReader.Api`):

```csharp
// Program.cs (top-level statements), after wiring
WebApplicationBuilder builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddFastEndpoints();
WebApplication app = builder.Build();
app.UseStatusCodePages();
app.UseFastEndpoints();
app.Run();

// Health/HealthEndpoint.cs
public sealed class HealthEndpoint : EndpointWithoutRequest {
  public override void Configure();                              // Get("/health"); AllowAnonymous();
  public override Task HandleAsync(CancellationToken ct);       // 200 text/plain "Healthy"
}
```

AppHost: `builder.AddProject<Projects.RevolutReader_Api>("api").WithHttpHealthCheck("/health");`

Acceptance tests (`tests/RevolutReader.AcceptanceTests`):

```csharp
// Traceability/ScenarioAttribute.cs
[AttributeUsage(AttributeTargets.Method)]
public sealed class ScenarioAttribute(string capability, string name) : Attribute {
  public string Capability { get; } = capability;
  public string Name { get; } = name;
}

// Drivers/ApiFactory.cs, Drivers/AcceptanceTest.cs
public sealed class ApiFactory : TestWebApplicationFactory<Program>;
public abstract class AcceptanceTest : WebApplicationTest<ApiFactory, Program> {
  protected HealthDsl Health { get; }                            // built on the test's own app copy
  protected ApiDsl Api { get; }
}

// Dsl/
public enum HealthAnswer { Healthy, NotHealthy }
public sealed class HealthDsl { public Task<HealthAnswer> Check(); }
public sealed record ProblemDescription(string Title) {
  public static ProblemDescription NotFound { get; }             // title "Not Found", status 404
}
public sealed class ApiDsl {
  public Task<ProblemDescription?> AskForAnAddressThatDoesNotExist();   // null when the answer is not a problem description
}

// Drivers/ (stubs throw NotImplementedException until wiring)
public sealed class HealthDriver(HttpClient http) { public Task<HealthAnswer> GetHealth(); }
public sealed class ApiDriver(HttpClient http)    { public Task<ProblemDescription?> GetProblem(string path); }

// Scenarios/ServiceHealth/ServiceHealthScenarios.cs, Scenarios/ApiErrors/ApiErrorsScenarios.cs
[Test, Scenario("service-health", "Health check answers while the app runs")]
public async Task Health_check_answers_while_the_app_runs();     // (await Health.Check()).ShouldBe(HealthAnswer.Healthy)
[Test, Scenario("api-errors", "Unknown API address answers with a problem description")]
public async Task Unknown_API_address_answers_with_a_problem_description();

// Traceability/
public sealed record SpecScenario(string Capability, string Name);
public sealed record ScenarioClaim(string Capability, string Name, string Source);
public static class TraceabilityCheck {                           // not `Traceability`: the namespace has that name (CA1724)
  public static IReadOnlyList<SpecScenario> RequiredScenarios(IReadOnlyList<SpecFile> mainSpecs, IReadOnlyList<SpecFile> activeDeltas);
  public static IReadOnlyList<string> Problems(IReadOnlyList<SpecScenario> required, IReadOnlyList<ScenarioClaim> claims);
}
public sealed record SpecFile(string Capability, string ChangeId, string Markdown);   // ChangeId empty for main specs
public sealed class TraceabilityTests { [Test] public void Every_scenario_is_claimed_exactly_once(); /* + self-tests, D7 */ }

// Conventions/AnonymousEndpointsTests.cs
public sealed class AnonymousEndpointsTests : AcceptanceTest {
  [Test] public Task Only_allowlisted_endpoints_answer_without_sign_in();
  [Test] public Task Every_allowlisted_endpoint_exists();
}
```

The driver owns HTTP: it checks the status, the content type `application/problem+json` and that the body's `status` matches. The test case sees only `ProblemDescription.NotFound`.

## Rule ownership

| Rule (spec or convention) | Enforced by |
|---|---|
| `GET /health` answers 200 `Healthy` to anyone | `HealthEndpoint` (`AllowAnonymous`) |
| The health check calls neither the bank nor storage | `HealthEndpoint` has no dependencies (by construction); scenario from C5 |
| Every body-less error response is a problem description | `AddProblemDetails` + `UseStatusCodePages` in `Program.cs` |
| An unknown address answers 404 | ASP.NET Core routing (no endpoint matched) |
| Only allowlisted endpoints work without sign-in | FastEndpoints' default (sign-in required unless `AllowAnonymous`); `AnonymousEndpointsTests` |
| Every scenario is claimed exactly once | `TraceabilityTests` |
| No default retries on outgoing HTTP | ServiceDefaults (resilience handler removed) |
| Time comes only from `TimeProvider` | `BannedSymbols.txt` + BannedApiAnalyzers (build error) |
| Formatting and style | `.editorconfig` + `EnforceCodeStyleInBuild` + `TreatWarningsAsErrors` |

## Error model

- `GET /health` has no expected failure. If the app cannot answer, the caller gets no answer or a platform error, which is what a probe needs to see.
- An unknown address is not an operation of ours: routing finds no endpoint and the status-code-pages middleware writes the problem description.
- No Result values in C1 (D9). Exceptions stay for bugs and infrastructure failures, as in docs/conventions/README.md.

## Ports and contracts

None. C1 adds no repository, external client or push sender, so it has no `[integration]` group.

## How each scenario is verified

Both scenarios are API acceptance tests (the default level). Nothing in C1 is verified only in the browser or by hand; `tests/manual-scenarios.md` starts with its header and no rows.

## Cross-cutting effects

- **API contract / TS client:** none. There is no OpenAPI export until C3; `/health` stays out of the contract then.
- **Bicep:** none. No `infra/` until C4, which creates the Container Apps probe on `/health`.
- **Settings:** none added. `appsettings.json` keeps the template's `Logging` and `AllowedHosts` entries.
- **Bank calls:** none (ADR-0001-bank-data-access is applied only through D5).
- **ADRs:** none. D5 is a convention (README.md); D9 refines an existing convention.
- **Software factory:**
  - lesson R-28 *(New)*: how the first test-first change starts on an empty repository (bootstrap commit, the accepted zero-test baseline, the test foundation in the acceptance group, self-tests for the traceability check);
  - lesson R-29 *(Divergence from DoseUp)*: no default HTTP retries when an outside API counts requests;
  - lesson R-30 *(New)*: an IDE style rule gates the build only with an explicit severity in `.editorconfig`, even under `AnalysisLevel latest-all`. Prove the gate with a probe file instead of trusting the convention text. DoseUp's `.editorconfig` has the same missing severities (not verified there);
  - inventory lines for the traceability check, the anonymous-endpoint check, the acceptance harness base and the build-rule files.

## Risks / Trade-offs

- [TUnit.AspNetCore is built for .NET 10 and pulls Mvc.Testing 10] → Mvc.Testing pinned to 11.0.0-rc.3; fallback to Mvc.Testing directly (D6).
- [Release candidate, not GA] → go-live licence since RC1; exact pin; the move to GA is a small follow-up PR.
- [Packages built for net10.0 on net11.0 (FastEndpoints, Aspire, TUnit)] → DoseUp runs FastEndpoints 8.2.0 this way; the scenarios going green prove it here.
- [The Aspire 13.6 CLI is machine-wide; DoseUp pins its packages at 13.4.6] → not verified that the new CLI still runs DoseUp's AppHost; check before working on DoseUp again.
- [`aspire agent` may want to edit `CLAUDE.md` or add MCP configuration] → review its diff; keep only the skill updates without the user's approval.
- [Roslynator 5.x may have dropped or renamed RCS1002] → stay on 4.16.1 if so.
- [For C5: OpenTelemetry's HttpClient instrumentation records the full request URL, and Enable Banking paths carry the account id] → C5 must redact or drop it, per "never log bank data". It does not apply in C1, which has no bank calls.
- [For C6: a fallback policy may turn the unknown-address 404 into 401 for anonymous callers] → C6 decides (D4).
- [The empty `UnitTests` and `IntegrationTests` projects] → since the .NET 11 SDK, one empty test module does not fail a run that has tests in other modules (Microsoft Learn, MTP troubleshooting, 2026-09-21). They stay empty until C5.

## Migration Plan

Greenfield: nothing to migrate. Rollback is reverting the squash-merged PR.

## Open Questions

None. The AppHost's target framework was settled at setup: `net11.0`, which the Aspire 13.6.4 template offers. `aspire start` runs it and the `api` resource reaches Healthy.
