using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Check;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="ICheckedBalanceStore"/> on Table Storage (c014 design.md D4): partition <c>check</c>, row <c>balances</c>; six
/// columns, amounts and rates as invariant decimal strings; Save upserts the whole row; no row → null; a row it cannot read →
/// <see cref="InvalidOperationException"/> naming the column, never its value; the table created if missing, once per
/// instance (<see cref="TableCreation"/>).
/// </summary>
public sealed class TableCheckedBalanceStore : ICheckedBalanceStore {
  public TableCheckedBalanceStore(TableServiceClient tables, IOptions<CheckedBalanceStoreOptions> options) {
    ArgumentNullException.ThrowIfNull(tables);
    ArgumentNullException.ThrowIfNull(options);
  }

  public Task<CheckedBalances?> Read(CancellationToken cancellationToken) => throw new NotImplementedException();

  public Task Save(CheckedBalances balances, CancellationToken cancellationToken) => throw new NotImplementedException();
}