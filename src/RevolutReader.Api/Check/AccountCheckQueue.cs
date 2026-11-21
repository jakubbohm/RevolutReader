using System.Diagnostics;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

/// <summary>
/// One check at a time, at most one waiting, later callers joining it (c014 design.md D10). A singleton, the one queue of
/// the app copy: the app runs one copy (ADR-0006), so the queue lives in memory.
/// <list type="bullet">
/// <item>A call while no check runs starts one at once, for its own user. A call while one runs becomes the waiting check,
/// for its own user, started only once the running check has ended, in any way. A call while one waits joins it: it starts
/// nothing and gets the waiting check's answer. So a burst of any size runs at most two checks (D10 item 2).</item>
/// <item>The running check and the waiting one are held under one lock; <c>anotherCheckWaits</c>, which a check asks right
/// after its store step (D10 item 3), and <see cref="CallersWaiting"/> read them under the same lock.</item>
/// <item>Each check runs under the request of the call that made it (its execution context, so its trace and logging
/// scope): the waiting check under its own caller's, never the running one's, so its bank call, pushes and log lines go
/// under the request that caused them (PR #88 review, the owner's decision, 2026-11-21).</item>
/// <item>Each check runs in its own DI scope (<see cref="IAccountCheck"/>) on
/// <see cref="IHostApplicationLifetime.ApplicationStopping"/>, never a caller's token (D8), so a caller that leaves never
/// stops it; only the app's stop cancels it, and its callers get that cancellation. A failed check is logged here, once
/// (<see cref="CheckLog.CheckFailed"/>), since its callers may have left (D15), whatever failed: building its services, its
/// run or their disposal; its callers get its exception, and it never blocks the next; a check the app's stop cancels is
/// not logged as failed.</item>
/// </list>
/// </summary>
public sealed class AccountCheckQueue(IServiceScopeFactory scopes, IHostApplicationLifetime lifetime, ILogger<AccountCheckQueue> logger) {
  /// <summary>Guards <see cref="_running"/>, <see cref="_waiting"/> and the waiting check's callers.</summary>
  private readonly Lock _lock = new();

  /// <summary>The running check; <see langword="null"/> when none runs.</summary>
  private PendingCheck? _running;

  /// <summary>The check waiting behind the running one, with its callers; <see langword="null"/> when none waits.</summary>
  private PendingCheck? _waiting;

  /// <summary>
  /// How many calls wait behind the running check (the waiting one and those joined to it); read by the acceptance driver
  /// (D16). The running check's own caller is not counted; zero once the waiting check has started.
  /// </summary>
  public int CallersWaiting {
    get {
      lock (_lock)
        return _waiting?.Callers ?? 0;
    }
  }

  /// <summary>Starts a check, makes this call the waiting one, or joins the waiting one; the task ends with that check.</summary>
  public Task<BankResult<CheckOutcome>> Check(PresentUser user) {
    ArgumentNullException.ThrowIfNull(user);

    PendingCheck check;

    lock (_lock) {
      if (_waiting is { } waiting)
        return waiting.Join();

      check = new PendingCheck(user, ExecutionContext.Capture());

      if (_running is not null) {
        _waiting = check;

        return check.Answer;
      }

      _running = check;
    }

    _ = RunInTurn(check);

    return check.Answer;
  }

  /// <summary>
  /// Runs <paramref name="first"/>, then each check that waited behind the one before, in turn, until none waits: each
  /// starts only once the one before has ended, however it ended, and each under the request of the call that made it
  /// (<see cref="RunUnderItsRequest"/>); the loop itself goes on in its own.
  /// </summary>
  private async Task RunInTurn(PendingCheck first) {
    PendingCheck? check = first;

    while (check is not null) {
      Task<BankResult<CheckOutcome>> run = RunUnderItsRequest(check);
      await ((Task)run).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
      check.EndWith(run);
      check = Next();
    }
  }

