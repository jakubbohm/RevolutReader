# Design: c017-add-daily-koruna-rate

## TL;DR

- **Source:** the Czech National Bank's (CNB) JSON API, `GET https://api.cnb.cz/cnbapi/exrates/daily`, keyless; the euro's `rate / amount` with its `validFor` day (D1). The CNB is not named on screen (the owner).
- **Kept:** one row in a new table `korunarates`, read once per process and held in memory; replaced only by a rate for a later day (D2).
- **When asked:** never before 08:00 UTC on the first weekday after the kept day; from then on every request that answers a rate asks, until a newer day comes (D3).
- **How:** inside the request, started before its bank or storage read so it runs alongside; one ask in flight shared by every caller; a 2 s limit (D4).
- **Failure:** the kept rate, or with nothing kept the app's own 24.47 for 2026-11-20, never kept. A rate never fails a request, not even when the store fails (D5).
- **New interfaces:** `IKorunaRates` (the rate an answer carries), `ICnbRates` (the CNB port, its client `CnbClient`), `IKorunaRateStore` (the kept rate's port, `TableKorunaRateStore`), settings `Cnb` and `KorunaRates`. `Account/KorunaRate` (the constant) is removed (D9).
- **Integration points:** `api.cnb.cz` outbound; the three account handlers (the account check through `ReadBalanceHandler`); `infra/platform.bicep` gains one table. No API contract, frontend, secret or role change.
- **Hard to reverse:** nothing. The table holds one public number and can be dropped with the change.

## Context

See proposal.md § Why. What the code has today:

- `Account/KorunaRate` is a static class: `CzkPerEur` 24.3 and `Date` 2026-11-08 (C13). `ReadBalanceHandler` puts the rate into `AccountBalance`. `ReadNewestTransactionsHandler` and `ReadOlderTransactionsHandler` put the rate and its date into `TransactionPage`. The account check gets its balance through `ReadBalanceHandler`, keeps the read whole (with its rate) as *last seen*, and writes its notification's koruna value from that rate. `CheckedBalances.Changed` compares amounts only, so a new rate never counts as an account change.
- The API's answers already carry the rate (`czkPerEur`) and the pages its day (`rateDate`). The phone converts with whatever rate arrives and keeps it with the balance (ADR-0007). So the change is server-only.
- Every store is a one-table Table Storage adapter on the shared tables client, its table created by the app when missing (`TableCreation`) and declared in `infra/platform.bicep`. `checkedbalances` is the model for a one-row table.
- Outgoing HTTP clients get no retries by default, guarded by `Conventions/HttpClientDefaultsTests` (c008 D10). The bank client removes the factory's own loggers.
- The container image is the chiseled ASP.NET image, which ships no time-zone data (Microsoft's docs on .NET container images, read 2026-11-21). No code uses a Prague time zone.
- The acceptance tests' clock starts at the real time and only moves forward; `ScenarioCalendar` keeps only distances in days, and testing.md says a weekday rule "would need another way".
- Verified 2026-11-21: the API answers JSON `{"rates":[…]}` with 30 entries; the euro's entry is `{"validFor":"2026-11-20","order":223,"country":"EMU","currency":"euro","amount":1,"currencyCode":"EUR","rate":24.47}`. With `?date=2026-11-08` (a Sunday) it answers Friday's 24.345 for 2026-11-06. Five requests took 32–60 ms. The answer carries no `Access-Control-Allow-Origin`, so a browser could not read it. The CNB publishes on working days at around 14:30 Prague time, valid for that day and any weekend or holiday after it.

## Goals / Non-Goals

**Goals:**
- Every answer that carries a rate carries the CNB's latest one, with no request slower than its own bank or storage read in practice.
- A CNB outage costs nothing but freshness.
- No test ever reaches the real CNB.

**Non-Goals:** see proposal.md § Non-goals. At the design level also: no rate history, no per-day rates, no warm-up at start, no health check touching the CNB (spec service-health: `/health` stays a plain answer).

## Decisions

### D1 — The source: the CNB's daily rates (explore 1)

`GET {Cnb:Address}/cnbapi/exrates/daily`, with no date (the latest declared rates) and no `lang` (it only changes the names of countries and currencies). The euro's entry is the one with `currencyCode` `EUR`. The rate is `rate / amount`: `amount` is 1 for the euro, but the CNB quotes some currencies per 100, so dividing is always right. The rate's day is `validFor`, which the sheet shows as "orientační kurz z …": on a weekend that is Friday's date, which is when the rate was declared.

The CNB's terms (read 2026-11-21) allow storing and reproducing its information, but say "The CNB must always be stated as the source of the information (Source: the CNB)". **The owner chose not to name the CNB in the app** (explore, 2026-11-21): it is a private app for two people. So no design change. ADR-0011 records the choice.

*Alternatives:* the ECB's reference rates (euro-based XML at about 16:00 CET; not the official Czech rate); Revolut's own rate (no API); the bank's `exchange_rate` field (on 2 of 116 transactions, c004 D3); a hand-updated constant (fastest, but it ages again; the owner chose the daily rate).

### D2 — Kept in one table row (explore 2)

The kept rate is one row in the table `korunarates` (setting `KorunaRates:TableName`): partition `rate`, row `eur`, columns `CzkPerEur` (an invariant decimal string, as the check's store writes rates) and `Date` (`yyyy-MM-dd`). `KorunaRates` reads it once per process, on the first call that needs a rate, and then holds it in memory. Only this app writes the row, and at most one replica runs, so memory and table agree. During a deploy, two copies may both ask and write the same rate, which is harmless.

*Alternative:* memory only, the owner's option A. Every wake would ask the CNB, and a CNB outage at a wake would fall back to the old constant.

### D3 — When the CNB is asked (explore 4; the owner)

`RateAsking.NextAskFrom(keptDay)` is 08:00 UTC on the first day from Monday to Friday after the kept rate's day. Before then the kept rate is answered and the CNB is not asked. From then on (`RateAsking.IsDue`), **every** request that answers a rate asks, until the CNB answers a rate for a later day than the kept one. With nothing kept, every request asks.

- **08:00 UTC, not 14:30 Prague** (the owner): asks between 08:00 UTC and the CNB's publication return the rate already kept. They are harmless, because they run alongside the bank read (D4).
- **UTC, no time zone:** the image has no time-zone data and the rule needs none. 08:00 UTC is 9:00 in Prague in winter and 10:00 in summer.
- **Monday to Friday, no holiday list:** on a Czech holiday every request asks and gets the previous rate. The operating period holds 24–26 Dec and 1 Jan.

*Alternatives:* 14:30 Prague, a minimum interval between asks, a Czech holiday list, the Prague time zone through the image's `-extra` variant. The owner chose the simplest rule.

### D4 — Inside the request, alongside its reads, shared, 2 s (explore 3 and the time limit)

- **Alongside:** each handler calls `rates.Current(…)` first and awaits it only after its own bank or storage read. So the answer waits for whichever is slower. For the balance and the newest page that is the bank (usually 1–2 s), and for an older page the table read.
- **Shared:** while an ask is in flight, every other caller awaits the same ask. The balance and transactions requests that arrive together when the app opens make one request to the CNB. The ask is cleared when it ends, success or failure, so the next caller asks again while the rate is still due.
- **Its own lifetime:** the shared ask runs without any caller's token, as `TableCreation` does. Each caller stops waiting on its own token, so a caller that leaves never cancels the ask for the others.
- **2 s:** `Cnb:TimeLimit`, the named client's `HttpClient.Timeout` (real time), so the shared ask always ends within it. The production value is declared in `appsettings.json`. The tests keep 2 s (D10).

*Alternative:* a background refresh after the answer, the owner's other option. No request would ever wait, but the first answer after a new rate would still carry the old one, a test would have to wait for a task after the answer, and a failure would be seen by no request.

### D5 — Failures, and the app's own rate (explore 5; the owner)

- **A failed ask** (D6) leaves the kept rate in the answer. It is not retried: the next request asks again, because the rate is still due.
- **Nothing kept:** the answer carries `KorunaRate.AppsOwn`, **24.47 CZK per euro for 2026-11-20**. That is the CNB's latest on 2026-11-21, when this change was proposed, and it stays the latest until Monday 2026-11-23 at around 14:30. It is never written to the table, so the next request asks again. *If the apply starts after the CNB publishes a newer rate, the apply takes that rate into the constant, its scenario, this decision and the proposal together* (the owner: "update it to today's value").
- **A rate never fails a request** *(propose)*. A failure to read or write the kept row is logged (`KorunaRateStoreFailed`, D7) and treated as nothing kept (a read) or ignored (a write: the rate is still held in memory and answered). A failed read is tried again by the next call. Otherwise the balance, which reads no table today, would answer 500 whenever storage fails.
- **Not affected:** the account check keeps its reads whole, so a notification's koruna value is at the rate of its own read, as before. `CheckedBalances.Changed` compares amounts only.

*Alternatives:* leave the koruna value out (an API, frontend and design change for a case that may never happen); fail the request (it would hide the balance because of a rate).

### D6 — A usable answer (explore 6)

`CnbClient` answers a `KorunaRate` for an HTTP 200 whose JSON has a `rates` array with an entry whose `currencyCode` is `EUR`, whose `rate` and `amount` are positive numbers and whose `validFor` is a `yyyy-MM-dd` date. Anything else is a `CnbFailed` with its kind:

| Kind | When |
|---|---|
| `NoAnswerInTime` | the 2 s limit ran out |
| `Unreachable` | a network error (DNS, refused, reset) |
| `Status` | any status but 200 (with the code) |
| `Unreadable` | not JSON, no `rates`, no `EUR` entry, a rate or amount that is not a positive number, a missing or malformed `validFor` |

A caller's cancellation is not a failure: it passes on as `OperationCanceledException`, though the shared ask never carries a caller's token (D4). `KorunaRates` ignores a rate for an earlier day than the kept one, without a log line *(propose)*. Only a stale copy somewhere in front of the CNB could send one, and the next ask fixes it. No retries: the client is a plain named client, which `HttpClientDefaultsTests` already guards.

### D7 — Logs (explore 7)

`RateLog`, source-generated log methods as `CheckLog` has:

| Event | Level | Holds | When |
|---|---|---|---|
| `KorunaRateKept` | Information | the rate and its day | a rate for a later day was kept, about once per working day |
| `KorunaRateAskFailed` | Warning | the kind, and the status code for `Status` | every failed ask, one per request during an outage |
| `KorunaRateStoreFailed` *(propose)* | Warning | read or write, with the exception | the kept row could not be read or written (D5) |

Nothing is logged for an ask that returns the rate already kept, or for an earlier day's rate. The rate is public data, not bank data, so it may be logged in full. **The HTTP client factory's own loggers are removed** from the named client *(propose)*: otherwise every ask would add the factory's Information lines, which D7's "nothing for an ask that returns the kept rate" rules out. The outgoing call still appears in Application Insights as a dependency through the existing HTTP client instrumentation. Its address holds nothing personal.

### D8 — The answers that carry a rate *(propose)*

`ReadBalanceHandler` (so also the account check), `ReadNewestTransactionsHandler` and `ReadOlderTransactionsHandler` take `IKorunaRates` and put its `CzkPerEur`, and on the pages its `Date`, where the constant was. The answers' fields, types and descriptions stay, so `openapi.json` and `schema.d.ts` do not change and are not regenerated (CI's drift check confirms it). On a bank failure the handlers still await the rate before returning; it never throws (D5).

### D9 — Where the code lives *(propose)*

- A new folder `src/RevolutReader.Api/Rate/` holds the rate value, the service, the rule, the CNB port and client with their settings, the kept rate's port, the log lines and the registration. `Account/KorunaRate` is removed, and its users take `Rate.KorunaRate` or `IKorunaRates`.
- `KorunaRates` is a **singleton**: it holds the kept rate and the ask in flight.
- `CnbClient` is a **singleton** that creates its `HttpClient` from `IHttpClientFactory` per ask (a named client, `cnb`), because a typed client captured by a singleton would keep one handler forever.
- The Table adapter `TableKorunaRateStore` and its options live in `Storage/`, registered by `AddKorunaRateStore` after `AddTransactionStore` (the shared tables client), like the other stores.

### D10 — Tests (explore 8; propose details)

- **A fake CNB for every acceptance app copy** (`Drivers/FakeCnb`, WireMock.Net through `LoopbackWireMock`). `AcceptanceTest` configures every app copy with its address, as it does the fake bank, so no test reaches `api.cnb.cz`.
  - Its answers are built from the CNB's real answer captured on 2026-11-21 (public data, saved in the bootstrap), with the euro's `rate` and `validFor` replaced.
  - **By default it answers 25.125 for the clock's date when the fake starts**, a value no scenario names (lesson R-15), so a scenario never passes on the default.
  - A test sets the answer (a rate and a day, shifted by the scenario calendar), a server error, or an answer that never comes in time; it reads the number of requests received.
- **The kept rate's table** is one of each app copy's own (`AzuriteStorage` sets `KorunaRates:TableName`, as it does the other three). `TheKeptRateIs` writes through the app copy's own `IKorunaRateStore`, before the scenario's first request that needs a rate (D2: the service reads the row once, on first need). `NoRateIsKept` reads it and throws if a rate is there, as the DSL's other "is not" steps check.
- **Scenarios on a weekday:** `ScenarioCalendar.TodayIsAt(day, utcTime)` moves the clock forward to the coming day with the same weekday as the scenario's `day`, at `utcTime` UTC, and maps the scenario's dates onto it. Their distances are then multiples of 7 days, so weekdays agree. Like `DaysPass`, it runs only after signing in (Microsoft's ID token is checked against the real clock). The weekday rule itself is unit-tested as a plain function with any dates.
- **The time limit stays 2 s in the tests** *(propose; explore said "shortened")*. A shorter limit could turn a slow fake under parallel test load into a failed ask and a wrong rate in an unrelated scenario. The one hanging scenario then takes 2 s, less than the bank's hanging scenario (5 s).
- **The app's own rate's date is fixed**, not relative to today: its scenario compares the date as the API answers it (`TransactionsReading.RateDateAsAnswered`, outside the reading's equality). Every other rate date is the scenario's, shifted back as the other dates are. Today's `RateDate` is the fixed C13 date, unshifted.
- **The integration tests' app copies** (`MadeUpSettings`) point `Cnb:Address` at an unreached loopback port, as they do the bank.
- **Existing tests that pin 24.3 or the static class** change with the slice that removes it: `KorunaRateTests` (becomes the app's own rate), `ReadBalanceHandlerTests`, `ReadNewestTransactionsHandlerTests`, `ReadOlderTransactionsHandlerTests`, `AccountCheckTests` and `CheckedBalancesTests` (a written-out rate in place of `KorunaRate.CzkPerEur`). The acceptance scenarios change as the specs say, and `AccountCheckTelemetryTests` computes the koruna forms with the rate its app copy answers. `CheckDsl`'s 24.3 for kept balances stays, a stored value, with its comment corrected.
- **No explicit check against the real CNB** (the owner). The capture is the fake's base, and the deployed app is looked at after the deploy (Migration plan).

### D11 — Records *(propose)*

- **ADR-0011-koruna-rate:** the CNB as an outside service, its terms and the owner's choice not to name it, D2–D5, with sources dated 2026-11-21.
- **docs/conventions/configuration.md:** the `Cnb` and `KorunaRates` sections.
- **docs/conventions/testing.md:** § Fake CNB, and § Time and the background job gains the weekday step. Mirrored in `.claude/rules/testing.md` where it lists the fakes.
- **docs/operations/deployment.md:** § The koruna rate (c017): the table, what to look at after the deploy, a ready query for `KorunaRateAskFailed` and `KorunaRateKept`.
- **docs/software-factory/:** lesson R-98 (an outside reference value in an app that scales to zero: a kept row refreshed inside the request on the publisher's schedule), and a divergence R-98 (no holiday calendar, UTC instead of the publisher's time zone, the source not named). The inventory's scenario-calendar row gains the weekday step, and a fake-CNB row is added.
- **No `pm/progress.md` row:** work after the initial development is a GitHub issue only (`CLAUDE.md` § Project management). The PR closes #39. `CLAUDE.md`'s commands do not change.

### D12 — After c016

c016 merged as #92 on 2026-11-21, and `main` was merged into this branch before the apply (a fast-forward: the branch had no commit of its own). So nothing is joined by hand. This change builds on what c016 brought: lessons end at R-97, so this change's lesson is R-98. Every acceptance app copy's log lines are captured with their structured values (`Drivers/CapturedLogEvents` in `Drivers/CapturedTelemetry.cs`), which the log guard reads (task 28.1).

## Public API sketch

```csharp
// ---- src/RevolutReader.Api/Rate/KorunaRate.cs
namespace RevolutReader.Api.Rate;

/// <summary>The euro's rate in koruna and the day it is for (D1): the CNB's rate / amount and its validFor.</summary>
public sealed record KorunaRate(decimal CzkPerEur, DateOnly Date) {
  /// <summary>The app's own rate (D5): the CNB's for 2026-11-20. Answered only while nothing is kept and an ask fails; never kept.</summary>
  public static KorunaRate AppsOwn { get; } = new(24.47m, new DateOnly(2026, 11, 20));
}

// ---- Rate/IKorunaRates.cs
/// <summary>The rate an answer carries (D2–D5).</summary>
public interface IKorunaRates {
  /// <summary>
  /// The kept rate; when one is due (RateAsking.IsDue), first the CNB's answer, shared with every caller asking meanwhile
  /// and kept when it is for a later day; the kept one when the ask fails; KorunaRate.AppsOwn when nothing is kept.
  /// Never throws for the CNB or the store; only <paramref name="cancellationToken"/> ends this caller's wait.
  /// </summary>
  Task<KorunaRate> Current(CancellationToken cancellationToken);
}

// ---- Rate/KorunaRates.cs — singleton
public sealed class KorunaRates(ICnbRates cnb, IKorunaRateStore store, TimeProvider time, ILogger<KorunaRates> logger) : IKorunaRates {
  public Task<KorunaRate> Current(CancellationToken cancellationToken);
}

// ---- Rate/RateAsking.cs — the rule (D3), pure
public static class RateAsking {
  /// <summary>08:00 UTC on the first day from Monday to Friday after <paramref name="keptDay"/>.</summary>
  public static DateTimeOffset NextAskFrom(DateOnly keptDay);

  /// <summary>Nothing kept, or <paramref name="now"/> at or after NextAskFrom(kept.Date).</summary>
  public static bool IsDue(KorunaRate? kept, DateTimeOffset now);
}

// ---- Rate/ICnbRates.cs — the CNB port (D6)
public interface ICnbRates {
  /// <summary>The euro's rate in the CNB's latest daily rates, or why not. A caller's cancellation throws.</summary>
  Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken);
}

public union CnbAnswer(KorunaRate, CnbFailed);

/// <summary>An ask that failed (D6); <paramref name="StatusCode"/> only for <see cref="CnbFailure.Status"/>.</summary>
public sealed record CnbFailed(CnbFailure Kind, int? StatusCode = null);

public enum CnbFailure { NoAnswerInTime, Unreachable, Status, Unreadable }

// ---- Rate/CnbClient.cs — singleton, the named client "cnb" per ask (D9)
public sealed class CnbClient(IHttpClientFactory clients) : ICnbRates {
  public Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken);
}

// ---- Rate/CnbOptions.cs — section "Cnb", validated on start
public sealed class CnbOptions {
  public const string SECTION = "Cnb";

  /// <summary>The API's base address: https://api.cnb.cz in production and locally; the fake's loopback address in tests.</summary>
  [Required] public required Uri Address { get; init; }

  /// <summary>How long one ask may take: 2 s (D4); 1 ms to 10 s.</summary>
  [Range(typeof(TimeSpan), "00:00:00.001", "00:00:10")] public required TimeSpan TimeLimit { get; init; }
}

// ---- Rate/IKorunaRateStore.cs — the kept rate's port (D2)
public interface IKorunaRateStore {
  /// <summary>The rate as last saved; null when none is.</summary>
  Task<KorunaRate?> Read(CancellationToken cancellationToken);

  /// <summary>Replaces the kept rate.</summary>
  Task Save(KorunaRate rate, CancellationToken cancellationToken);
}

// ---- Rate/RateLog.cs (D7)
internal static partial class RateLog {
  [LoggerMessage(EventName = "KorunaRateKept", Level = LogLevel.Information, Message = "A new koruna rate was kept: {CzkPerEur} CZK per euro for {Date}")]
  public static partial void KorunaRateKept(ILogger logger, decimal czkPerEur, DateOnly date);

  [LoggerMessage(EventName = "KorunaRateAskFailed", Level = LogLevel.Warning, Message = "Asking the CNB for the koruna rate failed: {Kind}, status {StatusCode}")]
  public static partial void KorunaRateAskFailed(ILogger logger, CnbFailure kind, int? statusCode);

  [LoggerMessage(EventName = "KorunaRateStoreFailed", Level = LogLevel.Warning, Message = "The kept koruna rate could not be {Operation}")]
  public static partial void KorunaRateStoreFailed(ILogger logger, string operation, Exception exception);
}

// ---- Rate/RateRegistration.cs
public static class RateRegistration {
  /// <summary>
  /// CnbOptions bound and validated on start; the named client "cnb" (BaseAddress = Address, Timeout = TimeLimit, the
  /// factory's loggers removed, no handlers); CnbClient as ICnbRates and KorunaRates as IKorunaRates, singletons;
  /// TimeProvider.System unless one is registered. Called from Program.cs, after AddKorunaRateStore.
  /// </summary>
  public static IServiceCollection AddKorunaRates(this IServiceCollection services);
}

// ---- src/RevolutReader.Api/Storage/
public sealed class KorunaRateStoreOptions { public const string SECTION = "KorunaRates"; [Required, RegularExpression(TABLE_NAME_PATTERN)] public required string TableName { get; init; } }
public sealed class TableKorunaRateStore(TableServiceClient tables, IOptions<KorunaRateStoreOptions> options) : IKorunaRateStore;
// StorageRegistration:
public static IHostApplicationBuilder AddKorunaRateStore(this IHostApplicationBuilder builder);

// ---- changed
public sealed class ReadBalanceHandler(IBankAccount bank, IKorunaRates rates, TimeProvider time);
public sealed class ReadNewestTransactionsHandler(IBankAccount bank, ITransactionStore store, IKorunaRates rates, TimeProvider time, ILogger<ReadNewestTransactionsHandler> logger);
public sealed class ReadOlderTransactionsHandler(ITransactionStore store, IKorunaRates rates);
// removed: RevolutReader.Api.Account.KorunaRate (the static class)
```

```csharp
// ---- tests/RevolutReader.AcceptanceTests — DSL (Dsl/RateDsl.cs) and drivers
public sealed class RateDsl(RateDriver driver) {
  /// <summary>Today is <paramref name="day"/> at <paramref name="utcTime"/> UTC (D10): only after signing in.</summary>
  public void TodayIs(DateOnly day, TimeOnly utcTime);

  public Task TheKeptRateIs(decimal czkPerEur, DateOnly day);
  /// <summary>Checks that no rate is kept; throws when one is.</summary>
  public Task NoRateIsKept();

  public void TheCnbsLatestRateIs(decimal czkPerEur, DateOnly day);
  /// <summary>For the scenario's today.</summary>
  public void TheCnbsLatestRateIs(decimal czkPerEur);
  public void TheCnbAnswersAServerError();
  public void TheCnbDoesNotAnswerInTime();

  public int RequestsTheCnbReceived();
}

public sealed class RateDriver(FakeCnb cnb, ScenarioCalendar calendar, IServiceProvider app);   // writes and reads through the app copy's IKorunaRateStore
public sealed class FakeCnb : IDisposable {                                                    // Drivers/FakeCnb.cs
  public static FakeCnb Start();
  public void Configure(IWebHostBuilder builder);            // Cnb:Address, Cnb:TimeLimit 00:00:02
  public void AnswerRate(decimal czkPerEur, DateOnly clockDay);
  public void AnswerServerError();
  public void AnswerNeverInTime();                           // later than the 2 s limit
  public int RequestsReceived { get; }
}
// ScenarioCalendar:
public void TodayIsAt(DateOnly scenarioDay, TimeOnly utcTime);
// TransactionsReading: RateDate becomes the scenario's date (shifted back); RateDateAsAnswered, outside equality, the date as answered.
// AcceptanceTest: protected RateDsl Rate { get; }  — FakeCnb started and configured for every app copy
```

## Rule ownership

| Rule (spec) | Enforced by |
|---|---|
| The rate is the CNB's euro `rate / amount` with its `validFor` (koruna-rate) | `CnbClient` |
| A rate the CNB answers is kept; replaced only by a later day's (koruna-rate) | `KorunaRates` with `IKorunaRateStore` |
| Not asked before 08:00 UTC on the next weekday; then every request asks (koruna-rate) | `RateAsking` (when), `KorunaRates` (asking) |
| Requests at the same time share one ask (koruna-rate) | `KorunaRates` |
| Asked alongside the request's own reads (koruna-rate) | the three handlers (start first, await last) |
| What counts as a failed ask; the 2 s limit (koruna-rate) | `CnbClient` (kinds), the named client's `Timeout` (limit) |
| A failed ask leaves the kept rate, never fails the request, is not retried (koruna-rate) | `KorunaRates`; no retries: `HttpClientDefaultsTests` |
| With nothing kept, the app's own 24.47 for 2026-11-20, never kept (koruna-rate) | `KorunaRate.AppsOwn`, `KorunaRates` |
| `czkPerEur` in the balance (account-balance) | `ReadBalanceHandler` |
| `czkPerEur` and `rateDate` on the pages (account-transactions) | `ReadNewestTransactionsHandler`, `ReadOlderTransactionsHandler` |
| The notification's koruna value and balance at the app's rate (account-check) | unchanged: `ChangeNotification` from the read `ReadBalanceHandler` answers |

## Error model

- `IKorunaRates.Current` returns a rate, never a failure: a failed ask and a store failure are handled inside it (D5). Only the caller's cancellation throws.
- `ICnbRates.ReadEuroRate` returns `CnbAnswer`: the rate, or `CnbFailed` with its kind for every expected failure of the CNB (D6). A caller's cancellation throws `OperationCanceledException`.
- `IKorunaRateStore` throws on storage failures and on a row it cannot read (an `InvalidOperationException` naming the column, never its value), as the other stores do. `KorunaRates` catches both.
- The handlers' own error models are unchanged.

## Ports and contracts

- **`ICnbRates`** (real adapter `CnbClient`, a named `HttpClient` to `api.cnb.cz`): one GET per call, no retries, ends within `Cnb:TimeLimit`. Failure modes as D6. Stateless and safe to call at the same time from several callers, though `KorunaRates` never does. Unit tests use a hand-written fake (`FakeCnbRates`) that answers a set rate or failure, counts calls, and can hold an answer until released, to prove the shared ask and the parallel start. The real client's edge cases (amount 100, every unreadable shape, status, the time limit, a refused connection, a caller's cancellation) are integration Wiring tests against WireMock.
- **`IKorunaRateStore`** (real adapter `TableKorunaRateStore`, Table Storage, table `KorunaRates:TableName`, one row): nothing saved reads as `null`; a save replaces the row whole; the rate and the date come back exactly (a decimal with its scale, the date to the day); the table is created when missing, once per instance (`TableCreation`); last write wins. A contract test runs against both the in-memory fake (`InMemoryKorunaRateStore`, in the unit tests, linked into the integration project) and the real adapter on Azurite. A row it cannot read is an adapter edge case.
- **`IKorunaRates`** is the handlers' dependency. It is no outside port, but the handlers' unit tests use a hand-written fake (`FixedKorunaRates`: a set rate, a record of when it was asked, an optional hold) rather than the real service.

## How each scenario is verified

All 12 scenarios are API acceptance tests, the default level. Everything they assert is an answer of the API, a request the fake CNB received, or a push the fake push service received.

## Cross-cutting effects

- **Outbound traffic:** `api.cnb.cz` over HTTPS from the container app. Container Apps' Consumption environment allows outbound by default, so no infrastructure change is needed.
- **Telemetry:** one dependency per ask in Application Insights, and the D7 lines.
- **Local development:** `aspire start` reads the real CNB. It is public and keyless, so nothing is set up.
- **The image smoke run and the OpenAPI export:** neither answers a rate, so neither reaches the CNB.

## Risks / Trade-offs

- [The CNB changes its JSON shape, address or access] → every ask fails as `Unreadable` or `Status`, the kept rate stays, and every request logs a warning. The deployment.md query shows it. A fix is a small change to `CnbClient`.
- [A morning of requests asks the CNB each time (08:00 UTC to ~14:30 Prague)] → about 40 ms each, alongside the bank read. Accepted by the owner, to keep the rule simple.
- [A Czech holiday makes every request ask all day] → harmless, as above.
- [Two app copies during a deploy both ask and write] → the same rate, last write wins. Harmless.
- [The kept rate's memory copy and the table differ after a failed write] → the next process reads the older row and asks again. Harmless.
- [The 2 s limit holds an older page that long while the CNB hangs] → at most once per request while the rate is due, and only during an outage.
- [The app's own rate goes stale] → it is answered only while nothing is kept and the CNB fails, i.e. right after the first deploy, if at all.

## Bootstrap (before `/tdd-apply`)

- Save the CNB's real answer captured on 2026-11-21 (all 30 entries, valid for 2026-11-20) as the fake CNB's base, at `tests/RevolutReader.AcceptanceTests/Drivers/CnbDaily.json` (public data, no secret). If the apply starts after the CNB publishes a newer rate, capture that one instead, and update the app's own rate with it (D5).
- No package to add: `System.Text.Json` and WireMock.Net are in place.

## Migration plan

1. Merge: the deploy adds the `korunarates` table (`infra/platform.bicep`) and the new image. The app needs no new secret, setting or role, so nothing is provisioned by hand. `az bicep lint` and the read-only preview show exactly the new table.
2. After the deploy (routine checks, no PR): open the app. The transaction sheet shows "orientační kurz z" and the CNB's latest day, and Application Insights holds one `KorunaRateKept` line and no `KorunaRateAskFailed` (deployment.md § The koruna rate).
3. Rollback: redeploy the previous commit (deployment.md § Rolling back). The table stays harmless, and the stack removes it when the change is reverted in Bicep.

## Open questions

None.
