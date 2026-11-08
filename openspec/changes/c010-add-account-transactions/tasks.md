# Tasks: c010-add-account-transactions

Before this list: design.md § Migration plan step 1 (the design loop, done 2026-11-08, its answer already in these artifacts) and § Bootstrap, committed as `[setup]`:

- the packages (`Aspire.Azure.Data.Tables`, `Aspire.Hosting.Azure.Storage`, `Testcontainers.Azurite`, `@radix-ui/react-dialog`);
- the probes (Azurite through Testcontainers; the Aspire client with health checks off; the OpenAPI export check with a made-up tables connection).

Its baseline holds one known exception, accepted once: the traceability check reports this change's 40 new scenarios as not claimed. Group 1 claims 35 of them; group 88 claims the join's 5.

Run with `/tdd-apply c010-add-account-transactions` (roadmap C7b; the user picks the review mode at the start). There are 40 scenarios: 16 API (one of them `bank-reads`), 19 screen, 5 at the join. So the work is sliced per scenario (design.md D15): slices 1–16 are the API, 17–35 the screen, then the history import, deployment and a local check. **The join (groups 87–95) waits for C7a's merge** (design.md D8); everything before it can run now.

- Docs tasks are the orchestrator's; "Guided" tasks need the owner.
- **"Green"** means the full suite: `dotnet test` (Docker running, for Azurite), and `npm --prefix src/RevolutReader.Web test`, `lint`, `typecheck` and `format:check`. Three exceptions: this change's acceptance tests stay red until their slice; the guard 1.3 until slice 4; and the traceability check until group 88, while it names exactly the 5 join scenarios and nothing else (the user, at the acceptance gate, 2026-11-08).

## 1. [acceptance] Acceptance tests

- [x] 1.1 Foundation (API): `Drivers/AzuriteStorage`, one container per test session (a TUnit shared data source), image `mcr.microsoft.com/azure-storage/azurite:3.37.0` pinned; it stops with a message when Docker is not running. Every app copy gets `ConnectionStrings:tables` = its connection string and `Transactions:TableName` = a unique name from the DSL (design.md D12). `AcceptanceTest.ConfigureWebHostBuilder` sets them next to `FakeBank.Configure`. Verify: every acceptance test that was green stays green
- [x] 1.2 Foundation (API), as design.md § Public API sketch:
  - `ScenarioCalendar`, `TransactionsDriver`, `TransactionsDsl`, `TransactionsReading`, `TransactionSeenInApi` and `KeptAtApp` as signatures whose methods throw `NotImplementedException`; `AcceptanceTest.Transactions`;
  - `TransactionAtBank` gains `TypeCode` (defaults `CARD_PAYMENT` for `Payment`, `TRANSFER` for `TransferReceived`) and the factories `Refund` and `CashWithdrawal`; `FakeBank` writes it as `bank_transaction_code.code`, in the Mock ASPSP capture's shape;
  - `Dsl/ProblemDescription` gains `Type` and the three bank values, exactly as C7a's design sketches them (design.md D13).

  Verify: build passes; every acceptance test that was green stays green
- [x] 1.3 Guard: `Conventions/TransactionTelemetryTests` (design.md D12):
  - a transaction with an unknown, code-shaped type code logs one warning carrying the code and no other field;
  - a type code that does not look like a code is not quoted;
  - no captured line contains a counterparty, an amount or a detail of the transactions read.

  Verify: fails at runtime until slice 4
