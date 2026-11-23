# Tasks: c018-add-approximate-payment-time

Before this list comes design.md § Bootstrap, committed as `[setup]`: the spike's two scripts and the counts-only evidence copied from the session's scratchpad. No package. Then the baseline, which holds one known exception, accepted once: the traceability check reports this change's 13 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c018-add-approximate-payment-time` (GitHub issue #85, no roadmap step; the owner picks the review mode at the start). There are 15 scenarios (design.md § How each scenario is verified):

- **12 API acceptance tests:** 6 new in `account-transactions`; 4 new and 2 modified in `account-check`.
- **3 frontend scenario tests** in `account-transactions`, in `Europe/Prague`.

The work is sliced per scenario. Slice 1 builds the whole happy path: the rule, the store and its table, the newest page's field, the TS client, and the page check that accepts it.

Four slices are expected green on arrival, each accepted as a guard and proven by a mutation at its `[close]`:

- **Slice 3** (settlement) follows from the key, the reference.
- **Slice 10** (the check keeps nothing) follows from slice 7, whose handler never keeps.
- **Slice 12** (the burst) follows from slice 7, which awaits the recording within the check.
- **Slice 15** (the details after midnight) follows from slice 14, if its `Datum` already takes the transaction's day.

Suggested chapters, which `/tdd-apply` confirms at the acceptance gate:

- **Chapter A:** group 1 alone.
- **Chapter B:** slices 1–6, the first-seen time on the pages (the rule, the store, both page handlers).
- **Chapter C:** slices 7–12, the account check (`RecordFirstSeenHandler`, `AccountCheck`, the check's kit).
- **Chapter D:** slices 13–15, the phone (`transactionDay`, the list, the sheet).

Conventions for the run:

- Docs tasks are the orchestrator's.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite; it holds the traceability check), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Exception: this change's acceptance tests that are still red stay red until their slice.
- **A mutation** (a guard slice's `[close]`): the orchestrator breaks the slice's rule in the production code by hand, runs the scenario's test and sees it red, then restores the code with `git restore` and sees it green. Nothing of the mutation is committed; `.tdd-state.md` records what was broken and the red result.
- **UI slices (13–15):** the orchestrator hands the implementer the design files saved from the artifacts (design.md D7; `/tdd-apply` § 0). They are the design system's `tx.ts` and the TransactionSheet, DayHeader and ListEnd READMEs at 1795426018-f0a0, and the Screens' `sample-data.js` and `account-sheet-a.dc.html` at 1795426267-94e6. Read them again by link if a newer version exists.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), the test kit of design.md D10 and § Public API sketch, the test-writer's:
  - `TransactionsDsl.TodayIsAt` and `TimeIs`, `ScenarioCalendar.TimeIs` and `FromClock(DateTimeOffset)`;
  - `TransactionSeenInApi.SeenAt` and the factories' `seenAt`;
  - the driver reads `seenAt` (an instant at offset zero with whole seconds, or null, shifted back by the calendar); for now a transaction without the member reads as null, so seven members still pass;
  - `BankDsl.ReportsOwnErrorForTransactions` and `TransactionsRequestsReceived` (`FakeBank.AnswerTransactionsWithOwnError`, `BankDriver`);
  - `AzuriteStorage.Configure` also sets `FirstSeenTimes:TableName` to a table of the app copy's own;
  - stubs throw `NotImplementedException`.

  Verify: the build passes; every acceptance test that was green stays green
- [x] 1.2 Foundation (frontend): `inTimeZoneWhile` in `src/test/timeZone.ts` (design.md § Public API sketch), with its own test next to it. Verify: its test passes; the frontend checks are clean
- [x] 1.3 Acceptance: account-transactions / A transaction first read on its own day carries the time it was first read
- [x] 1.4 Acceptance: account-transactions / A later read keeps the first time
- [x] 1.5 Acceptance: account-transactions / The time stays when the payment settles
- [x] 1.6 Acceptance: account-transactions / A transaction first read after its own day carries no time
- [x] 1.7 Acceptance: account-transactions / A transaction without the bank's reference carries no time
- [x] 1.8 Acceptance: account-transactions / A kept transaction on an older page carries its time
- [x] 1.9 Acceptance: account-check / The bank sees the phone's address and browser name (modified: a balance request and a transactions request, each with the phone's headers)
- [x] 1.10 Acceptance: account-check / The check reads the transactions from yesterday on
- [x] 1.11 Acceptance: account-check / A payment a check reads first carries the check's time
- [x] 1.12 Acceptance: account-check / Transactions a check reads are not kept
- [x] 1.13 Acceptance: account-check / A failed transactions read leaves the check's notification and answer as they were
- [x] 1.14 Acceptance: account-check / A burst of checks sends one notification and reads the bank at most twice (modified: two balance requests and two transactions requests)
- [x] 1.15 Acceptance: account-transactions / A payment seen after midnight is listed under the next day (frontend)
- [x] 1.16 Acceptance: account-transactions / The details show the approximate time after the date (frontend)
- [x] 1.17 Acceptance: account-transactions / The details of a payment seen after midnight show the next day (frontend)

