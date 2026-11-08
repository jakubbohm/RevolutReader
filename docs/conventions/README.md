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
- **TypeScript/React:** TypeScript 7, **oxlint + Prettier** (not ESLint; the user, 2026-11-06, c003 design.md D3). Prettier's style is taken as is (`.prettierrc.json` is `{}`), oxlint runs with `--deny-warnings`, and the type check is `tsc -b`. CI checks all three (the `frontend` job). Why not ESLint: typescript-eslint supports TypeScript below 6.1 only, and TypeScript 7 has no classic compiler API; a tool that needs that API (C6's openapi-typescript) runs with its own TypeScript 5 copy.
- **Line endings:** `.gitattributes` normalizes text and forces CRLF for `*.cs`, so Linux CI checkouts match `.editorconfig`. It forces LF for `src/RevolutReader.Web/**`, Prettier's line ending, so its check agrees on Windows and Linux. PNGs are marked `binary` after that line: as text, their bytes would be rewritten on commit. A new binary type in the frontend folder (e.g. a font) needs the same line.
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

- **Expected failures are Result values, end to end.** Validation errors, not-found, an expired or revoked bank consent, a bank rate limit: each travels as a Result value from the inner code to the endpoint. Exceptions are only for bugs and infrastructure failures. Inner code returns domain-side results or plain values; **only endpoints** translate them into the HTTP result and ProblemDetails, and the HTTP result type never travels inward. **Shape (fixed in C1, built in C5):** a C# 15 `union` whose case types are sealed records (never interfaces), returned by handlers; endpoints map each case to the HTTP result through the case → status table below. The first one is generic, the bank port's `BankResult<T>(T, BankAccessExpired, BankRateLimited, BankUnavailable)`: the success value is the type parameter, and **the failure records are declared next to the union, not nested in it** (c004 design.md D4). Nested in a generic union, each would be a separate type per success type, and a caller reading both the balance and the transactions would handle every failure twice. A non-generic union may still nest its records (as DoseUp's `ApiResult`). The compiler generates a union as a struct, so `.editorconfig` exempts each union's file from CA1815 (a struct's own `Equals`): the case records already compare by value. C# union types ship in C# 15, the default language version for `net11.0`, with no preview switch (Microsoft Learn, What's new in C# 15, updated 2026-10-23; checked in C1). Caveat: a default (uninitialized) union is empty, and a `switch` over it throws `SwitchExpressionException`.
- **Every non-2xx response is ProblemDetails** (RFC 9457), including validation and authentication failures, for every caller that accepts JSON (browsers and HTTP clients do by default; a caller that rules JSON out gets ASP.NET Core's plain-text status line — content negotiation). No ad-hoc error JSON. A body-less error gets its problem description from `AddProblemDetails` + `UseStatusCodePages`. **Case → status table** — each change whose scenario produces a new case adds its row (401/403 in C6; the bank cases and 500 for unhandled errors in C7, the first endpoint that reads the bank: C5's bank port returns result cases, not HTTP answers, c004 design.md D1, D4):

  | Case | Status | `title` | Scenario |
  |---|---|---|---|
  | The API does not serve the address | 404 Not Found | `Not Found` | api-errors / Unknown API address answers with a problem description |
  | Nobody is signed in | 401 Unauthorized | `Unauthorized` | sign-in / An anonymous visitor is asked to sign in |

