using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using OpenTelemetry.Trace;
using RevolutReader.AcceptanceTests.Drivers;
using RevolutReader.AcceptanceTests.Dsl;
using Shouldly;
using TUnit.AspNetCore;

namespace RevolutReader.AcceptanceTests.Conventions;

/// <summary>
/// No account identifiers in logs or traces (c004 design.md D5; CLAUDE.md: never log account identifiers). The bank's
/// paths carry the account id, and the user headers carry the user's address and browser (personal data with no use in
/// the log, D5); the HTTP client's default logging and the HTTP-client trace instrumentation record a request's URL. So
/// the test's app copy reads the bank once for its balance and once for its transactions, for a present user, and
/// nothing it logs (message, structured value or scope value) or exports as a trace (activity name, tag, event or
/// status) may contain the configured account id, the session id, or the user's IP address or browser.
/// <para>
/// The present user is the guard's own, with an address and a browser no other test uses: the app copies of tests running
/// in parallel export into this test's collection too (<see cref="ExportedActivities"/>), and the server activity of
/// every request an app copy answers records that request's browser (<c>user_agent.original</c>, OpenTelemetry's
/// ASP.NET Core instrumentation). A shared value would fail this test whenever such a request ran at the same time.
/// </para>
/// <para>
/// A rule, not a scenario: no public channel shows logs. "Exported" is what OpenTelemetry's in-memory exporter receives
/// from the app's own tracing setup. TUnit's own trace additions (its HTTP activity source and correlation processor,
/// its headers on the app's outgoing calls) are switched off for this test, so only what the app itself records counts.
/// The fake bank's own server, an ASP.NET Core host in the same process, records nothing: <see cref="FakeBank"/> gives it
/// a diagnostic listener and an activity source nobody listens to. Otherwise its server activities, whose path carries the
/// account id, would arrive here as if the app had recorded them. So nothing exported is excluded: every activity counts.
/// </para>
/// </summary>
public sealed class BankTelemetryTests : AcceptanceTest {
  /// <summary>The guard's own present user: a documentation address (RFC 5737) and a made-up browser, both used nowhere else.</summary>
  private static readonly UserAtDevice _user = new("192.0.2.71", "Mozilla/5.0 (RevolutReader telemetry guard; made up)");

  private readonly CapturedLogs _logs = new();
  private readonly ExportedActivities _traces = new();

  [Test]
  public async Task Bank_reads_leave_no_account_id_session_id_or_user_headers_in_logs_or_traces() {
    Bank.HasAvailableBalance(1234.56m);
    Bank.Lists(TransactionAtBank.Payment(StatusAtBank.Booked, 12.30m, on: new DateOnly(2026, 11, 3), to: "Pekárna U Lípy", reference: "e-101"));

    (await Bank.ReadBalanceFor(_user)).Outcome.ShouldBe(BankOutcome.Read, "the balance read reached the bank");
    (await Bank.ReadTransactionsFrom(new DateOnly(2026, 11, 1), _user)).Outcome.ShouldBe(BankOutcome.Read, "the transactions read reached the bank");

    string[] identifiers = [ConfiguredBankSetting("AccountId"), ConfiguredBankSetting("SessionId"), _user.IpAddress, _user.Browser];

    _logs.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Log messages, structured values or scope values naming the account, the session, or the user's address or browser");
    _traces.Texts().Where(text => Names(text, identifiers)).ShouldBeEmpty("Exported trace names, tags, events or statuses naming the account, the session, or the user's address or browser");
  }

  protected override void ConfigureTestOptions(WebApplicationTestOptions options) {
    ArgumentNullException.ThrowIfNull(options);

    options.AutoConfigureOpenTelemetry = false;
    options.AutoPropagateHttpClientFactory = false;
  }

  protected override void ConfigureTestServices(IServiceCollection services) {
    services.AddSingleton<ILoggerProvider>(_ => new CapturingLoggerProvider(_logs));
    services.ConfigureOpenTelemetryTracerProvider(tracing => tracing.AddInMemoryExporter(_traces));
  }

