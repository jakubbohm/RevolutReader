using RevolutReader.Api.Bank;
using RevolutReader.Api.Check;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// One run of <see cref="GatedAccountCheck"/>: the user it runs for and the token it runs on, as the queue passed them. It
/// waits until the test ends it (<see cref="EndWith"/> or <see cref="Throw"/>) or its token is cancelled, in which case it
/// ends with <see cref="OperationCanceledException"/>. When the test ends it, it first asks <c>anotherCheckWaits</c>, as a
/// check does right after its store step (c014 design.md D10), and records the answer (<see cref="AnotherCheckWaitsSaid"/>).
/// </summary>
public sealed class GatedRun {
  private readonly TaskCompletionSource<Func<BankResult<CheckOutcome>>> _ending = new(TaskCreationOptions.RunContinuationsAsynchronously);
  private readonly TaskCompletionSource _ended = new(TaskCreationOptions.RunContinuationsAsynchronously);

  internal GatedRun(PresentUser user, CancellationToken token) {
    User = user;
    Token = token;
  }

  /// <summary>The user the run is for: the one the queue passed to <see cref="IAccountCheck.Run"/>.</summary>
  public PresentUser User { get; }

  /// <summary>The token the run is on: the one the queue passed to <see cref="IAccountCheck.Run"/>.</summary>
  public CancellationToken Token { get; }

  /// <summary>What <c>anotherCheckWaits</c> answered when the test ended the run; <see langword="null"/> before, or when the run was cancelled.</summary>
  public bool? AnotherCheckWaitsSaid { get; private set; }

  /// <summary>Ends once the run has finished, however: with a result, an exception or a cancellation.</summary>
  public Task Ended => _ended.Task;

  /// <summary>Lets the run end with <paramref name="result"/>; fails when the test already ended it.</summary>
  public void EndWith(BankResult<CheckOutcome> result) {
    if (!_ending.TrySetResult(() => result))
      throw new InvalidOperationException("The test already ended this run.");
  }

  /// <summary>Lets the run end by throwing <paramref name="exception"/>, as a check whose storage fails does; fails when the test already ended it.</summary>
  public void Throw(Exception exception) {
    ArgumentNullException.ThrowIfNull(exception);

    if (!_ending.TrySetResult(() => throw exception))
      throw new InvalidOperationException("The test already ended this run.");
  }

  /// <summary>The run itself: waits for the test, or for the token; asks <paramref name="anotherCheckWaits"/>; ends as the test said.</summary>
  internal async Task<BankResult<CheckOutcome>> Finish(Func<bool> anotherCheckWaits) {
    try {
      Func<BankResult<CheckOutcome>> end = await _ending.Task.WaitAsync(Token);
      AnotherCheckWaitsSaid = anotherCheckWaits();

      return end();
    }
    finally {
      _ = _ended.TrySetResult();
    }
  }
}