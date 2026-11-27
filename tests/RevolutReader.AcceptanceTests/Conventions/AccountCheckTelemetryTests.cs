using System.Globalization;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// The account check's log lines (c014 design.md D15; CLAUDE.md: never log bank data or secrets): what a check came to and
/// counts only. A whole notifying check runs through the app copy: balances kept, a fall to a new balance, Lucie and Petr
/// with registered phones, the check sent with the check key, the bank read for the phone as a present user (the balance,
/// and since c018 the transactions, which list a card payment of today the check records, design.md D5) and the change
/// pushed to both phones. Nothing the app copy logs during the whole test holds:
/// <list type="bullet">
/// <item>an amount, in any form: the balance kept, the new balance, the change, the new balance's koruna value (at the
/// rate the notification carries, the one the app copy answered: the fake CNB's, c017 design.md D10) and the card
/// payment's amount, with a dot or a decimal comma, with an ordinary or a no-break space between thousands (a U+2212 minus
/// is caught by the digits after it);</item>
/// <item>since c019, the balance fragment of each phone's notification (design.md D2, "the fragment never reaches a log"),
/// whole or its payload alone, the new balance in base64url JSON; looked for only when the notification carries one, which
/// the account-check scenario pins, so the guard stays green until the server puts it there and holds it from then on;</item>
/// <item>the card payment's payee or its reference;</item>
/// <item>a time a balance was read (the new read's and the kept balances');</item>
/// <item>an email address of the allowlist;</item>
/// <item>the check key, the message key, the VAPID pair or a phone's keys.</item>
/// </list>
/// The test first checks that the lines it guards were written (<c>CheckEnded</c>, <c>ChangeSent</c>, <c>PushSent</c> and
/// the bank adapter's balance and transactions lines), so it cannot pass without them. A second test does the same for a
/// check whose transactions read fails, and its <c>FirstSeenNotRecorded</c> line (c018 design.md D5, D10).
/// <para>
/// A rule, not a scenario, as <see cref="PushTelemetryTests"/>: a logger provider in the app copy's container receives every
/// entry the app's filters let through (<c>appsettings.json</c>'s levels), with its message, structured values, scopes and
/// exception, and sees only this app copy's loggers.
/// </para>
/// <para>
/// The amounts are distinctive, and every form looked for either carries a separator (a decimal mark or a space) or has
/// six digits: a dot form such as "9234.56" would be a duration of more than five seconds, longer than any request here
/// may take, so it cannot match a line's duration by chance, nor a trace id's hex digits.
/// </para>
/// </summary>
public sealed class AccountCheckTelemetryTests : AcceptanceTest {
  /// <summary>The account check's and the sender's events (design.md D15; c011 design.md D4).</summary>
  private const string CHECK_ENDED = "CheckEnded";
  private const string CHANGE_SENT = "ChangeSent";
  private const string PUSH_SENT = "PushSent";

  /// <summary>The event of a check that recorded no first-seen times (c018 design.md D5, § Public API sketch).</summary>
  private const string FIRST_SEEN_NOT_RECORDED = "FirstSeenNotRecorded";

  /// <summary>How the bank adapter's line of a balance read starts (c006 design.md D8).</summary>
  private const string BALANCE_READ = "Bank balance read";

  /// <summary>How the bank adapter's line of a transactions read starts (c006 design.md D8): a check's since c018 (design.md D5).</summary>
  private const string TRANSACTIONS_READ = "Bank transactions read";

  /// <summary>The amount of the card payment the bank lists, made up.</summary>
  private const decimal PAYMENT = 2468.13m;

  /// <summary>Who the card payment the bank lists went to, made up.</summary>
  private const string PAYEE = "Hlídka: Kavárna Na Rohu";

  /// <summary>The bank's reference of the card payment it lists, made up.</summary>
  private const string PAYMENT_REFERENCE = "e-c018-hlidka-4721";

