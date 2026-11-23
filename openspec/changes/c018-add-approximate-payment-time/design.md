# Design: c018-add-approximate-payment-time

## TL;DR

- **The time is the first sighting** (D1): the moment the app first got a transaction from the bank, taken when the bank's answer came, in UTC and cut to the whole second. Any read sets it: the newest page's, whoever asks, and now the account check's. The earliest moment always wins.
- **The same-day rule** (D2): a moment is recorded, and answered, only when its UTC date is the transaction's date. The bank counts its days in UTC (the owner's midnight sample). So a time is never wrong, only missing.
- **Kept in a table of its own** (D3): `firstseentimes`, row key the SHA-256 of `entry_reference` (as in `transactions`), one value, `SeenAt`. A new port, `IFirstSeenStore`: `Read` and `Record`, where `Record` keeps the earliest moment however the writes interleave. It has an in-memory fake and contract tests on Azurite.
- **The API** (D4): `seenAt` on every transaction on both pages, a `DateTimeOffset` at offset zero (as `readAt`), or `null`. It is additive and nullable; `openapi.json` and `schema.d.ts` are regenerated.
- **The account check** (D5):
  - A new `RecordFirstSeenHandler` reads the transactions from yesterday on, as the phone, alongside the balance read. It records first sightings and keeps no transaction.
  - It never throws but for the app's stop: a failure is logged as `FirstSeenNotRecorded` and changes nothing.
  - The check awaits it before ending, so a burst still runs at most two checks. The push never waits for it.
- **The phone** (D6, D7): the transaction's day is the local date of its time, else the bank's date (the design system's `txDay`). The list regroups all loaded transactions by it (`groupByDay`), and the sheet's `Datum` shows the day and "kolem" with the time. The row does not change, and there is no new token or component.
- **A page is not answered without its record** (D8): a first-seen store failure on a page read is an exception (500), as the transaction store's is.
- **Hard to reverse:** nothing. The table can be dropped (times are lost, nothing else). The `seenAt` field can be removed in a later change only by changing the contract.
- **Integration points:** Enable Banking (one more present-user request per check); Azure Table Storage (a new table in `infra/platform.bicep`, under the existing role); the design system 1795426018-f0a0 and the Screens design 1795426267-94e6.

## Context

See proposal.md (Why) for the motivation and the owner's two checks against the real account. The current state this design builds on:

- **The two readers of transactions.**
  - `ReadNewestTransactionsHandler` reads the store, then the bank as the present user (from `TransactionPaging.LiveReadStart`), keeps the settled ones with a reference, and answers the window's transactions. It has the koruna rate started first and awaited last (c017 D4).
  - `ReadOlderTransactionsHandler` answers kept transactions only and never reads the bank.
  - Both build `ShownTransaction`s, which `TransactionPageResponse` turns into the seven fields.
- **The bank's transaction.** `BankTransaction` carries `Reference` (the bank's `entry_reference`, nullable) and one `Date`: the transaction date, else the booking date, else the value date (c004 D3). The real account's pending and booked transactions both carry `entry_reference` and `booking_date` (ADR-0001 § Check 2; issue #85's reads of 2026-11-21 and 2026-11-22).
- **The account check** (c014): `AccountCheckQueue` runs one `AccountCheck` at a time, at most one waiting, on the app's lifetime. `AccountCheck.Run` reads the kept balances, then the balance through `ReadBalanceHandler` as the phone, then keeps, notifies and logs `CheckEnded`. It reads nothing else (c014 D3, the spec's "the balance once, and nothing else").
- **The stores** are Table Storage adapters on one tables client, each a singleton with `TableCreation`, a settings section with a validated `TableName`, and a table in `infra/platform.bicep` (`TableKorunaRateStore` is the newest model, c017).
- **The frontend.**
  - `transactionList.ts`'s `byDay` groups by `date` in the answer's order.
  - `withOlderPage` appends a page and merges a first day already shown.
  - The sheet's `Datum` is `formatDate(tx.date)`, read from the text and never through a `Date` (c010 D4d).
  - `src/test/timeZone.ts` has a synchronous `inTimeZone`.
- **The design.** The design system's version 1795426018-f0a0 adds the time and the transaction's day. The Screens design's 1795426267-94e6 copies it (design loop steps 1 to 4 done on 2026-11-23; D7).

## Goals / Non-Goals

**Goals:**

- One rule for the time, enforced in one place on the server, the same for both readers, and order-independent under concurrent readers.
- The phone decides only the day and how the time reads (its own time zone), from the instant the server gives.
- No change to what is kept in `transactions`, to the notification, or to the check's answer.

**Non-Goals:**

- Pruning `firstseentimes`. A few rows a day over the operating period (D3).
- Telling apart the reader that recorded a time.
- Backfilling times for transactions read before the deploy (proposal, Non-goals).

## Decisions

### D1 — The time is the first sighting (the owner, 2026-11-22)

- **What is recorded:** for each transaction, the first moment any read of the transactions got it from the bank. There are two such reads: the newest page's (any signed-in user) and the account check's. The older pages read no bank.
- **The moment** is the clock (`TimeProvider`) right after the bank's answer came (`FirstSeenRule.ReadAt`), in UTC and cut to the whole second:
  - "to the second" was the owner's choice (2026-11-23, item 4);
  - the sheet shows minutes;
  - whole seconds make the stored value exact in tests and in the table.