## 2. [unit] Slice 1 — The first-seen rule, the happy path

- [x] 2.1 The moment a read got its answer is the clock at offset zero, cut to the whole second
- [x] 2.2 A read records a pending transaction with a reference dated the read's UTC day, at the read's moment
- [x] 2.3 A kept moment on the transaction's own UTC day is answered

## 3. [unit] Slice 1 — The newest page carries the first-seen time

- [x] 3.1 The newest page's transaction carries the moment its first read recorded (`InMemoryFirstSeenStore`)
- [x] 3.2 The moment is the clock after the bank's answer, not before the read (a held bank fake, the clock moved while it is held)
- [x] 3.3 A bank failure records nothing
- [x] 3.4 A first-seen store failure throws, and the page is not answered (design.md D8)

## 4. [integration] Slice 1 — IFirstSeenStore

- [x] 4.1 A reference never recorded reads as absent
- [x] 4.2 A recorded moment reads back exactly, in UTC, to the second, and `Record` answers it
- [x] 4.3 Only the references asked for are answered
- [x] 4.4 A reference with `/ \ # ?` and `%` in it is recorded and read back
- [x] 4.5 Nothing to read or record sends no request (the fake's counts; the adapter's own test)
- [x] 4.6 The table is created when missing (Table adapter); a row it cannot read is an `InvalidOperationException` naming the column, never its value (adapter edge case, `Wiring/Storage`)

## 5. [wiring] Slice 1 — The store, the field and the contract

- [x] 5.1 `Account/`:
  - `FirstSeen`, `FirstSeenRule`, `IFirstSeenStore`, `FirstSeenTimes` (design.md D1–D3);
  - `ShownTransaction.SeenAt` and `TransactionResponse.SeenAt` with its description (D4);
  - `ReadNewestTransactionsHandler` takes `FirstSeenTimes`;
  - `TransactionsRegistration` registers `FirstSeenTimes`, scoped (D9).

  Verify: groups 2 and 3 green
- [x] 5.2 `Storage/`: `FirstSeenStoreOptions` (section `FirstSeenTimes`), `TableFirstSeenStore` (D3: partition `account`, the SHA-256 row key, `SeenAt`, `TableCreation`, the insert), `AddFirstSeenStore`; `InMemoryFirstSeenStore` in the unit tests, linked into the integration project. Verify: group 4 green against both
- [x] 5.3 `Program.cs` calls `AddFirstSeenStore` after `AddKorunaRateStore`; `appsettings.json` declares `FirstSeenTimes:TableName` `firstseentimes`, commented as `KorunaRates`. Verify: the app copies start; a table name Table Storage refuses stops the app at start
- [x] 5.4 Update infra Bicep + `.bicepparam`: `infra/platform.bicep` gains the `firstseentimes` table next to `korunarates`, commented as it is, under the existing table role; no `features.bicep`, `main.bicep` or `.bicepparam` change. Verify: `az bicep lint --file infra/main.bicep` clean
- [x] 5.5 Regenerate the TS client: `npm --prefix tools/api-client run regenerate`, then commit `openapi.json` and `schema.d.ts`. Verify: `seenAt` (nullable, `date-time`) on `TransactionResponse`; CI's drift check would pass
- [x] 5.6 Every TS consumer of the changed contract:
  - `transactionOf` accepts `seenAt` as text or null, with exactly eight members (D6);
  - the frontend tests' answers gain `seenAt: null`, by the test-writer: a unit test, "a page whose transaction's `seenAt` is a number is unexpected", written first.

  Verify: the frontend suite, `lint` and `typecheck` green
