# Tasks: c008-add-bank-read-retries

Before this list (design.md D1–D11 are all decided, 2026-11-08):

- **design.md § Bootstrap**, committed as `[setup]`: a rebase if `main` moved, the package, the API names checked, and a green full suite. Its baseline (after merging C6, design.md § Bootstrap): backend 518 of 519 and frontend 53 of 53, with one accepted red: the traceability check naming this change's five new scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c008-add-bank-read-retries` (roadmap C11). Six scenarios, so the work is sliced per scenario (`openspec/config.yaml` § tasks). Docs tasks are the orchestrator's. "Green" below means the full suite (`dotnet test` and the frontend tests), except this change's acceptance tests that their slice has not reached yet.

Tests 1.6 and 1.7 pass from the start: today nothing is retried. They guard that the retries leave unattended reads and timeouts alone, and are accepted as green when written.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation: the fake bank's one-off answers and the DSL (design.md § Public API sketch): `Bank.ReportsOwnErrorForTheFirstRequest()`; `Bank.BreaksConnectionWhileAnsweringTheFirstRequest()`, a break after the answer has started (design.md § How each scenario is verified), with a comment saying the Mock ASPSP cannot produce it; `Bank.ListsInPagesWithOneErrorOnPage(since, count, pages, failingPage)`; `Bank.PagesRequested()`. `Drivers/FakeBank` sets `EnableBanking:RetryDelay` to zero. Verify: build passes; every acceptance test that was green stays green
- [x] 1.2 Acceptance: bank-reads / A one-off bank error is retried and the read succeeds
- [x] 1.3 Acceptance: bank-reads / A connection that breaks once is retried and the read succeeds
- [x] 1.4 Acceptance: bank-reads / A bank error that persists is tried four times, then reads as bank unavailable
- [x] 1.5 Acceptance: bank-reads / A failure on a later page retries only that page
- [x] 1.6 Acceptance: bank-reads / An unattended read is never retried
- [x] 1.7 Acceptance: bank-reads / A bank that answers too slowly reads as bank unavailable (changed: the bank received exactly one request)

## 2. [unit] Slice 1 — The retry rule

- [x] 2.1 A present user's request answered with the bank's own error (`ASPSP_ERROR`, `ASPSP_TIMEOUT`) is retried
- [x] 2.2 A present user's request answered with a 5xx or 408 without an Enable Banking code, a gateway's HTML page included, is retried
- [x] 2.3 A present user's request that failed with a network failure is retried
- [x] 2.4 A present user's request answered as rate limited (429, or `ASPSP_RATE_LIMIT_EXCEEDED` with any status) is not retried
- [x] 2.5 A present user's request answered with an access-expired code (e.g. `EXPIRED_SESSION`) is not retried
- [x] 2.6 A present user's request answered with any other error (an unknown code on a 5xx, a 4xx with or without a code) is not retried
- [x] 2.7 A success answer is not retried
- [x] 2.8 A cancelled attempt is not retried
- [x] 2.9 A request without the present-user mark, or marked false, is never retried, whatever its failure
- [x] 2.10 A retryable answer whose `Retry-After` wait (seconds or a date) would end after the request's deadline is not retried; one whose wait ends before it is; a `Retry-After` on a request without a deadline is not retried (design.md D8)

## 3. [unit] Slice 1 — The retry options

- [x] 3.1 The options allow at most 3 retries
- [x] 3.2 The waits are exponential from the given first wait, with jitter
- [x] 3.3 The options follow a `Retry-After` header

## 4. [wiring] Slice 1 — The retry handler on the bank client

- [x] 4.1 `EnableBankingErrorValue`: the client's reading of an error answer's `error` value, moved out unchanged and used by the client (design.md D5). Verify: `ErrorAnswerTests` and the log-line tests in `IntegrationTests/Wiring/EnableBanking/` stay green unchanged; green
- [x] 4.2 `EnableBankingOptions.RetryDelay` (0 to 5 s), declared in `appsettings.json` as `00:00:00.8` with its provenance comment and a note on why tests set zero (design.md D7); `RequestTimeout`'s comment says it covers a request with its retries (D1); `BankOnWireMock` sets the wait to zero. Verify: an edge test that a wait over 5 s stops the start, naming the setting; green
- [x] 4.3 `AddResilienceHandler("bank-retries")` with `BankRetries.Options(RetryDelay, TimeProvider)` on the bank client; the client marks a present user's requests and every request's deadline (design.md § Public API sketch). Verify: edge tests in `IntegrationTests/Wiring/EnableBanking/`: a present user's balance read answered 503 once and then 200 is read, with 2 requests; the same after `ASPSP_TIMEOUT`; a present user's 429 and expired session each get exactly 1 request; acceptance 1.2 passes; green

## 5. [close] Slice 1 — A one-off bank error is retried and the read succeeds

- [x] 5.1 Acceptance 1.2 passes (`--treenode-filter "/*/*/BankReadsScenarios/*"` for the class); green

## 6. [wiring] Slice 2 — Each attempt reads the whole answer

- [x] 6.1 `WholeAnswerHandler` inside the retry handler (design.md D6). Verify: edge tests: a present user's read whose first answer breaks while it comes in (as `ConnectionBreakingServer` does, once) is read, with 2 requests; an unattended one is bank unavailable after 1; `NetworkFailureTests` stay green; green

## 7. [close] Slice 2 — A connection that breaks once is retried and the read succeeds

- [x] 7.1 Acceptance 1.3 passes; green

## 8. [wiring] Slice 3 — A persistent failure

