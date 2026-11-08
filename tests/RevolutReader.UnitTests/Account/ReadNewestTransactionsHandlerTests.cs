using System.Net;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Time.Testing;
using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;
using Shouldly;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The newest page (c010 design.md D1, D2, D10): the live transactions dated from 31 days before today, pending ones
/// included and marked, in the bank's order, with the koruna rate and its date, and <c>olderBefore</c> naming the
/// window's first day only when the store keeps something older. The bank is read as the present user handed in; a bank
/// failure comes back as it is, and nothing is kept. Today is the UTC date of the clock (D3).
/// <para>
/// The bank is a hand-written stub of the port (<see cref="StubBankAccount"/>): it answers one fixed result whatever day
/// it is asked from, and records who each read was for. The store is <see cref="InMemoryTransactionStore"/>; the clock a
/// <see cref="FakeTimeProvider"/>. Today is 2026-11-20 unless a test says otherwise, so the window starts on 2026-10-20.
/// What later rules decide is left alone here: where the live read starts (the stub ignores the day it is asked from),
/// the shown details and the kind (every transaction's details are a line that does not repeat its counterparty, and its
/// type code a known one), and what is kept. The days, the rate and its date are written out: they are the contract. The
/// amounts and references are made up.
/// </para>
/// </summary>
public sealed class ReadNewestTransactionsHandlerTests {
  /// <summary>2026-11-20 in UTC, the scenarios' today.</summary>
  private static readonly DateTimeOffset _today = new(2026, 11, 20, 10, 0, 0, TimeSpan.Zero);

  private static readonly DateOnly _november19 = new(2026, 11, 19);
  private static readonly DateOnly _november18 = new(2026, 11, 18);

  /// <summary>The window's first day: 31 days before 2026-11-20.</summary>
  private static readonly DateOnly _windowStart = new(2026, 10, 20);

  /// <summary>The day before the window starts.</summary>
  private static readonly DateOnly _october19 = new(2026, 10, 19);

  private static readonly PresentUser _lucieOnHerPhone = new(IPAddress.Parse("203.0.113.7"), "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)");

  // The window

  /// <summary>
  /// Late on 2026-11-20 in UTC, on a clock whose own time zone is already at 2026-11-21: today is the UTC date (D3), so
  /// the window's first day is 2026-10-20 and its transaction is on the page. The bank's order is not by date, and the page
  /// keeps it.
  /// </summary>
  [Test]
  public async Task The_newest_page_holds_the_live_transactions_dated_from_the_windows_start_in_the_banks_order() {
    FakeTimeProvider clock = new(new DateTimeOffset(2026, 11, 20, 23, 30, 0, TimeSpan.Zero));
    clock.SetLocalTimeZone(TimeZoneInfo.CreateCustomTimeZone("UTC+14", TimeSpan.FromHours(14), "UTC+14", "UTC+14"));
    StubBankAccount bank = new(Lists(
      Settled(_november18, -12.30m),
      Settled(new DateOnly(2026, 11, 20), -3.80m),
      Settled(_windowStart, -7.20m),
      Settled(_november19, 50.00m)));

    TransactionPage page = await NewestPage(bank, new InMemoryTransactionStore(), clock);

    page.Transactions.Select(static transaction => (transaction.Date, transaction.Amount)).ShouldBe([
      (_november18, -12.30m),
      (new DateOnly(2026, 11, 20), -3.80m),
      (_windowStart, -7.20m),
      (_november19, 50.00m),
    ]);
  }

  [Test]
  public async Task A_live_transaction_dated_before_the_windows_start_is_left_off_the_newest_page() {
    StubBankAccount bank = new(Lists(Settled(_november19, -12.30m), Settled(_october19, -7.20m)));

    TransactionPage page = await NewestPage(bank, new InMemoryTransactionStore());

    page.Transactions.Select(static transaction => (transaction.Date, transaction.Amount)).ShouldBe([(_november19, -12.30m)]);
  }

  // What the page says

  [Test]
  public async Task Pending_transactions_are_on_the_newest_page_marked_pending() {
    StubBankAccount bank = new(Lists(Pending(_november19, -8.90m), Settled(_november18, -12.30m)));

    TransactionPage page = await NewestPage(bank, new InMemoryTransactionStore());

    page.Transactions.Select(static transaction => (transaction.Date, transaction.Pending)).ShouldBe([(_november19, true), (_november18, false)]);
  }