- [x] 1.4 Foundation (frontend): `src/test/server.ts` answers `GET /api/transactions` and `GET /api/transactions/older?before=` (a page; the three bank problems by `type`; 401; 403; a 500 problem; a 502 hosting page in plain text; no connection; no answer yet; `after: <ms>` on the test's clock; one answer per request in order, the last repeating; older pages by `before`), and requests honour their `AbortSignal`. `src/test/intersection.ts`: the `IntersectionObserver` stand-in with `scrollToEnd()`, installed by `setup.ts`. Verify: the existing frontend tests stay green
- [x] 1.5 Acceptance: bank-reads / A transaction comes back with the bank's type code
- [x] 1.6 Acceptance: account-transactions / The newest transactions come live with the koruna rate
- [x] 1.7 Acceptance: account-transactions / The bank's text leaves out the line that repeats the counterparty
- [x] 1.8 Acceptance: account-transactions / A refund is told by the bank's type code
- [x] 1.9 Acceptance: account-transactions / The bank sees the signed-in user's address and browser
- [x] 1.10 Acceptance: account-transactions / A transactions request without a browser name reads nothing at the bank
- [x] 1.11 Acceptance: account-transactions / Expired bank access answers its own problem
- [x] 1.12 Acceptance: account-transactions / A reached bank limit answers its own problem
- [x] 1.13 Acceptance: account-transactions / A bank that does not answer is its own problem
- [x] 1.14 Acceptance: account-transactions / The live read covers the last 31 days
- [x] 1.15 Acceptance: account-transactions / After a long pause, the live read reaches back to the newest kept day
- [x] 1.16 Acceptance: account-transactions / With nothing kept, the live read reaches back 89 days
- [x] 1.17 Acceptance: account-transactions / Older transactions come from storage in pages of whole days
- [x] 1.18 Acceptance: account-transactions / The oldest page says nothing older is kept
- [x] 1.19 Acceptance: account-transactions / A settled transaction stays in the history after the bank stops listing it
- [x] 1.20 Acceptance: account-transactions / A pending transaction is never kept
- [x] 1.21 Acceptance: account-transactions / The list shows placeholders while the transactions load (frontend)
- [x] 1.22 Acceptance: account-transactions / The account screen lists the transactions by day, newest first (frontend)
- [x] 1.23 Acceptance: account-transactions / A row shows the counterparty, the bank's text and the amount with its koruna value (frontend)
- [x] 1.24 Acceptance: account-transactions / A row without the bank's own text names the kind of payment (frontend)
- [x] 1.25 Acceptance: account-transactions / A row without a counterparty names the kind of transaction (frontend)
- [x] 1.26 Acceptance: account-transactions / A row without a counterparty or text names an unknown kind by its direction (frontend)
- [x] 1.27 Acceptance: account-transactions / Tapping a transaction opens its details (frontend)
- [x] 1.28 Acceptance: account-transactions / The details leave out the description when the bank gave no text of its own (frontend)
- [x] 1.29 Acceptance: account-transactions / A pending transaction is marked as waiting (frontend)
- [x] 1.30 Acceptance: account-transactions / A refund is marked as one in the list and in its details (frontend)
- [x] 1.31 Acceptance: account-transactions / An account with no transactions says so (frontend)
- [x] 1.32 Acceptance: account-transactions / Expired bank access asks to let Dad know about the transactions (frontend)
- [x] 1.33 Acceptance: account-transactions / Too many refreshes shows a warning instead of the transactions (frontend)
- [x] 1.34 Acceptance: account-transactions / A bank that does not answer the transactions shows a retry (frontend)
- [x] 1.35 Acceptance: account-transactions / An unexpected answer to the transactions read shows a retry (frontend)
- [x] 1.36 Acceptance: account-transactions / Offline, the transactions load once the phone is back online (frontend; the stored balance joins its setup at the join, design.md D8)
- [x] 1.37 Acceptance: account-transactions / Older transactions load when the list reaches its end (frontend)
- [x] 1.38 Acceptance: account-transactions / Older transactions that failed to load can be tried again (frontend)
- [x] 1.39 Acceptance: account-transactions / The list ends where the history ends (frontend)

## 2. [unit] Slice 1 — Transaction mapping

- [x] 2.1 A transaction's type code comes back unchanged
- [x] 2.2 A transaction without a type code comes back without one
- [x] 2.3 A transaction whose type code has no code comes back without one

## 3. [wiring] Slice 1 — The type code from the bank

- [x] 3.1 `EbBankTransactionCode` on `EbTransaction`; `BankTransaction.TypeCode`, filled by `TransactionMapping` (design.md § Public API sketch). The existing adapter and mapping tests already expect the codes their captured answers carry (the test-writer's update in group 2). Verify: build passes; green except this slice's scenario

## 4. [close] Slice 1 — A transaction comes back with the bank's type code

- [x] 4.1 The scenario's test passes. Verify: green, including bank-reads / A transaction comes back with the bank's type code

## 5. [unit] Slice 2 — Newest page and storage settings

The handler's tests use a hand-written `StubBankAccount`, the in-memory fake `InMemoryTransactionStore` (the test-writer's, design.md D12) and `FakeTimeProvider`.

- [x] 5.1 The window starts 31 days before today
- [x] 5.2 The newest page holds the live transactions dated from the window's start, in the bank's order
- [x] 5.3 A live transaction dated before the window's start is left off the newest page
- [x] 5.4 Pending transactions are on the newest page, marked pending
- [x] 5.5 The newest page carries the koruna rate and its date
- [x] 5.6 The newest page says nothing older is kept when the store holds nothing before the window
- [x] 5.7 The newest page names the window's start when the store holds something older
- [x] 5.8 The bank is read for the present user handed in
- [x] 5.9 A bank failure comes back as the same failure, and nothing is kept
- [x] 5.10 A missing tables connection is refused at registration, and the message names the setting only
- [x] 5.11 A table name that is not 3 to 63 letters and digits starting with a letter fails validation
- [x] 5.12 The default table name passes validation

## 6. [integration] Slice 2 — Transaction store

Each test runs against `InMemoryTransactionStore` and `TableTransactionStore` on Azurite, a table per test (design.md § Ports and contracts).

- [x] 6.1 An empty store reads as no transactions
- [x] 6.2 Kept transactions read back newest day first, then by their position within the day
- [x] 6.3 Every field reads back as kept: the amount to the cent, empty details, a missing counterparty and a missing type code
- [x] 6.4 A reference containing a slash, a hash, a question mark or a backslash reads back unchanged
- [x] 6.5 Keeping a transaction again leaves one transaction with the latest values
- [x] 6.6 Keeping more than 100 transactions at once keeps them all
- [x] 6.7 Keeping nothing changes nothing
- [x] 6.8 Keeping the same reference twice in one call keeps the later one (added 2026-11-08: Table Storage refuses a batch that names one key twice)

## 7. [wiring] Slice 2 — Storage

- [x] 7.1 `TransactionStoreOptions` and the `Transactions` section (`TableName` = `transactions`) plus an empty `ConnectionStrings:tables` in `appsettings.json`, each key with its provenance comment; validated on start (design.md D11). `AddTransactionStore()`: `ConnectionStrings:tables` checked at registration (design.md D11), `AddAzureTableServiceClient("tables")` with health checks off, `TableTransactionStore` as the store (D5: partition `account`, escaped row key, columns, the table created once if missing, batches of 100). The export check `OpenApiExport` gets a made-up tables connection. Verify: build passes; group 6 green on Azurite; the `service-health` scenarios stay green
- [x] 7.2 AppHost: `AddAzureStorage("storage").RunAsEmulator()` with `AddTables("tables")`, referenced by the API, which waits for it. Start the app through the aspire skill with `--isolated`. Verify: the storage emulator and the API come up healthy
- [ ] 7.3 Docs:
  - configuration.md: the `Transactions` section and `ConnectionStrings:tables` (not a secret; set by Bicep in Azure);
  - README.md § Backend code: the store port in `Account/`, its adapter in `Storage/`;
  - testing.md: Azurite in the acceptance harness (§ Decided later becomes decided), the store's contract tests with the linked fake, scenario dates relative to the clock;
  - their `.claude/rules/` mirrors;
  - ADR-0005 item 4 amended (one table, one partition, the reference as the key, read whole; design.md D5);
  - `CLAUDE.md` § Commands: `dotnet test` needs Docker running; the image quick start gains a made-up `ConnectionStrings__tables`.

  Verify: they match design.md D5, D11, D12; the quick start's command runs as written

## 8. [wiring] Slice 2 — The newest page's endpoint

- [x] 8.1 `AddTransactions()` and `NewestTransactionsEndpoint` (`GET /api/transactions`): C13's `PresentUserFromRequest.Read`, else `BankAnswers.NoPresentUser()`; the handler's result through `BankAnswers.From`; the description 200, 401, 403, 500 plus `ProducesBankProblems()` (design.md D10). `Program.cs`: `AddTransactionStore()` and `AddTransactions()` after `AddEnableBanking()`. Verify: build passes; green except this change's scenarios
- [x] 8.2 `ScenarioCalendar`, `TransactionsDriver.AskForNewest` and `Keep`, and the DSL's methods replace their stubs (design.md D12; the DSL was written in full at the acceptance gate). Verify: the scenario runs against the app
- [x] 8.3 Regenerate the TS client: `npm --prefix tools/api-client run regenerate`; `openapi.json` and `schema.d.ts` committed. Verify: a second run leaves no diff; frontend checks green

## 9. [close] Slice 2 — The newest transactions come live with the koruna rate

- [ ] 9.1 The scenario's test passes, including the answer's exact shape. Verify: green, including account-transactions / The newest transactions come live with the koruna rate. Closes with slice 4 (group 15), not here: the scenario's transactions are card payments, and their `kind` comes from slice 4's `TransactionKinds` and JSON names (found at group 8: every other field already matches)

## 10. [unit] Slice 3 — Transaction text

- [x] 10.1 A line equal to the counterparty is left out of the details
- [x] 10.2 A line repeating the counterparty in other letter case, without its accents or with other spacing is left out
- [x] 10.3 Blank lines are left out
- [x] 10.4 Runs of spaces inside a kept line collapse to one
- [x] 10.5 Without a counterparty, every line that is not blank stays
- [x] 10.6 A line that holds the counterparty's name among other words stays

## 11. [wiring] Slice 3 — The shown details

- [x] 11.1 The newest page's transactions carry `TransactionText.Details`. Verify: the scenario runs against the app

## 12. [close] Slice 3 — The bank's text leaves out the line that repeats the counterparty

- [x] 12.1 The scenario's test passes. Verify: green, including account-transactions / The bank's text leaves out the line that repeats the counterparty

## 13. [unit] Slice 4 — Transaction kinds

- [ ] 13.1 `CARD_PAYMENT`, `TOPUP`, `TRANSFER`, `ATM` and `EXCHANGE` are a card payment, a top-up, a transfer, a cash withdrawal and an exchange
- [ ] 13.2 A code containing `REFUND` is a refund, in any letter case
- [ ] 13.3 Any other code is other
- [ ] 13.4 A missing code is other
- [ ] 13.5 Capitals, digits and underscores, up to 40 characters, look like a code
- [ ] 13.6 Any other character, or more than 40, does not look like a code
- [ ] 13.7 The newest page logs an unknown, code-shaped type code as a warning carrying the code
- [ ] 13.8 The newest page logs a type code that does not look like a code without quoting it
- [ ] 13.9 The newest page logs a transaction without a type code

## 14. [wiring] Slice 4 — Kinds in the answer

- [ ] 14.1 `TransactionKind` written as the design system's seven names, `card`, `topup`, `transfer`, `atm`, `exchange`, `refund`, `other` (`JsonStringEnumMemberName`, as C13's `BankProblemType`); `TransactionsLog`. Regenerate the TS client. Verify: the scenario and the guard 1.3 run against the app; a second regenerate leaves no diff
- [ ] 14.2 Docs: README.md § Backend code: a bank code is logged only when it looks like a code (design.md D4c), and its `.claude/rules/` mirror. Verify: it matches `TransactionKinds.LooksLikeACode`