  /// <summary>The balance both kept balances hold, made up.</summary>
  private const decimal KEPT = 18531.86m;

  /// <summary>The bank's new balance, a fall from <see cref="KEPT"/>, made up.</summary>
  private const decimal READ = 9297.30m;

  /// <summary>
  /// The CNB's latest rate the check reads, made up and set, so the koruna value the guard looks for is known without
  /// reading it from the notification, whose balance moved into its address in c019 (design.md D2).
  /// </summary>
  private const decimal CZK_PER_EUR = 24.6m;

  private readonly CapturedLogs _logs = new();

  [Test]
  public async Task A_notifying_check_logs_no_amount_in_any_form_no_email_and_no_key() {
    PhoneForPush luciesPhone = Push.NewPhone("Hlídka: Luciin telefon");
    PhoneForPush petrsPhone = Push.NewPhone("Hlídka: Petrův telefon");
    await SignIn.HasSignedIn(Visitor.Lucie);
    await Push.HasRegistered(luciesPhone);
    SignIn.IsOnTheAllowlist(Visitor.Petr.Email);
    await SignIn.HasSignedIn(Visitor.Petr);
    await Push.HasRegistered(petrsPhone);
    await Check.HasKept(lastSeen: KEPT, lastNotified: KEPT);
    Bank.HasAvailableBalance(READ, "EUR");
    Rate.TheCnbsLatestRateIs(CZK_PER_EUR);
    Transactions.BankLists(TodaysPayment());
    DateTimeOffset readAt = Check.Now;

    (await Check.PhoneAsksForACheck()).ShouldBe(CheckAnswer.BalanceChanged, "the check notified the change");
    PushReceived luciesPush = Push.Received(luciesPhone).ShouldHaveSingleItem("Lucie's phone got the notification");
    PushReceived petrsPush = Push.Received(petrsPhone).ShouldHaveSingleItem("Petr's phone got the notification");

    string[] guarded = [CHECK_ENDED, CHANGE_SENT, PUSH_SENT];
    guarded.Except(_logs.EventNames(), StringComparer.Ordinal).ShouldBeEmpty("lines not written, so the guard would not read them");
    _logs.Messages().ShouldContain(static message => message.StartsWith(BALANCE_READ, StringComparison.Ordinal), "the bank adapter's balance line");
    _logs.Messages().ShouldContain(static message => message.StartsWith(TRANSACTIONS_READ, StringComparison.Ordinal), "the bank adapter's transactions line");

    string checkKey = Services.GetRequiredService<IOptions<AccountCheckOptions>>().Value.Key;
    (string What, string Value)[] forbidden = [
      .. AmountForms("the kept balance", KEPT),
      .. AmountForms("the new balance", READ),
      .. AmountForms("the change", KEPT - READ),
      .. KorunaForms("the new balance's koruna value", READ * CZK_PER_EUR),
      .. TimeForms("the new read's time", readAt),
      .. TimeForms("the kept balances' time", readAt.AddHours(-1)),
      .. AmountForms("the card payment's amount", PAYMENT),
      .. FragmentForms("Lucie's notification's balance fragment", luciesPush.BalanceFragment),
      .. FragmentForms("Petr's notification's balance fragment", petrsPush.BalanceFragment),
      ("the card payment's payee", PAYEE),
      ("the card payment's reference", PAYMENT_REFERENCE),
      ("Lucie's email", Visitor.Lucie.Email),
      ("Petr's email", Visitor.Petr.Email),
      ("the check key", checkKey),
      ("the message key", FakePushService.MessageKey),
      ("the VAPID public key", FakePushService.VapidPublicKey),
      ("the VAPID private key", FakePushService.VapidPrivateKey),
    ];

    _logs.Leaks(forbidden).ShouldBeEmpty("Log messages, structured values, scope values or exceptions naming an amount, a time read, an email or a key");
  }

