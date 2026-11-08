using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// Sign-in's log lines (c007 design.md D3, D8; CLAUDE.md: no email address in any log line):
/// <list type="bullet">
/// <item>a sign-in by an account that is not on the allowlist is logged once, at sign-in, as the warning
/// <c>SignInRefused</c>, never with the email; the per-request refusals that follow, one per app open, are not warned; an
/// allowed user's sign-in logs no warning at all;</item>
/// <item>a sign-in that fails is logged once, as the warning <c>SignInFailed</c> with only the failure's kind (Microsoft's
/// error code when it has the shape of one, else the exception's type), and no line carries the exception or quotes what
/// was posted: anyone can post an error and its description to the return address, and an exception message may quote
/// the token or the foreign issuer;</item>
/// <item>a sign-in cancelled at Microsoft is logged as <c>SignInCancelled</c> at Information, with nothing at Warning or
/// above.</item>
/// </list>
/// A rule, not a scenario: no public channel shows logs.
/// <para>
/// What counts is what the app copy itself logs, through the logging levels of its own <c>appsettings.json</c>: a logger
/// provider registered in the app copy's container receives every entry the app's filters let through, with its level,
/// event name, message, structured values, scopes and exception. The provider sees only this app copy's loggers, so tests
/// running in parallel do not mix in.
/// </para>
/// </summary>
public sealed class SignInTelemetryTests : AcceptanceTest {
  /// <summary>Sign-in's events (design.md § Public API sketch, <c>SignInLog</c>) and the failure's structured value.</summary>
  private const string SIGN_IN_REFUSED = "SignInRefused";
  private const string SIGN_IN_FAILED = "SignInFailed";
  private const string SIGN_IN_CANCELLED = "SignInCancelled";
  private const string KIND = "Kind";

  /// <summary>An exception's type name, as a failure's kind is when Microsoft's error is not code-shaped.</summary>
  private const string EXCEPTION_TYPE_NAME = "^[A-Z][A-Za-z0-9]*Exception$";

  /// <summary>
  /// What anyone posting to the return address could put in an error and its description (made up): an email address, and
  /// a description holding it with a mark of its own.
  /// </summary>
  private const string MADE_UP_EMAIL = "lucie@example.com";
  private const string DESCRIPTION_MARK = "popis-chyby-7c41";
  private const string MADE_UP_DESCRIPTION = $"{DESCRIPTION_MARK} for {MADE_UP_EMAIL}";
  private readonly CapturedLogs _logs = new();

  [Test]
  public async Task A_strangers_sign_in_logs_one_SignInRefused_warning_and_never_the_email() {
    SignIn.IsNotOnTheAllowlist(Visitor.Stranger.Email);

    await SignIn.SignsIn(Visitor.Stranger);
    // Two app opens after the sign-in: each one is refused, and neither may add a warning.
    (await SignIn.AsksWhoIsSignedIn()).Refused.ShouldBeTrue("the stranger is signed in and refused");
    (await SignIn.AsksWhoIsSignedIn()).Refused.ShouldBeTrue("the stranger is signed in and refused");

    _logs.Warnings().Select(static entry => entry.EventName).ShouldBe([SIGN_IN_REFUSED], "Warnings logged for a stranger's sign-in and two app opens");
    _logs.Texts().Where(static text => text.Contains(Visitor.Stranger.Email, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("Log messages, structured values, scope values or exceptions naming the stranger's email");
  }

  [Test]
  public async Task An_allowed_users_sign_in_logs_no_warning() {
    SignIn.IsOnTheAllowlist(Visitor.Lucie.Email);

    await SignIn.HasSignedIn(Visitor.Lucie);

    _logs.Warnings().ShouldBeEmpty("Warnings logged for an allowed user's sign-in");
  }

  [Test]
  public async Task A_failed_sign_in_logs_one_SignInFailed_warning_and_no_exception_text() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");

    (await SignIn.MicrosoftAnswersWith(Visitor.WorkAccount)).ShouldBe(Landing.StartPage, "the visitor lands on the start page");

    IReadOnlyList<LogEntry> warnings = _logs.Warnings();
    warnings.Select(static entry => (entry.Level, entry.EventName))
      .ShouldBe([(LogLevel.Warning, SIGN_IN_FAILED)], $"Lines at Warning or above for a failed sign-in: {string.Join("; ", warnings)}");
    _logs.Entries().Where(static entry => entry.CarriesException).ShouldBeEmpty("Log entries carrying an exception, whose message may quote the token");
    _logs.Texts().Where(static text => text.Contains(IdentityAtMicrosoft.WORK_OR_SCHOOL_TENANT, StringComparison.OrdinalIgnoreCase))
      .ShouldBeEmpty("Log texts naming the foreign directory, which only an exception message would");
  }

  [Test]
  public async Task A_cancel_at_Microsoft_logs_SignInCancelled_at_Information_and_nothing_at_Warning_or_above() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");

    (await SignIn.CancelsAtMicrosoft()).ShouldBe(Landing.StartPage, "the visitor lands on the start page");

    _logs.Of(SIGN_IN_CANCELLED).Select(static entry => entry.Level).ShouldBe([LogLevel.Information], "SignInCancelled lines");
    _logs.Warnings().ShouldBeEmpty("Lines at Warning or above for a cancelled sign-in");
  }