  private static bool Names(string text, IEnumerable<string> identifiers) => identifiers.Any(identifier => text.Contains(identifier, StringComparison.OrdinalIgnoreCase));

  /// <summary>The value the app copy was configured with, in its <c>EnableBanking</c> section.</summary>
  private string ConfiguredBankSetting(string key) {
    string? value = Services.GetRequiredService<IConfiguration>()[$"EnableBanking:{key}"];

    value.ShouldNotBeNullOrWhiteSpace($"the app copy's EnableBanking:{key}");

    return value;
  }

  /// <summary>Every log entry of the app copy, as text: the message, each structured value, each scope and its values, the exception.</summary>
  private sealed class CapturedLogs {
    private readonly Lock _lock = new();
    private readonly List<string> _texts = [];

    public IReadOnlyList<string> Texts() {
      lock (_lock)
        return [.. _texts];
    }

    public void Add(IEnumerable<string> texts) {
      lock (_lock)
        _texts.AddRange(texts);
    }
  }

  /// <summary>The app copy's logger provider writing into <see cref="CapturedLogs"/>, scopes included; the app copy's container owns it.</summary>
  private sealed class CapturingLoggerProvider(CapturedLogs logs) : ILoggerProvider, ISupportExternalScope {
    private IExternalScopeProvider _scopes = new LoggerExternalScopeProvider();

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(this);

    public void SetScopeProvider(IExternalScopeProvider scopeProvider) => _scopes = scopeProvider;

    private void Capture<TState>(TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      List<string> texts = [formatter(state, exception)];

      AddValues(texts, state);

      if (exception is not null)
        texts.Add(exception.ToString());

      _scopes.ForEachScope(static (scope, list) => AddValues(list, scope), texts);

      logs.Add(texts);
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
        provider.Capture(state, exception, formatter);
    }

    #region IDisposable

    public void Dispose() {
    }

    #endregion
  }

  /// <summary>
  /// The in-memory exporter's collection, safe for concurrent adds: the app copy's tracer listens process-wide, so the
  /// activities of other tests' app copies, running in parallel, arrive here too (with their own made-up ids).
  /// </summary>
  private sealed class ExportedActivities : ICollection<Activity> {
    private readonly Lock _lock = new();
    private readonly List<Activity> _activities = [];

    public int Count {
      get {
        lock (_lock)
          return _activities.Count;
      }
    }

    public bool IsReadOnly => false;

    /// <summary>Every exported activity, as text: its names, status, tags, events and their tags.</summary>
    public IReadOnlyList<string> Texts() {
      Activity[] activities;

      lock (_lock)
        activities = [.. _activities];

      return [.. activities.SelectMany(static activity => TextsOf(activity))];
    }

    public void Add(Activity item) {
      lock (_lock)
        _activities.Add(item);
    }

    public void Clear() {
      lock (_lock)
        _activities.Clear();
    }

    public bool Contains(Activity item) {
      lock (_lock)
        return _activities.Contains(item);
    }

    public void CopyTo(Activity[] array, int arrayIndex) {
      lock (_lock)
        _activities.CopyTo(array, arrayIndex);
    }

    public bool Remove(Activity item) {
      lock (_lock)
        return _activities.Remove(item);
    }

    public IEnumerator<Activity> GetEnumerator() {
      lock (_lock)
        return _activities.ToList().GetEnumerator();
    }

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();

    private static IEnumerable<string> TextsOf(Activity activity) {
      yield return activity.DisplayName;
      yield return activity.OperationName;
      yield return activity.StatusDescription ?? string.Empty;

      foreach (KeyValuePair<string, object?> tag in activity.TagObjects)
        yield return $"{tag.Key}={tag.Value}";

      foreach (ActivityEvent activityEvent in activity.Events) {
        yield return activityEvent.Name;

        foreach (KeyValuePair<string, object?> tag in activityEvent.Tags)
          yield return $"{tag.Key}={tag.Value}";
      }
    }
  }
}