## 15. [close] Slice 4 — A refund is told by the bank's type code

- [ ] 15.1 The scenario's test and the guard 1.3 pass. Verify: green, including account-transactions / A refund is told by the bank's type code and `TransactionTelemetryTests`

## 16. [close] Slice 5 — The bank sees the signed-in user's address and browser

- [ ] 16.1 The scenario's test passes (slice 2's endpoint reads as the present user). Verify: green, including account-transactions / The bank sees the signed-in user's address and browser

## 17. [close] Slice 6 — A transactions request without a browser name reads nothing at the bank

- [ ] 17.1 `TransactionsDriver.AskForNewestNamingNoBrowser` replaces its stub; the scenario's test passes. Verify: green, including account-transactions / A transactions request without a browser name reads nothing at the bank

## 18. [close] Slice 7 — Expired bank access answers its own problem

- [ ] 18.1 The scenario's test passes. Verify: green, including account-transactions / Expired bank access answers its own problem

## 19. [close] Slice 8 — A reached bank limit answers its own problem

- [ ] 19.1 The scenario's test passes. Verify: green, including account-transactions / A reached bank limit answers its own problem

## 20. [close] Slice 9 — A bank that does not answer is its own problem

- [ ] 20.1 The scenario's test passes. Verify: green, including account-transactions / A bank that does not answer is its own problem

