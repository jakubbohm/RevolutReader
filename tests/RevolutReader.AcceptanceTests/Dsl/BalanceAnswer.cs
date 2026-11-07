namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// What a balance read came back with (spec bank-reads): the balance, or one of the three failures, which carry no
/// balance. Compared by value, so a scenario states the whole expected answer.
/// </summary>
public sealed record BalanceAnswer(BankOutcome Outcome, decimal? Amount, string? Currency) {
  public static BalanceAnswer AccessExpired { get; } = new(BankOutcome.AccessExpired, null, null);

  public static BalanceAnswer RateLimited { get; } = new(BankOutcome.RateLimited, null, null);

  public static BalanceAnswer BankUnavailable { get; } = new(BankOutcome.BankUnavailable, null, null);

  /// <summary>The balance <paramref name="amount"/> <paramref name="currency"/>.</summary>
  public static BalanceAnswer Of(decimal amount, string currency) => new(BankOutcome.Read, amount, currency);
}