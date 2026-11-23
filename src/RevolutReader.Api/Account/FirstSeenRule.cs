using RevolutReader.Api.Bank;

namespace RevolutReader.Api.Account;

/// <summary>The first-seen time's rules (c018 design.md D1, D2), pure.</summary>
public static class FirstSeenRule {
  /// <summary>The moment a read got its answer: <paramref name="now"/> at offset zero, cut to the whole second.</summary>
  public static DateTimeOffset ReadAt(DateTimeOffset now) {
    DateTimeOffset utc = now.ToUniversalTime();

    return new DateTimeOffset(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerSecond), TimeSpan.Zero);
  }

  /// <summary>
  /// What a read at <paramref name="readAt"/> records: each transaction, pending or settled, with a reference, dated
  /// <paramref name="readAt"/>'s UTC date, at <paramref name="readAt"/>; a reference listed twice once.
  /// </summary>
  public static IReadOnlyList<FirstSeen> Sightings(IReadOnlyList<BankTransaction> read, DateTimeOffset readAt) {
    ArgumentNullException.ThrowIfNull(read);

    // A transaction without a reference is left out: nothing could match it later (D1).
    return [.. read.Select(static transaction => transaction.Reference).OfType<string>().Select(reference => new FirstSeen(reference, readAt))];
  }

  /// <summary>What <c>seenAt</c> answers for a transaction dated <paramref name="date"/>: <paramref name="firstSeen"/> when its UTC date is <paramref name="date"/>, else null.</summary>
  public static DateTimeOffset? Shown(DateOnly date, DateTimeOffset? firstSeen) =>
    firstSeen is DateTimeOffset seen && DateOnly.FromDateTime(seen.UtcDateTime) == date ? seen : null;
}