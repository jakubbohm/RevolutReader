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
/// One check at a time (c014 design.md D8, D10, D15, D16; § Public API sketch, <see cref="AccountCheckQueue"/>): a call while
/// no check runs starts one at once, for the call's own user, and the call ends with that check's result; a call while one
/// runs becomes the waiting check, which starts only once the running one has ended, and a call while one waits joins it;
/// a running check hears whether another waits behind it; <see cref="AccountCheckQueue.CallersWaiting"/> counts the waiting
/// check's callers; a check that throws is logged once, by the queue (<c>CheckFailed</c>, before its callers get the
/// exception, § Error model), its callers get the exception itself, and it never blocks the next call or the waiting check.
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
  private static readonly PresentUser _thirdPhone = new(IPAddress.Parse("203.0.113.9"), "BackgroundShortcutRunner/5114.0");

  /// <summary>How long a test waits on the real clock for a call that must end by itself: far longer than a queue takes.</summary>
  private const int WITHIN_SECONDS = 10;

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
  /// A second call while the first call's check runs starts nothing yet: it becomes the waiting check (D10 item 2). Once
  /// the running check has ended, the waiting one starts, for the second call's own user, with no other check still
  /// running, and the second call ends with its result.
  /// </summary>
  [Test]
  public async Task A_call_while_a_check_runs_becomes_the_waiting_check_and_starts_only_when_the_running_one_ends_with_its_own_user() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    int startedWhileTheFirstRan = app.Check.Runs.Count;
    running.EndWith(new CheckOutcome(Changed: true));
    BankResult<CheckOutcome> firstAnswer = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    waiting.EndWith(new CheckOutcome(Changed: false));

    waiting.ShouldSatisfyAllConditions(
      () => startedWhileTheFirstRan.ShouldBe(1, "the second call starts no check while the first one runs"),
      () => waiting.RunningWhenStarted.ShouldBe(0, "the waiting check starts only once the running one has ended"),
      () => waiting.User.ShouldBe(_anotherPhone, "it runs for the second call's own user"),
      () => firstAnswer.Value.ShouldBe(new CheckOutcome(Changed: true), "the first call: its own check's result"));
    (await second).Value.ShouldBe(new CheckOutcome(Changed: false), "the second call: the waiting check's result");
  }

  /// <summary>
  /// A third call while a check waits joins it (D10 item 2): it starts no check of its own, neither now nor later, and it
  /// ends with the waiting check's answer, as the second call does. Its call ends without the test ending any third check,
  /// within a bounded wait.
  /// </summary>
  [Test]
  public async Task A_call_while_a_check_waits_joins_it_no_check_of_its_own_and_the_waiting_checks_answer() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    Task<BankResult<CheckOutcome>> third = app.Queue.Check(_thirdPhone);
    running.EndWith(new CheckOutcome(Changed: false));
    _ = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    waiting.EndWith(new CheckOutcome(Changed: true));
    app.Check.Runs.Count.ShouldBe(2, "two checks: the first call's and the waiting one; the third call started none");

    BankResult<CheckOutcome> thirdAnswer = await third.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

    thirdAnswer.ShouldSatisfyAllConditions(
      () => waiting.User.ShouldBe(_anotherPhone, "the waiting check is the second call's"),
      () => thirdAnswer.Value.ShouldBe(new CheckOutcome(Changed: true), "the third call: the waiting check's answer"),
      () => app.Check.Runs.Count.ShouldBe(2, "the third call had no check of its own"));
    (await second).Value.ShouldBe(new CheckOutcome(Changed: true), "the second call: the waiting check's answer too");
  }

  /// <summary>
  /// What a check hears when it asks whether another check waits behind it (D10 item 3, the seam <c>anotherCheckWaits</c>):
  /// the first check, with the second call waiting behind it, hears yes; the second, with nothing behind it, hears no.
  /// </summary>
  [Test]
  public async Task Another_check_waits_says_yes_to_a_running_check_with_one_waiting_behind_it_and_no_otherwise() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    running.EndWith(new CheckOutcome(Changed: true));
    _ = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    waiting.EndWith(new CheckOutcome(Changed: true));
    _ = await second;

    running.ShouldSatisfyAllConditions(
      () => running.AnotherCheckWaitsSaid.ShouldBe(true, "the first check: the second call waits behind it"),
      () => waiting.AnotherCheckWaitsSaid.ShouldBe(false, "the second check: nothing waits behind it"));
  }

  /// <summary>
  /// <see cref="AccountCheckQueue.CallersWaiting"/> (D10, D16), read as soon as each call has been made: none while no check
  /// waits, the running check's caller not counted; one with a waiting check; two once a third call has joined it; and
  /// none again once the waiting check has started.
  /// </summary>
  [Test]
  public async Task CallersWaiting_counts_the_waiting_checks_callers_and_is_zero_once_it_starts() {
    using QueueUnderTest app = new();

    int beforeAnyCall = app.Queue.CallersWaiting;
    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    int whileOneRuns = app.Queue.CallersWaiting;
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    int withOneWaiting = app.Queue.CallersWaiting;
    Task<BankResult<CheckOutcome>> third = app.Queue.Check(_thirdPhone);
    int withOneJoined = app.Queue.CallersWaiting;
    running.EndWith(new CheckOutcome(Changed: true));
    _ = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    int onceItStarted = app.Queue.CallersWaiting;
    waiting.EndWith(new CheckOutcome(Changed: true));
    _ = await Task.WhenAll(second, third);

    beforeAnyCall.ShouldSatisfyAllConditions(
      () => beforeAnyCall.ShouldBe(0, "before any call"),
      () => whileOneRuns.ShouldBe(0, "while one check runs and none waits"),
      () => withOneWaiting.ShouldBe(1, "the waiting check's caller"),
      () => withOneJoined.ShouldBe(2, "the waiting check's caller and the one that joined it"),
      () => onceItStarted.ShouldBe(0, "once the waiting check has started"));
  }

  /// <summary>
  /// The running check throws while a second call waits (D10 "How": a check that fails never blocks the next): its caller
  /// gets the exception, and the waiting check starts all the same, once the throwing one has ended, for the second call's
  /// user, whose call ends with its result.
  /// </summary>
  [Test]
  public async Task The_waiting_check_starts_after_a_running_check_that_threw() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    running.Throw(new InvalidOperationException("A made-up storage failure."));
    _ = await Should.ThrowAsync<InvalidOperationException>(() => first);
    GatedRun waiting = await app.Check.WaitForRun(2);
    waiting.EndWith(new CheckOutcome(Changed: false));

    waiting.ShouldSatisfyAllConditions(
      () => waiting.RunningWhenStarted.ShouldBe(0, "the waiting check starts once the throwing one has ended"),
      () => waiting.User.ShouldBe(_anotherPhone, "for the second call's own user"));
    (await second).Value.ShouldBe(new CheckOutcome(Changed: false), "the second call: the waiting check's result");
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