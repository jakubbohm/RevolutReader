using Azure.Data.Tables;
using Microsoft.Extensions.Options;
using RevolutReader.Api.Storage;
using RevolutReader.IntegrationTests.Storage;
using Shouldly;

namespace RevolutReader.IntegrationTests.Wiring.Storage;

/// <summary>
/// The row of the kept koruna rate's table the store cannot read (c017 design.md § Error model, D2): a column it needs is
/// missing, or holds something the store never writes. Each is an <see cref="InvalidOperationException"/> naming the
/// column, never a parser's or the client's own exception, and its text quotes nothing from the row, as the other stores'
/// errors. Each test writes the one row straight into a table of its own on the test session's Azurite
/// (<see cref="AzuriteTables"/>), as the store would but for the one column the case is about, and then reads it through
/// the store. The values are made up: the rate distinctive, and each text in the column's place holding a marker; neither
/// may turn up in the error. Written by the test-writer before the adapter (tasks.md 5.4), as an adapter edge case.
/// </summary>
public sealed class UnreadableKorunaRateRowTests {
  /// <summary>Distinctive, so it cannot turn up in an error's text by coincidence.</summary>
  private const string MARKER = "8c3e2a";

  /// <summary>The row's rate as the store writes it, invariant decimal text, distinctive.</summary>
  private const string RATE = "24.4175";

  /// <summary>The row's day as the store writes it, <c>yyyy-MM-dd</c>.</summary>
  private const string DAY = "2026-11-20";

  /// <summary>The test session's Azurite, shared by every test that needs it.</summary>
  [ClassDataSource<AzuriteTables>(Shared = SharedType.PerTestSession)]
  public required AzuriteTables Azurite { get; init; }

  /// <param name="column">The column the case is about, as the store names it.</param>
  /// <param name="content">What the column holds instead of what the store writes, or <c>missing</c> when the row has no such column.</param>
  [Test]
  [Arguments("CzkPerEur", "missing")]
  [Arguments("CzkPerEur", "a decimal comma")]
  [Arguments("CzkPerEur", "a number")]
  [Arguments("Date", "missing")]
  [Arguments("Date", "a date in another form")]
  [Arguments("Date", "the table's date type")]
  public async Task A_row_the_store_cannot_read_is_an_error_naming_the_column_and_quoting_nothing_from_the_row(string column, string content) {
    TableEntity row = WrittenRow();

    if (content == "missing")
      row.Remove(column);
    else
      row[column] = content switch {
        "a decimal comma" => $"24,4175 {MARKER}",
        "a number" => 24.4175,
        "a date in another form" => $"20. 11. 2026 {MARKER}",
        "the table's date type" => new DateTimeOffset(2026, 11, 20, 0, 0, 0, TimeSpan.Zero),
        _ => throw new ArgumentOutOfRangeException(nameof(content), content, "Not a known case."),
      };

    TableKorunaRateStore store = await StoreHolding(row);

    InvalidOperationException error = await Should.ThrowAsync<InvalidOperationException>(() => store.Read(CancellationToken.None));

    string[] fromTheRow = [MARKER, RATE, "24,4175", DAY, "20. 11. 2026"];
    error.ShouldSatisfyAllConditions(
      () => error.Message.ShouldContain(column, Case.Sensitive),
      () => fromTheRow.Where(value => error.ToString().Contains(value, StringComparison.Ordinal)).ShouldBeEmpty("the error quotes nothing from the row"));
  }

  /// <summary>A store whose table, of its own, holds this one row, written straight into it.</summary>
  private async Task<TableKorunaRateStore> StoreHolding(TableEntity row) {
    string tableName = AzuriteTables.UniqueTableName();
    TableClient table = Azurite.Tables.GetTableClient(tableName);
    await table.CreateIfNotExistsAsync();
    await table.UpsertEntityAsync(row, TableUpdateMode.Replace);

    return new TableKorunaRateStore(Azurite.Tables, Options.Create(new KorunaRateStoreOptions { TableName = tableName }));
  }

  /// <summary>
  /// The kept rate as the store writes it (D2): partition <c>rate</c>, row key <c>eur</c>, the rate as invariant decimal
  /// text and the day as <c>yyyy-MM-dd</c>; each test changes the column it is about.
  /// </summary>
  private static TableEntity WrittenRow() =>
    new("rate", "eur") {
      ["CzkPerEur"] = RATE,
      ["Date"] = DAY,
    };
}