- [x] 5.7 `TransactionsDriver` now wants exactly eight members per transaction, `seenAt` among them (the implementer's driver edit in wiring). Verify: every acceptance test that reads a page stays green

## 6. [close] Slice 1 — A transaction first read on its own day carries the time it was first read

- [ ] 6.1 The scenario's test passes. Verify: green, including account-transactions / A transaction first read on its own day carries the time it was first read
- [ ] 6.2 Docs:
  - `configuration.md` § `appsettings.json` is the inventory (`FirstSeenTimes`);
  - `testing.md` (the calendar's time of day, `seenAt` in the DSL, the app copy's own `FirstSeenTimes` table) and its mirror in `.claude/rules/testing.md`;
  - `deployment.md`'s storage account row (the `firstseentimes` table: hashes of references and moments, no bank text; dropping it loses only the times).

  Verify: each names design.md

## 7. [unit] Slice 2 — The first time stays

- [ ] 7.1 `FirstSeenTimes` reads the read's references, and records only those with no moment yet
- [ ] 7.2 `FirstSeenTimes` answers the kept moments and the newly recorded ones together

## 8. [integration] Slice 2 — IFirstSeenStore keeps the earliest

- [ ] 8.1 Recording a later moment keeps the earlier one, and `Record` answers the earlier one
- [ ] 8.2 Recording an earlier moment replaces a later one
- [ ] 8.3 Recording the same sighting twice changes nothing
- [ ] 8.4 Two `Record` calls at once for one reference keep the earlier moment (the ETag race; an adapter edge case against Azurite in `Wiring/Storage`, its in-memory form in the contract)

## 9. [wiring] Slice 2 — The conflict path

- [ ] 9.1 `TableFirstSeenStore.Record`: on a conflict, read the row; replace it under its ETag only when the kept moment is later; on a lost race, try again (D3). Verify: groups 7 and 8 green against both

## 10. [close] Slice 2 — A later read keeps the first time

- [ ] 10.1 The scenario's test passes. Verify: green, including account-transactions / A later read keeps the first time

## 11. [close] Slice 3 — The time stays when the payment settles

- [ ] 11.1 The scenario's test passes, as expected after slice 1 (the key is the reference, D1), and is proven by a mutation: with `FirstSeenRule.Sightings` leaving out pending transactions, it fails. Verify: green, including account-transactions / The time stays when the payment settles; the mutation's red result in `.tdd-state.md`
- [ ] 11.2 Docs:
  - **ADR-0001 § Transaction history**, dated notes (design.md D11): at Check 2's heads-up, the pending reference survives settlement (counts, the evidence linked); at the Enable Banking bullet, on Revolut the ID survives, and the app matches pending ones only for their first-seen time.
  - **`spikes/enable-banking/README.md`**, step 9 with its scripts, finding and verdict line (D11).

  Verify: the notes link `evidence/2026-11-22-pending-settlement.json`; no bank data in any of them

## 12. [unit] Slice 4 — Only on the transaction's own day

- [ ] 12.1 A read records no transaction dated before the read's UTC day
- [ ] 12.2 A kept moment whose UTC date is not the transaction's date is answered as none
- [ ] 12.3 With no kept moment, none is answered

## 13. [wiring] Slice 4 — The rule in both directions

- [ ] 13.1 `FirstSeenRule.Sightings` filters by the read's UTC date and `Shown` compares the UTC date (D2), both handlers answering through `Shown`. Verify: group 12 green

## 14. [close] Slice 4 — A transaction first read after its own day carries no time

- [ ] 14.1 The scenario's test passes. Verify: green, including account-transactions / A transaction first read after its own day carries no time
- [ ] 14.2 Docs: ADR-0001, a dated note that the bank's dates are UTC dates (the owner's midnight sample in words only: no amount, name or exact date), confirming the app's UTC today (c010 D3). Verify: no bank data in it