  /// <summary>
  /// A notifying check whose transactions read fails at the bank, its own error on every transactions request (c018
  /// design.md D5, D10; tasks.md 32.2): the app copy writes one <c>FirstSeenNotRecorded</c> line at Warning, whose message
  /// names the kind, <c>BankUnavailable</c>, and nothing else (§ Public API sketch); and no line the app copy writes holds
  /// an amount (the balances, the change, the card payment the bank lists), the payment's payee or its reference.
  /// </summary>
  [Test]
  public async Task A_failed_transactions_read_logs_one_FirstSeenNotRecorded_warning_with_its_kind_and_no_amount_name_or_reference() {
    await Check.HasKept(lastSeen: KEPT, lastNotified: KEPT);
    Bank.HasAvailableBalance(READ, "EUR");
    Transactions.BankLists(TodaysPayment());
    Bank.ReportsOwnErrorForTransactions();

    (await Check.PhoneAsksForACheck()).ShouldBe(CheckAnswer.BalanceChanged, "the check answered as its balance read decides");

    IReadOnlyList<LogEntry> notRecorded = _logs.Of(FIRST_SEEN_NOT_RECORDED);
    (string What, string Value)[] forbidden = [
      .. AmountForms("the kept balance", KEPT),
      .. AmountForms("the new balance", READ),
      .. AmountForms("the change", KEPT - READ),
      .. AmountForms("the card payment's amount", PAYMENT),
      ("the card payment's payee", PAYEE),
      ("the card payment's reference", PAYMENT_REFERENCE),
    ];
    notRecorded.ShouldSatisfyAllConditions(
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Level.ShouldBe(LogLevel.Warning),
      () => notRecorded.ShouldHaveSingleItem("one FirstSeenNotRecorded line").Texts[0]
        .ShouldBe("An account check recorded no first-seen times: BankUnavailable", "its message names the kind, and nothing else"),
      () => _logs.Leaks(forbidden).ShouldBeEmpty("Log messages, structured values, scope values or exceptions naming an amount, the payee or the reference"));
  }

