using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// Sign-in's log lines (c007 design.md D3, D8; CLAUDE.md: no email address in any log line). A sign-in by an account that
/// is not on the allowlist is logged once, at sign-in, as the warning <c>SignInRefused</c>, never with the email; the
/// per-request refusals that follow, one per app open, are not warned; an allowed user's sign-in logs no warning at all.
/// A rule, not a scenario: no public channel shows logs.
/// <para>
/// What counts is what the app copy itself logs, through the logging levels of its own <c>appsettings.json</c>: a logger
/// provider registered in the app copy's container receives every entry the app's filters let through, with its level,
/// event name, message, structured values, scopes and exception. The provider sees only this app copy's loggers, so tests
/// running in parallel do not mix in.
/// </para>
/// </summary>
public sealed class SignInTelemetryTests : AcceptanceTest {
  /// <summary>The refused sign-in's event (design.md § Public API sketch, <c>SignInLog</c>).</summary>
  private const string SIGN_IN_REFUSED = "SignInRefused";

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

  protected override void ConfigureTestServices(IServiceCollection services) => services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));

  /// <summary>One log entry of the app copy: its level, its event's name, and all its text (<see cref="CapturingLoggerProvider"/>).</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, IReadOnlyList<string> Texts);

  /// <summary>Every log entry of the app copy, in the order logged.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>The entries at <see cref="LogLevel.Warning"/> or above.</summary>
    public IReadOnlyList<LogEntry> Warnings() {
      lock (_lock)
        return [.. _entries.Where(static entry => entry.Level >= LogLevel.Warning)];
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

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    private void Capture<TState>(LogLevel level, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      List<string> texts = [formatter(state, exception)];

      AddValues(texts, state);

      if (exception is not null)
        texts.Add(exception.ToString());

      _scopes.ForEachScope(static (scope, list) => AddValues(list, scope), texts);

      logs.Add(new LogEntry(level, eventId.Name, texts));
    }

    private static void AddValues(List<string> texts, object? state) {
      if (state is null)
        return;

      texts.Add(state.ToString() ?? string.Empty);

      if (state is IEnumerable<KeyValuePair<string, object?>> values)
        texts.AddRange(values.Select(static pair => $"{pair.Key}={pair.Value}"));
    }

    private sealed class CapturingLogger(CapturingLoggerProvider provider) : ILogger {
      public IDisposable? BeginScope<TState>(TState state) where TState : notnull => provider._scopes.Push(state);

      public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

      public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
        provider.Capture(logLevel, eventId, state, exception, formatter);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }
}