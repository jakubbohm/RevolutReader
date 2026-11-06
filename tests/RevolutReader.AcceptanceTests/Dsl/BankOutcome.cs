namespace RevolutReader.AcceptanceTests.Dsl;

/// <summary>
/// How a bank read ended (spec bank-reads): read, or one of the three expected failures. <see cref="NoAnswer"/> is the
/// default value, so an unset answer never reads as any outcome a scenario expects.
/// </summary>
public enum BankOutcome {
  NoAnswer,
  Read,
  AccessExpired,
  RateLimited,
  BankUnavailable,
}