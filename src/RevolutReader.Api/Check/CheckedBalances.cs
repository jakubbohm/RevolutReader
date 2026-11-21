using RevolutReader.Api.Account;

namespace RevolutReader.Api.Check;

/// <summary>
/// The check's two stored balances (c014 design.md D4): last seen, written by every successful read, and last notified,
/// the balance at the last notification; each a whole <see cref="AccountBalance"/> (amount, read time, rate).
/// </summary>
public sealed record CheckedBalances(AccountBalance LastSeen, AccountBalance LastNotified) {
  /// <summary>The least difference between the two amounts that is a change: a cent (D4).</summary>
  private const decimal CENT = 0.01m;

  /// <summary>They differ by at least a cent: |last seen − last notified| ≥ 0.01 (D4). Only the amounts count.</summary>
  public bool Changed => Math.Abs(LastSeen.Amount - LastNotified.Amount) >= CENT;
}