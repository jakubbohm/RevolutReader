# Proposal: c001-add-backend-foundation

## TL;DR

- **What:** the backend's first code. A .NET 11 solution with the API (ASP.NET Core + FastEndpoints), the Aspire AppHost and ServiceDefaults, the build rules, the three test projects, the acceptance-test setup that runs the app inside the test, and the check that every spec scenario has exactly one test. It ends with a running API that has two behaviours, both proven by acceptance tests.
- **Why now:** every later change (C2 to C9) builds on it. C1 is also the first run of the test-first workflow (`/tdd-apply`, `review=all`).
- **Out of scope:** sign-in, the bank, storage, the frontend, OpenAPI export, CI, deployment, the Result type (built in C5).
- **Riskiest assumption:** TUnit.AspNetCore 1.80.0, built for .NET 10, runs a .NET 11 app with FastEndpoints once Microsoft's test host (Mvc.Testing) is pinned to 11.0.0-rc.3. Fallback: Mvc.Testing's `WebApplicationFactory` used directly from TUnit tests.
- **Scenarios added:**
  - `service-health`: Health check answers while the app runs
  - `api-errors`: Unknown API address answers with a problem description

## Why

Roadmap step **C1** (`pm/roadmap.md`). No use case directly: this is the foundation UC1–UC3 are built on. A walking skeleton (one trivial behaviour proven end to end, from a test case down to the running app) is cheaper to get right now than under the first real feature, and C1 must prove three unverified assumptions before C5 and C6 rely on them: FastEndpoints inside the TUnit test host, the cost of one app copy per test, and the implementer agent's hook.

## What Changes

- A .NET 11 solution generated from the CLI templates and adapted to the conventions: `src/RevolutReader.Api`, `src/RevolutReader.AppHost`, `src/RevolutReader.ServiceDefaults`; `tests/RevolutReader.AcceptanceTests`, `tests/RevolutReader.UnitTests`, `tests/RevolutReader.IntegrationTests`, `tests/manual-scenarios.md`.
- The build rules from `docs/conventions/README.md`: `global.json` (SDK pinned exactly), `Directory.Build.props`, `Directory.Packages.props`, `BannedSymbols.txt`.
- A health check at `GET /health`, open to anyone and touching neither the bank nor storage. Container Apps (C4) and the Aspire dashboard poll it.
- Every error response without a body becomes a problem description (RFC 9457). The first case is an unknown address → 404.
- The Aspire template's default retry on every outgoing HTTP call is removed, so no bank call is ever retried behind the code's back (ADR-0001-bank-data-access: 4 unattended requests a day).
- The acceptance-test setup (`Scenarios/` → `Dsl/` → `Drivers/` → one app copy per test), the traceability check, and the check that only allowlisted endpoints work without sign-in.
- `CLAUDE.md` gets its Commands section; the conventions record what C1 measured and decided (Result shape, case → status table, test commands).

## Capabilities

### New Capabilities

- `service-health`: the app answers a health check that hosting platforms and local orchestration poll, without sign-in.
- `api-errors`: how the API answers when a request fails: every error response is a problem description with the status from the case → status table.

### Modified Capabilities

None (no specs exist yet).

## Non-goals

- **Sign-in and the allowlist of users** (C6). C1 only checks which endpoints are open without sign-in; it adds no sign-in scheme.
- **The Result type** for expected failures. C1 verifies the shape (C# 15 union types ship with .NET 11) and records it; C5 builds it with the first expected failures (roadmap change log, 2026-11-05).
- **Unhandled errors → 500.** Nothing public can trigger one before the fake bank exists; C5 adds that scenario.
- **The bank adapter, the fake bank server and the clock swap** in the test setup (C5 and the first change that reads the time).
- **OpenAPI export and the TypeScript client** (C3), the frontend and its page fallback (C3), CI (C2), Bicep and deployment (C4).
- **Moving to .NET 11 GA:** C1 runs on RC3; the move to GA (expected 2026-11-10) is a small follow-up PR.

## Open questions

- **Applies Q3** (ADR-0002-frontend-hosting): the API project is the one web host; the health check stays outside `/api` so C3's page fallback never covers it.
- **Applies Q4** (ADR-0006-hosting-registry-and-job): the health check is what Container Apps will probe.
- **Applies Q6** (ADR-0001-bank-data-access): no default retries on outgoing HTTP calls.
- Decides none.

## Impact

- **New code:** everything under `src/` and `tests/`, plus the build files at the root.
- **Tools on the owner's machine:** Aspire CLI and templates updated to 13.6.4, TUnit templates to 1.80.0 (setup step, design.md § Bootstrap).
- **Docs:** `CLAUDE.md` (Commands), `docs/conventions/README.md` (Result shape, case → status table, no default retries), `docs/conventions/testing.md` (harness facts, traceability rule, measured cost, hook check), `docs/conventions/workflow.md` § 3 (`[setup]` commit), `docs/software-factory/` (lessons, inventory), `pm/progress.md`.
- **No change to:** Azure, Entra, Enable Banking, GitHub settings.
