using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="ITransactionStore"/> on Azure Table Storage (c010 design.md D5): partition "account", row key = escaped
/// reference; creates the table if missing, once per process; Keep upserts in batches of at most 100 (one partition).
/// </summary>
#pragma warning disable CS9113 // A stub until c010 task 7.1 writes the adapter, which reads both; then this goes.
public sealed class TableTransactionStore(TableServiceClient tables, IOptions<TransactionStoreOptions> options) : ITransactionStore {
#pragma warning restore CS9113
  public Task<IReadOnlyList<KeptTransaction>> ReadAll(CancellationToken cancellationToken) => throw new NotImplementedException();

  public Task Keep(IReadOnlyList<KeptTransaction> transactions, CancellationToken cancellationToken) => throw new NotImplementedException();
}