  /// <summary>
  /// A pending card payment of <see cref="PAYMENT"/> to <see cref="PAYEE"/>, with its reference
  /// (<see cref="PAYMENT_REFERENCE"/>), dated the scenario's today, so a check that reads it records it.
  /// </summary>
  private static TransactionAtBank TodaysPayment() =>
    TransactionAtBank.Payment(StatusAtBank.Pending, PAYMENT, on: TransactionsDsl.DefaultToday, to: PAYEE, reference: PAYMENT_REFERENCE);

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));

  /// <summary>
  /// <paramref name="amount"/> (more than a thousand, two decimals) in the forms a line could write it: as invariant text
  /// (a <see cref="decimal"/> keeps its trailing zero, a <see cref="double"/> drops it, so the last decimal is left off),
  /// with a decimal comma, and its thousands with an ordinary or a no-break space.
  /// </summary>
  private static (string What, string Value)[] AmountForms(string what, decimal amount) {
    string invariant = amount.ToString("0.00", CultureInfo.InvariantCulture);
    string withoutItsLastDecimal = invariant[..^1];
    string thousands = Math.Truncate(amount / 1000).ToString(CultureInfo.InvariantCulture);
    string rest = (Math.Truncate(amount) % 1000).ToString("000", CultureInfo.InvariantCulture);

    return [
      ($"{what} with a dot", withoutItsLastDecimal),
      ($"{what} with a comma", withoutItsLastDecimal.Replace('.', ',')),
      ($"{what} with a space between thousands", $"{thousands} {rest}"),
      ($"{what} with a no-break space between thousands", $"{thousands}\u00A0{rest}"),
    ];
  }

  /// <summary>
  /// The koruna value of <paramref name="koruna"/> in whole koruna (six digits here), as a number and with an ordinary or
  /// a no-break space between thousands.
  /// </summary>
  private static (string What, string Value)[] KorunaForms(string what, decimal koruna) {
    decimal whole = Math.Round(koruna, MidpointRounding.AwayFromZero);
    string thousands = Math.Truncate(whole / 1000).ToString(CultureInfo.InvariantCulture);
    string rest = (whole % 1000).ToString("000", CultureInfo.InvariantCulture);

    return [
      ($"{what} as a number", whole.ToString(CultureInfo.InvariantCulture)),
      ($"{what} with a space between thousands", $"{thousands} {rest}"),
      ($"{what} with a no-break space between thousands", $"{thousands}\u00A0{rest}"),
    ];
  }

  /// <summary>
  /// A notification's balance fragment (c019 design.md D2: <c>balance=&lt;payload&gt;.&lt;code&gt;</c>, the new balance
  /// in base64url JSON), as a line could write it: whole, and its payload alone. None when the notification carries no
  /// fragment: whether it carries one is the scenario's claim (account-check, "The notification carries the new balance
  /// for the phone to keep"), not this guard's.
  /// </summary>
  private static (string What, string Value)[] FragmentForms(string what, string? fragment) {
    if (fragment is null)
      return [];

    string payload = fragment[(fragment.IndexOf('=', StringComparison.Ordinal) + 1)..].Split('.')[0];

    return [
      ($"{what}, whole", fragment),
      ($"{what}'s payload", payload),
    ];
  }

  /// <summary>
  /// <paramref name="time"/> to the second, as a line could write it: its time of day on a 24-hour and a 12-hour clock, in
  /// UTC and in this machine's time zone.
  /// </summary>
  private static (string What, string Value)[] TimeForms(string what, DateTimeOffset time) {
    DateTimeOffset utc = time.ToUniversalTime();
    DateTimeOffset local = time.ToLocalTime();

    return [
      ($"{what} (UTC, 24 h)", utc.ToString("H:mm:ss", CultureInfo.InvariantCulture)),
      ($"{what} (UTC, 12 h)", utc.ToString("h:mm:ss", CultureInfo.InvariantCulture)),
      ($"{what} (local, 24 h)", local.ToString("H:mm:ss", CultureInfo.InvariantCulture)),
      ($"{what} (local, 12 h)", local.ToString("h:mm:ss", CultureInfo.InvariantCulture)),
    ];
  }

  /// <summary>One log entry of the app copy: its category, level and event's name, and all its text, its message first.</summary>
  private sealed record LogEntry(string Category, LogLevel Level, string? EventName, IReadOnlyList<string> Texts) {
    /// <summary>For a failure message: the level, the event, the category.</summary>
    public override string ToString() => $"{Level} {EventName} ({Category})";
  }

  /// <summary>Every log entry of the app copy, in the order logged.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>The event names logged, each once.</summary>
    public IReadOnlyList<string> EventNames() {
      lock (_lock)
        return [.. _entries.Select(static entry => entry.EventName).OfType<string>().Distinct(StringComparer.Ordinal)];
    }

    /// <summary>The entries of the event <paramref name="eventName"/>, in the order logged.</summary>
    public IReadOnlyList<LogEntry> Of(string eventName) {
      lock (_lock)
        return [.. _entries.Where(entry => entry.EventName == eventName)];
    }

    /// <summary>Every entry's message, in the order logged.</summary>
    public IReadOnlyList<string> Messages() {
      lock (_lock)
        return [.. _entries.Select(static entry => entry.Texts[0])];
    }

    /// <summary>For each entry holding a value of <paramref name="forbidden"/>: what it holds and the entry, never the value itself.</summary>
    public List<string> Leaks(IReadOnlyList<(string What, string Value)> forbidden) {
      lock (_lock) {
        return [
          .. _entries.SelectMany(entry => forbidden
            .Where(value => entry.Texts.Any(text => text.Contains(value.Value, StringComparison.OrdinalIgnoreCase)))
            .Select(value => $"{value.What} in {entry}")),
        ];
      }
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

      logs.Add(new LogEntry(category, level, eventId.Name, texts));
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