# Tasks: c004-add-enable-banking-adapter

Before this list: design.md § Bootstrap, committed as `[setup]`: the packages, the 180-day Mock ASPSP session, and the made-up test data with its capture (done 2026-11-06: one page, `continuation_key: null`). Its baseline holds one known exception, accepted once: the repository traceability check reports this change's 13 scenarios as not claimed. Group 1 claims them.

Run with `/tdd-apply c004-add-enable-banking-adapter review=all` (roadmap C5). Thirteen scenarios, so the work is sliced per scenario (slices 1–13). Then come telemetry, local development with the two checks, deployment, and the final close. Docs tasks are the orchestrator's; "Guided" tasks need the owner. "Green" below means the full suite (`dotnet test` and the frontend tests), except this change's acceptance tests still waiting for their slice and the telemetry guard until group 37.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation: `FakeBank`, a WireMock.Net server per test started before the app copy, and the bank settings every app copy gets. Those are its address, a made-up application id, session id and account id, an RSA key in PEM form generated once per run, and a 1 s request timeout. `AcceptanceTest.ConfigureWebHostBuilder` calls `FakeBank.Configure` next to the web root (design.md § Public API sketch). Verify: every acceptance test that was green stays green
- [x] 1.2 Foundation: the port's types as signatures (`IBankAccount`, `ReadTrigger`, `PresentUser`, `Unattended`, `BankResult<T>` with its three failure records, `Balance`, `Transactions`, `BankTransaction`, `TransactionStatus`), exactly as design.md § Public API sketch. The generic union compiles here first (design.md § Risks). Verify: build passes
- [x] 1.3 Guard: `Conventions/BankTelemetryTests`, as design.md D5 and § Public API sketch describe it. Verify: fails at runtime until group 37
- [x] 1.4 Acceptance: bank-reads / The balance is the account's available balance
- [x] 1.5 Acceptance: bank-reads / A spent payment comes back negative, with the payee and its details
- [x] 1.6 Acceptance: bank-reads / A received transfer comes back positive, with the payer
- [x] 1.7 Acceptance: bank-reads / Pending transactions come back marked pending
- [x] 1.8 Acceptance: bank-reads / Cancelled and rejected transactions are left out
- [x] 1.9 Acceptance: bank-reads / Transactions on every page are returned
- [x] 1.10 Acceptance: bank-reads / A read for a present user carries the user's address and browser
- [x] 1.11 Acceptance: bank-reads / An unattended read carries no user headers
- [x] 1.12 Acceptance: bank-reads / An expired bank session reads as access expired
- [x] 1.13 Acceptance: bank-reads / A reached request limit reads as rate limited, with no second request
- [x] 1.14 Acceptance: bank-reads / A bank error reads as bank unavailable
- [x] 1.15 Acceptance: bank-reads / A bank that answers too slowly reads as bank unavailable
- [x] 1.16 Acceptance: bank-reads / A failure on a later page fails the whole read
- [x] 1.17 Docs (design.md D1):
  - `openspec/config.yaml` § specs: a port's scenarios are verified through its public interface, and its error scenarios name result cases;
  - testing.md § Acceptance tests and § Acceptance-test harness: a driver may take a port from the app copy; every app copy gets the fake bank's settings;
  - `.claude/rules/testing.md`;
  - lesson R-44.

  Verify: no statement contradicts design.md D1

## 2. [unit] Slice 1 — Settings validation

- [x] 2.1 A setting still holding the secret placeholder fails validation
- [x] 2.2 A private key that is not an RSA private key in PEM form fails validation, and the message does not contain the key (a public key fails too: the user, group 2 review)
- [x] 2.3 Complete settings pass validation

## 3. [unit] Slice 1 — Application token

- [x] 3.1 The token is signed with RS256 and names the application id as its key id (its header also says `typ` JWT: the user, group 3 review)
- [x] 3.2 The token is issued by enablebanking.com for api.enablebanking.com
- [x] 3.3 The token is issued now and expires one hour later (in whole seconds: a `now` with milliseconds is rounded down, as the M1 client sends it: the user, group 3 review)
- [x] 3.4 The token's signature verifies with the application's public key

## 4. [unit] Slice 1 — Balance selection