## 21. [unit] Slice 10 — Live read start

- [ ] 21.1 With the newest kept day inside the last 31 days, the read starts 31 days before today
- 21.2 moved to slice 11 as 24.4 (inside the last 31 days the live read's start is the window's start, so no test of it could fail here; found by the test-writer)

## 22. [wiring] Slice 10 — The bank's from-date

- [ ] 22.1 `TransactionsDriver.DaysTheBankWasAskedFrom` reads the fake bank's transaction requests and shifts their dates back (design.md D12). Verify: the scenario runs against the app

## 23. [close] Slice 10 — The live read covers the last 31 days

- [ ] 23.1 The scenario's test passes. Verify: green, including account-transactions / The live read covers the last 31 days

## 24. [unit] Slice 11 — A long pause

- [ ] 24.1 With the newest kept day earlier than 31 days back, the read starts on that day
- [ ] 24.2 With the newest kept day earlier than 89 days back, the read starts 89 days back and reports the gap's days
- [ ] 24.3 A gap beyond 89 days logs a warning with its days
- [ ] 24.4 The newest page asks the bank from the live read's start (moved from 21.2)

## 25. [close] Slice 11 — After a long pause, the live read reaches back to the newest kept day

- [ ] 25.1 The scenario's test passes. Verify: green, including account-transactions / After a long pause, the live read reaches back to the newest kept day

## 26. [unit] Slice 12 — Nothing kept

- [ ] 26.1 With nothing kept, the read starts 89 days before today

## 27. [close] Slice 12 — With nothing kept, the live read reaches back 89 days

- [ ] 27.1 The scenario's test passes. Verify: green, including account-transactions / With nothing kept, the live read reaches back 89 days

## 28. [unit] Slice 13 — Older pages

- [ ] 28.1 An older page holds only transactions dated before the given day, newest first
- [ ] 28.2 An older page adds whole days until it holds at least 30 transactions
- [ ] 28.3 A day is never split across pages, even when it makes the page longer than 30
- [ ] 28.4 An older page names its oldest day when older transactions are kept
- [ ] 28.5 An older page carries the koruna rate and its date
- [ ] 28.6 An older page reads only the store

## 29. [wiring] Slice 13 — The older page's endpoint

