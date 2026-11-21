# Tasks: c014-add-account-change-notifications

Before this list: design.md § Bootstrap. No package and no probe; the baseline holds one known exception, accepted once: the traceability check reports this change's 16 new scenarios as not claimed, until group 1 claims them.

Run with `/tdd-apply c014-add-account-change-notifications` (roadmap C9a; the owner picks the review mode at the start). There are 15 automated scenarios, all API acceptance tests, and one manual row (design.md § How each scenario is verified), so the work is sliced per scenario: slices 1–4 the endpoint and the first check, 5–10 the notification, 11–13 what is notified when, 14–15 bursts and the caller. Then the guards, deployment, the docs and a local check. C9b (`c015-store-pushed-balance`) runs alongside and shares no file (design.md D1).

- Docs tasks are the orchestrator's; "Guided" tasks need the owner.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Exception: this change's acceptance tests stay red until their slice.

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API), as design.md § Public API sketch and D16:
  - `Drivers/AccountCheckDriver` (its `Configure` writes `AccountCheck:Key`, a random key per test, for every app copy next to `FakeBank.Configure` and `FakePushService.Configure`), `Dsl/CheckDsl`, `Dsl/CheckAnswer` and `AcceptanceTest.Check`, as signatures whose methods throw `NotImplementedException`;
  - `Drivers/AzuriteStorage.Configure` also sets `CheckedBalances:TableName` to a table of the app copy's own;
  - the fake bank can hold a balance answer until released; the fake push service, the test device and `PushReceived` read `mutable` and `notification.data.balance` (the test-writer's, c011 D7), and `PushDsl` waits, bounded, for a push to reach a phone.

  Verify: build passes; every acceptance test that was green stays green (the app copies start with the made-up key once task 3.1 declares the setting; until then the extra setting is ignored); `push-sending / Every push lives 24 hours and is urgent` keeps its test unchanged
- [x] 1.2 Acceptance: account-check / A check without the right key gets the answer of an unknown address
- [x] 1.3 Acceptance: account-check / A check that names no browser reads nothing at the bank
- [x] 1.4 Acceptance: account-check / The first check sends nothing
- [x] 1.5 Acceptance: account-check / The bank sees the phone's address and browser name
- [x] 1.6 Acceptance: account-check / Money out is notified with the new balance
- [x] 1.7 Acceptance: account-check / Money in is notified with the new balance
- [x] 1.8 Acceptance: account-check / An unchanged balance sends nothing
- [x] 1.9 Acceptance: account-check / Every allowed account with a registered device gets the notification
- [x] 1.10 Acceptance: account-check / The notification carries the new balance for the phone to keep
- [x] 1.11 Acceptance: push-sending / The owner's message carries no balance
- [x] 1.12 Acceptance: account-check / A failed bank read sends nothing and answers as the balance does
- [x] 1.13 Acceptance: account-check / A change is not notified again after a device's push failed
- [x] 1.14 Acceptance: account-check / A check whose bank read fails still sends what an earlier check found
- [x] 1.15 Acceptance: account-check / A burst of checks sends one notification and reads the bank at most twice
- [x] 1.16 Acceptance: account-check / A check goes on when its caller stops waiting
- [x] 1.17 Acceptance: account-check / A real payment brings the notification on the iPhone (manual): the row in `tests/manual-scenarios.md` (why manual: only a real Revolut notification fires the Shortcut, and only Apple's push service and the lock screen show the result; first chance after C9a's deploy, on the owner's iPhone; again at M7), its date left empty

## 2. [unit] Slice 1 — The check's settings

- [x] 2.1 A check key of at least 32 bytes in base64url passes validation
- [x] 2.2 A check key still holding the placeholder fails validation, and the message names the setting only
- [x] 2.3 A check key shorter than 32 bytes, or not strict base64url, fails validation, naming the setting only

## 3. [wiring] Slice 1 — Settings, AppHost and the endpoint's key

- [x] 3.1 `appsettings.json` gains the `AccountCheck` section (`Key` `"<secret>"`, its provenance comment; design.md D6); `AccountCheckOptions` bound and validated on start in `AccountCheckRegistration.AddAccountCheck`, called in `Program.cs`. Verify: the app starts in every acceptance test; slice 1's unit tests green
- [x] 3.2 Every other place that starts the app gets a made-up check key: the OpenAPI export check, the CI image smoke run (`.github/workflows/ci.yml`, 32 random bytes per run), `CLAUDE.md`'s image quick start in both shells. Verify: the export check runs and `openapi.json` is unchanged; the smoke run's command run locally against `docker build` answers `/health`
- [x] 3.3 The AppHost's secret parameter `accountcheck-key`, handed to the API as `AccountCheck__Key` (design.md D6). Verify: build passes; the AppHost lists it (the laptop's value comes with task 42.1)
- [x] 3.4 `AccountCheckEndpoint` `POST /api/account/check`: anonymous, excluded from the description, binds nothing; `MessageKeyCheck.Matches` on `X-Check-Key` first, a body-less `TypedResults.NotFound()` otherwise (its comment widened: it compares any sent header with any key); `AccountCheckDriver` and `CheckDsl` for the key and the unknown address. `Conventions/AnonymousEndpointsTests` gains `POST /api/account/check`; `HiddenEndpointsTests` finds it nowhere in `openapi.json`; at the endpoint, no header and the header twice also answer the unknown address's 404 (the test-writer, as c011 task 18.6). Verify: those tests green
- [x] 3.5 Docs: configuration.md § `appsettings.json` is the inventory (`AccountCheck`), § Hand-provisioned secrets (the check key's row, provisioned in C9a, tasks 42.1 and 42.2), § Local development and tests (the parameter), and its `.claude/rules/` mirror. Verify: each names design.md D6

## 4. [close] Slice 1 — A check without the right key gets the answer of an unknown address

- [x] 4.1 The scenario's test passes. Verify: green, including account-check / A check without the right key gets the answer of an unknown address

## 5. [wiring] Slice 2 — No present user

- [x] 5.1 After the key, `PresentUserFromRequest.Read`; `null` answers `BankAnswers.NoPresentUser()` and nothing is read (design.md D7). `AccountCheckDriver` and `CheckDsl` for a call that names no browser. Verify: group 1.3 compiles against it

## 6. [close] Slice 2 — A check that names no browser reads nothing at the bank

- [x] 6.1 The scenario's test passes. Verify: green, including account-check / A check that names no browser reads nothing at the bank

## 7. [unit] Slice 3 — The first check

- [x] 7.1 A first successful read keeps the balance as both last seen and last notified, and sends nothing
- [x] 7.2 A first check answers that nothing changed
- [x] 7.3 A first read that fails keeps nothing and is the read's failure
- [x] 7.4 Two balances that differ by less than a cent are no change; by a cent or more, a change
- [x] 7.5 A check logs what it came to, with no amount (`CheckEnded`, `FirstBalanceKept`)

## 8. [unit] Slice 3 — One check at a time

- [x] 8.1 A call while no check runs starts one at once, with the call's own user
- [x] 8.2 A check that throws is logged once (`CheckFailed`), and its callers get the exception
- [x] 8.3 A check that threw never blocks the next call

## 9. [integration] Slice 3 — The stored balances

- [x] 9.1 Nothing stored reads as nothing
- [x] 9.2 Saved balances read back whole: amounts to the cent (a negative one too), rates with their decimals, read times with their offset
- [x] 9.3 A second save replaces the first

## 10. [wiring] Slice 3 — The store, the queue and the endpoint

- [x] 10.1 `ICheckedBalanceStore`, `InMemoryCheckedBalanceStore` (unit and integration), `TableCheckedBalanceStore` with `CheckedBalanceStoreOptions`; `StorageRegistration.AddCheckedBalanceStore` after `AddPushDeviceStore` in `Program.cs`; `appsettings.json` gains `CheckedBalances` (`TableName` `checkedbalances`, its provenance comment) (design.md D4). Verify: group 9 green on the fake and on Azurite
- [x] 10.2 `AccountCheckQueue` (singleton, a scope per check, `ApplicationStopping`), `AccountCheck` as `IAccountCheck` (scoped); the endpoint answers `BankAnswers.From(result, o => new AccountCheckResponse(o.Changed))`, a failed check its own 500 problem (design.md D10, D11). `AccountCheckDriver` and `CheckDsl` for a check from the default phone and for kept balances in a GIVEN, through the app copy's store (D16). Verify: groups 7 and 8 green
- [x] 10.3 Docs: configuration.md § `appsettings.json` is the inventory (`CheckedBalances`); ADR-0005 item 4's dated note (the check's two balances, design.md D4, D18). Verify: each names design.md D4

## 11. [close] Slice 3 — The first check sends nothing

- [x] 11.1 The scenario's test passes. Verify: green, including account-check / The first check sends nothing

## 12. [close] Slice 4 — The bank sees the phone's address and browser name

- [x] 12.1 The scenario's test passes (expected green since slice 3: the read is `ReadBalanceHandler`'s, as the present user); if it was green before this slice, a unit test pins that the check reads for the call's own user, and the test-writer shows it bites (a mutation). Verify: green, including account-check / The bank sees the phone's address and browser name

