# RevolutReader — Engineering conventions

**Status:** living document, docs-first · **Last updated:** 2026-11-04 · **Origin:** decided in F0-1 from a review of the DoseUp conventions; where this project deliberately differs, see [docs/software-factory/divergences.md](../software-factory/divergences.md).

This directory is the **source of truth for conventions**. A convention is written here first, then mirrored into enforcement (`.editorconfig`, analyzers, CI) and into `.claude/rules/` so Claude follows it while writing code. If a tool cannot express a rule, the doc is still authoritative. Changing a convention means one change that updates the doc **and** its enforcement together.

| File | Covers |
|---|---|
| README.md (this file) | formatting, static analysis, C# style, backend code, API contract, frontend |
| [configuration.md](configuration.md) | settings and secrets |
| [workflow.md](workflow.md) | where knowledge and decisions live, Git, CI/CD, infrastructure, OpenSpec, spikes, design, project management |
| [testing.md](testing.md) | TDD, BDD, test strategy — placeholder, filled in a separate F0-1 session |

Sections stay short on purpose: a rule gets its detail from the change that first makes it real (mostly C1 and C3), never invented in advance.

## Formatting

- **C# layout is owned by `.editorconfig`** — the single formatting authority. The owner's style: end-of-line braces, 2-space indent, CRLF, file-scoped namespaces, no `var`, expression-bodied members, `_camelCase` private fields. No CSharpier: it hard-codes a brace style that is not the owner's and reads only the basics from `.editorconfig`.
- **The build is the format gate:** layout violations are IDE0055 build errors (`EnforceCodeStyleInBuild` + `TreatWarningsAsErrors`). Fixer: `dotnet format whitespace <solution>`. Format-on-save comes from the committed `.vscode/settings.json`.
- **Line width:** soft ~200 characters, deliberately unenforced. A statement that fits stays on one line; a line break expresses structure (a fluent chain, one condition per line), never a printer's default.
- **One-line blocks carry no braces;** the statement sits on the next line, indented. Enforced in both directions: Roslynator RCS1002 removes braces (the only Roslynator rule enabled), IDE0011 (`csharp_prefer_braces = when_multiline`) adds them on multi-line bodies.
- **TypeScript/React:** ESLint + Prettier, Prettier's style taken as is; CI checks format, lint and `tsc` (set up in C3).
- **Line endings:** `.gitattributes` normalizes text and forces CRLF for `*.cs`, so Linux CI checkouts match `.editorconfig`.
- No pre-commit hooks: on-save, on-build and CI cover formatting.

## Static analysis

- `Directory.Build.props` (created in C1): `Nullable` and `ImplicitUsings` enabled, `TreatWarningsAsErrors`, `AnalysisLevel latest-all`, `EnforceCodeStyleInBuild`, `GenerateDocumentationFile` (needed for IDE0005 on build; CS1591 is not gated).
- Analyzer packages: `Microsoft.CodeAnalysis.BannedApiAnalyzers` (time discipline below) and `Roslynator.Analyzers`, scoped to RCS1002.
- **Every disabled or downgraded rule carries a comment saying why**, next to the setting in `.editorconfig`. Path-specific exemptions are added by the change that first needs them.
- **Central package management:** every package version lives in `Directory.Packages.props`; the SDK is pinned exactly in `global.json` (both created in C1).

## C# style beyond tooling

- **Member layout: payload first, plumbing last.** A type starts with what it exists for: properties, constructors, operations. Mechanical plumbing (`operator ==`/`!=`, `Equals` overloads, `GetHashCode`, a `ToString` with no domain meaning) is the last block, folded in `#region Object overrides`. The dispose pattern is folded the same way as `#region IDisposable` / `#region IAsyncDisposable`, before `Object overrides`. A region never wraps meaningful code. Not tool-enforced; mirrored in `.claude/rules/csharp-member-layout.md`.
- **Time:** never `DateTime.Now/UtcNow` or `DateTimeOffset.Now/UtcNow` outside the composition root; inject the BCL `TimeProvider` (no custom clock interface). Logic that depends on the current time takes `DateTimeOffset now` as a parameter, so it stays a pure function and tests own the clock. Enforced by `BannedSymbols.txt` (created in C1).
- **Guards (bug checks only):** BCL throw helpers (`ArgumentNullException.ThrowIfNull`, `ArgumentException.ThrowIfNullOrWhiteSpace`, the `ArgumentOutOfRangeException.ThrowIf*` family) and `UnreachableException` for impossible branches. No guard library, no custom `Guard` type. Expected states are Result values, not guards.

## Backend code

- **Expected failures are Result values, end to end.** Validation errors, not-found, an expired or revoked bank consent, a bank rate limit: each travels as a Result value from the inner code to the endpoint. Exceptions are only for bugs and infrastructure failures. Inner code returns domain-side results or plain values; **only endpoints** translate them into the HTTP result and ProblemDetails, and the HTTP result type never travels inward. Shape: a hand-rolled union, as in DoseUp. **Check before C1 commits to it:** whether C# union types ship in .NET 11 GA; if they don't, C1 proposes the closest fallback.
- **Every non-2xx response is ProblemDetails** (RFC 9457), including validation and authentication failures. One case → status table, created in C1 and kept here; no ad-hoc error JSON.
- **Endpoints: FastEndpoints.** One thin endpoint per use case (route, OpenAPI metadata, auth, Result → ProblemDetails mapping) that injects a plain, framework-free handler class owning the use case. No mediator, and no pipeline behaviors wrapped around handlers.
- **Reads return only what the client shows.** A read endpoint maps straight into a response DTO carrying only the fields the UI uses, never a mirror of the Enable Banking model. A test pins the exact response shape, so an extra field is a red test. Each exposed field is a deliberate choice recorded in the spec.
- **Never log bank data:** no balances, amounts, counterparties or transaction texts in logs, traces or error messages — ids and counts only.
- **Secure by default:** every endpoint requires a signed-in, allowed user. Anonymous endpoints are an explicit allowlist checked by a test. Health probes touch neither the database nor the bank (bank requests are rate-limited — [ADR-0001-bank-data-access](../adr/0001-bank-data-access.md)).
- **Bank calls** follow ADR-0001-bank-data-access § Decision (PSU headers only on user-triggered reads).

## API contract

- OpenAPI is the contract: FastEndpoints exports `openapi.json` (committed); openapi-typescript generates the TypeScript types file (committed, never hand-edited); the web app calls the API through openapi-fetch, whose `{ data, error }` continues the Result pattern into TypeScript.
- One script does export + regenerate. A change touching the API runs it as an explicit task; **CI regenerates only to compare and fails on drift — it never generates or commits fixes.**
- A change that **modifies** an existing contract (not a pure addition) also updates every TypeScript consumer in the same change.

## Frontend

- Stack from kickoff ch. 7: React + Vite + TypeScript PWA, Tailwind CSS, Radix Primitives.
- **Radix stays behind the app's own components:** feature code never imports Radix directly, only the owned component layer does (ESLint `no-restricted-imports`, set up in C3), so the library stays swappable.
- Wire payloads use the generated contract types only, never hand-written wire types.
- UI text is Czech (kickoff ch. 8); code, comments and identifiers are English.
- Nothing secret or environment-specific in `VITE_` variables ([configuration.md § Frontend](configuration.md#frontend)).