  /// <summary>C13's rate and the day it is for, written out: 24.3 koruna per euro, 2026-11-08.</summary>
  [Test]
  public async Task The_newest_page_carries_the_koruna_rate_and_its_date() {
    StubBankAccount bank = new(Lists(Settled(_november18, -12.30m)));

    TransactionPage page = await NewestPage(bank, new InMemoryTransactionStore());

    page.ShouldSatisfyAllConditions(
      () => page.CzkPerEur.ShouldBe(24.3m),
      () => page.RateDate.ShouldBe(new DateOnly(2026, 11, 8)));
  }

  // Older ones kept

  /// <param name="kept">Nothing; or one transaction kept on the window's first day, which is not older than the window.</param>
  [Test]
  [Arguments("nothing")]
  [Arguments("only the window's first day")]
  public async Task The_newest_page_says_nothing_older_is_kept_when_the_store_holds_nothing_before_the_window(string kept) {
    InMemoryTransactionStore store = new();

    if (kept == "only the window's first day")
      await store.Keep([Kept(_windowStart, "e-kept-1")], CancellationToken.None);
    else if (kept != "nothing")
      throw new ArgumentOutOfRangeException(nameof(kept), kept, "Not a known case.");

    TransactionPage page = await NewestPage(new StubBankAccount(Lists(Settled(_november18, -12.30m))), store);

    page.OlderBefore.ShouldBeNull();
  }