  /// <summary>
  /// Starts <paramref name="check"/> in the execution context of the call that made it, so the check and its continuations
  /// run under that caller's request (its trace and logging scope), never the one before's (PR #88 review, the owner's
  /// decision, 2026-11-21). With no context captured (its flow suppressed), it starts in the loop's own, as before.
  /// </summary>
  private Task<BankResult<CheckOutcome>> RunUnderItsRequest(PendingCheck check) {
    CancellationToken stopping = lifetime.ApplicationStopping;

    if (check.Request is not { } request)
      return Run(check.User, stopping);

    Task<BankResult<CheckOutcome>>? run = null;
    ExecutionContext.Run(request, _ => run = Run(check.User, stopping), state: null);

    return run ?? throw new UnreachableException("ExecutionContext.Run returned without running the check.");
  }

  /// <summary>The waiting check, now the running one, its callers no longer waiting; <see langword="null"/>, and no check runs, when none waits.</summary>
  private PendingCheck? Next() {
    lock (_lock) {
      _running = _waiting;
      _waiting = null;

      return _running;
    }
  }

  /// <summary>Whether a check waits behind the running one (D10 item 3), as a running check asks after its store step.</summary>
  private bool AnotherCheckWaits() {
    lock (_lock)
      return _waiting is not null;
  }

  /// <summary>
  /// One check for <paramref name="user"/>, in a DI scope of its own, on <paramref name="stopping"/>: its result, or its
  /// exception, logged once here before it reaches any caller. One catch around the whole check, so every failure of it is
  /// logged exactly once (D11, D15; PR #88 review, finding 6): the scope's creation, the check's resolution from it, its
  /// run, and the scope's disposal, also when the disposal throws after a failed run. A check the app's stop cancels is no
  /// failed check: its cancellation reaches its callers unlogged, since a stop is the app ending, on every deploy's swap
  /// and scale to zero.
  /// </summary>
  private async Task<BankResult<CheckOutcome>> Run(PresentUser user, CancellationToken stopping) {
    try {
      await using AsyncServiceScope scope = scopes.CreateAsyncScope();
      IAccountCheck check = scope.ServiceProvider.GetRequiredService<IAccountCheck>();

      return await check.Run(user, AnotherCheckWaits, stopping);
    }
    catch (Exception exception) when (exception is not OperationCanceledException || !stopping.IsCancellationRequested) {
      CheckLog.CheckFailed(logger, exception);

      throw;
    }
  }

  /// <summary>
  /// A check that runs or waits: the user it runs for, the request it runs under (both of the call that made it), its
  /// answer for every caller, and its callers (counted under the queue's lock).
  /// </summary>
  private sealed class PendingCheck(PresentUser user, ExecutionContext? request) {
    private readonly TaskCompletionSource<BankResult<CheckOutcome>> _answer = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>The user the check reads for: the caller's that made it.</summary>
    public PresentUser User { get; } = user;

    /// <summary>
    /// The execution context of the call that made the check, captured when it was made, which the check runs in: that
    /// caller's request, its trace and logging scope; <see langword="null"/> when the caller's flow was suppressed.
    /// </summary>
    public ExecutionContext? Request { get; } = request;

    /// <summary>The calls waiting for this check: the one that made it, and those that joined it.</summary>
    public int Callers { get; private set; } = 1;

    /// <summary>The check's answer, the same for every caller: its result, or its exception.</summary>
    public Task<BankResult<CheckOutcome>> Answer => _answer.Task;

    /// <summary>Another call joins the check: one more caller, the same answer.</summary>
    public Task<BankResult<CheckOutcome>> Join() {
      Callers++;

      return Answer;
    }

    /// <summary>Ends the check's answer as <paramref name="run"/>, which has ended, ended: with its result or its exception.</summary>
    public void EndWith(Task<BankResult<CheckOutcome>> run) => _answer.SetFromTask(run);
  }
}