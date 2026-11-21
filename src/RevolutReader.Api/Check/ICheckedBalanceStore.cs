namespace RevolutReader.Api.Check;

/// <summary>
/// The check's stored balances (c014 design.md D4, § Ports and contracts): one record, last write wins; failures are
/// exceptions, never results.
/// </summary>
public interface ICheckedBalanceStore {
  /// <summary>Both balances as last saved; <see langword="null"/> when nothing is stored yet.</summary>
  Task<CheckedBalances?> Read(CancellationToken cancellationToken);

  /// <summary>Replaces both, whole.</summary>
  Task Save(CheckedBalances balances, CancellationToken cancellationToken);
}