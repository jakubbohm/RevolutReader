# Proposal: c018-add-approximate-payment-time

## TL;DR

- **What:** a payment's details show its approximate time, e.g. "18. 11. 2026, kolem 14:05" ([#85](https://github.com/jakubbohm/RevolutReader/issues/85)). The bank gives no time of day, so the server keeps, for each transaction, the moment the app first got it from the bank, but only when that was on the transaction's own day. That is the bank's date, and the bank counts its days in UTC. The API answers this as `seenAt`. Both the app's own read and the account check record it. The check now also reads the transactions dated from yesterday on, as the phone, which sets the time within seconds of a payment. The phone lists a transaction with a time under that time's local date, so a payment at 0:20 in Prague shows under that day. The row stays as it is.
- **Out of scope:** the exact time (Enable Banking gives only dates); the place; a time on the row or in its spoken label; ordering by time within a day; a time for anything first read on a later day, or before this ships.
- **Riskiest assumption:** that card payments are dated in UTC like the transfer the owner observed just after midnight Prague time (none seen after midnight yet), and that the check runs within seconds of a payment. If a card payment were dated otherwise, the same-day rule leaves it without a time. It never shows a wrong one.
- **Added** (`account-transactions`): A transaction first read on its own day carries the time it was first read · A later read keeps the first time · The time stays when the payment settles · A transaction first read after its own day carries no time · A transaction without the bank's reference carries no time · A kept transaction on an older page carries its time · A payment seen after midnight is listed under the next day · The details show the approximate time after the date · The details of a payment seen after midnight show the next day. (`account-check`): The check reads the transactions from yesterday on · A payment a check reads first carries the check's time · Transactions a check reads are not kept · A failed transactions read leaves the check's notification and answer as they were.
- **Modified scenarios** (`account-check`): The bank sees the phone's address and browser name (both requests) · A burst of checks sends one notification and reads the bank at most twice (two balance and two transactions requests). Requirement texts change around unchanged scenarios: the newest page's field list, the list's grouping and the details' date (`account-transactions`); "balance read" where "read" became ambiguous (`account-check`). Nothing removed.

## Why