## 13. [unit] Slice 5 — Czech amounts

- [x] 13.1 Euros are written with two decimals, a decimal comma and a no-break space before "€": 3.80 as "3,80 €", 45.20 as "45,20 €"
- [x] 13.2 Euros from a thousand on are grouped by no-break spaces: 1234.56 as "1 234,56 €"
- [x] 13.3 A negative balance keeps its minus as U+2212: −5.00 as "−5,00 €"
- [x] 13.4 The koruna value is the size at the rate, rounded half up to whole koruna and grouped: 45.20 at 24.3 as "1 098 Kč", 145.20 as "3 528 Kč", 286.40 as "6 960 Kč"; a value of exactly half rounds up
- [x] 13.5 The koruna value of a negative balance is its size

## 14. [unit] Slice 5 — The notification

- [x] 14.1 A fall is titled "Odešlo" with the size of the change: 49.00 to 45.20 as "Odešlo 3,80 €"
- [x] 14.2 The text is the new balance with its koruna value: "Zůstatek 45,20 € (≈ 1 098 Kč)", with the no-break spaces design.md D2 lists and ordinary spaces elsewhere
- [x] 14.3 The notification opens the app's start page
- [x] 14.4 Two balances that do not differ make no notification (ArgumentException)

## 15. [unit] Slice 5 — Notifying a change

