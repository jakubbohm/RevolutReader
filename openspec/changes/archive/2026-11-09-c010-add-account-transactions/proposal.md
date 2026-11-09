# Proposal: c010-add-account-transactions

## TL;DR

- **What:** UC2's second half, the transactions end to end. `GET /api/transactions` reads the last 31 days live as the signed-in user, keeps every settled transaction in the app's first table (Azure Table Storage, Azurite locally and in tests), and answers them with the koruna rate and its date. `GET /api/transactions/older` pages back through what is kept, about 30 transactions of whole days at a time, without asking the bank. The account screen gets the list grouped by day, its rows, the transaction sheet, automatic loading of older pages and the list's own states. A one-time import brings in the M1 history file, which is then deleted. The last task group waits for C7a's merge and joins the list to C7a's screen, refresh and banner.
- **Out of scope:** the balance, the waiting and offline screens and the banner itself (C7a); a daily koruna rate (#39); notifications (C8, C9); a time of day (the bank gives dates only); search or filters.
- **Riskiest assumption:** `bank_transaction_code.code` tells refunds apart. The M1 history holds none, and Revolut's documentation could not be read (403), so a code containing `REFUND` is a guess. A wrong guess shows a refund as a plain incoming payment, and the server logs every code it does not know.
- **Scenarios added** (`account-transactions`, API): The newest transactions come live with the koruna rate · The live read covers the last 31 days · After a long pause, the live read reaches back to the newest kept day · With nothing kept, the live read reaches back 89 days · A settled transaction stays in the history after the bank stops listing it · A pending transaction is never kept · Older transactions come from storage in pages of whole days · The oldest page says nothing older is kept · The bank's text leaves out the line that repeats the counterparty · A refund is told by the bank's type code · The bank sees the signed-in user's address and browser · A transactions request without a browser name reads nothing at the bank · Expired bank access answers its own problem · A reached bank limit answers its own problem · A bank that does not answer is its own problem
- **Scenarios added** (`account-transactions`, screen): The account screen lists the transactions by day, newest first · A row shows the counterparty, the bank's text and the amount with its koruna value · A row without the bank's own text names the kind of payment · A row without a counterparty names the kind of transaction · A row without a counterparty or text names an unknown kind by its direction · A pending transaction is marked as waiting · A refund is marked as one in the list and in its details · Tapping a transaction opens its details · The details leave out the description when the bank gave no text of its own · Older transactions load when the list reaches its end · Older transactions that failed to load can be tried again · The list ends where the history ends · The list shows placeholders while the transactions load · An account with no transactions says so · Expired bank access asks to let Dad know about the transactions · Too many refreshes shows a warning instead of the transactions · A bank that does not answer the transactions shows a retry · An unexpected answer to the transactions read shows a retry · Offline, the transactions load once the phone is back online
- **Scenarios added** (`account-transactions`, the join after C7a): Refreshing replaces the newest transactions and keeps the older ones · "Obnovuji…" lasts until the transactions have come too · A bank that answers neither read shows one banner · After the server wakes, the transactions replace the waiting screen directly · The transactions stay on screen through a failed refresh
- **Scenario added** (`bank-reads`, modified "What a transaction carries"): A transaction comes back with the bank's type code

## Why

Roadmap step **C7b** ([#42](https://github.com/jakubbohm/RevolutReader/issues/42)), use case **UC2** (kickoff ch. 5): below the balance, a scrollable list of transactions. With C7a it completes v1, the milestone where the daughter sees the balance and the transactions. C13's groundwork has merged (#57), so nothing on the backend waits for C7a. Every decision below was made with the user in explore on 2026-11-08 as one linked round (design.md D1–D9).

## What Changes

- **The newest page, live** (design.md D1, D3):
  - `GET /api/transactions` reads as the signed-in user present, with C13's present-user code; no browser named → 400, nothing read;
  - it reads from the earlier of 31 days back and the newest kept day, never more than 89 days back (the bank serves 90). With nothing kept, it reads 89 days;
  - it answers the last 31 days, pending ones included, newest first, with the koruna rate and the rate's date;
  - the bank's failures answer C13's problem descriptions; the newest page fails as a whole.
- **The history in storage** (D5):
  - every settled transaction the live read returns is kept, with its place within its day; pending ones never;
  - the first table in the app's storage account, one row per transaction keyed by the bank's reference; every request reads the whole table and cuts pages in memory, fine for a few hundred rows;
  - ADR-0005's "a date range is a key query" gets a dated amendment.
- **Older pages** (D1): `GET /api/transactions/older?before=<date>` answers about 30 transactions of whole days before that date, from storage only, and says whether anything older is kept.
- **What each transaction says** (D4):
  - the date only, never a time of day;
  - the counterparty, else a word for the kind of transaction ("Platba kartou", "Dobití účtu", "Převod", "Výběr z bankomatu", "Směna měny", else "Příchozí platba" or "Odchozí platba");
  - the bank's text without the line that repeats the counterparty (ignoring case, accents and spacing);
  - refunds by a type code containing `REFUND`, and every code the server does not know is logged.

  This needs the bank's type code, so the adapter now reads `bank_transaction_code.code` (spec `bank-reads`).
- **The screen** (D2, D6, D7, D14; Screens design after the design loop of 2026-11-08: Account / Detail / Scrolled, Loading older, Loading older failed, End of history and Empty, Account / Transaction sheet / Default):
  - the list grouped by day ("Dnes", "Včera", "středa 18. listopadu") with each day's totals;
  - rows with the koruna line from the start;
  - the sheet: the kind's word under the title, no "Komu / Od koho", "Popis" only when the bank wrote something beyond the name, the rate with its date;
  - the next page loads by itself near the end of the list (the design system's new `ListEnd`): "Načítám starší pohyby", "Starší pohyby se nepodařilo načíst" with "Zkusit znovu" (only the button retries), and "Žádné starší pohyby" where the history ends;
  - the list's own states: placeholders, empty, the three bank failures, an unexpected answer, offline.
- **The join with C7a** (D8), the last task group, after C7a merges: the list moves into C7a's slot, follows C7a's refresh signal and joins its one banner with the agreed precedence. This changes the roadmap's "Working in parallel" item 4, which put the koruna line into the last group: it comes from the start (the user, 2026-11-08; logged in `pm/progress.md`).
- **The history import** (D9): an explicit check, run once by the owner after the merge deploys, reads the M1 history file with the adapter's own page reader and mapping, and keeps the settled transactions from 2026-08-09 in the deployed table. It prints counts only, and running it twice changes nothing. The owner holds a temporary data role for it, granted and removed by the owner's own commands. The owner then deletes the file and its backup.
- **Records:** ADR-0005 item 4 amended (the table layout); ADR-0001 item 6 amended (the live read reaches back to the newest kept day, the import done); Q7 decided, its record this design (D1–D7); software-factory lessons.

## Capabilities

### New Capabilities

- `account-transactions`: the account's transactions. The API reads the newest ones live for the signed-in user, keeps the settled ones and pages back through them. The screen's list shows them by day with their rows, details sheet, older pages and its own states, and it joins the account screen's refresh and banner.

### Modified Capabilities

- `bank-reads`: "What a transaction carries" gains the bank's type code (`bank_transaction_code.code`, unchanged, possibly missing), with one new scenario. The two existing scenarios stay as they are.

Not touched: `api-errors` (the 400 and the bank problems are C13's and C7a's rules, applied as they are), `app-shell` and `sign-in` (C7a changes them; this change uses C7a's slot and banner only after the rebase).

## Non-goals

- **The balance, its header, its refresh, the waiting and offline screens, the banner:** C7a. This change joins them in its last task group.
- **A daily koruna rate:** [#39](https://github.com/jakubbohm/RevolutReader/issues/39). The answer carries C13's constant and its date.
- **A time of day:** Enable Banking's transaction dates are calendar dates (c004 design.md D3 heads-up 1). The design loop dropped the design system's time (2026-11-08).
- **Keeping pending transactions or transactions on the phone:** ADR-0001 item 6 and ADR-0007.
- **Search, filters, categories, export, any write toward the bank.**
- **A pending hold longer than 31 days:** it drops off the list while pending, as c004 design.md D7 accepted.
- **Notifications:** C8 and C9. The transaction store is the app's view of the history, never C9's record of what was notified (roadmap C9, item 3).

## Open questions

- **Decides Q7** (kickoff ch. 10): history from 2026-08-09 for the whole operation; pages of whole days, the newest the live 31 days, older ones from storage, loaded by themselves; each transaction shows its date, amount with the koruna line, counterparty or kind, the bank's own text and its status. Record: design.md D1–D7, with the data parts as dated amendments to ADR-0001 and ADR-0005.
- **Applies Q6** ([ADR-0001-bank-data-access § Decision](../../../docs/adr/0001-bank-data-access.md#decision)): every bank read here is the present user's, with that user's real address and browser; nothing is read unattended, so none of the 4 unattended reads a day is used.

## Impact

- **New code (backend):**
  - `src/RevolutReader.Api/Account/Transactions*`: the two endpoints and their handlers, the page rules, the transaction kinds;
  - the store port with its in-memory fake (unit tests) and its Table Storage adapter;
  - the bank adapter reads the type code (`EbTransaction`, `BankTransaction`, `TransactionMapping`).
- **New code (frontend):**
  - the transactions request, the list's rules and its hook in `src/app/`;
  - `TransactionList`, `DayGroup`, `DayHeader`, `TransactionRow`, `TransactionSheet`, the list end rows, `Skeleton` (list) and `EmptyState` (default) in `src/components/`;
  - `Banner`'s warning tone and action, built to C7a's published props, so the rebase keeps C7a's version.
- **Tests:**
  - Azurite in a test container for the acceptance harness and the store's contract tests;
  - `TransactionsDsl` and `TransactionsDriver`, with scenario dates relative to the test clock;
  - unit tests of the handlers and rules;
  - the history import's test against Azurite with a made-up file;
  - frontend scenario tests with a stand-in for the browser's IntersectionObserver.
- **Packages** (checked 2026-11-08):
  - backend: `Aspire.Azure.Data.Tables` 13.6.4 (2026-10-24);
  - AppHost: `Aspire.Hosting.Azure.Storage` 13.6.4;
  - tests: `Testcontainers.Azurite` 4.16.0 (2026-10-08) with the image `mcr.microsoft.com/azure-storage/azurite:3.37.0` pinned;
  - frontend: `@radix-ui/react-dialog` 1.3.1 (2026-10-12, MIT).
- **API contract:** two new endpoints; `openapi.json` and `schema.d.ts` regenerated.
- **Settings:** the `tables` connection (`ConnectionStrings:tables`) and a `Transactions` section with the table name, validated on start. No secret: the app reaches storage with its managed identity.
- **AppHost:** Azurite through `AddAzureStorage(...).RunAsEmulator()`, its tables referenced by the API.
- **Azure (Bicep):**
  - the table service and the `transactions` table in `strevolutreader`;
  - the app identity's Storage Table Data Contributor on it (already among the roles the deploy identity may grant);
  - the table address passed to the container app.
- **Azure by hand (the owner's go, after the merge):** the owner's temporary Storage Table Data Contributor for the import, granted and removed by the owner's own commands.
- **CI:** `dotnet test` now needs Docker for the acceptance tests too; GitHub's runners have it. No new job, so the ruleset on `main` stays.
- **Docs:**
  - ADR-0001 and ADR-0005 amendments;
  - `docs/conventions/` (testing.md: Azurite in the harness and scenario dates; README.md: the store; configuration.md: the new settings) and their `.claude/rules/` mirrors;
  - `docs/operations/` (deployment.md: the table and its checks; the import's run);
  - `docs/software-factory/` lessons and inventory;
  - `CLAUDE.md` § Commands (Docker for `dotnet test`, the import command, the image quick start's settings);
  - `pm/progress.md` and `pm/roadmap.md` (item 4).
