using System.Diagnostics;
using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// A gated <see cref="IAccountCheck"/> for the queue's unit tests (c014 design.md D16): each <see cref="Run"/> is recorded
/// as a <see cref="GatedRun"/>, in the order started, with how many earlier runs had not yet ended, and waits until the
/// test ends it or its token is cancelled, so the test decides when each check ends and how. One instance serves every scope: the tests register it as scoped through a
/// factory on a provider that validates scopes, so a queue that resolved it outside a scope of its own would fail. Safe for
/// runs on several threads at once.
/// </summary>
public sealed class GatedAccountCheck : IAccountCheck {
  /// <summary>How long <see cref="WaitForRun"/> waits on the real clock: far longer than a queue takes to start a check.</summary>
  private const int WITHIN_SECONDS = 10;

  private readonly Lock _lock = new();
  private readonly List<GatedRun> _runs = [];

  /// <summary>Set when the next run starts, then replaced by a new one.</summary>
  private TaskCompletionSource _nextRun = NewSignal();

  /// <summary>Every run so far, in the order started.</summary>
  public IReadOnlyList<GatedRun> Runs {
    get {
      lock (_lock)
        return [.. _runs];
    }
  }

  /// <summary>
  /// The run with this <paramref name="number"/> (1 for the first), once it has started: a bounded wait on the real clock
  /// that wakes when a run starts, never a fixed pause. Fewer runs within 10 s throw <see cref="TimeoutException"/>.
  /// </summary>
  public async Task<GatedRun> WaitForRun(int number) {
    ArgumentOutOfRangeException.ThrowIfNegativeOrZero(number);

    using CancellationTokenSource deadline = new(TimeSpan.FromSeconds(WITHIN_SECONDS));

    while (true) {
      Task nextRun;

      lock (_lock) {
        if (_runs.Count >= number)
          return _runs[number - 1];

        nextRun = _nextRun.Task;
      }

      try {
        await nextRun.WaitAsync(deadline.Token);
      }
      catch (OperationCanceledException) when (deadline.IsCancellationRequested) {
        throw new TimeoutException($"Within {WITHIN_SECONDS} s, {Runs.Count} checks started, not {number}.");
      }
    }
  }

  public Task<BankResult<CheckOutcome>> Run(PresentUser user, Func<bool> anotherCheckWaits, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(user);
    ArgumentNullException.ThrowIfNull(anotherCheckWaits);

    GatedRun run;
    TaskCompletionSource started;

    lock (_lock) {
      run = new GatedRun(user, runningWhenStarted: _runs.Count(static earlier => !earlier.Ended.IsCompleted), Activity.Current, cancellationToken);
      _runs.Add(run);
      started = _nextRun;
      _nextRun = NewSignal();
    }

    _ = started.TrySetResult();

    return run.Finish(anotherCheckWaits);
  }

  private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}