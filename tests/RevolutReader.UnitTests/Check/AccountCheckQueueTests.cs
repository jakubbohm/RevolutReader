using System.Diagnostics;
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
  /// The check runs on the app's stopping token, never a caller's (D8). A caller stops waiting as the endpoint does, by
  /// giving up its wait on its own token (<c>WaitAsync</c>); the queue never sees that token. The check keeps running: its
  /// token is still the app's, not cancelled, and it has not ended; once the test ends it, it ends with its result.
  /// </summary>
  [Test]
  public async Task A_check_runs_on_the_apps_stopping_token_never_a_callers_so_a_caller_that_stops_waiting_leaves_it_running() {
    using QueueUnderTest app = new();
    using CancellationTokenSource callerGivesUp = new();

    Task<BankResult<CheckOutcome>> call = app.Queue.Check(_phone).WaitAsync(callerGivesUp.Token);
    GatedRun run = await app.Check.WaitForRun(1);
    await callerGivesUp.CancelAsync();
    bool callerStoppedWaiting = await StopsWithACancellation(call);
    bool tokenCancelledAfterTheCallerLeft = run.Token.IsCancellationRequested;
    bool endedAfterTheCallerLeft = run.Ended.IsCompleted;
    run.EndWith(new CheckOutcome(Changed: true));
    await run.Ended.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS));

    run.ShouldSatisfyAllConditions(
      () => callerStoppedWaiting.ShouldBeTrue("the caller stopped waiting"),
      () => run.Token.ShouldBe(app.Stopping, "the check runs on the app's stopping token"),
      () => tokenCancelledAfterTheCallerLeft.ShouldBeFalse("its token is not cancelled when the caller leaves"),
      () => endedAfterTheCallerLeft.ShouldBeFalse("the check is still running after the caller left"),
      () => run.Ended.IsCompletedSuccessfully.ShouldBeTrue("and it ends as the test ends it, with its result"));
  }

  /// <summary>
  /// While the first check runs, a second call waits and a third joins it; the third stops waiting on its own token. The
  /// waiting check and its other caller go on as they were: it starts for the second call's user, on the app's stopping
  /// token, not cancelled, no third check starts, and the second call gets its answer.
  /// </summary>
  [Test]
  public async Task A_joined_caller_that_stops_waiting_leaves_the_check_and_its_other_callers_as_they_were() {
    using QueueUnderTest app = new();
    using CancellationTokenSource thirdGivesUp = new();

    Task<BankResult<CheckOutcome>> first = app.Queue.Check(_phone);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = app.Queue.Check(_anotherPhone);
    Task<BankResult<CheckOutcome>> third = app.Queue.Check(_thirdPhone).WaitAsync(thirdGivesUp.Token);
    await thirdGivesUp.CancelAsync();
    bool thirdStoppedWaiting = await StopsWithACancellation(third);
    running.EndWith(new CheckOutcome(Changed: false));
    _ = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    bool waitingTokenCancelled = waiting.Token.IsCancellationRequested;
    waiting.EndWith(new CheckOutcome(Changed: true));
    BankResult<CheckOutcome> secondAnswer = await second;

    waiting.ShouldSatisfyAllConditions(
      () => thirdStoppedWaiting.ShouldBeTrue("the joined caller stopped waiting"),
      () => waiting.User.ShouldBe(_anotherPhone, "the waiting check is still the second call's"),
      () => waiting.Token.ShouldBe(app.Stopping, "on the app's stopping token"),
      () => waitingTokenCancelled.ShouldBeFalse("not cancelled by the joined caller's leaving"),
      () => app.Check.Runs.Count.ShouldBe(2, "no other check started"),
      () => secondAnswer.Value.ShouldBe(new CheckOutcome(Changed: true), "the second call still gets the waiting check's answer"));
  }

  /// <summary>
  /// The app stops while a check runs (D8: only the app stopping ends a check early): the running check's token is
  /// cancelled, the check ends with an <see cref="OperationCanceledException"/>, and its caller gets that exception
  /// (§ Error model: <see cref="AccountCheckQueue.Check"/> ends in <see cref="OperationCanceledException"/> when the app stops).
  /// </summary>
  [Test]
  public async Task The_app_stopping_cancels_the_running_check() {
    using QueueUnderTest app = new();

    Task<BankResult<CheckOutcome>> call = app.Queue.Check(_phone);
    GatedRun run = await app.Check.WaitForRun(1);
    app.StopTheApp();
    bool callerGotACancellation = await StopsWithACancellation(call.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS)));

    run.ShouldSatisfyAllConditions(
      () => run.Token.IsCancellationRequested.ShouldBeTrue("the running check's token is cancelled"),
      () => run.Ended.IsCanceled.ShouldBeTrue("the check ended in a cancellation, an OperationCanceledException"),
      () => callerGotACancellation.ShouldBeTrue("its caller gets the OperationCanceledException"));
  }

  /// <summary>
  /// A check the app's stop cancels is not a failed check: no <c>CheckFailed</c> line and no line at Error. D15 makes
  /// <c>CheckFailed</c> the line of a check that threw; a stop is the app ending, expected on every deploy's swap and every
  /// scale to zero, and an Error line for each check in flight would read as a fault.
  /// </summary>
  [Test]
  public async Task A_check_the_app_stopping_cancels_is_not_logged_as_a_failed_check() {
    CapturedLog log = new();
    using QueueUnderTest app = new(log);

    Task<BankResult<CheckOutcome>> call = app.Queue.Check(_phone);
    _ = await app.Check.WaitForRun(1);
    app.StopTheApp();
    _ = await StopsWithACancellation(call.WaitAsync(TimeSpan.FromSeconds(WITHIN_SECONDS)));

    log.Entries.ShouldSatisfyAllConditions(
      () => log.Entries.ShouldNotContain(static line => line.EventName == "CheckFailed", "a stop is not a failed check"),
      () => log.Entries.ShouldNotContain(static line => line.Level == LogLevel.Error, "no line at Error for a stop"));
  }

  /// <summary>
  /// Each check runs under the request of the call that made it (review finding 5 on PR #88, the owner's decision of the
  /// same day): the first check under the first caller's request, and the waiting check, which the queue starts only after
  /// the first has ended, under the second caller's, never the first's. So its bank call, pushes and log lines go under the
  /// second request's trace. Each caller runs in a flow of its own (on the thread pool, <see cref="CallUnderItsOwnRequest"/>) with its own
  /// started <see cref="Activity"/> as its request, so nothing depends on the test's own flow; the checks are held and let
  /// through by the gate.
  /// </summary>
  [Test]
  public async Task Each_check_runs_under_the_request_of_the_call_that_made_it() {
    using QueueUnderTest app = new();
    using Activity request1 = new("request 1");
    using Activity request2 = new("request 2");

    Task<BankResult<CheckOutcome>> first = await CallUnderItsOwnRequest(app.Queue, _phone, request1);
    GatedRun running = await app.Check.WaitForRun(1);
    Task<BankResult<CheckOutcome>> second = await CallUnderItsOwnRequest(app.Queue, _anotherPhone, request2);
    running.EndWith(new CheckOutcome(Changed: true));
    _ = await first;
    GatedRun waiting = await app.Check.WaitForRun(2);
    waiting.EndWith(new CheckOutcome(Changed: false));
    _ = await second;

    running.ShouldSatisfyAllConditions(
      () => running.ActivityWhenStarted?.OperationName.ShouldBe(request1.OperationName, "the first check: under the first caller's request"),
      () => running.ActivityWhenStarted.ShouldBeSameAs(request1),
      () => waiting.ActivityWhenStarted?.OperationName.ShouldBe(request2.OperationName, "the waiting check: under the second caller's request, not the first's"),
      () => waiting.ActivityWhenStarted.ShouldBeSameAs(request2));
  }

  /// <summary>
  /// A caller in a flow of its own, on the thread pool: it starts <paramref name="request"/> as its request
  /// (<see cref="Activity.Current"/> in that flow only), then calls <paramref name="queue"/> for <paramref name="user"/>. The
  /// call's task, not awaited here: <c>TaskFactory.StartNew</c> hands it back as it is, where <c>Task.Run</c> would unwrap it
  /// and so wait for the check itself.
  /// </summary>
  private static Task<Task<BankResult<CheckOutcome>>> CallUnderItsOwnRequest(AccountCheckQueue queue, PresentUser user, Activity request) =>
    Task.Factory.StartNew(
      () => {
        _ = request.Start();

        return queue.Check(user);
      },
      CancellationToken.None,
      TaskCreationOptions.DenyChildAttach,
      TaskScheduler.Default);

  /// <summary>
  /// Whether <paramref name="wait"/> ends in an <see cref="OperationCanceledException"/> (or one derived from it, as
  /// <see cref="TaskCanceledException"/>); any other ending is <see langword="false"/>, and a <see cref="TimeoutException"/>
  /// from a bounded wait passes on.
  /// </summary>
  private static async Task<bool> StopsWithACancellation(Task wait) {
    try {
      await wait;

      return false;
    }
    catch (OperationCanceledException) {
      return true;
    }
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

    /// <summary>The app's stopping token (<see cref="IHostApplicationLifetime.ApplicationStopping"/>), as the queue was given it.</summary>
    public CancellationToken Stopping => _app.ApplicationStopping;

    /// <summary>The app stops, as on a deploy's swap or a scale to zero: <see cref="Stopping"/> is cancelled.</summary>
    public void StopTheApp() => _app.StopApplication();

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