- [x] 4.1 The available balance is the ITAV balance, with its amount and currency
- [x] 4.2 A balance list without an ITAV balance is an error
- [x] 4.3 An available balance whose amount is not a number is an error, and the message does not contain it (added 2026-11-06 by the user, from the implementer's missing-test report: `decimal.Parse` quotes its input; D5)

## 5. [wiring] Slice 1 — The balance read

- [x] 5.1 `EnableBankingOptions` and the `EnableBanking` section in `appsettings.json`:
  - `ApiBaseUrl` `https://api.enablebanking.com` and `RequestTimeout` `00:00:15`;
  - the four secrets as `"<secret>"`;
  - each key with its provenance comment (design.md D6).

  Bound with `ValidateDataAnnotations`, `EnableBankingOptionsValidator` and `ValidateOnStart`. Verify: build passes; green (the harness's settings pass validation)
- [x] 5.2 `AddEnableBanking()` and `EnableBankingClient.ReadBalance`: a signed `GET /accounts/{account}/balances`, then `BalanceSelection`. `Program.cs` calls `AddEnableBanking()` (design.md § Public API sketch). Verify: build passes; green
- [x] 5.3 `BankDriver` and `FakeBank`: the balance answer copied from the capture (§ Bootstrap); `ReadBalance` through the app copy's `IBankAccount`, replacing the stubs. Verify: the scenario runs against the app
- [x] 5.4 Docs:
  - README.md § Backend code: the union's shape as built, with the failure records next to it (D4), and the bank cases' status rows moved to C7;
  - configuration.md § Binding: the shared `"<secret>"` validator now exists.

  Verify: README.md matches design.md D4

## 6. [close] Slice 1 — The balance is the account's available balance

- [x] 6.1 The scenario's test passes. Verify: green, including bank-reads / The balance is the account's available balance

## 7. [unit] Slice 2 — Transaction mapping: money spent

- [x] 7.1 A booked transaction is marked booked and keeps its reference
- [x] 7.2 Money spent has a negative amount in its currency
- [x] 7.3 Money spent names the creditor as the counterparty
- [x] 7.4 The payment details are the bank's lines, unchanged and in order
- [x] 7.5 A transaction without payment details has none
- [x] 7.6 A transaction is dated by its transaction date when the bank gives one
- [x] 7.7 Without a transaction date, the booking date dates it
- [x] 7.8 Without a transaction or booking date, the value date dates it
- [x] 7.9 The amount is read the same whatever the machine's culture
- [x] 7.10 A transaction whose amount is not a number is an error, and the message does not contain it
- [x] 7.11 A transaction without any date is an error
- [x] 7.12 A transaction that is neither money spent nor money received is an error

  7.10–7.12 added 2026-11-06 by the user at the group 7 review, from the test-writer's notes: each is a `BankReadException` whose text holds no bank data (design.md D4 "everything else", § Error model, D5).

## 8. [wiring] Slice 2 — The transactions read, one page

- [x] 8.1 `EnableBankingClient.ReadTransactions` for a single page: a signed `GET /accounts/{account}/transactions` with `date_from`, then `TransactionMapping`. Verify: build passes; green
- [x] 8.2 `BankDriver` `Lists` and `ReadTransactionsFrom`: the answer copied from the capture; the stub answers only for the expected `date_from`. Verify: the scenario runs against the app

## 9. [close] Slice 2 — A spent payment comes back negative, with the payee and its details

- [x] 9.1 The scenario's test passes. Verify: green, including this scenario

## 10. [unit] Slice 3 — Transaction mapping: money received

- [x] 10.1 Money received has a positive amount
- [x] 10.2 Money received names the debtor as the counterparty
- [x] 10.3 A transaction without a named counterparty has none

## 11. [close] Slice 3 — A received transfer comes back positive, with the payer

- [x] 11.1 The scenario's test passes with what slices 1 and 2 built; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 12. [unit] Slice 4 — Transaction mapping: pending

- [x] 12.1 A pending transaction is marked pending
- [x] 12.2 A pending transaction without a reference has none

## 13. [close] Slice 4 — Pending transactions come back marked pending

- [x] 13.1 The scenario's test passes; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 14. [unit] Slice 5 — Transaction mapping: other statuses

- [x] 14.1 Cancelled, rejected, on-hold, scheduled and other transactions are left out
- [x] 14.2 The transactions left out are counted
- [x] 14.3 A transaction with a status the bank does not define is an error (added 2026-11-07 by the user at the group 14 review: a missing, empty or unknown status means the bank changed its answer, so a `BankReadException` without bank data, not a silent leave-out; design.md D4)

## 15. [close] Slice 5 — Cancelled and rejected transactions are left out

- [x] 15.1 The scenario's test passes; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 16. [unit] Slice 6 — Transaction pages

- [x] 16.1 A page without a continuation key is the whole list
- [x] 16.2 Pages are followed until no continuation key comes back, and joined in order
- [x] 16.3 An empty page with a continuation key is followed
- [x] 16.4 A repeated continuation key is an error
- [x] 16.5 The pages read are counted
- [x] 16.6 An empty continuation key ends the read, as no key does (added 2026-11-07 by the user at the group 16 review, option A: an empty key cannot name a page; design.md D7)

## 17. [wiring] Slice 6 — Paging

- [x] 17.1 `ReadTransactions` reads through `TransactionPages` with `ReadTransactionPage`, passing `continuation_key` on. Verify: build passes; green
- [x] 17.2 `BankDriver.ListsInPages`: as many different booked and pending transactions as the scenario names, in the capture's shape: the capture's 23 booked and pending ones, plus made-up ones in the same shape for the rest (the scenario needs 25). In pages chained by made-up continuation keys, with `continuation_key: null` on the last page, as Revolut and the Mock ASPSP mark it. Written from the M1 page structure with a comment saying so (design.md § Bootstrap). Verify: the scenario runs against the app

## 18. [close] Slice 6 — Transactions on every page are returned

- [x] 18.1 The scenario's test passes. Verify: green, including this scenario

## 19. [unit] Slice 7 — PSU headers

- [x] 19.1 A present user gives exactly the IP address and user agent headers
- [x] 19.2 An unattended read gives no user headers

## 20. [wiring] Slice 7 — PSU headers on every request

- [x] 20.1 `EnableBankingClient` adds `PsuHeaders.For(trigger)` to every request, every page included. Verify: build passes; green
- [x] 20.2 `BankDriver` `ReadBalanceFor`, `ReadBalanceUnattended` and `RequestsReceived` (from the fake bank's request log). Verify: the scenario runs against the app

## 21. [close] Slice 7 — A read for a present user carries the user's address and browser

- [ ] 21.1 The scenario's test passes. Verify: green, including this scenario

## 22. [close] Slice 8 — An unattended read carries no user headers

- [ ] 22.1 The scenario's test passes with what slice 7 built; if it fails, route it as tdd-apply § 4 says. Verify: green, including this scenario

## 23. [unit] Slice 9 — Error classification: access expired

- [ ] 23.1 Expired, revoked, closed and unknown sessions are access expired
- [ ] 23.2 The bank needing the account holder is access expired
- [ ] 23.3 No accounts added, or the account no longer accessible, is access expired

## 24. [wiring] Slice 9 — Error answers

- [ ] 24.1 `EnableBankingClient` reads the error body, classifies it and returns the case. An unexpected kind throws `BankReadException` carrying only the status and the code. Verify: build passes; green
- [ ] 24.2 `BankDriver.ReportsExpiredSession`, written from the API reference with a comment saying so. Verify: the scenario runs against the app
- [ ] 24.3 Edge cases in `tests/RevolutReader.IntegrationTests/Wiring/EnableBanking/`, against WireMock.Net. An error body without an `error` code falls back to the status. An unreadable error body throws, and the message does not contain the body. Verify: those tests pass

## 25. [close] Slice 9 — An expired bank session reads as access expired

- [ ] 25.1 The scenario's test passes. Verify: green, including this scenario

## 26. [unit] Slice 10 — Error classification: rate limit

- [ ] 26.1 The bank's rate limit is rate limited
- [ ] 26.2 A 429 without an error code is rate limited

## 27. [wiring] Slice 10 — The rate-limit answer

- [ ] 27.1 `BankDriver.ReportsRequestLimitReached`: 429 `ASPSP_RATE_LIMIT_EXCEEDED`, written from the API reference with a comment saying so. Verify: the scenario runs against the app

## 28. [close] Slice 10 — A reached request limit reads as rate limited, with no second request

- [ ] 28.1 The scenario's test passes. Verify: green, including this scenario

## 29. [unit] Slice 11 — Error classification: bank unavailable

- [ ] 29.1 The bank's own error or timeout is bank unavailable
- [ ] 29.2 A 5xx or 408 without an error code is bank unavailable
- [ ] 29.3 Any other error code is unexpected
- [ ] 29.4 Any other status without an error code is unexpected

## 30. [wiring] Slice 11 — Bank errors and an unreachable bank

- [ ] 30.1 A network failure becomes bank unavailable. Edge case in `Wiring/EnableBanking/`: with the fake bank stopped, the read is bank unavailable. Verify: build passes; green; the edge test passes
- [ ] 30.2 `BankDriver.ReportsOwnError`: `ASPSP_ERROR`, written from the API reference with a comment saying so. Verify: the scenario runs against the app

## 31. [close] Slice 11 — A bank error reads as bank unavailable

- [ ] 31.1 The scenario's test passes. Verify: green, including this scenario

## 32. [wiring] Slice 12 — The request timeout

- [ ] 32.1 The typed client's `Timeout` is `RequestTimeout`. Our timeout becomes bank unavailable, while the caller's own cancellation is passed on (edge case in `Wiring/EnableBanking/`). Verify: build passes; green; the edge test passes
- [ ] 32.2 `BankDriver.AnswersAfterTheRequestTimeout`: an answer delayed past the harness's 1 s. Verify: the scenario runs against the app

## 33. [close] Slice 12 — A bank that answers too slowly reads as bank unavailable

- [ ] 33.1 The scenario's test passes. Verify: green, including this scenario

## 34. [unit] Slice 13 — Transaction pages: a failed page

- [ ] 34.1 A failure on a later page ends the read with that failure, and no further page is requested

## 35. [wiring] Slice 13 — The failed later page

- [ ] 35.1 `BankDriver.ListsFirstPageThenFails`: the first page from the capture, then `ASPSP_ERROR`. Verify: the scenario runs against the app

## 36. [close] Slice 13 — A failure on a later page fails the whole read

- [ ] 36.1 The scenario's test passes. Verify: green, including this scenario

## 37. [wiring] Logs and traces without identifiers

- [ ] 37.1 The bank client's default logging is removed (`RemoveAllLoggers()`). Each request carries `HttpRequestTracing.Exclude`, which ServiceDefaults' HTTP-client trace filter drops (design.md D5). Verify: build passes; green
- [ ] 37.2 One log line per read (`LoggerMessage`): which read, present user or unattended, HTTP status, `error` code, duration, pages, and the number left out. Never the PSU values, amounts, names, texts or ids (design.md D5). Verify: build passes; green
- [ ] 37.3 The guard `Conventions/BankTelemetryTests` passes. If it fails on the exported trace, apply design.md § Risks' fallback. Verify: green, guard included
- [ ] 37.4 Docs: lesson R-51 (R-45 to R-50 were taken in `main` by #20 and C4, design.md D8), and inventory lines for the guard test and the fake bank driver. Verify: they link to design.md D5 and D1

## 38. [wiring] Local development

- [ ] 38.1 AppHost: the four secret parameters, handed to the API as `EnableBanking__*` environment variables (design.md § Public API sketch). Verify: build passes; green
- [ ] 38.2 Guided (the owner): a new `docs/operations/local-secrets.md` with the PowerShell 7 commands, then the owner runs them.
  - They set the four `Parameters:enablebanking-*` user-secrets of the AppHost from the owner's sandbox files. The key goes in as the file's text; nothing is pasted by hand.
  - They copy each one to the backup vault `jb-localdev-secrets-copy` as `RevolutReader--AppHost--Parameters--<name>` (design.md D6).
  - The doc also has the restore commands.
  - Every vault write is shown first and runs only on the owner's go (CLAUDE.md).

  Verify: the owner's listing shows the four user-secret names and the four vault copies, names only and never values
- [ ] 38.3 `aspire start`: the API starts on the sandbox settings and its health check is healthy; then `aspire stop`. Verify: the `api` resource is healthy
- [ ] 38.4 Check 1, `Wiring/RealBank/MockAspspCheck` (`[Explicit]`), as design.md D7 describes. It reads the balance and the transactions, both with PSU headers and unattended (one page: the mock does not page at 25). A made-up session id must come back as access expired. Verify: the owner runs it; it passes
- [ ] 38.5 Docs:
  - configuration.md § Local development and tests: the backup vault and the `RealAccountCheck:*` keys;
  - configuration.md § Hand-provisioned secrets: four rows (`EnableBanking--ApplicationId`, `--PrivateKey`, `--SessionId`, `--AccountId` in `kv-revolutreader`), provisioned 2026-11-06 by docs/operations/deployment.md § Guided task (C4); written after the rebase (task 40.1);
  - docs/operations/expiring-approvals.md: a row for the Mock ASPSP session (180 days), and § 3 step 3 naming the application id as a secret;
  - `spikes/enable-banking-mock/README.md`: 180-day sessions, the test data, and how the last page is marked.

  Verify: no statement contradicts design.md D6

## 39. [wiring] Check against the real account

- [ ] 39.1 Check 2, `Wiring/RealBank/RealAccountCheck` (`[Explicit]`), as design.md D7 describes, reading the `RealAccountCheck:*` values.
  - One present-user read with the owner's public IP: the balance, and 89 days of transactions (more than one page at Revolut's 50, the live paging test).
  - One unattended balance read.
  - The raw pages' field counts.
  - It writes the counts-only summary to `spikes/enable-banking/evidence/` and prints no bank data.

  Verify: build passes; with the values absent it fails with a message naming the missing setting
- [ ] 39.2 Guided (the owner): set the `RealAccountCheck:*` user-secrets and their backup copies (local-secrets.md; vault writes on the owner's go), then run Check 2 once. Verify: Claude reads the evidence file before it is committed; it holds counts only
- [ ] 39.3 Findings:
  - `RequestTimeout` is adjusted if the measured reads call for it;
  - ADR-0001 gets a dated amendment: D2's explicit header form and fixed header set; pending transactions confirmed, with Check 2's field counts; the recent window of 31 days; the read durations.

  Verify: the amendment links the evidence file; `appsettings.json` and design.md D4 agree on the timeout

## 40. [wiring] Deployment

- [x] 40.1 Rebase onto `main` (C4 merged and deployed, 2026-11-07; the branch is based on dce448d, `main` is past #19–#23). Expected conflicts, from C4's handover (design.md D8):
  - `docs/software-factory/lessons.md` (#20's R-45, C4's R-46 to R-50): keep everything; C5's R-44 stays, its second lesson is R-51;
  - `pm/progress.md` (#19, #20, C4's row and change-log rows): keep both sides, C5 edits only its own row;
  - `openspec/config.yaml` (#19 or #20): keep both.

  Verify: the build and the full suite are green on the rebased branch
- [ ] 40.2 Bicep, in `infra/features.bicep` § "The bank (C5)": four Container Apps secrets referencing the Key Vault secrets `EnableBanking--ApplicationId`, `--PrivateKey`, `--SessionId`, `--AccountId` (already in `kv-revolutreader`, put there 2026-11-06 by docs/operations/deployment.md § Guided task), read with the app's identity, exposed as the `EnableBanking__*` environment variables (names in c005 design.md D15). `platform.bicep` outputs `keyVault.properties.vaultUri`, and `main.bicep` passes it to `features.bicep`. Verify: `az bicep lint --file infra/main.bicep` has no warning (any warning fails CI); the read-only preview in deployment.md runs and shows only these changes
- [ ] 40.3 The PR check `image-and-infra` starts the image with made-up values for the four settings and a real throwaway RSA key: C5's start-up validation must accept them, and C5 adds no required setting without a value in `appsettings.json`. Verify: the check passes on the PR
- [ ] 40.4 After the merge (the owner's go, outside the PR): the deploy is the first real start with the secrets. Verify: the app is running; if it stops at start, its log through deployment.md § Checks' query

## 41. [close] Acceptance green

- [ ] 41.1 All 13 acceptance tests, the telemetry guard, the traceability check and the full suite pass. Verify: green
- [ ] 41.2 CLAUDE.md § Commands: the commands for Check 1 and Check 2; the "exit code 8" note rewritten (no test project is empty any more). Verify: each command was run once
- [ ] 41.3 pm/progress.md:
  - the C5 row: outcome, deviations and follow-ups. The follow-ups are the balance-versus-app comparison moved to C7, the `entry_reference` question for C9, and the heads-ups for C7 from design.md D3;
  - the Q6 outcome's impact line points to ADR-0001's amendment.

  Verify: the row links the change folder

## Workflow follow-up

- Open the PR `feat: add Enable Banking adapter (C5)` after the user's go; squash merge after review.
- `/opsx:archive c004-add-enable-banking-adapter` (main spec `bank-reads`).