- [x] 15.1 A check with no check waiting behind it notifies a change from the stored balances, then writes last notified as last seen
- [x] 15.2 A check answers that the balance changed when it found a change
- [x] 15.3 The change goes through the sender to an allowed account's device
- [x] 15.4 A check that notified logs it, with counts and no amount (`CheckEnded` `ChangeNotified`, `ChangeSent`)

## 16. [wiring] Slice 5 — The notifier

- [ ] 16.1 `ChangeNotification`, `CzechAmounts` and `ChangeNotifier` (scoped) in `AddAccountCheck`; `CheckDsl` for a check that changed. Verify: groups 13–15 green
- [ ] 16.2 Docs: `pm/progress.md` Q8 confirmed against what is built (its outcome and record, design.md D2; written at propose). Verify: the outcome matches the slice's tests

## 17. [close] Slice 5 — Money out is notified with the new balance

- [ ] 17.1 The scenario's test passes. Verify: green, including account-check / Money out is notified with the new balance

## 18. [unit] Slice 6 — Money in

- [ ] 18.1 A rise is titled "Přišlo" with the size of the change: 45.20 to 145.20 as "Přišlo 100,00 €", over "Zůstatek 145,20 € (≈ 3 528 Kč)"

## 19. [close] Slice 6 — Money in is notified with the new balance

- [ ] 19.1 The scenario's test passes. Verify: green, including account-check / Money in is notified with the new balance

## 20. [unit] Slice 7 — No change

- [ ] 20.1 A read equal to last notified keeps it as last seen, sends nothing and answers that nothing changed (`CheckEnded` `Unchanged`)

## 21. [close] Slice 7 — An unchanged balance sends nothing

- [ ] 21.1 The scenario's test passes. Verify: green, including account-check / An unchanged balance sends nothing

## 22. [unit] Slice 8 — Every allowed account

- [ ] 22.1 A change goes to every account on the allowlist, one at a time, in the list's order
- [ ] 22.2 An allowed account with no device costs nothing more than its zero counts
- [ ] 22.3 `ChangeSent` sums the accounts and the devices reached, failed and removed

## 23. [close] Slice 8 — Every allowed account with a registered device gets the notification

- [ ] 23.1 The scenario's test passes. Verify: green, including account-check / Every allowed account with a registered device gets the notification

## 24. [unit] Slice 9 — The balance in the push

- [ ] 24.1 A message with a balance becomes JSON with `"mutable": true` at the top level and `notification.data.balance` holding `amount`, `readAt` and `czkPerEur`
- [ ] 24.2 The push's balance is written exactly as `GET /api/balance` writes the same values (the same text)
- [ ] 24.3 A check's notification carries last seen as its balance, with its own read time and rate
- [ ] 24.4 A message with a balance still fits the 3993 bytes, and the size check counts the two members

