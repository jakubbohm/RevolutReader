using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The transactions' log lines (c010 design.md D4c, D12; CLAUDE.md: never log bank data):
/// <list type="bullet">
/// <item>a type code the app does not know, and that looks like a code (<c>^[A-Z0-9_]{1,40}$</c>), is logged once, as
/// the warning <c>UnknownTypeCode</c> carrying the code and no other value;</item>
/// <item>a type code that does not look like a code is logged as the warning <c>TypeCodeNotLikeACode</c> and never
/// quoted: the bank could put anything there;</item>
/// <item>nothing the app logs while it reads the newest transactions and an older page holds a counterparty, an amount
/// or a line of the bank's text of the transactions read.</item>
/// </list>
/// A rule, not a scenario: no public channel shows logs. The event names are the design's (§ Public API sketch,
/// <c>TransactionsLog</c>).
/// <para>
/// What counts is what the app copy itself logs, through the logging levels of its own <c>appsettings.json</c>, as in
/// <see cref="SignInTelemetryTests"/>: a logger provider in the app copy's container receives every entry the app's
/// filters let through, with its level, event name, message, structured values, scopes and exception. It sees only this
/// app copy's loggers, so tests running in parallel do not mix in.
/// </para>
/// <para>
/// The counterparties and the bank's lines are the spec's made-up ones. The amounts are made up for this guard alone and
/// far above any request's duration in milliseconds, so a log line's timing cannot match one by chance; each is looked for
/// with a decimal point and with a decimal comma. The type codes hold capitals, accents or spaces that no reference, table
/// name or id the harness makes up (lowercase hexadecimal) can hold.
/// </para>
/// </summary>
public sealed class TransactionTelemetryTests : AcceptanceTest {
  /// <summary>The transactions' events (design.md § Public API sketch, <c>TransactionsLog</c>).</summary>
  private const string UNKNOWN_TYPE_CODE = "UnknownTypeCode";
  private const string TYPE_CODE_NOT_LIKE_A_CODE = "TypeCodeNotLikeACode";

  /// <summary>The structured value every source-generated log line carries besides its own: its message template.</summary>
  private const string ORIGINAL_FORMAT = "{OriginalFormat}";

  /// <summary>A type code the app does not know that looks like one (made up).</summary>
  private const string UNKNOWN_CODE = "MADE_UP_TYPE_FOR_THE_GUARD";

  /// <summary>Type codes that do not look like one (made up): words with an accent and spaces; capitals, but 41 of them.</summary>
  private const string CODE_IN_WORDS = "Platba v kavárně";
  private const string CODE_TOO_LONG = "CARD_PAYMENT_AT_A_MERCHANT_ABROAD_IN_EURO";

  private readonly CapturedLogs _logs = new();

  [Test]
  public async Task An_unknown_type_code_that_looks_like_a_code_logs_one_warning_carrying_only_the_code() {
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy", typeCode: UNKNOWN_CODE));

    (await Transactions.AsksForTheTransactions()).Transactions.ShouldNotBeNull("the transactions read answered a page").Count.ShouldBe(1, "the transactions read");

    LogEntry warning = _logs.Of(UNKNOWN_TYPE_CODE).ShouldHaveSingleItem($"{UNKNOWN_TYPE_CODE} lines");
    warning.Level.ShouldBe(LogLevel.Warning, $"the {UNKNOWN_TYPE_CODE} line's level");
    warning.OwnValues().ShouldBe([UNKNOWN_CODE], $"the {UNKNOWN_TYPE_CODE} line's structured values");
  }

