using Azure.Data.Tables;

namespace RevolutReader.Api.Storage;

/// <summary>
/// A store's table created if missing, once per instance, before the store's first read or write (c010 design.md D5, c011
/// design.md D11): every caller awaits the same creation, and only one that failed or was cancelled is started again. It
/// runs without the caller's token, so one caller giving up does not fail the others; each caller stops waiting on its own
/// token.
/// </summary>
internal sealed class TableCreation(TableClient table) {
  private readonly Lock _lock = new();

  /// <summary>The table's creation, shared by every caller; <see langword="null"/> before the first call.</summary>
  private Task? _created;

  /// <summary>
  /// The table created if missing, as the class describes: a creation running or done is shared, one that failed or was
  /// cancelled is started again; <paramref name="cancellationToken"/> ends only this caller's wait, never the creation.
  /// </summary>
  public Task Ensure(CancellationToken cancellationToken) {
    lock (_lock) {
      if (_created is null || _created.IsFaulted || _created.IsCanceled)
        _created = table.CreateIfNotExistsAsync(CancellationToken.None);

      return _created.WaitAsync(cancellationToken);
    }
  }
}