using System.Security.Cryptography;
using System.Text;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Push;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IPushDeviceStore"/> on Azure Table Storage (c011 design.md D11, § Ports and contracts): the table
/// <see cref="PushDeviceStoreOptions.TableName"/>, one partition (<c>devices</c>), one row per device, keyed by the
/// SHA-256 of its push address's UTF-8 bytes in lowercase hex: 64 characters, only <c>0-9a-f</c>, so whatever the address
/// holds, the key has no character Table Storage forbids in a key (<c>/</c>, <c>\</c>, <c>#</c>, <c>?</c>); the address
/// itself kept unchanged in a column, which every read uses. As <see cref="TableTransactionStore"/>:
/// <list type="bullet">
/// <item>The columns: <c>Endpoint</c>, <c>P256dh</c>, <c>Auth</c>, <c>Account</c>, each as saved.</item>
/// <item>A save replaces the whole row with the same key, so the same push address saved again keeps one device, with the
/// latest keys and account; a forget of an address not stored is fine.</item>
/// <item>The table is created when missing, once per instance, before its first read or write; a creation that failed is
/// tried again by the next call.</item>
/// <item>A row it cannot read is an <see cref="InvalidOperationException"/> naming the column, never its value; the
/// storage's own failures pass on as the client's exceptions (§ Error model). Logs nothing.</item>
/// </list>
/// </summary>
public sealed class TablePushDeviceStore(TableServiceClient tables, IOptions<PushDeviceStoreOptions> options) : IPushDeviceStore {
  /// <summary>The one partition: every send reads every device (D11).</summary>
  private const string PARTITION = "devices";

  private const string ENDPOINT = "Endpoint";
  private const string P256DH = "P256dh";
  private const string AUTH = "Auth";
  private const string ACCOUNT = "Account";

  private readonly TableClient _table = tables.GetTableClient(options.Value.TableName);
  private readonly Lock _lock = new();

  /// <summary>The table's creation, shared by every caller; <see langword="null"/> before the first call.</summary>
  private Task? _created;

  /// <summary>Every row of the partition, in the order the table gives them (by key): no order is promised.</summary>
  public async Task<IReadOnlyList<PushDevice>> ReadAll(CancellationToken cancellationToken) {
    await TableCreated(cancellationToken);

    List<PushDevice> devices = [];

    await foreach (TableEntity row in _table.QueryAsync<TableEntity>(TableClient.CreateQueryFilter($"PartitionKey eq {PARTITION}"), cancellationToken: cancellationToken))
      devices.Add(Read(row));

    return devices;
  }

  /// <summary>Upserts the device's row whole, replacing a row with the same key rather than merging into it.</summary>
  public async Task Save(PushDevice device, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(device);

    await TableCreated(cancellationToken);

    TableEntity row = new(PARTITION, RowKey(device.Endpoint)) {
      [ENDPOINT] = device.Endpoint,
      [P256DH] = device.P256dh,
      [AUTH] = device.Auth,
      [ACCOUNT] = device.Account,
    };

    _ = await _table.UpsertEntityAsync(row, TableUpdateMode.Replace, cancellationToken);
  }

  /// <summary>Deletes the row of <paramref name="endpoint"/>; the client takes a row that is not there as deleted.</summary>
  public async Task Forget(string endpoint, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(endpoint);

    await TableCreated(cancellationToken);

    _ = await _table.DeleteEntityAsync(PARTITION, RowKey(endpoint), cancellationToken: cancellationToken);
  }

  /// <summary>
  /// The table created if missing: every caller awaits the same creation, and only one that failed or was cancelled is
  /// started again. It runs without the caller's token, so one caller giving up does not fail the others; each caller
  /// stops waiting on its own token.
  /// </summary>
  private Task TableCreated(CancellationToken cancellationToken) {
    lock (_lock) {
      if (_created is null || _created.IsFaulted || _created.IsCanceled)
        _created = _table.CreateIfNotExistsAsync(CancellationToken.None);

      return _created.WaitAsync(cancellationToken);
    }
  }

  /// <summary>The row key of a push address: the SHA-256 of its UTF-8 bytes, in lowercase hex (D11).</summary>
  private static string RowKey(string endpoint) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(endpoint)));

  private static PushDevice Read(TableEntity row) => new(Text(row, ENDPOINT), Text(row, P256DH), Text(row, AUTH), Text(row, ACCOUNT));

  private static string Text(TableEntity row, string column) =>
    row.TryGetValue(column, out object? value) && value is string text ? text : throw Unreadable(column);

  private static InvalidOperationException Unreadable(string column) =>
    new($"A row of the push devices table cannot be read: its {column} column is missing or not text.");
}