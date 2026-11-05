# Tasks: c001-add-backend-foundation

Before this list: the setup commit from design.md § Bootstrap (tools, generated projects, build rules; green build, zero tests). Run with `/tdd-apply c001-add-backend-foundation review=all`. Group 1 also holds the C1-only test foundation (design.md § Bootstrap); C1 has no `[unit]` or `[integration]` groups (no component carries rules, no port).

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation: acceptance harness. `ApiFactory`, `AcceptanceTest` with one app copy per test in environment `Production`, HTTP drivers created from the test's own copy (design.md D6). Verify: the solution builds and the scenario tests below run against it, failing in their driver stubs
- [x] 1.2 Foundation: traceability check. `[Scenario]` attribute; required scenarios from the main specs plus active deltas applied per requirement, archive ignored; claims from attributes and `tests/manual-scenarios.md`; every problem listed at once (design.md D7). Verify: its self-tests from D7 pass, and the repository check passes with both scenarios below claimed
- [x] 1.3 Foundation: `tests/manual-scenarios.md` with the table header (capability, scenario, why manual, handover step, date last checked) and no rows. Verify: the traceability check reads it without error
- [x] 1.4 Foundation: anonymous-endpoint check in `Conventions/`, allowlist `GET /health` (design.md D8). Verify: "only allowlisted endpoints answer without sign-in" passes, and "every allowlisted endpoint exists" fails at runtime until 2.1
- [x] 1.5 Acceptance: service-health / Health check answers while the app runs
- [x] 1.6 Acceptance: api-errors / Unknown API address answers with a problem description

## 2. [wiring] Health check

- [x] 2.1 FastEndpoints in the API (`AddFastEndpoints`, `UseFastEndpoints`) and `HealthEndpoint`: `GET /health`, `AllowAnonymous`, 200 `text/plain` `Healthy`, no dependencies (design.md D3); its allowlist entry is already in 1.4. Verify: both anonymous-endpoint tests pass
- [x] 2.2 `HealthDriver.GetHealth` replaces its stub: `GET /health`, answer mapped to `HealthAnswer`. Verify: the service-health scenario runs against the app and passes
- [x] 2.3 AppHost polls the check: `.WithHttpHealthCheck("/health")` on the `api` resource. Verify: `dotnet build` passes (the running check is 4.3)

## 3. [wiring] Problem descriptions

- [x] 3.1 `AddProblemDetails` and `UseStatusCodePages` in `Program.cs` (design.md D4). Verify: `GET /api/no-such-address` against the app answers 404 `application/problem+json`
- [x] 3.2 `ApiDriver.GetProblem` replaces its stub: status, content type and body `status` checked, title mapped to `ProblemDescription`. Verify: the api-errors scenario runs against the app and passes

## 4. [close] Acceptance green

- [x] 4.1 All acceptance tests of this change pass, then the full suite including the traceability check. Verify: `dotnet test` exits 0
- [x] 4.2 Measure the cost of one app copy per test (time per acceptance test, from the test output) and record it with the date in docs/conventions/testing.md § Acceptance-test harness. Verify: the number is in the file; if it is too slow, propose the fallback named there to the user
- [x] 4.3 `aspire start`: the `api` resource reaches Healthy and `/health` answers in the browser; then `aspire stop`. Verify: `aspire describe` shows the resource healthy before stopping
- [x] 4.4 Hook check: resume I and have it try to write a probe file under `tests/RevolutReader.AcceptanceTests/Scenarios/`; the hook must block it (accept the workspace trust prompt first). Verify: I reports the block and `git status` shows no new file; record the result and date in docs/conventions/testing.md § Test-first workflow
- [x] 4.5 `CLAUDE.md`: replace "No code yet" with a Commands section holding the commands of design.md D10, in the exact form that worked. Verify: each command run once as written
- [x] 4.6 docs/conventions/README.md § Backend code: Result shape (D9), case → status table with the 404 row, no default HTTP retries (D5); mirror the short form in `.claude/rules/backend-code.md`. Verify: both files state the same rules
- [x] 4.7 docs/conventions/testing.md: `Conventions/` in § Where tests live; the per-requirement delta rule and the ignored archive in § Every scenario has exactly one test; the `Production` environment in § Acceptance-test harness; test commands now in `CLAUDE.md` (§ Decided later). Mirror in `.claude/rules/testing.md`. Verify: no statement in the two files contradicts design.md D6–D8
- [x] 4.8 docs/conventions/workflow.md § 3: add the `[setup]` row (one-time, C1: the solution before the first `/tdd-apply`, type `build`, committed by Claude). Verify: the table lists it
- [x] 4.9 Software factory: lessons R-28 to R-32 in docs/software-factory/lessons.md (design.md § Cross-cutting effects); inventory lines in docs/software-factory/creating-handover-package.md for the traceability check, the anonymous-endpoint check, the acceptance harness base and the build-rule files. Verify: every new entry links to its source
- [x] 4.10 `pm/progress.md`: C1 row (status as the user decides, date, notes: measured cost, hook result, deviations). Verify: the row matches what was done

## Workflow follow-up

- Review and merge the PR (squash; title `feat: add backend foundation (C1)`).
- `/opsx:archive c001-add-backend-foundation` after the traceability check and all acceptance tests pass.
- Follow-up PR: move to .NET 11 GA (SDK and the 11.0.0 packages) once it ships, and FastEndpoints with it (9.0 stable if released by then; design.md D2).
