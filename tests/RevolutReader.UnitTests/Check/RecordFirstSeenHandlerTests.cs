using System.Globalization;
using System.Net;
using Azure;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using RevolutReader.UnitTests.Account;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The account check's recording of first sightings (c018 design.md D5; § Public API sketch,
/// <see cref="RecordFirstSeenHandler"/>): it reads the transactions as the present user the check runs for, never
/// unattended (ADR-0008 item 3), from the UTC day before the clock's today, and records the read's first sightings
/// through <see cref="FirstSeenTimes"/>, the newest page's path (D1, D2). A failed read or recording is logged and changes
/// nothing; only the app's stop passes out (D5).
/// <para>
/// The bank is <see cref="StubCheckBank"/>, answering no transaction unless a test says otherwise; the first-seen moments
/// <see cref="InMemoryFirstSeenStore"/> through a real <see cref="FirstSeenTimes"/>; the clock a
/// <see cref="FakeTimeProvider"/>. The address is a documentation address (RFC 5737), the browser name the Shortcut's.
/// </para>
/// </summary>
public sealed class RecordFirstSeenHandlerTests {
  /// <summary>The bank's reference of the spec's pending card payment to "Kavárna Na Rohu" (made up).</summary>
  private const string KAVARNA = "e-c018-kavarna";

  /// <summary>The bank's reference of a payment to "Trafika Můstek" on the check's day (made up).</summary>
  private const string TRAFIKA = "e-c018-trafika";

  /// <summary>The bank's reference of a settled payment dated the day before the check (made up).</summary>
  private const string YESTERDAYS = "e-c018-yesterday";

  /// <summary>The event of a check that recorded no first-seen times (§ Public API sketch, <c>CheckLog</c>).</summary>
  private const string FIRST_SEEN_NOT_RECORDED = "FirstSeenNotRecorded";

  /// <summary>How long a test waits on the real clock for the recorder to end once nothing holds it: far longer than it takes.</summary>
  private const int WITHIN_SECONDS = 10;

  /// <summary>The clock: 2026-11-20 13:05:12 UTC, the spec's check.</summary>
  private static readonly DateTimeOffset _now = new(2026, 11, 20, 13, 5, 12, TimeSpan.Zero);

  /// <summary>The owner's phone, as its Shortcut calls: a documentation address and the Shortcut's browser name.</summary>
  private static readonly PresentUser _phone = new(IPAddress.Parse("203.0.113.7"), "BackgroundShortcutRunner/5114.0");

  /// <summary>
  /// The recorder reads the transactions once, as the user it is given: the bank gets that user's address and browser name
  /// (spec account-check, "The check reads the balance and the recent transactions as the phone present"; D5; tasks.md
  /// 21.1). The user is one no other test here names.
  /// </summary>
  [Test]
  public async Task It_reads_the_transactions_as_the_present_user_it_is_given() {
    PresentUser user = new(IPAddress.Parse("203.0.113.42"), "BackgroundShortcutRunner/5108.1");
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank).Handle(user, CancellationToken.None);

