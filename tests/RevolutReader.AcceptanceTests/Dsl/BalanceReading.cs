namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What <c>GET /api/balance</c> answered (spec account-balance, c009 design.md D1), compared by value, so a scenario
/// states the whole expected answer: the balance with its read time and rate, or a failure's problem description, never
/// both. The driver (<see cref="Drivers.BalanceDriver"/>) gives a value only when the answer's exact shape fits, a
/// problem's status included (its own table of the status each case belongs to); <see cref="ReadAt"/> compares as an
/// instant, whatever offset the answer wrote it with.
/// </summary>
public sealed record BalanceReading(decimal? Amount, DateTimeOffset? ReadAt, decimal? CzkPerEur, ProblemDescription? Problem) {
  /// <summary>The balance <paramref name="amount"/> EUR, read at <paramref name="readAt"/>, at <paramref name="czkPerEur"/> koruna per euro.</summary>
  public static BalanceReading Of(decimal amount, DateTimeOffset readAt, decimal czkPerEur) => new(amount, readAt, czkPerEur, Problem: null);

  /// <summary>A failure: this problem description, and no balance.</summary>
  public static BalanceReading Failed(ProblemDescription problem) => new(Amount: null, ReadAt: null, CzkPerEur: null, problem);
}