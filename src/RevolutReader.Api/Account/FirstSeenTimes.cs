using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>How both readers record first sightings (c018 design.md D1, D2, D5); scoped.</summary>
public sealed class FirstSeenTimes {
  // A compile-only stub (tasks.md 5.1): the sketch's primary constructor, IFirstSeenStore store, comes with the implementation.
  public FirstSeenTimes(IFirstSeenStore store) => ArgumentNullException.ThrowIfNull(store);

  /// <summary>
  /// The kept moments of <paramref name="read"/>'s references once this read is recorded: reads them, records the read's
  /// sightings (FirstSeenRule.Sightings) whose reference has none yet, and answers both, the recorded ones as Record
  /// answers them. Store failures throw.
  /// </summary>
  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<BankTransaction> read, DateTimeOffset readAt, CancellationToken cancellationToken) =>
    throw new NotImplementedException();
}