---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "openspec/changes/**/tasks.md"
---

# Testing

- **Tests are written before the code, by the test-writer;** the implementer never edits tests (except acceptance `Drivers/` in wiring and close, and `RevolutReader.IntegrationTests/Wiring/`). Implementation runs through `/tdd-apply`; a tooling-only change (`skip_specs: true`, e.g. CI) has nothing to test first and is applied directly with `/opsx:apply`.
- **Every OpenSpec scenario has exactly one claim:** `[Scenario("<capability>", "<exact scenario name>")]` on an API acceptance test, a `scenario("<capability>", "<exact scenario name>", …)` Vitest test for browser-only rules (string literals, in a `*.test.ts(x)` file; any other `scenario(` call is reported as unreadable), or a row in `tests/manual-scenarios.md`. The traceability test fails the build otherwise. It reads the main specs with each active change's delta applied per requirement and ignores `openspec/changes/archive/`.
- **Acceptance test cases (`Scenarios/`) use only the DSL, in domain language** — no HTTP, status codes, IDs or selectors. Only `Drivers/` knows HTTP. A port with its own capability (the bank adapter, `bank-reads`) is driven through the port itself: its driver takes it from the test's app copy (`Services`). Changing a test case is a spec change and needs the user's approval.
- **Behavioural assertions only:** outcomes through public interfaces, never internal calls or private state. Shouldly; hand-written in-memory fakes, no mocking framework; no snapshot testing.
- **A new test must fail at runtime** (a `NotImplementedException` stub or an assertion), never only at compile time.
- **The app runs inside the test process, one copy per test, in environment `Production`** (base `appsettings.json`); structural checks on the running app (the anonymous-endpoint allowlist) live in the acceptance project's `Conventions/`; Enable Banking is a WireMock.Net fake server, and every app copy gets its settings (`Drivers/FakeBank`: its address, made-up ids, a key generated per run, a 1 s timeout); the clock is `FakeTimeProvider`; sign-in uses self-signed tokens from a throwaway key; the web root is a stand-in page folder (`Drivers/StandInPages/`), never the frontend build. No test needs a real secret.
- **Fake bank responses are copied from Mock ASPSP captures** (`spikes/enable-banking-mock/evidence/`) or, when the mock cannot produce them, written from the API reference with a comment saying so. **Never real account data** in any test or fixture.
- **No automatic re-runs** of failing tests; a flaky test is fixed or deleted. Docker-dependent tests stop with a message when Docker is not running, never skip silently.
- **tasks.md is the test list:** groups `[acceptance]` → `[unit]` → `[integration]` → `[wiring]` → `[close]`, one behaviour per task, never a "write tests" task. A tooling-only change's groups are named after its work instead.

Source of truth: [docs/conventions/testing.md](../../docs/conventions/testing.md).
