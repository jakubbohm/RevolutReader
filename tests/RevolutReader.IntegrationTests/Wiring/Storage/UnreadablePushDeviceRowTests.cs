using System.Security.Cryptography;
using System.Text;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// A row of the push devices table the store cannot read (c011 design.md § Error model): a column it needs is missing, or
/// holds something other than text. Each is an <see cref="InvalidOperationException"/> naming the column, never the
/// client's own exception, and its text quotes nothing from the row: a device's push address and keys, and its account.
/// Each test writes one row straight into a table of its own on the test session's Azurite (<see cref="AzuriteTables"/>),
/// as the store would but for the one column the case is about, and then reads it through the store. The values are made
/// up, each holding a marker that must not turn up in the error.
/// </summary>
public sealed class UnreadablePushDeviceRowTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "4e8b2d";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="column">The column the case is about, as the store names it.</param>
  /// <param name="content">What the column holds instead of text, or <c>missing</c> when the row has no such column.</param>
  [Test]
  [Arguments("Endpoint", "missing")]
  [Arguments("Endpoint", "a number")]
  [Arguments("P256dh", "missing")]
  [Arguments("P256dh", "a number")]
  [Arguments("Auth", "missing")]
  [Arguments("Auth", "a number")]
  [Arguments("Account", "missing")]
  [Arguments("Account", "a number")]
  public async Task A_row_the_store_cannot_read_is_an_error_naming_the_column_and_quoting_nothing_from_the_row(string column, string content) {
    TableEntity row = WrittenRow();

    if (content == "missing")
      row.Remove(column);
    else
      row[column] = content switch {
        "a number" => 7,
        _ => throw new ArgumentOutOfRangeException(nameof(content), content, "Not a known case."),
      };

    TablePushDeviceStore store = await StoreHolding(row);

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(() => store.ReadAll(CancellationToken.None));

    error.ShouldSatisfyAllConditions(
      () => error.Message.ShouldContain(column, Case.Sensitive),
      () => error.ToString().ShouldNotContain(MARKER));
  }

  /// <summary>A store whose table, of its own, holds this one row, written straight into it.</summary>
  private async Task<TablePushDeviceStore> StoreHolding(TableEntity row) {
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await table.UpsertEntityAsync(row, TableUpdateMode.Replace);

    return new TablePushDeviceStore(Azurite.Tables, Options.Create(new PushDeviceStoreOptions { TableName = tableName }));
  }

  /// <summary>
  /// A device as the store writes it (D11): partition <c>devices</c>, the SHA-256 of the push address's UTF-8 bytes in
  /// lowercase hex as the key (<see cref="PushDeviceRowKeyTests"/>), every column set; each test changes the one it is about.
  /// </summary>
  private static TableEntity WrittenRow() {
    string pushAddress = $"https://fcm.googleapis.com/fcm/send/made-up-{MARKER}";

    return new TableEntity("devices", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(pushAddress)))) {
      ["Endpoint"] = pushAddress,
      ["P256dh"] = $"made-up-public-key-{MARKER}",
      ["Auth"] = $"made-up-secret-{MARKER}",
      ["Account"] = $"lucie-{MARKER}@example.com",
    };
  }
}