- **The earliest moment wins**, whichever read writes first (D3). Two reads seconds apart, e.g. the check and the daughter opening the app after the notification, keep the check's moment.
- **Keyed by `entry_reference`.** It survives settlement (5 of 5, 2026-11-22), so a time recorded while pending stays on the settled transaction. A transaction without a reference gets no time: nothing could match it later.
- **Alternatives:**
  - Only the check sets the time (issue #85's first idea). Rejected by the owner: the daughter's own read is just as early when she is the one paying.
  - The last sighting. Meaningless as a payment time.

### D2 — The same-day rule (the owner, 2026-11-22; the day's basis, 2026-11-23 item 3)

- **The rule:** a moment counts only when its UTC date equals the transaction's `date`.
  - **Written:** `FirstSeenRule.Sightings` takes, from a read, only the transactions dated `ReadAt`'s UTC date, pending or booked, each with a reference, each reference once.
  - **Answered:** `FirstSeenRule.Shown` gives the kept moment only when its UTC date is still the transaction's date, else `null`.
- **Why UTC:** the bank's dates are UTC dates. The owner's sample (2026-11-23), in words only as ADR-0001 records it: an incoming transfer that the Revolut app shows just after midnight Prague time is dated the day before by the bank, the UTC date of that moment, while card payments later that day are dated that day. This also confirms the app's UTC "today" (c010 D3).
- **Why both sides:**
  - **The write side** keeps rows to the transactions that can ever show a time. That leaves the ~90 older transactions of the first read after the deploy alone, and every day the phone was off.
  - **The read side** guards a date the bank changed between pending and booked. That was never observed (5 of 5 unchanged), but it would otherwise pair a time with the wrong day. One rule, so one function serves both.
- **What it gives:** a time is never wrong, only missing. Unobserved: a card payment after midnight. If one were dated otherwise, the rule hides its time.
- **Alternatives** (the owner, 2026-11-23, after challenging the first framing):
  - **C:** the server keeps UTC, and the phone shows the bank's date next to a local time (made up: "17. 11. 2026, kolem 0:20" for a payment the owner's daughter made at 0:20 on the 18th). Rejected: a date and a time that do not belong together.
  - **A:** the phone drops a time whose local date differs from the bank's date. Rejected: it loses correct times.
  - **B:** Prague time on the server. Rejected: the server has no time-zone data, and the phone already has its own zone.
  - **An offset stored with the time.** Not needed: the phone converts with its own zone.
- **Accepted risk:** a first read late enough to cross local midnight but not UTC midnight puts the payment under the next day, with a late time. Example: a payment at 23:50 Prague time first read at 00:30 shows under the next day, "kolem 0:30". "Approximate" covers minutes, not hours (the owner).

### D3 — Kept in a table of its own (the owner, 2026-11-23, item 1)

- **The table:** `firstseentimes` (section `FirstSeenTimes`, `TableName`). One partition, `account`. One row per timed transaction, keyed by the SHA-256 of the reference's UTF-8 bytes in lowercase hex, exactly as `TableTransactionStore` keys its rows. One column, `SeenAt`, a `DateTime` (Edm.DateTime) in UTC, whole seconds.
- **What the row holds:** no reference, amount, name or text. The port speaks references and the adapter hashes them, so the row key is all that links a row to a transaction.
- **`IFirstSeenStore`:**
  - **`Read(references)`** answers the kept moment of each given reference that has one, with one query of the partition, matched by hash.
  - **`Record(sightings)`** keeps, for each reference, the earliest moment ever recorded, and answers the moment kept for each sighting.
    - The adapter inserts each row (`AddEntity`).
    - On a conflict (409) it reads the row. When the kept moment is later, it replaces it under the row's ETag, and a lost race (412) tries again. Each try either ends or meets a strictly earlier kept moment, so it ends.
    - Rows are written one by one: a batch fails whole on one conflict, and a read records 0 to a few rows.
  - Recording the same moment again changes nothing. Recording an earlier one replaces the kept one, and a later one never does. So the result is the same in any order, from any number of readers or app copies (two run for a moment during a deploy).
- **No pruning.** A row costs ~100 bytes, and there are a few a day (~300 over the operation). `Read` reads the partition in one query.
- **The `transactions` table stays as ADR-0001 item 6 has it:** settled only.
- **Alternatives:**
  - Pending rows in `transactions`. Rejected: it reverses ADR-0001 item 6.
  - A `SeenAt` column on the settled row, with pending times held in memory until settlement. Rejected: the app scales to zero and would lose them.
  - Storing the reference in a column, so a page could read all rows at once alongside its other reads. Rejected: the row holds one value by the owner's decision, and the extra query is a table read of milliseconds after a bank read of about a second.

### D4 — The API field (the owner, 2026-11-23, item 4)

- **The field:** `TransactionResponse.SeenAt`, a `DateTimeOffset?`, the moment of D1 when D2's rule gives it, else `null`. It is on every transaction of both pages.
- **On the wire:** System.Text.Json writes a `DateTimeOffset` at offset zero as `2026-11-20T13:05:12+00:00`, as `readAt` already appears. The decision round's example, `2026-11-20T13:05:12Z`, is the same instant: the design system's "ISO 8601 instant in UTC" and every JavaScript `Date` read both forms. One form of instant across the API weighs more than the letter.
- **Description:** "When the app first got the transaction from the bank, in UTC to the second, when that was on the transaction's own day; null otherwise".
- **The contract:**
  - It is additive. The newest page's requirement now names eight fields.
  - `openapi.json` and `schema.d.ts` are regenerated (`npm --prefix tools/api-client run regenerate`).
  - Every TS consumer is updated in this change: the page check, the list, the sheet, and the frontend tests' answers, which gain `seenAt: null` where they give no time.