  [Test]
  public async Task A_type_code_that_does_not_look_like_a_code_is_never_quoted() {
    CODE_TOO_LONG.Length.ShouldBe(41, "the long code is one character past a code's length");
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(
      TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy", typeCode: CODE_IN_WORDS),
      TransactionAtBank.Payment(StatusAtBank.Booked, 8.90m, on: new DateOnly(2026, 11, 17), to: "Kavárna Na Rohu", typeCode: CODE_TOO_LONG));

    (await Transactions.AsksForTheTransactions()).Transactions.ShouldNotBeNull("the transactions read answered a page").Count.ShouldBe(2, "the transactions read");

    _logs.Of(TYPE_CODE_NOT_LIKE_A_CODE).ShouldNotBeEmpty($"{TYPE_CODE_NOT_LIKE_A_CODE} lines");
    _logs.Of(TYPE_CODE_NOT_LIKE_A_CODE).Select(static entry => entry.Level).ShouldAllBe(level => level == LogLevel.Warning, $"the {TYPE_CODE_NOT_LIKE_A_CODE} lines' levels");
    _logs.Texts().Where(static text => text.Contains(CODE_IN_WORDS, StringComparison.OrdinalIgnoreCase) || text.Contains(CODE_TOO_LONG, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("Log messages, structured values, scope values or exceptions quoting a type code that does not look like a code");
  }

  [Test]
  public async Task Reading_the_transactions_logs_no_counterparty_amount_or_bank_text() {
    string[] bankData = [
      "Pekárna U Lípy", "Kavárna Na Rohu", "Lékárna Benu", "Jan Novák",
      "Praha 2", "Reklamace", "Bankomat Můstek",
      "6871.39", "6871,39", "7294.53", "7294,53", "5183.27", "5183,27", "4416.82", "4416,82",
    ];
    await SignIn.HasSignedIn(Visitor.Lucie);
    Transactions.BankLists(
      TransactionAtBank.Payment(StatusAtBank.Pending, 7294.53m, on: new DateOnly(2026, 11, 19), to: "Kavárna Na Rohu", details: new Lines("Kavárna Na Rohu", "Bankomat Můstek")),
      TransactionAtBank.Payment(StatusAtBank.Booked, 6871.39m, on: new DateOnly(2026, 11, 18), to: "Pekárna U Lípy", details: new Lines("PEKARNA U LIPY", "Praha 2")),
      TransactionAtBank.Refund(StatusAtBank.Booked, 5183.27m, on: new DateOnly(2026, 11, 18), from: "Lékárna Benu", details: new Lines("Reklamace")),
      TransactionAtBank.TransferReceived(StatusAtBank.Booked, 4416.82m, on: new DateOnly(2026, 11, 17), from: "Jan Novák", details: new Lines("Praha 2"), typeCode: UNKNOWN_CODE));

    (await Transactions.AsksForTheTransactions()).Transactions.ShouldNotBeNull("the newest transactions read answered a page").Count.ShouldBe(4, "the newest transactions read");
    (await Transactions.AsksForTheTransactionsBefore(new DateOnly(2026, 11, 21))).Transactions.ShouldNotBeNull("the older page answered").Count.ShouldBe(3, "the settled transactions kept");

    _logs.Of(UNKNOWN_TYPE_CODE).ShouldNotBeEmpty($"{UNKNOWN_TYPE_CODE} lines, so the warnings with a transaction's code ran");
    _logs.Texts().Where(text => bankData.Any(value => text.Contains(value, StringComparison.OrdinalIgnoreCase)))
      .ShouldBeEmpty("Log messages, structured values, scope values or exceptions holding a counterparty, an amount or a line of the bank's text");
  }

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));

  /// <summary>
  /// One log entry of the app copy (<see cref="CapturingLoggerProvider"/>): its category, level and event's name, its own
  /// structured values (<see cref="OwnValues"/>), and all its text.
  /// </summary>
  private sealed record LogEntry(string Category, LogLevel Level, string? EventName, IReadOnlyList<KeyValuePair<string, string?>> Values, IReadOnlyList<string> Texts) {
    /// <summary>The values of the entry's own structured fields, in order, without its message template.</summary>
    public IReadOnlyList<string?> OwnValues() => [.. Values.Where(static pair => pair.Key != ORIGINAL_FORMAT).Select(static pair => pair.Value)];

    /// <summary>For a failure message: the level, the event, the category.</summary>
    public override string ToString() => $"{Level} {EventName} ({Category})";
  }

  /// <summary>Every log entry of the app copy, in the order logged.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>The entries of this event.</summary>
    public IReadOnlyList<LogEntry> Of(string eventName) {
      lock (_lock)
        return [.. _entries.Where(entry => entry.EventName == eventName)];
    }

    /// <summary>Every text of every entry.</summary>
    public IReadOnlyList<string> Texts() {
      lock (_lock)
        return [.. _entries.SelectMany(static entry => entry.Texts)];
    }

    public void Add(LogEntry entry) {
      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>
  /// The app copy's logger provider writing into <see cref="CapturedLogs"/>: each entry's message, each structured value,
  /// each scope and its values, and the exception; the app copy's container owns it.
  /// </summary>
  private sealed class CapturingLoggerProvider(CapturedLogs logs) : ILoggerProvider, ISupportExternalScope {
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this, categoryName);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    private void Capture<TState>(string category, LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      List<string> texts = [formatter(state, exception)];

      AddValues(texts, state);

      if (exception is not null)
        texts.Add(exception.ToString());

      _scopes.ForEachScope(static (scope, list) => AddValues(list, scope), texts);

      IReadOnlyList<KeyValuePair<string, string?>> values = state is IEnumerable<KeyValuePair<string, object?>> pairs
        ? [.. pairs.Select(static pair => new KeyValuePair<string, string?>(pair.Key, pair.Value?.ToString()))]
        : [];

      logs.Add(new LogEntry(category, level, eventId.Name, values, texts));
    }

    private static void AddValues(List<string> texts, object? state) {
      if (state is null)
        return;

      texts.Add(state.ToString() ?? string.Empty);

      if (state is IEnumerable<KeyValuePair<string, object?>> values)
        texts.AddRange(values.Select(static pair => $"{pair.Key}={pair.Value}"));
    }

    private sealed class CapturingLogger(CapturingLoggerProvider provider, string category) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider._scopes.Push(state);

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        provider.Capture(category, logLevel, eventId, state, exception, formatter);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}