## 25. [wiring] Slice 9 — `PushMessage` gains the balance

- [ ] 25.1 `PushBalance` and `PushMessage.Balance`; `PushMessages.DeclarativeJson` writes the two members only with a balance (design.md D14). Verify: group 24 green; c011's message tests unchanged and green
- [ ] 25.2 Docs: ADR-0010 § Notes (the check's notifications: `mutable`, `data.balance`, every allowed account, through the same sender; design.md D14, D18); ADR-0007 § Notes (the push carries the record's three fields; C9b writes it). Verify: each names design.md D14

## 26. [close] Slice 9 — The notification carries the new balance for the phone to keep

- [ ] 26.1 The scenario's test passes. Verify: green, including account-check / The notification carries the new balance for the phone to keep

## 27. [unit] Slice 10 — The owner's message

- [ ] 27.1 A message without a balance carries neither `mutable` nor `data`

## 28. [close] Slice 10 — The owner's message carries no balance

- [ ] 28.1 The scenario's test passes (expected green since slice 9: the message endpoint never sets a balance). Verify: green, including push-sending / The owner's message carries no balance

## 29. [unit] Slice 11 — A failed read

- [ ] 29.1 A failed read keeps nothing new and is the read's failure (access expired, rate limited, unavailable), logged `BankReadFailed`
- [ ] 29.2 A failed read with nothing to notify sends nothing

## 30. [close] Slice 11 — A failed bank read sends nothing and answers as the balance does

- [ ] 30.1 The scenario's test passes. Verify: green, including account-check / A failed bank read sends nothing and answers as the balance does

## 31. [unit] Slice 12 — Notified once

- [ ] 31.1 Last notified is written once the sender has run, also when a device's push failed or was gone
- [ ] 31.2 Last notified is left as it was when the sender throws, so the next check sends the change again

## 32. [close] Slice 12 — A change is not notified again after a device's push failed

- [ ] 32.1 The scenario's test passes. Verify: green, including account-check / A change is not notified again after a device's push failed

## 33. [unit] Slice 13 — From the stored balances

- [ ] 33.1 A check whose read fails notifies a change an earlier check kept, from last seen, and still answers the read's failure
- [ ] 33.2 A check whose read fails with nothing kept sends nothing

## 34. [close] Slice 13 — A check whose bank read fails still sends what an earlier check found

- [ ] 34.1 The scenario's test passes. Verify: green, including account-check / A check whose bank read fails still sends what an earlier check found

## 35. [unit] Slice 14 — Waiting and joining

- [ ] 35.1 A call while a check runs becomes the waiting check and starts only when the running one ends, with its own user
- [ ] 35.2 A call while a check waits joins it: no check of its own, and the waiting check's answer
- [ ] 35.3 A check with another waiting behind it leaves the notification to it (`CheckEnded` `ChangeLeftToTheNextCheck`)
- [ ] 35.4 `CallersWaiting` counts the waiting check's callers, and is zero once it starts
- [ ] 35.5 The waiting check starts after a running check that threw

## 36. [wiring] Slice 14 — A burst in the tests

- [ ] 36.1 `AccountCheckDriver` and `CheckDsl` for checks that arrive while the first reads the bank: the bank held, the calls sent, `CallersWaiting` awaited through the app copy's services, the bank released (design.md D16). Verify: group 1.15 runs to its assertions
- [ ] 36.2 Docs: testing.md § Fake bank (holding an answer) and § Time and the background job (the check through its endpoint; a burst lined up by holding the bank, never by waiting real time), and the `.claude/rules/` mirror. Verify: each names design.md D16

## 37. [close] Slice 14 — A burst of checks sends one notification and reads the bank at most twice

- [ ] 37.1 The scenario's test passes. Verify: green, including account-check / A burst of checks sends one notification and reads the bank at most twice

## 38. [unit] Slice 15 — The app's lifetime

- [ ] 38.1 A check runs on the app's stopping token, never a caller's: a caller that stops waiting leaves it running
- [ ] 38.2 A joined caller that stops waiting leaves the check and its other callers as they were
- [ ] 38.3 The app stopping cancels the running check

## 39. [wiring] Slice 15 — A caller that leaves

