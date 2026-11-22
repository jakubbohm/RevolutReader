using RevolutReader.Api.Rate;

namespace RevolutReader.UnitTests.Rate;

/// <summary>
/// The CNB port, hand-written (c017 design.md § Ports and contracts): every ask answers what the test set, a rate or a
/// failure (<see cref="Answers"/>), and is counted as it starts (<see cref="Calls"/>). Its answers can be held
/// (<see cref="HoldTheAnswers"/>): an ask then counts at once but answers only once the test releases it
/// (<see cref="ReleaseTheAnswers"/>), so a test can line up callers that arrive while an ask is still on its way. A held
/// ask whose caller cancels throws <see cref="OperationCanceledException"/>, as the port's contract says.
/// </summary>
public sealed class FakeCnbRates(CnbAnswer answer) : ICnbRates {
  private readonly Lock _lock = new();
  private CnbAnswer _answer = answer;
  private TaskCompletionSource? _held;
  private int _calls;

  /// <summary>How many asks started so far, answered or not.</summary>
  public int Calls {
    get {
      lock (_lock)
        return _calls;
    }
  }

  /// <summary>Later asks answer <paramref name="next"/>.</summary>
  public void Answers(CnbAnswer next) {
    lock (_lock)
      _answer = next;
  }

  /// <summary>Asks from now on wait for <see cref="ReleaseTheAnswers"/> before they answer.</summary>
  public void HoldTheAnswers() {
    lock (_lock)
      _held ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
  }

  /// <summary>Every held ask answers now, and later asks answer at once.</summary>
  public void ReleaseTheAnswers() {
    TaskCompletionSource? held;

    lock (_lock) {
      held = _held;
      _held = null;
    }

    _ = held?.TrySetResult();
  }

  public async Task<CnbAnswer> ReadEuroRate(CancellationToken cancellationToken) {
    Task? held;

    lock (_lock) {
      _calls++;
      held = _held?.Task;
    }

    if (held is not null)
      await held.WaitAsync(cancellationToken);

    lock (_lock)
      return _answer;
  }
}