    bank.TransactionReadsFor.ShouldBe([user], "one transactions read, as the user given: the same address and browser name");
  }

  /// <summary>
  /// The check's transactions read starts at the UTC day before the clock's today (D5: "yesterday is the UTC date before
  /// the clock's"; spec account-check, "The check reads the transactions from yesterday on"; tasks.md 24.1). The clock's
  /// offset does not count: at 23:30 UTC on 2026-11-20, given at +01:00, where its own date is already the 21st, the read
  /// still starts on the 19th.
  /// </summary>
  /// <param name="clock">What the clock gives, as round-trip text with its offset.</param>
  /// <param name="from">The day the read must start, <c>yyyy-MM-dd</c>.</param>
  [Test]
  [Arguments("2026-11-20T13:05:12+00:00", "2026-11-19")] // the spec's check, at the clock's offset zero
  [Arguments("2026-11-21T00:30:00+01:00", "2026-11-19")] // 23:30 UTC on 2026-11-20, given at +01:00
  public async Task The_checks_transactions_read_starts_at_the_UTC_day_before_the_clocks_today(string clock, string from) {
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank, new FakeTimeProvider(Instant(clock))).Handle(_phone, CancellationToken.None);

    bank.TransactionReadsFrom.ShouldBe([Day(from)], "one transactions read, from the UTC day before the clock's today");
  }

  /// <summary>
  /// Five seconds after UTC midnight starts 2026-11-21, the read starts at 2026-11-20, the UTC day that has just ended
  /// (D5: the extra day covers a check that straddles midnight; tasks.md 24.2), also when the clock gives that moment at
  /// -08:00, where its own date is still the 20th.
  /// </summary>
  /// <param name="clock">What the clock gives, as round-trip text with its offset.</param>
  [Test]
  [Arguments("2026-11-21T00:00:05+00:00")] // at the clock's offset zero
  [Arguments("2026-11-20T16:00:05-08:00")] // the same moment, given at -08:00
  public async Task Just_after_UTC_midnight_the_read_starts_at_the_day_that_has_just_ended(string clock) {
    StubCheckBank bank = new(new Balance(45.20m, "EUR"));

    await Recorder(bank, new FakeTimeProvider(Instant(clock))).Handle(_phone, CancellationToken.None);

    bank.TransactionReadsFrom.ShouldBe([new DateOnly(2026, 11, 20)], "one transactions read, from the UTC day that has just ended");
  }

  /// <summary>
  /// The bank lists the spec's pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-20, with its reference,
  /// and a settled payment of 12.30 EUR on 2026-11-19, with its reference; it holds its answer while the clock moves on
  /// from 13:05:12 to 13:05:15.4 UTC. The check records the read through <see cref="FirstSeenTimes"/> at the clock's
  /// moment after the answer, cut to the whole second (D1, D5; § Public API sketch, <c>FirstSeenRule.ReadAt</c>): the
  /// payment is kept at 13:05:15 UTC. Yesterday's payment, read since the check reads from yesterday on, gets no moment:
  /// the same rule as the newest page's (D2), which shows the read goes the same way (tasks.md 27.1).
  /// </summary>
  [Test]
  public async Task The_check_records_the_reads_sightings_at_the_clocks_moment_after_the_banks_answer() {
    FakeTimeProvider clock = new(_now);
    InMemoryFirstSeenStore firstSeen = new();
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = new Transactions([KavarnaNaRohu(), SettledYesterday()]) };
    bank.HoldTheTransactions();

    Task handling = Recorder(bank, clock, firstSeen).Handle(_phone, CancellationToken.None);
    bool read;

    try {
      read = await bank.TransactionsAreRead();
      clock.Advance(TimeSpan.FromMilliseconds(3400));
    }
    finally {
      bank.ReleaseTheTransactions();
    }

    await handling.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

    read.ShouldBeTrue("the bank is read, and holds its answer");
    (await Kept(firstSeen)).ShouldBe([$"{KAVARNA} 2026-11-20T13:05:15.0000000+00:00"], "what the first-seen store keeps: today's payment, at the moment the answer came, to the second");
  }

  /// <summary>
  /// The check already timed the payment at 13:05:12 UTC; at 13:20:00 it reads it again, together with a payment of 4.20
  /// EUR to "Trafika Můstek" on 2026-11-20 it reads first. The new one is recorded at 13:20:00, so this read was recorded,
  /// and the payment timed before keeps 13:05:12 (D1: the earliest moment wins; tasks.md 27.2).
  /// </summary>
  [Test]
  public async Task A_transaction_the_check_already_timed_keeps_its_moment_when_the_check_reads_it_again() {
    InMemoryFirstSeenStore firstSeen = new();
    firstSeen.Keep(KAVARNA, _now);
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = new Transactions([KavarnaNaRohu(), TrafikaMustek()]) };

    await Recorder(bank, new FakeTimeProvider(new DateTimeOffset(2026, 11, 20, 13, 20, 0, TimeSpan.Zero)), firstSeen).Handle(_phone, CancellationToken.None);

    (await Kept(firstSeen)).ShouldBe(
      [$"{KAVARNA} 2026-11-20T13:05:12.0000000+00:00", $"{TRAFIKA} 2026-11-20T13:20:00.0000000+00:00"],
      ignoreOrder: true,
      "what the first-seen store keeps: the payment timed before at its first moment, the new one at this read's");
  }

  // A failed transactions read changes nothing (D5: it never throws but for cancellation; § Error model)

  /// <summary>
  /// The transactions read fails at the bank in each of its three expected ways: the recorder returns normally, the
  /// first-seen store is neither read nor written, and one <c>FirstSeenNotRecorded</c> line at Warning holds the kind and
  /// nothing else, with no exception (§ Public API sketch, <c>CheckLog.FirstSeenNotRecorded</c>; tasks.md 31.1).
  /// </summary>
  /// <param name="failure">How the bank failed.</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("unavailable")]
  public async Task A_bank_failure_of_the_transactions_read_logs_its_kind_records_nothing_and_returns_normally(string failure) {
    (BankResult<Transactions> answer, FirstSeenFailure kind) = failure switch {
      "access expired" => ((BankResult<Transactions>)new BankAccessExpired(), FirstSeenFailure.BankAccessExpired),
      "rate limited" => (new BankRateLimited(), FirstSeenFailure.BankRateLimited),
      "unavailable" => (new BankUnavailable(), FirstSeenFailure.BankUnavailable),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    InMemoryFirstSeenStore firstSeen = new();
    CapturedLog log = new();
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = answer };

    Exception? escaped = await Escaped(Recorder(bank, firstSeen, log).Handle(_phone, CancellationToken.None));

    IReadOnlyList<LogEntry> notRecorded = log.Of(FIRST_SEEN_NOT_RECORDED);
    notRecorded.ShouldSatisfyAllConditions(
      () => escaped.ShouldBeNull("the recorder returns normally"),
      () => (firstSeen.ReadRequests, firstSeen.RecordRequests).ShouldBe((0, 0), "the first-seen store is neither read nor written"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Level.ShouldBe(LogLevel.Warning),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").OwnValues().ShouldBe([kind], "the kind, and nothing else"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Exception.ShouldBeNull("a bank failure carries no exception"));
  }

  /// <summary>
  /// The bank lists the spec's payment, and the first-seen store fails: a row it cannot read (§ Error model: an
  /// <see cref="InvalidOperationException"/> naming the column), or the storage's own failure, as the Azure SDK reports
  /// it. The recorder returns normally, and one <c>FirstSeenNotRecorded</c> line at Warning holds
  /// <see cref="FirstSeenFailure.Failed"/> and nothing else, with the store's exception (tasks.md 31.2).
  /// </summary>
  /// <param name="failure">How the store failed.</param>
  [Test]
  [Arguments("a row it cannot read")]
  [Arguments("the storage's own failure")]
  public async Task An_exception_in_the_recording_logs_Failed_with_the_exception_and_returns_normally(string failure) {
    Exception storeFailure = failure switch {
      "a row it cannot read" => new InvalidOperationException("A made-up row of the first-seen table that cannot be read: its SeenAt column is missing."),
      "the storage's own failure" => new RequestFailedException(503, "A made-up storage failure: the table service is unavailable."),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    InMemoryFirstSeenStore firstSeen = new();
    firstSeen.FailWith(storeFailure);
    CapturedLog log = new();
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = new Transactions([KavarnaNaRohu()]) };

    Exception? escaped = await Escaped(Recorder(bank, firstSeen, log).Handle(_phone, CancellationToken.None));

    IReadOnlyList<LogEntry> notRecorded = log.Of(FIRST_SEEN_NOT_RECORDED);
    notRecorded.ShouldSatisfyAllConditions(
      () => escaped.ShouldBeNull("the recorder returns normally"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Level.ShouldBe(LogLevel.Warning),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").OwnValues().ShouldBe([FirstSeenFailure.Failed], "Failed, and nothing else"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Exception.ShouldBeSameAs(storeFailure, "the store's exception"));
  }

  /// <summary>
  /// The app stops while the check records (the caller's token, the app's stopping token through the queue, is cancelled):
  /// while the bank holds its answer, or once the bank has answered and the first-seen store is asked. The recorder ends
  /// with an <see cref="OperationCanceledException"/>, and logs no <c>FirstSeenNotRecorded</c> line: the stop is neither
  /// swallowed nor logged as <see cref="FirstSeenFailure.Failed"/> (D5, § Error model; tasks.md 31.3).
  /// </summary>
  /// <param name="when">Where the recording is when the app stops.</param>
  [Test]
  [Arguments("at the bank")]
  [Arguments("in the store")]
  public async Task The_apps_stop_passes_as_a_cancellation(string when) {
    InMemoryFirstSeenStore firstSeen = new();
    CapturedLog log = new();
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = new Transactions([KavarnaNaRohu()]) };
    using CancellationTokenSource appStops = new();
    Exception? escaped;

    switch (when) {
      case "at the bank":
        bank.HoldTheTransactions();
        Task handling = Recorder(bank, firstSeen, log).Handle(_phone, appStops.Token);

        try {
          (await bank.TransactionsAreRead()).ShouldBeTrue("the bank is read, and holds its answer");
          await appStops.CancelAsync();
          escaped = await Escaped(handling.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS)));
        }
        finally {
          bank.ReleaseTheTransactions();
        }

        break;
      case "in the store":
        // The stub bank answers whatever the token; the in-memory store honours it, as the Table adapter's calls do.
        await appStops.CancelAsync();
        escaped = await Escaped(Recorder(bank, firstSeen, log).Handle(_phone, appStops.Token));

        break;
      default:
        throw new ArgumentOutOfRangeException(nameof(when), when, "Not a known case.");
    }

    escaped.ShouldSatisfyAllConditions(
      () => escaped.ShouldBeAssignableTo<OperationCanceledException>("the app's stop passes as a cancellation"),
      () => log.Of(FIRST_SEEN_NOT_RECORDED).ShouldBeEmpty("the stop is not logged as a failure to record"));
  }

  /// <summary>
  /// The first-seen store throws a <see cref="TaskCanceledException"/> while the caller's token is not cancelled, as an
  /// SDK's own timeout would: not the app's stop, so an exception like any other. The recorder returns normally, and one
  /// <c>FirstSeenNotRecorded</c> line at Warning holds <see cref="FirstSeenFailure.Failed"/> and nothing else, with that
  /// exception (§ Error model: "Only the caller's cancellation throws <c>OperationCanceledException</c>"; tasks.md 31.3).
  /// </summary>
  [Test]
  public async Task A_cancellation_that_is_not_the_callers_logs_Failed_with_the_exception_and_returns_normally() {
    TaskCanceledException storesOwnTimeout = new("A made-up timeout of the storage client's own: the caller did not cancel.");
    InMemoryFirstSeenStore firstSeen = new();
    firstSeen.FailWith(storesOwnTimeout);
    CapturedLog log = new();
    StubCheckBank bank = new(new Balance(45.20m, "EUR")) { TransactionsAnswer = new Transactions([KavarnaNaRohu()]) };
    using CancellationTokenSource appStops = new();

    Exception? escaped = await Escaped(Recorder(bank, firstSeen, log).Handle(_phone, appStops.Token));

    IReadOnlyList<LogEntry> notRecorded = log.Of(FIRST_SEEN_NOT_RECORDED);
    notRecorded.ShouldSatisfyAllConditions(
      () => appStops.IsCancellationRequested.ShouldBeFalse("the app has not stopped"),
      () => escaped.ShouldBeNull("the recorder returns normally"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Level.ShouldBe(LogLevel.Warning),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").OwnValues().ShouldBe([FirstSeenFailure.Failed], "Failed, and nothing else"),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Exception.ShouldBeSameAs(storesOwnTimeout, "the store's exception"));
  }

  /// <summary>
  /// What <paramref name="handling"/> ended with: <see langword="null"/> when it returned normally, else the exception it
  /// threw, of the kinds these tests make happen (a cancellation, a store's failure); any other passes on and fails the test.
  /// </summary>
  private static async Task<Exception?> Escaped(Task handling) {
    try {
      await handling;

      return null;
    }
    catch (OperationCanceledException cancelled) {
      return cancelled;
    }
    catch (InvalidOperationException failed) {
      return failed;
    }
    catch (RequestFailedException failed) {
      return failed;
    }
  }

  /// <summary>
  /// What <paramref name="firstSeen"/> keeps for the references of this class's transactions, each as <c>reference
  /// moment</c>, the moment written out with its offset and every fraction of a second (<c>O</c>), so both count.
  /// </summary>
  private static async Task<IReadOnlyList<string>> Kept(InMemoryFirstSeenStore firstSeen) {
    IReadOnlyDictionary<string, DateTimeOffset> kept = await firstSeen.Read([KAVARNA, YESTERDAYS, TRAFIKA], CancellationToken.None);

    return [.. kept.Select(static moment => $"{moment.Key} {moment.Value.ToString("O", CultureInfo.InvariantCulture)}")];
  }

  /// <summary>The spec's pending card payment of 8.90 EUR to "Kavárna Na Rohu" on 2026-11-20, with its reference (<see cref="KAVARNA"/>).</summary>
  private static BankTransaction KavarnaNaRohu() =>
    new(KAVARNA, TransactionStatus.Pending, new DateOnly(2026, 11, 20), -8.90m, "EUR", "Kavárna Na Rohu", ["Praha 2"], "CARD_PAYMENT");

  /// <summary>A pending card payment of 4.20 EUR to "Trafika Můstek" on 2026-11-20, with its reference (<see cref="TRAFIKA"/>).</summary>
  private static BankTransaction TrafikaMustek() =>
    new(TRAFIKA, TransactionStatus.Pending, new DateOnly(2026, 11, 20), -4.20m, "EUR", "Trafika Můstek", [], "CARD_PAYMENT");

  /// <summary>A settled card payment of 12.30 EUR on 2026-11-19, the day before the check, with its reference (<see cref="YESTERDAYS"/>).</summary>
  private static BankTransaction SettledYesterday() =>
    new(YESTERDAYS, TransactionStatus.Booked, new DateOnly(2026, 11, 19), -12.30m, "EUR", "Pekárna U Lípy", [], "CARD_PAYMENT");

  /// <summary>An instant written as round-trip text, its offset kept as written.</summary>
  private static DateTimeOffset Instant(string text) => DateTimeOffset.Parse(text, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);

  /// <summary>A day written <c>yyyy-MM-dd</c>.</summary>
  private static DateOnly Day(string text) => DateOnly.ParseExact(text, "yyyy-MM-dd", CultureInfo.InvariantCulture);

  /// <summary>The recorder under test, as the other overload, while the clock shows <see cref="_now"/>.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank) => Recorder(bank, new FakeTimeProvider(_now));

  /// <summary>The recorder under test, as the other overload, recording into an empty first-seen store.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank, TimeProvider clock) => Recorder(bank, clock, new InMemoryFirstSeenStore());

  /// <summary>The recorder under test: it reads <paramref name="bank"/> on <paramref name="clock"/>, and records into <paramref name="firstSeen"/> through a real <see cref="FirstSeenTimes"/>.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank, TimeProvider clock, InMemoryFirstSeenStore firstSeen) =>
    new(bank, new FirstSeenTimes(firstSeen), clock, NullLogger<RecordFirstSeenHandler>.Instance);

  /// <summary>The recorder under test: it reads <paramref name="bank"/> while the clock shows <see cref="_now"/>, records into <paramref name="firstSeen"/> through a real <see cref="FirstSeenTimes"/>, and logs to <paramref name="log"/>.</summary>
  private static RecordFirstSeenHandler Recorder(StubCheckBank bank, InMemoryFirstSeenStore firstSeen, CapturedLog log) =>
    new(bank, new FirstSeenTimes(firstSeen), new FakeTimeProvider(_now), log);

  /// <summary>The recorder's logger, keeping every line it writes: its level, its event's name, its structured values, its exception and its message.</summary>
  private sealed class CapturedLog : ILogger<RecordFirstSeenHandler> {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>The lines of the event <paramref name="eventName"/>, in the order written.</summary>
    public IReadOnlyList<LogEntry> Of(string eventName) {
      lock (_lock)
        return [.. _entries.Where(entry => entry.EventName == eventName)];
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      ArgumentNullException.ThrowIfNull(formatter);

      IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
      LogEntry entry = new(logLevel, eventId.Name, [.. values], exception, formatter(state, exception));

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>One line of the recorder's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values, Exception? Exception, string Message) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>The values of the line's own fields, without its message template.</summary>
    public IReadOnlyList<object?> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => pair.Value)];

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}