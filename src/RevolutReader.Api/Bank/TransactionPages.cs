namespace RevolutReader.Api.Bank;

/// <summary>Every page of a transactions read, joined (c004 design.md D7).</summary>
public static class TransactionPages {
  /// <summary>
  /// Follows continuation keys until none comes back, also after an empty page; a repeated key → BankReadException;
  /// the first failed page ends the read with its failure (D7).
  /// </summary>
  public static Task<BankResult<JoinedPages>> ReadAll(Func<string?, Task<BankResult<EbTransactionPage>>> readPage) => throw new NotImplementedException();
}

/// <summary>The transactions of every page, in page order, and how many pages were read.</summary>
public sealed record JoinedPages(IReadOnlyList<EbTransaction> Transactions, int PageCount);