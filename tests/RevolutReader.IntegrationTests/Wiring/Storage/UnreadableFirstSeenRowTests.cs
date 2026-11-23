using System.Security.Cryptography;
using System.Text;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Account;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// A row of the first-seen table the store cannot read (c018 design.md § Error model, D3): its <c>SeenAt</c> column is
/// missing, or holds something the store never writes, met by a read or by a record whose insert conflicts with it. Each
/// is an <see cref="InvalidOperationException"/> naming the column, never a parser's or the client's own exception, and
/// its text quotes nothing from the row: not the moment, not the row key, not the reference it is the hash of (the table
/// adapters name columns only, D5). Each test writes the one row straight into a table of its own on the test session's
/// Azurite (<see cref="AzuriteTables"/>), as the store would but for the column the case is about, and then reads or
/// records its reference through the store. The values are made up, each text holding a marker that must not turn up in
/// the error. Written by the test-writer before the adapter (tasks.md 4.6) and its conflict path (8.4), as an adapter edge
/// case.
/// </summary>
public sealed class UnreadableFirstSeenRowTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "5d1b7e";

  /// <summary>The row's reference (made up), whose hash is its row key.</summary>
  private const string REFERENCE = "e-c018-unreadable";

  /// <summary>The column the store keeps the moment in (D3).</summary>
  private const string SEEN_AT = "SeenAt";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="operation">
  /// <c>Read</c>, asking for the row's reference; or <c>Record</c>, recording a sighting of it, whose insert conflicts with
  /// the row, so the store reads the row to compare (tasks.md 8.4, D3's conflict path).
  /// </param>
  /// <param name="content">What <c>SeenAt</c> holds instead of the table's date type, or <c>missing</c> when the row has no such column.</param>
  [Test]
  [Arguments("Read", "missing")]
  [Arguments("Read", "text")]
  [Arguments("Read", "a number")]
  [Arguments("Record", "missing")]
  [Arguments("Record", "text")]
  [Arguments("Record", "a number")]
  public async Task A_row_the_store_cannot_read_is_an_error_naming_the_column_and_quoting_nothing_from_the_row(string operation, string content) {
    TableEntity row = WrittenRow();

    if (content == "missing")
      row.Remove(SEEN_AT);
    else
      row[SEEN_AT] = content switch {
        "text" => $"2026-11-20T13:05:12Z {MARKER}",
        "a number" => 20261120130512L,
        _ => throw new ArgumentOutOfRangeException(nameof(content), content, "Not a known case."),
      };

    TableFirstSeenStore store = await StoreHolding(row);

    Func<Task> reading = operation switch {
      "Read" => () => store.Read([REFERENCE], CancellationToken.None),
      "Record" => () => store.Record([new FirstSeen(REFERENCE, new DateTimeOffset(2026, 11, 20, 13, 5, 12, TimeSpan.Zero))], CancellationToken.None),
      _ => throw new ArgumentOutOfRangeException(nameof(operation), operation, "Not a known case."),
    };

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(reading);

    string[] fromTheRow = [MARKER, "2026-11-20", "13:05:12", "20261120130512", REFERENCE, RowKey(REFERENCE)];
    error.ShouldSatisfyAllConditions(
      () => error.Message.ShouldContain(SEEN_AT, Case.Sensitive),
      () => fromTheRow.Where(value => error.ToString().Contains(value, StringComparison.Ordinal)).ShouldBeEmpty("the error quotes nothing from the row"));
  }

  /// <summary>A store whose table, of its own, holds this one row, written straight into it.</summary>
  private async Task<TableFirstSeenStore> StoreHolding(TableEntity row) {
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await table.UpsertEntityAsync(row, TableUpdateMode.Replace);

    return new TableFirstSeenStore(Azurite.Tables, Options.Create(new FirstSeenStoreOptions { TableName = tableName }));
  }

  /// <summary>
  /// The moment of <see cref="REFERENCE"/> as the store writes it (D3): partition <c>account</c>, row key the SHA-256 of the
  /// reference, <c>SeenAt</c> the table's date type, in UTC, to the second; each test changes the column.
  /// </summary>
  private static TableEntity WrittenRow() =>
    new("account", RowKey(REFERENCE)) {
      [SEEN_AT] = new DateTimeOffset(2026, 11, 20, 13, 5, 12, TimeSpan.Zero),
    };

  /// <summary>The row key of a reference: the SHA-256 of its UTF-8 bytes, in lowercase hex (D3, as the transactions table's).</summary>
  private static string RowKey(string reference) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(reference)));
}