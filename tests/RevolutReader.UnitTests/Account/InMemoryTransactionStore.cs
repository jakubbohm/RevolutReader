using RevolutReader.Api.Account;

namespace RevolutReader.UnitTests.Account;

/// <summary>
/// The store of settled transactions in memory (c010 design.md § Ports and contracts, D12): the in-memory fake of
/// <see cref="ITransactionStore"/> the handlers' unit tests use. The integration project compiles this same file into its
/// contract tests, which run it and the Table adapter against the same tests, so it stays self-contained: it needs nothing
/// from either test project.
/// <list type="bullet">
/// <item><see cref="ReadAll"/>: every kept transaction, newest day first, then by its position within the day; an empty
/// store reads as no transactions. Two kept on the same day at the same position come by their reference (ordinal), so
/// a read is always in the same order.</item>
/// <item><see cref="Keep"/>: inserts or replaces each by its reference, so keeping one again leaves one with the latest
/// values; an empty list changes nothing; any number at once. Each is kept as given, its lines copied, so a caller that
/// changes its list afterwards changes nothing kept.</item>
/// <item>Safe for calls from several threads at once (two phones reading at once write the same rows).</item>
/// </list>
/// </summary>
public sealed class InMemoryTransactionStore : ITransactionStore {
  private readonly Lock _lock = new();
  private readonly Dictionary<string, KeptTransaction> _byReference = new(StringComparer.Ordinal);

  public Task<IReadOnlyList<KeptTransaction>> ReadAll(CancellationToken cancellationToken) {
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      return Task.FromResult<IReadOnlyList<KeptTransaction>>([
        .. _byReference.Values
          .OrderByDescending(static transaction => transaction.Date)
          .ThenBy(static transaction => transaction.Position)
          .ThenBy(static transaction => transaction.Reference, StringComparer.Ordinal),
      ]);
    }
  }

  public Task Keep(IReadOnlyList<KeptTransaction> transactions, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(transactions);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock) {
      foreach (KeptTransaction transaction in transactions)
        _byReference[transaction.Reference] = transaction with { PaymentDetails = [.. transaction.PaymentDetails] };
    }

    return Task.CompletedTask;
  }
}