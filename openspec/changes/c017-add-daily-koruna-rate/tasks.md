# Tasks: c017-add-daily-koruna-rate

Before this list comes design.md § Bootstrap, committed as `[setup]`: the CNB's captured answer saved as the fake's base. No package. Then the baseline, which holds one known exception, accepted once: the traceability check reports this change's 7 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c017-add-daily-koruna-rate` (GitHub issue #39, no roadmap step; the owner picks the review mode at the start). There are 12 scenarios, all API acceptance tests (design.md § How each scenario is verified): 7 new in `koruna-rate`, and 5 modified in `account-balance`, `account-transactions` and `account-check` that now name the CNB's rate. The work is sliced per scenario:

- slice 1 builds the whole happy path: the CNB client, the kept rate's store and table, the service and the fake CNB;
- slice 2 moves the transaction pages and removes the constant;
- slices 4–10 are the rules of `koruna-rate`.

Two slices are expected green on arrival, each accepted as a guard and proven by a mutation at its `[close]`. Slice 3 (the account check) follows from slice 1, because the check reads through `ReadBalanceHandler`. Slice 5 (the weekend) follows from slice 4, because the rule is one function.

- Docs tasks are the orchestrator's; "Guided" tasks need the owner.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check` (the frontend does not change; they prove it). Exception: this change's acceptance tests that are still red stay red until their slice.
- **A mutation** (a guard slice's `[close]`): the orchestrator breaks the slice's rule in the production code by hand, runs the scenario's test and sees it red, then restores the code with `git restore` and sees it green. Nothing of the mutation is committed; `.tdd-state.md` records what was broken and the red result.
- No UI changes, so no design artifact is read (design.md § Context).
- If the apply starts after the CNB publishes a rate newer than 24.47 for 2026-11-20, the bootstrap captures it, and the app's own rate, its scenario, design.md D5 and the proposal take it together (design.md D5).

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), the test kit of design.md D10 and § Public API sketch, the test-writer's:
  - `Drivers/FakeCnb` on `LoopbackWireMock`, its answers built from `Drivers/CnbDaily.json` with the euro's `rate` and `validFor` replaced; by default 25.125 for the clock's date when it starts; its `Configure` writes `Cnb:Address` and `Cnb:TimeLimit` (00:00:02) for every app copy, next to `FakeBank.Configure`;
  - `Drivers/RateDriver`, `Dsl/RateDsl` as `AcceptanceTest.Rate`;
  - `ScenarioCalendar.TodayIsAt`, and `TransactionsReading.RateDateAsAnswered` (outside the reading's equality);
  - `Drivers/AzuriteStorage.Configure` also sets `KorunaRates:TableName` to a table of the app copy's own;
  - stubs throw `NotImplementedException`.

  Verify: the build passes; every acceptance test that was green stays green (the extra settings are ignored until slice 1 declares them)
- [x] 1.2 Acceptance: account-balance / The balance comes with the time it was read and the koruna rate (modified: the CNB's rate 24.38)
- [x] 1.3 Acceptance: account-transactions / The newest transactions come live with the koruna rate (modified: the CNB's 24.38 for 2026-11-19)
- [x] 1.4 Acceptance: account-check / Money out is notified with the new balance (modified: the CNB's 24.6, "≈ 1 112 Kč")
- [x] 1.5 Acceptance: account-check / Money in is notified with the new balance (modified: the CNB's 24.6, "≈ 3 572 Kč")
- [x] 1.6 Acceptance: account-check / The notification carries the new balance for the phone to keep (modified: `czkPerEur` 24.6)
- [x] 1.7 Acceptance: koruna-rate / Monday's rate replaces Friday's and is not asked for again that day
- [x] 1.8 Acceptance: koruna-rate / A rate for an earlier day than the kept one is ignored
- [x] 1.9 Acceptance: koruna-rate / Friday's rate is not asked for again over the weekend
- [x] 1.10 Acceptance: koruna-rate / From 08:00 UTC on Monday every request asks until Monday's rate comes
- [x] 1.11 Acceptance: koruna-rate / A CNB that answers with an error leaves the kept rate
- [x] 1.12 Acceptance: koruna-rate / A CNB that does not answer within 2 s leaves the kept rate
- [x] 1.13 Acceptance: koruna-rate / With no rate kept and the CNB failing, the app's own rate of 24.47 is answered

## 2. [unit] Slice 1 — The rate value and when one is due

- [x] 2.1 The app's own rate is 24.47 CZK per euro for 2026-11-20 (replaces `KorunaRateTests`)
- [x] 2.2 With nothing kept, a rate is due

## 3. [unit] Slice 1 — KorunaRates, the happy path

- [x] 3.1 With nothing kept, the CNB is asked and its rate is answered
- [x] 3.2 A rate the CNB answers with nothing kept is saved in the store
- [x] 3.3 The kept rate is read from the store once per instance, on the first call
- [x] 3.4 A rate kept in the store and not due is answered without asking the CNB

## 4. [unit] Slice 1 — The balance carries the rate

- [x] 4.1 The balance carries the rate `IKorunaRates` answers
- [x] 4.2 The rate is asked before the bank answers, so the two run alongside (a held bank read, the fake rates recording when it was asked)
- [x] 4.3 A bank failure still comes back as its case, with the rate awaited

## 5. [integration] Slice 1 — IKorunaRateStore

- [ ] 5.1 Nothing saved reads as nothing
- [ ] 5.2 A saved rate reads back exactly: the decimal with its scale, the date to the day
- [ ] 5.3 A save replaces the kept rate
- [ ] 5.4 The table is created when missing (Table adapter); a row it cannot read is an `InvalidOperationException` naming the column, never its value (adapter edge case)

## 6. [wiring] Slice 1 — The CNB client, the store and the settings

- [ ] 6.1 `Rate/`: `KorunaRate` (with `AppsOwn`), `RateAsking.IsDue`, `ICnbRates` with `CnbAnswer`, `CnbFailed`, `CnbFailure`, `CnbClient` reading the happy path of design.md D6 (`rate / amount`, `validFor`), `CnbOptions`, `KorunaRates` (D2, D4; no failures yet), `RateRegistration.AddKorunaRates` (the named client `cnb`: base address, `Timeout`, the factory's loggers removed, no handlers; singletons, D9). Verify: groups 2–4 green; an edge test against WireMock shows an amount of 100 divided
- [ ] 6.2 `Storage/`: `KorunaRateStoreOptions`, `TableKorunaRateStore` (D2: partition `rate`, row `eur`, `CzkPerEur` as an invariant decimal string, `Date` as `yyyy-MM-dd`, `TableCreation`), `AddKorunaRateStore`; `InMemoryKorunaRateStore` in the unit tests, linked into the integration project. Verify: group 5 green against both
- [ ] 6.3 `Program.cs` registers `AddKorunaRateStore` after `AddTransactionStore` and `AddKorunaRates`; `appsettings.json` declares `Cnb` (`Address` `https://api.cnb.cz`, `TimeLimit` `00:00:02`) and `KorunaRates` (`TableName` `korunarates`), each line saying where its production and local values come from; the integration tests' `MadeUpSettings` point `Cnb:Address` at an unreached loopback port. Verify: the app copies start; the options reject a missing address and a limit outside 1 ms to 10 s at start
- [ ] 6.4 `ReadBalanceHandler` takes `IKorunaRates` (D8). Verify: group 4 green
- [ ] 6.5 Update infra Bicep + `.bicepparam`: `infra/platform.bicep` gains the `korunarates` table next to `checkedbalances`, under the existing table role; no `features.bicep`, `main.bicep` or `.bicepparam` change. Verify: `az bicep lint --file infra/main.bicep` clean
- [ ] 6.6 `FakeCnb.AnswerRate`, `RateDsl.TheCnbsLatestRateIs` (both forms) and `RequestsTheCnbReceived`. Verify: the scenario's test reaches the fake, never `api.cnb.cz`

## 7. [close] Slice 1 — The balance comes with the time it was read and the koruna rate

- [ ] 7.1 The scenario's test passes. Verify: green, including account-balance / The balance comes with the time it was read and the koruna rate
- [ ] 7.2 Docs: ADR-0011-koruna-rate (template in docs/adr/README.md: the CNB as an outside service, its terms read 2026-11-21 and the owner's choice not to name it, design.md D1–D5, the alternatives); configuration.md § `appsettings.json` is the inventory (`Cnb`, `KorunaRates`); testing.md § Fake CNB (design.md D10) and its mirror in `.claude/rules/testing.md` where the fakes are listed. Verify: each names design.md

## 8. [unit] Slice 2 — The pages carry the rate and its day

- [ ] 8.1 The newest page carries the rate and the day `IKorunaRates` answers
- [ ] 8.2 The rate is asked before the bank answers the newest page
- [ ] 8.3 An older page carries the rate and the day `IKorunaRates` answers

## 9. [wiring] Slice 2 — The constant removed

- [ ] 9.1 `ReadNewestTransactionsHandler` and `ReadOlderTransactionsHandler` take `IKorunaRates` (D8); `Account/KorunaRate` (the static class) is removed. The test-writer replaces `KorunaRate.CzkPerEur` in `AccountCheckTests` and `CheckedBalancesTests` with a written-out rate, and the 24.3 in the handler tests with the fake rates' (D10). Verify: group 8 green; no `Account.KorunaRate` left (`dotnet build`)
- [ ] 9.2 `TransactionsReading.RateDate` becomes the scenario's date, shifted back by the calendar as the other dates are (D10). Verify: the C7b scenarios that read a page stay green

## 10. [close] Slice 2 — The newest transactions come live with the koruna rate

- [ ] 10.1 The scenario's test passes. Verify: green, including account-transactions / The newest transactions come live with the koruna rate; `openapi.json` and `schema.d.ts` unchanged

## 11. [close] Slice 3 — The account check's notification at the CNB's rate

- [ ] 11.1 The three account-check scenarios pass, as expected after slice 1 (the check reads through `ReadBalanceHandler`, design.md D8), and are proven by a mutation: with `ReadBalanceHandler` answering `KorunaRate.AppsOwn` instead of the service's rate, they fail. `Conventions/AccountCheckTelemetryTests` computes its koruna forms with the rate its app copy answers. Verify: green, including account-check / Money out is notified with the new balance, Money in is notified with the new balance and The notification carries the new balance for the phone to keep; the mutation's red result in `.tdd-state.md`

## 12. [unit] Slice 4 — When the CNB is asked again

- [ ] 12.1 After a Monday to Thursday, the next ask is from 08:00 UTC the next day
- [ ] 12.2 After a Friday, a Saturday or a Sunday, the next ask is from 08:00 UTC on Monday
- [ ] 12.3 A kept rate is not due one tick before 08:00 UTC and is due at 08:00 UTC
- [ ] 12.4 A rate for a later day than the kept one replaces it, in memory and in the store, and is logged once as kept (`KorunaRateKept`, with the rate and its day)
- [ ] 12.5 After a rate for today is kept, the CNB is not asked again before the next weekday's 08:00 UTC

## 13. [wiring] Slice 4 — A scenario on a named weekday

- [ ] 13.1 `RateAsking.NextAskFrom`; `ScenarioCalendar.TodayIsAt` (the coming day of the same weekday at the given UTC time, after signing in); `RateDsl.TodayIs` and `TheKeptRateIs` through the app copy's own `IKorunaRateStore` (D10); `RateLog`. Verify: group 12 green; a harness self-test shows the calendar's Monday lands on a Monday

## 14. [close] Slice 4 — Monday's rate replaces Friday's and is not asked for again that day

- [ ] 14.1 The scenario's test passes. Verify: green, including koruna-rate / Monday's rate replaces Friday's and is not asked for again that day
- [ ] 14.2 Docs: testing.md § Time and the background job: the weekday step and why the calendar needs it (design.md D10). Verify: it names `ScenarioCalendar.TodayIsAt`

## 15. [close] Slice 5 — Friday's rate is not asked for again over the weekend

- [ ] 15.1 The scenario's test passes, as expected after slice 4, and is proven by a mutation: with `NextAskFrom` taking the next calendar day instead of the next weekday, it fails. Verify: green, including koruna-rate / Friday's rate is not asked for again over the weekend; the mutation's red result in `.tdd-state.md`

## 16. [unit] Slice 6 — Every request asks until a newer day's rate comes

- [ ] 16.1 A rate for the kept day changes nothing: nothing is saved and nothing logged, and the next call asks again
- [ ] 16.2 Callers at the same time share one ask (a held answer, two callers, one call to the CNB)
- [ ] 16.3 A caller that stops waiting leaves the ask, and its answer, to the other callers
- [ ] 16.4 An ask that has ended is not shared: the next caller asks anew while the rate is due

## 17. [close] Slice 6 — From 08:00 UTC on Monday every request asks until Monday's rate comes

- [ ] 17.1 The scenario's test passes. Verify: green, including koruna-rate / From 08:00 UTC on Monday every request asks until Monday's rate comes

## 18. [unit] Slice 7 — An earlier day's rate

- [ ] 18.1 A rate for an earlier day than the kept one is answered as the kept one, with nothing saved and nothing logged

## 19. [close] Slice 7 — A rate for an earlier day than the kept one is ignored

- [ ] 19.1 The scenario's test passes. Verify: green, including koruna-rate / A rate for an earlier day than the kept one is ignored

## 20. [unit] Slice 8 — A failed ask, a failing store

- [ ] 20.1 A failed ask answers the kept rate and logs its kind once (`KorunaRateAskFailed`), with the status code for a status
- [ ] 20.2 A store that fails to read is treated as nothing kept, logged (`KorunaRateStoreFailed`), and read again by the next call
- [ ] 20.3 A store that fails to save still answers the new rate, holds it, and logs it (`KorunaRateStoreFailed`)

## 21. [wiring] Slice 8 — The CNB's failures

- [ ] 21.1 `CnbClient`'s failures of design.md D6, as edge tests against WireMock: a 500 and a 404 are `Status` with their code; not JSON, no `rates`, no `EUR` entry, a rate or amount of zero or below, a missing or malformed `validFor` are `Unreadable`; a refused connection is `Unreachable`. `KorunaRates` handles `CnbFailed` (D5). `FakeCnb.AnswerServerError`, `RateDsl.TheCnbAnswersAServerError`. Verify: group 20 green; the edge tests green

## 22. [close] Slice 8 — A CNB that answers with an error leaves the kept rate

- [ ] 22.1 The scenario's test passes. Verify: green, including koruna-rate / A CNB that answers with an error leaves the kept rate

## 23. [wiring] Slice 9 — The time limit

- [ ] 23.1 `CnbClient`: an answer later than `Cnb:TimeLimit` is `NoAnswerInTime`, and a caller's cancellation passes on as `OperationCanceledException`, as edge tests against WireMock with a short limit. `FakeCnb.AnswerNeverInTime`, `RateDsl.TheCnbDoesNotAnswerInTime`. Verify: the edge tests green

## 24. [close] Slice 9 — A CNB that does not answer within 2 s leaves the kept rate

- [ ] 24.1 The scenario's test passes. Verify: green, including koruna-rate / A CNB that does not answer within 2 s leaves the kept rate

## 25. [unit] Slice 10 — Nothing kept

- [ ] 25.1 With nothing kept and a failed ask, the app's own rate is answered and not saved, and the next call asks again

## 26. [wiring] Slice 10 — The app's own rate's date

- [ ] 26.1 `RateDsl.NoRateIsKept` (reads the app copy's store and throws when a rate is kept); the scenario compares the date through `TransactionsReading.RateDateAsAnswered` (D10). Verify: group 25 green

## 27. [close] Slice 10 — With no rate kept and the CNB failing, the app's own rate of 24.47 is answered

- [ ] 27.1 The scenario's test passes. Verify: green, including koruna-rate / With no rate kept and the CNB failing, the app's own rate of 24.47 is answered

## 28. [unit] Guards

- [ ] 28.1 An ask that keeps a new rate writes one `KorunaRateKept` line and no line of the HTTP client factory's own (`Conventions/KorunaRateTelemetryTests`, read from the app copy's captured log lines, `Drivers/CapturedLogEvents`; design.md D7, D12), proven by a mutation: with the factory's loggers left on the named client, it fails

## 29. [wiring] Deployment

- [ ] 29.1 The read-only preview (deployment.md § Previewing a change to the Bicep, with the owner's login). Verify: it shows exactly the new table
- [ ] 29.2 Docs: deployment.md § The koruna rate (c017): the table, what to look at after the deploy (design.md § Migration plan, step 2), and a read-only query of `KorunaRateKept` and `KorunaRateAskFailed` per day. Verify: the query runs read-only against the workspace (no rows before the deploy)

## 30. [close] Acceptance green

- [ ] 30.1 All 12 acceptance tests of this change pass and the full suite is green; the traceability check passes; `dotnet format whitespace --verify-no-changes` and the frontend checks are clean; `az bicep lint` is clean; `openapi.json` and `schema.d.ts` unchanged
- [ ] 30.2 Local check with `aspire start --isolated` (from the worktree; the Mock ASPSP and the real CNB): the account screen opens, the transaction sheet shows "orientační kurz z" with the CNB's latest day, and the app's lines show one `KorunaRateKept` and no `KorunaRateAskFailed`. Verify: the owner sees each
- [ ] 30.3 Docs: the software-factory lesson R-98, the divergence R-98 and the inventory's rows (the scenario calendar's weekday step, the fake CNB) of design.md D11 (R-98 follows c016's R-95 to R-97, D12). Verify: each names the decision it records
- [ ] 30.4 `CLAUDE.md` checked against every command this change touched (none expected); no `pm/progress.md` row (design.md D11). Verify: `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `feat: add the daily koruna rate`, closing #39, on the owner's go. If `main` has moved on, merge it first.
- The owner runs `/code-review xhigh --comment` on the PR; `/triage-review <PR>` works through the findings.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it.
- After the merge (design.md § Migration plan, step 2): the deploy, then routine checks with no PR. Open the app: the sheet shows the CNB's latest day, and Application Insights holds `KorunaRateKept` and no `KorunaRateAskFailed`.