  [Test]
  public async Task The_newest_page_names_the_windows_start_when_the_store_holds_something_older() {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept(_october19, "e-kept-1")], CancellationToken.None);

    TransactionPage page = await NewestPage(new StubBankAccount(Lists(Settled(_november18, -12.30m))), store);

    page.OlderBefore.ShouldBe(_windowStart);
  }

  // The read

  [Test]
  public async Task The_bank_is_read_for_the_present_user_handed_in() {
    StubBankAccount bank = new(Lists(Settled(_november18, -12.30m)));

    _ = await Handler(bank, new InMemoryTransactionStore()).Handle(_lucieOnHerPhone, CancellationToken.None);

    bank.TriggersReceived.ShouldHaveSingleItem("one read of the transactions").Value.ShouldBe(_lucieOnHerPhone);
  }

  /// <param name="failure">Each of the bank's three expected failures (c004 design.md D4).</param>
  [Test]
  [Arguments("access expired")]
  [Arguments("rate limited")]
  [Arguments("bank unavailable")]
  public async Task A_bank_failure_comes_back_as_the_same_failure_and_nothing_is_kept(string failure) {
    BankResult<Transactions> answer = failure switch {
      "access expired" => new BankAccessExpired(),
      "rate limited" => new BankRateLimited(),
      "bank unavailable" => new BankUnavailable(),
      _ => throw new ArgumentOutOfRangeException(nameof(failure), failure, "Not a known case."),
    };
    InMemoryTransactionStore store = new();
    await store.Keep([Kept(_october19, "e-kept-1")], CancellationToken.None);

    BankResult<TransactionPage> result = await Handler(new StubBankAccount(answer), store).Handle(_lucieOnHerPhone, CancellationToken.None);

    result.Value.ShouldBe(answer.Value);
    (await store.ReadAll(CancellationToken.None)).Select(static transaction => transaction.Reference)
      .ShouldBe(["e-kept-1"], "the store holds what it held before, and nothing more");
  }

  // The log: a type code the app does not know (D4c). Each page holds one transaction whose code is in question, so the
  // tests hold whether the handler logs once per transaction or once per code on the page.

  /// <summary>
  /// Among two transactions with codes the app knows, one with a code it does not, shaped like a code: one warning, whose
  /// only value is the code, and nothing of the transaction's bank data (its counterparty, amount or text) in the line.
  /// </summary>
  [Test]
  public async Task The_newest_page_logs_an_unknown_code_shaped_type_code_as_a_warning_carrying_the_code() {
    CapturedLog log = new();
    StubBankAccount bank = new(Lists(
      Settled(_november19, -12.30m),
      Settled(_november18, -7.20m) with { TypeCode = "CASHBACK" },
      Settled(_november18, 50.00m)));

    _ = await NewestPage(bank, new InMemoryTransactionStore(), logger: log);

    LogEntry warning = log.Warnings().ShouldHaveSingleItem("the warnings: one, for the one code the app does not know");
    warning.ShouldSatisfyAllConditions(
      () => warning.EventName.ShouldBe("UnknownTypeCode"),
      () => warning.OwnValues().ShouldBe(["CASHBACK"], "the line's values: the code alone"),
      () => warning.ShouldHoldNoBankData());
  }

  /// <summary>Words with an accent and spaces, which the bank could put there: the warning says so without quoting them.</summary>
  [Test]
  public async Task The_newest_page_logs_a_type_code_that_does_not_look_like_a_code_without_quoting_it() {
    CapturedLog log = new();
    StubBankAccount bank = new(Lists(Settled(_november18, -7.20m) with { TypeCode = "Platba v kavárně" }));

    _ = await NewestPage(bank, new InMemoryTransactionStore(), logger: log);

    LogEntry warning = log.Warnings().ShouldHaveSingleItem("the warnings: one, for the code that does not look like one");
    warning.ShouldSatisfyAllConditions(
      () => warning.EventName.ShouldBe("TypeCodeNotLikeACode"),
      () => warning.OwnValues().ShouldBeEmpty("the line's values: none"),
      () => warning.AllText().ShouldNotContain("kavárně", Case.Insensitive),
      () => warning.ShouldHoldNoBankData());
  }

  [Test]
  public async Task The_newest_page_logs_a_transaction_without_a_type_code() {
    CapturedLog log = new();
    StubBankAccount bank = new(Lists(Settled(_november18, -7.20m) with { TypeCode = null }));

    _ = await NewestPage(bank, new InMemoryTransactionStore(), logger: log);

    LogEntry warning = log.Warnings().ShouldHaveSingleItem("the warnings: one, for the transaction without a code");
    warning.ShouldSatisfyAllConditions(
      () => warning.EventName.ShouldBe("NoTypeCode"),
      () => warning.OwnValues().ShouldBeEmpty("the line's values: none"),
      () => warning.ShouldHoldNoBankData());
  }

  // Where the live read starts (D3)

  /// <summary>
  /// After a long pause: the newest kept day, 2026-09-30, is earlier than the window's first day, 2026-10-20, so the bank
  /// is asked from 2026-09-30 to close the gap, while the page still shows only the window.
  /// </summary>
  [Test]
  public async Task The_newest_page_asks_the_bank_from_the_live_reads_start() {
    InMemoryTransactionStore store = new();
    await store.Keep([Kept(new DateOnly(2026, 9, 30), "e-kept-1")], CancellationToken.None);
    StubBankAccount bank = new(Lists(Settled(_november18, -12.30m)));

    _ = await NewestPage(bank, store);

    bank.FromDatesReceived.ShouldBe([new DateOnly(2026, 9, 30)]);
  }

  /// <summary>
  /// The newest kept day, 2026-08-20, is earlier than 89 days before 2026-11-20: one warning, whose only value is the
  /// gap's days (92, from the newest kept day to today), and nothing of the kept or the live transactions' bank data.
  /// </summary>
  [Test]
  public async Task A_gap_beyond_89_days_logs_a_warning_with_its_days() {
    CapturedLog log = new();
    InMemoryTransactionStore store = new();
    await store.Keep([Kept(new DateOnly(2026, 8, 20), "e-kept-1")], CancellationToken.None);
    StubBankAccount bank = new(Lists(Settled(_november18, -12.30m)));

    _ = await NewestPage(bank, store, logger: log);

    LogEntry warning = log.Warnings().ShouldHaveSingleItem("the warnings: one, for the gap");
    warning.ShouldSatisfyAllConditions(
      () => warning.EventName.ShouldBe("HistoryGap"),
      () => warning.OwnValues().ShouldBe(["92"], "the line's values: the gap's days alone"),
      () => warning.ShouldHoldNoBankData());
  }

  private static ReadNewestTransactionsHandler Handler(IBankAccount bank, ITransactionStore store, TimeProvider? clock = null, ILogger<ReadNewestTransactionsHandler>? logger = null) =>
    new(bank, store, clock ?? new FakeTimeProvider(_today), logger ?? NullLogger<ReadNewestTransactionsHandler>.Instance);

  /// <summary>The newest page for <see cref="_lucieOnHerPhone"/>; a failure fails the test.</summary>
  private static async Task<TransactionPage> NewestPage(StubBankAccount bank, ITransactionStore store, TimeProvider? clock = null, ILogger<ReadNewestTransactionsHandler>? logger = null) {
    BankResult<TransactionPage> result = await Handler(bank, store, clock, logger).Handle(_lucieOnHerPhone, CancellationToken.None);

    return result.Value.ShouldBeOfType<TransactionPage>("the newest page, not a failure");
  }

  /// <summary>One page of these transactions, in this order, as the bank's read returns it.</summary>
  private static BankResult<Transactions> Lists(params BankTransaction[] transactions) => new Transactions(transactions);

  /// <summary>
  /// A booked card payment or received transfer of <paramref name="amount"/> EUR on <paramref name="date"/>, with a
  /// reference of its own; its one line of details does not repeat its counterparty, and its type code is a known one.
  /// </summary>
  private static BankTransaction Settled(DateOnly date, decimal amount) => new(
    Reference: FormattableString.Invariant($"e-{date:yyyyMMdd}-{amount}"),
    Status: TransactionStatus.Booked,
    Date: date,
    Amount: amount,
    Currency: "EUR",
    Counterparty: amount < 0m ? "Pekárna U Lípy" : "Jan Novák",
    PaymentDetails: ["Praha 2"],
    TypeCode: amount < 0m ? "CARD_PAYMENT" : "TRANSFER");

  /// <summary>A pending card payment of <paramref name="amount"/> EUR on <paramref name="date"/>, without a reference, as pending ones may come.</summary>
  private static BankTransaction Pending(DateOnly date, decimal amount) => new(
    Reference: null,
    Status: TransactionStatus.Pending,
    Date: date,
    Amount: amount,
    Currency: "EUR",
    Counterparty: "Kavárna Na Rohu",
    PaymentDetails: ["Praha 2"],
    TypeCode: "CARD_PAYMENT");

  /// <summary>A settled payment the store already keeps, on <paramref name="date"/>, first in its day.</summary>
  private static KeptTransaction Kept(DateOnly date, string reference) =>
    new(reference, date, Position: 0, Amount: -4.20m, Currency: "EUR", Counterparty: "Trafika Můstek", PaymentDetails: [], TypeCode: "CARD_PAYMENT");

  /// <summary>
  /// The bank port, answering every transactions read with <paramref name="answer"/>, whatever day it is asked from, and
  /// recording who each read was for. The handler never reads the balance.
  /// </summary>
  private sealed class StubBankAccount(BankResult<Transactions> answer) : IBankAccount {
    private readonly List<ReadTrigger> _triggers = [];
    private readonly List<DateOnly> _fromDates = [];

    /// <summary>Who each transactions read was for, in order.</summary>
    public IReadOnlyList<ReadTrigger> TriggersReceived => _triggers;

    /// <summary>The day each transactions read asked from, in order.</summary>
    public IReadOnlyList<DateOnly> FromDatesReceived => _fromDates;

    public Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken) =>
      throw new InvalidOperationException("The transactions handler never reads the balance.");

    public Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken) {
      _triggers.Add(trigger);
      _fromDates.Add(from);

      return Task.FromResult(answer);
    }
  }

  /// <summary>
  /// The handler's logger, keeping every line it writes: its level, its event's name, its structured values and its
  /// message. A source-generated line's values are its own fields and its message template.
  /// </summary>
  private sealed class CapturedLog : ILogger<ReadNewestTransactionsHandler> {
    private readonly List<LogEntry> _entries = [];

    /// <summary>The lines at <see cref="LogLevel.Warning"/> or above, in the order written.</summary>
    public IReadOnlyList<LogEntry> Warnings() => [.. _entries.Where(static entry => entry.Level >= LogLevel.Warning)];

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      ArgumentNullException.ThrowIfNull(formatter);

      IEnumerable<KeyValuePair<string, object?>> values = state as IEnumerable<KeyValuePair<string, object?>> ?? [];
      _entries.Add(new LogEntry(logLevel, eventId.Name, [.. values], formatter(state, exception)));
    }
  }

  /// <summary>One line of the handler's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, object?>> Values, string Message) {
    /// <summary>The structured value every source-generated line carries besides its own: its message template.</summary>
    private const string ORIGINAL_FORMAT = "{OriginalFormat}";

    /// <summary>
    /// The bank data of the transactions these tests list or keep (made up): counterparties, the line of text, the amounts in
    /// either decimal separator.
    /// </summary>
    private static readonly string[] _bankData = [
      "Pekárna U Lípy", "Jan Novák", "Trafika Můstek", "Praha 2", "7.20", "7,20", "12.30", "12,30", "50.00", "50,00", "4.20", "4,20",
    ];

    /// <summary>The values of the line's own fields, in order, without its message template.</summary>
    public IReadOnlyList<string?> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => pair.Value?.ToString())];

    /// <summary>The message and every value, as one text.</summary>
    public string AllText() => string.Join(" | ", [Message, .. Values.Select(static pair => $"{pair.Key}={pair.Value}")]);

    /// <summary>Fails when the line holds any of the transactions' bank data.</summary>
    public void ShouldHoldNoBankData() {
      string text = AllText();

      _bankData.Where(value => text.Contains(value, StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty("bank data in the line");
    }

    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}