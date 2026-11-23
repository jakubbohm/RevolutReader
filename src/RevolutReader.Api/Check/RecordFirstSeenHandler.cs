using RevolutReader.Api.Account;
using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Check;

// c018 group 21's stub: bank, firstSeen, time and logger are read in 22.1's wiring (design.md D5), which removes this pragma.
#pragma warning disable CS9113
/// <summary>The account check's recording of first sightings (c018 design.md D5); scoped, used only by the check.</summary>
public sealed class RecordFirstSeenHandler(IBankAccount bank, FirstSeenTimes firstSeen, TimeProvider time, ILogger<RecordFirstSeenHandler> logger) {
#pragma warning restore CS9113
  /// <summary>
  /// Reads the transactions from the UTC day before the clock's today as <paramref name="user"/> and records them
  /// (FirstSeenTimes.Record, at FirstSeenRule.ReadAt of the clock after the answer). Never throws but for
  /// <paramref name="cancellationToken"/>: a bank failure logs FirstSeenNotRecorded with its kind; any exception logs it
  /// as Failed, with the exception.
  /// </summary>
  public Task Handle(PresentUser user, CancellationToken cancellationToken) =>
    throw new NotImplementedException("c018 tasks.md 22.1: the check's transactions read.");
}