## 15. [unit] Slice 5 — No reference, no time

- [ ] 15.1 A read records no transaction without a reference
- [ ] 15.2 A reference listed twice in one read is recorded once

## 16. [wiring] Slice 5 — Sightings by reference

- [ ] 16.1 `FirstSeenRule.Sightings` skips a transaction without a reference and takes each reference once; the page asks the store for references only. Verify: group 15 green

## 17. [close] Slice 5 — A transaction without the bank's reference carries no time

- [ ] 17.1 The scenario's test passes. Verify: green, including account-transactions / A transaction without the bank's reference carries no time

## 18. [unit] Slice 6 — Older pages carry the time

- [ ] 18.1 An older page's transaction carries the moment kept for its reference, through `FirstSeenRule.Shown`
- [ ] 18.2 An older page reads the first-seen store once, for its own transactions' references
- [ ] 18.3 A first-seen store failure on an older page throws (design.md D8)

## 19. [wiring] Slice 6 — The older handler

- [ ] 19.1 `ReadOlderTransactionsHandler` takes `IFirstSeenStore` and reads it once the page is cut (D9). Verify: group 18 green

## 20. [close] Slice 6 — A kept transaction on an older page carries its time

- [ ] 20.1 The scenario's test passes. Verify: green, including account-transactions / A kept transaction on an older page carries its time

## 21. [unit] Slice 7 — The check reads the transactions as the phone

- [ ] 21.1 `RecordFirstSeenHandler` reads the transactions as the present user it is given
- [ ] 21.2 `AccountCheck` starts the recording after reading the kept balances and before the balance read answers, so the two run alongside (a held bank fake)
- [ ] 21.3 `AccountCheck` ends only once the recording has ended, also when its balance path throws
- [ ] 21.4 A storage failure of the kept balances reads nothing at the bank, the transactions included

## 22. [wiring] Slice 7 — The recorder in the check