### D5 — The account check also reads the transactions (the owner, 2026-11-23, item 2)

- **`RecordFirstSeenHandler.Handle(user)`** (in `Check/`, used only by the check):
  - It reads `IBankAccount.ReadTransactions(from: yesterday, the present user)`, where yesterday is the UTC date before the clock's. This is the phone's own headers, as for the balance (ADR-0008 item 3), never an unattended read.
  - On success it records through `FirstSeenTimes.Record`, the same path as the newest page (D1, D2).
- **Why from yesterday on.** Only today's transactions can get a time (D2). The extra day costs no request (one page either way), keeps the read independent of which of a transaction's dates the bank's `date_from` compares, and covers a check that straddles midnight. It was decided before item 3 settled the day's basis, and the decision stands.
- **It keeps nothing.** Only the newest page keeps transactions, and its reach-back (c010 D3) starts from the newest kept day. A check keeping its narrow window would move that day forward and hide a gap the page should close, since a card payment settles a few days later still dated its own day. The spec's "Transactions a check reads are not kept" shows this through the page's read.
- **In the check.** `AccountCheck.Run` still reads the kept balances first, so a storage failure costs no bank read. It then starts the recording, runs the balance read and the rest as now, and awaits the recording in a `finally`, so the recording ends before the check does whatever the balance path did:
  - **A burst** still runs at most two checks, with two bank reads each.
  - **The app's stop** cancels both reads.
  - **The push** goes out as soon as the balance path sends it, never waiting for the transactions.
  - **The Shortcut's answer** waits for the recording. At worst that is the bank client's 15 s limit with its retries, when the bank is failing.
- **It never throws but for cancellation:**
  - a bank failure logs `FirstSeenNotRecorded` with its kind (`BankAccessExpired`, `BankRateLimited`, `BankUnavailable`);
  - any exception (storage, a bug) logs the same event as `Failed`, with the exception;
  - the app's stop passes as `OperationCanceledException`.

  Exceptions carry no bank data (README.md § Backend code; the table adapters name columns only). So the notification and the answer are exactly the balance path's (spec: "The transactions read never changes the notification").
- **Modifies** c014 D3 ("the balance only") and account-check's "and nothing else". ADR-0001 item 6 already expected the check to read the recent window (D11).
- **Alternatives:**
  - Balance-only, the daughter's read alone setting times. Rejected: times late by hours.
  - Fire-and-forget after the answer. Rejected: it escapes the queue's one-check-at-a-time bound and the app's stop.

### D6 — The phone: the transaction's day, the list and the sheet (the owner, 2026-11-22 and 2026-11-23, item 3)

The design system's reference code is translated into the app's own (`.claude/rules/design.md`), never copied. The app keeps days as `yyyy-MM-dd` text, as now:

- **`approxTime(tx)`** (`src/app/transactionDay.ts`): `seenAt` as a `Date`, or `null` when there is none or it does not parse (the design system's `approxTime`).
- **`transactionDay(tx)`:** the phone's local date of `approxTime` as `yyyy-MM-dd` when there is one, else `tx.date` (the design system's `txDay`).
- **`byDay`** (`transactionList.ts`) groups by `transactionDay`:
  - days newest first;
  - within a day, newer `date` first, then the order given (a stable sort), so a payment moved in from the bank's previous day comes last in its day;
  - totals over the group (the design system's `groupByDay`, DayGroup note).
- **`ListState`** keeps the loaded transactions, `newest` (the newest page's) and `olderLoaded` (every older page's, in the order they came), and derives `days = byDay([...newest, ...olderLoaded])` (the design system's ListEnd note: "Regroup all loaded transactions with `groupByDay`").
  - A newest page read again replaces `newest` and keeps the `olderLoaded` dated before its `olderBefore`, as `withNewestPage` keeps older days now.
  - An older page appends to `olderLoaded`.
  - This replaces `withOlderPage`'s merge of a first day already shown: regrouping gives one heading per day by construction, also when a moved payment joins a day of the previous page.
- **`formatApproxTime(time)`** (`format.ts`): `kolem` + no-break space + `H:mm` in the phone's local time (the existing `formatTime`; the design system's `approxTimeLabel`).
- **The sheet's `Datum`:** `formatDate(transactionDay(tx))`, then, with a time, `, ` + `formatApproxTime(...)`. For example `18. 11. 2026, kolem 14:05`, or `15. 11. 2026, kolem 0:20` for a payment dated the 14th seen at 23:20 UTC.
- **`transactionOf`** (`transactions.ts`) accepts `seenAt` as text or `null`, with exactly eight members. Any other value makes the page unexpected, as for every other field. A text that does not parse is accepted and shows no time (`approxTime`), as the design system says.
- **Unchanged:** `TransactionRow` and its spoken label (the owner, 2026-11-22), `DayHeader`'s look and words, and the row's order within a bank date.

### D7 — Design parts and artboards (design loop, 2026-11-23)

The change implements:

- **From the design system** (https://claude.ai/artifact/5pHJrprsxkXFyJD6ie6pXn, version 1795426018-f0a0):
  - `tx.ts`: `Tx.seenAt` and `Tx.date` as now commented, `approxTime`, `txDay`, `groupByDay`;
  - the format helper `approxTimeLabel`;
  - **TransactionSheet**: `Datum`, with its README's examples, and the preview's fourth phone, the midnight case;
  - **DayGroup / DayHeader**: the README note (grouping by `txDay`, newer bank dates first, totals follow the group), and the preview's midnight block;
  - **ListEnd**: the README note on regrouping;
  - the sample `SAMPLE.midnight`.
- **From the Screens design** (https://claude.ai/artifact/BbFPxcBjrd8jUbcPZi3Yq7, version 1795426267-94e6, its copy of the design system at 1795426018-f0a0):
  - **`account-sheet-a`**, the transaction sheet, `Datum` "5. 11. 2026, kolem 14:05";
  - **`Main` and the account list boards**: their sample transactions carry `seenAt`, and none changes day.

No new token, no new component. Design loop step 4, checked 2026-11-23: the Screens' copy and `sample-data.js` match the design system's list of changes. `/tdd-apply` § 0 hands the implementer the saved files: `tx.ts`, the TransactionSheet, DayHeader and ListEnd READMEs, `sample.ts`, and the Screens' `sample-data.js` and `account-sheet-a.dc.html`.

### D8 — A page is not answered without its record *(propose)*

On a page read, `IFirstSeenStore` failures are exceptions, answered as C7a's 500 (spec api-errors), as the transaction store's are (c010 D5: "the page is not answered without its write").

- **Why not answer without times:** a page answered without its record would let the next read record a later moment as the first. That is a silently late time. The two tables are in one storage account, so a storage outage fails the transaction store anyway.
- **The check is the exception** (D5): there the recording is a side task and must never change the notification.
- **Alternative:** answer the page without times and log. Rejected for the reason above.

### D9 — Where the code lives *(propose)*

- **`Account/`:** `FirstSeen`, `FirstSeenRule`, `IFirstSeenStore`, `FirstSeenTimes` (used by the newest page and the check), and the changed `ShownTransaction`, `TransactionPageResponse` and both handlers. `TransactionsRegistration.AddTransactions` registers `FirstSeenTimes` (scoped).
- **`Check/`:** `RecordFirstSeenHandler`, `FirstSeenFailure`, and the new `CheckLog` lines. `AccountCheckRegistration.AddAccountCheck` registers the handler (scoped).
- **`Storage/`:** `FirstSeenStoreOptions`, `TableFirstSeenStore`, and `StorageRegistration.AddFirstSeenStore` (a singleton, on the tables client `AddTransactionStore` registers). `Program.cs` calls it after `AddKorunaRateStore`.
- **`appsettings.json`:** `FirstSeenTimes:TableName` `firstseentimes`, commented like `KorunaRates`.
- **`infra/platform.bicep`:** the table next to `korunarates`. No `features.bicep`, `main.bicep` or `.bicepparam` change.

### D10 — Tests *(propose)*

- **Acceptance kit** (the test-writer's; § Public API sketch):
  - **The scenario calendar:** a time of day for any day, `Transactions.TodayIsAt(day, utcTime)` (`ScenarioCalendar.TodayIsAt`, c017), and `Transactions.TimeIs(utcTime)`, the clock forward to that UTC time of the scenario's today.
  - **`TransactionSeenInApi.SeenAt`:** an instant, or `null` by default, shifted back by the calendar's days like the dates (`ScenarioCalendar.FromClock(DateTimeOffset)`). The driver reads the eighth member as an instant at offset zero with whole seconds, or `null`.
  - **`Bank.ReportsOwnErrorForTransactions()`:** every transactions attempt answers the bank's own error, and the balance answers as set.
  - **`Bank.TransactionsRequestsReceived()`** next to `BalanceRequestsReceived()`.
  - **`AzuriteStorage`** sets `FirstSeenTimes:TableName` to a table of each app copy's own.
- **The existing tests that change:**
  - **The exact-shape check:** the driver's transaction members go from seven to eight.
  - **`AccountCheckDriver`'s burst and leaving caller** hold the balance answer only, as now. The transactions request is not held, and the fake answers it from its default.
  - **The conventions' telemetry tests:** a check now makes two bank requests. `AccountCheckTelemetryTests` gains `FirstSeenNotRecorded` (Warning, kind only), and `BankTelemetryTests` counts the dependencies per check.
- **Unit tests:** `FirstSeenRule`, `FirstSeenTimes`, both handlers, `RecordFirstSeenHandler` and `AccountCheck`, with `InMemoryFirstSeenStore` (the earliest moment kept, records counted) and the existing fakes. `AccountCheck`'s tests prove that the recording runs alongside the balance read and is awaited before the check ends. They use a held bank fake, as c017's rate tests do.
- **Contract tests:** `FirstSeenStoreContract` against `InMemoryFirstSeenStore` (the unit tests' file, linked) and `TableFirstSeenStore` on Azurite (§ Ports and contracts). Adapter edge cases in `Wiring/Storage`: a row it cannot read, and the ETag race of two `Record` calls at once against Azurite.
- **Frontend:**
  - **Scenarios:** the three new scenarios in `src/scenarios/account-transactions.test.tsx`, in `Europe/Prague` through a new async form of `inTimeZone` (`src/test/timeZone.ts`).
  - **Unit tests:** `transactionDay`, `approxTime`, `byDay`, `withNewestPage`, `withOlderPage`, `formatApproxTime`, `transactionOf` and the sheet, next to their code. The time-zone rules run in Prague and in `America/Los_Angeles`.

### D11 — Records *(the owner, 2026-11-23, item 5; propose for ADR-0008)*

- **ADR-0001** (notes dated the day they are written, in the close of the slice that proves each):
  - **At § Transaction history, Check 2's heads-up** ("Whether a pending transaction keeps its `entry_reference`…"): answered. Two reads a day apart (2026-11-21 and 2026-11-22): 5 of 6 pending card payments were booked under the same `entry_reference`, 1 still pending and 0 gone. Their date, amount, names, text and type code were unchanged, and `value_date` appeared at booking + 1 day. The counts-only evidence is linked.
  - **At the Enable Banking bullet** (pending left out of matching "unless their ID survives"): on Revolut it does. The app still keeps only settled ones (item 6), and matches pending ones only for their first-seen time (c018).
  - **The bank's dates are UTC dates** (the owner's midnight sample of 2026-11-23, in words only: no amount, name or exact date). This confirms the app's UTC today (c010 D3).
  - **At item 6's "(Since ADR-0008: the phone-triggered check reads it…)":** the check read the balance only from C9a (c014 D3). Since c018 it also reads the transactions from yesterday on, only to record first-seen times, and keeps none.
- **ADR-0008** (dated notes):
  - at Decision item 1, the check reads the balance and, since c018, the transactions from yesterday on;
  - at the constraint "safe to call more than once", a burst still runs at most two checks, now two bank reads each.
- **`spikes/enable-banking/`:**
  - **README:** step 9, "Does a pending transaction keep its reference when it settles? (issue #85, 2026-11-21/22)", with how to run it, the finding and the verdict line.
  - **Scripts:** `read-pending.ps1` and `compare-pending.ps1` (counts only on screen, the raw reads to the gitignored `secrets/`).
  - **Evidence:** `evidence/2026-11-22-pending-settlement.json`, counts only (the file in the session's scratchpad, checked to hold no bank data).
  - The raw reads stay on the owner's machine (the owner: kept), gitignored.
- **`docs/conventions/configuration.md`:** the `FirstSeenTimes` section.
- **`docs/conventions/testing.md`** and its mirror `.claude/rules/testing.md`: the new kit steps (time of day, `seenAt`, the transactions-only bank failure, the async time zone).
- **`docs/operations/deployment.md`:** the storage account row (the `firstseentimes` table: hashes and moments, no bank text), and the check's `FirstSeenNotRecorded` line in its log section.
- **`docs/software-factory/lessons.md`:** R-7's bullet (D12). No other lesson. Reversing c010 D3(a) ("no time of day anywhere") and c014 D3 ("the balance only") is an app decision, recorded here and in the specs.

### D12 — Prompts end with what the owner pastes (the owner, 2026-11-23, item 6)

A prompt the owner fills in and sends ends with the part to paste. It is easier for the owner, above all on a phone: the cursor goes to the end, with nothing to place mid-text. This is a docs-only part of this change, done in its last close:

- **workflow.md § 8:**
  - Step 2's update prompt becomes "Update the design system to its latest version. Then bring everything this canvas made itself into line with its changes: tarjeta-tokens.css, tarjeta-tokens-dark.css, and any text, colour or layout written directly in an artboard. Change nothing else, then list what you changed. The design system's changes:", followed by `<paste the list>`.
  - Step 3's example becomes "Apply the design system's changes. The list: <paste the list>".
  - One sentence states the rule for every prompt the owner fills in.
- **`.claude/rules/design.md` step 3:** the list goes at the end of the prompt.
- **lessons.md R-7:** a bullet (New, 2026-11-23): pasted text goes last.
- **The handover inventory rows** (creating-handover-package.md) are unchanged.
- Claude already writes prompts this way.

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Account/FirstSeen.cs
namespace RevolutReader.Api.Account;

/// <summary>A transaction's first sighting to record (D1): the bank's reference and the moment, in UTC, to the whole second.</summary>
public sealed record FirstSeen(string Reference, DateTimeOffset At);

// ---- Account/FirstSeenRule.cs — the rules (D1, D2), pure
public static class FirstSeenRule {
  /// <summary>The moment a read got its answer: <paramref name="now"/> at offset zero, cut to the whole second.</summary>
  public static DateTimeOffset ReadAt(DateTimeOffset now);

  /// <summary>
  /// What a read at <paramref name="readAt"/> records: each transaction, pending or settled, with a reference, dated
  /// <paramref name="readAt"/>'s UTC date, at <paramref name="readAt"/>; a reference listed twice once.
  /// </summary>
  public static IReadOnlyList<FirstSeen> Sightings(IReadOnlyList<BankTransaction> read, DateTimeOffset readAt);

  /// <summary>What <c>seenAt</c> answers for a transaction dated <paramref name="date"/>: <paramref name="firstSeen"/> when its UTC date is <paramref name="date"/>, else null.</summary>
  public static DateTimeOffset? Shown(DateOnly date, DateTimeOffset? firstSeen);
}

// ---- Account/IFirstSeenStore.cs — the port (D3)
public interface IFirstSeenStore {
  /// <summary>The kept moment of each of <paramref name="references"/> that has one; the others absent. Nothing asked: no request.</summary>
  Task<IReadOnlyDictionary<string, DateTimeOffset>> Read(IReadOnlyCollection<string> references, CancellationToken cancellationToken);

  /// <summary>
  /// For each sighting, the earliest moment ever recorded for its reference is kept: recorded when none is, replacing a
  /// later one, never an earlier one; the same in any order and from any number of callers at once. Answers the moment
  /// kept for each sighting's reference after the call. Nothing to record: no request.
  /// </summary>
  Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<FirstSeen> sightings, CancellationToken cancellationToken);
}

// ---- Account/FirstSeenTimes.cs — scoped; how both readers record (D1, D2, D5)
public sealed class FirstSeenTimes(IFirstSeenStore store) {
  /// <summary>
  /// The kept moments of <paramref name="read"/>'s references once this read is recorded: reads them, records the read's
  /// sightings (FirstSeenRule.Sightings) whose reference has none yet, and answers both, the recorded ones as Record
  /// answers them. Store failures throw.
  /// </summary>
  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<BankTransaction> read, DateTimeOffset readAt, CancellationToken cancellationToken);
}

// ---- changed
public sealed record ShownTransaction(DateOnly Date, decimal Amount, string Currency, bool Pending, string? Counterparty,
  IReadOnlyList<string> Details, TransactionKind Kind, DateTimeOffset? SeenAt);
//   ShownTransaction.Of(..., string? typeCode, DateTimeOffset? seenAt)
public sealed record TransactionResponse(DateOnly Date, decimal Amount, string Currency, bool Pending, string? Counterparty,
  IReadOnlyList<string> Details, TransactionKind Kind,
  [property: Description("When the app first got the transaction from the bank, in UTC to the second, when that was on the transaction's own day; null otherwise")] DateTimeOffset? SeenAt);

/// After the bank's answer: readAt = FirstSeenRule.ReadAt(time.GetUtcNow()); the page's transactions recorded and read
/// through FirstSeenTimes.Record (D1, D2); each one's SeenAt = FirstSeenRule.Shown(date, kept moment). A bank failure
/// records nothing. A store failure throws (D8).
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, FirstSeenTimes firstSeen, IKorunaRates rates, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger);

/// The page's references read in IFirstSeenStore.Read once the page is cut; SeenAt = FirstSeenRule.Shown. A store failure throws (D8).
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, IFirstSeenStore firstSeen, IKorunaRates rates);

// ---- src/RevolutReader.Api/Check/RecordFirstSeenHandler.cs — scoped (D5)
namespace RevolutReader.Api.Check;

public sealed class RecordFirstSeenHandler(IBankAccount bank, FirstSeenTimes firstSeen, TimeProvider time, ILogger<RecordFirstSeenHandler> logger) {
  /// <summary>
  /// Reads the transactions from the UTC day before the clock's today as <paramref name="user"/> and records them
  /// (FirstSeenTimes.Record, at FirstSeenRule.ReadAt of the clock after the answer). Never throws but for
  /// <paramref name="cancellationToken"/>: a bank failure logs FirstSeenNotRecorded with its kind; any exception logs it
  /// as Failed, with the exception.
  /// </summary>
  public Task Handle(PresentUser user, CancellationToken cancellationToken);
}

/// <summary>Why a check recorded no first-seen times (D5).</summary>
public enum FirstSeenFailure { BankAccessExpired, BankRateLimited, BankUnavailable, Failed }

// CheckLog: one event in two forms, as c017's KorunaRateAskFailed
[LoggerMessage(EventName = "FirstSeenNotRecorded", Level = LogLevel.Warning, Message = "An account check recorded no first-seen times: {Failure}")]
public static partial void FirstSeenNotRecorded(ILogger logger, FirstSeenFailure failure);
[LoggerMessage(EventName = "FirstSeenNotRecorded", Level = LogLevel.Warning, Message = "An account check recorded no first-seen times: {Failure}")]
public static partial void FirstSeenNotRecordedWithException(ILogger logger, FirstSeenFailure failure, Exception exception);

/// Kept balances read first; then the recording started (recorder.Handle), the balance read and the rest as before;
/// the recording awaited in a finally (D5).
public sealed class AccountCheck(ReadBalanceHandler reader, RecordFirstSeenHandler recorder, ICheckedBalanceStore store, ChangeNotifier notifier, ILogger<AccountCheck> logger) : IAccountCheck;

// ---- src/RevolutReader.Api/Storage/
public sealed class FirstSeenStoreOptions { public const string SECTION = "FirstSeenTimes"; [Required, RegularExpression(TABLE_NAME_PATTERN)] public required string TableName { get; init; } }
/// Partition "account", row key the SHA-256 of the reference (lowercase hex), column SeenAt (UTC); TableCreation; D3's insert, then the ETag-guarded replace.
public sealed class TableFirstSeenStore(TableServiceClient tables, IOptions<FirstSeenStoreOptions> options) : IFirstSeenStore;
// StorageRegistration:
public static IHostApplicationBuilder AddFirstSeenStore(this IHostApplicationBuilder builder);
```

```csharp
// ---- tests/RevolutReader.AcceptanceTests — DSL and drivers
// TransactionsDsl
/// <summary>Today is <paramref name="day"/> at <paramref name="utcTime"/> UTC (ScenarioCalendar.TodayIsAt): only after signing in.</summary>
public void TodayIsAt(DateOnly day, TimeOnly utcTime);
/// <summary>The clock moves forward to <paramref name="utcTime"/> UTC on the scenario's today; an earlier time throws.</summary>
public void TimeIs(TimeOnly utcTime);

// ScenarioCalendar
public void TimeIs(TimeOnly utcTime);
/// <summary>The scenario's instant for an instant the app gave: the same time of day, its date shifted back as FromClock(DateOnly).</summary>
public DateTimeOffset FromClock(DateTimeOffset clockInstant);

// TransactionSeenInApi gains DateTimeOffset? SeenAt (compared by value); Settled and StillPending gain DateTimeOffset? seenAt = null.
public sealed record TransactionSeenInApi(DateOnly Date, decimal Amount, bool Pending, string? Counterparty, Lines Details, string Kind, DateTimeOffset? SeenAt = null);

// BankDsl
/// <summary>Every transactions request, each attempt, answers the bank's own error; balances answer as set.</summary>
public void ReportsOwnErrorForTransactions();
public IReadOnlyList<RequestAtBank> TransactionsRequestsReceived();

// FakeBank: public void AnswerTransactionsWithOwnError();  BankDriver: TransactionsRequestsReceived()
// TransactionsDriver: eight members per transaction; seenAt read as an instant at offset zero, whole seconds, or null.
// AzuriteStorage.Configure: FirstSeenTimes:TableName, a table of the app copy's own.
```

```ts
// ---- src/RevolutReader.Web/src/app/transactionDay.ts (D6)
/** `seenAt` as a Date, or null when there is none or it does not parse (the design system's approxTime). */
export function approxTime(transaction: Pick<Transaction, "seenAt">): Date | null;
/** The transaction's day, `yyyy-MM-dd`: the phone's local date of approxTime when there is one, else `date` (txDay). */
export function transactionDay(transaction: Pick<Transaction, "date" | "seenAt">): string;

// ---- src/app/format.ts
/** `kolem 14:05`: a no-break space after "kolem", the time in the phone's local time (approxTimeLabel). */
export function formatApproxTime(time: Date): string;

// ---- src/app/transactionList.ts
/** By transactionDay, newest day first; within a day newer `date` first, then the order given; totals per day (groupByDay). */
export function byDay(transactions: Transaction[]): Day[];
export interface ListState {
  days: Day[];                 // byDay([...newest, ...olderLoaded])
  newest: Transaction[];       // the newest page's transactions
  olderLoaded: Transaction[];  // every older page's, in the order they came
  nextBefore: string | null;
  older: "idle" | "loading" | "error";
}
export function withNewestPage(state: ListState | null, page: TransactionPage): ListState;
export function withOlderPage(state: ListState, page: TransactionPage): ListState;

// ---- src/test/timeZone.ts
/** As inTimeZone, for an async body: the zone is set back once the body's promise settles. */
export function inTimeZoneWhile(zone: string, body: () => Promise<void>): Promise<void>;
```

## Rule ownership

| Rule (spec) | Enforced by |
|---|---|
| `seenAt` is the first moment any read got the transaction, the earliest kept (account-transactions) | `FirstSeenTimes` (both readers), `IFirstSeenStore.Record` (earliest wins) |
| The moment is taken when the bank answered, in UTC, to the whole second (account-transactions) | `FirstSeenRule.ReadAt`, called by both readers after the answer |
| Only on the transaction's own UTC day, otherwise null (account-transactions) | `FirstSeenRule.Sightings` (written), `FirstSeenRule.Shown` (answered) |
| No reference, no time (account-transactions) | `FirstSeenRule.Sightings` |
| The time stays when the transaction settles (account-transactions) | the key: the reference, unchanged at settlement (D1) |
| Older pages carry the time (account-transactions) | `ReadOlderTransactionsHandler` |
| Exactly eight fields per transaction (account-transactions) | `TransactionResponse`, `TransactionPageResponse.Of` |
| The check reads the transactions from yesterday on, as the phone (account-check) | `RecordFirstSeenHandler` |
| A check records first sightings by the same rule (account-check) | `RecordFirstSeenHandler` through `FirstSeenTimes` |
| A check keeps no transaction (account-check) | `RecordFirstSeenHandler` (never calls `ITransactionStore`) |
| A failed transactions read changes neither the notification nor the answer (account-check) | `RecordFirstSeenHandler` (never throws but for cancellation), `AccountCheck` (awaits it apart from the outcome) |
| At most two checks per burst, two bank reads each (account-check) | `AccountCheckQueue` (unchanged), `AccountCheck` (the recording awaited within the check) |
| A transaction's day: the local date of its time, else its date (account-transactions, list and details) | `transactionDay` |
| Grouping by that day, newer dates first, totals per group (account-transactions) | `byDay`, `ListState` regrouping all loaded |
| `Datum`: the day, ", kolem" and the local time (account-transactions) | `TransactionSheet` with `formatDate`, `formatApproxTime` |

## Error model

- `FirstSeenRule` is pure and never fails.
- `IFirstSeenStore.Read` and `Record` throw on storage failures, as the other stores do. A row it cannot read is an `InvalidOperationException` naming the column, never its value. A lost ETag race is retried inside `Record`, never surfaced.
- `FirstSeenTimes.Record` lets the store's exceptions pass.
- **The page handlers' error models are unchanged:** a bank failure is a `BankResult` case and records nothing, and a store failure (now also the first-seen store's) throws and is answered as 500 (D8).
- **`RecordFirstSeenHandler.Handle`** returns normally for every bank failure and every exception, logged (D5). Only the caller's cancellation throws `OperationCanceledException`.
- **`AccountCheck`'s error model is unchanged** (c014 D11). The recording neither adds a failure nor hides one: it is awaited in a `finally`, never throws there but for the app's stop, and in that case the check is being cancelled anyway.

## Ports and contracts

- **`IFirstSeenStore`** (new; real adapter `TableFirstSeenStore`, Table Storage, table `FirstSeenTimes:TableName`):
  - **Not found:** `Read` answers only the references that have a moment. A reference never recorded is absent, never an error.
  - **Earliest wins:** `Record` keeps the earliest moment per reference. Recording a later moment changes nothing and answers the kept one, and recording an earlier one replaces it. The result is the same in any order.
  - **Concurrency:** two `Record` calls at once for one reference keep the earlier moment (an insert, then an ETag-guarded replace, retried on a lost race). Two app copies behave as two callers.
  - **Idempotency:** recording the same sighting twice changes nothing.
  - **Values:** moments come back exactly as given (UTC, whole seconds). A reference with any characters, `/ \ # ?` and `%` among them, is stored under its hash.
  - **Nothing asked or nothing to record:** no request.
  - **The table** is created when missing, once per instance (`TableCreation`).
  - **Ordering:** none. Answers are maps.
  - A contract test (`FirstSeenStoreContract`) runs against both the in-memory fake (`InMemoryFirstSeenStore`, in the unit tests, linked into the integration project) and the real adapter on Azurite. The unit tests use the fake, which also counts `Read` and `Record` calls.
- **`IBankAccount`** is unchanged. The check calls `ReadTransactions` with a present user, as the newest page does.
- **`ITransactionStore`** is unchanged, and the check never calls it.

## How each scenario is verified

- **API acceptance tests,** the default level, for the 12 new and modified API scenarios: account-transactions' 6 new ones, and account-check's 4 new ones and 2 modified ones. Every outcome is an answer of the API, a request the fake bank received, or a push the fake push service received.
- **Frontend scenario tests** (`src/scenarios/account-transactions.test.tsx`), because the rule shows only in the browser: the phone's time zone decides the day and the time. They run in `Europe/Prague`:
  - A payment seen after midnight is listed under the next day;
  - The details show the approximate time after the date;
  - The details of a payment seen after midnight show the next day.

  The unchanged frontend scenarios of the modified requirements stay where they are.
- **Manual:** none. After the deploy, the owner's first small payment shows its time in the sheet. That is a routine look, not a scenario.

## Cross-cutting effects

- **Bank load:** each check makes one more present-user read (usually one page: yesterday and today). It is never unattended, so Revolut's 4-a-day limit does not apply (ADR-0008 item 3). A burst makes at most four bank reads, each retried as the bank client retries a present user's request.
- **Telemetry:** one more bank dependency per check, and `FirstSeenNotRecorded` only on a failure. No new line on the pages.
- **Privacy:** the table holds hashes and moments, nothing logged. A moment is the owner's daughter's payment time, kept in the app's private storage, as the transactions are, and never published.
- **Local development:** Aspire's Azurite creates the table on first use. Nothing to set up.
- **The image quick start and the OpenAPI export** need no new setting: the table name has its default, and neither touches the table.
- **The history import** is unchanged: it writes `transactions` only, so imported transactions have no time, as decided.

## Risks / Trade-offs

- [A card payment after midnight is dated otherwise than UTC] → `Shown` hides its time. The worst case is a missing time, never a wrong one. The owner watches for such a sample, and a fix would be a rule change in `FirstSeenRule` alone.
- [A first read late enough to cross local midnight but not UTC midnight] → the payment is listed under the next day with a late time. Accepted by the owner (D2).
- [The check's transactions read is slow or failing] → the Shortcut's answer waits up to the bank client's 15 s limit. The push is already out, and the next check is held as long. It happens only during a bank outage, when the balance read fails too.
- [The phone was off at a payment, so no check ran] → the daughter's next read on the same UTC day sets a late time, and on a later day none. "Approximate" is minutes by intent, and an hours-late time on the same day is accepted with the same-day rule.
- [Clocks of two app copies differ during a deploy] → earliest wins, so at most the earlier clock's second.
- [`firstseentimes` grows without pruning] → ~300 rows by the end of the operation, read in one query. If the app outlives that by years, a later change partitions by month.
- [Revolut's pending transaction comes without `entry_reference`] → no time for it (a scenario). Never observed on this account.

## Bootstrap (before `/tdd-apply`)

Committed as `[setup]`, before the session's scratchpad can be cleared:

- Copy `read-pending.ps1` and `compare-pending.ps1` from the session's scratchpad (`C:\Users\jakub\AppData\Local\Temp\claude\4a18c271d9708f63\b6fd01de-f2d0-4b14-ba24-550d296f25f9\scratchpad`) to `spikes/enable-banking/`, with paths and names checked against the spike's other scripts.
- Copy `evidence-2026-11-22.json` (counts only) to `spikes/enable-banking/evidence/2026-11-22-pending-settlement.json`, read in full first to confirm it holds no bank data.
- No package to add.

## Migration plan

1. **Merge:** the deploy adds the `firstseentimes` table (`infra/platform.bicep`) and the new image. There is no new secret, setting or role. `az bicep lint` and the read-only preview show exactly the new table.
2. **From the deploy on,** transactions first read on their own day get a time. Everything read before shows the date only, as decided.
3. **After the deploy** (a routine look, no PR): a small card payment, then the sheet shows "…, kolem HH:MM" within a minute of Revolut's own time. Application Insights holds no `FirstSeenNotRecorded`.
4. **Rollback:** redeploy the previous commit (deployment.md § Rolling back). The old app ignores the table, and the stack removes it when the change is reverted in Bicep, losing only the times.

## Open questions

None.
