---
paths:
  - "tests/**"
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "openspec/changes/**/tasks.md"
---

# Testing

- **Tests are written before the code, by the test-writer;** the implementer never edits tests (except acceptance `Drivers/` in wiring and close, and `RevolutReader.IntegrationTests/Wiring/`). Implementation runs through `/tdd-apply`.
- **Every OpenSpec scenario has exactly one claim:** `[Scenario("<capability>", "<exact scenario name>")]` on an API acceptance test, a `scenario(...)` Vitest test for browser-only rules, or a row in `tests/manual-scenarios.md`. The traceability test fails the build otherwise.
- **Acceptance test cases (`Scenarios/`) use only the DSL, in domain language** — no HTTP, status codes, IDs or selectors. Only `Drivers/` knows HTTP. Changing a test case is a spec change and needs the user's approval.
- **Behavioural assertions only:** outcomes through public interfaces, never internal calls or private state. Shouldly; hand-written in-memory fakes, no mocking framework; no snapshot testing.
- **A new test must fail at runtime** (a `NotImplementedException` stub or an assertion), never only at compile time.
- **The app runs inside the test process, one copy per test;** Enable Banking is a WireMock.Net fake server; the clock is `FakeTimeProvider`; sign-in uses self-signed tokens from a throwaway key. No test needs a real secret.
- **Fake bank responses are copied from Mock ASPSP captures** (`spikes/enable-banking-mock/evidence/`) or, when the mock cannot produce them, written from the API reference with a comment saying so. **Never real account data** in any test or fixture.
- **No automatic re-runs** of failing tests; a flaky test is fixed or deleted. Docker-dependent tests stop with a message when Docker is not running, never skip silently.
- **tasks.md is the test list:** groups `[acceptance]` → `[unit]` → `[integration]` → `[wiring]` → `[close]`, one behaviour per task, never a "write tests" task.

Source of truth: [docs/conventions/testing.md](../../docs/conventions/testing.md).
