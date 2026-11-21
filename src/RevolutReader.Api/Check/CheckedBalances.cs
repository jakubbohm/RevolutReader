using RevolutReader.Api.Account;

namespace RevolutReader.Api.Check;

/// <summary>
/// The check's two stored balances (c014 design.md D4): last seen, written by every successful read, and last notified,
/// the balance at the last notification; each a whole <see cref="AccountBalance"/> (amount, read time, rate).
/// </summary>
public sealed record CheckedBalances(AccountBalance LastSeen, AccountBalance LastNotified) {
  /// <summary>They differ by at least a cent: |last seen − last notified| ≥ 0.01 (D4).</summary>
  /// <remarks>A test-first stub: a property may not throw <see cref="NotImplementedException"/> (CA1065), so it throws <see cref="NotSupportedException"/> until it is built.</remarks>
  public bool Changed => throw new NotSupportedException("Not built yet: c014 tasks.md 7.4.");
}