- **Outgoing HTTP calls get no retries by default.** The Aspire template's `AddStandardResilienceHandler` on every `HttpClient` is removed from ServiceDefaults: it retries 408, 429 and 5xx, and a retried 429 from Enable Banking would silently burn the 4 requests a day allowed without the account holder ([ADR-0001-bank-data-access](../adr/0001-bank-data-access.md)). A client gets retries only when its own change decides a policy; the bank client never retries.
- **Endpoints: FastEndpoints.** One thin endpoint per use case (route, OpenAPI metadata, auth, Result → ProblemDetails mapping) that injects a plain, framework-free handler class owning the use case. No mediator, and no pipeline behaviors wrapped around handlers.
- **Reads return only what the client shows.** A read endpoint maps straight into a response DTO carrying only the fields the UI uses, never a mirror of the Enable Banking model. A test pins the exact response shape, so an extra field is a red test. Each exposed field is a deliberate choice recorded in the spec.
- **Never log bank data:** no balances, amounts, counterparties or transaction texts in logs, traces or error messages — ids and counts only.
- **Secure by default:** every endpoint requires a signed-in, allowed user. The authorization policy `AllowedUser` is both the default policy (what FastEndpoints applies to an endpoint without its own settings) and the fallback policy (any other endpoint without authorization metadata), so only an explicit `AllowAnonymous` opens an address. An unknown API address answers 404 to everyone, signed in or not, whatever the method: the anonymous catch-all `ApiNotFound` (`/api/{**path}`, every method, lowest precedence) answers 404, so a real address wins for its own methods and a wrong method on it answers 404 too. A refusal counts only for a request that matched a real route (the authorization result handler `UnmatchedRequestsPass`), so the router's own 405 for a write to an unknown page address answers 405 to everyone, not 401 to anonymous callers (c007 design.md D3). Anonymous endpoints are an explicit allowlist checked by a test that reads the app's real endpoint list, so it also catches routes a framework maps by itself (it caught FastEndpoints 8.3.0's anonymous `_test_url_cache_` in C1). The first entry is the health probe `GET /health`. Health probes touch neither the database nor the bank (bank requests are rate-limited — [ADR-0001-bank-data-access](../adr/0001-bank-data-access.md)).
- **Bank calls** follow ADR-0001-bank-data-access § Decision (PSU headers only on user-triggered reads).

## API contract

- OpenAPI is the contract: FastEndpoints exports `openapi.json` (committed); openapi-typescript generates the TypeScript types file (committed, never hand-edited); the web app calls the API through openapi-fetch, whose `{ data, error }` continues the Result pattern into TypeScript.
- One script does export + regenerate. A change touching the API runs it as an explicit task; **CI regenerates only to compare and fails on drift — it never generates or commits fixes.**
- **How it is built (C6, c007 design.md D9):**
  - **The export** is the explicit check `OpenApiExport` (`tests/RevolutReader.IntegrationTests/Wiring/OpenApi/`, never in the default run). It starts an app copy with made-up values for every setting checked at start and writes `src/RevolutReader.Api/openapi.json` (OpenAPI 3.2.0, LF). A build-time export can't work: it starts the app, whose start-up checks refuse the `"<secret>"` placeholders. So a change that adds a setting checked at start adds a made-up value to the check.
  - **The generator** lives in `tools/api-client/`, with its own `package.json` and lock file, because openapi-typescript 7 needs TypeScript 5 and the web app is on TypeScript 7. `npm --prefix tools/api-client run generate` writes `src/RevolutReader.Web/src/api/schema.d.ts`; `run regenerate` runs the export check first, then `generate`. The types file is left out of Prettier and oxlint.
  - **The document's texts are set in code** (`Summary(…)` in each endpoint, `[Description]` on response records), never taken from XML doc comments: FastEndpoints.OpenApi reads the XML documentation file at run time, so the API project doesn't copy it to its output. So editing a doc comment never changes the contract or trips the drift step.
  - **The drift steps** sit in the existing CI jobs, so there is no new required check: `build-and-test` runs the export check after the build, then `git diff --exit-code` on `openapi.json`; `frontend` runs `generate`, then `git diff --exit-code` on `schema.d.ts`.
- A change that **modifies** an existing contract (not a pure addition) also updates every TypeScript consumer in the same change.

## Frontend

- Stack from kickoff ch. 7: React + Vite + TypeScript PWA, Tailwind CSS, Radix Primitives. The app lives in `src/RevolutReader.Web/`, run by npm (c003 design.md D1).
- **Radix stays behind the app's own components:** feature code never imports Radix directly, only the owned component layer in `src/components/` does (oxlint `no-restricted-imports` in `.oxlintrc.json`, with an override for `src/components/**`), so the library stays swappable.
- **Czech texts sit in the components;** the UI has one language, so there's no i18n library.
- Wire payloads use the generated contract types only, never hand-written wire types.
- UI text is Czech (kickoff ch. 8); code, comments and identifiers are English. The one exception is the app's name, *Tarjeta Papá* (exactly so: capital P, with the accent), which stays Spanish (the user, 2026-11-05).
- The look comes from the design system ([workflow.md § 8](workflow.md#8-design)).
- Nothing secret or environment-specific in `VITE_` variables ([configuration.md § Frontend](configuration.md#frontend)).
