using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IFirstSeenStore"/> on Azure Table Storage (c018 design.md D3, § Ports and contracts): partition
/// <c>account</c>, row key the SHA-256 of the reference (lowercase hex), column <c>SeenAt</c> (UTC); the table created when
/// missing (<see cref="TableCreation"/>); D3's insert, then the ETag-guarded replace.
/// </summary>
public sealed class TableFirstSeenStore : IFirstSeenStore {
  // A compile-only stub (tasks.md 5.2): the sketch's primary constructor comes with the implementation.
  public TableFirstSeenStore(TableServiceClient tables, IOptions<FirstSeenStoreOptions> options) => throw new NotImplementedException();

  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Read(IReadOnlyCollection<string> references, CancellationToken cancellationToken) =>
    throw new NotImplementedException();

  public Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<FirstSeen> sightings, CancellationToken cancellationToken) =>
    throw new NotImplementedException();
}