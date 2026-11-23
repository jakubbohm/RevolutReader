using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>How both readers record first sightings (c018 design.md D1, D2, D5); scoped.</summary>
public sealed class FirstSeenTimes(IFirstSeenStore store) {
  /// <summary>
  /// The kept moments of <paramref name="read"/>'s references once this read is recorded: reads them, records the read's
  /// sightings (FirstSeenRule.Sightings) whose reference keeps no moment yet or a later one than
  /// <paramref name="readAt"/>, and answers both, the recorded ones as Record answers them. Store failures throw.
  /// </summary>
  public async Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<BankTransaction> read, DateTimeOffset readAt, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(read);

    IReadOnlyCollection<string> references = [.. read.Select(static transaction => transaction.Reference).OfType<string>().Distinct(StringComparer.Ordinal)];
    IReadOnlyDictionary<string, DateTimeOffset> keptBefore = await store.Read(references, cancellationToken);

    // A reference timed no later than this read costs no write. One timed later is recorded again: a read can write after
    // a later one, and Record keeps the earliest moment, whichever read writes first (D1).
    IReadOnlyList<FirstSeen> firstSightings = [.. FirstSeenRule.Sightings(read, readAt).Where(sighting => !keptBefore.TryGetValue(sighting.Reference, out DateTimeOffset keptAt) || keptAt > readAt)];
    IReadOnlyDictionary<string, DateTimeOffset> recorded = await store.Record(firstSightings, cancellationToken);

    Dictionary<string, DateTimeOffset> kept = new(keptBefore, StringComparer.Ordinal);

    // As Record answers them: another reader may have recorded an earlier moment meanwhile.
    foreach ((string reference, DateTimeOffset at) in recorded)
      kept[reference] = at;

    return kept;
  }
}