Issue [#85](https://github.com/jakubbohm/RevolutReader/issues/85). This is work after the initial development, so it has no roadmap step: the issue is its only tracker (`CLAUDE.md` § Project management). It touches **UC2** (the account detail: a transaction's details, and the days the list groups it under) and **UC3** (the account check the notification starts now also records the time; kickoff ch. 5). It applies no open question.

The list and the sheet show only a date, while the Revolut app shows the time. Enable Banking passes on only dates (`booking_date`, `value_date`, `transaction_date` are `string(date)`; issue #85). Since C9a (2026-11-21), the owner's iPhone starts an account check within seconds of every Revolut notification, and a card payment is already in Enable Banking when its notification appears (M1 spike, step 7). So the moment the app first gets a transaction is a good approximation of its time. Every behaviour below was decided with the owner in this change's explore and the decision round that followed (2026-11-22 and 2026-11-23). The owner also checked two things against the real account:

- **A pending card payment keeps its `entry_reference` when it settles.** In two reads a day apart (2026-11-21 and 2026-11-22), 5 of 5 settled ones kept it, with their date, amount, names and text unchanged.
- **The bank's dates are UTC dates.** An incoming transfer that the Revolut app shows just after midnight Prague time is dated the day before by the bank.

## What Changes

- **The first-seen time** (design.md D1, D2):
  - Every read of the transactions remembers when the app first got each transaction from the bank: the newest page's read, by any signed-in user, and now the account check's read. The moment is taken in UTC, to the whole second.
  - It is remembered only for a transaction dated that moment's own UTC day. That is the only time a time can be shown, and it leaves alone the ~90 older transactions of the first read after the deploy.
  - It is kept by the bank's `entry_reference`, so it carries over when a pending payment settles. A transaction without a reference gets none.
  - The earliest moment always stays, whichever reader writes first.
- **Where it is kept** (D3): a table of its own, `firstseentimes`, with one row per transaction it times. The row key is the reference's SHA-256, as in the `transactions` table, and the row holds one value, the moment. No amounts, names or texts. Pending transactions stay out of `transactions` (ADR-0001 item 6).
- **The API** (D4): every transaction on both pages (`GET /api/transactions` and `/older`) carries `seenAt`. It is that moment in UTC, to the second, when it fell on the transaction's own bank day, else `null`. `openapi.json` and the TypeScript client are regenerated.
- **The account check** (D5):
  - Besides the balance, the check reads the transactions dated from yesterday on, as the phone present (the same headers as its balance read), alongside the balance read.
  - It records first-seen times and nothing else: it keeps no transaction.
  - A failure of that read is logged and never changes the notification or the Shortcut's answer.
  - **Modifies** account-check's "the balance once, and nothing else" (c014 design.md D3).
- **The phone** (D6, D7):
  - **A transaction's day** is the phone's local date of its time when it has one, else the bank's date. The list groups by it: newest day first, newer bank dates first within a day, then the API's order. Day totals follow the group.
  - **The sheet's `Datum`** shows that day and "kolem" with the time in the phone's local time, e.g. `15. 11. 2026, kolem 0:20` for a payment dated 14 November and seen at 23:20 UTC.
  - **The row and its spoken label do not change.** This is the design system's `txDay`, `groupByDay`, `approxTime` and `approxTimeLabel` (version 1795426018-f0a0), already in the Screens design (version 1795426267-94e6).
- **Records** (D10):
  - **ADR notes:** dated notes in ADR-0001 (the pending reference survives settlement; the bank dates in UTC; the check's transactions read) and in ADR-0008 (what a check and a burst read).
  - **Spike:** `spikes/enable-banking/` step 9 with the two scripts and a counts-only evidence file; the owner's midnight sample in words only.
  - **Docs:** `configuration.md`, `testing.md` and `deployment.md`.
  - **The owner's paste goes last:** every prompt the owner fills in ends with the part to paste (workflow.md § 8, `.claude/rules/design.md`, lessons.md R-7).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-transactions`:
  - "The API answers the newest transactions live" adds `seenAt` to each transaction's fields.
  - A new requirement, "A transaction's approximate time": what `seenAt` is, who records it, the same-day rule, settlement, the reference, the older pages.
  - "The list on the account screen" groups by the transaction's day.
  - "A transaction's details" shows that day and the approximate time.
- `account-check`:
  - "The check reads the balance as the phone present" is renamed "The check reads the balance and the recent transactions as the phone present", and also reads the transactions from yesterday on.
  - Three new requirements: "The check records when it first reads a transaction", "The check keeps no transaction" and "The transactions read never changes the notification".
  - "One check at a time, one notification per burst" counts both reads in its burst scenario.
  - "The check keeps two balances" and "A bank failure answers as the balance does" say "balance read" where "read" alone became ambiguous.

## Non-goals

- **The exact time.** It would need direct Open Banking access as a licensed provider, or another bank-data service (issue #85).
- **The place** (address, map): Revolut's Open Banking data has none (issue #85).
- **A time on the row or in its spoken label** (the owner, 2026-11-22). Only the sheet's `Datum` shows it.
- **Ordering by time within a day.** Not every transaction has a time, so the bank's order stays.
- **A time for transactions first read after their own day,** whatever read them: anything first read late, everything from before the deploy, and every day the phone was off. "Approximate" covers minutes, not hours (the owner).
- **A UTC offset stored with the time.** The phone converts with its own time zone, and the server has no time-zone data.
- **Deleting the raw spike reads** (the owner: "we might find it usable"). They stay gitignored on the owner's machine.

## Impact

- **Backend:**
  - In `Account/`: the first-seen rule, the first-seen value and port, and the service both readers record through. `ShownTransaction` and `TransactionResponse` gain `SeenAt`. `ReadNewestTransactionsHandler` records and reads first-seen times, and `ReadOlderTransactionsHandler` reads them.
  - In `Check/`: the check's transactions read (`RecordFirstSeenHandler`), run by `AccountCheck` alongside its balance read, with a new log line in `CheckLog`.
  - In `Storage/`: the table adapter and its settings section `FirstSeenTimes`. `Program.cs` registers them.
- **API contract:** `seenAt` added to `TransactionResponse` (additive, nullable). `openapi.json` and `schema.d.ts` are regenerated, and every TS consumer is updated in this change.
- **Frontend:** the transaction's day and approximate time (`src/app/`), the list's grouping (`transactionList.ts`), the page check that accepts `seenAt`, and the sheet's `Datum`. No new token or component.
- **Infrastructure:** `infra/platform.bicep` gains the `firstseentimes` table, under the app's existing table role. No new role, secret or setting in Azure.
- **Bank load:** one more present-user request per check (the transactions from yesterday, one page), never an unattended read. A burst still runs at most two checks.
- **Tests:**
  - **Acceptance:** a time-of-day step on the scenario calendar, minutes passing, `seenAt` in the DSL's transaction, a fake bank that fails only the transactions read, and a table of each app copy's own.
  - **Contract:** tests of the first-seen store on Azurite and of its in-memory fake.
  - **Frontend:** tests in a fixed time zone (Europe/Prague).
