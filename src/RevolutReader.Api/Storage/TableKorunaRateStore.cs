using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Rate;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IKorunaRateStore"/> on Azure Table Storage (c017 design.md D2, D9, § Ports and contracts): the table
/// <see cref="KorunaRateStoreOptions.TableName"/>, one row, partition <c>rate</c>, row key <c>eur</c>, the columns
/// <c>CzkPerEur</c> (an invariant decimal string) and <c>Date</c> (<c>yyyy-MM-dd</c>). A compile-only stub until tasks.md
/// 6.2.
/// </summary>
public sealed class TableKorunaRateStore : IKorunaRateStore {
  public TableKorunaRateStore(TableServiceClient tables, IOptions<KorunaRateStoreOptions> options) =>
    throw new NotImplementedException("TableKorunaRateStore is implemented in tasks.md 6.2.");

  public Task<KorunaRate?> Read(CancellationToken cancellationToken) => throw new NotImplementedException("TableKorunaRateStore.Read is implemented in tasks.md 6.2.");

  public Task Save(KorunaRate rate, CancellationToken cancellationToken) => throw new NotImplementedException("TableKorunaRateStore.Save is implemented in tasks.md 6.2.");
}