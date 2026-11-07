namespace RevolutReader.Api.Bank;

/// <summary>
/// The one linked account at the bank (spec bank-reads, c004 design.md D2). Read-only; account and session come from the
/// settings, so callers pass no identifier. Every read states who triggers it (<see cref="ReadTrigger"/>).
/// </summary>
public interface IBankAccount {
  /// <summary>The account's available balance (D3).</summary>
  Task<BankResult<Balance>> ReadBalance(ReadTrigger trigger, CancellationToken cancellationToken);

  /// <summary>From <paramref name="from"/>, inclusive, across every page (D7); booked and pending only (D3).</summary>
  Task<BankResult<Transactions>> ReadTransactions(DateOnly from, ReadTrigger trigger, CancellationToken cancellationToken);
}