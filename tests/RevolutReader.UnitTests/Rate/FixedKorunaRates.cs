using RevolutReader.Api.Rate;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The rate an answer carries, hand-written (c017 design.md § Ports and contracts): the handlers' unit tests use it in place
/// of the real service. Every ask answers <paramref name="rate"/> and is counted as it starts (<see cref="TimesAsked"/>),
/// so a test reads whether the rate was asked at a given point, say while the bank is still reading. Its answer can be
/// held (<see cref="HoldTheAnswer"/>): an ask then counts at once but answers only once the test releases it
/// (<see cref="ReleaseTheAnswer"/>), so a test sees whether a handler waits for the rate; a held ask whose caller cancels
/// throws <see cref="OperationCanceledException"/>.
/// </summary>
public sealed class FixedKorunaRates(KorunaRate rate) : IKorunaRates {
  private readonly Lock _lock = new();
  private TaskCompletionSource? _held;
  private int _asked;

  /// <summary>How many times the rate was asked so far, answered or not.</summary>
  public int TimesAsked {
    get {
      lock (_lock)
        return _asked;
    }
  }

  /// <summary>Asks from now on wait for <see cref="ReleaseTheAnswer"/> before they answer.</summary>
  public void HoldTheAnswer() {
    lock (_lock)
      _held ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  }

  /// <summary>Every held ask answers now, and later asks answer at once.</summary>
  public void ReleaseTheAnswer() {
    TaskCompletionSource? held;

    lock (_lock) {
      held = _held;
      _held = null;
    }

    _ = held?.TrySetResult();
  }

  public async Task<KorunaRate> Current(CancellationToken cancellationToken) {
    Task? held;

    lock (_lock) {
      _asked++;
      held = _held?.Task;
    }

    if (held is not null)
      await held.WaitAsync(cancellationToken);

    return rate;
  }
}