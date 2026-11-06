namespace RevolutReader.Api.Bank;

/// <summary>From the bank's transactions to the port's (c004 design.md D3).</summary>
public static class TransactionMapping {
  /// <summary>Booked and pending kept and mapped (D3); every other status left out and counted.</summary>
  public static MappedTransactions Map(IEnumerable<EbTransaction> transactions) => throw new NotImplementedException();
}

/// <summary>The transactions a read returns, and how many the bank listed with another status (only counted, D3).</summary>
public sealed record MappedTransactions(IReadOnlyList<BankTransaction> Kept, int LeftOut);