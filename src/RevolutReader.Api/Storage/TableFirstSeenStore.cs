using System.Net;
using System.Security.Cryptography;
using System.Text;
using Azure;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;

namespace RevolutReader.Api.Storage;

/// <summary>
/// <see cref="IFirstSeenStore"/> on Azure Table Storage (c018 design.md D3, § Ports and contracts): the table
/// <see cref="FirstSeenStoreOptions.TableName"/>, one partition (<c>account</c>), one row per timed transaction, keyed by
/// the SHA-256 of its reference's UTF-8 bytes in lowercase hex, exactly as <see cref="TableTransactionStore"/> keys its
/// rows, so whatever the reference holds, the key has no character Table Storage forbids; the reference itself is not
/// kept, so the row key is all that links a row to a transaction.
/// <list type="bullet">
/// <item>The one column: <c>SeenAt</c>, the table's date type, in UTC, to the second.</item>
/// <item>A read queries the partition once and answers the rows whose key is one of the references' hashes.</item>
/// <item>A record keeps the earliest moment per reference, row by row (a batch would fail whole on one row already
/// there): it inserts the row; when one is there already (409), it reads it, keeps it when its moment is not later, and
/// otherwise replaces it under the ETag it read; a lost race (412) reads the row again, and a row gone since the conflict
/// (on that read, or at the replace: 404) is inserted again. It is not capped: every lost race means another caller wrote the row first, and the app's callers
/// only ever write an earlier moment, so each try either ends or meets a strictly earlier kept moment; the caller's token
/// bounds it.</item>
/// <item>Nothing to read or record: no request, the table's creation included.</item>
/// <item>The table is created when missing, once per instance, before its first read or write; a creation that failed is
/// tried again by the next call (<see cref="TableCreation"/>).</item>
/// <item>A row it cannot read is an <see cref="InvalidOperationException"/> naming the column, never its value or its key;
/// the storage's own failures pass on as the client's exceptions (§ Error model). Logs nothing.</item>
/// </list>
/// </summary>
public sealed class TableFirstSeenStore : IFirstSeenStore {
  /// <summary>The one partition: the app reads one account.</summary>
  private const string PARTITION = "account";

  private const string SEEN_AT = "SeenAt";

  private readonly TableClient _table;
  private readonly TableCreation _creation;

  public TableFirstSeenStore(TableServiceClient tables, IOptions<FirstSeenStoreOptions> options) {
    ArgumentNullException.ThrowIfNull(tables);
    ArgumentNullException.ThrowIfNull(options);

    _table = tables.GetTableClient(options.Value.TableName);
    _creation = new TableCreation(_table);
  }

  public async Task<IReadOnlyDictionary<string, DateTimeOffset>> Read(IReadOnlyCollection<string> references, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(references);

    Dictionary<string, DateTimeOffset> kept = new(StringComparer.Ordinal);

    if (references.Count == 0)
      return kept;

    await _creation.Ensure(cancellationToken);

    // Distinct references have distinct keys (SHA-256 has no known collision).
    Dictionary<string, string> referenceOfKey = references.Distinct(StringComparer.Ordinal).ToDictionary(RowKey, StringComparer.Ordinal);

    await foreach (TableEntity row in _table.QueryAsync<TableEntity>(TableClient.CreateQueryFilter($"PartitionKey eq {PARTITION}"), cancellationToken: cancellationToken)) {
      if (referenceOfKey.TryGetValue(row.RowKey, out string? reference))
        kept[reference] = SeenAt(row);
    }

    return kept;
  }

  public async Task<IReadOnlyDictionary<string, DateTimeOffset>> Record(IReadOnlyList<FirstSeen> sightings, CancellationToken cancellationToken) {
    ArgumentNullException.ThrowIfNull(sightings);

    Dictionary<string, DateTimeOffset> kept = new(StringComparer.Ordinal);

    if (sightings.Count == 0)
      return kept;

    await _creation.Ensure(cancellationToken);

    foreach (FirstSeen sighting in sightings)
      kept[sighting.Reference] = await KeepEarliest(sighting.Reference, sighting.At.ToUniversalTime(), cancellationToken);

    return kept;
  }

  /// <summary>
  /// The earliest of <paramref name="at"/> and the moment the row of <paramref name="reference"/> holds, kept in it and
  /// answered, as the class describes (D3).
  /// </summary>
  private async Task<DateTimeOffset> KeepEarliest(string reference, DateTimeOffset at, CancellationToken cancellationToken) {
    TableEntity row = new(PARTITION, RowKey(reference)) {
      [SEEN_AT] = at,
    };

    while (true) {
      if (await Inserted(row, cancellationToken))
        return at;

      while (await _table.GetEntityIfExistsAsync<TableEntity>(PARTITION, row.RowKey, cancellationToken: cancellationToken) is { HasValue: true, Value: { } found }) {
        DateTimeOffset kept = SeenAt(found);

        if (kept <= at)
          return kept;

        if (await Replaced(row, found.ETag, cancellationToken))
          return at;
      }
    }
  }

  /// <summary>Whether <paramref name="row"/> was inserted; <see langword="false"/> when its key is taken (409).</summary>
  private async Task<bool> Inserted(TableEntity row, CancellationToken cancellationToken) {
    try {
      _ = await _table.AddEntityAsync(row, cancellationToken);

      return true;
    }
    catch (RequestFailedException conflict) when (conflict.Status == (int)HttpStatusCode.Conflict) {
      return false;
    }
  }

  /// <summary>
  /// Whether <paramref name="row"/> replaced the row still at <paramref name="etag"/>; <see langword="false"/> when another
  /// write came first (412) or the row is gone (404): the next read finds it changed, or nothing to replace.
  /// </summary>
  private async Task<bool> Replaced(TableEntity row, ETag etag, CancellationToken cancellationToken) {
    try {
      _ = await _table.UpdateEntityAsync(row, etag, TableUpdateMode.Replace, cancellationToken);

      return true;
    }
    catch (RequestFailedException lost) when (lost.Status is (int)HttpStatusCode.PreconditionFailed or (int)HttpStatusCode.NotFound) {
      return false;
    }
  }

  /// <summary>The row key of a reference: the SHA-256 of its UTF-8 bytes, in lowercase hex (D3, as the transactions table's).</summary>
  private static string RowKey(string reference) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(reference)));

  /// <summary>The row's moment, at offset zero; anything but the table's date type is unreadable.</summary>
  private static DateTimeOffset SeenAt(TableEntity row) =>
    row.TryGetValue(SEEN_AT, out object? value) && value is DateTimeOffset seenAt ? seenAt.ToUniversalTime() : throw Unreadable(SEEN_AT);

  private static InvalidOperationException Unreadable(string column) =>
    new($"A row of the first-seen times table cannot be read: its {column} column is missing or not in the form the store writes.");
}