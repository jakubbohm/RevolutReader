using System.Security.Cryptography;
using System.Text;
using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// A row of the transactions table the store cannot read (c010 design.md § Error model): a column it needs is missing, or
/// a column holds something the store never writes. Each is an <see cref="InvalidOperationException"/> naming the column,
/// never a parser's or the client's own exception, and its text quotes nothing from the row: the row is bank data. Each
/// test writes one row straight into a table of its own on the test session's Azurite (<see cref="AzuriteTables"/>), as
/// the store would but for the one column the case is about, and then reads it through the store. The values are made
/// up, each text holding a marker that must not turn up in the error.
/// </summary>
public sealed class UnreadableRowTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "7f3a9c";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="column">The column the case is about, as the store names it.</param>
  /// <param name="content">What the column holds instead of what the store writes, or <c>missing</c> when the row has no such column.</param>
  [Test]
  [Arguments("Reference", "missing")]
  [Arguments("Reference", "a number")]
  [Arguments("Date", "missing")]
  [Arguments("Date", "a Czech date")]
  [Arguments("Position", "missing")]
  [Arguments("Position", "text")]
  [Arguments("Amount", "missing")]
  [Arguments("Amount", "a decimal comma")]
  [Arguments("Currency", "missing")]
  [Arguments("Details", "missing")]
  [Arguments("Details", "text that is not JSON")]
  [Arguments("Details", "a JSON object")]
  [Arguments("Details", "a JSON null")]
  [Arguments("Details", "a null line")]
  [Arguments("Counterparty", "a number")]
  [Arguments("TypeCode", "a number")]
  public async Task A_row_the_store_cannot_read_is_an_error_naming_the_column_and_quoting_nothing_from_the_row(string column, string content) {
    TableEntity row = WrittenRow();

    if (content == "missing")
      row.Remove(column);
    else
      row[column] = content switch {
        "a number" => 7,
        "a Czech date" => $"18. 11. 2026 {MARKER}",
        "text" => $"0 {MARKER}",
        "a decimal comma" => $"-12,30 {MARKER}",
        "text that is not JSON" => $"Praha {MARKER}",
        "a JSON object" => $$"""{ "line": "Praha {{MARKER}}" }""",
        "a JSON null" => "null",
        "a null line" => $"""["Praha {MARKER}", null]""",
        _ => throw new ArgumentOutOfRangeException(nameof(content), content, "Not a known case."),
      };

    TableTransactionStore store = await StoreHolding(row);

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(() => store.ReadAll(CancellationToken.None));

    error.ShouldSatisfyAllConditions(
      () => error.Message.ShouldContain(column, Case.Sensitive),
      () => error.ToString().ShouldNotContain(MARKER),
      () => error.ToString().ShouldNotContain("12.30"));
  }

  /// <summary>A store whose table, of its own, holds this one row, written straight into it.</summary>
  private async Task<TableTransactionStore> StoreHolding(TableEntity row) {
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await table.UpsertEntityAsync(row, TableUpdateMode.Replace);

    return new TableTransactionStore(Azurite.Tables, Options.Create(new TransactionStoreOptions { TableName = tableName }));
  }

  /// <summary>
  /// A card payment of 12.30 EUR as the store writes it (c010 design.md D5): partition <c>account</c>, the SHA-256 of the
  /// reference's UTF-8 bytes in lowercase hex as the key (<see cref="RowKeyTests"/>), every column set; each test changes
  /// the one it is about.
  /// </summary>
  private static TableEntity WrittenRow() => new("account", Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes($"e/{MARKER}")))) {
    ["Reference"] = $"e/{MARKER}",
    ["Date"] = "2026-11-18",
    ["Position"] = 0,
    ["Amount"] = "-12.30",
    ["Currency"] = "EUR",
    ["Counterparty"] = $"Pekárna {MARKER}",
    ["Details"] = $"""["Praha {MARKER}"]""",
    ["TypeCode"] = $"CARD_{MARKER}",
  };
}