  [Test]
  public async Task An_error_code_from_Microsoft_is_logged_as_the_failures_kind() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");

    (await SignInDriver.ReturnWithError("server_error")).ShouldBe(Landing.StartPage, "the visitor lands on the start page");
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn, "the visitor is signed out");

    _logs.Of(SIGN_IN_FAILED).Select(static entry => entry.Value(KIND)).ShouldBe(["server_error"], "SignInFailed kinds");
  }

  [Test]
  public async Task An_error_that_is_not_code_shaped_is_logged_as_the_exception_type_and_never_quoted() {
    (await SignIn.StartsSignIn()).SentToMicrosoft.ShouldBeTrue("the sign-in started");

    (await SignInDriver.ReturnWithError(MADE_UP_EMAIL, MADE_UP_DESCRIPTION)).ShouldBe(Landing.StartPage, "the visitor lands on the start page");
    (await SignIn.AsksWhoIsSignedIn()).ShouldBe(WhoAnswer.AskedToSignIn, "the visitor is signed out");

    _logs.Of(SIGN_IN_FAILED).Select(static entry => entry.Value(KIND)).ShouldHaveSingleItem("one SignInFailed line")
      .ShouldNotBeNull("its kind").ShouldMatch(EXCEPTION_TYPE_NAME, "its kind is an exception's type name");
    _logs.Texts().Where(static text => text.Contains(MADE_UP_EMAIL, StringComparison.OrdinalIgnoreCase) || text.Contains(DESCRIPTION_MARK, StringComparison.Ordinal))
      .ShouldBeEmpty("Log texts quoting the error or its description");
  }

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));

  /// <summary>
  /// One log entry of the app copy (<see cref="CapturingLoggerProvider"/>): its category, level and event's name, its own
  /// structured values (<see cref="Value"/>), whether it carries an exception, and all its text.
  /// </summary>
  private sealed record LogEntry(string Category, LogLevel Level, string? EventName, IReadOnlyDictionary<string, string?> Values, bool CarriesException, IReadOnlyList<string> Texts) {
    /// <summary>The entry's structured value <paramref name="name"/>, as text; <see langword="null"/> when it has none.</summary>
    public string? Value(string name) => Values.GetValueOrDefault(name);

    /// <summary>For a failure message: the level, the event, the category.</summary>
    public override string ToString() => $"{Level} {EventName} ({Category})";
  }

  /// <summary>Every log entry of the app copy, in the order logged.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>Every entry.</summary>
    public IReadOnlyList<LogEntry> Entries() {
      lock (_lock)
        return [.. _entries];
    }

    /// <summary>The entries at <see cref="LogLevel.Warning"/> or above.</summary>
    public IReadOnlyList<LogEntry> Warnings() {
      lock (_lock)
        return [.. _entries.Where(static entry => entry.Level >= LogLevel.Warning)];
    }

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

      Dictionary<string, string?> values = state is IEnumerable<KeyValuePair<string, object?>> pairs
        ? pairs.GroupBy(static pair => pair.Key).ToDictionary(static group => group.Key, static group => group.Last().Value?.ToString())
        : [];

      logs.Add(new LogEntry(category, level, eventId.Name, values, exception is not null, texts));
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