- [ ] 22.1 `Check/RecordFirstSeenHandler` (reading, for now, from the clock's today); `AccountCheck` takes it (D5); `AccountCheckRegistration` registers it, scoped. Verify: group 21 green; the existing check scenarios stay green (the burst and the leaving caller hold the balance answer only)
- [ ] 22.2 `BankDsl.TransactionsRequestsReceived` and the drivers it needs, if group 1's stubs left any. Verify: the scenario's test reaches the fake bank's transactions path

## 23. [close] Slice 7 — The bank sees the phone's address and browser name

- [ ] 23.1 The scenario's test passes. Verify: green, including account-check / The bank sees the phone's address and browser name
- [ ] 23.2 Docs:
  - **ADR-0001 item 6**, a dated note: since c018 the check reads the transactions from yesterday on, only for first-seen times, and keeps none (D11);
  - **ADR-0008 Decision item 1**, a dated note on what the check reads.

  Verify: each names c018 design.md D5

## 24. [unit] Slice 8 — From yesterday on

- [ ] 24.1 The check's transactions read starts at the UTC day before the clock's today
- [ ] 24.2 Just after UTC midnight, the read starts at the day that has just ended

## 25. [wiring] Slice 8 — The from-date

- [ ] 25.1 `RecordFirstSeenHandler` reads from yesterday (D5). Verify: group 24 green

## 26. [close] Slice 8 — The check reads the transactions from yesterday on

- [ ] 26.1 The scenario's test passes. Verify: green, including account-check / The check reads the transactions from yesterday on

## 27. [unit] Slice 9 — The check records first sightings

- [ ] 27.1 The check records the read's sightings through `FirstSeenTimes`, at the clock's moment after the bank's answer
- [ ] 27.2 A transaction the check already timed keeps its moment when the check reads it again

## 28. [wiring] Slice 9 — Recording in the check

- [ ] 28.1 `RecordFirstSeenHandler` records through `FirstSeenTimes.Record` (D5). Verify: group 27 green

## 29. [close] Slice 9 — A payment a check reads first carries the check's time

- [ ] 29.1 The scenario's test passes. Verify: green, including account-check / A payment a check reads first carries the check's time

## 30. [close] Slice 10 — Transactions a check reads are not kept

- [ ] 30.1 The scenario's test passes, as expected after slice 7 (the recorder never keeps, D5), and is proven by a mutation: with `RecordFirstSeenHandler` also keeping the read's settled transactions through `ITransactionStore`, it fails. Verify: green, including account-check / Transactions a check reads are not kept; the mutation's red result in `.tdd-state.md`

## 31. [unit] Slice 11 — A failed transactions read changes nothing

- [ ] 31.1 A bank failure of the transactions read logs `FirstSeenNotRecorded` with its kind, records nothing and returns normally (each of the three kinds)
- [ ] 31.2 An exception in the recording (the store) logs `FirstSeenNotRecorded` as `Failed`, with the exception, and returns normally
- [ ] 31.3 The app's stop passes as a cancellation
- [ ] 31.4 With the recording failing, `AccountCheck` notifies and answers exactly as its balance read decides

## 32. [wiring] Slice 11 — The failure path and its log

- [ ] 32.1 `RecordFirstSeenHandler`'s failure handling, `FirstSeenFailure` and the two forms of `CheckLog.FirstSeenNotRecorded` (D5). Verify: group 31 green
- [ ] 32.2 `Conventions/AccountCheckTelemetryTests`: a failed transactions read writes one `FirstSeenNotRecorded` (Warning) with its kind and no amount, name or reference; `BankTelemetryTests` counts two bank dependencies per check. Verify: green, and a mutation (the kind left out of the line) shows it red

## 33. [close] Slice 11 — A failed transactions read leaves the check's notification and answer as they were

- [ ] 33.1 The scenario's test passes. Verify: green, including account-check / A failed transactions read leaves the check's notification and answer as they were
- [ ] 33.2 Docs:
  - **`deployment.md`**, the account check's log section: `FirstSeenNotRecorded` (Warning) with its kinds, and what each means (D5);
  - **`testing.md`**: `ReportsOwnErrorForTransactions`.

  Verify: each names design.md

## 34. [close] Slice 12 — A burst of checks sends one notification and reads the bank at most twice

- [ ] 34.1 The scenario's test passes, as expected after slice 7 (the recording is awaited within the check, D5), and is proven by a mutation: with `AccountCheck` skipping the recording when another check waits behind it, it fails. Verify: green, including account-check / A burst of checks sends one notification and reads the bank at most twice; the mutation's red result in `.tdd-state.md`
- [ ] 34.2 Docs: ADR-0008, a dated note at the constraint "safe to call more than once": a burst still runs at most two checks, now with two requests each. Verify: it names c018 design.md D5

## 35. [unit] Slice 13 — The transaction's day and the list

- [ ] 35.1 `approxTime` gives `seenAt` as a date, and none when it is null or does not parse
- [ ] 35.2 `transactionDay` is the local date of the time when there is one, else `date`; in Prague, 2026-11-14 23:20:00 UTC is 2026-11-15, and in Los Angeles it is 2026-11-14
- [ ] 35.3 `byDay` groups by `transactionDay`, newest day first
- [ ] 35.4 Within a day, newer dates come first, each date's transactions in the order given
- [ ] 35.5 A day's totals count the transactions moved into it, and not those moved out
- [ ] 35.6 A newest page read again replaces the newest transactions and keeps the older pages' transactions dated before its `olderBefore`
- [ ] 35.7 An older page whose transaction moves into a day already shown gives that day one heading

## 36. [wiring] Slice 13 — Regrouping all loaded

- [ ] 36.1 `src/app/transactionDay.ts`; `byDay` and `ListState` with `newest` and `olderLoaded` (D6); `useTransactionList` and `TransactionList` on the new state. Verify: group 35 green; the existing list scenarios stay green

## 37. [close] Slice 13 — A payment seen after midnight is listed under the next day

- [ ] 37.1 The scenario's test passes. Verify: green, including account-transactions / A payment seen after midnight is listed under the next day
- [ ] 37.2 Docs: `testing.md`, the frontend's async time zone (`inTimeZoneWhile`). Verify: it names design.md D10

## 38. [unit] Slice 14 — The time in the sheet

- [ ] 38.1 `formatApproxTime` writes "kolem", a no-break space and `H:mm` in the phone's local time (`kolem 14:05`, `kolem 0:20`)
- [ ] 38.2 The sheet's `Datum` is the transaction's day followed by ", kolem" and the time when there is one
- [ ] 38.3 Without a time, `Datum` is the date alone, as before
- [ ] 38.4 The row and its spoken label show no time

## 39. [wiring] Slice 14 — The sheet's Datum

- [ ] 39.1 `formatApproxTime` in `format.ts`; `TransactionSheet`'s `Datum` (D6). Verify: group 38 green

## 40. [close] Slice 14 — The details show the approximate time after the date

- [ ] 40.1 The scenario's test passes. Verify: green, including account-transactions / The details show the approximate time after the date

## 41. [close] Slice 15 — The details of a payment seen after midnight show the next day

- [ ] 41.1 The scenario's test passes, as expected after slice 14 if `Datum` takes `transactionDay`, and is proven by a mutation: with `Datum` formatting `tx.date`, it fails. If it is red on arrival, the slice gets its own `[unit]` task (the sheet's `Datum` takes the transaction's day) and wiring. Verify: green, including account-transactions / The details of a payment seen after midnight show the next day; the mutation's red result in `.tdd-state.md`

## 42. [close] Acceptance green

- [ ] 42.1 All 15 scenario tests of this change pass and the full suite is green; the traceability check passes; `dotnet format whitespace --verify-no-changes` and the frontend checks are clean; `az bicep lint` is clean; `openapi.json` and `schema.d.ts` match the regeneration
- [ ] 42.2 Local check with `aspire start --isolated` (from the worktree; the Mock ASPSP), the owner looking:
  - the account screen opens;
  - a transaction dated today shows "…, kolem HH:MM" in its sheet;
  - the app's lines show no `FirstSeenNotRecorded`.

  Verify: the owner sees each
- [ ] 42.3 Docs (design.md D12): the owner's paste goes last.
  - **workflow.md § 8:** step 2's update prompt ends with "The design system's changes:" and `<paste the list>`; step 3's example reads "Apply the design system's changes. The list: <paste the list>"; one sentence states the rule for every prompt the owner fills in.
  - **`.claude/rules/design.md`** step 3: the list goes at the end.
  - **lessons.md R-7:** a bullet (New, 2026-11-23): pasted text goes last.
  - The handover inventory's rows stay as they are.

  Verify: no prompt in workflow.md § 8 has text after its paste placeholder
- [ ] 42.4 `CLAUDE.md` checked against every command this change touched (none expected); no `pm/progress.md` row (issue-only work). Verify: `CLAUDE.md`'s commands run as written

## Workflow follow-up

A change's path after its `[close]` commit (workflow.md § 6):

- The push and a draft PR `feat: add the approximate payment time`, closing #85, on the owner's go. If `main` has moved on, merge it first.
- The owner runs `/code-review xhigh --comment` on the PR; `/triage-review <PR>` works through the findings.
- Archive with `/opsx:archive` on the branch, before the merge. The traceability check must pass first.
- The owner marks the PR ready and squash-merges it.
- After the merge (design.md § Migration plan): the deploy, then a routine look with no PR. After a small card payment, the sheet shows "…, kolem HH:MM", and Application Insights holds no `FirstSeenNotRecorded`.