- [ ] 29.1 `OlderTransactionsEndpoint` (`GET /api/transactions/older?before=`): `before` required, a calendar date, else 400 with a problem description; description 200, 400, 401, 403, 500 (design.md D10). `TransactionsDriver.AskForOlder` replaces its stub (`Keep` is slice 2's). Regenerate the TS client. Verify: the scenario runs against the app; a second regenerate leaves no diff

## 30. [close] Slice 13 — Older transactions come from storage in pages of whole days

- [ ] 30.1 The scenario's test passes. Verify: green, including account-transactions / Older transactions come from storage in pages of whole days

## 31. [unit] Slice 14 — The end of the history

- [ ] 31.1 An older page with nothing older kept says so
- [ ] 31.2 An older page before every kept day is empty and says nothing older is kept

## 32. [close] Slice 14 — The oldest page says nothing older is kept

- [ ] 32.1 The scenario's test passes. Verify: green, including account-transactions / The oldest page says nothing older is kept

## 33. [unit] Slice 15 — Keeping

- [ ] 33.1 Settled transactions are kept with their position within their day, in the bank's order
- [ ] 33.2 A settled transaction without a reference is not kept, and counted
- [ ] 33.3 The newest page keeps the settled transactions of its whole read, days before the window included, and then names the window's start as where older ones are kept
- [ ] 33.4 The newest page logs settled transactions without a reference as a warning with their count

## 34. [close] Slice 15 — A settled transaction stays in the history after the bank stops listing it

- [ ] 34.1 `ScenarioCalendar.PassDays` replaces its stub; the scenario's test passes. Verify: green, including account-transactions / A settled transaction stays in the history after the bank stops listing it

## 35. [unit] Slice 16 — Pending never kept

- [ ] 35.1 A pending transaction is never kept
- [ ] 35.2 A read with only pending transactions keeps nothing

## 36. [close] Slice 16 — A pending transaction is never kept

- [ ] 36.1 The scenario's test passes. Verify: green, including account-transactions / A pending transaction is never kept

## 37. [unit] Slice 17 — Reading the transactions

- [ ] 37.1 A 200 page reads as the page
- [ ] 37.2 Each bank problem reads as its kind by its exact `type`
- [ ] 37.3 A 401 reads as signed out and a 403 as refused, naming the email
- [ ] 37.4 Any other status, a hosting error page in plain text or a body that is not a page reads as unexpected
- [ ] 37.5 A read while the phone says it is offline sends nothing and reads as offline
- [ ] 37.6 A request that fails without an answer reads as offline
- [ ] 37.7 While the newest page is read and the server is awake, the list shows placeholders

## 38. [wiring] Slice 17 — The list on the account screen

- [ ] 38.1 `src/app/transactions.ts` (`readNewestTransactions`, `readOlderTransactions`, typed from `schema.d.ts`), `listState.ts`, `useTransactionList` (the newest page once the session is signed in; one read at a time), `Skeleton` with the `list` variant ("Načítám pohyby", to C7a's props, design.md D13), and `AccountScreen` hosting the list in its content area until the join. Verify: the scenario runs against the app; lint, typecheck and format clean

## 39. [close] Slice 17 — The list shows placeholders while the transactions load

- [ ] 39.1 The scenario's test passes. Verify: green, including account-transactions / The list shows placeholders while the transactions load

## 40. [unit] Slice 18 — Days

- [ ] 40.1 Transactions group by their date, in the answer's order
- [ ] 40.2 A date reads as a local calendar day, whatever the time zone
- [ ] 40.3 Today's heading is "Dnes" and yesterday's "Včera"
- [ ] 40.4 An older day's heading is its weekday and date, with the year only outside the current year
- [ ] 40.5 A day's totals sum money received and refunds as received, payments as spent, pending ones included, in whole cents
- [ ] 40.6 A total of zero is left out
- [ ] 40.7 Euro amounts are formatted the Czech way, with the minus sign U+2212 and a non-breaking space

## 41. [wiring] Slice 18 — Day groups

- [ ] 41.1 `TransactionList`, `DayGroup` and `DayHeader` (sticky, `h2`, totals with their spoken twins "Příchozí …" and "Odchozí …"; design.md D14), and `format.ts`'s `formatEur` and `formatDayHeader`. Verify: the scenario runs against the app

## 42. [close] Slice 18 — The account screen lists the transactions by day, newest first

- [ ] 42.1 The scenario's test passes. Verify: green, including account-transactions / The account screen lists the transactions by day, newest first

## 43. [unit] Slice 19 — A row's lines and amounts

- [ ] 43.1 A row's first line is the counterparty
- [ ] 43.2 A row's second line is the details joined by " · "
- [ ] 43.3 The koruna value is the amount's size times the rate, rounded half up to whole crowns, marked "≈"
- [ ] 43.4 An amount in another currency shows with its code and no koruna value
- [ ] 43.5 A row's spoken label is its whole sentence, without a time

## 44. [wiring] Slice 19 — TransactionRow

- [ ] 44.1 `TransactionRow` (icon disc, two lines with ellipsis, signed amount, koruna line; a button with the spoken label; design.md D14), `formatCzkApprox`, `czkApproxLabel`, `formatAmount`. Verify: the scenario runs against the app

## 45. [close] Slice 19 — A row shows the counterparty, the bank's text and the amount with its koruna value

- [ ] 45.1 The scenario's test passes. Verify: green, including account-transactions / A row shows the counterparty, the bank's text and the amount with its koruna value

## 46. [unit] Slice 20 — Kind words

- [ ] 46.1 Each known kind has its word: "Platba kartou", "Dobití účtu", "Převod", "Výběr z bankomatu", "Směna měny", "Vrácení peněz"
- [ ] 46.2 Without details, a row's second line is the kind's word

## 47. [close] Slice 20 — A row without the bank's own text names the kind of payment

- [ ] 47.1 The scenario's test passes. Verify: green, including account-transactions / A row without the bank's own text names the kind of payment

## 48. [unit] Slice 21 — No counterparty

- [ ] 48.1 Without a counterparty, a row's first line is the kind's word
- [ ] 48.2 Without a counterparty or details, the kind's word is not repeated on the second line

## 49. [close] Slice 21 — A row without a counterparty names the kind of transaction

- [ ] 49.1 The scenario's test passes. Verify: green, including account-transactions / A row without a counterparty names the kind of transaction

## 50. [unit] Slice 22 — Unknown kind

- [ ] 50.1 The kind other is "Příchozí platba" for money received and "Odchozí platba" for money spent

## 51. [close] Slice 22 — A row without a counterparty or text names an unknown kind by its direction

- [ ] 51.1 The scenario's test passes. Verify: green, including account-transactions / A row without a counterparty or text names an unknown kind by its direction

## 52. [unit] Slice 23 — The sheet's words

- [ ] 52.1 The sheet's subtitle is the kind's word, and there is none when the title already is that word
- [ ] 52.2 A settled transaction is "Zaúčtováno", a settled refund "Vráceno na účet", a pending one "Čeká na zpracování"
- [ ] 52.3 The rate line reads "1 € ≈ 24,30 Kč · orientační kurz z 8. 11. 2026"
- [ ] 52.4 A date reads "18. 11. 2026"

## 53. [wiring] Slice 23 — TransactionSheet

- [ ] 53.1 `TransactionSheet` on Radix `Dialog` (title, description, close button "Zavřít", amount and koruna value, "Stav", "Datum", "Popis", "Přepočet na koruny"; focus to the sheet and back to the row; design.md D4d, D14); `formatRate`, `formatDate`; the row opens it. Verify: the scenario runs against the app; Escape and the close button close it

## 54. [close] Slice 23 — Tapping a transaction opens its details

- [ ] 54.1 The scenario's test passes. Verify: green, including account-transactions / Tapping a transaction opens its details

## 55. [wiring] Slice 24 — The description only with text

- [ ] 55.1 "Popis" shows only when the transaction has details. Verify: the scenario runs against the app

## 56. [close] Slice 24 — The details leave out the description when the bank gave no text of its own

- [ ] 56.1 The scenario's test passes. Verify: green, including account-transactions / The details leave out the description when the bank gave no text of its own

## 57. [unit] Slice 25 — Pending

- [ ] 57.1 A pending row's second line is "Čeká na zpracování"

## 58. [wiring] Slice 25 — The pending row

- [ ] 58.1 The pending look: the `clock` disc, the second line in the pending colour, the amount muted with its sign (design system). Verify: the scenario runs against the app

## 59. [close] Slice 25 — A pending transaction is marked as waiting

- [ ] 59.1 The scenario's test passes. Verify: green, including account-transactions / A pending transaction is marked as waiting

## 60. [unit] Slice 26 — Refunds

- [ ] 60.1 A refund's amount is shown as received, with a plus sign
- [ ] 60.2 A refund whose first line is the counterparty and whose second line is the bank's text shows the "Vrácení" chip
- [ ] 60.3 A refund whose second line is the kind's word, or whose first line is, shows no chip

## 61. [wiring] Slice 26 — The refund row

- [ ] 61.1 The `undo-2` disc and the "Vrácení" chip before the second line (design system). Verify: the scenario runs against the app

## 62. [close] Slice 26 — A refund is marked as one in the list and in its details

- [ ] 62.1 The scenario's test passes. Verify: green, including account-transactions / A refund is marked as one in the list and in its details

## 63. [wiring] Slice 27 — The empty list

- [ ] 63.1 `EmptyState` with the `default` variant, to C7a's props (design.md D13), when the newest page has no transactions and nothing older is kept. Verify: the scenario runs against the app

## 64. [close] Slice 27 — An account with no transactions says so

- [ ] 64.1 The scenario's test passes. Verify: green, including account-transactions / An account with no transactions says so

## 65. [unit] Slice 28 — The list's problems

- [ ] 65.1 A failed newest page with no list shows no list and its problem as the banner
- [ ] 65.2 A failed newest page keeps a list already shown

## 66. [wiring] Slice 28 — Expired access

- [ ] 66.1 The error banner "Propojení s bankou vypršelo" / "Obnovit propojení musí táta, dej mu prosím vědět.", no button (design.md D7). Verify: the scenario runs against the app

## 67. [close] Slice 28 — Expired bank access asks to let Dad know about the transactions

- [ ] 67.1 The scenario's test passes. Verify: green, including account-transactions / Expired bank access asks to let Dad know about the transactions

## 68. [wiring] Slice 29 — The request limit

- [ ] 68.1 `Banner`'s warning tone (`role="status"`), to C7a's props (design.md D13); the warning "Příliš mnoho obnovení" / "Banka teď další dotazy nepřijímá. Zkus to znovu později.", no button. Verify: the scenario runs against the app

## 69. [close] Slice 29 — Too many refreshes shows a warning instead of the transactions

- [ ] 69.1 The scenario's test passes. Verify: green, including account-transactions / Too many refreshes shows a warning instead of the transactions

## 70. [wiring] Slice 30 — The bank not answering

- [ ] 70.1 `Banner`'s `action`, a ghost-styled button inside the banner (design.md D13); the error "Pohyby se nepodařilo načíst" / "Banka teď neodpovídá. Zkus to prosím za chvíli." with "Zkusit znovu", which reads the newest page again. Verify: the scenario runs against the app

## 71. [close] Slice 30 — A bank that does not answer the transactions shows a retry

- [ ] 71.1 The scenario's test passes. Verify: green, including account-transactions / A bank that does not answer the transactions shows a retry

## 72. [wiring] Slice 31 — An unexpected answer

- [ ] 72.1 The error "Pohyby se nepodařilo načíst" / "Zkus to prosím za chvíli." with "Zkusit znovu" for an unexpected read, and for 401 and 403 until the join (design.md D7). Verify: the scenario runs against the app

## 73. [close] Slice 31 — An unexpected answer to the transactions read shows a retry

- [ ] 73.1 The scenario's test passes. Verify: green, including account-transactions / An unexpected answer to the transactions read shows a retry

## 74. [unit] Slice 32 — Offline

- [ ] 74.1 An offline read shows the note and no banner
- [ ] 74.2 A newest page with no answer within 60 s ends as offline

## 75. [wiring] Slice 32 — The list offline

- [ ] 75.1 The 60 s cap (`setTimeout` with an `AbortController`), the note "Pohyby se načtou, jakmile budeš online." (`EmptyState` note, C7a's variant name), and the reload on the window's `online` event; while the phone says it is offline, the note shows and nothing is sent even with the session unknown (`GET /api/me` failed offline), until the join (design.md D7). Verify: the scenario runs against the app

## 76. [close] Slice 32 — Offline, the transactions load once the phone is back online

- [ ] 76.1 The scenario's test passes. Verify: green, including account-transactions / Offline, the transactions load once the phone is back online

## 77. [unit] Slice 33 — Older pages on the screen

- [ ] 77.1 An older page's days join the end of the list
- [ ] 77.2 An older page whose first day is already shown adds its transactions to that day
- [ ] 77.3 The next older page is asked before the last page's `olderBefore`
- [ ] 77.4 No second older page is asked while one is loading
- [ ] 77.5 After a failed older page, nothing is asked until "Zkusit znovu", whatever the scrolling or the network does

## 78. [wiring] Slice 33 — Loading older pages

- [ ] 78.1 `ListEnd` (design.md D14) under the last day, watched by an `IntersectionObserver` with `rootMargin: '0px 0px 100% 0px'`, in its `loading` state ("Načítám starší pohyby"); `withOlderPage` (design.md D1). Verify: the scenario runs against the app

## 79. [close] Slice 33 — Older transactions load when the list reaches its end

- [ ] 79.1 The scenario's test passes. Verify: green, including account-transactions / Older transactions load when the list reaches its end

## 80. [wiring] Slice 34 — A failed older page

- [ ] 80.1 `ListEnd`'s `error` state ("Starší pohyby se nepodařilo načíst" with "Zkusit znovu", focus to its line on tap); offline, nothing is sent and the error shows at once; only the button tries again (design.md D1). Verify: the scenario runs against the app

## 81. [close] Slice 34 — Older transactions that failed to load can be tried again

- [ ] 81.1 The scenario's test passes. Verify: green, including account-transactions / Older transactions that failed to load can be tried again

## 82. [close] Slice 35 — The list ends where the history ends

- [ ] 82.1 With `olderBefore` null, `ListEnd`'s `end` state ("Žádné starší pohyby") and no observer; the scenario's test passes. Verify: green, including account-transactions / The list ends where the history ends

## 83. [integration] History import

`HistoryImporter` and `HistoryFile` in `tests/RevolutReader.IntegrationTests/HistoryImport/`, against Azurite with a made-up file of the M1 file's shape (design.md D9).

- [ ] 83.1 The import keeps the settled transactions dated from 2026-08-09 and leaves out the pending ones and the earlier days
- [ ] 83.2 The import keeps each day's transactions with their positions in the file's order
- [ ] 83.3 The import never writes a day the table already holds
- [ ] 83.4 The import never writes the export's own day
- [ ] 83.5 Running the import twice keeps each transaction once
- [ ] 83.6 The import reports counts only: read, settled, kept and days skipped
- [ ] 83.7 A page the adapter cannot read fails the import, quoting nothing from it

## 84. [wiring] History import — the explicit check

- [ ] 84.1 `HistoryImport` (`[Explicit]`): reads `HistoryImport:File` and `HistoryImport:TableEndpoint`, writes with `AzureCliCredential` through `TableTransactionStore`, prints counts only. Verify: it runs nothing in the default suite; run against Azurite with the made-up file, it prints the counts
- [ ] 84.2 Docs:
  - `CLAUDE.md` § Commands: the import's command and settings (explicit, run once, owner only);
  - docs/operations/deployment.md: the import's steps, the owner's temporary Storage Table Data Contributor (granted and removed by the owner, design.md D9), the counts to compare, the file and its backup deleted;
  - `spikes/enable-banking/README.md`: the history file is imported by `HistoryImport`, then deleted.

  Verify: the command runs as written against Azurite

## 85. [wiring] Deployment

- [ ] 85.1 Update infra Bicep + `.bicepparam`, as design.md D11 describes:
  - `platform.bicep`: the table service and the table `transactions` (with a comment: removing it from the stack deletes the history), the app identity's Storage Table Data Contributor on it, the table endpoint as an output;
  - `main.bicep` passes it on;
  - `features.bicep`: `ConnectionStrings__tables` on the container app.

  `main.bicepparam` is unchanged. Verify: `az bicep lint --file infra/main.bicep` reports nothing; the read-only preview (docs/operations/deployment.md) shows the new resources and no deletion
- [ ] 85.2 Docs:
  - workflow.md § 5: the table and its role;
  - deployment.md: the table in the deployed resources, the read-only check that rows arrive after the first open, the rollback that keeps the table (design.md § Migration plan, step 7);
  - ADR-0005 § Consequences: C7b's table and role done;
  - ADR-0001 item 6 amended: the live read reaches back to the newest kept day, at most 89 days (design.md D3).

  Verify: they match design.md D3, D11

## 86. [wiring] Local check before the join

- [ ] 86.1 `aspire start --isolated` in a browser (design.md § Migration plan, step 3): sign in; the Mock ASPSP's transactions grouped by day; a sheet opened and closed; the bank's error with the API stopped. Verify: recorded in `.tdd-state.md` with what was seen, without bank data

## 87. [wiring] Join — taking C7a's merge

Waits for C7a's merge (design.md D8).

- [ ] 87.1 Merge `main` with C7a's squash into the branch (memory: parallel PRs and squash merges). Resolve as design.md D13 says: `Banner`, `ProblemDescription` C7a's; `Skeleton`, `EmptyState`, `format.ts`, `server.ts`, `AcceptanceTest.cs`, `Program.cs`, `package.json` and the lock file merged by hand; `openapi.json` and `schema.d.ts` regenerated; `App.tsx` and `AccountScreen.tsx` C7a's, with the list put back in its content until group 90. Verify: build passes; the full suite green except what the join changes; a second regenerate leaves no diff; this change's delta against `main` holds no C7a line
- [ ] 87.2 A text in this change's specs that differs from C7a's merged wording is shown to the user, then fixed as `[plan]`. Verify: the user's answer recorded in `.tdd-state.md`

## 88. [acceptance] Join — scenario tests

- [ ] 88.1 The pre-join list tests get C7a's server setup: a balance answer, and the stored balance where the scenario says the phone keeps one (design.md D8). Verify: they still claim their scenarios; they pass where the join changes nothing
- [ ] 88.2 Acceptance: account-transactions / Refreshing replaces the newest transactions and keeps the older ones (frontend)
- [ ] 88.3 Acceptance: account-transactions / "Obnovuji…" lasts until the transactions have come too (frontend)
- [ ] 88.4 Acceptance: account-transactions / A bank that answers neither read shows one banner (frontend)
- [ ] 88.5 Acceptance: account-transactions / After the server wakes, the transactions replace the waiting screen directly (frontend)
- [ ] 88.6 Acceptance: account-transactions / The transactions stay on screen through a failed refresh (frontend)

## 89. [unit] Join — The screen with the list

- [ ] 89.1 After a refresh, the list holds the new newest page and every day already shown that is older than its `olderBefore`
- [ ] 89.2 A refresh whose page says nothing older is kept leaves the new page alone
- [ ] 89.3 The next older page after a refresh is asked before the last older page loaded
- [ ] 89.4 The banner shows the most important problem: offline, expired access, the limit, the bank not answering, the balance's unexpected answer, the list's unexpected answer
- [ ] 89.5 Both reads failing at the bank show "Banka teď neodpovídá"; the list alone failing shows "Pohyby se nepodařilo načíst"
- [ ] 89.6 A failed sign-out stays above the list's problem until the next action
- [ ] 89.7 "Obnovuji…" lasts while either read is under way
- [ ] 89.8 After the server woke, the waiting screen holds the list's place until the newest page has come, with no placeholders after it
- [ ] 89.9 A list on screen stays through a reload that fails, wakes or finds the phone offline
- [ ] 89.10 A failed older page never takes the banner

## 90. [wiring] Join — The list in C7a's screen

- [ ] 90.1 The list in C7a's slot; `useTransactionList` takes C7a's refresh signal, and reports its problem and whether it is reading to C7a's screen state; "Zkusit znovu" reads both; 401 and 403 go to C7a's screens; the list's offline note gives way to C7a's (design.md D8). Verify: the join's scenarios run against the app; the pre-join list tests stay green

## 91. [close] Join — Refreshing replaces the newest transactions and keeps the older ones

- [ ] 91.1 The scenario's test passes. Verify: green, including account-transactions / Refreshing replaces the newest transactions and keeps the older ones

## 92. [close] Join — "Obnovuji…" lasts until the transactions have come too

- [ ] 92.1 The scenario's test passes. Verify: green, including account-transactions / "Obnovuji…" lasts until the transactions have come too

## 93. [close] Join — A bank that answers neither read shows one banner

- [ ] 93.1 The scenario's test passes. Verify: green, including account-transactions / A bank that answers neither read shows one banner

## 94. [close] Join — After the server wakes, the transactions replace the waiting screen directly

- [ ] 94.1 The scenario's test passes. Verify: green, including account-transactions / After the server wakes, the transactions replace the waiting screen directly

## 95. [close] Join — The transactions stay on screen through a failed refresh

- [ ] 95.1 The scenario's test passes, then the local check of design.md § Migration plan step 4 with the balance. Verify: green, including account-transactions / The transactions stay on screen through a failed refresh; the check recorded in `.tdd-state.md`

## 96. [close] Acceptance green

- [ ] 96.1 All acceptance tests of this change pass, and the full suite is green. That includes `dotnet format whitespace RevolutReader.slnx --verify-no-changes`, the frontend build, and the traceability check (every scenario claimed exactly once). Verify: the commands' output
- [ ] 96.2 Docs: the software-factory lessons and inventory lines of design.md § Cross-cutting effects. Verify: each names the decision it records
- [ ] 96.3 `pm/progress.md`: the C7b row; Q7 decided (outcome, record: this design D1–D7 with the ADR-0001 and ADR-0005 amendments, the date). `CLAUDE.md` checked against every command this change added. Verify: the row links the change; `CLAUDE.md`'s commands run as written

## Workflow follow-up

- Push and open a draft PR on the owner's go; the owner's `/code-review xhigh --comment`; `/triage-review <PR>`; `/opsx:archive` in the same PR, before its merge (workflow.md § 6). The traceability check must pass first.
- The owner reviews and squash-merges the PR `feat: add account transactions (C7b)`, which closes #42.
- After the merge (design.md § Migration plan, step 6):
  - the deploy and its checks; the first open keeps 89 days;
  - the history import: the owner's temporary role (a PowerShell 7 block from Claude, run by the owner, checked read-only), the explicit check, the counts compared with the export's 116 settled, the role removed, the file and its backup deleted;
  - the list compared once with the Revolut app;
  - the counts, the deletion and ADR-0001's import note through a small follow-up docs PR.
