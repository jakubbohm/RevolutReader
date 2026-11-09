using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IPushDeviceStore"/> on Table Storage (c011 design.md D11): partition "devices", row key SHA-256(endpoint) in
/// lowercase hex; columns Endpoint, P256dh, Auth, Account; the table created if missing, once per instance; Save upserts
/// whole rows.
/// </summary>
public sealed class TablePushDeviceStore : IPushDeviceStore {
  public TablePushDeviceStore(TableServiceClient tables, IOptions<PushDeviceStoreOptions> options) => throw new NotImplementedException();

  public Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken) => throw new NotImplementedException();

  public Task Save(PushDevice device, CancellationToken cancellationToken) => throw new NotImplementedException();

  public Task Forget(string endpoint, CancellationToken cancellationToken) => throw new NotImplementedException();
}