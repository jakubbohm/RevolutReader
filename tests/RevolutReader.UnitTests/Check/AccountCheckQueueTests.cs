using System.Net;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;
using Shouldly;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// One check at a time (c014 design.md D8, D10, D15; § Public API sketch, <see cref="AccountCheckQueue"/>): a call while no
/// check runs starts one at once, for the call's own user, and the call ends with that check's result; a check that throws
/// is logged once, by the queue (<c>CheckFailed</c>, before its callers get the exception, § Error model), and its callers
/// get the exception itself; a check that threw never blocks the next call.
/// <para>
/// The setup is design.md D16's: the queue resolves the check from a scope of its own, on a service provider that validates
/// scopes, where the check is a <see cref="GatedAccountCheck"/> registered as scoped, whose runs the test ends; the app's
/// lifetime is a hand-written one that keeps running; the queue's log lines go to a hand-written logger. The addresses are
/// documentation addresses (RFC 5737), the browser name the Shortcut's.
/// </para>
/// </summary>
public sealed class AccountCheckQueueTests {
  private static readonly PresentUser _phone = new(IPAddress.Parse("203.0.113.7"), "BackgroundShortcutRunner/5114.0");
  private static readonly PresentUser _anotherPhone = new(IPAddress.Parse("203.0.113.8"), "BackgroundShortcutRunner/5114.0");

  [Test]
  public async Task A_call_while_no_check_runs_starts_one_at_once_with_the_calls_own_user() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> call = app.Queue.Check(_phone);
    GatedRun run = await app.Check.WaitForRun(1);

    run.User.ShouldBe(_phone, "the check runs for the call's own user");
    run.EndWith(new CheckOutcome(Changed: true));
    (await call).Value.ShouldBe(new CheckOutcome(Changed: true), "the call ends with its check's result");
  }

  [Test]
  public async Task A_check_that_throws_is_logged_once_and_its_callers_get_the_exception() {
    CapturedLog log = new();
    using QueueUnderTest app = new(log);
    InvalidOperationException failure = new("A made-up storage failure, 4c7e.");

    Task<BankResult<CheckOutcome>> call = app.Queue.Check(_phone);
    (await app.Check.WaitForRun(1)).Throw(failure);

    (await Should.ThrowAsync<InvalidOperationException>(() => call)).ShouldBeSameAs(failure, "the caller gets the check's own exception");
    LogEntry line = log.Entries.Where(static line => line.EventName == "CheckFailed").ShouldHaveSingleItem("the failed check, logged once");
    line.ShouldSatisfyAllConditions(
      () => line.Level.ShouldBe(LogLevel.Error),
      () => line.Exception.ShouldBeSameAs(failure, "the line carries the check's exception"));
  }

  [Test]
  public async Task A_check_that_threw_never_blocks_the_next_call() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    (await app.Check.WaitForRun(1)).Throw(new InvalidOperationException("A made-up storage failure."));
    _ = await Should.ThrowAsync<InvalidOperationException>(() => first);

    Task<BankResult<CheckOutcome>> next = app.Queue.Check(_anotherPhone);
    GatedRun run = await app.Check.WaitForRun(2);

    run.User.ShouldBe(_anotherPhone, "the next call's own check starts");
    run.EndWith(new CheckOutcome(Changed: false));
    (await next).Value.ShouldBe(new CheckOutcome(Changed: false), "and the next call ends with its result");
  }

  /// <summary>
  /// The queue under test, on its own service provider, which validates scopes: <see cref="Check"/> is the
  /// <see cref="IAccountCheck"/> every scope resolves; the app keeps running (<see cref="RunningApp"/>); the queue's lines go
  /// to the given log, or nowhere.
  /// </summary>
  private sealed class QueueUnderTest : IDisposable {
    private readonly ServiceProvider _services;
    private readonly RunningApp _app = new();

    public QueueUnderTest(CapturedLog? log = null) {
      ServiceCollection services = new();
      services.AddScoped<IAccountCheck>(_ => Check);
      _services = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });

      Queue = new AccountCheckQueue(
        _services.GetRequiredService<IServiceScopeFactory>(),
        _app,
        log ?? (ILogger<AccountCheckQueue>)NullLogger<AccountCheckQueue>.Instance);
    }

    /// <summary>The check every scope resolves, whose runs the test ends.</summary>
    public GatedAccountCheck Check { get; } = new();

    public AccountCheckQueue Queue { get; }

    #region IDisposable

    public void Dispose() {
      _services.Dispose();
      _app.Dispose();
    }

    #endregion
  }

  /// <summary>The app's lifetime, running until <see cref="StopApplication"/> cancels <see cref="ApplicationStopping"/>.</summary>
  private sealed class RunningApp : IHostApplicationLifetime, IDisposable {
    private readonly CancellationTokenSource _stopping = new();

    public CancellationToken ApplicationStarted => CancellationToken.None;

    public CancellationToken ApplicationStopping => _stopping.Token;

    public CancellationToken ApplicationStopped => CancellationToken.None;

    public void StopApplication() => _stopping.Cancel();

    #region IDisposable

    public void Dispose() => _stopping.Dispose();

    #endregion
  }

  /// <summary>The queue's logger, keeping every line it writes: its level, its event's name, its exception and its message.</summary>
  private sealed class CapturedLog : ILogger<AccountCheckQueue> {
    private readonly Lock _lock = new();
    private readonly List<LogEntry> _entries = [];

    /// <summary>Every line, in the order written.</summary>
    public IReadOnlyList<LogEntry> Entries {
      get {
        lock (_lock)
          return [.. _entries];
      }
    }

    public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

    public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

    public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) {
      ArgumentNullException.ThrowIfNull(formatter);

      LogEntry entry = new(logLevel, eventId.Name, exception, formatter(state, exception));

      lock (_lock)
        _entries.Add(entry);
    }
  }

  /// <summary>One line of the queue's log.</summary>
  private sealed record LogEntry(LogLevel Level, string? EventName, Exception? Exception, string Message) {
    #region Object overrides

    /// <summary>For a failure message: the level and the event.</summary>
    public override string ToString() => $"{Level} {EventName}";

    #endregion
  }
}