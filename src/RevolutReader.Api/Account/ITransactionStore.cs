namespace RevolutReader.Api.Account;

/// <summary>The store of settled transactions (c010 design.md D5, § Ports and contracts).</summary>
public interface ITransactionStore {
  /// <summary>Every kept transaction, newest day first, by position within a day.</summary>
  Task<IReadOnlyList<KeptTransaction>> ReadAll(CancellationToken cancellationToken);

  /// <summary>Inserts or replaces each by its reference; keeping one again changes nothing.</summary>
  Task Keep(IReadOnlyList<KeptTransaction> transactions, CancellationToken cancellationToken);
}