- [x] 8.1 Edge test: a present user's read against a bank that keeps reporting its own error ends as bank unavailable after 4 requests, and its log line says bank unavailable with 1 page (the line counts pages, not attempts). Verify: the test passes; green

## 9. [close] Slice 3 — A bank error that persists is tried four times, then reads as bank unavailable

- [x] 9.1 Acceptance 1.4 passes; green

## 10. [wiring] Slice 4 — A retried page

- [x] 10.1 Edge test: a retried transactions page carries the same continuation key and the same user headers as its first attempt. Verify: the test passes; green

## 11. [close] Slice 4 — A failure on a later page retries only that page

- [x] 11.1 Acceptance 1.5 passes; green

## 12. [wiring] Slice 5 — Unattended reads

- [x] 12.1 Edge test: an unattended transactions read whose second page fails once ends as bank unavailable, with that page requested once. Verify: the test passes; green

## 13. [close] Slice 5 — An unattended read is never retried

- [x] 13.1 Acceptance 1.6 passes; green

## 14. [wiring] Slice 6 — The timeout covers the retries

- [x] 14.1 Edge tests (design.md D1): a present user's read whose first answer is a 503 and whose second never comes ends as bank unavailable within the request timeout plus a small margin, after 2 requests; a first attempt that runs into the timeout is the only request. Verify: the tests pass; green
- [x] 14.2 Edge tests (design.md D8): a 503 with `Retry-After: 60` ends the read as bank unavailable at once (well under the request timeout), after 1 request; a 503 with `Retry-After: 1` is retried about 1 s later and read; a `Retry-After` that just overruns the time left ends the read at once. Verify: the tests pass; green

## 15. [close] Slice 6 — A bank that answers too slowly reads as bank unavailable

- [x] 15.1 Acceptance 1.7 passes; green

## 16. [wiring] The library's log lines

- [x] 16.1 `Logging:LogLevel:Polly` = `Warning` in `appsettings.json` (design.md D9). Verify: edge tests with a capturing logger that also keeps the `Polly` category: a read answered at once writes no line of the library; a read retried once writes the library's retry warnings and still exactly one read line; green
- [ ] 16.2 `Conventions/BankTelemetryTests` adds a read retried once, for the guard's own present user: no line of the library and no exported trace holds the account id, the session id, or the user's address or browser. Verify: the test passes; green
- [ ] 16.3 deployment.md § Checks: a ready query in PowerShell 7 listing the bank retries in a period (the library's warnings in `AppTraces`), next to the existing ready queries and in their form, marked to confirm once the first real retry lines arrive. Verify: the columns match the existing queries'; the link to Microsoft's columns resolves

## 17. [wiring] No other client retries

- [ ] 17.1 A convention test in `AcceptanceTests/Conventions/` (design.md D10): the app copy's plain `HttpClient` from `IHttpClientFactory` sends one request to a local fake answering 503, and exactly one request arrives. Verify: it passes; a probe that adds `AddStandardResilienceHandler` to `ConfigureHttpClientDefaults` in ServiceDefaults makes it fail (probe reverted, as lesson R-31 does for build gates); green

## 18. [wiring] Docs

- [ ] 18.1 The rule kept with D10's broader reason, and the bank client's exception (design.md D10, § Cross-cutting effects): docs/conventions/README.md § Backend code; `.claude/rules/backend-code.md`; docs/conventions/testing.md (the driver's wiring retries); the comments in `ServiceDefaultsExtensions`, `BankDriver` and `BankOnWireMock` that say "no retries". Verify: `grep -rn -i "never retr\|no retries"` outside the archive finds only the rate-limited rule and statements that are still true
- [ ] 18.2 ADR-0001: a dated note in § Consequences (bank adapter): a present user's transient failures are retried (c008 design.md D1–D8), unattended reads never, and 429, expired and revoked sessions still never; in § Transaction history, D11's finding (a continuation key works a second time, with its evidence). `spikes/enable-banking/README.md`: the probe as a new step with its evidence. Verify: the notes link this design and the evidence and contradict nothing in the ADR's Decision
- [ ] 18.3 docs/software-factory/lessons.md: R-30 updated as design.md § Cross-cutting effects lists, in the file's current entry format, and the "no retries" in the entry at line 488 corrected; R-30's inventory row in `creating-handover-package.md` checked (the convention test of task 17.1 is a reusable artifact). Verify: the options, the choice and the "Generalizes" line match design.md D1–D11

## 19. [close] Acceptance green

- [ ] 19.1 All seven acceptance claims of this change pass (`dotnet test --project tests/RevolutReader.AcceptanceTests --treenode-filter "/*/*/BankReadsScenarios/*"`), and the full suite, `dotnet format whitespace RevolutReader.slnx --verify-no-changes` and the traceability check are green
- [ ] 19.2 `pm/roadmap.md` C11: "within about 2 s" replaced by the decided policy (design.md D1–D4), with a change-log row in `pm/progress.md`; `pm/progress.md`: C11's status, date and notes. `CLAUDE.md`: the Check 2 row says its filter also runs the key-reuse probe (3 more present-user requests, none unattended). Verify: the row links the change folder

## Workflow follow-up

- `/opsx:archive` on the change branch before the merge, inside the same PR: it adds the requirement "Retrying a failed request" to the main `bank-reads` spec and updates "Bank unavailable".
- The PR `feat: add bank-read retries (C11)` closes [#27](https://github.com/jakubbohm/RevolutReader/issues/27). Its deploy needs nothing by hand: the new setting keeps its `appsettings.json` value.