- [ ] 39.1 The endpoint waits on the caller's token only (`WaitAsync`); a cancelled caller ends with nothing written and nothing logged as an error. `AccountCheckDriver` and `CheckDsl` for a call cancelled while the bank is held (design.md D8, D16). Verify: group 38 green
- [ ] 39.2 Docs: ADR-0008's dated amendment (its "C9 decides" points answered by design.md D6, D8, D9; the constraint "at most one notification" naming the two accepted repeats, D10 item 5 and D13); README.md § Backend code (the check endpoint as a key-protected anonymous address; one check at a time in memory) and its `.claude/rules/` mirror. Verify: each names design.md

## 40. [close] Slice 15 — A check goes on when its caller stops waiting

- [ ] 40.1 The scenario's test passes. Verify: green, including account-check / A check goes on when its caller stops waiting

## 41. [unit] Guards

- [ ] 41.1 A notifying check logs no amount in any form, no email and no key (`Conventions/AccountCheckTelemetryTests`, design.md D15)

## 42. [wiring] Deployment

- [ ] 42.1 Guided (the owner): the laptop's check key into the AppHost's user-secrets (`Parameters:accountcheck-key`) and the backup vault, with the block of design.md D17, never printed. Verify: Claude lists the user-secrets name and the backup name, never values
- [ ] 42.2 Guided (the owner, before the merge): the production check key into Key Vault as `AccountCheck--Key`, with the same block's production variant. Verify: Claude lists the vault's secret names read-only and finds `AccountCheck--Key`, never its value
- [ ] 42.3 Update infra Bicep + `.bicepparam` as design.md D17 describes: `platform.bicep` (the `checkedbalances` table), `features.bicep` (section "Account check (C9a)": the Key Vault reference and `AccountCheck__Key`); no `main.bicep` or `.bicepparam` change. Verify: `az bicep lint --file infra/main.bicep` clean
- [ ] 42.4 The read-only preview (deployment.md § Previewing a change to the Bicep, with the owner's login). Verify: it shows exactly the table, one secret and one setting on the container app
- [ ] 42.5 Docs: deployment.md § The account check (the guided block of tasks 42.1 and 42.2; the table; the after-merge checks of design.md § Migration plan, step 4; a read-only query of the checks and their answers per day; a check by hand, on the owner's go only, D17); the carried-along fix in § Requests per account (C14): the Prague times as plain text with `format_datetime(…, 'yyyy-MM-dd HH:mm')`, each query string on one line, run once read-only (D18). Verify: the C14 queries print times without a `Z`
- [ ] 42.6 Docs: `docs/operations/iphone-shortcut.md` (new: the automation, its one action, the key through the Azure portal on the iPhone, a check by hand, restoring it on a new phone, replacing the key; design.md D17), linked from `docs/operations/` where the others are listed; expiring-approvals.md § 7 (the check key and the Shortcut: no expiry, how to restore and replace them); local-secrets.md (the laptop's key and its backup). Verify: each names design.md D17

## 43. [close] Acceptance green

- [ ] 43.1 All 15 automated acceptance tests of this change pass, and the full suite is green; the traceability check passes (the manual row claims the 16th); `dotnet format whitespace --verify-no-changes` and the frontend checks are clean; `az bicep lint` is clean; `openapi.json` and `schema.d.ts` unchanged
- [ ] 43.2 Local check with `aspire start --isolated` (design.md § Migration plan, step 2; the laptop's key passed as a `Parameters__*` environment variable from the worktree, never written to the shared user-secrets): a check with the key answers `changed` false twice, a wrong key answers as an unknown address, and the app's lines show `CheckEnded` with no amount. Verify: the owner sees each
- [ ] 43.3 Docs: the software-factory lessons, the divergence and the inventory line of design.md D20. Verify: each names the decision it records
- [ ] 43.4 `pm/progress.md`: C9a's row (status, the change link, notes; `in progress` until the iPhone row, design.md § Migration plan, step 4); `CLAUDE.md` § Commands (the quick start's check key, task 3.2; "Run the app" names `accountcheck-key`). Verify: the row links the change

## Workflow follow-up

- The push and a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; `/opsx:archive` on the branch; the PR ready, CI green, squash merge (workflow.md § 6). If C9b merged first, join its progress row and ADR-0007's note by hand (design.md D1).
- After the merge: design.md § Migration plan, step 4: the deploy, the read-only checks, the owner's Shortcut, the iPhone row, then a small docs PR recording it and marking C9a done.
