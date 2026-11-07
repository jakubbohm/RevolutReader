using System.Diagnostics;

namespace RevolutReader.Api.Bank;

/// <summary>Every page of a transactions read, joined (c004 design.md D7).</summary>
public static class TransactionPages {
  /// <summary>
  /// Follows continuation keys until none comes back, also after an empty page; a repeated key → BankReadException;
  /// the first failed page ends the read with its failure (D7).
  /// </summary>
  /// <param name="readPage">Reads one page: the first for <see langword="null"/>, otherwise the page of that continuation key.</param>
  public static async Task<BankResult<JoinedPages>> ReadAll(Func<string?, Task<BankResult<EbTransactionPage>>> readPage) {
    ArgumentNullException.ThrowIfNull(readPage);

    List<EbTransaction> transactions = [];
    HashSet<string> keysReturned = new(StringComparer.Ordinal);
    string? continuationKey = null;
    int pageCount = 0;

    while (true) {
      BankResult<EbTransactionPage> result = await readPage(continuationKey);

      if (result is not EbTransactionPage page)
        return Failure(result);

      pageCount++;
      transactions.AddRange(page.Transactions);

      // The bank marks the last page with no key; an empty key cannot name a page, so it ends the read too (D7).
      if (string.IsNullOrEmpty(page.ContinuationKey))
        return new JoinedPages(transactions, pageCount);

      // Any key returned earlier in this read, not only the last one, would close a loop. The key is not quoted (D5).
      if (!keysReturned.Add(page.ContinuationKey))
        throw new BankReadException($"The bank returned a continuation key it had already returned in this read, after {pageCount} pages; following it would loop.");

      continuationKey = page.ContinuationKey;
    }
  }

  /// <summary>The failure a page came back with, as the whole read's.</summary>
  private static BankResult<JoinedPages> Failure(BankResult<EbTransactionPage> result) => result switch {
    BankAccessExpired expired => expired,
    BankRateLimited rateLimited => rateLimited,
    BankUnavailable unavailable => unavailable,
    EbTransactionPage => throw new UnreachableException("A page read is not a failure."),
  };
}

/// <summary>The transactions of every page, in page order, and how many pages were read.</summary>
public sealed record JoinedPages(IReadOnlyList<EbTransaction> Transactions, int PageCount);