using RevolutReader.Api.Check;

namespace RevolutReader.UnitTests.Check;

/// <summary>
/// The check's stored balances in memory (c014 design.md § Ports and contracts, D4): the in-memory fake of
/// <see cref="ICheckedBalanceStore"/> the account check's unit tests use. The integration project compiles this same file
/// into its contract tests, which run it and the Table adapter against the same tests, so it stays self-contained: it
/// needs nothing from either test project.
/// <list type="bullet">
/// <item><see cref="Read"/>: both balances as last saved, whole (amounts, read times and rates as they were);
/// <see langword="null"/> when nothing was ever saved.</item>
/// <item><see cref="Save"/>: replaces both, whole: saving again leaves one record with the latest values.</item>
/// <item>Safe for calls from several threads at once; the last write wins.</item>
/// </list>
/// </summary>
public sealed class InMemoryCheckedBalanceStore : ICheckedBalanceStore {
  private readonly Lock _lock = new();
  private CheckedBalances? _balances;

  public Task<CheckedBalances?> Read(CancellationToken cancellationToken) {
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock)
      return Task.FromResult(_balances);
  }

  public Task Save(CheckedBalances balances, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(balances);
    cancellationToken.ThrowIfCancellationRequested();

    lock (_lock)
      _balances = balances;

    return Task.CompletedTask;
  }
}